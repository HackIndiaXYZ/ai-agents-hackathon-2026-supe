# Pecifics LAM — Polish & Refinement TODO
# From Working System → Reliable Daily Driver

**Version:** 1.0  
**Based on:** Full build history as of current implementation  
**Purpose:** Precise, actionable polish items to make Pecifics accurate, reliable, and context-aware — not new features, refinement of what exists.

---

## Priority Legend

```
🔴 Critical   — Causes wrong behavior or silent failure in daily use
🟡 High       — Noticeably degrades experience, should fix this week  
🟢 Medium     — Quality improvement, fix after criticals are done
⚪ Low        — Polish item, fix when everything else is stable
```

---

## 1. Intent Understanding & Query Accuracy

### 1.1 🔴 Fast-path regex conflicts with LLM understanding
**Problem:** The intent-router.js fast path intercepts commands before Qwen sees them. Some commands that look like known patterns are actually different intent. For example "search for my amazon order" triggers YouTube/Google search, not an account lookup. "play it safe" triggers Spotify play.

**Fix:** Tighten every fast-path regex to require full command shape, not partial keyword match. Every fast-path pattern must match from the start of the command or after a known prefix. Partial substring matches anywhere in the sentence must be removed.

**Test case:**
```
"play it safe" → should NOT route to Spotify
"search for my notes on machine learning" → should NOT route to YouTube search
"message me a reminder" → should NOT route to WhatsApp send
"open my mind" → should NOT route to open_application
```

---

### 1.2 🔴 Parameter extraction is fragile for multi-clause commands
**Problem:** Commands like "send an email to raj@example.com with subject meeting notes and body I will send the doc by 5pm" sometimes parse the subject as the full tail of the command rather than stopping at "and body". The Gmail body parser was already fixed once but the same issue affects WhatsApp message parsing and Telegram.

**Fix:** In `langchain_backend.py`, replace the substring extraction functions for email, WhatsApp, and Telegram with a single LLM call that extracts all parameters simultaneously. One structured extraction prompt handles multi-clause parsing far better than sequential regex.

**Template for extraction prompt:**
```python
PARAM_EXTRACT_PROMPT = """
Extract parameters from this command for protocol: {protocol_id}

Command: {command}
Required parameters: {required_params}

Rules:
- Extract only what is stated explicitly
- For email: "to" comes after recipient signal words, "subject" after subject signals,
  "body"/"saying"/"message" introduces body content — stop each field at the next signal word
- Never carry one field's content into another field
- If a required field is missing, return null for it

Return JSON only, no explanation.
"""
```

**Test cases:**
```
"email raj@x.com subject meeting at 3 body I will be there" 
→ to=raj@x.com, subject="meeting at 3", body="I will be there"

"whatsapp zainab saying we leave at 6 from station"
→ contact=zainab, message="we leave at 6 from station"

"email tom@x.com that the deadline is friday and attach nothing"
→ to=tom@x.com, body="the deadline is friday", subject=null
```

---

### 1.3 🔴 Ambiguous contact handling has no resolution flow
**Problem:** When the user says "message John" and the user profile has no contact named John, Pecifics should ask "Which John? I don't have a contact saved." Instead it either guesses or fails silently.

**Fix:** In the WhatsApp, Telegram, and Gmail executors, before execution check if the contact/recipient exists in the user profile. If not found, return a `clarification_needed` response with a specific question. Do not attempt execution with an unverified contact.

```python
def verify_contact(contact: str, profile: dict, app: str) -> dict:
    contacts = profile.get("frequent_contacts", {})
    
    # Exact match
    if contact.lower() in {k.lower() for k in contacts}:
        return {"verified": True, "resolved": contact}
    
    # Fuzzy match — find close names
    close = [k for k in contacts if contact.lower() in k.lower() 
             or k.lower() in contact.lower()]
    
    if len(close) == 1:
        return {"verified": True, "resolved": close[0], "inferred": True}
    
    if len(close) > 1:
        return {
            "verified": False,
            "question": f"Which contact did you mean? {', '.join(close)}",
            "options": close
        }
    
    return {
        "verified": False,
        "question": f"I don't have '{contact}' in your contacts. "
                    f"What is their full name or number?"
    }
```

---

### 1.4 🟡 Qwen confidence threshold too conservative — sends too much to Groq
**Problem:** The confidence threshold of 0.85 means many valid, simple commands fall through to Groq unnecessarily. Commands like "open notepad" or "set volume to 70" should never need a cloud model.

**Fix:** Lower the threshold to 0.72 for commands that match a protocol by name. Only send to Groq when Qwen returns confidence below 0.6 OR when the command contains multi-step signals ("then", "and then", "after that", "also"). Add a fast-reject for Groq: if the command is under 8 words and maps to a system/file protocol, use Qwen result regardless of confidence score.

---

### 1.5 🟡 Specific app names must always beat generic action keywords — verify this is complete
**Problem:** The fix was applied to the backend planner and intent-router, but it may not cover all edge cases. The `extract_specific_app()` function needs to cover all currently supported apps and their common misspellings/abbreviations.

**Fix:** Audit and expand the specific app trigger list:
```python
SPECIFIC_APP_TRIGGERS = {
    # Messaging
    "whatsapp": "whatsapp.send_message",
    "whats app": "whatsapp.send_message",
    "telegram": "telegram.send_message",
    
    # Google properties
    "gmail": "gmail.compose",
    "google mail": "gmail.compose",
    "google forms": "google_forms.fill",
    "google form": "google_forms.fill",
    "google drive": "browser.navigate",
    
    # Browser apps
    "gamma": "gamma.create_presentation",
    "gamma.app": "gamma.create_presentation",
    "youtube": "youtube.play_video",
    "yt": "youtube.play_video",
    
    # Music
    "spotify": "spotify.play",
    
    # Dev
    "vs code": "vscode.open",
    "vscode": "vscode.open",
    "visual studio code": "vscode.open",
    
    # Shopping
    "amazon": "browser.navigate",
    "flipkart": "browser.navigate",
    "myntra": "browser.navigate",
}
```

