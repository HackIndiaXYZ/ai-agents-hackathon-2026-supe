"""
Pecifics AI Desktop Assistant — LangGraph Backend
=====================================================
Architecture:
  Brain 1: Groq Llama-3.3-70b  → Plans tasks, splits multi-step prompts
  Brain 2: CogAgent (Kaggle)    → Vision agent: screenshot → coordinates → actions

Quick start:
  1. Set GROQ_API_KEY in .env (free: https://console.groq.com)
  2. Set COGAGENT_URL in .env (from Kaggle notebook ngrok URL)
  3. python langchain_backend.py
"""

import os, re, json, base64, logging, traceback, gc, httpx, time, sqlite3, uuid, asyncio
from io import BytesIO
from typing import Any, Dict, List, Optional
from datetime import datetime
from urllib.parse import quote_plus

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ─── ENV ─────────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv; load_dotenv()
except ImportError:
    pass

GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL      = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
COGAGENT_URL    = os.getenv("COGAGENT_URL", "")
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL    = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
OLLAMA_URL      = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_TIMEOUT  = float(os.getenv("OLLAMA_TIMEOUT", "20"))
PROTOCOL_GROQ_FALLBACK = os.getenv("PROTOCOL_GROQ_FALLBACK", "complex").lower()
MAX_RETRIES     = int(os.getenv("MAX_RETRIES", "3"))
BASE_DIR        = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR        = os.path.dirname(BASE_DIR)
PROTOCOLS_DIR   = os.path.join(ROOT_DIR, "protocols")
MEMORY_DIR      = os.path.join(BASE_DIR, "memory_store")
SESSIONS_DB     = os.path.join(MEMORY_DIR, "sessions.db")
USER_PROFILE_FILE = os.path.join(MEMORY_DIR, "user_profile.json")
CHROMA_DIR      = os.path.join(MEMORY_DIR, "chromadb")
PENDING_PROTOCOLS_FILE = os.path.join(MEMORY_DIR, "pending_protocols.json")
FLORENCE_MODEL  = os.getenv("FLORENCE_MODEL", "microsoft/Florence-2-base")
os.makedirs(MEMORY_DIR, exist_ok=True)

import pathlib as _pathlib
_USER_HOME = str(_pathlib.Path.home()).replace("\\", "\\\\")
_USER_NAME = _pathlib.Path.home().name

# ─── DEPS ────────────────────────────────────────────────────────────────────
HAS_GROQ = False
HAS_GEMINI = False
HAS_CHROMA = False
HAS_LANGGRAPH = False

try:
    from langchain_groq import ChatGroq; HAS_GROQ = True
except ImportError: pass

try:
    import google.generativeai as genai; HAS_GEMINI = True
except ImportError: pass

try:
    import chromadb; HAS_CHROMA = True
except ImportError: pass

try:
    from langgraph.graph import StateGraph, END; HAS_LANGGRAPH = True
except ImportError: pass

from langchain_core.messages import HumanMessage
from protocol_learner import ProtocolLearner

protocol_learner = ProtocolLearner(PROTOCOLS_DIR, PENDING_PROTOCOLS_FILE)

# ─── REQUEST MODELS ──────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message:              str
    screenshot:           Optional[str] = None
    conversation_history: Optional[List[Dict]] = []
    screen_width:         Optional[int] = 1920
    screen_height:        Optional[int] = 1080
    user_choice:          Optional[Dict] = None
    session_id:           Optional[str] = None
    user_home:            Optional[str] = None

class VisionActRequest(BaseModel):
    screenshot:        str
    goal:              str
    step_history:      List[Dict] = []
    screen_width:      Optional[int] = 1920
    screen_height:     Optional[int] = 1080
    cogagent_url:      Optional[str] = None

class VerifyRequest(BaseModel):
    screenshot:      str
    task:            str
    expected_result: Optional[str] = ""

class RouterResult(BaseModel):
    engine: str
    confidence: float
    app_name: Optional[str]
    operation: str
    params: dict
    fallback_engine: str

class NextStepRequest(BaseModel):
    original_task:     str
    last_action:       Dict
    last_result:       Dict
    screenshot:        Optional[str] = None
    remaining_actions: List[Dict] = []
    completed_actions: List[Dict] = []

class GeneratePPTRequest(BaseModel):
    topic:                   str
    title:                   Optional[str] = None
    num_slides:              int = 5
    theme:                   str = "gamma_modern"
    save_path:               str = "Desktop"
    additional_instructions: Optional[str] = None

class AnalyzeScreenRequest(BaseModel):
    screenshot: Optional[str] = None
    question:   Optional[str] = "What do you see on screen?"

class BrowserStateRequest(BaseModel):
    screenshot: str = ""

class StoreRecipeRequest(BaseModel):
    task:    str
    actions: List[Dict] = []
    result:  Optional[Dict] = None

class QueryRecipeRequest(BaseModel):
    task: str
    max_distance: float = 0.25

class ProtocolRunRequest(BaseModel):
    command: str
    protocol_id: Optional[str] = None
    success: bool
    task_id: Optional[int] = None
    extracted_parameters: Optional[Dict[str, Any]] = None
    step_results: Optional[List[Dict[str, Any]]] = []
    fallback_path: Optional[List[str]] = []
    blockers_encountered: Optional[List[str]] = []
    blockers_resolved: Optional[List[str]] = []
    resolution_path: Optional[List[str]] = []
    duration_ms: Optional[int] = None
    command_template: Optional[str] = None
    error: Optional[str] = None

class DraftProtocolRequest(BaseModel):
    command: str
    goal: Optional[str] = None
    app: Optional[str] = None
    trace: List[Dict[str, Any]] = []
    success: bool = False

class ProtocolPlanRequest(BaseModel):
    message: str
    available_protocols: Optional[List[Dict[str, Any]]] = None
    user_profile: Optional[Dict[str, Any]] = None
    recent_memory: Optional[List[Dict[str, Any]]] = None
    app_state: Optional[Dict[str, Any]] = None
    browser_state: Optional[Dict[str, Any]] = None
    conversation_history: Optional[List[Dict[str, Any]]] = []
    session_id: Optional[str] = None
    user_home: Optional[str] = None

class FormAnswerRequest(BaseModel):
    questions: List[Dict[str, Any]]
    user_context: Optional[str] = ""
    user_profile: Optional[Dict[str, Any]] = None
    command: Optional[str] = ""

class ReactStepRequest(BaseModel):
    goal: str
    step_num: int = 1
    max_steps: int = 10
    history: Optional[List[Dict[str, Any]]] = []
    current_state: Optional[Dict[str, Any]] = {}
    session_id: Optional[str] = None
    user_profile: Optional[Dict[str, Any]] = None

class ReactRunLearnRequest(BaseModel):
    goal: str
    history: List[Dict[str, Any]] = []
    success: bool = False
    session_id: Optional[str] = None

class CancelTaskRequest(BaseModel):
    task_id: str

class VoiceStateRequest(BaseModel):
    state: str
    text: Optional[str] = None
    command: Optional[str] = None

class ResultDataPayload(BaseModel):
    session_id: Optional[str] = None
    command: Optional[str] = ""
    data: Dict[str, Any] = {}

# ─── ACTION CATALOG ──────────────────────────────────────────────────────────

