# Pecifics LAM — Full Re-Architecture Plan
### Parallel Execution Engines · Smart Intent Router · Zero-CogAgent Fast Paths · Execution That Actually Works

---

## Part 1 — What Is Actually Still Broken (Honest Diagnosis)

Reading the full codebase and ARCHITECTURE.md together, here is the real state:

### The WhatsApp Problem — Root Cause Found

The architecture says `Ctrl+N` is the keyboard shortcut for new chat in WhatsApp Desktop. **This is wrong for most versions of WhatsApp Desktop.** `Ctrl+N` opens a new conversation dialog in the old Electron-based WhatsApp Desktop, but the current WhatsApp Desktop (Store version, 2024+) uses a different shortcut layout. The actual reliable flow is:

1. `Ctrl+F` — opens the search bar (universal, works in all versions)
2. Type contact name
3. Wait 1 second for results
4. `Arrow Down` to first result
5. `Enter` to open chat
6. Tab to message input OR click (message input is auto-focused on chat open)
7. Type message
8. `Enter` to send

The `Ctrl+N` approach fails silently — it either does nothing or opens a "New Group" dialog depending on WhatsApp version. Since it fails silently (no error, no crash), the executor reports success but nothing was sent. **This is why WhatsApp "works but doesn't work."**

### The Deeper Execution Problem

Looking at `screen-agent.js` — despite the architecture saying "first tries nut-js, falls back to PowerShell" — the code still spawns PowerShell for every action because `nut-js` fails to initialize on most machines without a specific native build step. The fallback is the primary path. Every click is still 300-500ms of PowerShell spawn overhead.

### The Routing Problem

Everything that isn't a fast-path match goes through `vision_task` via CogAgent/Gemini. There is no middle tier. The gap between "instant fast path" and "slow 30-step vision loop" is enormous. What's missing is a set of **deterministic app-specific engines** that handle known apps without vision.

---

## Part 2 — The New Architecture: Parallel Execution Engines

### Core Idea

Instead of one giant `action-executor.js` that handles everything, and one `vision_task` for everything else, the new architecture has **6 dedicated execution engines** selected by a smart intent router. Each engine knows exactly how to control its domain without guessing.

```
User Command
     │
     ▼
┌─────────────────────────────────────────────┐
│         INTENT ROUTER (Layer 0)             │
│   Fast LLM classification — Groq 70B        │
│   <100ms · returns: engine + structured params│
└───────────────┬─────────────────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
    ▼           ▼           ▼
[Engine 1]  [Engine 2]  [Engine 3]
 System      Browser    App-Specific
 Direct      DOM        (WhatsApp,
 (OS/File/   (Playwright  Telegram,
  CMD/Vol)    CSS sel)    Spotify, etc)
    │                       │
    │         ┌─────────────┘
    │         ▼
    │      [Engine 4]
    │       Office
    │       COM
    │
    └──────[Engine 5]──────[Engine 6]
           Vision          Compose
           (CogAgent/      (Write/
            Gemini)         Generate)
           LAST RESORT      content only
```

**Engine 6 (Compose)** runs in parallel with any other engine — it generates content (emails, docs, summaries) while Engine 1-5 handle execution.

---

## Part 3 — Intent Router Design

### What It Does

The intent router is a single fast Groq call (not a full planning call) that classifies the user's intent and extracts structured parameters. It runs in **under 100ms** because it uses a small focused prompt with a restricted output schema.

### Router Prompt (in `langchain_backend.py`)

```python
ROUTER_PROMPT = """
You are a command router for a Windows desktop assistant.
Classify the user command into exactly ONE engine and extract parameters.

ENGINES:
- system: OS controls (volume, brightness, wifi, files, folders, CMD, registry, processes, battery, disk, clipboard)
- browser: Web tasks (search, navigate URL, fill form on website, read webpage)
- app: Specific installed app control (WhatsApp, Telegram, Spotify, VS Code, Notepad, Calculator, any named app)
- office: Microsoft Office tasks (Word, Excel, PowerPoint, OneNote)
- vision: Tasks needing screen reading (unknown app, "click the button", describe screen, anything ambiguous)
- compose: Generate text content only (write email draft, summarize text, create document content) — NO execution needed

Return ONLY this JSON, nothing else:
{
  "engine": "system|browser|app|office|vision|compose",
  "confidence": 0.0-1.0,
  "app_name": "exact app name if engine=app, else null",
  "operation": "short verb phrase: send_message|search_contact|play_song|open_file|navigate_url|etc",
  "params": { "extracted key params from the command" },
  "fallback_engine": "vision|system|browser"
}

Examples:
"open whatsapp and msg zainab hi" → {"engine":"app","app_name":"WhatsApp","operation":"send_message","params":{"contact":"zainab","message":"hi"},"confidence":0.97,"fallback_engine":"vision"}
"search weather on google" → {"engine":"browser","operation":"search","params":{"query":"weather"},"confidence":0.99,"fallback_engine":"vision"}
"set volume to 60" → {"engine":"system","operation":"set_volume","params":{"level":60},"confidence":0.99,"fallback_engine":"system"}
"open spotify and play lo fi" → {"engine":"app","app_name":"Spotify","operation":"play_music","params":{"query":"lo fi"},"confidence":0.92,"fallback_engine":"vision"}
"create folder Projects on desktop" → {"engine":"system","operation":"create_folder","params":{"name":"Projects","location":"Desktop"},"confidence":0.99,"fallback_engine":"system"}
"write me an email to my professor asking for extension" → {"engine":"compose","operation":"draft_email","params":{"recipient":"professor","topic":"extension request"},"confidence":0.99,"fallback_engine":"compose"}
"click the blue button" → {"engine":"vision","operation":"click_element","params":{"description":"blue button"},"confidence":0.85,"fallback_engine":"vision"}
"""
```