**Test case that must pass:**
```
"make a ppt in gamma" → gamma.create_presentation (NOT local PPT)
"create a presentation on youtube" → browser.navigate to YouTube (NOT local PPT)
"play a video about python on youtube" → youtube.play_video (NOT spotify)
"send a message via telegram" → telegram.send_message (NOT whatsapp)
```

---

### 1.6 🟢 Vague commands need suggestion responses, not silent failures
**Problem:** Commands like "do my work", "help me", "open something" currently either fail or route incorrectly. They should produce a helpful suggestion response.

**Fix:** In `langchain_backend.py`, after all planning paths fail, return a structured suggestion response:
```python
def build_suggestion_response(command: str, protocols: list) -> dict:
    return {
        "strategy": "suggest",
        "message": "I am not sure what you want to do. Here are some things I can help with:",
        "suggestions": [
            "Send a WhatsApp or Telegram message",
            "Play music on Spotify or YouTube",
            "Open a website or search Google",
            "Draft and send an email via Gmail",
            "Create a presentation (locally or in Gamma)",
            "Fill a Google Form",
            "Create folders or manage files",
            "Open any app on your computer"
        ],
        "prompt": "Try being specific: 'message Zainab on WhatsApp saying hi'"
    }
```

---

## 2. Context Window & Conversation Continuity

### 2.1 🔴 Conversation history is stored but not proven to influence planning
**Problem:** The `conversation_history` list in `langchain_backend.py` appends each exchange, and `correlate_commands()` uses it — but there is no verified test that a plan actually changes when history exists versus when it does not. The enrichment may be happening but the LLM may be ignoring the context note in the prompt.

**Fix:** Add a debug endpoint that shows the last enriched command sent to the LLM, so you can verify the context is actually being injected:
```python
@app.get("/debug/last_plan_input")
def debug_last_plan_input():
    return {
        "last_raw_command": debug_store.get("last_raw"),
        "last_enriched_command": debug_store.get("last_enriched"),
        "last_context_injected": debug_store.get("last_context"),
        "history_length": len(conversation_history)
    }
```

Run this after a two-command session and verify enrichment is actually happening.

---

### 2.2 🔴 Task results are not summarized into conversation context
**Problem:** After a task completes (e.g. "create a PPT about AI"), the result ("PPT saved to Desktop\AI.pptx") is not added to conversation history in a form the planner can use. So when the user says "send it to Zainab" the planner does not know what "it" is.

**Fix:** After every successful execution, store a result summary in conversation history:
```python
def summarize_task_result(protocol_id: str, params: dict, result: dict) -> str:
    summaries = {
        "local_ppt.generate": 
            f"Created PPT: {result.get('file_path', 'Desktop')} about {params.get('topic')}",
        "gmail.compose": 
            f"Sent email to {params.get('to')} with subject '{params.get('subject')}'",
        "whatsapp.send_message": 
            f"Sent WhatsApp to {params.get('contact')}: '{params.get('message')}'",
        "gamma.create_presentation": 
            f"Created Gamma presentation about {params.get('topic')}",
        "browser.navigate": 
            f"Opened {params.get('url')} in Chrome",
        "google_forms.fill": 
            f"Filled form with {result.get('filled_count', 'multiple')} fields",
    }
    return summaries.get(protocol_id, f"Completed: {protocol_id}")

# Store in history
conversation_history.append({
    "type": "result",
    "summary": summarize_task_result(protocol_id, params, result),
    "protocol_id": protocol_id,
    "key_outputs": extract_key_outputs(protocol_id, result),
    "timestamp": datetime.now().isoformat()
})
```

Then inject result summaries into the continuation check so "send it" resolves to the last created file.

---

### 2.3 🟡 Continuation detection misses implicit references
**Problem:** The `correlate_commands()` function catches explicit signals like "also", "then", "tell her". It misses implicit references like "what did it say?", "is it open?", "try again", "do it differently", "that was wrong".

**Fix:** Add implicit reference patterns to the continuation check:
```python
IMPLICIT_CONTINUATION_PATTERNS = [
    r'^(what|how|why|when|where|is|was|did|does)\s+it\b',  # "what did it say"
    r'^try\s+(again|that|it|a different)',                   # "try again"
    r'^(that|this)\s+(was|is)\s+(wrong|right|good|bad)',    # "that was wrong"
    r'^do\s+it\s+(again|differently|instead|now)',           # "do it differently"
    r'^\(?(yes|no|ok|okay|sure|nope|cancel|stop)\)?$',      # single-word replies
    r'^(send|share|forward|copy)\s+(it|that|this)\b',       # "send it"
    r'^(open|show|display)\s+(it|that|the\s+file)\b',       # "open it"
]
```

---

### 2.4 🟡 Context window cap of 10 is not trimmed intelligently
**Problem:** The history trims the oldest items when it hits 10. But the oldest item might be a credential save or a profile update that is still relevant, while recent items might be trivial searches.

**Fix:** Implement weighted trimming — keep items that created resources (files, emails, messages) longer than items that were read-only (searches, navigation). Never trim items that created something until 20 subsequent exchanges have passed.

```python
def trim_conversation_history(history: list, max_len: int = 10) -> list:
    if len(history) <= max_len:
        return history
    
    # Mark items by importance
    HIGH_IMPORTANCE = {"local_ppt.generate", "gmail.compose", 
                       "whatsapp.send_message", "google_forms.fill",
                       "credentials.save_google_account"}
    
    important = [h for h in history if h.get("protocol_id") in HIGH_IMPORTANCE]
    normal = [h for h in history if h.get("protocol_id") not in HIGH_IMPORTANCE]
    
    # Keep all important, trim normal from oldest
    trimmed_normal = normal[-(max_len - len(important)):]
    combined = sorted(important + trimmed_normal, 
                      key=lambda x: x.get("timestamp", ""))
    return combined[-max_len:]
```

