import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional


PROTOCOL_GENERATION_PROMPT = """
You are converting a successful Pecifics ReAct execution trace into a reusable protocol JSON.

Execution goal:
{goal}

Successful steps:
{steps}

Return ONLY valid JSON with this shape:
{{
  "id": "domain.capability",
  "version": "0.1.0-learned",
  "app": "AppName or Browser",
  "domain": "browser|desktop|system|learned",
  "capability": "short_capability_name",
  "description": "one line description",
  "risk": "low|medium|high",
  "requires_confirmation": false,
  "parameters": {{
    "param_name": {{
      "type": "string|boolean|number",
      "required": true,
      "description": "what this parameter means"
    }}
  }},
  "steps": [
    {{
      "id": "step_1",
      "primitive": "browser_dom|desktop|system",
      "action": "navigate_and_login|fill_field|press_key|click_text|browser_play_video|app_engine",
      "parameters": {{}}
    }}
  ],
  "state_checks": ["what should be true before/after running"],
  "verification": ["how to verify success"],
  "fallbacks": ["browser_probe_state", "targeted_vision", "ask_user"]
}}

Rules:
- Replace user-specific values with placeholders like {{{{query}}}}, {{{{topic}}}}, {{{{contact}}}}, or {{{{message}}}}.
- Do not include pixel coordinates unless no structural action exists.
- Do not save credentials, passwords, tokens, cookies, or private message contents as literals.
- Keep only steps that matter for repeating the workflow.
- Prefer structural browser actions over vision.
"""


JsonGenerator = Callable[[str], Awaitable[Optional[Dict[str, Any]]]]