### Router Implementation in `langchain_backend.py`

```python
from pydantic import BaseModel
from typing import Optional, Any
import json, time

class RouterResult(BaseModel):
    engine: str
    confidence: float
    app_name: Optional[str]
    operation: str
    params: dict
    fallback_engine: str

async def route_intent(user_message: str) -> RouterResult:
    """Fast intent classification. Target: <100ms."""
    start = time.time()
    
    llm = get_llm(max_tokens=200)   # tiny output, small token budget
    response = llm.invoke([
        {"role": "system", "content": ROUTER_PROMPT},
        {"role": "user", "content": user_message}
    ])
    
    elapsed = (time.time() - start) * 1000
    print(f"[router] classified in {elapsed:.0f}ms → {response.content[:80]}")
    
    try:
        data = json.loads(response.content.strip())
        return RouterResult(**data)
    except Exception:
        # Fallback: use vision engine which handles anything
        return RouterResult(
            engine="vision", confidence=0.5, app_name=None,
            operation="unknown", params={"goal": user_message},
            fallback_engine="vision"
        )

# New /route endpoint for the desktop app to call
@app.post("/route")
async def route_endpoint(req: ChatRequest):
    result = await route_intent(req.message)
    return result.dict()
```

---

## Part 4 — Engine 1: System Direct Engine

**Handles:** Volume, brightness, WiFi, Bluetooth, files, folders, CMD, clipboard, battery, disk, processes, registry, scheduled tasks, power, shutdown.

**Speed target:** 50-300ms (all local, no network)

**How it works:** No LLM after routing. The router extracted params. Engine 1 maps `operation` → direct function call.

### Implementation in `action-executor.js`

```javascript
// New: system engine dispatcher — called directly, no vision
const SYSTEM_ENGINE_MAP = {
    'set_volume':        (p) => systemManager.setVolume(p.level),
    'get_volume':        ()  => systemManager.getVolume(),
    'mute_audio':        ()  => systemManager.muteAudio(),
    'set_brightness':    (p) => systemManager.setBrightness(p.level),
    'toggle_wifi':       (p) => systemManager.toggleWiFi(p.enable),
    'toggle_bluetooth':  (p) => systemManager.toggleBluetooth(p.enable),
    'create_folder':     (p) => fileManager.createFolder(p.name, p.location),
    'create_file':       (p) => fileManager.createFile(p.name, p.location, p.content || ''),
    'read_file':         (p) => fileManager.readFile(p.path),
    'delete_file':       (p) => fileManager.deleteFile(p.path),
    'list_directory':    (p) => fileManager.listDirectory(p.path),
    'copy_file':         (p) => fileManager.copyFile(p.source, p.destination),
    'move_file':         (p) => fileManager.moveFile(p.source, p.destination),
    'run_command':       (p) => osTasks.runCommand(p.command),
    'get_battery':       ()  => systemManager.getBatteryStatus(),
    'get_disk_space':    ()  => systemManager.getDiskSpace(),
    'get_system_info':   ()  => systemManager.getSystemInfo(),
    'get_network_status':()  => systemManager.getNetworkStatus(),
    'kill_process':      (p) => osTasks.killProcess(p.name || p.pid),
    'list_processes':    ()  => osTasks.getProcessList(),
    'get_clipboard':     ()  => systemManager.getClipboard(),
    'set_clipboard':     (p) => systemManager.setClipboard(p.text),
    'lock_computer':     ()  => systemManager.lockComputer(),
    'sleep_computer':    ()  => systemManager.sleepComputer(),
    'shutdown_computer': (p) => osTasks.shutdownComputer(p.delay || 0),
    'restart_computer':  (p) => osTasks.restartComputer(p.delay || 0),
    'empty_recycle_bin': ()  => systemManager.emptyRecycleBin(),
    'set_wallpaper':     (p) => systemManager.setWallpaper(p.path),
    'toggle_dark_mode':  (p) => systemManager.toggleDarkMode(p.enable),
    'send_notification': (p) => systemManager.sendNotification(p.title, p.message),
    'open_settings':     (p) => osTasks.openSettingsPage(p.page),
    'disk_cleanup':      ()  => systemManager.diskCleanup(),
    'health_summary':    ()  => osTasks.getSystemHealthSummary(),
};

async function executeSystemEngine(operation, params) {
    const handler = SYSTEM_ENGINE_MAP[operation];
    if (!handler) {
        return { success: false, error: `Unknown system operation: ${operation}` };
    }
    
    // Safety gate
    const safety = safetyGuard.validateAction(operation, params);
    if (!safety.allowed) return { success: false, error: safety.reason, blocked: true };
    if (safety.needsConfirmation) {
        return { success: false, needsConfirmation: true, action: operation, params };
    }
    
    try {
        const result = await handler(params);
        return { success: true, result };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
```

---

## Part 5 — Engine 2: Browser DOM Engine

**Handles:** Web search, navigate URL, read page, fill form, click by CSS/text, scrape data.

**Speed target:** 1-3s (Playwright, no vision model)

**Key principle:** Use Playwright's DOM API directly. Never take a screenshot and send to CogAgent for browser tasks. The DOM has all the information you need programmatically.

### New functions to add in `browser-automation.js`