def _db():
    conn = sqlite3.connect(SESSIONS_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS result_context (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            command TEXT,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    conn.commit()
    return conn

def load_session_messages(session_id: str, limit: int = 20) -> List[Dict]:
    if not session_id:
        return []
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?",
            (session_id, limit)
        ).fetchall()
        return [{"role": role, "content": content} for role, content in reversed(rows)]
    finally:
        conn.close()

def save_session_message(session_id: str, role: str, content: str):
    if not session_id or not content:
        return
    conn = _db()
    try:
        conn.execute(
            "INSERT INTO messages(session_id, role, content, created_at) VALUES(?,?,?,?)",
            (session_id, role, content, datetime.now().isoformat())
        )
        conn.commit()
    finally:
        conn.close()

def store_result_context(session_id: str, data: Dict[str, Any], command: str = ""):
    if not session_id or not isinstance(data, dict) or not data:
        return
    conn = _db()
    try:
        conn.execute(
            "INSERT INTO result_context(session_id, command, data_json, created_at) VALUES(?,?,?,?)",
            (session_id, command or "", json.dumps(data, ensure_ascii=True), datetime.now().isoformat())
        )
        conn.commit()
    finally:
        conn.close()

def load_recent_result_context(session_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    if not session_id:
        return []
    conn = _db()
    try:
        rows = conn.execute(
            "SELECT command, data_json, created_at FROM result_context WHERE session_id=? ORDER BY id DESC LIMIT ?",
            (session_id, limit)
        ).fetchall()
    finally:
        conn.close()
    results = []
    for command, data_json, created_at in rows:
        try:
            data = json.loads(data_json)
        except Exception:
            continue
        results.append({"command": command or "", "data": data, "created_at": created_at})
    return results

def load_user_profile() -> Dict:
    default_profile = {
        "personal": {
            "full_name": "",
            "email": "",
            "phone": "",
            "college": "",
            "degree": "",
            "year": "",
            "skills": [],
            "interests": [],
        },
        "frequent_contacts": {},
        "file_preferences": {},
        "app_preferences": {},
        "system_preferences": {},
        "recurring_tasks": [],
        "notes": [],
    }
    if not os.path.exists(USER_PROFILE_FILE):
        profile = default_profile
        with open(USER_PROFILE_FILE, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2)
        return profile
    try:
        with open(USER_PROFILE_FILE, "r", encoding="utf-8") as f:
            profile = json.load(f)
        changed = False
        for key, value in default_profile.items():
            if key not in profile:
                profile[key] = value
                changed = True
        if changed:
            save_user_profile(profile)
        return profile
    except Exception:
        return default_profile

def save_user_profile(profile: Dict):
    with open(USER_PROFILE_FILE, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)


# ─── 2.1 DEBUG STORE ─────────────────────────────────────────────────────────
# Tracks the last plan input for /debug/last_plan_input endpoint
debug_store: Dict[str, Any] = {
    "last_raw": None,
    "last_enriched": None,
    "last_context": None,
    "recipe_queries": 0,
    "recipes_applied": 0,
    "last_recipe_retrieved": None,
    "last_recipe_applied": None,
}


# ─── 6.2 PROFILE AUTO-ENRICHMENT ─────────────────────────────────────────────
async def enrich_profile_from_run(protocol_id: str, params: Dict[str, Any], profile: Dict) -> Dict:
    """After a successful task, auto-update frequent contacts, apps, and tasks."""
    try:
        updated = False
        contact = params.get("contact") or params.get("to")
        if contact and protocol_id in ("whatsapp.send_message", "telegram.send_message", "gmail.compose"):
            contacts = profile.setdefault("frequent_contacts", {})
            entry = contacts.setdefault(str(contact), {"count": 0, "apps": []})
            entry["count"] = entry.get("count", 0) + 1
            if protocol_id not in entry.get("apps", []):
                entry.setdefault("apps", []).append(protocol_id)
            updated = True
        app_key = protocol_id.split(".")[0]
        apps = profile.setdefault("frequent_apps", {})
        apps[app_key] = apps.get(app_key, 0) + 1
        tasks = profile.setdefault("frequent_tasks", {})
        tasks[protocol_id] = tasks.get(protocol_id, 0) + 1
        updated = True
        if updated:
            save_user_profile(profile)
    except Exception as e:
        logger.warning(f"enrich_profile_from_run error: {e}")
    return profile


_protocol_cache: Optional[Dict[str, Dict[str, Any]]] = None

def load_protocols(force: bool = False) -> Dict[str, Dict[str, Any]]:
    """Load JSON protocol contracts from the repository-level protocols folder."""
    global _protocol_cache
    if _protocol_cache is not None and not force:
        return _protocol_cache

    protocols: Dict[str, Dict[str, Any]] = {}
    if not os.path.isdir(PROTOCOLS_DIR):
        _protocol_cache = protocols
        return protocols

    for name in sorted(os.listdir(PROTOCOLS_DIR)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(PROTOCOLS_DIR, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                protocol = json.load(f)
            protocol_id = protocol.get("id") or os.path.splitext(name)[0]
            if not protocol_id or "steps" not in protocol:
                logger.warning(f"Skipping invalid protocol: {path}")
                continue
            protocol["id"] = protocol_id
            protocol["_path"] = path
            protocols[protocol_id] = protocol
        except Exception as e:
            logger.warning(f"Could not load protocol {path}: {e}")

    _protocol_cache = protocols
    return protocols

def protocol_summaries() -> List[Dict[str, Any]]:
    summaries = []
    for protocol in load_protocols().values():
        summaries.append({
            "id": protocol.get("id"),
            "domain": protocol.get("domain"),
            "capability": protocol.get("capability"),
            "description": protocol.get("description"),
            "risk": protocol.get("risk", "low"),
            "requires_confirmation": bool(protocol.get("requires_confirmation", False)),
            "parameters": protocol.get("parameters", {}),
            "fallbacks": protocol.get("fallbacks", []),
        })
    return summaries

def _render_template_value(value: Any, params: Dict[str, Any]) -> Any:
    if isinstance(value, str):
        full = re.fullmatch(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", value)
        if full:
            return params.get(full.group(1))
        def repl(match):
            replacement = params.get(match.group(1), "")
            return "" if replacement is None else str(replacement)
        return re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", repl, value)
    if isinstance(value, list):
        return [_render_template_value(v, params) for v in value]
    if isinstance(value, dict):
        return {k: _render_template_value(v, params) for k, v in value.items()}
    return value

def protocol_to_actions(protocol_id: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    protocol = load_protocols().get(protocol_id)
    if not protocol:
        return []
    actions = []
    for step in protocol.get("steps", []):
        action_name = step.get("action") or step.get("primitive")
        if not action_name:
            continue
        actions.append({
            "name": action_name,
            "parameters": _render_template_value(step.get("parameters", {}), params),
            "protocol_step_id": step.get("id"),
            "primitive": step.get("primitive"),
        })
    return actions

def _protocol_plan(
    *,
    message: str,
    protocol_id: str,
    params: Dict[str, Any],
    description: str,
    goal: Optional[str] = None,
    depends_on: Optional[List[int]] = None,
    risk: Optional[str] = None,
    requires_confirmation: Optional[bool] = None,
    strategy: str = "protocol",
    task_id: int = 1,
) -> Dict[str, Any]:
    protocol = load_protocols().get(protocol_id, {})
    resolved_risk = risk or protocol.get("risk", "low")
    resolved_confirmation = protocol.get("requires_confirmation", False) if requires_confirmation is None else requires_confirmation
    actions = protocol_to_actions(protocol_id, params)
    result = {
        "goal": goal or message,
        "message": description,
        "strategy": strategy,
        "protocol_id": protocol_id,
        "capability": protocol.get("capability"),
        "parameters": params,
        "tasks": [{
            "id": task_id,
            "description": description,
            "protocol_id": protocol_id,
            "capability": protocol.get("capability"),
            "needs_input": False,
            "input_fields": [],
            "actions": actions,
            "dependsOn": None if not depends_on else depends_on,
            "depends_on": [] if not depends_on else depends_on,
            "parallel": False,
            "risk": resolved_risk,
            "requires_confirmation": resolved_confirmation,
            "fallbacks": protocol.get("fallbacks", []),
            "verification": protocol.get("verification", []),
        }],
        "fallbacks": protocol.get("fallbacks", []),
        "requires_confirmation": resolved_confirmation,
        "expected_result": "",
        "protocol_version": protocol.get("version"),
    }
    try:
        memory_hint = query_protocol_run_memory(message, protocol_id)
        if memory_hint:
            result["protocol_memory_hint"] = memory_hint
            result["tasks"][0]["memory_hint"] = {
                "blockers_encountered": memory_hint.get("blockers_encountered", []),
                "blockers_resolved": memory_hint.get("blockers_resolved", []),
                "resolution_path": memory_hint.get("resolution_path", []),
                "duration_ms": memory_hint.get("duration_ms", 0),
            }
    except Exception:
        pass
    return result

def _friendly_location_to_path(location: str, name: str, user_home: Optional[str]) -> str:
    home = user_home or str(_pathlib.Path.home())
    loc = (location or "Desktop").strip().strip('"\'')
    folder_name = re.sub(r'[\\/:*?"<>|]', "_", (name or "New Folder").strip()) or "New Folder"
    low = loc.lower()
    if low in ("desktop", "on desktop", "the desktop"):
        return os.path.join(_desktop_path_for_home(home), folder_name)
    if low in ("documents", "document", "my documents"):
        return os.path.join(home, "Documents", folder_name)
    if low in ("downloads", "download"):
        return os.path.join(home, "Downloads", folder_name)
    if os.path.isabs(loc):
        return os.path.join(loc, folder_name)
    return os.path.join(home, "Desktop", folder_name)

def _desktop_path_for_home(home: str) -> str:
    candidates = [
        os.path.join(home, "OneDrive", "Desktop"),
        os.path.join(home, "Desktop"),
    ]
    return next((p for p in candidates if os.path.isdir(p)), candidates[-1])

def _pictures_path_for_home(home: str) -> str:
    candidates = [
        os.path.join(home, "OneDrive", "Pictures"),
        os.path.join(home, "Pictures"),
    ]
    return next((p for p in candidates if os.path.isdir(p)), candidates[-1])

def _topic_from_presentation_text(text: str) -> str:
    raw = re.sub(r"\s+", " ", text or "").strip()
    patterns = [
        r"\b(?:ppt|presentation|slides|deck)\s+for\s+me\s+(?:on|about)\s+(.+)$",
        r"\b(?:ppt|presentation|slides|deck)\s+(?:for|on|about)\s+(.+)$",
        r"\b(?:on|about)\s+(.+)$",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw, flags=re.I)
        if m and m.group(1).strip():
            return m.group(1).strip(" \"'`")
    cleaned = re.sub(r"\b(?:open|chrome|go|to|gam{1,4}a(?:\.app)?|create|make|generate|build|a|an|ppt|presentation|slides|deck|for|me|please|login|with|google|account)\b", " ", raw, flags=re.I)
    return re.sub(r"\s+", " ", cleaned).strip(" \"'`") or "Presentation"

def _mentions_gamma(raw: str) -> bool:
    return bool(re.search(r"\bgam{1,4}a(?:\.app)?\b", raw or "", flags=re.I))

def _extract_youtube_query(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw or "").strip()
    text = re.sub(r"\b(?:please|open|go\s+to|search|find|play|watch|show|youtube|you\s*tube|on|from|in|any|video|scene)\b", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip(" \"'`") or "video"

def _extract_spotify_query(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw or "").strip()
    text = re.sub(r"\b(?:please|open|launch|start|play|put\s+on|listen\s+to|spotify|music|song|track|playlist|album|on|from|in)\b", " ", text, flags=re.I)
    text = re.sub(r"\b(?:some|any)\s+music\b", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip(" \"'`")

def _extract_search_query(raw: str) -> str:
    text = re.sub(r"\s+", " ", raw or "").strip()
    m = re.search(r"\bsearch\s+(?:google|web|internet)\s+(?:for\s+)?(.+)$", text, flags=re.I)
    if not m:
        m = re.search(r"\b(?:search|google|look up|find)\s+(?:web\s+)?(?:for\s+)?(.+)$", text, flags=re.I)
    query = m.group(1) if m else text
    query = re.sub(r"\b(?:on|in)\s+(?:google|web|internet)$", "", query, flags=re.I)
    return query.strip(" \"'`") or "search"

SITE_SHORTCUTS = {
    "amazon": "https://www.amazon.in",
    "amazon.in": "https://www.amazon.in",
    "amazon.com": "https://www.amazon.com",
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "google": "https://www.google.com",
    "gamma": "https://gamma.app",
    "gamma.app": "https://gamma.app",
    "github": "https://github.com",
    "linkedin": "https://www.linkedin.com",
    "twitter": "https://www.x.com",
    "x": "https://www.x.com",
    "instagram": "https://www.instagram.com",
    "reddit": "https://www.reddit.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
    "flipkart": "https://www.flipkart.com",
    "myntra": "https://www.myntra.com",
}

def resolve_url(raw: str) -> str:
    target = re.sub(r"\s+", "", str(raw or "").strip().strip(" \"'`").lower()).rstrip(".")
    target = target.replace("amaazon", "amazon").replace("gogle", "google")
    if not target:
        return ""
    if re.match(r"^https?://", target):
        return target
    if target in SITE_SHORTCUTS:
        return SITE_SHORTCUTS[target]
    if "." in target:
        return f"https://{target}" if target.startswith("www.") else f"https://www.{target}"
    return f"https://www.{target}.com"

def _site_search_url(site: str, query: str) -> Optional[str]:
    site_key = re.sub(r"^www\.", "", str(site or "").lower().strip())
    q = quote_plus(str(query or "").strip())
    if not site_key or not q:
        return None
    if site_key in ("amazon", "amazon.in"):
        return f"https://www.amazon.in/s?k={q}"
    if site_key == "amazon.com":
        return f"https://www.amazon.com/s?k={q}"
    if site_key in ("flipkart", "flipkart.com"):
        return f"https://www.flipkart.com/search?q={q}"
    if site_key in ("myntra", "myntra.com"):
        return f"https://www.myntra.com/{q}"
    if site_key in ("youtube", "youtube.com"):
        return f"https://www.youtube.com/results?search_query={q}"
    if site_key in ("google", "google.com"):
        return f"https://www.google.com/search?q={q}"
    return None

def _site_search_plan(message: str) -> Optional[Dict[str, Any]]:
    raw = re.sub(r"\s+", " ", message or "").strip()
    lower = raw.lower()
    if not re.search(r"\b(search|find|look\s+for)\b", lower):
        return None
    target = _extract_navigation_target(raw)
    if not target:
        return None
    url = resolve_url(target)
    try:
        site = re.sub(r"^www\.", "", httpx.URL(url).host or target)
    except Exception:
        site = target
    query = _extract_search_query(raw)
    query = re.sub(r"\s+(?:on|in|at)\s+(?:amazon(?:\.in|\.com)?|flipkart|myntra|youtube|google).*$", "", query, flags=re.I)
    query = re.sub(r"^\s*(?:for\s+)?", "", query, flags=re.I).strip(" \"'`")
    search_url = _site_search_url(site, query)
    if not search_url:
        return None
    return {
        "goal": raw,
        "message": f"Searching {site} for: {query}",
        "strategy": "protocol",
        "protocol_id": "browser.navigate",
        "capability": "site_search",
        "parameters": {"url": search_url, "login": False, "login_method": None, "site": site, "query": query},
        "tasks": [{
            "id": 1,
            "description": f"Search {site}: {query}",
            "protocol_id": "browser.navigate",
            "capability": "site_search",
            "needs_input": False,
            "input_fields": [],
            "actions": [{
                "name": "navigate_and_login",
                "parameters": {"url": search_url, "login": False, "login_method": None, "site": site, "query": query},
                "protocol_step_id": "site_search",
                "primitive": "browser_dom",
            }],
            "dependsOn": None,
            "depends_on": [],
            "parallel": False,
            "risk": "low",
            "requires_confirmation": False,
            "fallbacks": ["browser_probe_state", "ask_user"],
            "verification": ["search_results_page_opened"],
        }],
        "fallbacks": ["browser_probe_state", "ask_user"],
        "requires_confirmation": False,
        "expected_result": f"{site} search results opened for {query}.",
        "planner_model": "deterministic-site-search",
    }

def _extract_navigation_target(raw: str) -> Optional[str]:
    text = re.sub(r"\s+", " ", raw or "").strip()
    patterns = [
        r"\b(?:open|launch|start)\s+chrome\s+(?:and\s+)?(?:go to|open|visit)?\s*([a-zA-Z0-9][a-zA-Z0-9\-\.]*)",
        r"\b(?:go to|open|visit|navigate to|browse to|take me to)\s+(?:chrome\s+(?:and\s+)?)?([a-zA-Z0-9][a-zA-Z0-9\-\.]*)",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, flags=re.I)
        if m:
            target = m.group(1).strip(" \"'`")
            if target.lower() not in ("chrome", "browser"):
                return target
    return None

def _navigation_login_method(raw: str) -> Optional[str]:
    lower = str(raw or "").lower()
    if not re.search(r"\b(?:login|log in|sign in|signin|using my|with my)\b", lower):
        return None
    if re.search(r"\b(?:google|gmail|gogle|gamil)\b", lower):
        return "google_oauth"
    if re.search(r"\b(?:saved|credential|account)\b", lower):
        return "saved_credentials"
    return "site_default"

def _continuation_login_plan(message: str, session_id: str, frontend_history: Optional[List[Dict[str, Any]]] = None, user_home: Optional[str] = None) -> Optional[Dict[str, Any]]:
    lower = str(message or "").lower().strip()
    if not re.search(r"^(?:also\s+|and\s+also\s+|now\s+|then\s+|next\s+)?(?:login|log in|sign in|signin)\b", lower):
        return None
    history = (load_session_messages(session_id, limit=12) if session_id else []) + (frontend_history or [])
    url = None
    for item in reversed(history):
        content = item.get("content") or ""
        m = re.search(r"https?://[^\s\"'<>]+", content)
        if m:
            url = m.group(0).rstrip(".,)")
            break
    if not url:
        return None
    method = _navigation_login_method(message) or "site_default"
    site = ""
    try:
        site = re.sub(r"^www\.", "", httpx.URL(url).host or "")
    except Exception:
        site = ""
    return _protocol_plan(
        message=message,
        protocol_id="browser.navigate",
        params={"url": url, "login": True, "login_method": method, "site": site},
        description=f"Continue on {site or url} and attempt login",
        requires_confirmation=False,
    )

def _result_item_name(item: Dict[str, Any]) -> str:
    return str(item.get("name") or item.get("Name") or os.path.basename(str(item.get("path") or item.get("Path") or "")) or "Item")

def _result_item_path(item: Dict[str, Any]) -> str:
    return str(item.get("path") or item.get("Path") or item.get("fullPath") or item.get("FullPath") or "")

def _is_folder_item(item: Dict[str, Any]) -> bool:
    value = str(item.get("type") or item.get("Type") or "").lower()
    path_value = _result_item_path(item)
    return value == "folder" or bool(path_value and os.path.isdir(path_value))

def _dedupe_targets(items: List[Dict[str, Any]], max_items: int = 5) -> List[Dict[str, Any]]:
    seen = set()
    targets = []
    for item in items:
        path_value = _result_item_path(item)
        if not path_value:
            continue
        key = os.path.normcase(os.path.normpath(path_value))
        if key in seen:
            continue
        seen.add(key)
        targets.append({
            "name": _result_item_name(item),
            "path": path_value,
            "type": "folder" if _is_folder_item(item) else "file",
        })
        if len(targets) >= max_items:
            break
    return targets

def _file_search_targets_from_context(data: Dict[str, Any], message: str) -> List[Dict[str, Any]]:
    lower = str(message or "").lower()
    wants_folders = bool(re.search(r"\bfolders?\b|\bdirectories\b", lower))
    wants_files = bool(re.search(r"\bfiles?\b", lower)) and not wants_folders
    wants_all = bool(re.search(r"\b(both|all|them|those|results?|what you found)\b", lower))
    wants_latest_screenshots = bool(re.search(r"\bscreenshots?\b", lower))

    groups = data.get("groups") if isinstance(data.get("groups"), list) else []
    flat_items = data.get("items") if isinstance(data.get("items"), list) else []
    candidates: List[Dict[str, Any]] = []

    if wants_folders:
        if groups:
            # For result references like "open both folders", map each previous
            # search group to one meaningful folder. This prevents opening
            # every nested dependency folder found under the LAM project.
            for group in groups:
                location = str(group.get("location") or "")
                pattern = str(group.get("pattern") or "")
                group_items = [item for item in (group.get("items") or []) if isinstance(item, dict)]
                first_folder = next((item for item in group_items if _is_folder_item(item)), None)
                if first_folder:
                    candidates.append(first_folder)
                elif location:
                    candidates.append({"name": os.path.basename(location.rstrip("\\/")) or location, "path": location, "type": "folder"})
        else:
            for item in flat_items:
                if _is_folder_item(item):
                    candidates.append(item)
    elif wants_files:
        candidates = [item for item in flat_items if not _is_folder_item(item)]
    else:
        candidates = flat_items

    if not candidates and groups:
        for group in groups:
            candidates.extend(group.get("items") or [])

    return _dedupe_targets(candidates, max_items=5 if wants_all else 3)

def _continuation_result_plan(message: str, session_id: str) -> Optional[Dict[str, Any]]:
    lower = str(message or "").lower().strip()
    if not re.search(r"\b(open|show|display|reveal)\b", lower):
        return None
    if not re.search(r"\b(both|them|those|these|all|results?|folders?|files?|what you found|latest screenshots?)\b", lower):
        return None

    for entry in load_recent_result_context(session_id, limit=5):
        data = entry.get("data") or {}
        if data.get("type") != "file_search":
            continue
        targets = _file_search_targets_from_context(data, message)
        if not targets:
            continue
        actions = [{"name": "open_path", "parameters": {"path": target["path"]}} for target in targets]
        description = "Open " + ", ".join(target["name"] for target in targets[:4])
        return {
            "goal": message,
            "message": description,
            "strategy": "protocol",
            "protocol_id": None,
            "capability": "open_previous_results",
            "parameters": {"targets": targets},
            "tasks": [{
                "id": 1,
                "description": description,
                "protocol_id": None,
                "capability": "open_previous_results",
                "needs_input": False,
                "input_fields": [],
                "actions": actions,
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "low",
                "requires_confirmation": False,
                "fallbacks": ["ask_user"],
                "verification": ["paths_opened"],
            }],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "Requested previous result paths are opened in Explorer/default apps.",
            "planner_model": "result-context-continuation",
        }
    return None

def _parse_inferred_message_command(raw: str) -> Optional[Dict[str, str]]:
    text = re.sub(r"\s+", " ", raw or "").strip()
    if not re.search(r"^(?:please\s+)?(?:(?:shoot|send|write)\s+(?:a\s+)?(?:msg|message|text|dm)|msg|message|send|text|tell|dm)\b", text, flags=re.I):
        return None
    if re.search(r"\b(?:whatsapp|whats app|telegram|gmail|email|sms)\b", text, flags=re.I):
        return None

    quoted = re.search(r'["\']([^"\']+)["\']\s*$', text)
    if quoted:
        message = quoted.group(1).strip()
        before = text[:quoted.start()].strip()
        before = re.sub(r"^(?:please\s+)?(?:(?:shoot|send|write)\s+(?:a\s+)?(?:msg|message|text|dm)|msg|message|send|text|tell|dm)\s+(?:to\s+)?", "", before, flags=re.I)
        contact = before.strip(" \"'`")
    else:
        direct = re.match(r"^(?:please\s+)?(?:(?:shoot|send|write)\s+(?:a\s+)?(?:msg|message|text|dm)|msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s+(?:saying|that\s+says|that|with\s+(?:the\s+)?message)\s+(.+)$", text, flags=re.I)
        if direct:
            contact = direct.group(1).strip(" \"'`")
            message = direct.group(2).strip(" \"'`")
            if contact and message:
                return {"contact": contact, "message": message, "send": True}
        cleaned = re.sub(r"^(?:please\s+)?(?:(?:shoot|send|write)\s+(?:a\s+)?(?:msg|message|text|dm)|msg|message|send|text|tell|dm)\s+(?:to\s+)?", "", text, flags=re.I).strip()
        colon = re.match(r"([^:]+):\s*(.+)$", cleaned)
        if colon:
            contact = colon.group(1).strip(" \"'`")
            message = colon.group(2).strip(" \"'`")
        else:
            said = re.match(r"(.+?)\s+(?:saying|that\s+says|that|with\s+(?:the\s+)?message)\s+(.+)$", cleaned, flags=re.I)
            if said:
                contact = said.group(1).strip(" \"'`")
                message = said.group(2).strip(" \"'`")
            else:
                parts = cleaned.split()
                if len(parts) < 2:
                    return None
                contact = parts[0].strip(" \"'`")
                message = " ".join(parts[1:]).strip(" \"'`")

    if not contact or not message:
        return None
    return {"contact": contact, "message": message, "send": True}

def _clean_messaging_contact(value: str, app_words: str) -> str:
    value = re.sub(r'\b(?:open|launch)\b', ' ', value or '', flags=re.I)
    value = re.sub(app_words, ' ', value, flags=re.I)
    value = re.sub(r'\b(?:and|then|please|for|to|on|via|through|using|with)\b', ' ', value, flags=re.I)
    value = re.sub(r'\b(?:msg|message|send|text|tell|say|write|dm|search|find)\b', ' ', value, flags=re.I)
    value = re.sub(r'\b(?:her|him|them)\b', ' ', value, flags=re.I)
    return re.sub(r'\s+', ' ', value).strip(" \"'`")

def _parse_telegram_message_command(raw: str) -> Optional[Dict[str, Any]]:
    text = re.sub(r"\s+", " ", raw or "").strip()
    lower = text.lower()
    if not re.search(r"\btelegram\b|\btg\b", lower):
        return None
    if not re.search(r"\b(?:msg|message|send|text|tell|say|write|dm)\b", lower):
        return None

    contact = None
    message = None
    quoted = re.search(r'["\']([^"\']+)["\']\s*$', text)
    if quoted:
        message = quoted.group(1).strip()
        before = text[:quoted.start()].strip()
        m = re.search(r'\b(?:search|find)\s+(?:for\s+)?(.+?)\s+(?:and\s+)?(?:msg|message|send|text|tell|dm)\s+(?:her|him|them)?\s*$', before, flags=re.I)
        if not m:
            m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s*$', before, flags=re.I)
        contact = _clean_messaging_contact(m.group(1) if m else before, r'\btelegram\b|\btg\b')
    if not contact:
        m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?([^:]+):\s*(.+)$', text, flags=re.I)
        if m:
            contact = _clean_messaging_contact(m.group(1), r'\btelegram\b|\btg\b')
            message = m.group(2).strip(" \"'`")
    if not contact:
        m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s+\b(?:that|saying)\b\s+(.+)$', text, flags=re.I)
        if m:
            contact = _clean_messaging_contact(m.group(1), r'\btelegram\b|\btg\b')
            message = m.group(2).strip(" \"'`")
    if not contact or not message or len(contact) < 2:
        return None
    return {"contact": contact, "message": message, "send": True}

def _parse_gmail_compose_command(raw: str) -> Optional[Dict[str, Any]]:
    text = re.sub(r"\s+", " ", raw or "").strip()
    lower = text.lower()
    if not re.search(r"\b(?:gmail|email|mail)\b", lower):
        return None
    if not re.search(r"\b(?:send|compose|write|draft|email|mail)\b", lower):
        return None

    email_match = re.search(r"[\w.+-]+@[\w.-]+\.[a-z]{2,}", text, flags=re.I)
    if not email_match:
        return None
    to = email_match.group(0)

    subject = "Message from Pecifics"
    subject_match = re.search(r"\bsubject\s*[:\-]?\s*([^\n,;]+?)(?:\s+\b(?:body|message|saying|that)\b|$)", text, flags=re.I)
    if subject_match and subject_match.group(1).strip():
        subject = subject_match.group(1).strip(" \"'`")

    body = None
    quoted = re.search(r'["\']([^"\']+)["\']\s*$', text)
    if quoted:
        body = quoted.group(1).strip()
    if not body:
        body_match = re.search(r"\b(?:body|message|saying|that)\s*[:\-]?\s*(.+)$", text, flags=re.I)
        if body_match:
            body = body_match.group(1).strip(" \"'`")
    if not body:
        after_email = text[email_match.end():].strip(" ,;:-")
        after_email = re.sub(r"\b(?:with\s+)?subject\s*[:\-]?\s*[^\n,;]+", "", after_email, flags=re.I).strip(" ,;:-")
        if after_email:
            body = after_email

    if not body:
        return None
    body = re.sub(r"\s*,?\s*(?:use\s+any\s+of\s+my\s+gmail\s+account.*|use\s+my\s+gmail\s+account.*)$", "", body, flags=re.I)
    body = re.sub(r"\s*,?\s*(?:and\s+)?(?:send\s+it|send\s+the\s+(?:gmail|email|mail))$", "", body, flags=re.I)
    body = body.strip(" ,;:-\"'`")
    if not body:
        return None
    return {"to": to, "subject": subject, "body": body, "send": True}

def _react_task_plan(message: str, reason: str = "Complex task needs observe-think-act execution") -> Dict[str, Any]:
    return {
        "goal": message,
        "message": "I will handle this as an adaptive step-by-step task.",
        "strategy": "react",
        "protocol_id": None,
        "capability": "adaptive_execution",
        "parameters": {"goal": message, "reason": reason},
        "tasks": [{
            "id": 1,
            "description": "Adaptive ReAct execution",
            "protocol_id": None,
            "capability": "adaptive_execution",
            "needs_input": False,
            "input_fields": [],
            "actions": [{"name": "react_task", "parameters": {"goal": message, "max_steps": 10, "reason": reason}}],
            "dependsOn": None,
            "depends_on": [],
            "parallel": False,
            "risk": "medium",
            "requires_confirmation": False,
            "fallbacks": ["protocol", "browser_dom", "ask_user"],
            "verification": ["probe_after_each_step"],
        }],
        "fallbacks": ["protocol", "browser_dom", "ask_user"],
        "requires_confirmation": False,
        "expected_result": "Task completed through observed step-by-step execution.",
        "planner_model": "react-router",
    }

def _should_use_react_for_command(raw: str) -> bool:
    lower = re.sub(r"\s+", " ", raw or "").lower().strip()
    if not lower:
        return False
    # Known reliable single-protocol flows should stay fast.
    if _parse_gmail_compose_command(raw) or _parse_whatsapp_message_command(raw) or _parse_telegram_message_command(raw):
        return False
    if _mentions_gamma(raw) and re.search(r"\b(ppt|presentation|slides|deck)\b", lower):
        return False
    if ("google form" in lower or "forms.gle" in lower or "docs.google.com/forms" in lower):
        return False
    if re.search(r"\byou\s*tube\b|\byoutube\b", lower) and re.search(r"\b(play|watch|show)\b", lower):
        return False

    target = _extract_navigation_target(raw)
    browser_followup = bool(target and re.search(
        r"\b(search|find|look\s+for|click|select|choose|filter|sort|fill|answer|compare|add\s+to\s+cart|cart|under|less\s+than|below|price)\b",
        lower,
    ))
    sequenced = bool(re.search(r"\b(and then|then|after that|next|continue|continue this|what i was doing)\b", lower))
    multiple_apps = len(re.findall(r"\b(amazon|gmail|gamma|youtube|whatsapp|telegram|google form|chrome|spotify)\b", lower)) >= 2
    return browser_followup or sequenced or multiple_apps

def _known_location_path(label: str, user_home: Optional[str]) -> str:
    home = user_home or str(_pathlib.Path.home())
    low = re.sub(r"\s+", " ", str(label or "")).lower().strip()
    if "desktop" in low:
        return _desktop_path_for_home(home)
    if "download" in low:
        return os.path.join(home, "Downloads")
    if "document" in low:
        return os.path.join(home, "Documents")
    if "picture" in low or "screenshot" in low:
        return _pictures_path_for_home(home)
    return home

def _clean_file_search_pattern(value: str) -> str:
    cleaned = re.sub(r"\b(?:the|my|a|an|folder|folders|file|files|directory|directories|latest|recent|newest)\b", " ", str(value or ""), flags=re.I)
    cleaned = re.sub(r"\b(?:in|on|from|under|inside)\s+(?:my\s+)?(?:desktop|documents|downloads|pictures|computer|pc)\b", " ", cleaned, flags=re.I)
    return re.sub(r"\s+", " ", cleaned).strip(" \"'`")

def _desktop_search_plan(message: str, user_home: Optional[str] = None) -> Optional[Dict[str, Any]]:
    raw = re.sub(r"\s+", " ", message or "").strip()
    lower = raw.lower()
    if not re.search(r"\b(search|find|look\s+for|locate)\b", lower):
        return None
    if not re.search(r"\b(file|files|folder|folders|directory|directories|desktop|documents|downloads|screenshots?|photos?|images?)\b", lower):
        return None
    if re.search(r"\b(google|web|internet|youtube|amazon|gmail|gamma|whatsapp|telegram|spotify)\b", lower):
        return None

    actions: List[Dict[str, Any]] = []
    descriptions: List[str] = []
    primary_location = _known_location_path(raw, user_home)

    # "search for LAM folder in my desktop"
    m = re.search(
        r"\b(?:search|find|look\s+for|locate)\s+(?:for\s+)?(.+?)(?:\s+and\s+also|\s+also|$)",
        raw,
        flags=re.I,
    )
    if m:
        pattern = _clean_file_search_pattern(m.group(1))
        if pattern and not re.fullmatch(r"screenshots?|photos?|images?", pattern, flags=re.I):
            include_folders = bool(re.search(r"\b(folder|folders|directory|directories)\b", m.group(1), flags=re.I))
            actions.append({
                "name": "search_files",
                "parameters": {
                    "pattern": pattern,
                    "location": primary_location,
                    "include_folders": include_folders or True,
                    "max_results": 25,
                }
            })
            descriptions.append(f"Search {primary_location} for {pattern}")

    if re.search(r"\bscreenshots?\b", lower):
        pictures_dir = _pictures_path_for_home(user_home or str(_pathlib.Path.home()))
        screenshot_location = os.path.join(pictures_dir, "Screenshots")
        if not os.path.isdir(screenshot_location):
            screenshot_location = pictures_dir
        actions.append({
            "name": "search_files",
            "parameters": {
                "pattern": "screenshot",
                "location": screenshot_location,
                "include_folders": False,
                "latest": True,
                "max_results": 10,
            }
        })
        descriptions.append(f"Find latest screenshots in {screenshot_location}")

    if not actions:
        return None

    return {
        "goal": raw,
        "message": "Searching your files locally.",
        "strategy": "protocol",
        "protocol_id": None,
        "capability": "desktop_file_search",
        "parameters": {},
        "tasks": [{
            "id": 1,
            "description": "; ".join(descriptions) or "Search local files",
            "protocol_id": None,
            "capability": "desktop_file_search",
            "needs_input": False,
            "input_fields": [],
            "actions": actions,
            "dependsOn": None,
            "depends_on": [],
            "parallel": False,
            "risk": "low",
            "requires_confirmation": False,
            "fallbacks": ["ask_user"],
            "verification": ["file_results_returned"],
        }],
        "fallbacks": ["ask_user"],
        "requires_confirmation": False,
        "expected_result": "Local matching files and folders are listed.",
        "planner_model": "deterministic-desktop-search",
    }

def deterministic_protocol_plan(message: str, user_home: Optional[str] = None) -> Optional[Dict[str, Any]]:
    raw = re.sub(r"\s+", " ", message or "").strip()
    lower = raw.lower()
    protocols = load_protocols()

    if re.search(r"\b(save|store|remember|add)\b", lower) and re.search(r"\bgoogle\b", lower) and re.search(r"\b(account|credentials?|login|password)\b", lower) and "credentials.save_google_account" in protocols:
        protocol = protocols["credentials.save_google_account"]
        return {
            "goal": raw,
            "message": "I can save your Google account in Windows Credential Manager for login recovery.",
            "strategy": "protocol",
            "protocol_id": "credentials.save_google_account",
            "capability": protocol.get("capability"),
            "parameters": {},
            "tasks": [{
                "id": 1,
                "description": "Save Google account credential",
                "protocol_id": "credentials.save_google_account",
                "capability": protocol.get("capability"),
                "needs_input": False,
                "input_fields": [],
                "actions": [{"name": "save_google_credentials", "parameters": {}}],
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "high",
                "requires_confirmation": True,
                "fallbacks": protocol.get("fallbacks", []),
                "verification": protocol.get("verification", []),
            }],
            "fallbacks": protocol.get("fallbacks", []),
            "requires_confirmation": True,
            "expected_result": "Google credential saved in Windows Credential Manager.",
            "protocol_version": protocol.get("version"),
        }

    if re.search(r"\b(?:relaunch|restart|reopen)\s+chrome\b|\bclose\s+and\s+(?:re)?open\s+chrome\b", lower):
        return {
            "goal": raw,
            "message": "Relaunching Chrome with the Pecifics debug bridge.",
            "strategy": "protocol",
            "protocol_id": "system.relaunch_chrome",
            "capability": "relaunch_chrome",
            "parameters": {},
            "tasks": [{
                "id": 1,
                "description": "Relaunch Chrome with remote debugging",
                "protocol_id": "system.relaunch_chrome",
                "capability": "relaunch_chrome",
                "needs_input": False,
                "input_fields": [],
                "actions": [{"name": "relaunch_chrome", "parameters": {}}],
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "medium",
                "requires_confirmation": True,
            }],
            "fallbacks": [],
            "requires_confirmation": True,
            "expected_result": "Chrome relaunched with remote debugging enabled.",
        }

    desktop_search = _desktop_search_plan(raw, user_home)
    if desktop_search:
        return desktop_search

    site_search = _site_search_plan(raw)
    if site_search:
        return site_search

    if _should_use_react_for_command(raw):
        return _react_task_plan(raw)

    target = _extract_navigation_target(raw)
    specific_workflow = (
        (_mentions_gamma(raw) and re.search(r"\b(ppt|presentation|slides|deck)\b", lower))
        or (re.search(r"\byou\s*tube\b|\byoutube\b", lower) and re.search(r"\b(play|watch|show)\b", lower))
    )
    if target and not specific_workflow and "browser.navigate" in protocols:
        url = resolve_url(target)
        method = _navigation_login_method(raw)
        site = re.sub(r"^www\.", "", httpx.URL(url).host or "") if url else target
        return _protocol_plan(
            message=raw,
            protocol_id="browser.navigate",
            params={"url": url, "login": bool(method), "login_method": method, "site": site},
            description=f"Open {url}" + (" and attempt login" if method else ""),
        )

    gmail = _parse_gmail_compose_command(raw)
    if gmail and "gmail.compose" in protocols:
        return _protocol_plan(
            message=raw,
            protocol_id="gmail.compose",
            params=gmail,
            description=f"Send Gmail to {gmail.get('to')}: \"{gmail.get('subject')}\"",
            requires_confirmation=True,
        )

    telegram = _parse_telegram_message_command(raw)
    if telegram and "telegram.send_message" in protocols:
        return _protocol_plan(
            message=raw,
            protocol_id="telegram.send_message",
            params=telegram,
            description=f"Send Telegram message to {telegram.get('contact')}: \"{telegram.get('message')}\"",
            requires_confirmation=True,
        )

    wa = _parse_whatsapp_message_command(raw)
    if wa and "whatsapp.send_message" in protocols:
        params = wa["tasks"][0]["actions"][0]["parameters"]
        return _protocol_plan(
            message=raw,
            protocol_id="whatsapp.send_message",
            params=params,
            description=f"Send WhatsApp message to {params.get('contact')}: \"{params.get('message')}\"",
        )

    inferred_message = _parse_inferred_message_command(raw)
    if inferred_message and "whatsapp.send_message" in protocols:
        return _protocol_plan(
            message=raw,
            protocol_id="whatsapp.send_message",
            params=inferred_message,
            description=f"Inferred WhatsApp message to {inferred_message.get('contact')}: \"{inferred_message.get('message')}\"",
            requires_confirmation=True,
        )

    if re.search(r"\bspotify\b", lower) and re.search(r"\b(play|listen|music|song|track|playlist|album|put\s+on)\b", lower) and "spotify.play" in protocols:
        query = _extract_spotify_query(raw)
        if not query:
            return {
                "goal": raw,
                "message": "Which song, artist, album, or playlist should I play on Spotify?",
                "strategy": "ask_user",
                "protocol_id": "spotify.play",
                "capability": "play_music",
                "parameters": {},
                "tasks": [],
                "requires_confirmation": False,
                "clarification_needed": "What should I play on Spotify?",
                "suggestions": ["Tell me the song, artist, album, or playlist name."],
                "planner_model": "deterministic-fast",
            }
        return _protocol_plan(
            message=raw,
            protocol_id="spotify.play",
            params={"query": query},
            description=f"Play Spotify music: {query}",
        )

    if re.search(r"\byou\s*tube\b|\byoutube\b", lower) and re.search(r"\b(play|watch|show)\b", lower) and "youtube.play_video" in protocols:
        query = _extract_youtube_query(raw)
        return _protocol_plan(
            message=raw,
            protocol_id="youtube.play_video",
            params={"query": query},
            description=f"Play YouTube video for: {query}",
        )

    if "google form" in lower or "forms.gle" in lower or "docs.google.com/forms" in lower:
        url_match = re.search(r"https?://[^\s\"'<>]+", raw)
        wants_submit = bool(re.search(r"\bsubmit\b|\bturn\s+it\s+in\b|\bsend\s+form\b", lower))
        params = {
            "url": url_match.group(0).rstrip(".,)") if url_match else None,
            "fields": None,
            "auto_answer": True,
            "user_context": raw,
            "submit": wants_submit,
        }
        result = _protocol_plan(
            message=raw,
            protocol_id="google_forms.fill",
            params=params,
            description="Understand and fill Google Form" + (" with submit confirmation" if wants_submit else ""),
            requires_confirmation=True,
            risk="medium",
        )
        result["expected_result"] = "Google Form answers are generated, previewed, and filled only after confirmation."
        return result

    if _mentions_gamma(raw) and re.search(r"\b(create|make|generate|build|login|open)\b", lower) and re.search(r"\b(ppt|presentation|slides|deck)\b", lower) and "gamma.create_presentation" in protocols:
        topic = _topic_from_presentation_text(raw)
        return _protocol_plan(
            message=raw,
            protocol_id="gamma.create_presentation",
            params={"topic": topic, "instructions": raw},
            description=f"Create Gamma presentation: {topic}",
        )

    if re.search(r"\b(search|google|look up|find)\b", lower) and re.search(r"\b(google|web|internet)\b", lower) and "google_search.search" in protocols:
        query = _extract_search_query(raw)
        return _protocol_plan(
            message=raw,
            protocol_id="google_search.search",
            params={"query": query},
            description=f"Search Google for: {query}",
        )

    if re.search(r"\b(create|make|generate|build)\b", lower) and re.search(r"\b(ppt|powerpoint|presentation|slides|deck)\b", lower) and "presentation.generate_ppt" in protocols:
        topic = _topic_from_presentation_text(raw)
        result = _protocol_plan(
            message=raw,
            protocol_id="presentation.generate_ppt",
            params={"topic": topic, "title": topic.title(), "save_path": "Desktop"},
            description=f"Generate PPT: {topic}",
        )
        result["expected_result"] = "PPTX file created and opened."
        return result

    if re.search(r"\b(create|make|new)\s+(?:a\s+)?folder\b", lower) and "windows.create_folder" in protocols:
        m = re.search(r"\bfolder\s+(?:named\s+|called\s+)?(.+?)(?:\s+(?:on|in|under|inside)\s+(.+))?$", raw, flags=re.I)
        name = (m.group(1) if m else "New Folder").strip(" \"'`")
        location = (m.group(2) if m and m.group(2) else "Desktop").strip(" \"'`")
        # Remove common trailing location words that got captured as part of the name.
        name = re.sub(r"\s+(?:on|in)\s+(?:the\s+)?(?:desktop|documents|downloads)$", "", name, flags=re.I).strip()
        folder_path = _friendly_location_to_path(location, name, user_home)
        return _protocol_plan(
            message=raw,
            protocol_id="windows.create_folder",
            params={"name": name, "location": location, "folder_path": folder_path},
            description=f"Create folder {name} in {location}",
        )

    if re.search(r"\b(set|change)\s+(?:system\s+)?volume\b", lower) and "windows.set_volume" in protocols:
        m = re.search(r"(\d{1,3})\s*%?", raw)
        if m:
            volume = max(0, min(100, int(m.group(1))))
            return _protocol_plan(
                message=raw,
                protocol_id="windows.set_volume",
                params={"volume": volume},
                description=f"Set system volume to {volume}%",
            )

    return None

def trusted_fast_protocol_plan(message: str, user_home: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Very small deterministic layer for commands that are already proven safe.

    Broader natural-language interpretation is intentionally left to the local
    LLM planner so paraphrases and typos do not get trapped by generic keywords.
    """
    result = deterministic_protocol_plan(message, user_home)
    if not result:
        return None
    raw = re.sub(r"\s+", " ", message or "").strip()
    lower = raw.lower()
    protocol_id = result.get("protocol_id")
    if result.get("capability") == "desktop_file_search":
        result["planner_model"] = "deterministic-fast"
        return result

    always_fast = {
        "credentials.save_google_account",
        "system.relaunch_chrome",
        "youtube.play_video",
        "spotify.play",
        "browser.navigate",
        "windows.set_volume",
        "windows.create_folder",
    }
    if protocol_id in always_fast:
        result["planner_model"] = "deterministic-fast"
        return result

    if protocol_id == "whatsapp.send_message":
        params = result.get("parameters") or {}
        if params.get("contact") and params.get("message"):
            if not re.search(r"\b(?:whatsapp|whats app|wa)\b", lower):
                result["requires_confirmation"] = True
                for task in result.get("tasks", []):
                    task["requires_confirmation"] = True
            result["planner_model"] = "deterministic-fast"
            return result

    if protocol_id == "telegram.send_message" and re.search(r"\b(?:telegram|tg)\b", lower):
        result["planner_model"] = "deterministic-fast"
        return result

    if protocol_id == "gmail.compose":
        params = result.get("parameters") or {}
        if params.get("to") and params.get("body") and re.search(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", str(params.get("to"))):
            result["planner_model"] = "deterministic-fast"
            return result

    if protocol_id == "gamma.create_presentation" and _mentions_gamma(raw):
        result["planner_model"] = "deterministic-fast"
        return result

    if protocol_id == "presentation.generate_ppt" and not _mentions_gamma(raw):
        result["planner_model"] = "deterministic-fast"
        return result

    return None

def _first_nonempty(params: Dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = params.get(key)
        if value is not None and value != "":
            return value
    return None

def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "y", "send", "submit")

def _command_explicitly_wants_send(message: str, default: bool = True) -> bool:
    text = str(message or "").lower()
    if re.search(r"\b(?:send|send it|send the|actually send|deliver)\b", text):
        return True
    if re.search(r"\b(?:draft|compose|write)\b", text) and not re.search(r"\bsend\b", text):
        return False
    return default

def _normalize_protocol_params(protocol_id: str, params: Dict[str, Any], message: str, user_home: Optional[str] = None) -> Dict[str, Any]:
    raw = re.sub(r"\s+", " ", message or "").strip()
    cleaned = {k: v for k, v in (params or {}).items() if v is not None and v != ""}

    if protocol_id == "whatsapp.send_message":
        parsed = _parse_whatsapp_message_command(raw)
        if parsed:
            base = parsed["tasks"][0]["actions"][0]["parameters"]
            cleaned = {**cleaned, **base}
        inferred = _parse_inferred_message_command(raw)
        if inferred:
            cleaned = {**cleaned, **inferred}
        contact = _first_nonempty(cleaned, "contact", "recipient", "to", "name", "chat")
        message_text = _first_nonempty(cleaned, "message", "text", "body", "content")
        return {
            "contact": str(contact).strip() if contact else None,
            "message": str(message_text).strip() if message_text else None,
            "send": _as_bool(cleaned.get("send"), True),
        }

    if protocol_id == "telegram.send_message":
        parsed = _parse_telegram_message_command(raw) or {}
        cleaned = {**cleaned, **parsed}
        contact = _first_nonempty(cleaned, "contact", "recipient", "to", "name", "chat")
        message_text = _first_nonempty(cleaned, "message", "text", "body", "content")
        return {
            "contact": str(contact).strip() if contact else None,
            "message": str(message_text).strip() if message_text else None,
            "send": _as_bool(cleaned.get("send"), True),
        }

    if protocol_id == "gmail.compose":
        parsed = _parse_gmail_compose_command(raw) or {}
        cleaned = {**cleaned, **parsed}
        to = _first_nonempty(cleaned, "to", "recipient", "email", "email_address", "address")
        subject = _first_nonempty(cleaned, "subject", "title")
        body = _first_nonempty(cleaned, "body", "message", "text", "content")
        send = _as_bool(cleaned.get("send"), _command_explicitly_wants_send(raw, True))
        result = {
            "to": str(to).strip() if to else None,
            "subject": str(subject).strip() if subject else "Message from Pecifics",
            "body": str(body).strip() if body else None,
            "send": send,
        }
        account = _first_nonempty(cleaned, "account_email", "account", "from")
        if account:
            result["account_email"] = str(account).strip()
        return result

    if protocol_id == "gamma.create_presentation":
        topic = _first_nonempty(cleaned, "topic", "subject", "title", "query")
        if not topic:
            topic = _topic_from_presentation_text(raw)
        return {"topic": str(topic).strip(), "instructions": str(cleaned.get("instructions") or raw).strip()}

    if protocol_id == "presentation.generate_ppt":
        topic = _first_nonempty(cleaned, "topic", "subject", "title", "query")
        if not topic:
            topic = _topic_from_presentation_text(raw)
        title = _first_nonempty(cleaned, "title", "deck_title")
        save_path = _first_nonempty(cleaned, "save_path", "location", "folder") or "Desktop"
        return {"topic": str(topic).strip(), "title": str(title or topic).strip().title(), "save_path": str(save_path).strip()}

    if protocol_id == "youtube.play_video":
        query = _first_nonempty(cleaned, "query", "video", "title", "topic", "search")
        return {"query": str(query or _extract_youtube_query(raw)).strip()}

    if protocol_id == "spotify.play":
        query = _first_nonempty(cleaned, "query", "song", "track", "artist", "playlist", "album", "search")
        return {"query": str(query or _extract_spotify_query(raw)).strip()}

    if protocol_id == "google_search.search":
        query = _first_nonempty(cleaned, "query", "search", "topic")
        return {"query": str(query or _extract_search_query(raw)).strip()}

    if protocol_id == "browser.navigate":
        target = _first_nonempty(cleaned, "url", "site", "website", "target", "domain")
        if not target:
            target = _extract_navigation_target(raw)
        url = resolve_url(str(target)) if target else None
        method = _first_nonempty(cleaned, "login_method", "method")
        if not method:
            method = _navigation_login_method(raw)
        login = _as_bool(cleaned.get("login"), bool(method))
        site = _first_nonempty(cleaned, "site", "website")
        if not site and url:
            try:
                site = re.sub(r"^www\.", "", httpx.URL(url).host or "")
            except Exception:
                site = ""
        return {"url": url, "login": login, "login_method": method, "site": site}

    if protocol_id == "windows.set_volume":
        volume = _first_nonempty(cleaned, "volume", "level", "percent", "percentage")
        if volume is None:
            m = re.search(r"(\d{1,3})\s*%?", raw)
            volume = int(m.group(1)) if m else None
        if volume is None:
            return {"volume": None}
        return {"volume": max(0, min(100, int(float(volume))))}

    if protocol_id == "windows.create_folder":
        parsed = _params_for_protocol_guess(protocol_id, raw, user_home) or {}
        cleaned = {**cleaned, **parsed}
        name = _first_nonempty(cleaned, "name", "folder", "folder_name")
        location = _first_nonempty(cleaned, "location", "parent", "save_path") or "Desktop"
        folder_path = _first_nonempty(cleaned, "folder_path", "path")
        if not folder_path and name:
            folder_path = _friendly_location_to_path(str(location), str(name), user_home)
        return {"name": str(name).strip() if name else None, "location": str(location).strip(), "folder_path": folder_path}

    if protocol_id == "google_forms.fill":
        return {
            "url": _first_nonempty(cleaned, "url", "form_url", "link"),
            "fields": cleaned.get("fields") or cleaned.get("answers") or cleaned.get("values"),
            "auto_answer": _as_bool(cleaned.get("auto_answer"), not bool(cleaned.get("fields") or cleaned.get("answers") or cleaned.get("values"))),
            "user_context": _first_nonempty(cleaned, "user_context", "context", "instructions") or raw,
            "submit": _as_bool(cleaned.get("submit"), False),
        }

    if protocol_id == "credentials.save_google_account":
        # The desktop action opens a secure credential dialog; credentials should
        # not be supplied through chat or stored in planner output.
        return {}

    return cleaned

def _missing_required_protocol_params(protocol_id: str, params: Dict[str, Any]) -> List[str]:
    if protocol_id == "credentials.save_google_account":
        return []
    if protocol_id == "gmail.compose":
        recipient = str((params or {}).get("to") or "").strip()
        if recipient and not re.search(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", recipient):
            params["to"] = None
    protocol = load_protocols().get(protocol_id) or {}
    missing = []
    for key, spec in (protocol.get("parameters") or {}).items():
        if not isinstance(spec, dict) or not spec.get("required"):
            continue
        value = (params or {}).get(key)
        if value is None or value == "" or value == {} or value == []:
            missing.append(key)
    return missing

def build_protocol_list_for_prompt() -> str:
    lines = []
    for protocol in load_protocols().values():
        pid = protocol.get("id")
        domain = protocol.get("domain") or ""
        capability = protocol.get("capability") or ""
        desc = protocol.get("description") or ""
        params = []
        for key, spec in (protocol.get("parameters") or {}).items():
            required = "required" if isinstance(spec, dict) and spec.get("required") else "optional"
            params.append(f"{key} ({required})")
        lines.append(f"- {pid}: {domain} / {capability}. {desc} Params: {', '.join(params) or 'none'}")
    return "\n".join(lines)

def summarize_user_profile(profile: Dict[str, Any]) -> str:
    safe = profile or {}
    summary = {
        "personal": safe.get("personal", {}),
        "frequent_contacts": safe.get("frequent_contacts", {}),
        "app_preferences": safe.get("app_preferences", {}),
        "file_preferences": safe.get("file_preferences", {}),
        "system_preferences": safe.get("system_preferences", {}),
    }
    return json.dumps(summary, ensure_ascii=True)[:2500]

def summarize_conversation_context(session_id: str, frontend_history: Optional[List[Dict[str, Any]]] = None, limit: int = 8) -> str:
    history = (load_session_messages(session_id, limit=limit) if session_id else []) + (frontend_history or [])
    compact = []
    for item in history[-limit:]:
        role = item.get("role") or "unknown"
        content = re.sub(r"\s+", " ", str(item.get("content") or "")).strip()
        if content:
            compact.append({"role": role, "content": content[:500]})
    return json.dumps(compact, ensure_ascii=True)

def suggest_closest_protocols(message: str, limit: int = 3) -> List[str]:
    cmd_words = set(re.findall(r"[a-z0-9]+", str(message or "").lower()))
    scored = []
    for protocol in load_protocols().values():
        haystack = " ".join([
            str(protocol.get("id") or ""),
            str(protocol.get("domain") or ""),
            str(protocol.get("capability") or ""),
            str(protocol.get("description") or ""),
        ]).lower()
        p_words = set(re.findall(r"[a-z0-9]+", haystack))
        overlap = len(cmd_words & p_words)
        if overlap:
            scored.append((overlap, protocol.get("id")))
    scored.sort(reverse=True)
    return [pid for _, pid in scored[:limit] if pid]

def _parse_json_block(raw: str) -> Dict[str, Any]:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise

def _conversation_items_for_correlation(
    session_id: str,
    frontend_history: Optional[List[Dict[str, Any]]],
    current_message: str,
    limit: int = 12,
) -> List[Dict[str, Any]]:
    history = (load_session_messages(session_id, limit=limit) if session_id else []) + (frontend_history or [])
    compact = []
    current_norm = re.sub(r"\s+", " ", current_message or "").strip().lower()
    for item in history[-limit:]:
        role = item.get("role") or "unknown"
        content = re.sub(r"\s+", " ", str(item.get("content") or "")).strip()
        if not content:
            continue
        # /plan_protocol stores the current user message before planning in older
        # flows. Ignore that duplicate so Qwen sees the true prior exchange.
        if role == "user" and content.lower() == current_norm:
            continue
        compact.append({"role": role, "content": content[:700]})
    return compact[-limit:]

def _should_semantically_correlate(message: str, prior: List[Dict[str, Any]]) -> bool:
    if not prior:
        return False
    lower = re.sub(r"\s+", " ", str(message or "").lower()).strip()
    if not lower:
        return False
    continuation_markers = [
        "also", "and also", "now", "then", "next", "after that", "continue", "do it",
        "login", "log in", "sign in", "use that", "use this", "send it",
        "submit it", "fill it", "tell her", "tell him", "same", "that one",
        "with my", "using my", "make it", "change it",
    ]
    if any(lower.startswith(marker) or f" {marker} " in f" {lower} " for marker in continuation_markers):
        return True
    target_words = [
        "whatsapp", "telegram", "gmail", "email", "mail", "gamma", "youtube",
        "amazon", "google", "chrome", "spotify", "form", "ppt", "powerpoint",
        "http", "www", ".com", ".in", ".app",
    ]
    if len(lower.split()) <= 7 and not any(word in lower for word in target_words):
        return True
    return False

def _fallback_continuation_rewrite(message: str, prior: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    lower = str(message or "").lower().strip()
    if not prior:
        return None
    prior_text = "\n".join(str(item.get("content") or "") for item in prior[-8:])
    url_match = re.findall(r"https?://[^\s\"'<>]+", prior_text)
    last_url = url_match[-1].rstrip(".,)") if url_match else None
    if last_url and re.search(r"\b(?:also\s+)?(?:login|log in|sign in|signin)\b", lower):
        method = _navigation_login_method(message) or "site_default"
        try:
            target = re.sub(r"^www\.", "", httpx.URL(last_url).host or last_url)
        except Exception:
            target = last_url
        return {
            "is_continuation": True,
            "continuation_type": "follow_up",
            "enriched_command": f"go to {target} and login using {method.replace('_', ' ')}",
            "confidence": 0.72,
            "reason": "Short login follow-up reused the previous browser URL.",
            "fallback": True,
        }
    search_followup = re.search(r"^(?:now\s+|also\s+|and\s+also\s+|then\s+|next\s+)?(?:search|find|look\s+for)\b", lower)
    search_in_that = re.search(r"^(?:in|on)\s+(?:that|it|this|there)\s+(?:search|find|look\s+for)\b", lower)
    if last_url and (search_followup or search_in_that):
        query = _extract_search_query(message)
        query = re.sub(r"^(?:in|on)\s+(?:that|it|this|there)\s+", "", query, flags=re.I).strip()
        try:
            target = re.sub(r"^www\.", "", httpx.URL(last_url).host or last_url)
        except Exception:
            target = last_url
        return {
            "is_continuation": True,
            "continuation_type": "follow_up",
            "enriched_command": f"go to {target} and search for {query}",
            "confidence": 0.78,
            "reason": "Search follow-up reused the previous browser URL.",
            "fallback": True,
        }
    # 2.3: Implicit continuation patterns — single-word replies, "send it", "try again" etc.
    IMPLICIT_CONTINUATION_PATTERNS = [
        r'^(what|how|why|when|where|is|was|did|does)\s+it\b',
        r'^try\s+(again|that|it|a\s+different)',
        r'^(that|this)\s+(was|is)\s+(wrong|right|good|bad)',
        r'^do\s+it\s+(again|differently|instead|now)',
        r'^\(?(yes|no|ok|okay|sure|nope|cancel|stop)\)?$',
        r'^(send|share|forward|copy)\s+(it|that|this)\b',
        r'^(open|show|display)\s+(it|that|the\s+file)\b',
    ]
    import re as _re
    for pattern in IMPLICIT_CONTINUATION_PATTERNS:
        if _re.search(pattern, lower):
            if prior_text:
                return {
                    "is_continuation": True,
                    "continuation_type": "implicit_reference",
                    "enriched_command": f"{message} [context: {prior_text[-400:]}]",
                    "confidence": 0.65,
                    "reason": "Implicit continuation pattern matched.",
                    "fallback": True,
                }
    return None

def _active_context_from_request(app_state: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    state = app_state or {}
    context = state.get("activation_context") if isinstance(state.get("activation_context"), dict) else state
    return context if isinstance(context, dict) else {}

def _should_attach_active_context(message: str) -> bool:
    lower = re.sub(r"\s+", " ", str(message or "").lower()).strip()
    if not lower:
        return False
    # 2.5: Expanded triggers to cover fix/improve/save/close/summarize/copy etc.
    markers = [
        "this", "that", "it", "here", "current", "current page", "current app",
        "continue", "continue this", "keep going", "what i was doing",
        "my work", "the document", "the file", "this page", "this form",
        "fill this", "submit this", "fix this", "summarize this",
        # New: edit/improve/modify
        "fix", "improve", "edit", "change", "update", "modify",
        # New: file ops
        "save", "close", "quit", "minimize",
        # New: understanding
        "what is", "what does", "explain", "summarize", "describe",
        # New: clipboard
        "copy", "paste", "select all",
        # New: code
        "run", "execute", "debug", "test",
        # New: send/forward
        "send it", "forward it", "share it",
        "open it", "show it", "display it",
    ]
    return any(marker in lower for marker in markers)

def _enrich_with_active_context(message: str, app_state: Optional[Dict[str, Any]]) -> str:
    context = _active_context_from_request(app_state)
    if not context or not _should_attach_active_context(message):
        return message
    active_app = context.get("activeApp") or context.get("app") or context.get("process") or "unknown"
    title = context.get("title") or context.get("windowTitle") or ""
    if str(active_app).lower() == "unknown" and not title:
        return message
    parts = [f"active app: {active_app}"]
    if title:
        parts.append(f"window title: {title}")
    if context.get("url"):
        parts.append(f"url: {context['url']}")
    return f"{message} [screen context: {', '.join(parts)}]"

async def correlate_followup_command(
    message: str,
    session_id: str,
    frontend_history: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    prior = _conversation_items_for_correlation(session_id, frontend_history, message)
    if not _should_semantically_correlate(message, prior):
        return None
    deterministic_followup = _fallback_continuation_rewrite(message, prior)
    if deterministic_followup and re.search(r"\b(?:also\s+)?(?:login|log in|sign in|signin)\b", str(message or "").lower()):
        return deterministic_followup
    prompt = f"""You decide whether a new Pecifics command continues the previous task.

Recent conversation, oldest to newest:
{json.dumps(prior, ensure_ascii=True, indent=2)}

New command:
{message}

Return ONLY valid JSON:
{{
  "is_continuation": true,
  "continuation_type": "follow_up|correction|addition|independent",
  "enriched_command": "rewrite the new command with the missing app/url/contact/task context, or the original command if independent",
  "confidence": 0.0,
  "reason": "one short sentence"
}}

Rules:
- If the new command says "also", "then", "login", "send it", "fill it", "submit it", "tell her/him", or references "this/that/it", strongly consider the previous task.
- Preserve the user's new intent. Only add missing context from the recent conversation.
- Do not invent private contacts, passwords, IDs, or answers.
- If unrelated, set is_continuation false and enriched_command to the original command."""
    try:
        async with httpx.AsyncClient(timeout=min(OLLAMA_TIMEOUT, 12)) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "Return only valid JSON. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 350},
                },
            )
        if resp.status_code != 200:
            return None
        content = (resp.json().get("message") or {}).get("content") or ""
        result = _parse_json_block(content)
        if not result or not result.get("is_continuation"):
            return _fallback_continuation_rewrite(message, prior)
        confidence = float(result.get("confidence") or 0)
        enriched = re.sub(r"\s+", " ", str(result.get("enriched_command") or "")).strip()
        if confidence < 0.62 or not enriched or enriched.lower() == str(message or "").strip().lower():
            return _fallback_continuation_rewrite(message, prior)
        result["enriched_command"] = enriched
        return result
    except Exception as e:
        logger.debug(f"Semantic continuation correlation skipped: {e}")
        return _fallback_continuation_rewrite(message, prior)

def _choice_to_protocol_plan(choice: Dict[str, Any], message: str, session_id: str) -> Optional[Dict[str, Any]]:
    protocol_id = choice.get("protocol_id")
    confidence = float(choice.get("confidence") or 0)
    strategy = str(choice.get("strategy") or "").strip().lower()
    if strategy == "ask_user":
        question = choice.get("clarification_needed") or choice.get("message") or "I need one more detail before I can run this."
        return {
            "goal": message,
            "message": question,
            "strategy": "ask_user",
            "protocol_id": protocol_id if protocol_id in load_protocols() else None,
            "capability": None,
            "parameters": choice.get("parameters") or {},
            "tasks": [],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "",
            "session_id": session_id,
            "planner_confidence": confidence,
            "planner_reason": choice.get("reason", ""),
            "suggestions": suggest_closest_protocols(message),
        }
    if "protocol" not in strategy or protocol_id not in load_protocols() or confidence < 0.6:
        return None
    protocol = load_protocols()[protocol_id]
    params = _normalize_protocol_params(protocol_id, choice.get("parameters") or {}, message, _USER_HOME.replace("\\\\", "\\"))
    missing = _missing_required_protocol_params(protocol_id, params)
    if missing:
        return {
            "goal": message,
            "message": f"I can use {protocol_id}, but I need: {', '.join(missing)}.",
            "strategy": "ask_user",
            "protocol_id": protocol_id,
            "capability": protocol.get("capability"),
            "parameters": params,
            "tasks": [],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "",
            "session_id": session_id,
            "planner_confidence": confidence,
            "planner_reason": choice.get("reason", ""),
            "missing_parameters": missing,
        }
    inferred = choice.get("inferred") or []
    app_inferred_send = protocol_id in ("whatsapp.send_message", "telegram.send_message", "gmail.compose") and not re.search(r"\b(?:whatsapp|whats app|telegram|tg|gmail|email|mail)\b", str(message).lower())
    needs_confirmation = bool(protocol.get("requires_confirmation", False)) or confidence < 0.8 or bool(choice.get("requires_confirmation")) or app_inferred_send
    result = _protocol_plan(
        message=message,
        protocol_id=protocol_id,
        params=params,
        description=choice.get("description") or f"{protocol.get('description', protocol_id)}",
        requires_confirmation=needs_confirmation,
    )
    result["session_id"] = session_id
    result["planner_confidence"] = confidence
    result["planner_reason"] = choice.get("reason", "")
    result["inferred"] = inferred
    return result

async def _call_ollama_protocol_choice(prompt: str) -> Optional[Dict[str, Any]]:
    logger.info("[QWEN] Protocol-choice call -> model=%s prompt_chars=%s", OLLAMA_MODEL, len(prompt or ""))
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "Return only valid JSON. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 450},
                },
            )
        if resp.status_code != 200:
            logger.warning("[QWEN] Protocol-choice HTTP %s after %sms", resp.status_code, round((time.time() - started) * 1000))
            return None
        data = resp.json()
        content = (data.get("message") or {}).get("content") or data.get("response") or ""
        logger.info("[QWEN] Protocol-choice response in %sms: %s", round((time.time() - started) * 1000), content[:300].replace("\n", " "))
        return _parse_json_block(content)
    except Exception as e:
        logger.warning("[QWEN] Protocol-choice unavailable after %sms: %s", round((time.time() - started) * 1000), e)
        return None

async def _call_ollama_primary_intent(
    *,
    message: str,
    session_id: str,
    user_profile: Dict[str, Any],
    conversation_history: Optional[List[Dict[str, Any]]] = None,
    protocol_memory: Optional[Dict[str, Any]] = None,
    app_state: Optional[Dict[str, Any]] = None,
    browser_state: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    system_prompt = f"""You are the primary intent parser for Pecifics, a Windows desktop AI assistant.
Your job is to understand what the user wants and map it to the correct protocol and parameters.

Available protocols:
{build_protocol_list_for_prompt()}

User profile context:
{summarize_user_profile(user_profile)}

Recent conversation:
{summarize_conversation_context(session_id, conversation_history)}

Similar protocol memory:
{json.dumps(protocol_memory or {}, ensure_ascii=True)[:2500]}

Current app/browser state:
{json.dumps({"app_state": app_state or {}, "browser_state": browser_state or {}}, ensure_ascii=True)[:2000]}

Rules:
1. If the user mentions a specific app or website by name, that app's protocol ALWAYS takes priority over generic action keywords.
2. Extract ALL parameters the chosen protocol needs from the command.
3. If a parameter is missing but can be inferred from recent conversation or user profile, include it and list it in inferred.
4. If a required parameter is missing or the command is ambiguous, set strategy to ask_user with a specific clarification_needed question.
5. Never guess a contact name or private recipient. Ask if unclear.
6. Use whatsapp.send_message for generic "message/text/tell/send someone ..." only when a contact and message are clear and no other messaging app is named.
7. For Gmail, recipient must be an email address or an explicit saved contact; otherwise ask_user.
8. For Gamma, choose gamma.create_presentation when the user mentions Gamma or gamma.app, even if they also say PPT/PowerPoint.
9. Use presentation.generate_ppt only for local PowerPoint/PPT creation when no specific app/site is named.
10. Sending/submitting/deleting/purchasing should set requires_confirmation true unless the command names a trusted exact protocol and all params are explicit.
11. Navigation commands like "go to X", "open X", "visit X", and "take me to X" use browser.navigate. Resolve obvious sites like amazon -> https://www.amazon.in, gamma -> https://gamma.app, gmail -> https://mail.google.com.
12. If a navigation command also says login/sign in/using my account, set login true and login_method to google_oauth, saved_credentials, or site_default.
13. Follow-up commands like "also login using my Google account" are continuations. Use the recent conversation URL/app when available.
14. For Google Forms, choose google_forms.fill. If field values are not explicitly provided, set auto_answer true, user_context to the command, and submit true only when the user explicitly says submit/send/turn it in.
15. The strategy value must be exactly one of: "protocol", "ask_user", "vision". Do not copy the enum string.

Examples:
User: shoot a message to zainab saying hi
JSON: {{"strategy":"protocol","protocol_id":"whatsapp.send_message","confidence":0.82,"parameters":{{"contact":"zainab","message":"hi","send":true}},"inferred":["app:whatsapp"],"requires_confirmation":true,"clarification_needed":null,"description":"Send WhatsApp message to zainab: hi","reason":"Generic message intent with clear contact and text."}}

User: open gammma.app and create a ppt for photosynthesis
JSON: {{"strategy":"protocol","protocol_id":"gamma.create_presentation","confidence":0.91,"parameters":{{"topic":"photosynthesis"}},"inferred":[],"requires_confirmation":false,"clarification_needed":null,"description":"Create Gamma presentation: photosynthesis","reason":"Specific Gamma app mention takes priority over generic PPT."}}

User: go to amazon and login using my Google account
JSON: {{"strategy":"protocol","protocol_id":"browser.navigate","confidence":0.86,"parameters":{{"url":"https://www.amazon.in","login":true,"login_method":"google_oauth","site":"amazon.in"}},"inferred":[],"requires_confirmation":false,"clarification_needed":null,"description":"Open Amazon and attempt login","reason":"Website navigation with login requested."}}

User: write an email to raj telling him meeting is at 3
JSON: {{"strategy":"ask_user","protocol_id":"gmail.compose","confidence":0.72,"parameters":{{"body":"meeting is at 3"}},"inferred":[],"requires_confirmation":false,"clarification_needed":"What email address should I send this to?","description":"Need Gmail recipient","reason":"Recipient is a name, not a known email address."}}

User: fill this Google Form with answers for my college application and submit
JSON: {{"strategy":"protocol","protocol_id":"google_forms.fill","confidence":0.84,"parameters":{{"auto_answer":true,"user_context":"college application answers","submit":true}},"inferred":[],"requires_confirmation":true,"clarification_needed":null,"description":"Understand and fill Google Form","reason":"Google Form task should extract questions and preview generated answers before submission."}}

Return ONLY valid JSON, no markdown:
{{
  "strategy": "protocol|ask_user|vision",
  "protocol_id": "one available protocol id or null",
  "confidence": 0.0,
  "parameters": {{}},
  "inferred": [],
  "requires_confirmation": false,
  "clarification_needed": null,
  "description": "short user-facing task description",
  "reason": "short reason"
}}"""
    logger.info("[QWEN] Primary intent call -> model=%s message=%r", OLLAMA_MODEL, message[:180])
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 550},
                },
            )
        if resp.status_code != 200:
            logger.warning("[QWEN] Primary intent HTTP %s after %sms", resp.status_code, round((time.time() - started) * 1000))
            return None
        data = resp.json()
        content = (data.get("message") or {}).get("content") or data.get("response") or ""
        logger.info("[QWEN] Primary intent response in %sms: %s", round((time.time() - started) * 1000), content[:350].replace("\n", " "))
        try:
            return _parse_json_block(content)
        except Exception as parse_error:
            logger.info(f"Ollama primary returned non-JSON or malformed JSON: {parse_error}; content={content[:700]}")
            return None
    except Exception as e:
        logger.warning("[QWEN] Primary intent unavailable after %sms: %s", round((time.time() - started) * 1000), e)
        return None

async def _call_ollama_protocol_similarity(message: str) -> Optional[Dict[str, Any]]:
    options = [
        {
            "id": p.get("id"),
            "domain": p.get("domain"),
            "capability": p.get("capability"),
            "description": p.get("description"),
        }
        for p in load_protocols().values()
    ]
    prompt = f"""Match the user command to the closest Pecifics protocol.
Return ONLY JSON: {{"protocol_id": string_or_null, "confidence": 0.0, "reason": "short"}}

Protocols:
{json.dumps(options, indent=2)}

User command: {message}

Rules:
- Choose a protocol only when the user's intent clearly fits it.
- Prefer whatsapp.send_message for generic "message/text/tell/send someone ..." commands when no other messaging app is named.
- Return null when required intent is unclear."""
    logger.info("[QWEN] Similarity call -> model=%s message=%r", OLLAMA_MODEL, message[:180])
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "Return only valid JSON. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 180},
                },
            )
        if resp.status_code != 200:
            logger.warning("[QWEN] Similarity HTTP %s after %sms", resp.status_code, round((time.time() - started) * 1000))
            return None
        data = resp.json()
        content = (data.get("message") or {}).get("content") or data.get("response") or ""
        logger.info("[QWEN] Similarity response in %sms: %s", round((time.time() - started) * 1000), content[:250].replace("\n", " "))
        return _parse_json_block(content)
    except Exception as e:
        logger.warning("[QWEN] Similarity unavailable after %sms: %s", round((time.time() - started) * 1000), e)
        return None

def _params_for_protocol_guess(protocol_id: str, message: str, user_home: Optional[str] = None) -> Optional[Dict[str, Any]]:
    raw = re.sub(r"\s+", " ", message or "").strip()
    lower = raw.lower()
    if protocol_id == "whatsapp.send_message":
        wa = _parse_whatsapp_message_command(raw)
        if wa:
            return wa["tasks"][0]["actions"][0]["parameters"]
        inferred = _parse_inferred_message_command(raw)
        if inferred:
            return inferred
        return None
    if protocol_id == "telegram.send_message":
        return _parse_telegram_message_command(raw)
    if protocol_id == "credentials.save_google_account":
        return {}
    if protocol_id == "gmail.compose":
        return _parse_gmail_compose_command(raw)
    if protocol_id == "youtube.play_video":
        return {"query": _extract_youtube_query(raw)}
    if protocol_id == "spotify.play":
        query = _extract_spotify_query(raw)
        return {"query": query} if query else None
    if protocol_id == "google_search.search":
        return {"query": _extract_search_query(raw)}
    if protocol_id == "browser.navigate":
        target = _extract_navigation_target(raw)
        if not target:
            return None
        url = resolve_url(target)
        method = _navigation_login_method(raw)
        site = re.sub(r"^www\.", "", httpx.URL(url).host or "") if url else target
        return {"url": url, "login": bool(method), "login_method": method, "site": site}
    if protocol_id == "gamma.create_presentation":
        return {"topic": _topic_from_presentation_text(raw), "instructions": raw}
    if protocol_id == "presentation.generate_ppt":
        topic = _topic_from_presentation_text(raw)
        return {"topic": topic, "title": topic.title(), "save_path": "Desktop"}
    if protocol_id == "windows.set_volume":
        m = re.search(r"(\d{1,3})\s*%?", raw)
        return {"volume": max(0, min(100, int(m.group(1))))} if m else None
    if protocol_id == "windows.create_folder":
        m = re.search(r"\bfolder\s+(?:named\s+|called\s+)?(.+?)(?:\s+(?:on|in|under|inside)\s+(.+))?$", raw, flags=re.I)
        if not m:
            return None
        name = re.sub(r"\s+(?:on|in)\s+(?:the\s+)?(?:desktop|documents|downloads)$", "", m.group(1), flags=re.I).strip(" \"'`")
        location = (m.group(2) if m.group(2) else "Desktop").strip(" \"'`")
        return {"name": name, "location": location, "folder_path": _friendly_location_to_path(location, name, user_home)}
    if protocol_id == "google_forms.fill":
        url_match = re.search(r"https?://[^\s\"'<>]+", raw)
        return {
            "url": url_match.group(0).rstrip(".,)") if url_match else None,
            "fields": None,
            "auto_answer": True,
            "user_context": raw,
            "submit": bool(re.search(r"\bsubmit\b|\bturn\s+it\s+in\b|\bsend\s+form\b", raw, flags=re.I)),
        }
    return None

_chroma_client = None
_recipe_collection = None
_protocol_run_collection = None

def get_recipe_collection():
    global _chroma_client, _recipe_collection
    if not HAS_CHROMA:
        return None
    if _recipe_collection is not None:
        return _recipe_collection
    try:
        _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
        _recipe_collection = _chroma_client.get_or_create_collection("task_recipes")
        logger.info("ChromaDB task recipe memory initialized")
        return _recipe_collection
    except Exception as e:
        logger.warning(f"ChromaDB unavailable: {e}")
        return None

def get_protocol_run_collection():
    global _chroma_client, _protocol_run_collection
    if not HAS_CHROMA:
        return None
    if _protocol_run_collection is not None:
        return _protocol_run_collection
    try:
        if _chroma_client is None:
            _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
        _protocol_run_collection = _chroma_client.get_or_create_collection("protocol_runs")
        return _protocol_run_collection
    except Exception as e:
        logger.warning(f"Protocol run collection unavailable: {e}")
        return None

def hash_embedding(text: str, dims: int = 128) -> List[float]:
    vec = [0.0] * dims
    tokens = re.findall(r"[a-z0-9]+", str(text or "").lower())
    for token in tokens:
        h = 2166136261
        for ch in token:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        vec[h % dims] += 1.0
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]

def store_task_recipe(task: str, actions: List[Dict], result: Optional[Dict] = None) -> Dict:
    collection = get_recipe_collection()
    if not collection:
        return {"success": False, "error": "ChromaDB is not installed or unavailable"}
    doc_id = str(uuid.uuid4())
    collection.add(
        ids=[doc_id],
        documents=[task],
        metadatas=[{"actions": json.dumps(actions), "result": json.dumps(result or {})}],
        embeddings=[hash_embedding(task)]
    )
    return {"success": True, "id": doc_id}

def query_task_recipe(task: str, max_distance: float = 0.25) -> Optional[Dict]:
    collection = get_recipe_collection()
    if not collection:
        return None
    try:
        res = collection.query(query_embeddings=[hash_embedding(task)], n_results=1)
        if not res or not res.get("ids") or not res["ids"][0]:
            return None
        distance = float((res.get("distances") or [[1]])[0][0])
        if distance > max_distance:
            return None
        meta = (res.get("metadatas") or [[{}]])[0][0] or {}
        return {
            "id": res["ids"][0][0],
            "distance": distance,
            "task": (res.get("documents") or [[task]])[0][0],
            "actions": json.loads(meta.get("actions") or "[]"),
            "result": json.loads(meta.get("result") or "{}"),
        }
    except Exception as e:
        logger.warning(f"Recipe query failed: {e}")
        return None

def _dedupe_strings(values: List[Any]) -> List[str]:
    seen = set()
    out = []
    for value in values or []:
        if value is None:
            continue
        text = str(value).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out

def _infer_command_template(command: str, params: Optional[Dict[str, Any]]) -> str:
    template = command or ""
    for key, value in (params or {}).items():
        if value is None or isinstance(value, (dict, list)):
            continue
        text = str(value).strip()
        if len(text) < 2:
            continue
        template = re.sub(re.escape(text), "{" + key + "}", template, flags=re.I)
    return template

def _sanitize_memory_params(params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    clean = {}
    for key, value in (params or {}).items():
        if re.search(r"password|secret|token|credential|api[_-]?key", str(key), flags=re.I):
            continue
        clean[key] = value
    return clean

def _extract_protocol_run_meta(step_results: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    encountered: List[str] = []
    resolved: List[str] = []
    path: List[str] = []
    blocker_words = ("login", "2fa", "captcha", "onboarding", "paywall")

    def visit(value: Any):
        if not isinstance(value, dict):
            return
        result = value.get("result") if isinstance(value.get("result"), dict) else value
        for key in ("blockers_encountered", "blockersEncountered"):
            encountered.extend(result.get(key) or [])
        for key in ("blockers_resolved", "blockersResolved"):
            resolved.extend(result.get(key) or [])
        for key in ("resolution_path", "resolutionPath", "fallback_path"):
            path.extend(result.get(key) or [])
        blocker = result.get("blocker") or result.get("error_class") or result.get("step")
        if blocker and any(word in str(blocker).lower() for word in blocker_words):
            encountered.append(str(blocker).replace("requires_", ""))
        for nested_key in ("login_result", "recovery_result", "state"):
            nested = result.get(nested_key)
            if isinstance(nested, dict):
                visit(nested)

    for item in step_results or []:
        visit(item)
    return {
        "blockers_encountered": _dedupe_strings(encountered),
        "blockers_resolved": _dedupe_strings(resolved),
        "resolution_path": _dedupe_strings(path),
    }

def query_protocol_run_memory(command: str, protocol_id: Optional[str] = None, max_distance: float = 0.35) -> Optional[Dict[str, Any]]:
    collection = get_protocol_run_collection()
    if not collection:
        return None
    try:
        res = collection.query(query_embeddings=[hash_embedding(command)], n_results=3)
        rows = []
        ids = (res.get("ids") or [[]])[0]
        metadatas = (res.get("metadatas") or [[]])[0]
        documents = (res.get("documents") or [[]])[0]
        distances = (res.get("distances") or [[]])[0]
        for idx, meta in enumerate(metadatas):
            if protocol_id and meta.get("protocol_id") != protocol_id:
                continue
            distance = float(distances[idx] if idx < len(distances) else 1.0)
            if distance > max_distance:
                continue
            rows.append({
                "id": ids[idx] if idx < len(ids) else "",
                "distance": distance,
                "document": documents[idx] if idx < len(documents) else "",
                "protocol_id": meta.get("protocol_id"),
                "success": bool(meta.get("success")),
                "blockers_encountered": json.loads(meta.get("blockers_encountered") or "[]"),
                "blockers_resolved": json.loads(meta.get("blockers_resolved") or "[]"),
                "resolution_path": json.loads(meta.get("resolution_path") or "[]"),
                "duration_ms": int(meta.get("duration_ms") or 0),
                "command_template": meta.get("command_template") or "",
            })
        return rows[0] if rows else None
    except Exception as e:
        logger.debug(f"Protocol run memory query failed: {e}")
        return None

def store_protocol_run(req: ProtocolRunRequest) -> Dict[str, Any]:
    collection = get_protocol_run_collection()
    if not collection:
        return {"success": False, "error": "ChromaDB is not installed or unavailable"}
    protocol_id = req.protocol_id or "unknown"
    doc_id = str(uuid.uuid4())
    step_results = req.step_results or []
    safe_params = _sanitize_memory_params(req.extracted_parameters or {})
    inferred_meta = _extract_protocol_run_meta(step_results)
    blockers_encountered = _dedupe_strings((req.blockers_encountered or []) + inferred_meta["blockers_encountered"])
    blockers_resolved = _dedupe_strings((req.blockers_resolved or []) + inferred_meta["blockers_resolved"])
    resolution_path = _dedupe_strings((req.resolution_path or []) + (req.fallback_path or []) + inferred_meta["resolution_path"])
    command_template = req.command_template or _infer_command_template(req.command, safe_params)
    delta = 0.12 if req.success else -0.2
    doc = f"{protocol_id} :: {req.command}"
    metadata = {
        "protocol_id": protocol_id,
        "success": bool(req.success),
        "confidence_delta": float(delta),
        "task_id": int(req.task_id or 0),
        "error": (req.error or "")[:500],
        "parameters": json.dumps(safe_params),
        "step_results": json.dumps(step_results)[:7000],
        "fallback_path": json.dumps(req.fallback_path or []),
        "blockers_encountered": json.dumps(blockers_encountered),
        "blockers_resolved": json.dumps(blockers_resolved),
        "resolution_path": json.dumps(resolution_path),
        "duration_ms": int(req.duration_ms or 0),
        "command_template": command_template[:500],
        "created_at": datetime.now().isoformat(),
    }
    collection.add(ids=[doc_id], documents=[doc], metadatas=[metadata], embeddings=[hash_embedding(doc)])
    return {
        "success": True,
        "id": doc_id,
        "protocol_id": protocol_id,
        "confidence_delta": delta,
        "blockers_encountered": blockers_encountered,
        "blockers_resolved": blockers_resolved,
        "resolution_path": resolution_path,
    }

def protocol_confidence(protocol_id: Optional[str] = None) -> Dict[str, Any]:
    collection = get_protocol_run_collection()
    if not collection:
        return {"success": False, "error": "ChromaDB is not installed or unavailable", "protocols": {}}
    try:
        if protocol_id:
            data = collection.get(where={"protocol_id": protocol_id}, include=["metadatas"])
        else:
            data = collection.get(include=["metadatas"])
        scores: Dict[str, Dict[str, Any]] = {}
        for meta in data.get("metadatas") or []:
            pid = meta.get("protocol_id") or "unknown"
            item = scores.setdefault(pid, {"runs": 0, "successes": 0, "failures": 0, "score": 0.5})
            item["runs"] += 1
            if meta.get("success"):
                item["successes"] += 1
            else:
                item["failures"] += 1
            item["score"] += float(meta.get("confidence_delta") or 0)
        for item in scores.values():
            item["score"] = max(0.0, min(1.0, round(item["score"], 3)))
            item["flagged_for_review"] = item["runs"] >= 5 and item["score"] < 0.5
        return {"success": True, "protocols": scores}
    except Exception as e:
        return {"success": False, "error": str(e), "protocols": {}}

def should_try_groq_protocol_fallback(message: str) -> bool:
    if PROTOCOL_GROQ_FALLBACK in ("1", "true", "always", "yes"):
        return True
    if PROTOCOL_GROQ_FALLBACK in ("0", "false", "never", "no", "off"):
        return False
    text = str(message or "").lower()
    word_count = len(text.split())
    # 1.4: Fast-reject: short system/file commands never need Groq
    SIMPLE_PROTOCOLS = {
        "open", "close", "set volume", "volume", "create folder", "search google",
        "brightness", "battery", "wifi", "bluetooth", "lock", "sleep", "notepad",
        "calculator", "screenshot",
    }
    if word_count < 8 and any(p in text for p in SIMPLE_PROTOCOLS):
        return False
    # Multi-step signal words always use Groq
    multi_step_signals = ["then", "and then", "after that", "also"]
    if any(sig in text for sig in multi_step_signals):
        return True
    # Complex markers — only if command is long enough
    complex_markers = [
        "multiple", "workflow", "research",
        "summarize", "compare", "analyze", "report", "create and send",
        "login", "fill", "form", "gamma", "gmail", "email",
    ]
    # 1.4: Lowered threshold: use Groq only for truly complex commands (was 9 words)
    return any(marker in text for marker in complex_markers) and word_count >= 7

_sse_clients: List[asyncio.Queue] = []
active_tasks: Dict[str, asyncio.Event] = {}

def register_task(task_id: str) -> asyncio.Event:
    cancel_event = asyncio.Event()
    active_tasks[task_id] = cancel_event
    return cancel_event

def cancel_registered_task(task_id: str) -> bool:
    event = active_tasks.get(task_id)
    if not event:
        return False
    event.set()
    return True

def cleanup_task(task_id: str):
    active_tasks.pop(task_id, None)

async def broadcast_event(event: Dict):
    dead = []
    for q in _sse_clients:
        try:
            q.put_nowait(event)
        except Exception:
            dead.append(q)
    for q in dead:
        try: _sse_clients.remove(q)
        except ValueError: pass

ACTION_CATALOG = """
=== VISION AGENT (★ USE FOR ALL GUI/BROWSER TASKS) ===
vision_task(goal, max_steps)
    ★ ALWAYS use for ANY browser, website, or GUI interaction.
    AI takes screenshots → identifies UI elements → clicks/types at pixel coordinates.
    goal = detailed description with ALL details (URLs, emails, text)
    max_steps = limit (default 30)

=== SCREEN ANALYSIS ===
get_screenshot(question) | describe_screen() | analyze_screen(question)

=== FILE OPERATIONS ===
create_file(file_path, content) | create_folder(folder_path) | delete_file(file_path)
read_file(file_path) | append_to_file(file_path, content)
find_in_file(file_path, search_text) | replace_in_file(file_path, search_text, replacement_text)
list_directory(path) | copy_file(source, destination)
move_file(source, destination) | rename_file(old_path, new_name)
search_files(pattern, location) | open_file(file_path) | show_in_explorer(file_path)

=== APPLICATION CONTROL ===
open_application(app_name) | close_application(app_name) | open_url(url)
search_web(query)                → Opens Google search results for the query
focus_app(app_name)             → Brings an already-open app to the foreground

=== SYSTEM CONTROLS ===
set_volume(volume)              → 0-100
set_brightness(brightness)      → 0-100 (laptops only)
toggle_wifi(enable)             → enable=true/false, needs admin for some adapters
toggle_bluetooth(enable)        → enable=true/false, needs admin
toggle_night_light(enable)      → enable=true/false (blue light filter)
toggle_dark_mode(enable)        → enable=true/false (system-wide dark mode)
set_wallpaper(image_path)       → Full path to image file
lock_computer() | sleep_computer()
get_battery_status() | get_system_info() | get_disk_space()
get_network_status() | empty_recycle_bin()
speak(message)                  → Text-to-speech
show_notification(title, message) → Windows toast notification
get_clipboard() | set_clipboard(text)

=== OS TASKS ===
clear_cache(cache_type)         → type: 'all', 'temp', 'browser', 'dns'
flush_dns() | reset_network()
open_task_manager() | open_control_panel() | open_device_manager()
manage_service(service_name, action) → action: 'start', 'stop', 'restart'
get_running_processes() | kill_process(name_or_pid)
get_system_health() | get_power_plan() | set_power_plan(plan)
restart_computer(delay) | shutdown_computer(delay) | cancel_shutdown()

=== MS OFFICE — POWERPOINT (AUTO-OPENS ON SCREEN WHEN DONE) ===
generate_ppt(topic, title, num_slides, theme, save_path, additional_instructions)
    → Creates professional .pptx and AUTO-OPENS it in PowerPoint on screen
ppt_find_slide(search_text) | ppt_get_slide_content(slide_number)
ppt_update_slide_text(slide_number, old_text, new_text)
ppt_apply_theme(theme_name) | ppt_add_animation(animation_type)
ppt_change_layout(layout_name)

=== MS OFFICE — WORD (AUTO-OPENS ON SCREEN WHEN DONE) ===
word_create_document(title, content)
    → Creates .docx document and opens it in Word on screen
word_open_document(filepath) | word_read_content()
word_add_paragraph(text) | word_add_heading(text, level)
word_find_replace(search_text, replacement_text)
word_insert_table(rows, cols) | word_apply_theme(theme_name)
word_save(filename) | word_change_font(font_name, font_size)

=== MS OFFICE — EXCEL (AUTO-OPENS ON SCREEN WHEN DONE) ===
excel_create_workbook()
    → Creates .xlsx workbook and opens it in Excel on screen
excel_open_workbook(filepath) | excel_write_cell(row, col, value)
excel_write_data(data) | excel_add_worksheet(name)
excel_create_chart(chart_type) | excel_format_cell(row, col, options)
excel_autofit_columns() | excel_save(filename)

=== MS OFFICE — ONENOTE ===
onenote_open()                  → Opens OneNote application
onenote_create_page(title)      → Creates a new page with given title
onenote_add_content(content)    → Adds text content to the current page
onenote_list_notebooks()        → Lists all notebooks and their sections

=== MS OFFICE — PUBLISHER ===
publisher_create(template_type) → Creates a new publication (blank by default)
publisher_add_textbox(text, left, top, width, height) → Adds a text box
publisher_add_page()            → Adds a new page
publisher_save(filename)        → Saves the publication
"""

# ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

SYSTEM_PROMPT = f"""You are Pecifics, an AI desktop assistant for Windows 11.
You work like Claude Computer Use — you see the screen and control it.

EXECUTION MODEL:
- For ALL browser/GUI tasks → vision_task(goal="..."). The vision agent sees the screen and clicks.
- For file/system/non-GUI tasks → use the specific action directly.
- NEVER use browser_click, browser_type, or CSS selectors.

MULTI-TASK HANDLING:
- Users may give 3-4 tasks in one prompt.
- You MUST split them and return ALL tasks in the tasks array.
- Example: "Open Chrome, create a file on desktop, and set volume to 50"
  → 3 separate tasks, each with its own actions.

USER INFO:
- Home: {_USER_HOME}  |  Username: {_USER_NAME}
- ALWAYS use real path. NEVER use "USERNAME" placeholder.

ASKING FOR INPUT:
- If task is missing CRITICAL info → set needs_input=true with input_fields
- Needs input ONLY WHEN NOT PROVIDED: save file (filename+location), send email (to address if missing),
  create PPT (topic if unclear), delete (confirmation needed)
- If user already provided enough info (e.g. "write a mail saying I won't attend tomorrow"),
  DO NOT ask for input — use vision_task with a detailed goal instead.
- No input needed: open apps, volume, system info, open websites, compose email with given content

{ACTION_CATALOG}

OUTPUT FORMAT (ALWAYS valid JSON, no markdown):
{{
  "message": "Brief summary of all tasks",
  "tasks": [
    {{
      "id": 1,
      "description": "Open Chrome and search for weather",
      "needs_input": false,
      "input_fields": [],
      "actions": [{{"name": "vision_task", "parameters": {{"goal": "Open Chrome. Go to google.com. Type 'weather'. Press Enter."}}}}]
    }},
    {{
      "id": 2,
      "description": "Create a text file",
      "needs_input": true,
      "input_fields": [
        {{"key": "filename", "label": "File Name", "placeholder": "e.g. notes.txt", "default": "notes.txt"}},
        {{"key": "content", "label": "Content", "placeholder": "What to write?", "default": ""}}
      ],
      "actions": []
    }}
  ],
  "expected_result": "Chrome shows weather results and file is created"
}}

VISION TASK GOALS — be VERY detailed:
  "Open Chrome. Navigate to https://mail.google.com. Click Compose button. Type bob@test.com in To field. Type 'Meeting' in Subject. Type email body. Click Send."

KEY RULES:
1. Include ALL info in vision_task goals (URLs, emails, text content)
2. Start goals with "Open Chrome." if browser isn't open
3. Gmail user is already logged in — skip login steps
4. For PPT (any "create presentation/slides/ppt"): use generate_ppt action → it AUTO-OPENS in PowerPoint
5. For Word docs ("create document/report/letter"): use word_create_document → AUTO-OPENS in Word
6. For Excel ("create spreadsheet/workbook/table"): use excel_create_workbook → AUTO-OPENS in Excel
7. For file ops: use create_file, read_file etc. (not vision_task)
8. NEVER use generate_ppt + vision_task for same PPT — generate_ppt does everything
9. ALWAYS return tasks array even for single tasks
10. ALL Office actions open on screen automatically — no extra open_file needed"""

# ─── LLM ─────────────────────────────────────────────────────────────────────

_llm = None

def create_llm():
    if not HAS_GROQ or not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY not set. Free key: https://console.groq.com")
    return ChatGroq(api_key=GROQ_API_KEY, model_name=GROQ_MODEL, temperature=0.1)

def get_llm():
    global _llm
    if _llm is None:
        _llm = create_llm()
    return _llm

def _call(llm, prompt: str) -> str:
    try:
        resp = llm.invoke([HumanMessage(content=prompt)])
        text = resp.content if hasattr(resp, "content") else str(resp)
        logger.debug(f"LLM raw ({len(text)} chars): {text[:300]}")
        return text
    except TypeError:
        return llm.invoke(prompt)
    except Exception as e:
        logger.error(f"LLM call failed: {e}")
        raise

# ─── VISION PROVIDER ─────────────────────────────────────────────────────────

async def call_vision_provider(screenshot_b64: str, goal: str, step_history: list,
                                w: int, h: int, cogagent_url: str = None) -> dict:
    """Call CogAgent (Kaggle) or Gemini for vision actions."""
    
    # Priority 1: CogAgent on Kaggle (prefer dynamic URL from frontend)
    effective_url = cogagent_url or COGAGENT_URL
    if effective_url:
        try:
            async with httpx.AsyncClient(timeout=120.0, headers={"ngrok-skip-browser-warning": "true", "User-Agent": "PecificsLAM/1.0"}) as client:
                resp = await client.post(f"{effective_url.rstrip('/')}/vision_act", json={
                    "screenshot": screenshot_b64, "goal": goal,
                    "step_history": step_history,
                    "screen_width": w, "screen_height": h,
                })
                if resp.status_code == 200:
                    result = resp.json()
                    result.setdefault("action", "fail")
                    result.setdefault("description", "")
                    logger.info(f"CogAgent → {result.get('action')}: {result.get('description','')[:80]}")
                    return result
                logger.warning(f"CogAgent {resp.status_code}, falling back")
        except Exception as e:
            logger.warning(f"CogAgent error: {e}, falling back")
    
    # Priority 2: Gemini
    if HAS_GEMINI and GEMINI_API_KEY:
        return await _gemini_vision_act(screenshot_b64, goal, step_history, w, h)
    
    return {"action": "fail", "description": "No vision provider. Set COGAGENT_URL or GEMINI_API_KEY."}


_florence_model = None
_florence_processor = None

def _extract_target_phrase(goal: str) -> str:
    text = str(goal or "")
    patterns = [
        r'\b(?:click|press|select|open)\s+(?:the\s+)?["“”\']([^"“”\']+)["“”\']',
        r'\b(?:click|press|select|open)\s+(?:the\s+)?(.+?)(?:\s+button|\s+field|\s+link|$)',
        r'\b(?:button|field|link)\s+(?:called|named|labeled)\s+["“”\']?([^"“”\']+)["“”\']?',
    ]
    for pattern in patterns:
        m = re.search(pattern, text, re.I)
        if m and m.group(1).strip():
            return m.group(1).strip(" .")
    return text[:80].strip()

def _load_florence():
    global _florence_model, _florence_processor
    if _florence_model is not None and _florence_processor is not None:
        return _florence_model, _florence_processor
    from transformers import AutoModelForCausalLM, AutoProcessor
    import torch
    _florence_model = AutoModelForCausalLM.from_pretrained(
        FLORENCE_MODEL,
        torch_dtype=torch.float32,
        trust_remote_code=True
    )
    _florence_processor = AutoProcessor.from_pretrained(FLORENCE_MODEL, trust_remote_code=True)
    return _florence_model, _florence_processor

async def local_florence_ground(screenshot_b64: str, goal: str, w: int, h: int) -> Dict:
    if not screenshot_b64:
        return {"action": "fail", "description": "No screenshot supplied for local vision."}
    target = _extract_target_phrase(goal)
    try:
        model, processor = _load_florence()
        import torch
        from PIL import Image
        image = Image.open(BytesIO(base64.b64decode(screenshot_b64))).convert("RGB")
        prompt = f"<OPEN_VOCABULARY_DETECTION>{target}"
        inputs = processor(text=prompt, images=image, return_tensors="pt")
        with torch.no_grad():
            generated_ids = model.generate(
                input_ids=inputs["input_ids"],
                pixel_values=inputs["pixel_values"],
                max_new_tokens=128,
                num_beams=3,
            )
        generated_text = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
        parsed = processor.post_process_generation(
            generated_text,
            task="<OPEN_VOCABULARY_DETECTION>",
            image_size=(image.width, image.height)
        )
        data = parsed.get("<OPEN_VOCABULARY_DETECTION>", parsed)
        boxes = data.get("bboxes") or data.get("boxes") or []
        labels = data.get("labels") or []
        if not boxes:
            return {"action": "fail", "description": f"Local Florence could not locate: {target}", "confidence": 0.0}
        box = boxes[0]
        x = int((float(box[0]) + float(box[2])) / 2)
        y = int((float(box[1]) + float(box[3])) / 2)
        return {
            "action": "click",
            "x": x,
            "y": y,
            "description": f"Local Florence located {labels[0] if labels else target}",
            "confidence": 0.72,
            "provider": "florence-2",
        }
    except Exception as e:
        logger.warning(f"Local Florence failed: {e}")
        return {"action": "fail", "description": f"Local Florence unavailable: {e}", "confidence": 0.0}

async def run_vision_state_machine(req: VisionActRequest) -> Dict:
    """Conservative vision state machine: try local grounding for simple clicks, then remote VLM."""
    simple = re.search(r'\b(click|press|select|open)\b', req.goal or "", re.I) and len(req.step_history or []) == 0
    if simple:
        local = await local_florence_ground(req.screenshot, req.goal, req.screen_width or 1920, req.screen_height or 1080)
        if local.get("action") != "fail":
            return local
    return await call_vision_provider(req.screenshot, req.goal, req.step_history,
                                      req.screen_width or 1920, req.screen_height or 1080,
                                      cogagent_url=req.cogagent_url)


VISION_ACT_PROMPT = """You are a SCREEN AGENT controlling a computer by looking at screenshots.
Decide the ONE next action to progress the user's goal.

TASK: {goal}

STEPS DONE:
{history}

SCREENSHOT: {w}×{h} pixels. (0,0)=top-left.

RULES:
1. Return EXACTLY ONE action as JSON.
2. Aim for CENTER of UI elements.
3. Dismiss popups/banners FIRST.
4. Click field first, then type next step.
5. Goal achieved → {{"action":"done"}}.
6. Cannot proceed → {{"action":"fail","description":"reason"}}.

ACTIONS:
  {{"action":"click","x":<int>,"y":<int>,"description":"what"}}
  {{"action":"double_click","x":<int>,"y":<int>,"description":"what"}}
  {{"action":"right_click","x":<int>,"y":<int>,"description":"what"}}
  {{"action":"type","text":"...","description":"typing"}}
  {{"action":"type","x":<int>,"y":<int>,"text":"...","description":"click+type"}}
  {{"action":"key","key":"Enter","description":"pressing Enter"}}
  {{"action":"scroll","direction":"down","clicks":3,"description":"scrolling"}}
  {{"action":"wait","duration":2000,"description":"waiting"}}
  {{"action":"done","description":"complete"}}
  {{"action":"fail","description":"cannot proceed"}}

Return ONLY the JSON object."""


async def _gemini_vision_act(b64, goal, history, w, h):
    history_str = "\n".join(
        f"  {i+1}. [{s.get('action','?')}] {s.get('description','')}{' ✓' if s.get('success') else ' ✗'}"
        for i, s in enumerate(history)
    ) or "(none)"

    prompt = VISION_ACT_PROMPT.format(goal=goal, history=history_str, w=w, h=h)
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)
        img_data = base64.b64decode(b64)
        resp = model.generate_content(
            [prompt, {"mime_type": "image/jpeg", "data": img_data}],
            generation_config={"temperature": 0.1, "max_output_tokens": 512}
        )
        raw = resp.text.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        result.setdefault("action", "fail")
        result.setdefault("description", "")
        return result
    except json.JSONDecodeError:
        m = re.search(r'\{[^}]+\}', raw)
        if m:
            try: return json.loads(m.group())
            except: pass
        return {"action": "fail", "description": f"Vision JSON error: {raw[:100]}"}
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "quota" in err_str.lower():
            logger.error("Gemini API quota exceeded — set COGAGENT_URL to use CogAgent instead")
            return {"action": "fail", "description": "Gemini quota exceeded. Please set your CogAgent URL in Settings (from Kaggle notebook ngrok URL)."}
        return {"action": "fail", "description": f"Vision error: {err_str[:200]}"}


def describe_screenshot(b64: str) -> str:
    if not b64: return "No screenshot."
    if HAS_GEMINI and GEMINI_API_KEY:
        try:
            genai.configure(api_key=GEMINI_API_KEY)
            model = genai.GenerativeModel(GEMINI_MODEL)
            resp = model.generate_content([
                "Describe this Windows screenshot in ≤80 words.",
                {"mime_type": "image/jpeg", "data": base64.b64decode(b64)},
            ])
            return resp.text.strip()
        except: pass
    return "Screenshot captured."

# ─── TASK PLANNER ─────────────────────────────────────────────────────────────

def plan_tasks(user_message, screenshot_b64, conversation_history,
               screen_width, screen_height, user_choice, extra_context="",
               retry_count=0, previous_error=None):
    llm = get_llm()
    profile = load_user_profile()
    
    history_txt = "\n".join(
        f"{'User' if t.get('role')=='user' else 'AI'}: {t.get('content','')}"
        for t in conversation_history[-6:]
    )
    screen_desc = describe_screenshot(screenshot_b64) if screenshot_b64 else "No screenshot."
    retry_ctx = f"\n\nPREVIOUS FAILED: {previous_error}\nUse DIFFERENT approach." if retry_count > 0 and previous_error else ""
    
    if user_choice:
        user_message += f"\n[User selected: {user_choice.get('type')}={user_choice.get('value')}]"

    # 2.1: Track for debug endpoint
    debug_store["last_raw"] = user_message
    debug_store["last_enriched"] = user_message  # updated after enrichment
    debug_store["last_context"] = history_txt[:500] if history_txt else None

    prompt = f"""{SYSTEM_PROMPT}
{extra_context}
SCREEN: {screen_desc}
SCREEN SIZE: {screen_width}x{screen_height}
HISTORY:
{history_txt}
{retry_ctx}
USER PROFILE:
{json.dumps(profile, indent=2)[:2000]}

USER: {user_message}

Return ONLY valid JSON."""

    try:
        raw = _call(llm, prompt).strip()
        logger.info(f"LLM response ({len(raw)} chars): {raw[:500]}")
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        
        # Try direct parse first
        try:
            result = json.loads(raw)
        except json.JSONDecodeError:
            # Extract the outermost JSON object from mixed text
            depth = 0; start = -1; result = None
            for i, c in enumerate(raw):
                if c == '{':
                    if depth == 0: start = i
                    depth += 1
                elif c == '}':
                    depth -= 1
                    if depth == 0 and start >= 0:
                        try:
                            result = json.loads(raw[start:i+1])
                            break
                        except json.JSONDecodeError:
                            start = -1
            if result is None:
                raise json.JSONDecodeError("No valid JSON object found", raw, 0)
        
        result.setdefault("message", "Processing…")
        result.setdefault("expected_result", "")
        
        # Normalize: support old format (actions) → new format (tasks)
        if "tasks" not in result and "actions" in result:
            actions = result.pop("actions", [])
            needs_input = result.get("clarification_needed", False)
            input_fields = result.get("clarification_fields", [])
            result["tasks"] = [{
                "id": 1,
                "description": result.get("task_summary", result["message"]),
                "needs_input": needs_input,
                "input_fields": input_fields,
                "actions": actions if not needs_input else [],
            }]
        
        result.setdefault("tasks", [])
        for i, task in enumerate(result["tasks"]):
            task.setdefault("id", i + 1)
            task.setdefault("description", "")
            task.setdefault("needs_input", False)
            task.setdefault("input_fields", [])
            task.setdefault("actions", [])
        
        return result
    
    except json.JSONDecodeError as e:
        logger.error(f"Plan JSON error (attempt {retry_count+1}): {e}\nRaw: {raw[:500] if 'raw' in dir() else 'N/A'}")
        if retry_count < MAX_RETRIES:
            return plan_tasks(user_message, screenshot_b64, conversation_history,
                             screen_width, screen_height, user_choice, extra_context,
                             retry_count+1, f"JSON error: {e}. Return ONLY valid JSON, no markdown, no extra text.")
        return {"message": "Planning failed. Please rephrase.", "tasks": []}
    except Exception as e:
        logger.error(f"Plan error (attempt {retry_count+1}): {e}")
        if retry_count < MAX_RETRIES:
            return plan_tasks(user_message, screenshot_b64, conversation_history,
                             screen_width, screen_height, user_choice, extra_context,
                             retry_count+1, str(e))
        return {"message": f"Error: {e}", "tasks": []}


def verify_completion(screenshot_b64, task, expected):
    llm = get_llm()
    screen = describe_screenshot(screenshot_b64) if screenshot_b64 else "No screenshot."
    prompt = f"""Task: "{task}"
Expected: "{expected}"
Screen: {screen}

Was it completed? Return ONLY JSON:
{{"success": true, "observation": "what I see", "should_retry": false, "retry_actions": []}}"""
    try:
        raw = _call(llm, prompt).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw)
    except:
        return {"success": False, "observation": "Verification failed", "should_retry": False}


ROUTER_PROMPT = """You are a command router for a Windows desktop assistant.
Classify the user command into exactly ONE engine and extract parameters.

ENGINES:
- system: OS controls (volume, brightness, wifi, bluetooth, files, folders, CMD, registry, processes, battery, disk, clipboard, lock, sleep, shutdown, dark mode, wallpaper, notifications)
- browser: Web tasks (search, navigate URL, fill form on website, read webpage, youtube search, Gamma web workflows)
- app: Specific installed app control (WhatsApp, Telegram, Spotify, VS Code, Notepad, Calculator, any named app)
- office: document generation tasks (PowerPoint/PPT/slides, Word, Excel). For new PPT creation use operation generate_ppt with params.topic only when no specific app/site is named.
- vision: Tasks needing screen reading (unknown app, "click the button", describe screen, anything ambiguous)
- compose: Generate text content only (write email draft, summarize text, create document content) — NO execution needed

Return ONLY this JSON, nothing else:
{
  "engine": "system|browser|app|office|vision|compose",
  "confidence": 0.0-1.0,
  "app_name": "exact app name if engine=app, else null",
  "operation": "short verb phrase: set_volume|create_folder|search|navigate|send_message|play_music|open_file|draft_email|click_element|etc",
  "params": { "extracted key params from the command" },
  "fallback_engine": "vision|system|browser"
}

Examples:
"open gamma.app and create a ppt about photosynthesis" -> {"engine":"browser","operation":"gamma_create_presentation","params":{"topic":"photosynthesis","url":"https://gamma.app"},"confidence":0.99,"fallback_engine":"vision"}
"open gammma.app and login with google and create a ppt for photosynthesis" -> {"engine":"browser","operation":"gamma_create_presentation","params":{"topic":"photosynthesis","url":"https://gamma.app"},"confidence":0.99,"fallback_engine":"vision"}
"open whatsapp and msg zainab hi" -> {"engine":"app","app_name":"WhatsApp","operation":"send_message","params":{"contact":"zainab","message":"hi"},"confidence":0.97,"fallback_engine":"vision"}
"please open whatsapp and msg Zainab Csiot that its pecific and send a hi" -> {"engine":"app","app_name":"WhatsApp","operation":"send_message","params":{"contact":"Zainab Csiot","message":"its pecific and send a hi"},"confidence":0.99,"fallback_engine":"vision"}
"search weather on google" -> {"engine":"browser","operation":"search","params":{"query":"weather"},"confidence":0.99,"fallback_engine":"vision"}
"play avengers endgame scene from youtube" -> {"engine":"browser","operation":"play_video","params":{"query":"avengers endgame scene"},"confidence":0.99,"fallback_engine":"browser"}
"set volume to 60" -> {"engine":"system","operation":"set_volume","params":{"level":60},"confidence":0.99,"fallback_engine":"system"}
"create a ppt about photosynthesis" -> {"engine":"office","operation":"generate_ppt","params":{"topic":"photosynthesis","title":"Photosynthesis"},"confidence":0.99,"fallback_engine":"office"}
"open spotify and play lo fi" -> {"engine":"app","app_name":"Spotify","operation":"play_music","params":{"query":"lo fi"},"confidence":0.92,"fallback_engine":"vision"}
"create folder Projects on desktop" -> {"engine":"system","operation":"create_folder","params":{"name":"Projects","location":"Desktop"},"confidence":0.99,"fallback_engine":"system"}
"write me an email to my professor asking for extension" -> {"engine":"compose","operation":"draft_email","params":{"recipient":"professor","topic":"extension request"},"confidence":0.99,"fallback_engine":"compose"}
"click the blue button" -> {"engine":"vision","operation":"click_element","params":{"description":"blue button"},"confidence":0.85,"fallback_engine":"vision"}
"""

async def route_intent(user_message: str) -> RouterResult:
    """Fast intent classification. Target: <120ms."""
    if _mentions_gamma(user_message) and re.search(r"\b(create|make|generate|build|login|open)\b", user_message, flags=re.I) and re.search(r"\b(ppt|presentation|slides|deck)\b", user_message, flags=re.I):
        topic = _topic_from_presentation_text(user_message)
        return RouterResult(
            engine="browser",
            confidence=0.99,
            app_name="Gamma",
            operation="gamma_create_presentation",
            params={"topic": topic, "instructions": user_message, "url": "https://gamma.app"},
            fallback_engine="vision",
        )

    target = _extract_navigation_target(user_message)
    if target:
        url = resolve_url(target)
        method = _navigation_login_method(user_message)
        site = re.sub(r"^www\.", "", httpx.URL(url).host or "") if url else target
        return RouterResult(
            engine="browser",
            confidence=0.96,
            app_name="Chrome",
            operation="navigate_and_login" if method else "navigate",
            params={"url": url, "login": bool(method), "login_method": method, "site": site},
            fallback_engine="browser",
        )

    wa = _parse_whatsapp_message_command(user_message)
    if wa:
        params = wa["tasks"][0]["actions"][0]["parameters"]
        return RouterResult(
            engine="app",
            confidence=0.99,
            app_name="WhatsApp",
            operation="send_message",
            params={"contact": params["contact"], "message": params["message"], "send": params.get("send", True)},
            fallback_engine="vision",
        )
    try:
        llm = get_llm()
        resp = llm.invoke([
            HumanMessage(content=f"{ROUTER_PROMPT}\\n\\nUSER COMMAND: {user_message}\\n\\nReturn ONLY the valid JSON:")
        ])
        raw = resp.content if hasattr(resp, "content") else str(resp)
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\\s*", "", raw)
        raw = re.sub(r"\\s*```$", "", raw)
        
        data = json.loads(raw)
        data.setdefault("engine", "vision")
        data.setdefault("confidence", 0.5)
        data.setdefault("app_name", None)
        data.setdefault("operation", "unknown")
        data.setdefault("params", {})
        data.setdefault("fallback_engine", "vision")
        
        return RouterResult(**data)
    except Exception as e:
        logger.error(f"Routing failed: {e}")
        return RouterResult(
            engine="vision", confidence=0.5, app_name=None,
            operation="unknown", params={"goal": user_message},
            fallback_engine="vision"
        )


# ─── DETERMINISTIC APP COMMAND PARSERS ────────────────────────────────────────

def _clean_whatsapp_contact(value: str) -> str:
    value = re.sub(r'\b(?:open|launch)\b', ' ', value or '', flags=re.I)
    value = re.sub(r'\bwhats\s*app\b|\bwhatsapp\b|\bwa\b', ' ', value, flags=re.I)
    value = re.sub(r'\b(?:and|then|please|for|to|on|via|through|using|with)\b', ' ', value, flags=re.I)
    value = re.sub(r'\b(?:msg|message|send|text|tell|say|write|dm|search|find)\b', ' ', value, flags=re.I)
    value = re.sub(r'\b(?:her|him|them)\b', ' ', value, flags=re.I)
    return re.sub(r'\s+', ' ', value).strip(" \"'`")

def _parse_whatsapp_message_command(text: str) -> Optional[Dict]:
    raw = re.sub(r'\s+', ' ', text or '').strip()
    lower = raw.lower()
    if not re.search(r'\b(?:whatsapp|whats app|wa)\b', lower):
        return None
    if not re.search(r'\b(?:msg|message|send|text|tell|say|write|dm)\b', lower):
        return None

    contact = None
    message = None

    quoted = re.search(r'["\']([^"\']+)["\']\s*$', raw)
    if quoted:
        message = quoted.group(1).strip()
        before = raw[:quoted.start()].strip()
        m = re.search(r'\b(?:search|find)\s+(?:for\s+)?(.+?)\s+(?:and\s+)?(?:msg|message|send|text|tell|dm)\s+(?:her|him|them)?\s*$', before, flags=re.I)
        if not m:
            m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s*$', before, flags=re.I)
        contact = _clean_whatsapp_contact(m.group(1) if m else before)

    if not contact:
        m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?([^:]+):\s*(.+)$', raw, flags=re.I)
        if m:
            contact = _clean_whatsapp_contact(m.group(1))
            message = m.group(2).strip(" \"'`")

    if not contact:
        m = re.search(r'\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s+\b(?:that|saying)\b\s+(.+)$', raw, flags=re.I)
        if m:
            contact = _clean_whatsapp_contact(m.group(1))
            message = m.group(2).strip(" \"'`")

    if not contact:
        cleaned = re.sub(r'\b(?:open|launch)\s+whats\s*app(?:\s+and)?', ' ', raw, flags=re.I)
        cleaned = re.sub(r'\bwhatsapp\b|\bwhats app\b|\bwa\b', ' ', cleaned, flags=re.I)
        cleaned = re.sub(r'\b(?:msg|message|send|text|tell|say|write|dm)\b', ' ', cleaned, flags=re.I)
        cleaned = re.sub(r'\b(?:on|via|through|using|with)\b', ' ', cleaned, flags=re.I).strip()
        parts = cleaned.split()
        if len(parts) >= 2:
            contact = parts[0]
            message = ' '.join(parts[1:])

    if not contact or not message or len(contact) < 2 or len(message) < 1:
        return None

    return {
        "message": f"Sending WhatsApp message to {contact}.",
        "tasks": [{
            "id": 1,
            "description": f"Send WhatsApp message to {contact}: \"{message}\"",
            "needs_input": False,
            "input_fields": [],
            "actions": [{
                "name": "send_whatsapp_message",
                "parameters": {"contact": contact, "message": message, "send": True}
            }],
            "dependsOn": None,
            "parallel": False,
        }],
        "expected_result": ""
    }


# ─── PPT HELPER ──────────────────────────────────────────────────────────────

def _resolve_save_dir(friendly):
    import pathlib
    home = str(pathlib.Path.home())
    low = friendly.strip().lower()
    if low == "desktop":    return os.path.join(home, "Desktop")
    if low == "documents":  return os.path.join(home, "Documents")
    if low == "downloads":  return os.path.join(home, "Downloads")
    if os.path.isabs(friendly): return friendly
    return os.path.join(home, "Desktop")

# ─── FASTAPI ─────────────────────────────────────────────────────────────────

app = FastAPI(title="Pecifics AI Backend", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
async def health():
    vision = "cogagent" if COGAGENT_URL else ("gemini" if GEMINI_API_KEY else "none")
    ollama_ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{OLLAMA_URL.rstrip('/')}/api/tags")
            ollama_ok = resp.status_code == 200
    except Exception:
        ollama_ok = False
    return {"status": "ok", "version": "5.1.0-protocol-local-first", "llm": f"local-first/{OLLAMA_MODEL}",
            "cloud_llm": f"groq/{GROQ_MODEL}",
            "vision": vision, "cogagent_url": COGAGENT_URL or "not set",
            "phase5": {"sqlite_sessions": True, "chroma": HAS_CHROMA, "langgraph": HAS_LANGGRAPH},
            "protocols": {"enabled": True, "count": len(load_protocols())},
            "local_ai": {"ollama_url": OLLAMA_URL, "model": OLLAMA_MODEL, "available": ollama_ok},
            "groq_protocol_fallback": PROTOCOL_GROQ_FALLBACK,
            "timestamp": datetime.now().isoformat()}

# 2.1: Debug endpoint — verify context injection is working
@app.get("/debug/last_plan_input")
async def debug_last_plan_input():
    return {
        "last_raw_command": debug_store.get("last_raw"),
        "last_enriched_command": debug_store.get("last_enriched"),
        "last_context_injected": debug_store.get("last_context"),
    }

@app.get("/debug/recipe_usage")
async def debug_recipe_usage():
    return {
        "total_queries": debug_store.get("recipe_queries", 0),
        "recipes_applied": debug_store.get("recipes_applied", 0),
        "last_retrieved": debug_store.get("last_recipe_retrieved"),
        "last_applied": debug_store.get("last_recipe_applied"),
    }

@app.get("/debug/qwen_test")
async def debug_qwen_test():
    """Verify from the backend terminal/API whether local Qwen through Ollama is working."""
    logger.info("[QWEN] Debug test requested for %s at %s", OLLAMA_MODEL, OLLAMA_URL)
    started = time.time()
    try:
        async with httpx.AsyncClient(timeout=min(OLLAMA_TIMEOUT, 30)) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "Answer with one token only."},
                        {"role": "user", "content": "What is 2 plus 2?"},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 10},
                },
            )
        elapsed = round((time.time() - started) * 1000)
        if resp.status_code != 200:
            logger.warning("[QWEN] Debug test failed HTTP %s: %s", resp.status_code, resp.text[:500])
            return {
                "qwen_working": False,
                "status_code": resp.status_code,
                "latency_ms": elapsed,
                "ollama_url": OLLAMA_URL,
                "model": OLLAMA_MODEL,
                "fix_if_broken": "Run: ollama serve  then: ollama pull qwen2.5:3b",
            }
        data = resp.json()
        content = ((data.get("message") or {}).get("content") or data.get("response") or "").strip()
        logger.info("[QWEN] Debug test response in %sms: %r", elapsed, content[:200])
        return {
            "qwen_working": True,
            "response": content,
            "expected": "4",
            "correct": "4" in content,
            "latency_ms": elapsed,
            "ollama_url": OLLAMA_URL,
            "model": OLLAMA_MODEL,
        }
    except Exception as e:
        elapsed = round((time.time() - started) * 1000)
        logger.warning("[QWEN] Debug test failed after %sms: %s", elapsed, e)
        return {
            "qwen_working": False,
            "error": str(e),
            "latency_ms": elapsed,
            "ollama_url": OLLAMA_URL,
            "model": OLLAMA_MODEL,
            "fix_if_broken": "Run: ollama serve  then: ollama pull qwen2.5:3b",
        }

@app.get("/protocols")
async def protocols_endpoint():
    protocols = load_protocols(force=True)
    return {
        "success": True,
        "count": len(protocols),
        "protocols": protocol_summaries(),
    }

@app.post("/store_result_data")
async def store_result_data_endpoint(req: ResultDataPayload):
    session_id = req.session_id or "default"
    store_result_context(session_id, req.data, req.command or "")
    logger.info(
        "[CONTEXT] Stored result data for session=%s command=%r type=%s",
        session_id,
        (req.command or "")[:80],
        (req.data or {}).get("type"),
    )
    return {"stored": True, "session_id": session_id}

@app.post("/plan_protocol")
async def plan_protocol_endpoint(req: ProtocolPlanRequest):
    """Protocol-aware planner.

    This endpoint is intentionally conservative: deterministic protocol matches
    become executable task plans, recipe hits become reusable plans, and anything
    uncertain is routed to ask_user/vision instead of claiming false success.
    """
    session_id = req.session_id or str(uuid.uuid4())
    user_home = req.user_home or _USER_HOME.replace("\\\\", "\\")
    original_message = req.message
    logger.info("[PLANNER] Incoming session=%s command=%r", session_id, original_message)
    context_enriched = _enrich_with_active_context(original_message, req.app_state)
    if context_enriched != original_message:
        req.message = context_enriched
        logger.info("Activation context attached: %r -> %r", original_message, req.message)
    correlation = await correlate_followup_command(req.message, session_id, req.conversation_history)
    if correlation:
        req.message = correlation["enriched_command"]
        logger.info(
            "Semantic continuation: %r -> %r (%s)",
            original_message,
            req.message,
            correlation.get("reason", ""),
        )
    save_session_message(session_id, "user", original_message)

    result_continuation = _continuation_result_plan(original_message, session_id)
    if result_continuation:
        logger.info("[PLANNER] -> result-context continuation: %s", result_continuation.get("message"))
        result_continuation["session_id"] = session_id
        result_continuation["available_protocol_count"] = len(load_protocols())
        save_session_message(session_id, "assistant", result_continuation.get("message", ""))
        return JSONResponse(content=result_continuation)

    fast = trusted_fast_protocol_plan(req.message, user_home)
    if fast:
        logger.info("[PLANNER] -> fast path: %s/%s", fast.get("protocol_id"), fast.get("capability"))
        fast["session_id"] = session_id
        fast["available_protocol_count"] = len(load_protocols())
        save_session_message(session_id, "assistant", fast.get("message", ""))
        return JSONResponse(content=fast)

    continuation = _continuation_login_plan(req.message, session_id, req.conversation_history, user_home)
    if continuation:
        logger.info("[PLANNER] -> login continuation: %s", continuation.get("message"))
        continuation["session_id"] = session_id
        continuation["planner_model"] = "conversation-continuation"
        save_session_message(session_id, "assistant", continuation.get("message", ""))
        return JSONResponse(content=continuation)

    if re.search(r"\b(?:gmail|email|mail)\b", req.message, flags=re.I) and not re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", req.message):
        result = {
            "goal": req.message,
            "message": "What email address should I send this to?",
            "strategy": "ask_user",
            "protocol_id": "gmail.compose",
            "capability": "compose",
            "parameters": {},
            "tasks": [],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "",
            "session_id": session_id,
            "missing_parameters": ["to"],
            "planner_model": "local-email-safety",
            "suggestions": ["gmail.compose"],
        }
        save_session_message(session_id, "assistant", result["message"])
        return JSONResponse(content=result)

    similar_protocol_memory = query_protocol_run_memory(req.message)
    primary_choice = await _call_ollama_primary_intent(
        message=req.message,
        session_id=session_id,
        user_profile=req.user_profile or load_user_profile(),
        conversation_history=req.conversation_history,
        protocol_memory=similar_protocol_memory,
        app_state=req.app_state,
        browser_state=req.browser_state,
    )
    if primary_choice:
        result = _choice_to_protocol_plan(primary_choice, req.message, session_id)
        if result:
            logger.info("[PLANNER] -> qwen primary: %s/%s confidence=%s", result.get("protocol_id"), result.get("strategy"), result.get("planner_confidence"))
            if result.get("strategy") == "ask_user":
                rescue = deterministic_protocol_plan(req.message, user_home)
                if rescue and rescue.get("tasks"):
                    rescue["session_id"] = session_id
                    rescue["available_protocol_count"] = len(load_protocols())
                    rescue["planner_model"] = f"deterministic-rescue-after-ollama/{OLLAMA_MODEL}"
                    rescue["ollama_rejected_reason"] = result.get("planner_reason") or result.get("message")
                    save_session_message(session_id, "assistant", rescue.get("message", ""))
                    return JSONResponse(content=rescue)
            result["planner_model"] = f"ollama-primary/{OLLAMA_MODEL}"
            if similar_protocol_memory:
                result["protocol_memory_hint"] = similar_protocol_memory
            save_session_message(session_id, "assistant", result.get("message", ""))
            return JSONResponse(content=result)

    recipe = query_task_recipe(req.message)
    if recipe and recipe.get("actions"):
        result = {
            "goal": req.message,
            "message": "Reusing a successful task recipe from memory.",
            "strategy": "recipe",
            "protocol_id": None,
            "capability": "learned_recipe",
            "parameters": {},
            "tasks": [{
                "id": 1,
                "description": recipe.get("task") or req.message,
                "protocol_id": None,
                "needs_input": False,
                "input_fields": [],
                "actions": recipe["actions"],
                "dependsOn": None,
                "depends_on": [],
                "parallel": False,
                "risk": "low",
            }],
            "fallbacks": ["protocol", "vision", "ask_user"],
            "requires_confirmation": False,
            "expected_result": "Previously successful recipe is executed again.",
            "session_id": session_id,
            "memory_hit": True,
            "recipe_distance": recipe.get("distance"),
        }
        save_session_message(session_id, "assistant", result["message"])
        return JSONResponse(content=result)

    direct = deterministic_protocol_plan(req.message, user_home)
    if direct:
        direct["session_id"] = session_id
        direct["available_protocol_count"] = len(load_protocols())
        direct["planner_model"] = "deterministic-fallback"
        save_session_message(session_id, "assistant", direct.get("message", ""))
        return JSONResponse(content=direct)

    # Lightweight LLM protocol selection for commands that are not covered by
    # deterministic parsers. Ollama is tried first; Groq is the cloud fallback.
    prompt = f"""You are Pecifics' protocol planner.
Available protocols:
{json.dumps(protocol_summaries(), indent=2)}

User command: {req.message}
User profile: {json.dumps(req.user_profile or load_user_profile())[:3000]}
Similar successful/failed protocol memory:
{json.dumps(similar_protocol_memory or {}, indent=2)[:2500]}

Return ONLY JSON:
{{
  "strategy": "protocol|dom|vision|ask_user",
  "protocol_id": "one available protocol id or null",
  "parameters": {{}},
  "confidence": 0.0,
  "reason": "short reason"
}}

Rules:
- Use protocol only if parameters are clearly available.
- If the command says "message", "msg", "text", "tell", or "send" with a contact and message, choose whatsapp.send_message when no other messaging app is specified.
- For whatsapp.send_message, extract contact as the person/group name and message as the text to send.
- If Telegram is explicitly named, choose telegram.send_message instead of WhatsApp.
- For Gmail/email commands with recipient, subject, and body, choose gmail.compose.
- For "save/store my Google account/credentials/login", choose credentials.save_google_account and request missing email/password as inputs.
- If similar memory includes blockers_resolved and resolution_path, keep the same protocol and include that recovery expectation in the plan metadata.
- Sending/submitting/deleting/purchasing requires confirmation unless the protocol is already trusted.
- If required parameters are missing, use ask_user.
- If no protocol fits, use vision only for visible GUI tasks; otherwise ask_user."""

    ollama_choice = await _call_ollama_protocol_choice(prompt)
    if ollama_choice:
        result = _choice_to_protocol_plan(ollama_choice, req.message, session_id)
        if result:
            result["planner_model"] = f"ollama/{OLLAMA_MODEL}"
            save_session_message(session_id, "assistant", result.get("message", ""))
            return JSONResponse(content=result)

    similarity = await _call_ollama_protocol_similarity(req.message)
    if similarity:
        guessed_id = similarity.get("protocol_id")
        guessed_conf = float(similarity.get("confidence") or 0)
        if guessed_id in load_protocols() and guessed_conf >= 0.62:
            if guessed_id == "google_forms.fill":
                params = _params_for_protocol_guess(guessed_id, req.message, user_home) or {
                    "auto_answer": True,
                    "user_context": req.message,
                    "submit": False,
                }
                result = _protocol_plan(
                    message=req.message,
                    protocol_id="google_forms.fill",
                    params=params,
                    description="Understand and fill Google Form",
                    requires_confirmation=True,
                    risk="medium",
                )
                result["session_id"] = session_id
                result["planner_model"] = f"ollama-similarity/{OLLAMA_MODEL}"
                result["planner_confidence"] = guessed_conf
                result["planner_reason"] = similarity.get("reason", "")
                save_session_message(session_id, "assistant", result["message"])
                return JSONResponse(content=result)

            params = _params_for_protocol_guess(guessed_id, req.message, user_home)
            if params is not None:
                protocol = load_protocols()[guessed_id]
                inferred = guessed_id == "whatsapp.send_message" and "whatsapp" not in req.message.lower()
                result = _protocol_plan(
                    message=req.message,
                    protocol_id=guessed_id,
                    params=params,
                    description=f"{protocol.get('description', guessed_id)}",
                    requires_confirmation=bool(protocol.get("requires_confirmation", False)) or inferred,
                )
                result["session_id"] = session_id
                result["planner_model"] = f"ollama-similarity/{OLLAMA_MODEL}"
                result["planner_confidence"] = guessed_conf
                result["planner_reason"] = similarity.get("reason", "")
                save_session_message(session_id, "assistant", result.get("message", ""))
                return JSONResponse(content=result)

    if re.search(r"\b(?:gmail|email|mail)\b", req.message, flags=re.I) and not re.search(r"[^@\s]+@[^@\s]+\.[^@\s]+", req.message):
        result = {
            "goal": req.message,
            "message": "What email address should I send this to?",
            "strategy": "ask_user",
            "protocol_id": "gmail.compose",
            "capability": "compose",
            "parameters": {},
            "tasks": [],
            "fallbacks": ["ask_user"],
            "requires_confirmation": False,
            "expected_result": "",
            "session_id": session_id,
            "missing_parameters": ["to"],
            "planner_model": "local-email-safety",
            "suggestions": ["gmail.compose"],
        }
        save_session_message(session_id, "assistant", result["message"])
        return JSONResponse(content=result)

    if should_try_groq_protocol_fallback(req.message):
        try:
            llm = get_llm()
            raw = _call(llm, prompt).strip()
            choice = _parse_json_block(raw)
            result = _choice_to_protocol_plan(choice, req.message, session_id)
            if result:
                result["planner_model"] = f"groq/{GROQ_MODEL}"
                save_session_message(session_id, "assistant", result.get("message", ""))
                return JSONResponse(content=result)
        except Exception as e:
            logger.info(f"Protocol Groq fallback skipped/fell through: {e}")
    else:
        logger.info("Skipping Groq protocol fallback by local-first policy")

    result = {
        "goal": req.message,
        "message": "I understood the request, but I am not confident which app/protocol should handle it. Tell me the app to use or rephrase the action.",
        "strategy": "ask_user",
        "protocol_id": None,
        "capability": None,
        "parameters": {},
        "tasks": [],
        "fallbacks": ["vision", "ask_user"],
        "requires_confirmation": False,
        "expected_result": "",
        "session_id": session_id,
        "suggestions": suggest_closest_protocols(req.message),
    }
    save_session_message(session_id, "assistant", result["message"])
    return JSONResponse(content=result)

@app.post("/generate_form_answers")
async def generate_form_answers_endpoint(req: FormAnswerRequest):
    """Generate a reviewable answer draft for a detected Google Form schema.

    This endpoint does not submit anything. The desktop executor uses the
    answer draft to show a preview and only fills/submits after confirmation.
    """
    questions = req.questions or []
    if not questions:
        return JSONResponse(content={
            "success": False,
            "error_class": "no_questions",
            "error": "No form questions were provided.",
            "answers": [],
        })

    profile = req.user_profile or load_user_profile()
    safe_questions = []
    for q in questions[:80]:
        safe_questions.append({
            "index": q.get("index"),
            "question": str(q.get("question") or q.get("text") or "")[:500],
            "type": q.get("type") or "unknown",
            "options": (q.get("options") or [])[:30],
            "required": bool(q.get("required")),
        })

    prompt = f"""You generate draft answers for a Google Form on behalf of the user.

User profile JSON:
{json.dumps(profile, ensure_ascii=True, indent=2)[:4500]}

User-provided context/instructions:
{(req.user_context or req.command or "")[:2500]}

Detected form questions:
{json.dumps(safe_questions, ensure_ascii=True, indent=2)}

Return ONLY valid JSON:
{{
  "answers": [
    {{
      "index": 0,
      "question": "exact question text",
      "answer": "answer text or selected option",
      "confidence": 0.0,
      "needs_review": true,
      "reason": "short reason"
    }}
  ],
  "needs_review_count": 0,
  "overall_confidence": 0.0
}}

Rules:
- Never invent private identifiers, registration numbers, addresses, grades, phone numbers, or dates.
- If a required answer is missing from the profile/context, answer with an empty string and needs_review true.
- For multiple choice/radio/dropdown, the answer must match one of the provided options exactly when possible.
- For checkbox questions, return a comma-separated list of matching options.
- For opinion/essay questions, write a concise, genuine answer based only on the user context/profile.
- For submit/send-sensitive forms, these answers are only a draft for user review."""

    async def ask_ollama() -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=max(OLLAMA_TIMEOUT, 60)) as client:
                resp = await client.post(
                    f"{OLLAMA_URL.rstrip('/')}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "stream": False,
                        "messages": [
                            {"role": "system", "content": "Return only valid JSON. No markdown."},
                            {"role": "user", "content": prompt},
                        ],
                        "options": {"temperature": 0.1, "num_predict": 1200},
                    },
                )
            if resp.status_code != 200:
                return None
            content = (resp.json().get("message") or {}).get("content") or ""
            try:
                parsed = _parse_json_block(content)
            except Exception:
                text = re.sub(r"^```(?:json)?\s*", "", (content or "").strip())
                text = re.sub(r"\s*```$", "", text)
                start, end = text.find("["), text.rfind("]")
                if start >= 0 and end > start:
                    parsed = json.loads(text[start:end + 1])
                else:
                    raise
            if isinstance(parsed, list):
                return {"answers": parsed}
            return parsed
        except Exception as e:
            logger.debug(f"Ollama form answer generation failed: {e}")
            return None

    result = await ask_ollama()
    if not result and should_try_groq_protocol_fallback(req.user_context or req.command or "google form"):
        try:
            llm = get_llm()
            result = _parse_json_block(_call(llm, prompt).strip())
        except Exception as e:
            logger.debug(f"Groq form answer generation failed: {e}")

    if not result or not isinstance(result.get("answers"), list):
        fallback_answers = [{
            "index": q.get("index"),
            "question": q.get("question"),
            "answer": "",
            "confidence": 0.0,
            "needs_review": True,
            "reason": "The local model could not generate a safe answer.",
        } for q in safe_questions]
        return JSONResponse(content={
            "success": False,
            "error_class": "answer_generation_failed",
            "error": "Could not generate reliable form answers.",
            "answers": fallback_answers,
            "needs_review_count": len(fallback_answers),
            "overall_confidence": 0.0,
        })

    answers = result.get("answers") or []
    needs_review_count = sum(1 for a in answers if a.get("needs_review") or float(a.get("confidence") or 0) < 0.72)
    return JSONResponse(content={
        "success": True,
        "answers": answers,
        "needs_review_count": int(result.get("needs_review_count") or needs_review_count),
        "overall_confidence": float(result.get("overall_confidence") or 0),
    })

REACT_TOOLS = [
    {"tool": "run_protocol", "description": "Execute a known Pecifics protocol by id.", "parameters": {"protocol_id": "protocol id", "params": {}}},
    {"tool": "navigate", "description": "Open a URL in the user's Chrome browser.", "parameters": {"url": "https://..."}},
    {"tool": "click_element", "description": "Click a visible element by text, role, placeholder, or optional selector.", "parameters": {"text": "visible label", "selector": "optional CSS selector"}},
    {"tool": "fill_field", "description": "Fill a browser field by label, placeholder, name, id, or selector.", "parameters": {"selector": "field name/label/selector", "value": "text"}},
    {"tool": "keyboard", "description": "Press a key or shortcut.", "parameters": {"keys": "Enter, Tab, Escape, Ctrl+Enter, etc."}},
    {"tool": "wait", "description": "Wait for UI/network settling.", "parameters": {"seconds": 1}},
    {"tool": "probe_state", "description": "Probe current browser/window state before deciding.", "parameters": {}},
    {"tool": "ask_user", "description": "Ask user for missing info or confirmation.", "parameters": {"question": "question"}},
    {"tool": "done", "description": "Task is complete.", "parameters": {"result": "summary"}},
]

def _materialize_react_actions(tool: str, params: Dict[str, Any], goal: str) -> List[Dict[str, Any]]:
    tool = str(tool or "").strip()
    params = params if isinstance(params, dict) else {}
    if tool == "run_protocol":
        protocol_id = params.get("protocol_id") or params.get("id")
        raw_params = params.get("params") or params.get("parameters") or {}
        if protocol_id not in load_protocols():
            return []
        normalized = _normalize_protocol_params(protocol_id, raw_params, goal, _USER_HOME.replace("\\\\", "\\"))
        return protocol_to_actions(protocol_id, normalized)
    if tool == "navigate":
        url = resolve_url(params.get("url") or params.get("site") or params.get("target") or "")
        return [{"name": "navigate_and_login", "parameters": {"url": url, "login": False, "site": re.sub(r"^www\.", "", httpx.URL(url).host or "") if url else ""}}] if url else []
    if tool == "click_element":
        return [{"name": "click_text", "parameters": {"text": params.get("text") or params.get("label") or "", "selector": params.get("selector")}}]
    if tool == "fill_field":
        return [{"name": "fill_field", "parameters": {"selector": params.get("selector") or params.get("field") or params.get("label") or "", "value": params.get("value") or params.get("text") or ""}}]
    if tool == "keyboard":
        return [{"name": "press_key", "parameters": {"key": params.get("keys") or params.get("key") or "Enter"}}]
    if tool == "wait":
        return [{"name": "wait", "parameters": {"seconds": params.get("seconds") or params.get("ms") or 1}}]
    if tool == "probe_state":
        return [{"name": "browser_probe_state", "parameters": {}}]
    return []

def _extract_goal_search_query(goal: str) -> str:
    text = re.sub(r"\s+", " ", goal or "").strip()
    patterns = [
        r"\bsearch\s+(?:for\s+)?(.+)$",
        r"\bfind\s+(.+)$",
        r"\blook\s+for\s+(.+)$",
    ]
    for pattern in patterns:
        m = re.search(pattern, text, flags=re.I)
        if m:
            query = m.group(1)
            query = re.sub(r"\s+(?:on|in|at)\s+(?:amazon|google|youtube).*$", "", query, flags=re.I)
            return query.strip(" \"'`")
    return ""

def _react_history_has_successful_action(history: List[Dict[str, Any]], action_name: str) -> bool:
    wanted = str(action_name or "").lower()
    for item in history or []:
        result = item.get("result") if isinstance(item, dict) else {}
        details = result.get("details") if isinstance(result, dict) else []
        for detail in details or []:
            name = str(detail.get("action") or "").lower()
            detail_result = detail.get("result") if isinstance(detail, dict) else {}
            if name == wanted and isinstance(detail_result, dict) and detail_result.get("success") is not False:
                return True
    return False

def _react_history_successful_search(history: List[Dict[str, Any]]) -> bool:
    return _react_history_has_successful_action(history, "fill_field") and _react_history_has_successful_action(history, "press_key")

def _query_tokens_present_in_url(query: str, url: str) -> bool:
    if not query or not url:
        return False
    lower_url = str(url).lower().replace("+", " ").replace("%20", " ")
    tokens = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]
    if not tokens:
        return False
    hits = sum(1 for token in tokens if token in lower_url)
    return hits >= max(1, min(2, len(tokens)))

def _fallback_react_step(req: ReactStepRequest, reason: str = "Local model did not return valid JSON") -> Dict[str, Any]:
    goal = re.sub(r"\s+", " ", req.goal or "").strip()
    state = req.current_state or {}
    browser = state.get("browser") if isinstance(state.get("browser"), dict) else {}
    current_url = str(browser.get("url") or browser.get("state", {}).get("url") or "")
    target = _extract_navigation_target(goal)
    if target:
        url = resolve_url(target)
        host = ""
        try:
            host = re.sub(r"^www\.", "", httpx.URL(url).host or "")
        except Exception:
            host = target
        if url and host and host not in current_url:
            return {
                "success": True,
                "goal": goal,
                "thought": f"{reason}. Fallback: open the requested site before doing page-specific work.",
                "tool": "navigate",
                "parameters": {"url": url},
                "confidence": 0.68,
                "probe_after": True,
                "stop": None,
                "actions": _materialize_react_actions("navigate", {"url": url}, goal),
                "step_num": req.step_num,
                "fallback": True,
            }

    query = _extract_goal_search_query(goal)
    if query and re.search(r"amazon\.", current_url, flags=re.I):
        if _react_history_successful_search(req.history or []) or _query_tokens_present_in_url(query, current_url):
            return {
                "success": True,
                "goal": goal,
                "thought": f"{reason}. Fallback: Amazon search appears complete, so stop instead of repeating the search.",
                "tool": "done",
                "parameters": {"result": f"Amazon search results are open for {query}."},
                "confidence": 0.78,
                "probe_after": False,
                "stop": "done",
                "actions": [],
                "message": f"Amazon search results are open for {query}.",
                "step_num": req.step_num,
                "fallback": True,
            }
        return {
            "success": True,
            "goal": goal,
            "thought": f"{reason}. Fallback: fill Amazon search and press Enter.",
            "tool": "fill_field",
            "parameters": {"selector": "twotabsearchtextbox", "value": query},
            "confidence": 0.66,
            "probe_after": True,
            "stop": None,
            "actions": [
                {"name": "fill_field", "parameters": {"selector": "twotabsearchtextbox", "value": query}},
                {"name": "press_key", "parameters": {"key": "Enter"}},
            ],
            "step_num": req.step_num,
            "fallback": True,
        }

    if query and re.search(r"google\.", current_url, flags=re.I):
        if _react_history_successful_search(req.history or []) or _query_tokens_present_in_url(query, current_url):
            return {
                "success": True,
                "goal": goal,
                "thought": f"{reason}. Fallback: Google search appears complete, so stop instead of repeating the search.",
                "tool": "done",
                "parameters": {"result": f"Google search results are open for {query}."},
                "confidence": 0.76,
                "probe_after": False,
                "stop": "done",
                "actions": [],
                "message": f"Google search results are open for {query}.",
                "step_num": req.step_num,
                "fallback": True,
            }
        return {
            "success": True,
            "goal": goal,
            "thought": f"{reason}. Fallback: fill the search field and press Enter.",
            "tool": "fill_field",
            "parameters": {"selector": "q", "value": query},
            "confidence": 0.62,
            "probe_after": True,
            "stop": None,
            "actions": [
                {"name": "fill_field", "parameters": {"selector": "q", "value": query}},
                {"name": "press_key", "parameters": {"key": "Enter"}},
            ],
            "step_num": req.step_num,
            "fallback": True,
        }

    return {
        "success": False,
        "goal": goal,
        "thought": reason,
        "tool": "ask_user",
        "parameters": {"question": "I could not reason safely about the next step. Should I retry or use vision?"},
        "confidence": 0.0,
        "probe_after": False,
        "stop": "need_user",
        "actions": [],
        "step_num": req.step_num,
        "fallback": True,
    }

def _react_stop_response(goal: str, stop: str, thought: str, params: Dict[str, Any], step_num: int) -> Dict[str, Any]:
    return {
        "success": True,
        "goal": goal,
        "thought": thought,
        "tool": params.get("tool") or "done",
        "parameters": params,
        "confidence": 1.0,
        "stop": stop,
        "actions": [],
        "message": params.get("result") or params.get("question") or thought,
        "step_num": step_num,
    }

async def _generate_learned_protocol_json(prompt: str) -> Optional[Dict[str, Any]]:
    """Local-first JSON generator used by the protocol learner."""
    try:
        async with httpx.AsyncClient(timeout=max(OLLAMA_TIMEOUT, 30)) as client:
            resp = await client.post(
                f"{OLLAMA_URL.rstrip('/')}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": [
                        {"role": "system", "content": "Return only valid JSON. No markdown."},
                        {"role": "user", "content": prompt},
                    ],
                    "options": {"temperature": 0.0, "num_predict": 1200},
                },
            )
        if resp.status_code == 200:
            content = (resp.json().get("message") or {}).get("content") or resp.json().get("response") or ""
            try:
                return _parse_json_block(content)
            except Exception:
                pass
    except Exception as e:
        logger.debug(f"Protocol learner Ollama generation failed: {e}")

    if should_try_groq_protocol_fallback(prompt):
        try:
            return _parse_json_block(_call(get_llm(), prompt).strip())
        except Exception as e:
            logger.debug(f"Protocol learner Groq fallback failed: {e}")
    return None

@app.post("/learn_from_react_run")
async def learn_from_react_run(req: ReactRunLearnRequest):
    result = await protocol_learner.learn_from_react_run(
        goal=req.goal,
        history=req.history or [],
        success=bool(req.success),
        json_generator=_generate_learned_protocol_json,
    )
    if result.get("learned") or result.get("updated"):
        load_protocols(force=True)
    return result

@app.get("/learned_protocols")
async def learned_protocols_endpoint():
    return protocol_learner.learned_protocols()

@app.post("/cancel_task")
async def cancel_task_endpoint(req: CancelTaskRequest):
    cancelled = cancel_registered_task(req.task_id)
    await broadcast_event({
        "type": "task_cancelled",
        "task_id": req.task_id,
        "cancelled": cancelled,
        "timestamp": datetime.now().isoformat(),
    })
    return {"success": True, "cancelled": cancelled, "task_id": req.task_id}

@app.post("/voice_state")
async def voice_state_endpoint(req: VoiceStateRequest):
    event = {
        "type": "voice_state",
        "state": re.sub(r"[^a-z_]+", "", str(req.state or "ready").lower()) or "ready",
        "text": req.text or "",
        "command": req.command or "",
        "timestamp": datetime.now().isoformat(),
    }
    await broadcast_event(event)
    return {"success": True, "event": event}

@app.post("/react_next_step")
async def react_next_step(req: ReactStepRequest):
    """Return one ReAct reasoning step. Electron executes returned actions."""
    goal = re.sub(r"\s+", " ", req.goal or "").strip()
    if not goal:
        return {"success": False, "stop": "failed", "message": "No goal provided.", "actions": []}

    prompt = f"""You are Pecifics, a Windows desktop LAM. You execute complex tasks by thinking one step at a time.

Available tools:
{json.dumps(REACT_TOOLS, indent=2)}

Known protocols:
{build_protocol_list_for_prompt()}

Goal:
{goal}

Step {req.step_num} of maximum {req.max_steps}

Execution history:
{json.dumps((req.history or [])[-8:], ensure_ascii=True, indent=2)[:5000]}

Current observed state:
{json.dumps(req.current_state or {}, ensure_ascii=True, indent=2)[:4500]}

Return ONLY valid JSON:
{{
  "thought": "what you observe, whether the previous step worked, and what to do next",
  "tool": "run_protocol|navigate|click_element|fill_field|keyboard|wait|probe_state|ask_user|done",
  "parameters": {{}},
  "confidence": 0.0,
  "probe_after": true,
  "stop": null
}}

Rules:
- Prefer run_protocol when a known protocol can complete the next step.
- Use direct browser tools only for small page interactions inside the currently open site.
- If the state shows login/2FA/captcha/payment/risky submit/send/delete, use ask_user and stop "need_user".
- Never claim done until the observed state/history supports completion.
- If the same action failed previously, choose a different tool or ask_user.
- For Amazon search, first navigate to Amazon if needed, then fill the search field (selector twotabsearchtextbox if useful), then press Enter.
- Risky actions such as send, submit, delete, purchase, or checkout must stop "need_user" before execution."""

    async def ask_ollama() -> Optional[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=max(OLLAMA_TIMEOUT, 25)) as client:
                resp = await client.post(
                    f"{OLLAMA_URL.rstrip('/')}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "stream": False,
                        "messages": [
                            {"role": "system", "content": "Return only valid JSON. No markdown."},
                            {"role": "user", "content": prompt},
                        ],
                        "options": {"temperature": 0.0, "num_predict": 700},
                    },
                )
            if resp.status_code != 200:
                return None
            content = (resp.json().get("message") or {}).get("content") or ""
            return _parse_json_block(content)
        except Exception as e:
            logger.debug(f"ReAct Ollama step failed: {e}")
            return None

    thought_obj = await ask_ollama()
    if not thought_obj and should_try_groq_protocol_fallback(goal):
        try:
            thought_obj = _parse_json_block(_call(get_llm(), prompt).strip())
        except Exception as e:
            logger.debug(f"ReAct Groq fallback failed: {e}")

    if not thought_obj:
        return _fallback_react_step(req, "The local reasoning model did not return valid JSON")

    tool = str(thought_obj.get("tool") or "").strip()
    params = thought_obj.get("parameters") if isinstance(thought_obj.get("parameters"), dict) else {}
    stop = thought_obj.get("stop")
    thought = str(thought_obj.get("thought") or "")
    confidence = float(thought_obj.get("confidence") or 0)

    if tool == "done" or stop == "done":
        return _react_stop_response(goal, "done", thought or "Task complete.", {"result": params.get("result") or "Task complete."}, req.step_num)
    if tool == "ask_user" or stop in ("need_user", "blocked"):
        return _react_stop_response(goal, "need_user", thought or "User input is needed.", {"question": params.get("question") or thought}, req.step_num)
    if stop == "failed":
        return _react_stop_response(goal, "failed", thought or "Task failed.", {"question": thought or "Task failed."}, req.step_num)

    actions = _materialize_react_actions(tool, params, goal)
    if not actions:
        return _fallback_react_step(req, thought or f"Could not materialize tool {tool}")

    return {
        "success": True,
        "goal": goal,
        "thought": thought,
        "tool": tool,
        "parameters": params,
        "confidence": confidence,
        "probe_after": bool(thought_obj.get("probe_after", True)),
        "stop": None,
        "actions": actions,
        "step_num": req.step_num,
    }

@app.post("/chat")
async def chat(req: ChatRequest):
    fast_whatsapp = _parse_whatsapp_message_command(req.message)
    if fast_whatsapp:
        fast_whatsapp["session_id"] = req.session_id or str(uuid.uuid4())
        save_session_message(fast_whatsapp["session_id"], "user", req.message)
        save_session_message(fast_whatsapp["session_id"], "assistant", fast_whatsapp["message"])
        return JSONResponse(content=fast_whatsapp)

    try: get_llm()
    except Exception as e: raise HTTPException(503, f"LLM unavailable: {e}")
    try:
        session_id = req.session_id or str(uuid.uuid4())
        persistent_history = load_session_messages(session_id)
        combined_history = (persistent_history + (req.conversation_history or []))[-20:]
        recipe = query_task_recipe(req.message)
        if recipe and recipe.get("actions"):
            result = {
                "message": "Reusing a successful task recipe from memory.",
                "tasks": [{
                    "id": 1,
                    "description": recipe.get("task") or req.message,
                    "needs_input": False,
                    "input_fields": [],
                    "actions": recipe["actions"],
                    "dependsOn": None,
                    "parallel": False,
                }],
                "expected_result": "Previously successful recipe is executed again.",
                "session_id": session_id,
                "memory_hit": True,
                "recipe_distance": recipe.get("distance"),
            }
            save_session_message(session_id, "user", req.message)
            save_session_message(session_id, "assistant", result["message"])
            return JSONResponse(content=result)
        extra = ""
        if req.user_home:
            extra = f"\nFRONTEND_USER_HOME: {req.user_home.replace(chr(92), chr(92)*2)}"
        result = plan_tasks(req.message, req.screenshot, combined_history,
                           req.screen_width or 1920, req.screen_height or 1080,
                           req.user_choice, extra)
        result["session_id"] = session_id
        save_session_message(session_id, "user", req.message)
        save_session_message(session_id, "assistant", result.get("message", ""))
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(500, str(e))

@app.post("/route")
async def route_endpoint(req: ChatRequest):
    try:
        result = await route_intent(req.message)
        try:
            if result.engine == "app" and (result.app_name or "").lower().replace(" ", "") in ("whatsapp", "telegram"):
                contact = (result.params or {}).get("contact") or (result.params or {}).get("recipient")
                if contact:
                    profile = load_user_profile()
                    profile.setdefault("frequent_contacts", {})[str(contact).lower()] = str(contact)
                    save_user_profile(profile)
        except Exception as e:
            logger.debug(f"Profile update skipped: {e}")
        return JSONResponse(content=result.model_dump())
    except Exception as e:
        logger.error(f"Routing endpoint failed: {e}")
        return JSONResponse(content={
            "engine": "vision",
            "confidence": 0.5,
            "app_name": None,
            "operation": "unknown",
            "params": {"goal": req.message},
            "fallback_engine": "vision"
        })

@app.post("/vision_act")
async def vision_act(req: VisionActRequest):
    # Update global COGAGENT_URL if frontend sent one (persists for session)
    global COGAGENT_URL
    if req.cogagent_url and req.cogagent_url.strip():
        COGAGENT_URL = req.cogagent_url.strip()
        logger.info(f"CogAgent URL updated from request: {COGAGENT_URL}")
    return await run_vision_state_machine(req)

@app.post("/vision_act_local")
async def vision_act_local(req: VisionActRequest):
    return await local_florence_ground(req.screenshot, req.goal, req.screen_width or 1920, req.screen_height or 1080)

@app.post("/store_recipe")
async def store_recipe(req: StoreRecipeRequest):
    return store_task_recipe(req.task, req.actions, req.result)

@app.post("/query_recipe")
async def query_recipe(req: QueryRecipeRequest):
    recipe = query_task_recipe(req.task, req.max_distance)
    return {"success": bool(recipe), "recipe": recipe}

@app.post("/store_protocol_run")
async def store_protocol_run_endpoint(req: ProtocolRunRequest):
    return store_protocol_run(req)

@app.get("/protocol_confidence")
async def protocol_confidence_endpoint(protocol_id: Optional[str] = None):
    return protocol_confidence(protocol_id)

@app.post("/draft_protocol_from_trace")
async def draft_protocol_from_trace(req: DraftProtocolRequest):
    if not req.success:
        return {"success": False, "error": "Only successful traces can become draft protocols."}
    safe_domain = re.sub(r"[^a-z0-9_]+", "_", (req.app or "learned").lower()).strip("_") or "learned"
    capability = re.sub(r"[^a-z0-9_]+", "_", (req.goal or req.command or "task").lower()).strip("_")[:48] or "task"
    steps = []
    for idx, item in enumerate(req.trace[:30], start=1):
        action = item.get("action") or item.get("name")
        if not action:
            continue
        steps.append({
            "id": f"step_{idx}",
            "primitive": item.get("primitive") or "learned_trace",
            "action": action,
            "parameters": item.get("parameters") or item.get("params") or {},
        })
    draft = {
        "id": f"{safe_domain}.{capability}.draft",
        "version": "0.1.0-draft",
        "domain": safe_domain,
        "capability": capability,
        "description": f"Draft learned protocol from: {req.command}",
        "risk": "medium",
        "requires_confirmation": True,
        "parameters": {},
        "steps": steps,
        "state_checks": [],
        "verification": ["manual_review_required"],
        "fallbacks": ["targeted_vision", "ask_user"],
        "trusted": False,
        "promotion_rule": "Require 2-3 verified reruns before trusting this protocol."
    }
    return {"success": True, "draft_protocol": draft}

@app.get("/stream")
async def stream():
    q: asyncio.Queue = asyncio.Queue()
    _sse_clients.append(q)

    async def gen():
        try:
            yield f"data: {json.dumps({'type':'connected','timestamp':datetime.now().isoformat()})}\n\n"
            while True:
                event = await q.get()
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            try: _sse_clients.remove(q)
            except ValueError: pass

    return StreamingResponse(gen(), media_type="text/event-stream")

@app.get("/voice_stream")
async def voice_stream():
    # Compatibility alias for voice-only clients. Events currently share the
    # backend SSE bus with proactive alerts and task cancellation notices.
    return await stream()

@app.post("/proactive_check")
async def proactive_check(req: AnalyzeScreenRequest):
    desc = describe_screenshot(req.screenshot or "") if req.screenshot else ""
    alerts = []
    if re.search(r"\b(error|failed|exception|traceback|low battery|not responding)\b", desc, re.I):
        alerts.append({"type": "screen_alert", "message": desc[:240], "severity": "warning"})
    if alerts:
        await broadcast_event({"type": "proactive_alert", "alerts": alerts, "timestamp": datetime.now().isoformat()})
    return {"success": True, "alerts": alerts, "description": desc}

@app.post("/set_config")
async def set_config(req: dict):
    """Update runtime config from frontend settings panel."""
    global COGAGENT_URL, GEMINI_API_KEY
    updated = []
    if req.get("cogagent_url"):
        COGAGENT_URL = req["cogagent_url"].strip()
        updated.append(f"COGAGENT_URL={COGAGENT_URL}")
    if req.get("gemini_api_key"):
        GEMINI_API_KEY = req["gemini_api_key"].strip()
        updated.append("GEMINI_API_KEY=***")
    logger.info(f"Config updated: {updated}")
    return {"success": True, "updated": updated}

@app.post("/verify")
async def verify(req: VerifyRequest):
    return JSONResponse(content=verify_completion(req.screenshot, req.task, req.expected_result))

@app.post("/analyze_screen")
async def analyze_screen(req: AnalyzeScreenRequest):
    desc = describe_screenshot(req.screenshot or "")
    return {"answer": desc, "description": desc}

@app.post("/check_browser_state")
async def check_browser_state(req: BrowserStateRequest):
    if not req.screenshot or not (HAS_GEMINI and GEMINI_API_KEY):
        return {"state": "clear", "can_auto_handle": False, "needs_user": False}
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel(GEMINI_MODEL)
        resp = model.generate_content([
            'Analyze browser screenshot for blockers. Return JSON: {"state":"clear|cookie_consent|2fa|captcha|error","description":"...","can_auto_handle":true/false,"needs_user":true/false,"user_message":"..."}',
            {"mime_type": "image/jpeg", "data": base64.b64decode(req.screenshot)}
        ])
        raw = resp.text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        return json.loads(raw.strip())
    except:
        return {"state": "clear", "can_auto_handle": False, "needs_user": False}

@app.post("/next_step")
async def next_step(req: NextStepRequest):
    try: llm = get_llm()
    except: return {"decision": "continue", "next_actions": []}
    
    screen = describe_screenshot(req.screenshot) if req.screenshot else "No screenshot."
    prompt = f"""TASK: {req.original_task}
LAST: {json.dumps(req.last_action)} → {json.dumps(req.last_result)}
SCREEN: {screen}
REMAINING: {json.dumps(req.remaining_actions[:3])}

Decide: continue|replace|done. Return JSON: {{"decision":"...","message":"...","next_actions":[]}}"""
    try:
        raw = _call(llm, prompt).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        result = json.loads(raw)
        result.setdefault("decision", "continue")
        result.setdefault("next_actions", [])
        return result
    except:
        return {"decision": "continue", "next_actions": []}

@app.post("/generate_ppt")
async def generate_ppt_endpoint(req: GeneratePPTRequest):
    try: llm = get_llm()
    except Exception as e: raise HTTPException(503, str(e))
    
    title = req.title or req.topic.title()
    content_prompt = f"""Generate {req.num_slides} slides about: {req.topic}
Title: {title}
{"Instructions: " + req.additional_instructions if req.additional_instructions else ""}
Return JSON array: hero, two_column, big_number, comparison, quote types.
First=hero, last=quote. Be specific."""
    
    try:
        raw = _call(llm, content_prompt).strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        slides_data = json.loads(raw)
        if not isinstance(slides_data, list): slides_data = [slides_data]
    except:
        slides_data = [
            {"type": "hero", "title": title, "subtitle": "Presentation"},
            {"type": "quote", "quote": "The future belongs to those who prepare.", "author": "Malcolm X"}
        ]
    
    try:
        from ppt_generator_pro import (PREMIUM_THEMES, create_hero_slide, create_two_column_slide,
            create_big_number_slide, create_comparison_slide, create_quote_slide, add_slide_transition_advanced)
        from pptx import Presentation as PptxPresentation
        from pptx.util import Inches
        
        prs = PptxPresentation()
        prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
        colors = PREMIUM_THEMES.get(req.theme.lower().replace(" ","_"), PREMIUM_THEMES.get("gamma_modern"))
        
        for idx, sd in enumerate(slides_data):
            t = sd.get("type", "two_column")
            try:
                if t == "hero": s = create_hero_slide(prs, sd.get("title",title), sd.get("subtitle",""), colors)
                elif t == "big_number": s = create_big_number_slide(prs, sd.get("title",""), sd.get("number",""), sd.get("description",""), colors)
                elif t == "comparison": s = create_comparison_slide(prs, sd.get("title",""), sd.get("left_title","A"), sd.get("left_items",[]), sd.get("right_title","B"), sd.get("right_items",[]), colors)
                elif t == "quote": s = create_quote_slide(prs, sd.get("quote",""), sd.get("author",""), colors)
                else: s = create_two_column_slide(prs, sd.get("title",""), sd.get("left_content",[]), sd.get("right_content",[]), colors)
                add_slide_transition_advanced(s, ["zoom","reveal","morph","fade"][idx%4])
            except Exception as se: logger.warning(f"Slide {idx}: {se}")
        
        save_dir = _resolve_save_dir(req.save_path)
        os.makedirs(save_dir, exist_ok=True)
        filename = re.sub(r'[\\/:*?"<>|]', '_', title) + ".pptx"
        full_path = os.path.join(save_dir, filename)
        prs.save(full_path)
        return {"success": True, "path": full_path.replace("\\","/"), "slides_count": len(slides_data),
                "message": f"Created '{title}' ({len(slides_data)} slides) at {full_path}"}
    except ImportError as ie: raise HTTPException(500, f"ppt_generator_pro missing: {ie}")
    except Exception as e:
        logger.error(traceback.format_exc())
        raise HTTPException(500, str(e))

# ─── STARTUP ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="0.0.0.0")
    args = p.parse_args()
    logger.info(f"Planner: Groq/{GROQ_MODEL}")
    logger.info(f"Vision : {'CogAgent@'+COGAGENT_URL if COGAGENT_URL else 'Gemini/'+GEMINI_MODEL if GEMINI_API_KEY else 'NONE'}")
    uvicorn.run(app, host=args.host, port=args.port)