---

### 2.5 🟢 Screen context from active app is not used for all relevant continuation types
**Problem:** Screen context is injected for "continue this", "fill this", "submit this". But it is not used for "fix this", "improve this", "save this", "close this", "what is this", "copy this", "summarize this".

**Fix:** Expand the continuation word list in `langchain_backend.py`:
```python
SCREEN_CONTEXT_TRIGGERS = [
    "this", "it", "that", "here", "current",
    "continue", "keep", "my work", "open file", "the document",
    "fix", "improve", "edit", "change", "update", "modify",
    "save", "close", "quit", "minimize",
    "what is", "what does", "explain", "summarize", "describe",
    "copy", "paste", "select all",
    "submit", "fill", "complete", "send",
    "run", "execute", "debug", "test"
]
```

---

## 3. Protocol Execution Reliability

### 3.1 🔴 WhatsApp contact selection fails for contacts with similar names
**Problem:** The UIA contact row matching uses substring matching. If the user has both "Zainab" and "Zainab CSIOT", searching "Zainab" may select the wrong one or fail to disambiguate.

**Fix:** In `whatsapp.js`, after UIA search results appear, score each result by name similarity and require a minimum score before selecting. If two results have equal scores, pick the one with the highest UIA visibility score (i.e. the one at the top of the list).

```javascript
function scoreContactMatch(candidateName, searchTerm) {
  const candidate = candidateName.toLowerCase().trim();
  const search = searchTerm.toLowerCase().trim();
  
  if (candidate === search) return 1.0;           // Exact match
  if (candidate.startsWith(search)) return 0.9;   // Starts with
  if (candidate.includes(search)) return 0.75;    // Contains
  
  // Word overlap score
  const candidateWords = new Set(candidate.split(' '));
  const searchWords = search.split(' ');
  const overlap = searchWords.filter(w => candidateWords.has(w)).length;
  return overlap / searchWords.length * 0.6;
}
```

---

### 3.2 🔴 Protocol confidence scores are stored but never used in routing
**Problem:** The `/protocol_confidence` endpoint returns scores, and `/store_protocol_run` updates them, but the planner never queries confidence before routing to a protocol. A protocol with a 0.3 confidence score routes the same as one with 0.98.

**Fix:** In `langchain_backend.py`, before returning a protocol-based plan, fetch its confidence and adjust strategy accordingly:

```python
async def get_protocol_confidence(protocol_id: str) -> float:
    try:
        results = chroma_collection.query(
            query_texts=[protocol_id],
            where={"protocol_id": protocol_id},
            n_results=1
        )
        if results and results["metadatas"]:
            return results["metadatas"][0][0].get("confidence", 1.0)
    except:
        pass
    return 1.0  # Default: full confidence for built-in protocols

async def plan_with_confidence(protocol_id: str, plan: dict) -> dict:
    confidence = await get_protocol_confidence(protocol_id)
    
    if confidence < 0.5:
        # Protocol is unreliable — prefer ReAct or fallback
        plan["strategy"] = "react_task"
        plan["confidence_warning"] = f"Protocol {protocol_id} has low reliability ({confidence:.0%})"
    elif confidence < 0.75:
        # Moderate confidence — require confirmation
        plan["requires_confirmation"] = True
    
    plan["protocol_confidence"] = confidence
    return plan
```

---

### 3.3 🔴 Verification after execution is inconsistent — some protocols report success without checking
**Problem:** Several protocols return `{ success: true }` based only on whether the action ran without throwing an error. They do not verify that the intended outcome happened. For example, WhatsApp reports success even if the message input was not focused correctly.

**Fix:** For every protocol with `verification` defined in its JSON, run the state check after execution and only return success if the check passes:

```javascript
// In action-executor.js, after running protocol steps
async function verifyProtocolResult(protocol, result) {
  if (!protocol.state_checks || !protocol.verification_steps) {
    return result;  // No verification defined
  }
  
  for (const checkName of protocol.verification_steps) {
    const checkDef = protocol.state_checks[checkName];
    if (!checkDef) continue;
    
    const verified = await runStateCheck(checkDef);
    if (!verified) {
      return {
        ...result,
        success: false,
        reason: `Verification failed: ${checkName}`,
        verified: false
      };
    }
  }
  
  return { ...result, verified: true };
}
```

---

### 3.4 🟡 Chrome CDP connection drops are not handled with reconnection
**Problem:** If Chrome is closed and reopened during a session, the CDP connection is broken. The next browser task fails with a connection error and does not attempt to reconnect.

**Fix:** In `browser-automation.js`, wrap every CDP operation in a reconnection guard:

```javascript
let _browser = null;
let _reconnectAttempts = 0;

async function getConnectedBrowser() {
  if (_browser) {
    try {
      // Quick health check
      await _browser.version();
      return _browser;
    } catch {
      // Connection dropped — reconnect
      _browser = null;
    }
  }
  
  if (_reconnectAttempts >= 3) {
    throw new Error(
      "Chrome connection lost. Please restart Chrome and try again."
    );
  }
  
  _reconnectAttempts++;
  try {
    _browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    _reconnectAttempts = 0;
    return _browser;
  } catch (err) {
    throw new Error(
      `Could not connect to Chrome on port 9222. ` +
      `Is the Pecifics Chrome profile open? Error: ${err.message}`
    );
  }
}
```

---

### 3.5 🟡 Gamma executor does not confirm successful slide creation
**Problem:** The Gamma executor navigates and attempts to create a presentation but does not verify that a presentation was actually generated (slide count > 0, edit URL, title visible).

**Fix:** After the Gamma create flow, probe for success indicators before returning:

```javascript
async function verifyGammaCreation(page) {
  // Wait up to 30s for presentation to generate (AI generation takes time)
  const successSelectors = [
    '[data-testid="slide"]',          // Individual slide appears
    '.slide-container',                // Slide container
    '[aria-label="Download"]',         // Download button (only in editor)
    '[href*="/present/"]',             // Present link appears in URL
  ];
  
  for (let attempt = 0; attempt < 15; attempt++) {
    for (const selector of successSelectors) {
      const el = await page.$(selector);
      if (el) {
        return { 
          success: true, 
          url: page.url(),
          verified_by: selector 
        };
      }
    }
    await page.waitForTimeout(2000);
  }
  
  return { 
    success: false, 
    reason: "Gamma presentation did not appear within 30 seconds",
    url: page.url() 
  };
}
```

---

### 3.6 🟢 Auto-generated protocols from ReAct runs need a review flag before they are trusted
**Problem:** Protocols auto-generated by `protocol_learner.py` are saved after 2 successes and immediately used in routing. A protocol generated from a lucky ReAct run might have hardcoded values or fragile selectors.

**Fix:** Add a `needs_review` flag to auto-generated protocols and add a simple `/review_learned_protocols` endpoint:

```python
@app.get("/review_learned_protocols")
def review_learned_protocols():
    """Returns protocols that were auto-learned and have not been manually reviewed."""
    to_review = []
    for path in Path("protocols/").glob("*.json"):
        with open(path) as f:
            p = json.load(f)
        if p.get("auto_generated") and not p.get("manually_reviewed"):
            to_review.append({
                "id": p["id"],
                "description": p.get("description"),
                "confidence": p.get("confidence", 0),
                "run_count": p.get("run_count", 0),
                "example_goals": p.get("example_goals", []),
                "file": str(path)
            })
    return {
        "pending_review": to_review,
        "count": len(to_review),
        "instructions": "Check each protocol JSON. If steps look correct, add 'manually_reviewed': true"
    }
```

---

## 4. ReAct Reasoning Quality

### 4.1 🔴 ReAct loop does not distinguish between retrying and giving up
**Problem:** The consecutive failure counter triggers after 2 failures of the same tool. But some tools are supposed to fail on first try (e.g. `wait` is used to retry after a page loads). The counter conflates genuine errors with expected retry patterns.

**Fix:** Track failure by tool AND by reason. Only count genuine errors toward the consecutive failure limit. Expected temporary states like "element not found yet" should retry with a wait, not count as a failure:

```python
RETRYABLE_REASONS = {
    "element_not_found_yet",
    "page_still_loading",
    "selector_not_visible",
    "timeout_waiting"
}

def is_genuine_failure(result: dict) -> bool:
    reason = result.get("reason", "")
    return not any(r in reason.lower() for r in [
        "not found yet", "still loading", "not visible", 
        "timeout waiting", "not ready"
    ])
```

---

### 4.2 🟡 ReAct step history sent to LLM is too verbose after 5+ steps
**Problem:** After 5 steps, the history in the prompt becomes very long. Qwen's context window handles it, but the reasoning quality degrades because the LLM focuses on recent history and loses track of the original goal.

**Fix:** Compress older history entries. Full detail for last 3 steps, one-line summary for steps before that:

```python
def format_history_for_prompt(history: list) -> str:
    if not history:
        return "No steps taken yet."
    
    recent = history[-3:]
    older = history[:-3]
    
    lines = []
    
    # Older steps — one line each
    for h in older:
        status = "✓" if h.get("result", {}).get("success") else "✗"
        lines.append(f"Step {h['step']} {status}: [{h['tool']}] (summarized)")
    
    if older:
        lines.append("--- recent steps ---")
    
    # Recent steps — full detail
    for h in recent:
        status = "✓" if h.get("result", {}).get("success") else "✗"
        lines.append(
            f"Step {h['step']} {status}: [{h['tool']}]\n"
            f"  Thought: {h['thought']}\n"
            f"  Params: {json.dumps(h.get('parameters', {}))}\n"
            f"  Result: {h.get('result', {}).get('message', h.get('result', {}).get('reason', 'no result'))}"
        )
    
    return "\n".join(lines)
```

---

### 4.3 🟡 ReAct does not use existing protocol knowledge when choosing tools
**Problem:** When ReAct reasons about how to send a WhatsApp message, it might choose `click_element` + `fill_field` instead of `run_protocol: whatsapp.send_message`. It does not know about available protocols unless they are in the system prompt.

**Fix:** Inject the protocol list into the ReAct system prompt so the LLM knows to prefer `run_protocol` over raw actions when a protocol exists:

```python
def build_react_prompt(protocols: dict) -> str:
    protocol_summary = "\n".join([
        f"  - {pid}: {p.get('description', p.get('capability', ''))}"
        for pid, p in protocols.items()
    ])
    
    return REACT_SYSTEM_PROMPT + f"""

Available protocols (prefer run_protocol over raw actions for these):
{protocol_summary}

When the task matches a protocol above, use:
  tool: "run_protocol"
  parameters: {{ "protocol_id": "exact.id", "params": {{...}} }}

Only use raw tools (click_element, fill_field, navigate) when no protocol covers the task.
"""
```

---

### 4.4 🟢 ReAct max_steps of 12 is not configurable per task type
**Problem:** Simple tasks (open site + click one button) waste up to 12 steps if something goes wrong. Complex tasks (login + navigate + fill multi-page form) may genuinely need more than 12.

**Fix:** Make max_steps dynamic based on task complexity estimate:

```python
def estimate_max_steps(goal: str, plan: dict) -> int:
    complexity = plan.get("complexity", "simple")
    
    step_limits = {
        "simple": 6,       # Single action
        "moderate": 10,    # Navigate + 2-3 actions  
        "complex": 16,     # Login + multi-step workflow
        "chain": 20        # Multi-app task chain
    }
    
    return step_limits.get(complexity, 12)
```