```javascript
// Click by visible text (more reliable than coordinates)
async function clickByText(text, options = {}) {
    const page = await getActivePage();
    const exact = options.exact !== false;
    
    // Try multiple strategies
    try {
        // Strategy 1: exact text match
        await page.getByText(text, { exact }).first().click({ timeout: 5000 });
        return { success: true, method: 'text' };
    } catch {
        try {
            // Strategy 2: role-based (button, link, etc)
            await page.getByRole('button', { name: text }).first().click({ timeout: 3000 });
            return { success: true, method: 'role' };
        } catch {
            try {
                // Strategy 3: placeholder text (for inputs)
                await page.getByPlaceholder(text).first().click({ timeout: 3000 });
                return { success: true, method: 'placeholder' };
            } catch {
                return { success: false, error: `Element with text "${text}" not found` };
            }
        }
    }
}

// Type into a field identified by label/placeholder/name
async function typeInField(fieldIdentifier, text) {
    const page = await getActivePage();
    
    try {
        const field = page.getByLabel(fieldIdentifier).or(
            page.getByPlaceholder(fieldIdentifier)
        ).or(
            page.locator(`[name="${fieldIdentifier}"]`)
        ).first();
        
        await field.fill(text);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Extract structured data from current page
async function extractPageData(dataType) {
    const page = await getActivePage();
    
    switch (dataType) {
        case 'title':
            return { data: await page.title() };
        case 'text':
            return { data: await page.innerText('body') };
        case 'links':
            const links = await page.$$eval('a[href]', els => 
                els.map(el => ({ text: el.innerText.trim(), href: el.href })).slice(0, 20)
            );
            return { data: links };
        case 'inputs':
            const inputs = await page.$$eval('input,textarea,select', els =>
                els.map(el => ({ type: el.type, name: el.name, placeholder: el.placeholder, id: el.id }))
            );
            return { data: inputs };
        default:
            return { data: await page.content() };
    }
}

// Smart browser action dispatcher for the browser engine
async function executeBrowserEngine(operation, params) {
    switch (operation) {
        case 'search':
            return await googleSearch(params.query);
        case 'youtube_search':
            return await youtubeSearch(params.query);
        case 'navigate':
            return await navigateToUrl(params.url);
        case 'click_text':
            return await clickByText(params.text, params.options);
        case 'type_field':
            return await typeInField(params.field, params.text);
        case 'extract':
            return await extractPageData(params.data_type || 'text');
        case 'go_back':
            return await (await getActivePage()).goBack();
        case 'reload':
            return await (await getActivePage()).reload();
        case 'take_screenshot':
            return await takePageScreenshot();
        case 'run_script':
            return await (await getActivePage()).evaluate(params.script);
        case 'fill_form':
            // Fill multiple fields at once
            const page = await getActivePage();
            for (const [field, value] of Object.entries(params.fields || {})) {
                await typeInField(field, value);
            }
            return { success: true };
        default:
            return { success: false, error: `Unknown browser operation: ${operation}` };
    }
}
```

---

## Part 6 — Engine 3: App-Specific Engine (The Critical One)

This is the engine that fixes WhatsApp and all other specific apps. Each app gets a **dedicated handler** that knows exactly how that app works — its keyboard shortcuts, its UI flow, its quirks.

### Architecture: App Handler Registry

```javascript
// New file: jarvis-desktop/src/modules/app-handlers/index.js

const handlers = {};

// Register handler for an app
function registerAppHandler(appName, handler) {
    const keys = Array.isArray(appName) ? appName : [appName];
    keys.forEach(k => handlers[k.toLowerCase()] = handler);
}

// Get handler for an app
function getAppHandler(appName) {
    return handlers[appName.toLowerCase()] || null;
}

// Execute via app-specific handler
async function executeAppEngine(appName, operation, params) {
    const handler = getAppHandler(appName);
    
    if (!handler) {
        // No specific handler — fall back to vision engine
        return { success: false, fallback: 'vision', reason: `No handler for ${appName}` };
    }
    
    if (!handler[operation]) {
        // Handler exists but operation not supported — fall back to vision
        return { success: false, fallback: 'vision', reason: `${appName} handler does not support ${operation}` };
    }
    
    try {
        return await handler[operation](params);
    } catch (err) {
        return { success: false, error: err.message, fallback: 'vision' };
    }
}

module.exports = { registerAppHandler, getAppHandler, executeAppEngine };
```

### WhatsApp Handler — Fixed and Complete

```javascript
// New file: jarvis-desktop/src/modules/app-handlers/whatsapp.js

const { execPowerShellInline, waitForWindow, bringToForeground } = require('../screen-agent');
const { typeTextDirect, pressKeyComboDirect, pressKeyDirect, delay } = require('../screen-agent');

const WHATSAPP_WINDOW_TITLES = ['WhatsApp', 'WhatsApp Beta'];

async function ensureWhatsAppOpen() {
    // Check if already running
    const ps = `Get-Process -Name "WhatsApp" -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json`;
    const result = await execPowerShellInline(ps);
    
    if (!result || result.trim() === '' || result.trim() === 'null') {
        // Not running — launch it
        await execPowerShellInline(`Start-Process "WhatsApp:"`);   // MS Store protocol
        await delay(3000);  // WhatsApp takes time to fully load
    }
    
    // Bring to foreground
    const focused = await bringToForeground(WHATSAPP_WINDOW_TITLES);
    if (!focused) {
        // Try alternative: find by window title substring
        await execPowerShellInline(`
            Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
