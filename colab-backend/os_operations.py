import os
import re
import json
import httpx
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

OS_OPERATION_PROMPT = """
You parse Windows file-system and document commands into structured JSON.

operation: "open" | "search" | "create_folder" | "create_document" | "delete" | "rename" | "move" | "copy"

For open / search / delete / rename / move / copy:
- target_name: the actual NAME ONLY. Strip words like "folder", "file", "document" —
  those describe TYPE, not the name. "cdf folder" -> target_name "cdf", target_type "folder"
- target_type: "folder" | "file" | "any"
- location_hint: ONLY if a specific known location is named (desktop, documents,
  downloads, pictures, videos, music) — else null
- new_name: only for rename operation, else null
- source: only for move / copy operation, else null
- destination: only for move / copy operation, else null

For create_document:
- document_type: "word" | "excel" | "powerpoint" | "text"
- content_topic: the SUBJECT MATTER the document should be about
- target_name: filename ONLY if the user explicitly gave one, else null
- location_hint: same as above

Examples:
"open cdf folder on desktop"
-> {"operation":"open","target_name":"cdf","target_type":"folder","location_hint":"desktop"}

"hi, i want you to find folder name cdf"
-> {"operation":"search","target_name":"cdf","target_type":"folder","location_hint":null}

"can you please open the cdf folder for me"
-> {"operation":"open","target_name":"cdf","target_type":"folder","location_hint":null}

"hey pecifics, create a word document about machine learning please"
-> {"operation":"create_document","document_type":"word","content_topic":"machine learning","target_name":null,"location_hint":null}

"delete report.pdf in downloads"
-> {"operation":"delete","target_name":"report.pdf","target_type":"file","location_hint":"downloads"}

"rename the screenshots folder to old_screenshots"
-> {"operation":"rename","target_name":"screenshots","target_type":"folder","location_hint":null,"new_name":"old_screenshots"}

Return JSON only, no explanation.
"""

async def call_qwen_local(system_prompt: str, user_message: str, max_tokens: int = 150) -> str:
    import asyncio
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    f"{OLLAMA_URL.rstrip('/')}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "stream": False,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_message},
                        ],
                        "keep_alive": "30m",
                        "options": {"temperature": 0.2, "num_predict": max_tokens},
                    },
                )
            if resp.status_code == 200:
                data = resp.json()
                content = (data.get("message") or {}).get("content") or data.get("response") or ""
                if content:
                    return content
            logger.warning(f"[OS-PARSE] Attempt {attempt} returned status {resp.status_code}")
        except Exception as e:
            logger.warning(f"[OS-PARSE] Attempt {attempt} failed: {e}", exc_info=True)
        if attempt < 3:
            await asyncio.sleep(1.5)
    return ""


def safe_parse_json(raw: str) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    raw = raw.strip()
    # Strip markdown code blocks
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    raw = raw.strip()
    try:
        return json.loads(raw)
    except Exception as e:
        logger.warning(f"[OS-PARSE] Failed to parse JSON directly: {e}. Raw was: {raw}")
        # Try to find a JSON block via regex
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                pass
    return None

async def parse_os_command(command: str) -> Optional[Dict[str, Any]]:
    raw = await call_qwen_local(system_prompt=OS_OPERATION_PROMPT, user_message=command, max_tokens=150)
    parsed = safe_parse_json(raw)
    logger.info(f"[OS-PARSE] '{command}' -> {parsed}")
    return parsed

LOCATION_ALIASES = {
    "desktop": "Desktop",
    "documents": "Documents",
    "docs": "Documents",
    "downloads": "Downloads",
    "download": "Downloads",
    "pictures": "Pictures",
    "photos": "Pictures",
    "videos": "Videos",
    "music": "Music",
}

def resolve_location(hint: Optional[str], user_home: Optional[str] = None) -> Optional[str]:
    if not hint:
        return None
    folder = LOCATION_ALIASES.get(hint.lower().strip())
    if not folder:
        return None
    home = user_home or os.path.expanduser("~")
    # Resolve OneDrive path first
    onedrive_path = os.path.join(home, "OneDrive", folder)
    if os.path.exists(onedrive_path):
        return onedrive_path
    # Fallback to standard path
    return os.path.join(home, folder)