class ProtocolLearner:
    """Promotes successful ReAct traces into reusable protocol contracts.

    Auto-generated protocols are intentionally conservative: they need two
    successful matching traces before a file is written to protocols/.
    """

    def __init__(self, protocols_dir: str, pending_file: str):
        self.protocols_dir = Path(protocols_dir)
        self.pending_file = Path(pending_file)
        self.protocols_dir.mkdir(parents=True, exist_ok=True)
        self.pending_file.parent.mkdir(parents=True, exist_ok=True)
        self.pending_protocols = self._load_pending()

    async def learn_from_react_run(
        self,
        goal: str,
        history: List[Dict[str, Any]],
        success: bool,
        json_generator: JsonGenerator,
    ) -> Dict[str, Any]:
        if not success:
            return {"success": True, "learned": False, "reason": "react_run_failed"}
        if not history:
            return {"success": True, "learned": False, "reason": "empty_history"}

        trace = self._successful_trace(history)
        if not trace:
            return {"success": True, "learned": False, "reason": "no_successful_actions"}

        # For clear structural traces, prefer deterministic reusable protocols.
        # Small local LLMs often overfit ids to the particular query ("headphones")
        # instead of the capability ("search this site").
        candidate = self._fallback_candidate(goal, trace)
        if not candidate:
            candidate = await self._generate_candidate(goal, trace, json_generator)
        if not candidate:
            return {"success": True, "learned": False, "reason": "candidate_generation_failed"}

        candidate = self._normalize_candidate(candidate, goal)
        validation_error = self._validate_candidate(candidate)
        if validation_error:
            return {
                "success": True,
                "learned": False,
                "reason": "candidate_invalid",
                "error": validation_error,
            }

        protocol_id = candidate["id"]
        existing_path = self.protocols_dir / f"{protocol_id}.json"
        if existing_path.exists():
            return self._update_existing(existing_path, success=True)

        pending = self.pending_protocols.setdefault(protocol_id, {
            "candidate": candidate,
            "successes": 0,
            "goal_examples": [],
            "last_seen": "",
        })
        pending["candidate"] = self._merge_candidate(pending.get("candidate") or {}, candidate)
        pending["successes"] = int(pending.get("successes") or 0) + 1
        pending["last_seen"] = datetime.now().isoformat()
        examples = pending.setdefault("goal_examples", [])
        if goal not in examples:
            examples.append(goal)

        if pending["successes"] >= 2:
            saved = self._save_protocol(pending["candidate"], examples)
            del self.pending_protocols[protocol_id]
            self._save_pending()
            return {
                "success": True,
                "learned": True,
                "protocol_id": protocol_id,
                "path": str(saved),
                "message": f"Learned new protocol: {protocol_id}",
            }

        self._save_pending()
        return {
            "success": True,
            "learned": False,
            "pending": True,
            "protocol_id": protocol_id,
            "successes": pending["successes"],
            "successes_needed": max(0, 2 - pending["successes"]),
            "message": f"Protocol candidate {protocol_id} needs one more verified success.",
        }

    def learned_protocols(self) -> Dict[str, Any]:
        learned = []
        for path in sorted(self.protocols_dir.glob("*.json")):
            try:
                protocol = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not protocol.get("auto_generated"):
                continue
            learned.append({
                "id": protocol.get("id"),
                "description": protocol.get("description"),
                "confidence": protocol.get("confidence", 0),
                "run_count": protocol.get("run_count", 0),
                "success_count": protocol.get("success_count", 0),
                "created_at": protocol.get("created_at"),
                "last_used": protocol.get("last_used"),
                "example_goals": protocol.get("example_goals", []),
            })
        return {
            "success": True,
            "learned_protocols": learned,
            "pending": self.pending_protocols,
            "count": len(learned),
        }

    async def _generate_candidate(
        self,
        goal: str,
        trace: List[Dict[str, Any]],
        json_generator: JsonGenerator,
    ) -> Optional[Dict[str, Any]]:
        steps = []
        for idx, item in enumerate(trace, start=1):
            steps.append(
                f"{idx}. action={item.get('action')} params={json.dumps(item.get('parameters') or {}, ensure_ascii=True)}"
            )
        prompt = PROTOCOL_GENERATION_PROMPT.format(goal=goal, steps="\n".join(steps))
        try:
            return await json_generator(prompt)
        except Exception:
            return None

    def _successful_trace(self, history: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        trace: List[Dict[str, Any]] = []
        for step in history or []:
            result = step.get("result") if isinstance(step, dict) else {}
            details = result.get("details") if isinstance(result, dict) else []
            for detail in details or []:
                action = detail.get("action")
                outcome = detail.get("result") if isinstance(detail, dict) else {}
                if not action or (isinstance(outcome, dict) and outcome.get("success") is False):
                    continue
                source_action = self._find_source_action(step.get("actions") or [], action)
                trace.append({
                    "action": action,
                    "parameters": (source_action.get("parameters") if source_action else {}) or {},
                    "thought": step.get("thought") or "",
                })
        return trace

    def _find_source_action(self, actions: List[Dict[str, Any]], action_name: str) -> Optional[Dict[str, Any]]:
        wanted = str(action_name or "").lower()
        for action in actions or []:
            name = str(action.get("name") or action.get("action") or "").lower()
            if name == wanted:
                return action
        return None

    def _fallback_candidate(self, goal: str, trace: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        navigate = next((t for t in trace if t.get("action") == "navigate_and_login"), None)
        fill = next((t for t in trace if t.get("action") == "fill_field"), None)
        pressed_enter = any(t.get("action") == "press_key" and str((t.get("parameters") or {}).get("key") or "").lower() == "enter" for t in trace)
        if navigate and fill and pressed_enter:
            nav_params = navigate.get("parameters") or {}
            fill_params = fill.get("parameters") or {}
            url = str(nav_params.get("url") or "")
            host = self._host_slug(url) or "site"
            selector = fill_params.get("selector") or "search"
            return {
                "id": f"learned.{host}.search",
                "version": "0.1.0-learned",
                "app": "Chrome",
                "domain": "browser",
                "capability": "search_site",
                "description": f"Search {host} from its search box.",
                "risk": "low",
                "requires_confirmation": False,
                "parameters": {
                    "query": {
                        "type": "string",
                        "required": True,
                        "description": "Search query to enter on the site."
                    }
                },
                "steps": [
                    {
                        "id": "open_site",
                        "primitive": "browser_dom",
                        "action": "navigate_and_login",
                        "parameters": {
                            "url": url,
                            "login": bool(nav_params.get("login")),
                            "login_method": nav_params.get("login_method"),
                            "site": nav_params.get("site") or host,
                        }
                    },
                    {
                        "id": "fill_search",
                        "primitive": "browser_dom",
                        "action": "fill_field",
                        "parameters": {
                            "selector": selector,
                            "value": "{{query}}",
                        }
                    },
                    {
                        "id": "submit_search",
                        "primitive": "browser_dom",
                        "action": "press_key",
                        "parameters": {"key": "Enter"}
                    }
                ],
                "state_checks": ["browser_ready", "site_search_box_available"],
                "verification": ["search_results_opened"],
                "fallbacks": ["browser_probe_state", "targeted_vision", "ask_user"],
            }

        slug = self._slug(goal)[:42] or "workflow"
        steps = []
        for idx, item in enumerate(trace[:20], start=1):
            steps.append({
                "id": f"step_{idx}",
                "primitive": "learned_trace",
                "action": item.get("action"),
                "parameters": self._strip_private_literals(item.get("parameters") or {}),
            })
        if not steps:
            return None
        return {
            "id": f"learned.{slug}.draft",
            "version": "0.1.0-learned",
            "app": "Pecifics",
            "domain": "learned",
            "capability": slug.replace("-", "_"),
            "description": f"Learned draft workflow from: {goal[:120]}",
            "risk": "medium",
            "requires_confirmation": True,
            "parameters": {},
            "steps": steps,
            "state_checks": ["manual_review_recommended"],
            "verification": ["manual_review_recommended"],
            "fallbacks": ["ask_user"],
        }

    def _normalize_candidate(self, candidate: Dict[str, Any], goal: str) -> Dict[str, Any]:
        protocol = dict(candidate or {})
        protocol["id"] = self._clean_protocol_id(protocol.get("id") or f"learned.{self._slug(goal)}")
        protocol.setdefault("version", "0.1.0-learned")
        protocol.setdefault("domain", "learned")
        protocol.setdefault("capability", protocol["id"].split(".")[-1])
        protocol.setdefault("description", f"Learned protocol from: {goal[:120]}")
        protocol.setdefault("risk", "medium")
        protocol.setdefault("requires_confirmation", protocol.get("risk") not in ("low", "safe"))
        protocol.setdefault("parameters", {})
        protocol.setdefault("steps", [])
        protocol.setdefault("state_checks", [])
        protocol.setdefault("verification", ["manual_review_recommended"])
        protocol.setdefault("fallbacks", ["ask_user"])
        protocol["auto_generated"] = True
        protocol["trusted"] = False
        protocol["confidence"] = float(protocol.get("confidence") or 0.0)
        protocol["run_count"] = int(protocol.get("run_count") or 0)
        protocol["success_count"] = int(protocol.get("success_count") or 0)
        return protocol

    def _validate_candidate(self, protocol: Dict[str, Any]) -> Optional[str]:
        if not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{2,80}", protocol.get("id") or ""):
            return "Invalid protocol id"
        steps = protocol.get("steps")
        if not isinstance(steps, list) or not steps:
            return "Protocol has no executable steps"
        for step in steps:
            if not isinstance(step, dict) or not step.get("action"):
                return "A protocol step is missing an action"
            params = step.get("parameters") or {}
            if self._contains_secret(params):
                return "Protocol candidate contains a possible secret"
        return None

    def _save_protocol(self, protocol: Dict[str, Any], examples: List[str]) -> Path:
        now = datetime.now().isoformat()
        protocol = dict(protocol)
        protocol["created_at"] = protocol.get("created_at") or now
        protocol["last_used"] = now
        protocol["example_goals"] = examples[-5:]
        protocol["confidence"] = max(float(protocol.get("confidence") or 0.0), 0.75)
        protocol["run_count"] = max(int(protocol.get("run_count") or 0), 2)
        protocol["success_count"] = max(int(protocol.get("success_count") or 0), 2)
        path = self.protocols_dir / f"{protocol['id']}.json"
        path.write_text(json.dumps(protocol, indent=2), encoding="utf-8")
        return path

    def _update_existing(self, path: Path, success: bool) -> Dict[str, Any]:
        protocol = json.loads(path.read_text(encoding="utf-8"))
        protocol["run_count"] = int(protocol.get("run_count") or 0) + 1
        if success:
            protocol["success_count"] = int(protocol.get("success_count") or 0) + 1
        runs = max(1, int(protocol.get("run_count") or 1))
        successes = int(protocol.get("success_count") or 0)
        protocol["confidence"] = round(successes / runs, 3)
        protocol["last_used"] = datetime.now().isoformat()
        path.write_text(json.dumps(protocol, indent=2), encoding="utf-8")
        return {
            "success": True,
            "learned": False,
            "updated": True,
            "protocol_id": protocol.get("id"),
            "new_confidence": protocol.get("confidence"),
        }

    def _merge_candidate(self, old: Dict[str, Any], new: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(old or {})
        merged.update({k: v for k, v in (new or {}).items() if v not in (None, "", [], {})})
        return merged

    def _load_pending(self) -> Dict[str, Any]:
        if not self.pending_file.exists():
            return {}
        try:
            data = json.loads(self.pending_file.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _save_pending(self):
        self.pending_file.write_text(json.dumps(self.pending_protocols, indent=2), encoding="utf-8")

    def _clean_protocol_id(self, value: str) -> str:
        text = re.sub(r"[^a-z0-9_.-]+", ".", str(value or "").lower()).strip(".")
        text = re.sub(r"\.{2,}", ".", text)
        return text[:80] or "learned.workflow"

    def _slug(self, value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "_", str(value or "").lower()).strip("_") or "workflow"

    def _host_slug(self, url: str) -> str:
        match = re.search(r"https?://(?:www\.)?([^/]+)", url or "")
        if not match:
            return ""
        host = match.group(1).split(":")[0]
        return re.sub(r"[^a-z0-9]+", "_", host.lower()).strip("_")

    def _contains_secret(self, value: Any) -> bool:
        text = json.dumps(value, ensure_ascii=True).lower()
        secret_words = ["password", "otp", "token", "secret", "cookie", "credential"]
        return any(word in text for word in secret_words)

    def _strip_private_literals(self, params: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {}
        for key, value in (params or {}).items():
            if re.search(r"password|otp|token|secret|cookie|credential", str(key), re.I):
                continue
            cleaned[key] = value
        return cleaned