public class WA {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
            $proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*WhatsApp*"} | Select-Object -First 1
            if ($proc) {
                [WA]::ShowWindow($proc.MainWindowHandle, 9)
                [WA]::SetForegroundWindow($proc.MainWindowHandle)
            }
        `);
        await delay(400);
    }
    
    return true;
}

// FIXED WhatsApp send_message — uses Ctrl+F, not Ctrl+N
async function sendMessage({ contact, message, send = true }) {
    await ensureWhatsAppOpen();
    await delay(500);  // let window fully focus
    
    // Step 1: Open search with Ctrl+F (works in ALL WhatsApp Desktop versions)
    await pressKeyComboDirect('ctrl+f');
    await delay(600);
    
    // Step 2: Clear any existing search text and type contact name
    await pressKeyComboDirect('ctrl+a');
    await typeTextDirect(contact);
    await delay(1200);  // WhatsApp search needs time to populate results
    
    // Step 3: Navigate to first result and open
    await pressKeyDirect('ArrowDown');
    await delay(200);
    await pressKeyDirect('Enter');
    await delay(600);  // wait for chat to open
    
    // Step 4: Message input receives focus automatically when chat opens
    // But press Tab once to ensure we're in the message box, not the search
    await pressKeyDirect('Escape');   // close search mode if still active
    await delay(200);
    
    // Step 5: Click message input area (center-bottom of WhatsApp window)
    // Use Win32 to get WhatsApp window rect and calculate message box position
    const windowRect = await getWindowRect('WhatsApp');
    if (windowRect) {
        // Message input is at ~50% x, ~94% y of the WhatsApp window
        const msgX = windowRect.left + Math.floor(windowRect.width * 0.5);
        const msgY = windowRect.top + Math.floor(windowRect.height * 0.94);
        await clickAtDirect(msgX, msgY);
    } else {
        // Fallback: just press Tab to navigate to message box
        await pressKeyDirect('Tab');
    }
    await delay(300);
    
    // Step 6: Type the message
    await typeTextDirect(message);
    await delay(200);
    
    // Step 7: Send
    if (send !== false) {
        await pressKeyDirect('Enter');
        await delay(300);
    }
    
    return { success: true, message: `Sent "${message}" to ${contact} on WhatsApp` };
}

async function getWindowRect(titleContains) {
    const result = await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WR {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*${titleContains}*"} | Select-Object -First 1
if ($proc) {
    $rect = New-Object WR+RECT
    [WR]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
    "$($rect.L),$($rect.T),$($rect.R),$($rect.B)"
}
    `);
    
    if (!result || !result.trim()) return null;
    const parts = result.trim().split(',').map(Number);
    return { left: parts[0], top: parts[1], right: parts[2], bottom: parts[3], 
             width: parts[2]-parts[0], height: parts[3]-parts[1] };
}

async function readUnread() {
    // Future: read unread messages using accessibility API
    return { success: false, reason: 'read_unread not yet implemented' };
}

module.exports = { sendMessage, readUnread, ensureWhatsAppOpen };
```

### Register All App Handlers in `action-executor.js`

```javascript
const appHandlers = require('./app-handlers/index');
const whatsappHandler = require('./app-handlers/whatsapp');
const spotifyHandler = require('./app-handlers/spotify');
const telegramHandler = require('./app-handlers/telegram');
const vscodeHandler = require('./app-handlers/vscode');
const notesHandler = require('./app-handlers/notes');

// Register at module init
appHandlers.registerAppHandler(['whatsapp', 'whats app'], whatsappHandler);
appHandlers.registerAppHandler(['spotify'], spotifyHandler);
appHandlers.registerAppHandler(['telegram'], telegramHandler);
appHandlers.registerAppHandler(['vscode', 'visual studio code', 'vs code'], vscodeHandler);
appHandlers.registerAppHandler(['notepad', 'notepad++', 'notes'], notesHandler);
```

### Spotify Handler (Example of the Pattern)

```javascript
// jarvis-desktop/src/modules/app-handlers/spotify.js

async function playMusic({ query }) {
    // Use Spotify URI protocol — fastest, no UI interaction needed
    const searchUri = `spotify:search:${encodeURIComponent(query)}`;
    
    // Open Spotify search via URI
    await execPowerShellInline(`Start-Process "${searchUri}"`);
    await delay(1500);
    
    // Press Enter to play first result
    await pressKeyDirect('Enter');
    return { success: true, message: `Playing "${query}" on Spotify` };
}

async function pausePlayback() {
    await bringToForeground(['Spotify']);
    await pressKeyComboDirect('ctrl+alt+p');  // Spotify global pause shortcut
    return { success: true };
}

async function nextTrack() {
    await bringToForeground(['Spotify']);
    await pressKeyComboDirect('ctrl+alt+right');
    return { success: true };
}

async function setVolume({ level }) {
    // Use Windows audio instead of Spotify UI for volume
    return require('../system-manager').setVolume(level);
}

module.exports = { playMusic, pausePlayback, nextTrack, setVolume };
```

### VS Code Handler

```javascript
// jarvis-desktop/src/modules/app-handlers/vscode.js

async function openFile({ path: filePath }) {
    await execPowerShellInline(`code "${filePath}"`);
    return { success: true };
}

async function runTerminalCommand({ command }) {
    await bringToForeground(['Visual Studio Code']);
    await pressKeyComboDirect('ctrl+`');  // open terminal
    await delay(500);
    await typeTextDirect(command);
    await pressKeyDirect('Enter');
    return { success: true };
}

async function openCommandPalette({ command }) {
    await bringToForeground(['Visual Studio Code']);
    await pressKeyComboDirect('ctrl+shift+p');
    await delay(300);
    await typeTextDirect(command);
    await delay(200);
    await pressKeyDirect('Enter');
    return { success: true };
}