---

## 5. Browser Automation Reliability

### 5.1 🔴 Playwright selectors break when sites update their DOM
**Problem:** Selectors hardcoded in `browser-automation.js` (e.g. `input[name="subjectbox"]` for Gmail) break when Google updates their markup. This has already happened once with the Gmail body field.

**Fix:** For every critical selector, define a fallback chain. Never rely on a single selector:

```javascript
async function findElement(page, selectorChain, description) {
  for (const selector of selectorChain) {
    try {
      const el = await page.$(selector);
      if (el && await el.isVisible()) {
        return el;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    `Could not find ${description}. ` +
    `Tried: ${selectorChain.join(', ')}`
  );
}

// Usage
const subjectField = await findElement(page, [
  'input[name="subjectbox"]',        // Primary
  '[aria-label="Subject"]',          // Aria fallback
  '[data-testid="subject"]',         // Test ID fallback
  'input[placeholder*="Subject"]'    // Placeholder fallback
], "Gmail subject field");
```

---

### 5.2 🟡 probeBrowserState does not handle multiple open tabs
**Problem:** `probeBrowserState()` probes the current page but does not account for the fact that your Pecifics Chrome profile might have multiple tabs open. It might probe the wrong tab.

**Fix:** In `connectToUserChrome()`, always target the most recently focused tab rather than the first page in context:

```javascript
async function getActivePage(context) {
  const pages = context.pages();
  if (pages.length === 0) {
    return await context.newPage();
  }
  
  // Use the most recently active page
  // Playwright tracks focus — the last interacted page is most relevant
  return pages[pages.length - 1];
}
```

---

### 5.3 🟡 Google Forms fill fails on forms with conditional questions
**Problem:** Some Google Forms show/hide questions based on previous answers (conditional logic). The current extractor captures all questions at load time. After filling a radio/checkbox, new questions may appear that the extractor never saw.

**Fix:** After filling each radio or checkbox field, re-scan for newly visible questions:

```javascript
async function fillWithConditionalSupport(page, questions, answers) {
  const answerMap = buildAnswerMap(answers);
  let iteration = 0;
  const MAX_ITERATIONS = 5;
  
  while (iteration < MAX_ITERATIONS) {
    const currentQuestions = await extractGoogleFormQuestions(page);
    const unfilled = currentQuestions.filter(q => !answerMap[q.question]);
    
    if (unfilled.length === 0) break;
    
    // Generate answers for newly appeared questions
    if (unfilled.length > 0) {
      const newAnswers = await generateFormAnswers(unfilled, userProfile, context);
      newAnswers.forEach(a => { answerMap[a.question] = a.answer; });
    }
    
    // Fill one radio/checkbox that might trigger conditional logic
    await fillNextSelectiveField(page, currentQuestions, answerMap);
    await page.waitForTimeout(800);
    
    iteration++;
  }
  
  // Fill all remaining text/textarea fields
  await fillAllTextFields(page, answerMap);
}
```

---

### 5.4 🟢 Browser task timeout is global — some tasks genuinely need more time
**Problem:** Playwright operations time out at 15 seconds globally. Gamma AI generation can take 20-40 seconds. Gmail compose navigation can take 10-12 seconds on slow connections.

**Fix:** Set per-action timeouts based on expected duration:

```javascript
const ACTION_TIMEOUTS = {
  navigate: 15000,
  wait_for_selector: 8000,
  gamma_generate: 45000,      // AI generation is slow
  gmail_compose_open: 12000,  // Gmail compose can be slow
  form_submit: 10000,
  click: 5000,
  fill: 3000
};
```

---

## 6. Memory & Learning System

### 6.1 🔴 ChromaDB recipe queries are happening but results are not verified as used in planning
**Problem:** The `/query_recipe` endpoint exists and recipes are stored, but there is no confirmed evidence that the planner actually adjusts its plan based on a retrieved recipe. The retrieved recipe may be fetched and then discarded.

**Fix:** Add a `recipe_applied` field to plan responses and log when a recipe influenced a plan. Add a debug endpoint to verify:

```python
@app.get("/debug/recipe_usage")
def debug_recipe_usage():
    return {
        "total_queries": debug_store.get("recipe_queries", 0),
        "recipes_applied": debug_store.get("recipes_applied", 0),
        "last_retrieved": debug_store.get("last_recipe_retrieved"),
        "last_applied": debug_store.get("last_recipe_applied")
    }
```

---

### 6.2 🟡 User profile is enriched manually only — usage does not auto-update it
**Problem:** `user_profile.json` has fields for frequent contacts, preferred apps, and repeated tasks. These are defined but not auto-populated from actual usage. After 50 WhatsApp messages to Zainab, the profile should automatically know Zainab is a frequent contact.

**Fix:** After every successful task execution, update the profile:

```python
async def enrich_profile_from_run(protocol_id: str, params: dict, profile: dict):
    updated = False
    
    # Track frequent contacts
    contact = params.get("contact") or params.get("to")
    if contact and protocol_id in ("whatsapp.send_message", "telegram.send_message", 
                                    "gmail.compose"):
        contacts = profile.setdefault("frequent_contacts", {})
        entry = contacts.setdefault(contact, {"count": 0, "apps": []})
        entry["count"] += 1
        if protocol_id not in entry["apps"]:
            entry["apps"].append(protocol_id)
        updated = True
    
    # Track frequent apps
    app = params.get("app") or protocol_id.split(".")[0]
    apps = profile.setdefault("frequent_apps", {})
    apps[app] = apps.get(app, 0) + 1
    updated = True
    
    # Track frequent tasks
    tasks = profile.setdefault("frequent_tasks", {})
    tasks[protocol_id] = tasks.get(protocol_id, 0) + 1
    updated = True
    
    if updated:
        with open("memory_store/user_profile.json", "w") as f:
            json.dump(profile, f, indent=2)
    
    return profile
```