def find_in_dir(directory: str, name: str, target_type: str, recursive: bool, max_depth: int = 2) -> Optional[Dict[str, Any]]:
    if not os.path.exists(directory):
        return None
    name_lower = name.lower()

    def matches(entry_name, is_dir):
        if target_type == "folder" and not is_dir:
            return False
        if target_type == "file" and is_dir:
            return False
        entry_lower = entry_name.lower()
        # Exact match, match without extension, or substring match
        return (entry_lower == name_lower or
                os.path.splitext(entry_lower)[0] == name_lower or
                name_lower in entry_lower)

    if not recursive:
        try:
            for entry in os.listdir(directory):
                full = os.path.join(directory, entry)
                is_dir = os.path.isdir(full)
                if matches(entry, is_dir):
                    return {"name": entry, "path": full, "isDirectory": is_dir}
        except Exception:
            pass
        return None

    try:
        for root, dirs, files in os.walk(directory):
            depth = root[len(directory):].count(os.sep)
            if depth >= max_depth:
                dirs[:] = []
                continue
            for d in dirs:
                full = os.path.join(root, d)
                if matches(d, True):
                    return {"name": d, "path": full, "isDirectory": True}
            for f in files:
                full = os.path.join(root, f)
                if matches(f, False):
                    return {"name": f, "path": full, "isDirectory": False}
    except Exception:
        pass
    return None

def get_default_search_roots(user_home: Optional[str] = None) -> List[str]:
    home = user_home or os.path.expanduser("~")
    base_folders = ["desktop", "documents", "downloads", "pictures", "videos", "music"]
    roots = []
    for folder in base_folders:
        resolved = resolve_location(folder, home)
        if resolved and os.path.exists(resolved):
            roots.append(resolved)
    logger.info(f"[OS-OP] Broad search roots: {roots}")
    return roots

def search_default_roots(name: str, target_type: str, max_results: int = 10, user_home: Optional[str] = None) -> List[Dict[str, Any]]:
    roots = get_default_search_roots(user_home)
    matches_found = []
    name_lower = name.lower()
    
    def matches_criteria(entry_name, is_dir):
        if target_type == "folder" and not is_dir:
            return False
        if target_type == "file" and is_dir:
            return False
        entry_lower = entry_name.lower()
        return (entry_lower == name_lower or
                os.path.splitext(entry_lower)[0] == name_lower or
                name_lower in entry_lower)

    # Search top-level of all roots first
    for root in roots:
        try:
            for entry in os.listdir(root):
                full = os.path.join(root, entry)
                is_dir = os.path.isdir(full)
                if matches_criteria(entry, is_dir):
                    matches_found.append({"name": entry, "path": full, "isDirectory": is_dir})
                    if len(matches_found) >= max_results:
                        return matches_found
        except Exception:
            continue
            
    # Search recursively up to depth 2 if we still need more results
    for root in roots:
        try:
            for r, dirs, files in os.walk(root):
                depth = r[len(root):].count(os.sep)
                if depth >= 2:
                    dirs[:] = []
                    continue
                for d in dirs:
                    full = os.path.join(r, d)
                    if matches_criteria(d, True):
                        item = {"name": d, "path": full, "isDirectory": True}
                        if item not in matches_found:
                            matches_found.append(item)
                            if len(matches_found) >= max_results:
                                return matches_found
                for f in files:
                    full = os.path.join(r, f)
                    if matches_criteria(f, False):
                        item = {"name": f, "path": full, "isDirectory": False}
                        if item not in matches_found:
                            matches_found.append(item)
                            if len(matches_found) >= max_results:
                                return matches_found
        except Exception:
            continue
            
    return matches_found