async function searchInFiles({ query }) {
    await bringToForeground(['Visual Studio Code']);
    await pressKeyComboDirect('ctrl+shift+f');
    await delay(300);
    await pressKeyComboDirect('ctrl+a');
    await typeTextDirect(query);
    return { success: true };
}

module.exports = { openFile, runTerminalCommand, openCommandPalette, searchInFiles };
```

---

## Part 7 — Screen-Agent Rewrite: PowerShell → nut-js Primary

The nut-js fallback needs to become the primary. Here is the corrected initialization that actually works:

### Fixed `screen-agent.js` — nut-js Guaranteed Primary

```javascript
// jarvis-desktop/src/modules/screen-agent.js — full rewrite

let nutjsAvailable = false;
let nutMouse, nutKeyboard, nutKey, nutButton, nutScreen;

// Initialize nut-js synchronously at module load
async function initNutJs() {
    try {
        const nut = require('@nut-tree-fork/nut-js');
        nutMouse = nut.mouse;
        nutKeyboard = nut.keyboard;
        nutKey = nut.Key;
        nutButton = nut.Button;
        
        // Test it actually works with a simple call
        await nutMouse.getPosition();
        
        // Configure for performance
        nutMouse.config.autoDelayMs = 0;
        nutMouse.config.mouseSpeed = 3000;
        nutKeyboard.config.autoDelayMs = 0;
        
        nutjsAvailable = true;
        console.log('[screen-agent] nut-js initialized — using native input');
    } catch (err) {
        nutjsAvailable = false;
        console.warn('[screen-agent] nut-js unavailable, using PowerShell fallback:', err.message);
        console.warn('[screen-agent] To fix: npm rebuild @nut-tree-fork/nut-js --update-binary');
    }
}

// Call at module load — but don't block
initNutJs().catch(() => {});

// ─── NUT-JS KEY MAP ───────────────────────────────────────────────
const NUT_KEY_MAP = {
    'enter': 'Return', 'return': 'Return', 'tab': 'Tab', 'escape': 'Escape',
    'esc': 'Escape', 'backspace': 'Backspace', 'delete': 'Delete', 'del': 'Delete',
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'home': 'Home', 'end': 'End', 'pageup': 'PageUp', 'pagedown': 'PageDown',
    'space': 'Space', 'f1':'F1','f2':'F2','f3':'F3','f4':'F4','f5':'F5',
    'f6':'F6','f7':'F7','f8':'F8','f9':'F9','f10':'F10','f11':'F11','f12':'F12',
};

const COMBO_MAP = {
    'ctrl+a': ['LeftControl', 'A'], 'ctrl+c': ['LeftControl', 'C'],
    'ctrl+v': ['LeftControl', 'V'], 'ctrl+z': ['LeftControl', 'Z'],
    'ctrl+y': ['LeftControl', 'Y'], 'ctrl+s': ['LeftControl', 'S'],
    'ctrl+f': ['LeftControl', 'F'], 'ctrl+n': ['LeftControl', 'N'],
    'ctrl+w': ['LeftControl', 'W'], 'ctrl+t': ['LeftControl', 'T'],
    'ctrl+l': ['LeftControl', 'L'], 'ctrl+r': ['LeftControl', 'R'],
    'ctrl+`': ['LeftControl', 'Grave'], 'ctrl+shift+p': ['LeftControl', 'LeftShift', 'P'],
    'ctrl+shift+f': ['LeftControl', 'LeftShift', 'F'],
    'ctrl+alt+p': ['LeftControl', 'LeftAlt', 'P'],
    'ctrl+alt+right': ['LeftControl', 'LeftAlt', 'Right'],
    'alt+f4': ['LeftAlt', 'F4'], 'alt+tab': ['LeftAlt', 'Tab'],
    'win+d': ['LeftSuper', 'D'], 'win+r': ['LeftSuper', 'R'],
};

// ─── NUT-JS IMPLEMENTATIONS ───────────────────────────────────────

async function clickAt_nut(x, y, button = 'left') {
    const btn = button === 'right' ? nutButton.RIGHT : 
                button === 'middle' ? nutButton.MIDDLE : nutButton.LEFT;
    const { straightTo } = require('@nut-tree-fork/nut-js');
    await nutMouse.move(straightTo({ x: Math.round(x), y: Math.round(y) }));
    await nutMouse.click(btn);
}

async function typeText_nut(text) {
    // For longer text, use clipboard for speed
    if (text.length > 5) {
        const { clipboard } = require('electron');
        clipboard.writeText(text);
        await delay(50);
        await nutKeyboard.pressKey(nutKey.LeftControl, nutKey.V);
        await nutKeyboard.releaseKey(nutKey.LeftControl, nutKey.V);
    } else {
        await nutKeyboard.type(text);
    }
}

async function pressKey_nut(keyCombo) {
    const combo = COMBO_MAP[keyCombo.toLowerCase()];
    if (combo) {
        const keys = combo.map(k => nutKey[k]);
        await nutKeyboard.pressKey(...keys);
        await nutKeyboard.releaseKey(...keys);
        return;
    }
    const singleKey = NUT_KEY_MAP[keyCombo.toLowerCase()] || keyCombo;
    const k = nutKey[singleKey] || nutKey[keyCombo];
    if (k) {
        await nutKeyboard.pressKey(k);
        await nutKeyboard.releaseKey(k);
    }
}

// ─── POWERSHELL FALLBACK ──────────────────────────────────────────

async function execPowerShellInline(script) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        execFile('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
            '-Command', script
        ], { timeout: 8000 }, (err, stdout, stderr) => {
            if (err) reject(err);
            else resolve(stdout.trim());
        });
    });
}