---

### 6.3 🟢 Protocol learner generates protocols from single-run ReAct traces that may be non-generalizable
**Problem:** A ReAct trace for "search amazon for headphones under 2000" might generate a protocol with "2000" hardcoded instead of as a parameter. The LLM is instructed to use placeholders but does not always do so.

**Fix:** After generating a protocol candidate, validate that:
1. No numeric values that look like user-provided numbers appear as literals
2. No email addresses appear as literals
3. No personal names appear as literals
4. At least one parameter is defined

```python
def validate_protocol_generalizability(protocol: dict) -> dict:
    import re
    
    issues = []
    steps_text = json.dumps(protocol.get("steps", []))
    
    # Check for hardcoded numbers that should be parameters
    hardcoded_numbers = re.findall(r'(?<!\{)\b\d{3,}\b(?!\})', steps_text)
    if hardcoded_numbers:
        issues.append(f"Possible hardcoded values: {hardcoded_numbers}")
    
    # Check for hardcoded emails
    hardcoded_emails = re.findall(
        r'(?<!\{)[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?!\})', 
        steps_text
    )
    if hardcoded_emails:
        issues.append(f"Hardcoded email addresses found: {hardcoded_emails}")
    
    # Must have at least one parameter
    if not protocol.get("parameters"):
        issues.append("No parameters defined — protocol is not reusable")
    
    protocol["validation_issues"] = issues
    protocol["is_generalizable"] = len(issues) == 0
    
    return protocol
```

---

## 7. Error Handling & User Feedback

### 7.1 🔴 Error messages shown to user are often technical and unhelpful
**Problem:** Users see errors like "Action failed: gmail_compose Unknown Google login state at https://..." or "Playwright: element not found: input[name=subjectbox]". These are internal errors, not user-facing messages.

**Fix:** Create a user-facing error translator in `renderer.js`:

```javascript
function translateErrorToUserMessage(error, protocol) {
  const errorMap = {
    "Unknown Google login state": 
      "Gmail is not logged in. Please log into Gmail in the Pecifics Chrome window, then try again.",
    "Could not connect to Chrome on port 9222":
      "Chrome is not connected. Restart Pecifics using start_all.bat.",
    "element not found":
      "The page layout changed and I could not find the right element. I will try a different approach.",
    "net::ERR_NAME_NOT_RESOLVED":
      "No internet connection or the website is unavailable.",
    "Timeout":
      "The page took too long to respond. Please check your internet connection.",
    "No Amazon credentials saved":
      "Say 'save my Amazon account' to let me log in automatically next time.",
    "2fa_required":
      "Google is asking for two-factor authentication. Please complete it in the Chrome window, then say 'continue'.",
    "login_failed":
      "Login did not succeed. Please log in manually in the Pecifics Chrome window."
  };
  
  for (const [key, message] of Object.entries(errorMap)) {
    if (error.toLowerCase().includes(key.toLowerCase())) {
      return message;
    }
  }
  
  // Fallback — hide technical details, give generic actionable message
  return `Something went wrong with ${protocol || "this task"}. ` +
         `You can try rephrasing the command or check if the app is open.`;
}
```

---

### 7.2 🟡 Task progress is not visible during long ReAct runs
**Problem:** During a ReAct task with 8 steps, the user sees "Executing..." with no indication of what is happening. After 15 seconds of silence, users think the app has frozen.

**Fix:** Send step-by-step progress updates from the ReAct loop to the renderer:

```javascript
// In renderer.js ReAct execution loop
function updateReActProgress(step, thought, tool, maxSteps) {
  const progressEl = document.getElementById('react-progress');
  if (!progressEl) {
    const el = document.createElement('div');
    el.id = 'react-progress';
    el.style.cssText = `
      font-size: 12px; color: #888; padding: 4px 12px;
      font-style: italic; margin-top: 4px;
    `;
    document.getElementById('chat-container').appendChild(el);
  }
  
  const icon = {
    navigate: '🌐', click_element: '🖱️', fill_field: '⌨️',
    run_protocol: '⚡', probe_state: '🔍', wait: '⏳',
    ask_user: '💬', done: '✅'
  }[tool] || '⚙️';
  
  document.getElementById('react-progress').textContent = 
    `${icon} Step ${step}/${maxSteps}: ${thought.slice(0, 80)}${thought.length > 80 ? '...' : ''}`;
}
```

---

### 7.3 🟡 Confirmation dialogs do not show enough detail about what will happen
**Problem:** The confirmation gate shows "Confirmation required: Send Gmail to X: subject Y". It does not show the full email body. Users confirm without knowing the full content.

**Fix:** Expand confirmation dialogs to show full content for messaging/email actions:

```javascript
function buildConfirmationMessage(protocol_id, params) {
  const builders = {
    "gmail.compose": (p) => 
      `📧 Send Email\n` +
      `To: ${p.to}\n` +
      `Subject: ${p.subject || "(no subject)"}\n` +
      `Body: ${p.body || "(empty)"}\n\n` +
      `Confirm to send?`,
    
    "whatsapp.send_message": (p) =>
      `💬 WhatsApp Message\n` +
      `To: ${p.contact}\n` +
      `Message: "${p.message}"\n\n` +
      `Confirm to send?`,
    
    "telegram.send_message": (p) =>
      `✈️ Telegram Message\n` +
      `To: ${p.contact}\n` +
      `Message: "${p.message}"\n\n` +
      `Confirm to send?`,
    
    "google_forms.fill": (p) =>
      `📝 Submit Google Form\n` +
      `URL: ${p.url || "current form"}\n` +
      `Fields: ${p.preview || "see filled form"}\n\n` +
      `Confirm to submit?`
  };
  
  const builder = builders[protocol_id];
  return builder ? builder(params) : 
    `Confirm: ${protocol_id} with parameters:\n${JSON.stringify(params, null, 2)}`;
}
```