async def execute(parsed: Dict[str, Any], message: str, session_id: str, user_home: Optional[str] = None) -> Dict[str, Any]:
    operation = parsed.get("operation")
    target_name = parsed.get("target_name") or ""
    target_type = parsed.get("target_type") or "any"
    location_hint = parsed.get("location_hint")
    
    home = user_home or os.path.expanduser("~")

    # 1. OPEN OPERATION
    if operation == "open":
        loc = resolve_location(location_hint, home)
        if loc:
            # Check scoped location
            match = find_in_dir(loc, target_name, target_type, recursive=False)
            if not match:
                match = find_in_dir(loc, target_name, target_type, recursive=True, max_depth=2)
            if match:
                logger.info(f"[OS-OP] Found in scoped location: {match['path']}")
                return {
                    "goal": message,
                    "message": f"Opening '{match['name']}' in {location_hint}.",
                    "strategy": "protocol",
                    "protocol_id": "filesystem.search_and_open",
                    "capability": "file_search",
                    "parameters": {"query": target_name, "location": location_hint},
                    "tasks": [{
                        "id": 1,
                        "description": f"Open '{match['name']}'",
                        "protocol_id": "filesystem.search_and_open",
                        "capability": "file_search",
                        "needs_input": False,
                        "input_fields": [],
                        "actions": [{
                            "name": "open_path",
                            "parameters": {"path": match["path"]}
                        }],
                        "dependsOn": None,
                        "depends_on": [],
                        "parallel": False,
                        "risk": "low",
                        "requires_confirmation": False
                    }],
                    "fallbacks": ["ask_user"],
                    "requires_confirmation": False,
                    "expected_result": "Item opened successfully.",
                    "session_id": session_id
                }
            return {
                "goal": message,
                "message": f"No {target_type if target_type != 'any' else 'item'} named '{target_name}' found in {location_hint}.",
                "strategy": "chat",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [],
                "session_id": session_id
            }
        else:
            # Check default roots
            matches = search_default_roots(target_name, target_type, max_results=10, user_home=home)
            if len(matches) == 1:
                match = matches[0]
                return {
                    "goal": message,
                    "message": f"Opening '{match['name']}' at {match['path']}.",
                    "strategy": "protocol",
                    "protocol_id": "filesystem.search_and_open",
                    "capability": "file_search",
                    "parameters": {"query": target_name},
                    "tasks": [{
                        "id": 1,
                        "description": f"Open '{match['name']}'",
                        "protocol_id": "filesystem.search_and_open",
                        "capability": "file_search",
                        "needs_input": False,
                        "input_fields": [],
                        "actions": [{
                            "name": "open_path",
                            "parameters": {"path": match["path"]}
                        }],
                        "dependsOn": None,
                        "depends_on": [],
                        "parallel": False,
                        "risk": "low",
                        "requires_confirmation": False
                    }],
                    "fallbacks": ["ask_user"],
                    "requires_confirmation": False,
                    "expected_result": "Item opened successfully.",
                    "session_id": session_id
                }
            elif len(matches) > 1:
                return {
                    "goal": message,
                    "message": f"Found {len(matches)} matches for '{target_name}'. Which one would you like to open?",
                    "strategy": "ask_user",
                    "protocol_id": "filesystem.search_and_open",
                    "capability": "file_search",
                    "parameters": {"query": target_name},
                    "tasks": [],
                    "fallbacks": ["ask_user"],
                    "requires_confirmation": False,
                    "expected_result": "",
                    "session_id": session_id,
                    "suggestions": [m["path"] for m in matches[:5]]
                }
            return {
                "goal": message,
                "message": f"Could not find any item named '{target_name}' on your laptop.",
                "strategy": "chat",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [],
                "session_id": session_id
            }

    # 2. SEARCH OPERATION
    elif operation == "search":
        loc = resolve_location(location_hint, home)
        return {
            "goal": message,
            "message": f"Searching your laptop for '{target_name}'" + (f" in {location_hint}" if location_hint else "") + "...",
            "strategy": "protocol",
            "protocol_id": "filesystem.search_and_open",
            "capability": "file_search",
            "parameters": {"query": target_name, "location": loc or "all"},
            "tasks": [{
                "id": 1,
                "description": f"Search local files for '{target_name}'",
                "protocol_id": "filesystem.search_and_open",
                "capability": "file_search",
                "needs_input": False,
                "input_fields": [],
                "actions": [{
                    "name": "find_files",
                    "parameters": {"query": target_name, "location": loc or "all"}
                }],
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "low",
                "requires_confirmation": False
            }],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "Search results listed.",
            "session_id": session_id
        }

    # 3. CREATE_FOLDER OPERATION
    elif operation == "create_folder":
        loc = resolve_location(location_hint or "desktop", home) or os.path.join(home, "Desktop")
        folder_path = os.path.join(loc, target_name)
        return {
            "goal": message,
            "message": f"Creating folder '{target_name}' in {location_hint or 'Desktop'}.",
            "strategy": "protocol",
            "protocol_id": "windows.create_folder",
            "capability": "create_folder",
            "parameters": {"name": target_name, "location": location_hint or "Desktop", "folder_path": folder_path},
            "tasks": [{
                "id": 1,
                "description": f"Create folder '{target_name}'",
                "protocol_id": "windows.create_folder",
                "capability": "create_folder",
                "needs_input": False,
                "input_fields": [],
                "actions": [{
                    "name": "create_folder",
                    "parameters": {"folder_path": folder_path}
                }],
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "low",
                "requires_confirmation": False
            }],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "Folder created successfully.",
            "session_id": session_id
        }

    # 4. CREATE_DOCUMENT OPERATION
    elif operation == "create_document":
        doc_type = parsed.get("document_type", "word")
        topic = parsed.get("content_topic") or "document"
        filename = parsed.get("target_name")
        loc = resolve_location(location_hint or "desktop", home) or os.path.join(home, "Desktop")
        
        # Resolve suffix extension
        ext = ".docx" if doc_type == "word" else ".xlsx" if doc_type == "excel" else ".pptx" if doc_type == "powerpoint" else ".txt"
        if filename:
            if not filename.lower().endswith(ext):
                filename = f"{filename}{ext}"
        else:
            safe_title = re.sub(r'[\\/:*?"<>|]', '_', topic).strip().replace(" ", "_")[:50]
            filename = f"{safe_title}{ext}"

        filepath = os.path.join(loc, filename)
        title = filename.rsplit(".", 1)[0].replace("_", " ").title()

        if doc_type == "word":
            return {
                "goal": message,
                "message": f"Creating Word document about '{topic}' at {filepath}.",
                "strategy": "protocol",
                "protocol_id": "msword.create_document",
                "capability": "create_word_document",
                "parameters": {"topic": topic, "title": title, "filename": filepath},
                "tasks": [{
                    "id": 1,
                    "description": f"Generate Word document: {title}",
                    "protocol_id": "msword.create_document",
                    "capability": "create_word_document",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": "create_word_document",
                        "parameters": {"topic": topic, "title": title, "filename": filepath}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "low",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": "Word document created.",
                "session_id": session_id
            }

        elif doc_type == "excel":
            return {
                "goal": message,
                "message": f"Creating Excel spreadsheet about '{topic}' at {filepath}.",
                "strategy": "protocol",
                "protocol_id": "msexcel.create_spreadsheet",
                "capability": "create_excel_spreadsheet",
                "parameters": {"topic": topic, "title": title, "filename": filepath},
                "tasks": [{
                    "id": 1,
                    "description": f"Generate Excel spreadsheet: {title}",
                    "protocol_id": "msexcel.create_spreadsheet",
                    "capability": "create_excel_spreadsheet",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": "create_excel_spreadsheet",
                        "parameters": {"topic": topic, "title": title, "filename": filepath}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "low",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": "Excel spreadsheet created.",
                "session_id": session_id
            }

        elif doc_type == "powerpoint":
            return {
                "goal": message,
                "message": f"Creating PowerPoint presentation about '{topic}' in {location_hint or 'Desktop'}.",
                "strategy": "protocol",
                "protocol_id": "presentation.generate_ppt",
                "capability": "generate_ppt",
                "parameters": {"topic": topic, "title": title, "save_path": loc},
                "tasks": [{
                    "id": 1,
                    "description": f"Generate PowerPoint: {title}",
                    "protocol_id": "presentation.generate_ppt",
                    "capability": "generate_ppt",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": "generate_ppt",
                        "parameters": {"topic": topic, "title": title, "save_path": loc}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "low",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": "PowerPoint presentation created.",
                "session_id": session_id
            }

        elif doc_type == "text":
            # Generate outline/content locally
            content = f"{title}\n{'='*len(title)}\n\n"
            if topic:
                system_prompt = "You are a helpful assistant. Generate structured text document content for the given topic. Return ONLY the document content, no preamble, no markdown formatting."
                generated = await call_qwen_local(system_prompt, f"Topic: {topic}", max_tokens=1000)
                if generated:
                    content += generated
            
            return {
                "goal": message,
                "message": f"Creating Text document about '{topic}' at {filepath}.",
                "strategy": "protocol",
                "protocol_id": "filesystem.search_and_open",
                "capability": "file_search",
                "parameters": {},
                "tasks": [{
                    "id": 1,
                    "description": f"Create text file: {title}",
                    "protocol_id": None,
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [
                        {
                            "name": "create_file",
                            "parameters": {"file_path": filepath, "content": content}
                        },
                        {
                            "name": "open_path",
                            "parameters": {"path": filepath}
                        }
                    ],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "low",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": "Text file created and opened.",
                "session_id": session_id
            }

    # 5. DELETE OPERATION
    elif operation == "delete":
        loc = resolve_location(location_hint, home)
        filepath = None
        if loc:
            match = find_in_dir(loc, target_name, target_type, recursive=False)
            if not match:
                match = find_in_dir(loc, target_name, target_type, recursive=True, max_depth=2)
            if match:
                filepath = match["path"]
        else:
            matches = search_default_roots(target_name, target_type, max_results=5, user_home=home)
            if len(matches) == 1:
                filepath = matches[0]["path"]
            elif len(matches) > 1:
                return {
                    "goal": message,
                    "message": f"Found multiple matching files for '{target_name}'. Please be more specific about which one to delete.",
                    "strategy": "chat",
                    "protocol_id": None,
                    "capability": None,
                    "parameters": {},
                    "tasks": [],
                    "session_id": session_id
                }

        if filepath:
            return {
                "goal": message,
                "message": f"Deleting file at {filepath}.",
                "strategy": "protocol",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [{
                    "id": 1,
                    "description": f"Delete '{os.path.basename(filepath)}'",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": "delete_file",
                        "parameters": {"file_path": filepath}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "high",
                    "requires_confirmation": True
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": True,
                "expected_result": "File deleted.",
                "session_id": session_id
            }
        return {
            "goal": message,
            "message": f"Could not find '{target_name}' to delete.",
            "strategy": "chat",
            "protocol_id": None,
            "capability": None,
            "parameters": {},
            "tasks": [],
            "session_id": session_id
        }

    # 6. RENAME OPERATION
    elif operation == "rename":
        new_name = parsed.get("new_name")
        if not new_name:
            return {
                "goal": message,
                "message": "What should be the new name for the file/folder?",
                "strategy": "ask_user",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [],
                "session_id": session_id
            }
            
        loc = resolve_location(location_hint, home)
        old_path = None
        if loc:
            match = find_in_dir(loc, target_name, target_type, recursive=False)
            if match:
                old_path = match["path"]
        else:
            matches = search_default_roots(target_name, target_type, max_results=5, user_home=home)
            if len(matches) == 1:
                old_path = matches[0]["path"]

        if old_path:
            return {
                "goal": message,
                "message": f"Renaming '{os.path.basename(old_path)}' to '{new_name}'.",
                "strategy": "protocol",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [{
                    "id": 1,
                    "description": f"Rename to '{new_name}'",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": "rename_file",
                        "parameters": {"old_path": old_path, "new_name": new_name}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "medium",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": "File renamed.",
                "session_id": session_id
            }
        return {
            "goal": message,
            "message": f"Could not find '{target_name}' to rename.",
            "strategy": "chat",
            "protocol_id": None,
            "capability": None,
            "parameters": {},
            "tasks": [],
            "session_id": session_id
        }

    # 7. MOVE/COPY OPERATIONS
    elif operation in ("move", "copy"):
        source = parsed.get("source") or target_name
        destination = parsed.get("destination") or location_hint
        
        if not source or not destination:
            return {
                "goal": message,
                "message": f"I parsed a {operation} request, but need both a source file and a destination directory.",
                "strategy": "chat",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [],
                "session_id": session_id
            }

        # Resolve source path
        src_path = None
        # Check if source is absolute path
        if os.path.isabs(source) and os.path.exists(source):
            src_path = source
        else:
            matches = search_default_roots(source, "any", max_results=5, user_home=home)
            if len(matches) == 1:
                src_path = matches[0]["path"]

        # Resolve destination path
        dest_path = resolve_location(destination, home)
        if not dest_path and os.path.isabs(destination):
            dest_path = destination

        if src_path and dest_path:
            dest_file_path = os.path.join(dest_path, os.path.basename(src_path))
            action_name = "move_file" if operation == "move" else "copy_file"
            return {
                "goal": message,
                "message": f"{operation.title()}ing '{os.path.basename(src_path)}' to '{dest_path}'.",
                "strategy": "protocol",
                "protocol_id": None,
                "capability": None,
                "parameters": {},
                "tasks": [{
                    "id": 1,
                    "description": f"{operation.title()} to '{dest_path}'",
                    "needs_input": False,
                    "input_fields": [],
                    "actions": [{
                        "name": action_name,
                        "parameters": {"source": src_path, "destination": dest_file_path}
                    }],
                    "dependsOn": None,
                    "depends_on": [],
                    "parallel": False,
                    "risk": "medium",
                    "requires_confirmation": False
                }],
                "fallbacks": ["ask_user"],
                "requires_confirmation": False,
                "expected_result": f"File {operation}d.",
                "session_id": session_id
            }

        return {
            "goal": message,
            "message": f"Could not perform {operation}: " + 
                       (f"Source '{source}' not found. " if not src_path else "") +
                       (f"Destination '{destination}' not resolved. " if not dest_path else ""),
            "strategy": "chat",
            "protocol_id": None,
            "capability": None,
            "parameters": {},
            "tasks": [],
            "session_id": session_id
        }

    # DEFAULT FALLBACK
    return {
        "goal": message,
        "message": "I understood the OS command but could not determine how to run it safely.",
        "strategy": "chat",
        "protocol_id": None,
        "capability": None,
        "parameters": {},
        "tasks": [],
        "session_id": session_id
    }