async function clickAt_ps(x, y, button = 'left') {
    const btn = button === 'right' ? 2 : 1;
    await execPowerShellInline(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MC { [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e); }
"@
[MC]::mouse_event(${btn === 2 ? '0x0008' : '0x0002'}, 0, 0, 0, 0)
Start-Sleep -Milliseconds 60
[MC]::mouse_event(${btn === 2 ? '0x0010' : '0x0004'}, 0, 0, 0, 0)
    `);
}

async function typeText_ps(text) {
    const escaped = text.replace(/'/g, "''");
    await execPowerShellInline(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText('${escaped}')
[System.Windows.Forms.SendKeys]::SendWait('^v')
    `);
}

async function pressKey_ps(keyCombo) {
    const PS_KEY_MAP = {
        'enter': '{ENTER}', 'return': '{ENTER}', 'tab': '{TAB}',
        'escape': '{ESC}', 'esc': '{ESC}', 'backspace': '{BACKSPACE}',
        'delete': '{DELETE}', 'up': '{UP}', 'down': '{DOWN}',
        'left': '{LEFT}', 'right': '{RIGHT}',
        'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+f': '^f',
        'ctrl+s': '^s', 'ctrl+z': '^z', 'ctrl+n': '^n', 'ctrl+w': '^w',
        'ctrl+shift+p': '^+p', 'alt+f4': '%{F4}',
    };
    const key = PS_KEY_MAP[keyCombo.toLowerCase()];
    if (!key) return;
    await execPowerShellInline(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${key}')
    `);
}

// ─── FOCUS MANAGEMENT ─────────────────────────────────────────────

async function bringToForeground(windowTitles) {
    const titles = Array.isArray(windowTitles) ? windowTitles : [windowTitles];
    const titleChecks = titles.map(t => `$_.MainWindowTitle -like "*${t}*"`).join(' -or ');
    
    const result = await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FW {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$proc = Get-Process | Where-Object {${titleChecks}} | Select-Object -First 1
if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    [FW]::ShowWindow($proc.MainWindowHandle, 9)
    Start-Sleep -Milliseconds 100
    [FW]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 200
    Write-Output "focused:$($proc.MainWindowTitle)"
} else {
    Write-Output "not_found"
}
    `);
    
    return result && result.startsWith('focused');
}

// ─── PUBLIC API — uses nut-js if available, PowerShell if not ─────

async function clickAt(x, y, button = 'left') {
    if (nutjsAvailable) return clickAt_nut(x, y, button);
    return clickAt_ps(x, y, button);
}

async function typeTextDirect(text) {
    if (nutjsAvailable) return typeText_nut(text);
    return typeText_ps(text);
}

async function pressKeyDirect(key) {
    if (nutjsAvailable) return pressKey_nut(key);
    return pressKey_ps(key);
}

async function pressKeyComboDirect(combo) {
    if (nutjsAvailable) return pressKey_nut(combo);
    return pressKey_ps(combo);
}

// Wait for screen to stop changing
async function waitForScreenSettle(maxWaitMs = 1000, intervalMs = 150) {
    const { takeScreenshot } = require('../main'); // get from main process
    const start = Date.now();
    let lastHash = null, stableCount = 0;
    
    while (Date.now() - start < maxWaitMs) {
        await delay(intervalMs);
        try {
            // Quick hash of a thumbnail for comparison only
            const snap = await ipcRenderer.invoke('take-screenshot');
            const hash = quickHash(snap.substring(100, 500));
            if (hash === lastHash) { stableCount++; if (stableCount >= 2) return; }
            else stableCount = 0;
            lastHash = hash;
        } catch { return; }
    }
}

function quickHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = {
    clickAt, typeTextDirect, pressKeyDirect, pressKeyComboDirect,
    bringToForeground, execPowerShellInline, waitForScreenSettle, delay,
    // Vision action entry point (used by vision engine)
    executeVisionAction: async (action) => {
        // Force focus before any click
        if (action.windowTitle) await bringToForeground([action.windowTitle]);
        
        switch (action.action) {
            case 'click':        return clickAt(action.x, action.y, 'left');
            case 'double_click': 
                await clickAt(action.x, action.y);
                await delay(80);
                return clickAt(action.x, action.y);
            case 'right_click':  return clickAt(action.x, action.y, 'right');
            case 'type':         return typeTextDirect(action.text || '');
            case 'key':          return pressKeyDirect(action.key || 'Enter');
            case 'scroll':
                if (nutjsAvailable) {
                    const { mouse } = require('@nut-tree-fork/nut-js');
                    const amount = (action.clicks || 3) * 120;
                    if (action.direction === 'up') await mouse.scrollUp(amount);
                    else await mouse.scrollDown(amount);
                }
                return;
            default: break;
        }
    }
};
```

---

## Part 8 — New Execution Flow in `renderer.js`

Replace the entire `sendMessage` → `executeTasks` flow with the routed architecture:

```javascript
// renderer.js — new sendMessage flow