---

### 7.4 🟢 No notification when a background task finishes
**Problem:** If Pecifics is minimized or in the background while executing a task, there is no notification when the task completes or fails.

**Fix:** Use Electron's built-in notification system:

```javascript
// In main.js
const { Notification } = require('electron');

function notifyTaskComplete(taskDescription, success, detail) {
  if (!Notification.isSupported()) return;
  
  new Notification({
    title: success ? `✅ Pecifics: Done` : `❌ Pecifics: Failed`,
    body: `${taskDescription}${detail ? '\n' + detail : ''}`,
    silent: false
  }).show();
}

// IPC handler
ipcMain.handle('notify-task-result', (event, data) => {
  notifyTaskComplete(data.task, data.success, data.detail);
});
```

---

## 8. Voice System Completion

### 8.1 🔴 Clap detection thresholds are not calibrated — the system is shipped with defaults
**Problem:** `voice_engine.py` uses amplitude threshold 0.25 and peak/RMS ratio 7.0. These are reasonable defaults but every microphone is different. Without calibration, the voice system will either fire constantly on noise or never detect claps.

**Fix:** Run `clap_test.py` in your environment and record the amplitude and ratio values for:
- A firm clap near the microphone
- A quieter clap at normal distance
- Normal speech
- Background laptop fan noise

Set the threshold at the midpoint between background noise and your quietest intentional clap. Document the calibrated values in `voice_engine.py` as constants at the top of the file.

---

### 8.2 🔴 Voice commands do not appear in chat history
**Problem:** When a command is sent via voice, the renderer processes it but it does not appear as a user message in the chat UI. The response appears but there is no record of what was said.

**Fix:** When the voice engine sends a command to `/voice_command`, also notify the Electron renderer to display it as a user message. Add an IPC channel for this:

```python
# In voice_engine.py, after transcribing
def _send_command(self, command: str):
    # Show command in UI
    try:
        requests.post(
            f"{self.backend_url}/voice_command_received",
            json={"command": command, "source": "voice"},
            timeout=2
        )
    except:
        pass
    
    # Then send for planning
    # ... existing code

# In langchain_backend.py
@app.post("/voice_command_received")
async def voice_command_received(payload: VoiceCommandPayload):
    """Notifies renderer to display the voice command in chat."""
    await voice_state_queue.put({
        "type": "user_message",
        "content": payload.command,
        "source": "voice"
    })
    return {"ok": True}
```

---

### 8.3 🟡 TTS responses are not interruptible
**Problem:** If Pecifics starts speaking a long response and the user double-claps again or types a command, the TTS continues speaking over the new interaction.

**Fix:** Track the TTS state and stop it before processing a new command:

```python
class VoiceEngine:
    def __init__(self, ...):
        self._tts_active = False
    
    def speak(self, text: str):
        self._tts_active = True
        self.tts.say(text)
        self.tts.runAndWait()
        self._tts_active = False
    
    def interrupt_speech(self):
        if self._tts_active:
            self.tts.stop()
            self._tts_active = False
    
    def _on_double_clap(self):
        self.interrupt_speech()  # Stop any current speech first
        # ... rest of activation
```

---

### 8.4 🟢 Voice engine startup is blocking — delays Pecifics launch
**Problem:** Loading the Whisper model takes 3-8 seconds. If `voice_engine.py` is launched in `start_all.bat` before Electron, it blocks startup.

**Fix:** Load Whisper lazily — only when the first voice command is actually received, not at startup:

```python
class VoiceEngine:
    def __init__(self, ...):
        self._whisper = None  # Lazy load
    
    @property
    def whisper(self):
        if self._whisper is None:
            print("Loading Whisper (first voice command)...")
            self._whisper = WhisperModel(
                self._whisper_model, 
                device="cpu", 
                compute_type="int8"
            )
        return self._whisper
```

The clap detector starts immediately. Whisper only loads on first use. Startup is instant.

---

## 9. Safety & Confirmation Flow

### 9.1 🔴 Credential storage has no "forget credentials" command
**Problem:** Once Google credentials are saved in Windows Credential Manager, there is no way to remove them from within Pecifics. If credentials change or the user wants to switch accounts, they must manually open Windows Credential Manager.

**Fix:** Add credential management commands:

```javascript
// In action-executor.js
case 'forget_google_credentials':
case 'remove_google_account': {
  const ps = require('child_process').execSync;
  try {
    ps('cmdkey /delete:pecifics_google_email', { encoding: 'utf8' });
    ps('cmdkey /delete:pecifics_google_password', { encoding: 'utf8' });
    return { success: true, message: 'Google credentials removed from Pecifics.' };
  } catch (err) {
    return { success: false, reason: 'Could not remove credentials: ' + err.message };
  }
}
```

Add to intent router:
```javascript
if (/forget|remove|delete|clear/.test(cmd) && /google|gmail|credentials/.test(cmd)) {
  // Route to forget_google_credentials
}
```

---

### 9.2 🟡 Risky action confirmation does not have a timeout
**Problem:** The confirmation dialog waits indefinitely. If the user walks away from the computer after triggering a risky action, the confirmation hangs permanently.

**Fix:** Add a 60-second timeout to confirmation dialogs. After timeout, auto-cancel the task:

```javascript
function showConfirmationWithTimeout(message, timeoutMs = 60000) {
  return new Promise((resolve) => {
    let timer;
    
    const confirmBtn = document.getElementById('confirm-action-btn');
    const cancelBtn = document.getElementById('cancel-action-btn');
    const countdownEl = document.getElementById('confirmation-countdown');
    
    let remaining = timeoutMs / 1000;
    
    const countdown = setInterval(() => {
      remaining--;
      if (countdownEl) countdownEl.textContent = `Auto-cancels in ${remaining}s`;
      if (remaining <= 0) {
        clearInterval(countdown);
        clearTimeout(timer);
        resolve({ confirmed: false, reason: 'timeout' });
      }
    }, 1000);
    
    confirmBtn.onclick = () => {
      clearInterval(countdown);
      resolve({ confirmed: true });
    };
    
    cancelBtn.onclick = () => {
      clearInterval(countdown);
      resolve({ confirmed: false, reason: 'user_cancelled' });
    };
  });
}
```