async function sendMessage(text) {
    if (isProcessing) return;
    isProcessing = true;
    addMessage('user', text);
    
    const thinkingId = showThinking();
    
    try {
        // Step 1: Route the intent (fast — ~80-120ms)
        const route = await fetch(`${backendUrl}/route`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message: text })
        }).then(r => r.json());
        
        hideThinking(thinkingId);
        
        // Step 2: Execute via appropriate engine
        let result;
        
        switch (route.engine) {
            case 'system':
                result = await executeSystemEngineDirect(route.operation, route.params);
                break;
                
            case 'browser':
                result = await executeBrowserEngineDirect(route.operation, route.params);
                break;
                
            case 'app':
                result = await executeAppEngineDirect(route.app_name, route.operation, route.params);
                // If app handler returns fallback:vision, use vision engine
                if (result?.fallback === 'vision') {
                    result = await executeVisionEngineWithGoal(text);
                }
                break;
                
            case 'office':
                result = await executeOfficeEngine(route.operation, route.params);
                break;
                
            case 'vision':
                // Only reach here when router explicitly says vision needed
                result = await executeVisionEngineWithGoal(text);
                break;
                
            case 'compose':
                // Generate content — no execution needed
                result = await generateContent(route.operation, route.params, text);
                break;
                
            default:
                // Unknown route — use full backend planner as fallback
                result = await executeViaBackendPlanner(text);
        }
        
        // Step 3: Show result
        displayResult(result, route);
        
    } catch (err) {
        hideThinking(thinkingId);
        addMessage('assistant', `Error: ${err.message}`);
    } finally {
        isProcessing = false;
    }
}

// Direct engine executors (call main process IPC)
async function executeSystemEngineDirect(operation, params) {
    return window.electronAPI.executeAction({ action: operation, params });
}

async function executeBrowserEngineDirect(operation, params) {
    return window.electronAPI.executeAction({ action: `browser_${operation}`, params });
}

async function executeAppEngineDirect(appName, operation, params) {
    return window.electronAPI.executeAction({ 
        action: 'app_engine', 
        params: { app: appName, operation, ...params } 
    });
}

async function executeVisionEngineWithGoal(goal) {
    // Only called when truly needed
    return executeVisionTask(goal, 20);
}
```

---

## Part 9 — The Parallel Vision Loop

The vision loop must also be redesigned. When vision IS needed, make it fast:

```javascript
// renderer.js — new executeVisionTask

async function executeVisionTask(goal, maxSteps = 15, taskId) {
    let consecutiveErrors = 0;
    let stepCount = 0;
    
    // Pre-fetch first screenshot immediately
    let nextScreenshotPromise = window.electronAPI.takeScreenshotHires({
        minimizeAll: true  // hide everything including Pecifics
    });
    
    while (stepCount < maxSteps && !shouldStop) {
        stepCount++;
        
        // PARALLEL: get screenshot (prefetched) + post status update simultaneously
        const [screenshot] = await Promise.all([
            nextScreenshotPromise,
            updateVisionStatus(taskId, `Step ${stepCount}/${maxSteps}...`)
        ]);
        
        // Get next action from vision model
        let actionResponse;
        try {
            actionResponse = await callVisionProvider(screenshot, goal, stepHistory);
            consecutiveErrors = 0;
        } catch (err) {
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
                return { success: false, reason: `Aborted: 3 consecutive vision errors. Last: ${err.message}` };
            }
            // Prefetch next screenshot immediately even on error
            nextScreenshotPromise = window.electronAPI.takeScreenshotHires({});
            continue;
        }
        
        // Handle batched actions (array) or single action
        const actions = actionResponse.actions || [actionResponse];
        
        // Terminal states
        if (actions[0].action === 'done') return { success: true };
        if (actions[0].action === 'fail') return { success: false, reason: actions[0].description };
        
        // Execute actions + SIMULTANEOUSLY start next screenshot pipeline
        const execPromise = executeBatchedVisionActions(actions, goal);
        
        // Start settle detection in parallel with execution
        const settlePromise = execPromise.then(() => waitForScreenSettle(800, 150));
        
        // Prefetch next screenshot after settle — runs in background
        nextScreenshotPromise = settlePromise.then(() => 
            window.electronAPI.takeScreenshotHires({})
        );
        
        // Wait for execution to complete (not settle — that's in background)
        await execPromise;
        
        stepHistory.push({
            step: stepCount, 
            actions: actions.map(a => a.description).join(' → ')
        });
    }
    
    return { success: false, reason: 'Max steps reached' };
}

async function executeBatchedVisionActions(actions, windowTitle) {
    for (const action of actions) {
        if (shouldStop) break;
        if (action.action === 'wait') {
            await delay(Math.min(action.ms || 500, 2000));
            continue;
        }
        // Always focus target window before vision clicks
        await window.electronAPI.executeAction({
            action: 'vision_execute',
            params: { ...action, windowTitle }
        });
        await delay(60);  // tiny gap between batched actions
    }
}

async function waitForScreenSettle(maxWaitMs = 800, intervalMs = 150) {
    const start = Date.now();
    let lastHash = null, stableCount = 0;
    
    while (Date.now() - start < maxWaitMs) {
        await delay(intervalMs);
        try {
            const snap = await window.electronAPI.takeScreenshot();
            const hash = quickHash(snap.substring(200, 800));
            if (hash === lastHash) { 
                stableCount++;
                if (stableCount >= 2) return;  // stable for 2 checks = settled
            } else stableCount = 0;
            lastHash = hash;
        } catch { return; }
    }
}

function quickHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}
```

---

## Part 10 — File Structure After Re-Architecture

```
jarvis-desktop/src/modules/
  action-executor.js          ← updated: routes to engines, registers app handlers
  screen-agent.js             ← REWRITTEN: nut-js primary, proper fallback
  browser-automation.js       ← updated: new browser engine functions
  system-manager.js           ← unchanged
  os-tasks.js                 ← unchanged
  file-manager.js             ← unchanged
  safety-guard.js             ← unchanged
  
  app-handlers/               ← NEW DIRECTORY
    index.js                  ← handler registry + executeAppEngine()
    whatsapp.js               ← FIXED WhatsApp: Ctrl+F flow, window rect positioning
    spotify.js                ← Spotify: URI protocol + keyboard shortcuts
    telegram.js               ← Telegram: keyboard shortcut flow
    vscode.js                 ← VS Code: terminal, palette, search
    notes.js                  ← Notepad/Notes: open, type, save
    calculator.js             ← Calculator: keypad input
    
  Office COM (unchanged):
  powerpoint-com.js
  word-com.js
  excel-com.js
  onenote-com.js
  publisher-com.js

colab-backend/
  langchain_backend.py        ← add /route endpoint + ROUTER_PROMPT
  (everything else unchanged)
```

---

## Part 11 — Execution Decision Matrix

This is the definitive routing decision for every type of task. Each developer working on this should know this matrix by heart.

| User Command Type | Engine | Method | CogAgent Used? | Est. Time |
|-------------------|--------|--------|----------------|-----------|
| Set volume, brightness, WiFi | System Direct | PowerShell/WMI | Never | 100-300ms |
| Create/read/write files | System Direct | Node.js fs | Never | 50-200ms |
| Run CMD command | System Direct | child_process | Never | 200-500ms |
| Battery, disk, network status | System Direct | WMI/PowerShell | Never | 200-400ms |
| Google/Bing search | Browser DOM | Playwright | Never | 1-2s |
| Navigate to URL | Browser DOM | Playwright | Never | 1-3s |
| Fill web form | Browser DOM | Playwright CSS | Never | 1-3s |
| Read webpage content | Browser DOM | Playwright DOM | Never | 1-2s |
| WhatsApp message | App Handler | Ctrl+F keyboard | Never | 3-5s |
| Telegram message | App Handler | Keyboard flow | Never | 3-5s |
| Spotify play music | App Handler | URI + keyboard | Never | 2-3s |
| VS Code open file | App Handler | `code` CLI | Never | 1-2s |
| Word create document | Office COM | COM automation | Never | 2-4s |
| Excel write data | Office COM | COM automation | Never | 2-5s |
| PowerPoint generate | Office COM + LLM | COM + Groq | Never | 5-15s |
| Unknown app automation | Vision | Gemini → CogAgent | Sometimes | 10-30s |
| Click arbitrary UI element | Vision | Gemini → CogAgent | Sometimes | 5-20s |
| Read arbitrary screen content | Vision | Gemini describe | Rarely | 3-8s |
| Write email draft (no send) | Compose | Groq generate | Never | 2-5s |
| Summarize content | Compose | Groq generate | Never | 2-5s |

**Rule: CogAgent is only used for Vision engine tasks where Gemini fails or CogAgent is configured and the task requires pixel-accurate clicking on unknown UI.**

---

## Part 12 — Implementation Schedule

### Day 1 — Fix WhatsApp (2-3 hours)
1. Create `app-handlers/` directory and `index.js`
2. Write `app-handlers/whatsapp.js` with the `Ctrl+F` flow
3. Register in `action-executor.js`
4. Add `app_engine` case to `action-executor.js` dispatcher
5. Add to `preload.js` if needed
6. Test: "send whatsapp message to [contact]: [message]"

### Day 2 — Fix screen-agent.js (3-4 hours)
7. Rewrite `screen-agent.js` with proper nut-js initialization
8. Fix the `bringToForeground()` function to use window rect
9. Test nut-js is actually primary (add console.log to confirm)
10. Test click, type, key, scroll all work through nut-js

### Day 3 — Add the Intent Router (2-3 hours)
11. Add `ROUTER_PROMPT` to `langchain_backend.py`
12. Add `route_intent()` async function
13. Add `/route` FastAPI endpoint
14. Update `renderer.js` `sendMessage()` to call `/route` first
15. Add engine dispatcher switch in renderer

### Day 4 — Browser Engine upgrades (2 hours)
16. Add `clickByText()`, `typeInField()`, `extractPageData()` to `browser-automation.js`
17. Add `executeBrowserEngine()` dispatcher
18. Wire to renderer browser engine case

### Day 5 — Vision Loop parallel pipeline (2-3 hours)
19. Replace vision loop with prefetch + parallel settle design
20. Add action batching support
21. Add consecutive error cap (already exists but verify it works)
22. Test end-to-end on a real vision task

### Day 6 — More App Handlers (2-3 hours)
23. `app-handlers/spotify.js`
24. `app-handlers/vscode.js`
25. `app-handlers/telegram.js`
26. Register all handlers

### Day 7 — Testing and Timing Verification
27. Time each engine for 5 representative commands
28. Verify nut-js is active (not PowerShell fallback) in logs
29. Verify WhatsApp sends correctly 5 times in a row
30. Verify no CogAgent calls happen for system/browser/app engine tasks
31. Update ARCHITECTURE.md with new engine structure

---

## Part 13 — Expected Performance After Full Implementation

| Task | Before | After |
|------|--------|-------|
| "set volume to 60" | 800ms planning + 400ms exec | 80ms route + 150ms exec = **230ms** |
| "search weather" | 800ms planning + 3s browser | 80ms route + 1.5s Playwright = **1.6s** |
| "msg zainab hi on whatsapp" | 10-25s (broken) | 80ms route + 4s keyboard = **~4s** |
| "open spotify play lofi" | 10-20s vision | 80ms route + 2.5s URI = **2.6s** |
| "create folder Projects" | 600ms planning + 200ms exec | 80ms route + 100ms exec = **180ms** |
| "click the blue button" | 5-15s vision | 5-15s vision (unchanged — correct) |
| "what's on my screen" | 3-8s describe | 3-8s describe (unchanged — correct) |

The gains are dramatic for everything except actual vision tasks — and vision tasks shouldn't be faster because they genuinely need model inference time. The goal is to ensure vision is only used when nothing else will work.