---

## 10. Performance

### 10.1 🟡 Protocol registry is loaded from disk on every backend request
**Problem:** The protocol registry is read from JSON files on disk every time it is needed. For 14+ protocols, this adds 10-50ms per request unnecessarily.

**Fix:** Load protocols once at backend startup and keep in memory. Reload only when a new protocol is added:

```python
class ProtocolRegistry:
    def __init__(self, protocols_dir: str):
        self.protocols_dir = Path(protocols_dir)
        self._cache = {}
        self._load_all()
    
    def _load_all(self):
        self._cache = {}
        for path in self.protocols_dir.glob("*.json"):
            with open(path) as f:
                p = json.load(f)
            self._cache[p["id"]] = p
        print(f"Protocol registry: {len(self._cache)} protocols loaded")
    
    def get(self, protocol_id: str) -> dict | None:
        return self._cache.get(protocol_id)
    
    def all(self) -> dict:
        return self._cache.copy()
    
    def reload(self):
        self._load_all()

# Module-level singleton
protocol_registry = ProtocolRegistry("protocols/")
```

---

### 10.2 🟡 Qwen local model is initialized per request — should be initialized once
**Problem:** If the Qwen client is initializing an HTTP connection or loading state per request, cold requests are slower than they should be. The Ollama connection should be kept warm.

**Fix:** Send a warmup request at backend startup:

```python
async def warmup_local_llm():
    try:
        await qwen_call(
            system="You are Pecifics.",
            user="Say OK",
            max_tokens=5
        )
        print("Local LLM warmed up.")
    except Exception as e:
        print(f"Local LLM warmup failed: {e} — will retry on first request")

# In backend startup
@app.on_event("startup")
async def startup():
    asyncio.create_task(warmup_local_llm())
```

---

## 11. Live Testing Checklist

Run every item in this list with a real running Pecifics. Check the box only when the full end-to-end flow completes correctly including verification.

### Core Protocols
- [ ] `open whatsapp and message Zainab: hi` — message sends, confidence increments
- [ ] `message Zainab CSIOT on WhatsApp saying meeting at 6` — correct contact selected
- [ ] `play Shape of You on Spotify` — Spotify plays the correct track
- [ ] `play avengers endgame scene from youtube` — correct video opens
- [ ] `create a ppt about machine learning` — .pptx saved to Desktop, opens correctly
- [ ] `create folder TestPecifics on Desktop` — folder appears on Desktop
- [ ] `set volume to 60` — system volume changes to 60%
- [ ] `search google for latest AI news` — Google search results open

### Browser Tasks
- [ ] `go to github.com` — GitHub opens in Pecifics Chrome
- [ ] `go to amazon and search for mechanical keyboard` — Amazon opens, search runs
- [ ] `go to flipkart and search for earbuds` — Flipkart opens, search runs
- [ ] `draft a gmail to [your email] subject test body hello and send` — email arrives in inbox
- [ ] `open gamma and create a deck about climate change` — Gamma opens, deck generates

### Context Continuation
- [ ] `go to amazon` → `also search for headphones` — second command uses Amazon context
- [ ] `message Zainab` → `tell her meeting is at 5` — second command uses WhatsApp + Zainab context
- [ ] Open VS Code → press Pecifics hotkey → type `continue this` — response includes VS Code context

### ReAct & Complex Tasks
- [ ] Multi-step command with login required — blocker detected, OAuth attempted, task resumed
- [ ] ReAct task with deliberate failure at step 2 — recovery attempted, user asked if still stuck
- [ ] Press Escape during a running task — task cancels cleanly, cancel button disappears

### Safety
- [ ] `send email to raj` (no address) — asks for email address, does NOT guess
- [ ] `message John` (not in profile) — asks which John, does NOT attempt execution
- [ ] Risky send action — confirmation dialog shows full content before sending
- [ ] Confirmation times out after 60 seconds — task auto-cancels

### Voice (after calibration)
- [ ] Run `clap_test.py` — claps register, background noise does not
- [ ] Double clap — Pecifics says "Yes?" and HUD shows "listening"
- [ ] Say a command — transcription appears in chat, plan executes
- [ ] Double clap while Pecifics is speaking — speech interrupts, listens for new command

### Learning
- [ ] Run same novel ReAct task twice — check `/learned_protocols` for new entry after second run
- [ ] Run WhatsApp 5 times — check `user_profile.json` shows Zainab as frequent contact
- [ ] Check `/protocol_confidence` for whatsapp.send_message — score reflects actual runs

---

## 12. Do Not Build Yet

These are explicitly deferred. Do not start them until all items above are verified:

- **Knowledge graph** — ChromaDB recipes with enriched metadata cover the same need. A graph adds complexity and hallucination risk with no practical gain at this stage.
- **Additional vision models** — Florence local is sufficient. More models add memory pressure.
- **Web dashboard or settings UI** — The command bar is sufficient for daily use. Build dashboard after 30 days of real usage reveals what controls are actually needed.
- **Multi-user support** — Single-user on one laptop is the right scope.
- **Plugin/extension system** — Protocols already serve this purpose.
- **Mobile app or remote access** — Out of scope until the desktop build is fully reliable.

---

*Work through sections in order: Intent → Context → Protocol Reliability → ReAct → Browser → Memory → Error Handling → Voice → Safety → Performance → Live Testing. Completing the live testing checklist is the definition of "polish done."*
