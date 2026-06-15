// ============================================
// JARVIS Action Executor Module
// Handles all desktop automation actions
// Pure PowerShell implementation - no native dependencies
// ============================================

const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const safetyGuard = require('./safety-guard');
const powerPointCOM = require('./powerpoint-com');
const wordCOM = require('./word-com');
const excelCOM = require('./excel-com');
const onenoteCOM = require('./onenote-com');
const publisherCOM = require('./publisher-com');
const fileManager = require('./file-manager');
const systemManager = require('./system-manager');
const osTasks = require('./os-tasks');
const browserAutomation = require('./browser-automation');
const screenAgent = require('./screen-agent');
const protocolRegistry = require('./protocol-registry');

// App Handlers Re-Architecture
const appHandlers = require('./app-handlers/index');
const whatsappHandler = require('./app-handlers/whatsapp');
const spotifyHandler = require('./app-handlers/spotify');
const telegramHandler = require('./app-handlers/telegram');
const vscodeHandler = require('./app-handlers/vscode');
const notesHandler = require('./app-handlers/notes');

appHandlers.registerAppHandler(['whatsapp', 'whats app', 'whats-app', 'wa'], whatsappHandler);
appHandlers.registerAppHandler(['spotify'], spotifyHandler);
appHandlers.registerAppHandler(['telegram'], telegramHandler);
appHandlers.registerAppHandler(['vscode', 'visual studio code', 'vs code'], vscodeHandler);
appHandlers.registerAppHandler(['notepad', 'notepad++', 'notes'], notesHandler);

// PowerShell helper class for mouse/keyboard operations (loaded once)
const PS_HELPER_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    
    [DllImport("user32.dll")]
    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);
    
    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
    public const int MOUSEEVENTF_LEFTUP = 0x04;
    public const int MOUSEEVENTF_RIGHTDOWN = 0x08;
    public const int MOUSEEVENTF_RIGHTUP = 0x10;
    public const int MOUSEEVENTF_WHEEL = 0x0800;
}

[StructLayout(LayoutKind.Sequential)]
public struct POINT {
    public int X;
    public int Y;
}
"@
`;

let say = null;
let open = null;

// Try to load optional dependencies (lightweight ones only)
try {
    say = require('say');
} catch (e) {
    console.warn('say not available - using Windows SAPI for text-to-speech');
}

try {
    open = require('open');
} catch (e) {
    console.warn('open not available - URL opening may be limited');
}

// Application paths for Windows - comprehensive mapping with aliases
const APP_PATHS = {
    // Notepad
    'notepad': 'notepad.exe',
    'note pad': 'notepad.exe',
    'text editor': 'notepad.exe',
    
    // Calculator
    'calculator': 'calc.exe',
    'calc': 'calc.exe',
    'calci': 'calc.exe',
    
    // File Explorer
    'explorer': 'explorer.exe',
    'file explorer': 'explorer.exe',
    'files': 'explorer.exe',
    'my computer': 'explorer.exe',
    'this pc': 'explorer.exe',
    
    // Command Line
    'cmd': 'cmd.exe',
    'command prompt': 'cmd.exe',
    'terminal': 'cmd.exe',
    'powershell': 'powershell.exe',
    'ps': 'powershell.exe',
    'power shell': 'powershell.exe',
    
    // Browsers
    'chrome': 'chrome.exe',
    'google chrome': 'chrome.exe',
    'google': 'chrome.exe',
    'firefox': 'firefox.exe',
    'ff': 'firefox.exe',
    'mozilla': 'firefox.exe',
    'mozilla firefox': 'firefox.exe',
    'edge': 'msedge.exe',
    'microsoft edge': 'msedge.exe',
    'ms edge': 'msedge.exe',
    'brave': 'brave.exe',
    'opera': 'opera.exe',
    
    // Microsoft Office - Word
    'word': 'WINWORD.EXE',
    'microsoft word': 'WINWORD.EXE',
    'ms word': 'WINWORD.EXE',
    'msword': 'WINWORD.EXE',
    'winword': 'WINWORD.EXE',
    'doc': 'WINWORD.EXE',
    'document': 'WINWORD.EXE',
    'word processor': 'WINWORD.EXE',
    
    // Microsoft Office - Excel
    'excel': 'EXCEL.EXE',
    'microsoft excel': 'EXCEL.EXE',
    'ms excel': 'EXCEL.EXE',
    'msexcel': 'EXCEL.EXE',
    'spreadsheet': 'EXCEL.EXE',
    'xls': 'EXCEL.EXE',
    'xlsx': 'EXCEL.EXE',
    
    // Microsoft Office - PowerPoint
    'powerpoint': 'POWERPNT.EXE',
    'power point': 'POWERPNT.EXE',
    'microsoft powerpoint': 'POWERPNT.EXE',
    'ms powerpoint': 'POWERPNT.EXE',
    'mspowerpoint': 'POWERPNT.EXE',
    'ppt': 'POWERPNT.EXE',
    'pptx': 'POWERPNT.EXE',
    'slides': 'POWERPNT.EXE',
    'presentation': 'POWERPNT.EXE',
    
    // Microsoft Office - Outlook
    'outlook': 'OUTLOOK.EXE',
    'microsoft outlook': 'OUTLOOK.EXE',
    'ms outlook': 'OUTLOOK.EXE',
    'msoutlook': 'OUTLOOK.EXE',
    'mail': 'OUTLOOK.EXE',
    'email': 'OUTLOOK.EXE',
    
    // Microsoft Office - OneNote
    'onenote': 'ONENOTE.EXE',
    'one note': 'ONENOTE.EXE',
    'ms onenote': 'ONENOTE.EXE',
    
    // Microsoft Office - Access
    'access': 'MSACCESS.EXE',
    'ms access': 'MSACCESS.EXE',
    'microsoft access': 'MSACCESS.EXE',
    
    // VS Code
    'vscode': 'code',
    'vs code': 'code',
    'code': 'code',
    'visual studio code': 'code',
    
    // Visual Studio
    'visual studio': 'devenv.exe',
    'vs': 'devenv.exe',
    
    // System Tools
    'paint': 'mspaint.exe',
    'ms paint': 'mspaint.exe',
    'mspaint': 'mspaint.exe',
    'snipping tool': 'SnippingTool.exe',
    'snip': 'SnippingTool.exe',
    'screenshot': 'SnippingTool.exe',
    'task manager': 'taskmgr.exe',
    'taskmgr': 'taskmgr.exe',
    'task mgr': 'taskmgr.exe',
    'control panel': 'control.exe',
    'control': 'control.exe',
    'settings': 'ms-settings:',
    'windows settings': 'ms-settings:',
    
    // Media
    'vlc': 'vlc.exe',
    'media player': 'wmplayer.exe',
    'windows media player': 'wmplayer.exe',
    'wmp': 'wmplayer.exe',
    'spotify': 'spotify.exe',
    'itunes': 'iTunes.exe',
    
    // Communication
    'discord': 'discord.exe',
    'slack': 'slack.exe',
    'teams': 'teams.exe',
    'microsoft teams': 'teams.exe',
    'ms teams': 'teams.exe',
    'zoom': 'zoom.exe',
    'skype': 'skype.exe',
    'whatsapp': 'whatsapp.exe',
    'telegram': 'telegram.exe',
    
    // Development
    'git bash': 'git-bash.exe',
    'github': 'github.exe',
    'github desktop': 'github.exe',
    'postman': 'postman.exe',
    'sublime': 'sublime_text.exe',
    'sublime text': 'sublime_text.exe',
    'atom': 'atom.exe',
    'notepad++': 'notepad++.exe',
    'notepadplusplus': 'notepad++.exe',
    'npp': 'notepad++.exe',
    
    // Other common apps
    'steam': 'steam.exe',
    'obs': 'obs64.exe',
    'obs studio': 'obs64.exe',
    'photoshop': 'photoshop.exe',
    'adobe photoshop': 'photoshop.exe',
    'illustrator': 'illustrator.exe',
    'premiere': 'premiere.exe',
    'acrobat': 'acrobat.exe',
    'adobe acrobat': 'acrobat.exe',
    'pdf': 'acrobat.exe',
    'reader': 'AcroRd32.exe',
    'adobe reader': 'AcroRd32.exe',
    'pdf reader': 'AcroRd32.exe'
};

// Smart app name resolver - handles abbreviations, typos, and variations
function resolveAppName(input) {
    if (!input) return null;
    
    const normalized = input.toLowerCase().trim();
    
    // Direct match in APP_PATHS
    if (APP_PATHS[normalized]) {
        return APP_PATHS[normalized];
    }
    
    // Remove common prefixes/suffixes and try again
    const cleanedVariants = [
        normalized,
        normalized.replace(/^open\s+/, ''),       // "open word" -> "word"
        normalized.replace(/^launch\s+/, ''),     // "launch word" -> "word"
        normalized.replace(/^start\s+/, ''),      // "start word" -> "word"
        normalized.replace(/^run\s+/, ''),        // "run word" -> "word"
        normalized.replace(/\s+app$/, ''),        // "word app" -> "word"
        normalized.replace(/\s+application$/, ''), // "word application" -> "word"
        normalized.replace(/[.\-_]/g, ' '),       // "ms-word" -> "ms word"
        normalized.replace(/\s+/g, ''),           // "ms word" -> "msword"
    ];
    
    for (const variant of cleanedVariants) {
        if (APP_PATHS[variant]) {
            return APP_PATHS[variant];
        }
    }
    
    // Fuzzy matching - find closest match
    const appKeys = Object.keys(APP_PATHS);
    
    // Check if input contains any known app name
    for (const key of appKeys) {
        if (normalized.includes(key) || key.includes(normalized)) {
            return APP_PATHS[key];
        }
    }
    
    // Check for partial matches (at least 3 characters match)
    for (const key of appKeys) {
        const keyWords = key.split(/\s+/);
        const inputWords = normalized.split(/\s+/);
        
        for (const kw of keyWords) {
            for (const iw of inputWords) {
                if (kw.length >= 3 && iw.length >= 3) {
                    if (kw.startsWith(iw) || iw.startsWith(kw)) {
                        return APP_PATHS[key];
                    }
                }
            }
        }
    }
    
    // No match found, return original input (will try to run as-is)
    return input;
}

class ActionExecutor {
    constructor() {
        this.lastClickTime = 0;
        this.lastClickPos = { x: 0, y: 0 };
        // Track last opened app to re-focus before typing/pressing keys
        this.lastOpenedAppName = null;
        // Flag to stop execution
        this.shouldStop = false;

        // Initialize persistent background PowerShell bridge for zero-spawn win32 actions
        try {
            console.log('[action-executor] Initializing persistent PowerShell bridge...');
            this.psBridge = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            this.psBridge.stdin.setDefaultEncoding('utf-8');

            const initCommands = `
                Add-Type -AssemblyName System.Windows.Forms
                Add-Type -AssemblyName UIAutomationClient
                Add-Type -AssemblyName UIAutomationTypes
                Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                public class Win32 {
                    [DllImport("user32.dll")]
                    public static extern bool SetCursorPos(int x, int y);
                    [DllImport("user32.dll")]
                    public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
                    
                    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
                    public const int MOUSEEVENTF_LEFTUP = 0x04;
                    public const int MOUSEEVENTF_RIGHTDOWN = 0x08;
                    public const int MOUSEEVENTF_RIGHTUP = 0x10;
                    public const int MOUSEEVENTF_WHEEL = 0x0800;

                    [DllImport("user32.dll")]
                    public static extern IntPtr GetForegroundWindow();
                }
"@
                function Snap-Coordinate($x, $y) {
                    $offsets = @(
                        [System.Windows.Point]::new($x, $y),
                        [System.Windows.Point]::new($x - 12, $y),
                        [System.Windows.Point]::new($x + 12, $y),
                        [System.Windows.Point]::new($x, $y - 12),
                        [System.Windows.Point]::new($x, $y + 12)
                    )
                    foreach ($pt in $offsets) {
                        try {
                            $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
                            if ($el -ne $null) {
                                $ctrlType = $el.Current.ControlType
                                if ($ctrlType -eq [System.Windows.Automation.ControlType]::Button -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::Edit -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::Hyperlink -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::CheckBox -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::MenuItem -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::ComboBox -or
                                    $ctrlType -eq [System.Windows.Automation.ControlType]::ListItem) {
                                    
                                    $rect = $el.Current.BoundingRectangle
                                    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
                                        $centerX = [math]::Round($rect.Left + ($rect.Width / 2))
                                        $centerY = [math]::Round($rect.Top + ($rect.Height / 2))
                                        return "$centerX,$centerY"
                                    }
                                }
                            }
                        } catch {}
                    }
                    return "$x,$y"
                }
                Write-Output "PS_BRIDGE_READY"
            `;
            this.psBridge.stdin.write(initCommands + "\n");
            
            this.psBridge.stdout.on('data', (data) => {
                const text = data.toString().trim();
                if (text.includes('PS_BRIDGE_READY')) {
                    console.log('✅ Persistent background PowerShell bridge is fully READY!');
                }
            });

            this.psBridge.stderr.on('data', (data) => {
                const err = data.toString().trim();
                if (err) console.warn('[powershell-bridge-stderr]', err);
            });
        } catch (e) {
            console.error('❌ Failed to spawn persistent PowerShell bridge:', e);
            this.psBridge = null;
        }
    }

    normalizeBackendUrl(value) {
        let backendUrl = String(value || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');
        if (!backendUrl) backendUrl = 'http://127.0.0.1:8000';
        return backendUrl.replace(/^http:\/\/localhost(?=[:/]|$)/i, 'http://127.0.0.1');
    }

    // Stop execution method
    stopExecution() {
        this.shouldStop = true;
        return { success: true, message: 'Stopping execution...' };
    }

    // Reset stop flag
    resetStopFlag() {
        this.shouldStop = false;
    }

    // Check if execution should stop
    isStopped() {
        return this.shouldStop;
    }

    // Write a command directly to the persistent background PowerShell bridge (under 2ms)
    writeToPSBridge(command) {
        if (this.psBridge && this.psBridge.stdin && this.psBridge.stdin.writable) {
            try {
                this.psBridge.stdin.write(command.trim() + "\n");
                return true;
            } catch (e) {
                console.error('[powershell-bridge-write-failed]', e);
            }
        }
        return false;
    }

    // Snap target visual coordinate to center of native Win32 controls using UIA bridge function
    async snapCoordinates(x, y) {
        if (!this.psBridge || !this.psBridge.stdin || !this.psBridge.stdin.writable) {
            return { x, y };
        }
        return new Promise((resolve) => {
            const requestId = `SNAP_${Date.now()}_${Math.round(Math.random() * 1000)}`;
            const onData = (data) => {
                const text = data.toString().trim();
                if (text.includes(requestId)) {
                    const match = text.match(/SNAP_RESULT:(\d+),(\d+)/);
                    if (match) {
                        const snapX = parseInt(match[1]);
                        const snapY = parseInt(match[2]);
                        console.log(`[UIA Snapper] Snapped coordinate (${x}, ${y}) -> (${snapX}, ${snapY})`);
                        cleanup();
                        resolve({ x: snapX, y: snapY });
                    }
                }
            };
            const cleanup = () => {
                this.psBridge.stdout.off('data', onData);
                clearTimeout(timeout);
            };
            const timeout = setTimeout(() => {
                cleanup();
                resolve({ x, y });
            }, 300);

            this.psBridge.stdout.on('data', onData);
            this.psBridge.stdin.write(`$res = Snap-Coordinate ${x} ${y}; Write-Output "${requestId} SNAP_RESULT:$res"\n`);
        });
    }


    // ============================================
    // File System Operations
    // ============================================

    async createFile(filePath, content = '') {
        try {
            // Ensure directory exists
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            
            // Write file
            await fs.writeFile(filePath, content, 'utf8');
            return { success: true, message: `Created file: ${filePath}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async createFolder(folderPath) {
        try {
            await fs.mkdir(folderPath, { recursive: true });
            return { success: true, message: `Created folder: ${folderPath}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async createPresentation(title, savePath, slidesContent) {
        try {
            const os = require('os');
            const path = require('path');
            // Resolve friendly paths
            let resolvedPath = savePath || 'Desktop';
            if (resolvedPath.toLowerCase() === 'desktop') resolvedPath = path.join(os.homedir(), 'Desktop');
            else if (resolvedPath.toLowerCase() === 'documents') resolvedPath = path.join(os.homedir(), 'Documents');
            else if (resolvedPath.toLowerCase() === 'downloads') resolvedPath = path.join(os.homedir(), 'Downloads');
            const presentationTitle = title || 'Presentation';
            const safeTitle = presentationTitle.replace(/[\\/:*?"<>|]/g, '_');
            const finalPath = path.join(resolvedPath, safeTitle.endsWith('.pptx') ? safeTitle : safeTitle + '.pptx');
            // Build slides array
            let slides = [];
            if (Array.isArray(slidesContent)) {
                slides = slidesContent;
            } else if (typeof slidesContent === 'string') {
                try { slides = JSON.parse(slidesContent); } catch { slides = [{ title: presentationTitle, content: slidesContent }]; }
            } else {
                slides = [{ title: presentationTitle, content: 'AI-generated presentation.' }];
            }
            if (slides.length === 0) slides = [{ title: presentationTitle, content: '' }];
            // Build PowerShell COM script
            let slideCmds = '';
            slides.forEach((s, i) => {
                const slideTitle = (s.title || 'Slide ' + (i + 1)).replace(/'/g, "''");
                const slideBody = (s.content || '').replace(/'/g, "''");
                if (i === 0) {
                    slideCmds += `\n$slide = $pres.Slides(1)\n$slide.Shapes(1).TextFrame.TextRange.Text = '${slideTitle}'\nif ($slide.Shapes.Count -gt 1) { $slide.Shapes(2).TextFrame.TextRange.Text = '${slideBody}' }\n`;
                } else {
                    slideCmds += `\n$slide = $pres.Slides.Add(${i + 1}, 1)\n$slide.Shapes(1).TextFrame.TextRange.Text = '${slideTitle}'\nif ($slide.Shapes.Count -gt 1) { $slide.Shapes(2).TextFrame.TextRange.Text = '${slideBody}' }\n`;
                }
            });
            const psScript = `$ppt = New-Object -ComObject PowerPoint.Application\n$ppt.Visible = 1\n$pres = $ppt.Presentations.Add()\n${slideCmds}\n$pres.SaveAs('${finalPath.replace(/\\/g, '\\\\')}')\n$ppt.Quit()`;
            const tmpFile = path.join(os.tmpdir(), 'create_pptx_' + Date.now() + '.ps1');
            require('fs').writeFileSync(tmpFile, psScript, 'utf8');
            const { execSync } = require('child_process');
            execSync(`powershell.exe -ExecutionPolicy Bypass -File "${tmpFile}"`, { timeout: 30000 });
            require('fs').unlinkSync(tmpFile);
            // Open the file to show the user the result
            const { shell } = require('electron');
            await shell.openPath(finalPath);
            return { success: true, message: `Presentation created and opened: ${finalPath}`, path: finalPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate a Gamma-quality PPT via the backend LLM + ppt_generator_pro.
     * The backend creates the .pptx file and returns its path.
     * We then open it for the user and flag ask_for_edits=true.
     */
    async generatePPT(params) {
        try {
            const http = require('http');
            const Store = require('electron-store');
            const store = new Store();
            const backendUrl = this.normalizeBackendUrl(store.get('colabUrl'));
            const body = JSON.stringify({
                topic: params.topic || params.title || 'Presentation',
                title: params.title || params.topic || 'Presentation',
                num_slides: params.num_slides || params.slides || 5,
                theme: params.theme || 'gamma_modern',
                save_path: params.save_path || 'Desktop',
                additional_instructions: params.additional_instructions || params.instructions || null,
            });

            const result = await new Promise((resolve, reject) => {
                const req = http.request(`${backendUrl}/generate_ppt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
                }, res => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
                    });
                });
                req.on('error', reject);
                req.setTimeout(120000, () => { req.destroy(); reject(new Error('PPT generation timed out (120s)')); });
                req.write(body);
                req.end();
            });

            if (result.success && result.path) {
                const filePath = result.path.replace(/\//g, '\\');
                const { shell } = require('electron');
                await shell.openPath(filePath);
                return {
                    success: true,
                    message: result.message || `PPT created: ${filePath}`,
                    path: filePath,
                    ask_for_edits: true,
                };
            }
            return { success: false, error: result.detail || result.error || 'PPT generation failed' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteFile(filePath) {
        try {
            const stat = await fs.stat(filePath);
            if (stat.isDirectory()) {
                await fs.rmdir(filePath, { recursive: true });
            } else {
                await fs.unlink(filePath);
            }
            return { success: true, message: `Deleted: ${filePath}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async readFile(filePath) {
        try {
            const ext = path.extname(filePath).toLowerCase();
            // For Word docs, return paragraph list via COM
            if (ext === '.docx' || ext === '.doc') {
                return await wordCOM.readDocumentContent();
            }
            const content = await fs.readFile(filePath, 'utf8');
            return { success: true, content: content };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Find text inside any file and return matching lines with line numbers
    async findInFile(filePath, searchText) {
        try {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.docx' || ext === '.doc') {
                // Word: search paragraphs via COM
                const result = await wordCOM.readDocumentContent();
                if (!result.success) return result;
                const matches = (result.paragraphs || []).filter(p =>
                    p.Text && p.Text.toLowerCase().includes(searchText.toLowerCase())
                );
                return { success: true, matches, count: matches.length,
                    message: `Found "${searchText}" in ${matches.length} paragraph(s)` };
            }
            if (ext === '.pptx' || ext === '.ppt') {
                return await powerPointCOM.findSlideByText(searchText);
            }
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n');
            const matches = [];
            lines.forEach((line, idx) => {
                if (line.toLowerCase().includes(searchText.toLowerCase())) {
                    matches.push({ line: idx + 1, text: line.trim() });
                }
            });
            return { success: true, matches, count: matches.length,
                message: `Found "${searchText}" in ${matches.length} line(s)` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Replace text inside any file (plain text, Word, PPT)
    async replaceInFile(filePath, searchText, replacementText, replaceAll = true) {
        try {
            const ext = path.extname(filePath).toLowerCase();
            if (ext === '.docx' || ext === '.doc') {
                return await wordCOM.findAndReplace(searchText, replacementText, replaceAll);
            }
            if (ext === '.pptx' || ext === '.ppt') {
                // For PPT: find the slide first, then update
                const found = await powerPointCOM.findSlideByText(searchText);
                if (!found.success || !found.slides || found.slides.length === 0) {
                    return { success: false, error: `"${searchText}" not found in any slide` };
                }
                const results = [];
                for (const s of found.slides) {
                    const r = await powerPointCOM.updateSlideText(
                        s.SlideNumber, searchText, replacementText
                    );
                    results.push(r);
                }
                return { success: true, message: `Updated ${results.length} slide(s)`, results };
            }
            // Plain text files (txt, md, csv, js, py, html, etc.)
            const content = await fs.readFile(filePath, 'utf8');
            const count = content.split(searchText).length - 1;
            if (count === 0) return { success: false, error: `"${searchText}" not found in file` };
            const updated = replaceAll
                ? content.split(searchText).join(replacementText)
                : content.replace(searchText, replacementText);
            await fs.writeFile(filePath, updated, 'utf8');
            return { success: true,
                message: `Replaced ${replaceAll ? count : 1} occurrence(s) of "${searchText}" with "${replacementText}"` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // Append text to any file
    async appendToFile(filePath, content) {
        try {
            await fs.appendFile(filePath, '\n' + content, 'utf8');
            return { success: true, message: `Content appended to ${filePath}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async listDirectory(dirPath) {
        try {
            const items = await fs.readdir(dirPath, { withFileTypes: true });
            const result = items.map(item => ({
                name: item.name,
                type: item.isDirectory() ? 'folder' : 'file'
            }));
            return { success: true, items: result };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async copyFile(source, destination) {
        try {
            await fs.copyFile(source, destination);
            return { success: true, message: `Copied ${source} to ${destination}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async moveFile(source, destination) {
        try {
            await fs.rename(source, destination);
            return { success: true, message: `Moved ${source} to ${destination}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async renameFile(oldPath, newName) {
        try {
            const dir = path.dirname(oldPath);
            const newPath = path.join(dir, newName);
            await fs.rename(oldPath, newPath);
            return { success: true, message: `Renamed to ${newName}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // Application Control
    // ============================================

    async openApplication(appName) {
        return new Promise((resolve) => {
            // Use smart app name resolution
            const command = resolveAppName(appName);
            console.log(`Opening application: "${appName}" -> resolved to: "${command}"`);
            
            // Handle special cases (Windows Settings)
            if (command.startsWith('ms-settings:')) {
                exec(`start ${command}`, (error) => {
                    if (error) {
                        resolve({ success: false, error: error.message });
                    } else {
                        resolve({ success: true, message: `Opened ${appName}` });
                    }
                });
                return;
            }

            // Try multiple methods to open the application
            this.tryOpenApp(command, appName)
                .then(result => resolve(result))
                .catch(err => resolve({ success: false, error: err.message }));
        });
    }

    async tryOpenApp(command, originalName) {
        return new Promise(async (resolve) => {
            console.log(`[tryOpenApp] Attempting to launch: "${originalName}" (fallback command: "${command}")`);
            
            // Method 1: Search and Launch via Start Menu (UWP & Win32 shortcuts — uses temp .ps1 file, zero escaping issues)
            const uwpResult = await this.searchAndLaunchApp(originalName);
            if (uwpResult.success) {
                await this.waitForAppAndFocusRobust(command, uwpResult.appName || originalName, 3000);
                this.lastOpenedAppName = originalName;
                resolve({ success: true, message: uwpResult.message });
                return;
            }
            
            // Method 2: URI Protocol Launch (works for apps registered with protocol handlers like whatsapp://)
            const uriProtocols = {
                'whatsapp': 'whatsapp://', 'telegram': 'tg://', 'discord': 'discord://',
                'slack': 'slack://', 'zoom': 'zoommtg://', 'spotify': 'spotify://',
                'teams': 'msteams://', 'microsoft teams': 'msteams://', 'ms teams': 'msteams://',
                'skype': 'skype://', 'steam': 'steam://'
            };
            const uriKey = originalName.toLowerCase().trim();
            if (uriProtocols[uriKey]) {
                try {
                    const uriResult = await new Promise((res) => {
                        exec(`start "" "${uriProtocols[uriKey]}"`, { timeout: 5000 }, (err) => {
                            res(err ? null : true);
                        });
                    });
                    if (uriResult) {
                        await this.waitForAppAndFocusRobust(command, originalName, 3000);
                        this.lastOpenedAppName = originalName;
                        resolve({ success: true, message: `Opened ${originalName} via URI protocol` });
                        return;
                    }
                } catch (e) { /* fall through */ }
            }

            // Method 3: Direct Command Line (only for non-UWP apps that are in PATH)
            // Suppress Windows popup by using powershell Start-Process with -ErrorAction
            exec(`powershell -NoProfile -Command "Start-Process '${command}' -ErrorAction Stop"`, { timeout: 5000 }, async (error) => {
                if (!error) {
                    await this.waitForAppAndFocusRobust(command, originalName, 3000);
                    this.lastOpenedAppName = originalName;
                    resolve({ success: true, message: `Opened ${originalName} (PATH)` });
                    return;
                }
                
                // Method 4: Windows Run Dialog simulation (last resort — types the app name into Win+R)
                exec(`start ${command}`, { timeout: 5000 }, async (err2) => {
                    if (!err2) {
                        await this.waitForAppAndFocusRobust(command, originalName, 3000);
                        this.lastOpenedAppName = originalName;
                        resolve({ success: true, message: `Opened ${originalName} (bare)` });
                        return;
                    }
                    
                    resolve({ success: false, error: `Application '${originalName}' is not installed or could not be launched.` });
                });
            });
        });
    }

    async searchAndLaunchApp(appName) {
        // Write a temp PowerShell script file to avoid ALL escaping/expansion issues
        const os = require('os');
        const fs = require('fs');
        const tmpScript = path.join(os.tmpdir(), `pecifics_launch_${Date.now()}.ps1`);
        const escapedName = appName.replace(/'/g, "''");
        
        const scriptContent = `
$app = Get-StartApps | Where-Object Name -like '*${escapedName}*' | Select-Object -First 1
if ($app) {
    Start-Process "explorer.exe" -ArgumentList ("shell:AppsFolder\\" + $app.AppID)
    Write-Output ("SUCCESS:" + $app.Name)
} else {
    Write-Output "NOT_FOUND"
}
`;
        return new Promise((resolve) => {
            try {
                fs.writeFileSync(tmpScript, scriptContent, 'utf8');
                exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpScript}"`, { timeout: 10000 }, (error, stdout) => {
                    // Clean up temp file
                    try { fs.unlinkSync(tmpScript); } catch (e) {}
                    
                    const output = (stdout || '').trim();
                    console.log(`[searchAndLaunchApp] PowerShell output: "${output}", error: ${error ? error.message : 'none'}`);
                    if (output.startsWith("SUCCESS:")) {
                        const actualName = output.substring(8);
                        resolve({ success: true, message: `Launched ${actualName} from Start Menu`, appName: actualName });
                    } else {
                        resolve({ success: false, error: `Could not find ${appName} in Start Menu` });
                    }
                });
            } catch (e) {
                console.error(`[searchAndLaunchApp] Failed to write temp script: ${e.message}`);
                resolve({ success: false, error: e.message });
            }
        });
    }

    async focusApplicationWindowRobust(appName, processName) {
        return new Promise((resolve) => {
            const safeAppName = String(appName || '').replace(/'/g, "''");
            const safeProcessName = String(processName || '').replace(/'/g, "''");
            const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@
$appName = '${safeAppName}'
$processName = '${safeProcessName}'
$processNeedle = ($processName -replace '\\.EXE$', '')
$all = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
$candidates = @()
foreach ($p in $all) {
    $score = 0
    if ($appName -and $p.MainWindowTitle -like "*$appName*") { $score += 100 }
    if ($processNeedle -and $p.ProcessName -like "*$processNeedle*") { $score += 80 }
    if ($appName -match 'WhatsApp' -and $p.ProcessName -like 'WhatsApp*') { $score += 90 }
    if ($appName -match 'WhatsApp' -and $p.ProcessName -eq 'ApplicationFrameHost' -and $p.MainWindowTitle -like '*WhatsApp*') { $score += 85 }
    if ($appName -match 'WhatsApp' -and $p.ProcessName -eq 'msedgewebview2' -and $p.MainWindowTitle -like '*WhatsApp*') { $score += 70 }
    if ($score -gt 0) {
        $candidates += [pscustomobject]@{
            process = $p.ProcessName
            title = $p.MainWindowTitle
            handle = $p.MainWindowHandle.ToInt64()
            score = $score
        }
    }
$target = $candidates | Sort-Object score -Descending | Select-Object -First 1
if ($target) {
    $handle = [IntPtr]$target.handle
    [WindowHelper]::ShowWindow($handle, 9) | Out-Null
    Start-Sleep -Milliseconds 80
    $setForegroundOk = [WindowHelper]::SetForegroundWindow($handle)
    Start-Sleep -Milliseconds 180
    $appActivateOk = $false
    try {
        $shell = New-Object -ComObject WScript.Shell
        $appActivateOk = [bool]($shell.AppActivate($target.title) -or $shell.AppActivate($appName))
        Start-Sleep -Milliseconds 180
    } catch {}
    $fg = [WindowHelper]::GetForegroundWindow()
    $builder = New-Object System.Text.StringBuilder 512
    [WindowHelper]::GetWindowText($fg, $builder, $builder.Capacity) | Out-Null
    $foregroundTitle = $builder.ToString()
    $success = [bool]($setForegroundOk -or $appActivateOk -or ($foregroundTitle -like "*$($target.title)*") -or ($appName -and $foregroundTitle -like "*$appName*"))
    [pscustomobject]@{
        success = $success
        reason = if ($success) { 'focused' } else { 'foreground_not_changed' }
        method = if ($setForegroundOk) { 'SetForegroundWindow' } elseif ($appActivateOk) { 'WScript.AppActivate' } else { 'foreground_check' }
        matchedProcess = $target.process
        matchedTitle = $target.title
        setForegroundOk = [bool]$setForegroundOk
        appActivateOk = [bool]$appActivateOk
        foregroundTitle = $foregroundTitle
        candidates = @($candidates | Sort-Object score -Descending | Select-Object -First 5)
    } | ConvertTo-Json -Depth 5 -Compress
} else {
    [pscustomobject]@{
        success = $false
        reason = 'no_window_candidate'
        appName = $appName
        processName = $processName
        visibleWindows = @($all | Select-Object -First 12 ProcessName, MainWindowTitle)
    } | ConvertTo-Json -Depth 4 -Compress
}
`;

            const fsSync = require('fs');
            const tempFile = path.join(os.tmpdir(), `pecifics-focus-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
            fsSync.writeFileSync(tempFile, psScript, 'utf8');
            exec(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tempFile}"`, { timeout: 5000, maxBuffer: 1024 * 512 }, (error, stdout, stderr) => {
                try { fsSync.unlinkSync(tempFile); } catch (e) {}
                const output = (stdout || '').trim();
                const raw = output.split(/\r?\n/).reverse().find(line => line.trim().startsWith('{')) || output;
                let parsed = null;
                try {
                    parsed = raw ? JSON.parse(raw) : null;
                } catch (e) {
                    parsed = null;
                }
                const details = parsed || {
                    success: false,
                    reason: 'unparseable_focus_output',
                    output,
                    stderr: (stderr || '').trim(),
                    error: error ? error.message : null
                };
                if (error && details.success !== true) {
                    details.error = error.message;
                    details.stderr = (stderr || '').trim();
                }
                console.log(`[focusApplicationWindowRobust] ${appName}: ${JSON.stringify(details)}`);
                resolve(details);
            });
        });
    }

    async waitForAppAndFocusRobust(command, appName, maxWaitMs = 5000) {
        const startTime = Date.now();
        const processName = path.basename(command, '.exe').toUpperCase();
        let attempts = 0;
        let lastDetails = null;

        while (Date.now() - startTime < maxWaitMs) {
            attempts += 1;
            try {
                lastDetails = await this.focusApplicationWindowRobust(appName, processName);
                if (lastDetails.success) {
                    return { success: true, attempts, elapsedMs: Date.now() - startTime, appName, processName, lastDetails };
                }
            } catch (e) {
                lastDetails = { success: false, reason: 'focus_exception', error: e.message };
            }
            await this.delay(350);
        }

        return { success: false, attempts, elapsedMs: Date.now() - startTime, appName, processName, lastDetails };
    }

    async waitForAppAndFocus(command, appName, maxWaitMs = 5000) {
        // Wait for the application window to appear and give it focus
        const startTime = Date.now();
        const processName = path.basename(command, '.exe').toUpperCase();
        let intervalCleared = false;
        let focusAttempts = 0;
        
        return new Promise((resolve) => {
            const checkInterval = setInterval(async () => {
                const elapsed = Date.now() - startTime;
                
                // STOP CONDITION: Prevent infinite loop
                if (elapsed >= maxWaitMs) {
                    if (!intervalCleared) {
                        clearInterval(checkInterval);
                        intervalCleared = true;
                    }
                    return;
                }
                
                // Try to activate the window
                try {
                    const focused = await this.focusApplicationWindow(appName, processName);
                    if (focused) {
                        focusAttempts++;
                        console.log(`✓ Focused ${appName} (attempt ${focusAttempts})`);
                    }
                } catch (e) {
                    // Ignore errors during focus attempts
                }
            }, 500);
            
            // GUARANTEED TIMEOUT: Force resolve after max wait
            setTimeout(() => {
                if (!intervalCleared) {
                    clearInterval(checkInterval);
                    intervalCleared = true;
                }
                console.log(`Focus complete for ${appName} after ${focusAttempts} successful attempts`);
                resolve(focusAttempts > 0);
            }, maxWaitMs + 100);
        });
    }

    async focusApplicationWindow(appName, processName) {
        return new Promise((resolve) => {
            const safeAppName = String(appName || '').replace(/'/g, "''");
            const safeProcessName = String(processName || '').replace(/'/g, "''");
            // Use PowerShell to find and focus the window
            const psScript = `
                Add-Type @"
                using System;
                using System.Runtime.InteropServices;
                public class WindowHelper {
                    [DllImport("user32.dll")]
                    public static extern bool SetForegroundWindow(IntPtr hWnd);
                    [DllImport("user32.dll")]
                    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                }
"@
                $appName = '${safeAppName}'
                $processName = '${safeProcessName}'
                $processes = Get-Process | Where-Object { 
                    $_.MainWindowTitle -ne '' -and 
                    ($_.ProcessName -like "*$processName*" -or $_.MainWindowTitle -like "*$appName*")
                } | Sort-Object MainWindowTitle | Select-Object -First 1
                
                if ($processes) {
                    [WindowHelper]::ShowWindow($processes.MainWindowHandle, 9)
                    $ok = [WindowHelper]::SetForegroundWindow($processes.MainWindowHandle)
                    Start-Sleep -Milliseconds 150
                    Write-Output ("Focused:" + $ok + ":" + $processes.ProcessName + ":" + $processes.MainWindowTitle)
                } else {
                    Write-Output "NotFound"
                }
            `;
            
            // Add timeout to prevent hanging
            const timeout = setTimeout(() => {
                resolve(false);
            }, 3000);
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, (error, stdout) => {
                clearTimeout(timeout);
                const output = (stdout || '').trim();
                if (output) console.log(`[focusApplicationWindow] ${appName}: ${output}`);
                resolve(!error && output.includes('Focused:'));
            });
        });
    }

    async closeApplication(appName) {
        return new Promise((resolve) => {
            const appNameLower = appName.toLowerCase().trim();
            
            // Windows: use taskkill
            exec(`taskkill /IM "${appNameLower}.exe" /F`, (error) => {
                if (error) {
                    // Try without .exe
                    exec(`taskkill /IM "${appNameLower}" /F`, (err) => {
                        if (err) {
                            resolve({ success: false, error: `Could not close ${appName}` });
                        } else {
                            resolve({ success: true, message: `Closed ${appName}` });
                        }
                    });
                } else {
                    resolve({ success: true, message: `Closed ${appName}` });
                }
            });
        });
    }

    async openUrl(url) {
        try {
            if (/^https?:\/\//i.test(String(url || ''))) {
                const browserResult = await browserAutomation.open(url);
                if (browserResult && browserResult.success !== false) {
                    return browserResult;
                }
                console.warn('[action-executor] Managed browser open failed, falling back to system browser:', browserResult?.error || 'unknown');
            }

            const fs = require('fs');
            const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
            const chromePathx86 = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
            if (fs.existsSync(chromePath) || fs.existsSync(chromePathx86)) {
                console.log('[action-executor] Launching Chrome directly with Default profile directory...');
                exec(`start chrome --profile-directory=Default "${url}"`);
            } else if (open) {
                await open(url);
            } else {
                exec(`start "" "${url}"`);
            }
            return { success: true, message: `Opened ${url}` };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async downloadFile(url, filename) {
        return new Promise((resolve) => {
            const downloadPath = path.join(os.homedir(), 'Downloads', filename || 'presentation.pptx');
            console.log(`📥 Downloading ${filename} from ${url} to ${downloadPath}`);
            
            // Use PowerShell to download and open file
            const psScript = `
                try {
                    Invoke-WebRequest -Uri "${url}" -OutFile "${downloadPath}" -UseBasicParsing
                    Start-Process "${downloadPath}"
                    Write-Output "SUCCESS"
                } catch {
                    Write-Output "ERROR:$($_.Exception.Message)"
                }
            `.replace(/\n/g, ' ');
            
            exec(`powershell -Command "${psScript}"`, {timeout: 30000}, (error, stdout, stderr) => {
                const output = stdout.trim();
                if (output === 'SUCCESS') {
                    resolve({ success: true, message: `Downloaded and opened ${filename}`, path: downloadPath });
                } else if (error || stderr) {
                    resolve({ success: false, error: output || error?.message || stderr });
                } else {
                    resolve({ success: false, error: 'Download failed' });
                }
            });
        });
    }

    async searchWeb(query) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        return this.openUrl(searchUrl);
    }

    // ============================================
    // Mouse Control (Pure PowerShell)
    // ============================================

    async moveMouse(x, y) {
        if (this.writeToPSBridge(`[Win32]::SetCursorPos(${x}, ${y})`)) {
            return { success: true, message: `Moved mouse to (${x}, ${y})` };
        }
        // Fallback
        return new Promise((resolve) => {
            const psCommand = `${PS_HELPER_SCRIPT}; [Win32]::SetCursorPos(${x}, ${y})`;
            exec(`powershell -NoProfile -Command "${psCommand.replace(/"/g, '\"').replace(/\n/g, ' ')}"`, (error) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to move mouse' });
                } else {
                    resolve({ success: true, message: `Moved mouse to (${x}, ${y})` });
                }
            });
        });
    }

    async click(x, y, clickType = 'left', double = false) {
        return new Promise(async (resolve) => {
            try {
                // Snap coordinates if x, y are provided
                let snapX = x;
                let snapY = y;
                if (x !== undefined && y !== undefined) {
                    const snapped = await this.snapCoordinates(x, y);
                    snapX = snapped.x;
                    snapY = snapped.y;
                }

                // Move to position first
                if (snapX !== undefined && snapY !== undefined) {
                    await this.moveMouse(snapX, snapY);
                    await this.delay(100);
                }
                
                const downFlags = clickType === 'right' ? 'Win32::MOUSEEVENTF_RIGHTDOWN' : 'Win32::MOUSEEVENTF_LEFTDOWN';
                const upFlags = clickType === 'right' ? 'Win32::MOUSEEVENTF_RIGHTUP' : 'Win32::MOUSEEVENTF_LEFTUP';

                if (this.psBridge && this.psBridge.stdin && this.psBridge.stdin.writable) {
                    this.writeToPSBridge(`[Win32]::mouse_event([${downFlags}], 0, 0, 0, 0)`);
                    await this.delay(50);
                    this.writeToPSBridge(`[Win32]::mouse_event([${upFlags}], 0, 0, 0, 0)`);
                    if (double) {
                        await this.delay(100);
                        this.writeToPSBridge(`[Win32]::mouse_event([${downFlags}], 0, 0, 0, 0)`);
                        await this.delay(50);
                        this.writeToPSBridge(`[Win32]::mouse_event([${upFlags}], 0, 0, 0, 0)`);
                    }
                    resolve({ success: true, message: `Clicked at (${snapX}, ${snapY})` });
                    return;
                }

                // Fallback
                const clickScript = `
                    [Win32]::mouse_event([${downFlags}], 0, 0, 0, 0)
                    Start-Sleep -Milliseconds 50
                    [Win32]::mouse_event([${upFlags}], 0, 0, 0, 0)
                `;
                
                exec(`powershell -NoProfile -Command "${PS_HELPER_SCRIPT}; ${clickScript.replace(/\n/g, ' ').replace(/"/g, '\\"')}"`, { timeout: 5000 }, (error) => {
                    if (error) {
                        console.error('Click error:', error.message);
                        resolve({ success: false, error: 'Failed to click' });
                    } else {
                        resolve({ success: true, message: `Clicked at (${snapX}, ${snapY})` });
                    }
                });
            } catch (error) {
                console.error('Click exception:', error);
                resolve({ success: false, error: 'Failed to click' });
            }
        });
    }

    async scroll(direction, amount = 3) {
        const scrollValue = direction === 'up' ? (amount * 120) : -(amount * 120);
        if (this.writeToPSBridge(`[Win32]::mouse_event([Win32]::MOUSEEVENTF_WHEEL, 0, 0, ${scrollValue}, 0)`)) {
            return { success: true, message: `Scrolled ${direction}` };
        }
        // Fallback
        return new Promise((resolve) => {
            const psCommand = `${PS_HELPER_SCRIPT}; [Win32]::mouse_event([Win32]::MOUSEEVENTF_WHEEL, 0, 0, ${scrollValue}, 0)`;
            exec(`powershell -NoProfile -Command "${psCommand.replace(/"/g, '\"').replace(/\n/g, ' ')}"`, (error) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to scroll' });
                } else {
                    resolve({ success: true, message: `Scrolled ${direction}` });
                }
            });
        });
    }

    async drag(startX, startY, endX, endY) {
        return new Promise(async (resolve) => {
            try {
                const snappedStart = await this.snapCoordinates(startX, startY);
                const snappedEnd = await this.snapCoordinates(endX, endY);

                // Move to start position
                await this.moveMouse(snappedStart.x, snappedStart.y);
                await this.delay(100);
                
                if (this.psBridge && this.psBridge.stdin && this.psBridge.stdin.writable) {
                    this.writeToPSBridge(`[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)`);
                    await this.delay(100);
                    
                    const steps = 10;
                    for (let i = 1; i <= steps; i++) {
                        const currentX = Math.round(snappedStart.x + (snappedEnd.x - snappedStart.x) * (i / steps));
                        const currentY = Math.round(snappedStart.y + (snappedEnd.y - snappedStart.y) * (i / steps));
                        this.writeToPSBridge(`[Win32]::SetCursorPos(${currentX}, ${currentY})`);
                        await this.delay(20);
                    }
                    
                    this.writeToPSBridge(`[Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)`);
                    resolve({ success: true, message: `Dragged from (${snappedStart.x}, ${snappedStart.y}) to (${snappedEnd.x}, ${snappedEnd.y})` });
                    return;
                }

                // Fallback
                const downCmd = `${PS_HELPER_SCRIPT}; [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)`;
                await this.execPowerShell(downCmd);
                await this.delay(100);
                
                const steps = 10;
                for (let i = 1; i <= steps; i++) {
                    const currentX = Math.round(snappedStart.x + (snappedEnd.x - snappedStart.x) * (i / steps));
                    const currentY = Math.round(snappedStart.y + (snappedEnd.y - snappedStart.y) * (i / steps));
                    await this.moveMouse(currentX, currentY);
                    await this.delay(20);
                }
                
                const upCmd = `${PS_HELPER_SCRIPT}; [Win32]::mouse_event([Win32]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)`;
                await this.execPowerShell(upCmd);
                
                resolve({ success: true, message: `Dragged from (${snappedStart.x}, ${snappedStart.y}) to (${snappedEnd.x}, ${snappedEnd.y})` });
            } catch (error) {
                resolve({ success: false, error: 'Drag failed' });
            }
        });
    }

    // Helper to execute PowerShell commands
    async execPowerShell(command) {
        if (this.psBridge && this.psBridge.stdin && this.psBridge.stdin.writable) {
            return new Promise((resolve) => {
                this.writeToPSBridge(command);
                resolve('OK');
            });
        }
        return new Promise((resolve, reject) => {
            exec(`powershell -NoProfile -Command "${command.replace(/"/g, '\"').replace(/\n/g, ' ')}"`, (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            });
        });
    }

    // ============================================
    // Keyboard Control
    // ============================================

    async typeText(text, delay = 0) {
        if (!text) {
            return { success: false, error: 'No text provided' };
        }

        // First, ensure the target window has focus
        await this.delay(500);
        
        // Try to focus last opened app before typing
        await this.focusLastOpenedApp();
        await this.delay(300);

        // Use Windows PowerShell SendKeys with one retry after attempting focus
        const result = await this.typeTextPowerShell(text);
        if (result.success === false) {
            const refocused = await this.focusLastOpenedApp();
            if (refocused) {
                await this.delay(500);
                return await this.typeTextPowerShell(text);
            }
        }
        return result;
    }

    async typeTextPowerShell(text) {
        return new Promise((resolve) => {
            // Escape special SendKeys characters
            const escapedText = text
                .replace(/\+/g, '{+}')
                .replace(/\^/g, '{^}')
                .replace(/%/g, '{%}')
                .replace(/~/g, '{~}')
                .replace(/\(/g, '{(}')
                .replace(/\)/g, '{)}')
                .replace(/\[/g, '{[}')
                .replace(/\]/g, '{]}')
                .replace(/\{/g, '{{}')
                .replace(/\}/g, '{}}')
                .replace(/"/g, '""')
                .replace(/\r?\n/g, '{ENTER}')
                .replace(/\t/g, '{TAB}');
            
            // Use SendWait with explicit focus check
            const psCommand = `
                Add-Type -AssemblyName System.Windows.Forms;
                Add-Type -AssemblyName System.Runtime.InteropServices;
                $sig = '[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();';
                $type = Add-Type -MemberDefinition $sig -Name WinAPI -Namespace Win32 -PassThru;
                $hwnd = $type::GetForegroundWindow();
                if ($hwnd -ne [IntPtr]::Zero) {
                    [System.Windows.Forms.SendKeys]::SendWait(\\"${escapedText}\\");
                    Write-Output 'OK';
                } else {
                    throw 'No window focused';
                }
            `.replace(/\n/g, ' ');
            
            exec(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 30000 }, (error, stdout, stderr) => {
                if (error || stderr) {
                    console.error('Typing error:', error?.message || stderr);
                    resolve({ success: false, error: 'Typing failed. Make sure a text field is focused.' });
                } else if (stdout && stdout.includes('OK')) {
                    resolve({ success: true, message: `Typed: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"` });
                } else {
                    resolve({ success: false, error: 'Typing failed. No window focused.' });
                }
            });
        });
    }

    // Type text directly into an application (with focus management)
    async typeIntoApp(appName, text, delay = 0) {
        // First focus the app
        const resolved = resolveAppName(appName);
        const processName = path.basename(resolved, '.exe').toUpperCase();
        
        await this.focusApplicationWindow(appName, processName);
        await this.delay(500); // Wait for focus
        
        // Then type
        return this.typeText(text, delay);
    }

    // Helper delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async pressKey(key) {
        // Ensure window is focused before pressing key
        await this.delay(200);
        await this.focusLastOpenedApp();
        await this.delay(200);
        
        // Use Windows PowerShell SendKeys for all key presses
        return new Promise(async (resolve) => {
            const keyLower = key.toLowerCase();
            
            // Comprehensive key mapping for SendKeys format
            const keyMap = {
                // Special keys
                'enter': '{ENTER}',
                'return': '{ENTER}',
                'tab': '{TAB}',
                'backspace': '{BACKSPACE}',
                'back': '{BACKSPACE}',
                'delete': '{DELETE}',
                'del': '{DELETE}',
                'escape': '{ESC}',
                'esc': '{ESC}',
                'space': ' ',
                'spacebar': ' ',
                
                // Arrow keys
                'up': '{UP}',
                'down': '{DOWN}',
                'left': '{LEFT}',
                'right': '{RIGHT}',
                
                // Navigation
                'home': '{HOME}',
                'end': '{END}',
                'pageup': '{PGUP}',
                'pagedown': '{PGDN}',
                'pgup': '{PGUP}',
                'pgdn': '{PGDN}',
                'insert': '{INSERT}',
                'ins': '{INSERT}',
                
                // Function keys
                'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
                'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
                'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
                
                // Common shortcuts
                'ctrl+s': '^s',
                'ctrl+c': '^c',
                'ctrl+v': '^v',
                'ctrl+x': '^x',
                'ctrl+z': '^z',
                'ctrl+y': '^y',
                'ctrl+a': '^a',
                'ctrl+f': '^f',
                'ctrl+n': '^n',
                'ctrl+o': '^o',
                'ctrl+p': '^p',
                'ctrl+w': '^w',
                'ctrl+shift+s': '^+s',
                'ctrl+shift+n': '^+n',
                'alt+f4': '%{F4}',
                'alt+tab': '%{TAB}',
                'win+d': '^{ESC}d',
                'win+e': '^{ESC}e',
                'win+r': '^{ESC}r'
            };
            
            let sendKey;
            
            // Check if it's a known mapping
            if (keyMap[keyLower]) {
                sendKey = keyMap[keyLower];
            } else if (keyLower.includes('+')) {
                // Parse custom key combination
                sendKey = this.parseKeyCombo(keyLower);
            } else {
                // Single character or unknown key
                sendKey = key.length === 1 ? key : `{${key.toUpperCase()}}`;
            }
            
            // Use improved command with focus check
            const psCommand = `
                Add-Type -AssemblyName System.Windows.Forms;
                Add-Type -AssemblyName System.Runtime.InteropServices;
                $sig = '[DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();';
                $type = Add-Type -MemberDefinition $sig -Name WinAPI2 -Namespace Win32Key -PassThru -ErrorAction SilentlyContinue;
                if (!$type) { $type = [Win32Key.WinAPI2] }
                $hwnd = $type::GetForegroundWindow();
                if ($hwnd -ne [IntPtr]::Zero) {
                    [System.Windows.Forms.SendKeys]::SendWait(\\"${sendKey}\\");
                    Write-Output 'OK';
                } else {
                    throw 'No window focused';
                }
            `.replace(/\n/g, ' ');
            
            exec(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 5000 }, async (error, stdout, stderr) => {
                if (error || stderr || !stdout?.includes('OK')) {
                    console.error('Key press error:', error?.message || stderr);
                    // Retry after attempting focus of last opened app
                    const refocused = await this.focusLastOpenedApp();
                    if (refocused) {
                        await this.delay(300);
                        exec(`powershell -NoProfile -Command "${psCommand}"`, { timeout: 5000 }, (err2, stdout2) => {
                            if (err2 || !stdout2?.includes('OK')) {
                                resolve({ success: false, error: 'Key press failed' });
                            } else {
                                resolve({ success: true, message: `Pressed ${key}` });
                            }
                        });
                        return;
                    }
                    resolve({ success: false, error: 'Key press failed' });
                } else {
                    resolve({ success: true, message: `Pressed ${key}` });
                }
            });
        });
    }

    // Try to bring last opened app to foreground for retries
    async focusLastOpenedApp() {
        if (!this.lastOpenedAppName) return false;
        try {
            const resolved = resolveAppName(this.lastOpenedAppName);
            const processName = path.basename(resolved, '.exe').toUpperCase();
            const focused = await this.focusApplicationWindow(this.lastOpenedAppName, processName);
            return focused;
        } catch (e) {
            return false;
        }
    }

    // Parse key combinations like "ctrl+shift+s" into SendKeys format
    parseKeyCombo(combo) {
        const parts = combo.toLowerCase().split('+');
        let result = '';
        let mainKey = '';
        
        for (const part of parts) {
            const p = part.trim();
            if (p === 'ctrl' || p === 'control') {
                result += '^';
            } else if (p === 'alt') {
                result += '%';
            } else if (p === 'shift') {
                result += '+';
            } else if (p === 'win' || p === 'windows' || p === 'meta') {
                result += '^{ESC}'; // Windows key approximation
            } else {
                mainKey = p;
            }
        }
        
        // Add the main key
        if (mainKey.length === 1) {
            result += mainKey;
        } else {
            result += `{${mainKey.toUpperCase()}}`;
        }
        
        return result;
    }

    async holdKey(key, action = 'down') {
        // SendKeys doesn't support hold, so we simulate with key press
        // For most use cases, just pressing the key is sufficient
        return this.pressKey(key);
    }

    // ============================================
    // System Operations
    // ============================================

    async runCommand(command) {
        return new Promise((resolve) => {
            exec(command, { shell: true, maxBuffer: 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
                if (error) {
                    // Combine any partial stdout with stderr for complete picture
                    const combinedOutput = [stdout, stderr].filter(s => s && s.trim()).join('\n');
                    resolve({ 
                        success: false, 
                        error: error.message,
                        output: combinedOutput || error.message,
                        stderr: stderr 
                    });
                } else {
                    resolve({ 
                        success: true, 
                        output: stdout,
                        stderr: stderr 
                    });
                }
            });
        });
    }

    speak(message, voice = null, speed = 1.0) {
        return new Promise((resolve) => {
            if (!say) {
                // Fallback to Windows SAPI
                const escapedMessage = message.replace(/"/g, '\\"');
                exec(`powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${escapedMessage}')"`, 
                    (error) => {
                        if (error) {
                            resolve({ success: false, error: 'Text-to-speech failed' });
                        } else {
                            resolve({ success: true, message: 'Spoke message' });
                        }
                    }
                );
                return;
            }
            
            say.speak(message, voice, speed, (error) => {
                if (error) {
                    resolve({ success: false, error: error.message });
                } else {
                    resolve({ success: true, message: 'Spoke message' });
                }
            });
        });
    }

    // ============================================
    // Composite Actions (Multi-step automation)
    // ============================================

    // Open app and type text into it
    async openAppAndType(appName, text, waitTime = 3000) {
        const openResult = await this.openApplication(appName);
        if (!openResult.success) return openResult;
        
        await this.delay(waitTime); // Wait for app to fully load
        
        const typeResult = await this.typeText(text);
        return {
            success: typeResult.success,
            message: `Opened ${appName} and typed text`
        };
    }

    async pasteOrTypeText(text) {
        const value = String(text || '');
        if (!value) return { success: false, error: 'No text provided' };

        try {
            const clip = await osTasks.setClipboard(value);
            if (clip && clip.success !== false) {
                await this.delay(80);
                const pasted = await this.fastPressKey('ctrl+v');
                if (pasted && pasted.success !== false) return pasted;
            }
        } catch (e) {
            console.warn('[action-executor] Clipboard paste failed, falling back to SendKeys:', e.message);
        }

        const typed = await screenAgent.typeText(value);
        return typed && typed.success !== false ? typed : this.typeText(value);
    }

    async fastPressKey(key) {
        const fast = await screenAgent.pressKey(key);
        return fast && fast.success !== false ? fast : this.pressKey(key);
    }

    async postBackendJson(endpoint, payload, timeoutMs = 90000) {
        const http = require('http');
        const Store = require('electron-store');
        const store = new Store();
        const backendUrl = this.normalizeBackendUrl(store.get('colabUrl'));
        const body = JSON.stringify(payload || {});

        return new Promise((resolve, reject) => {
            const req = http.request(`${backendUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        if (res.statusCode >= 400) {
                            reject(new Error(parsed.detail || parsed.error || `Backend ${res.statusCode}`));
                        } else {
                            resolve(parsed);
                        }
                    } catch {
                        reject(new Error(data || `Backend ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => {
                req.destroy();
                reject(new Error(`Backend request ${endpoint} timed out after ${timeoutMs}ms`));
            });
            req.write(body);
            req.end();
        });
    }

    async captureScreenshotBase64() {
        const screenshot = require('screenshot-desktop');
        const buffer = await screenshot({ format: 'jpg' });
        return buffer.toString('base64');
    }

    async runLocalOCR(base64Image) {
        try {
            console.log('[action-executor] Running local OCR using tesseract.js...');
            const Tesseract = require('tesseract.js');
            let imageBuffer;
            if (base64Image.startsWith('data:image')) {
                const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, "");
                imageBuffer = Buffer.from(base64Data, 'base64');
            } else {
                imageBuffer = Buffer.from(base64Image, 'base64');
            }
            const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
            console.log('[action-executor] OCR success, extracted text length:', text?.length || 0);
            return text || '';
        } catch (e) {
            console.error('[action-executor] OCR error:', e);
            return '';
        }
    }

    async verifyWhatsAppMessageSent(recipient, body) {
        try {
            const screenshotB64 = await this.captureScreenshotBase64();
            const verify = await this.postBackendJson('/verify', {
                screenshot: screenshotB64,
                task: `Send a WhatsApp message to "${recipient}" with the exact message "${body}"`,
                expected_result: `The WhatsApp chat for "${recipient}" is open and the latest visible outgoing message is exactly "${body}". Return success=false if the screen is still on contact search, no chat is open, the recipient is different, or the message is not visible as sent.`
            }, 120000);

            return {
                success: verify && verify.success === true,
                observation: verify?.observation || '',
                raw: verify
            };
        } catch (e) {
            return {
                success: false,
                observation: `verification_error: ${e.message}`,
                error: e.message
            };
        }
    }

    async sendWhatsAppMessage(contact, message, shouldSend = true) {
        const recipient = String(contact || '').trim();
        const body = String(message || '').trim();
        if (!recipient) return { success: false, error: 'WhatsApp contact is required' };
        if (!body) return { success: false, error: 'WhatsApp message is required' };
        return await whatsappHandler.sendMessage({
            contact: recipient,
            message: body,
            send: shouldSend
        });
    }

    // PowerPoint: Create new slide
    async pptNewSlide() {
        await this.pressKey('ctrl+m');
        await this.delay(500);
        return { success: true, message: 'Created new slide' };
    }

    // PowerPoint: Add title to current slide
    async pptAddTitle(title) {
        // Click on title placeholder (usually top center)
        await this.pressKey('ctrl+shift+enter'); // Select title placeholder
        await this.delay(300);
        await this.typeText(title);
        return { success: true, message: `Added title: ${title}` };
    }

    // PowerPoint: Add content/body text
    async pptAddContent(content) {
        await this.pressKey('tab'); // Move to content area
        await this.delay(200);
        await this.typeText(content);
        return { success: true, message: 'Added content' };
    }

    // Word: Type paragraph
    async wordTypeParagraph(text) {
        await this.typeText(text);
        await this.pressKey('enter');
        await this.pressKey('enter');
        return { success: true, message: 'Typed paragraph' };
    }

    // Word: Insert heading
    async wordInsertHeading(text, level = 1) {
        // Apply heading style
        await this.pressKey(`ctrl+alt+${level}`);
        await this.delay(200);
        await this.typeText(text);
        await this.pressKey('enter');
        return { success: true, message: `Inserted heading level ${level}` };
    }

    // Save current document
    async saveDocument(filename = null) {
        if (filename) {
            // Save As
            await this.pressKey('ctrl+shift+s');
            await this.delay(500);
            await this.typeText(filename);
            await this.delay(200);
            await this.pressKey('enter');
        } else {
            // Quick save
            await this.pressKey('ctrl+s');
        }
        await this.delay(500);
        return { success: true, message: filename ? `Saved as ${filename}` : 'Saved document' };
    }

    // Select all and copy
    async selectAllCopy() {
        await this.pressKey('ctrl+a');
        await this.delay(200);
        await this.pressKey('ctrl+c');
        return { success: true, message: 'Selected all and copied' };
    }

    // Paste
    async paste() {
        await this.pressKey('ctrl+v');
        return { success: true, message: 'Pasted from clipboard' };
    }

    // Undo
    async undo() {
        await this.pressKey('ctrl+z');
        return { success: true, message: 'Undone last action' };
    }

    // Redo
    async redo() {
        await this.pressKey('ctrl+y');
        return { success: true, message: 'Redone action' };
    }

    async getMousePosition() {
        return new Promise((resolve) => {
            const psScript = `${PS_HELPER_SCRIPT}; $point = New-Object POINT; [Win32]::GetCursorPos([ref]$point) | Out-Null; Write-Output "$($point.X),$($point.Y)"`;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"').replace(/\\n/g, ' ')}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to get mouse position' });
                } else {
                    const [x, y] = stdout.trim().split(',').map(Number);
                    resolve({ success: true, x, y });
                }
            });
        });
    }

    async getScreenSize() {
        return new Promise((resolve) => {
            const psScript = `Add-Type -AssemblyName System.Windows.Forms; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output "$($screen.Width),$($screen.Height)"`;
            
            exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to get screen size' });
                } else {
                    const [width, height] = stdout.trim().split(',').map(Number);
                    resolve({ success: true, width, height });
                }
            });
        });
    }
    
    // ============================================
    // Interactive Choice Detection
    // ============================================
    
    async detectInstalledBrowsers() {
        return new Promise((resolve) => {
            const psScript = `
                $browsers = @()
                
                # Check Chrome
                if (Test-Path "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe") {
                    $browsers += "Chrome"
                }
                if (Test-Path "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe") {
                    $browsers += "Chrome"
                }
                
                # Check Edge
                if (Test-Path "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe") {
                    $browsers += "Edge"
                }
                if (Test-Path "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe") {
                    $browsers += "Edge"
                }
                
                # Check Firefox
                if (Test-Path "C:\\Program Files\\Mozilla Firefox\\firefox.exe") {
                    $browsers += "Firefox"
                }
                if (Test-Path "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe") {
                    $browsers += "Firefox"
                }
                
                # Check Brave
                if (Test-Path "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe") {
                    $browsers += "Brave"
                }
                
                $browsers | Select-Object -Unique | ForEach-Object { Write-Output $_ }
            `;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to detect browsers' });
                } else {
                    const browsers = stdout.trim().split('\n').filter(b => b.trim());
                    resolve({ 
                        success: true, 
                        browsers: browsers.length > 0 ? browsers : ['Edge'] // Default to Edge if none found
                    });
                }
            });
        });
    }
    
    async detectChromeProfiles() {
        return new Promise((resolve) => {
            const psScript = `
                $chromeUserData = "$env:LOCALAPPDATA\\Google\\Chrome\\User Data"
                $profiles = @()
                
                if (Test-Path $chromeUserData) {
                    Get-ChildItem -Path $chromeUserData -Directory | Where-Object {
                        $_.Name -match '^(Default|Profile \\d+)$'
                    } | ForEach-Object {
                        $prefsPath = Join-Path $_.FullName "Preferences"
                        if (Test-Path $prefsPath) {
                            $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json
                            $name = if ($prefs.profile.name) { $prefs.profile.name } else { $_.Name }
                            $profiles += "$name"
                        } else {
                            $profiles += $_.Name
                        }
                    }
                }
                
                if ($profiles.Count -eq 0) {
                    $profiles += "Default"
                }
                
                $profiles | ForEach-Object { Write-Output $_ }
            `;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to detect Chrome profiles' });
                } else {
                    const profiles = stdout.trim().split('\n').filter(p => p.trim());
                    resolve({ 
                        success: true, 
                        profiles: profiles.length > 0 ? profiles : ['Default']
                    });
                }
            });
        });
    }
    
    async detectEdgeProfiles() {
        return new Promise((resolve) => {
            const psScript = `
                $edgeUserData = "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data"
                $profiles = @()
                
                if (Test-Path $edgeUserData) {
                    Get-ChildItem -Path $edgeUserData -Directory | Where-Object {
                        $_.Name -match '^(Default|Profile \\d+)$'
                    } | ForEach-Object {
                        $prefsPath = Join-Path $_.FullName "Preferences"
                        if (Test-Path $prefsPath) {
                            $prefs = Get-Content $prefsPath -Raw | ConvertFrom-Json
                            $name = if ($prefs.profile.name) { $prefs.profile.name } else { $_.Name }
                            $profiles += "$name"
                        } else {
                            $profiles += $_.Name
                        }
                    }
                }
                
                if ($profiles.Count -eq 0) {
                    $profiles += "Default"
                }
                
                $profiles | ForEach-Object { Write-Output $_ }
            `;
            
            exec(`powershell -NoProfile -Command "${psScript.replace(/\n/g, ' ')}"`, (error, stdout) => {
                if (error) {
                    resolve({ success: false, error: 'Failed to detect Edge profiles' });
                } else {
                    const profiles = stdout.trim().split('\n').filter(p => p.trim());
                    resolve({ 
                        success: true, 
                        profiles: profiles.length > 0 ? profiles : ['Default']
                    });
                }
            });
        });
    }

    // ============================================
    // Path Resolution — fix USERNAME, ~, Desktop etc.
    // ============================================

    resolveFilePath(p) {
        if (!p || typeof p !== 'string') return p;
        const home = os.homedir();
        const user = path.basename(home);
        // Replace literal USERNAME or YOURUSERNAME with actual user
        p = p.replace(/C:\\Users\\USERNAME/gi, home);
        p = p.replace(/C:\\Users\\YOURUSERNAME/gi, home);
        p = p.replace(/C:\\Users\\User/gi, home);
        p = p.replace(/~\//g, home + '\\');
        p = p.replace(/^~$/g, home);
        // Replace standalone friendly names
        if (/^desktop$/i.test(p)) return path.join(home, 'Desktop');
        if (/^documents$/i.test(p)) return path.join(home, 'Documents');
        if (/^downloads$/i.test(p)) return path.join(home, 'Downloads');
        if (/^pictures$/i.test(p)) return path.join(home, 'Pictures');
        if (/^videos$/i.test(p)) return path.join(home, 'Videos');
        if (/^music$/i.test(p)) return path.join(home, 'Music');
        return p;
    }

    // Resolve all path-like parameters in an action's params object
    resolveAllPaths(params) {
        const pathKeys = [
            'file_path', 'filepath', 'folder_path', 'path', 'save_path',
            'source', 'destination', 'old_path', 'new_location',
            'image_path', 'location', 'search_location',
        ];
        const resolved = { ...params };
        for (const key of pathKeys) {
            if (resolved[key] && typeof resolved[key] === 'string') {
                resolved[key] = this.resolveFilePath(resolved[key]);
            }
        }
        return resolved;
    }

    async checkOfficeInstalled(actionName) {
        if (this._officeInstalledCache !== undefined) {
            return this._officeInstalledCache;
        }

        return new Promise((resolve) => {
            const cmd = `powershell -Command "
                $ok = $false;
                $paths = @('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\excel.exe', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\winword.exe', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\powerpnt.exe');
                foreach ($p in $paths) {
                    if (Test-Path $p) { $ok = $true; break; }
                }
                if (-not $ok) {
                    try {
                        $excel = New-Object -ComObject Excel.Application -ErrorAction SilentlyContinue;
                        if ($excel) { $ok = $true; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null; }
                    } catch {}
                }
                Write-Output $ok
            "`;
            exec(cmd, (error, stdout) => {
                const installed = stdout && stdout.trim().toLowerCase() === 'true';
                this._officeInstalledCache = installed;
                resolve(installed);
            });
        });
    }

    // ============================================
    // Execute Action by Name (WITH SAFETY CHECK)
    // ============================================

    async execute(actionName, params = {}) {
        // Resolve all file paths (fix USERNAME, ~, Desktop etc.)
        params = this.resolveAllPaths(params);

        // Check if Office COM action and verify if Office is installed
        const isOfficeAction = actionName.startsWith('ppt_') || 
                               actionName.startsWith('word_') || 
                               actionName.startsWith('excel_') || 
                               actionName.startsWith('onenote_') || 
                               actionName.startsWith('publisher_');

        if (isOfficeAction) {
            const officeOk = await this.checkOfficeInstalled(actionName);
            if (!officeOk) {
                return {
                    success: false,
                    error: "Microsoft Office (Excel/Word/PowerPoint) is not installed on this system. COM automation actions cannot be executed."
                };
            }
        }

        // 🛡️ SAFETY CHECK FIRST
        const safetyCheck = safetyGuard.validateAction(actionName, params);
        
        if (!safetyCheck.safe) {
            console.warn('Action blocked by safety guard:', safetyCheck.reason);
            return { 
                success: false, 
                error: safetyCheck.reason,
                blocked: true 
            };
        }

        // Log warnings if any
        if (safetyCheck.warnings.length > 0) {
            console.warn('Safety warnings:', safetyCheck.warnings);
        }

        if (safetyCheck.requiresConfirmation && params.confirmed !== true) {
            return {
                success: false,
                error: `Confirmation required before executing: ${actionName}`,
                requiresConfirmation: true
            };
        }

        if (actionName === 'app_engine') {
            console.log(`[action-executor] Routing action to app_engine registry: "${params.app}" - "${params.operation}"`);
            return await appHandlers.executeAppEngine(params.app, params.operation, params);
        }

        if (actionName === 'protocol_execute') {
            const protocolId = params.protocol_id || params.protocolId || params.id;
            const protocolParams = params.parameters || params.params || params;
            return await protocolRegistry.executeProtocol(protocolId, protocolParams, async (stepAction, stepParams) => {
                return await this.execute(stepAction, stepParams || {});
            });
        }

        if (actionName.startsWith('browser_')) {
            const operation = actionName.replace('browser_', '');
            console.log(`[action-executor] Routing action to browser_engine: "${operation}"`);
            return await browserAutomation.executeBrowserEngine(operation, params);
        }

        if (['create_presentation', 'create_ppt', 'create_slides', 'generate_presentation', 'generate_slides'].includes(actionName)) {
            return await this.generatePPT({
                ...params,
                topic: params.topic || params.title || params.subject || 'Presentation',
                title: params.title || params.topic || params.subject || 'Presentation',
            });
        }

        const actions = {
            // File operations
            'create_file': () => this.createFile(params.file_path, params.content || ''),
            'create-file': () => this.createFile(params.file_path, params.content || ''),
            'create_folder': () => this.createFolder(params.folder_path),
            'create-folder': () => this.createFolder(params.folder_path),
            'delete_file': () => this.deleteFile(params.file_path),
            'delete-file': () => this.deleteFile(params.file_path),
            'read_file': () => this.readFile(params.file_path),
            'read-file': () => this.readFile(params.file_path),
            'list_directory': () => this.listDirectory(params.path),
            'list-directory': () => this.listDirectory(params.path),
            'copy_file': () => this.copyFile(params.source, params.destination),
            'copy-file': () => this.copyFile(params.source, params.destination),
            'move_file': () => this.moveFile(params.source, params.destination),
            'move-file': () => this.moveFile(params.source, params.destination),
            'rename_file': () => this.renameFile(params.old_path, params.new_name),
            'rename-file': () => this.renameFile(params.old_path, params.new_name),

            // Find / modify existing file content (any file type)
            'find_in_file': () => this.findInFile(params.file_path, params.search_text),
            'find-in-file': () => this.findInFile(params.file_path, params.search_text),
            'replace_in_file': () => this.replaceInFile(params.file_path, params.search_text, params.replacement_text, params.replace_all !== false),
            'replace-in-file': () => this.replaceInFile(params.file_path, params.search_text, params.replacement_text, params.replace_all !== false),
            'append_to_file': () => this.appendToFile(params.file_path, params.content),
            'append-to-file': () => this.appendToFile(params.file_path, params.content),
            'search_files': () => fileManager.searchFiles(
                params.pattern || params.search_term || params.query || params.name || params.term || '',
                params.location || params.search_location || params.path || null,
                params.max_results || params.maxResults || 50,
                {
                    includeFolders: params.include_folders !== false && params.includeFolders !== false,
                    latest: Boolean(params.latest || params.sort === 'latest' || params.order === 'latest')
                }
            ),
            'search-files': () => fileManager.searchFiles(
                params.pattern || params.search_term || params.query || params.name || params.term || '',
                params.location || params.search_location || params.path || null,
                params.max_results || params.maxResults || 50,
                {
                    includeFolders: params.include_folders !== false && params.includeFolders !== false,
                    latest: Boolean(params.latest || params.sort === 'latest' || params.order === 'latest')
                }
            ),
            'search_file_content': () => fileManager.searchFileContent(params.search_text, params.location, params.file_pattern),
            
            // Application control
            'open_application': () => this.openApplication(params.app_name),
            'open-app': () => this.openApplication(params.app_name),
            'open_app': () => this.openApplication(params.app_name),
            'launch_app': () => this.openApplication(params.app_name),
            'launch_application': () => this.openApplication(params.app_name),
            'close_application': () => this.closeApplication(params.app_name),
            'close-app': () => this.closeApplication(params.app_name),
            'close_app': () => this.closeApplication(params.app_name),
            'open_url': () => this.openUrl(params.url),
            'open-url': () => this.openUrl(params.url),
            'download_file': () => this.downloadFile(params.url, params.filename),
            'download-file': () => this.downloadFile(params.url, params.filename),
            'search_web': () => this.searchWeb(params.query),
            'search-web': () => this.searchWeb(params.query),
            'focus_app': () => this.focusApp(params.app_name),
            'focus_application': () => this.focusApp(params.app_name),
            
            // Mouse control
            'move_mouse': () => this.moveMouse(params.x, params.y),
            'move-mouse': () => this.moveMouse(params.x, params.y),
            'click_at': () => this.click(params.x, params.y, params.click_type, params.double),
            'click': () => this.click(params.x, params.y, params.click_type, params.double),
            'scroll': () => this.scroll(params.direction, params.amount),
            'drag': () => this.drag(params.start_x, params.start_y, params.end_x, params.end_y),

            // Vision Agent — execute a single vision-determined action (coordinates)
            'vision_execute': () => screenAgent.executeVisionAction(params),
            
            // Keyboard control
            'type_text': () => this.typeText(params.text, params.delay),
            'type-text': () => this.typeText(params.text, params.delay),
            'type': () => this.typeText(params.text, params.delay),
            'type_into_app': () => this.typeIntoApp(params.app_name, params.text, params.delay),
            'type-into-app': () => this.typeIntoApp(params.app_name, params.text, params.delay),
            'press_key': () => this.pressKey(params.key),
            'press-key': () => this.pressKey(params.key),
            'press': () => this.pressKey(params.key),
            'hotkey': () => this.pressKey(params.key),
            'hold_key': () => this.holdKey(params.key, params.action),
            
            // Timing control
            'wait': () => this.wait(params.duration || params.ms || params.seconds * 1000 || 1000),
            'delay': () => this.wait(params.duration || params.ms || params.seconds * 1000 || 1000),
            'sleep': () => this.wait(params.duration || params.ms || params.seconds * 1000 || 1000),
            
            // System
            'run_command': () => this.runCommand(params.command),
            'run-command': () => this.runCommand(params.command),
            'speak': () => this.speak(params.message, params.voice, params.speed),
            
            // Composite actions (multi-step)
            'open_app_and_type': () => this.openAppAndType(params.app_name, params.text, params.wait_time),
            'open_and_type': () => this.openAppAndType(params.app_name, params.text, params.wait_time),
            'send_whatsapp_message': () => this.sendWhatsAppMessage(
                params.contact || params.recipient || params.name,
                params.message || params.text || params.body,
                params.send !== false
            ),
            'whatsapp_send_message': () => this.sendWhatsAppMessage(
                params.contact || params.recipient || params.name,
                params.message || params.text || params.body,
                params.send !== false
            ),
            
            // PowerPoint specific
            'ppt_new_slide': () => this.pptNewSlide(),
            'ppt_add_title': () => this.pptAddTitle(params.title || params.text),
            'ppt_add_content': () => this.pptAddContent(params.content || params.text),
            'powerpoint_new_slide': () => this.pptNewSlide(),
            'powerpoint_add_title': () => this.pptAddTitle(params.title || params.text),
            'powerpoint_add_content': () => this.pptAddContent(params.content || params.text),
            'create_presentation': () => this.generatePPT({
                ...params,
                topic: params.topic || params.title || params.subject || 'Presentation',
                title: params.title || params.topic || params.subject || 'Presentation',
            }),
            'create_ppt': () => this.generatePPT(params),
            'create_slides': () => this.generatePPT(params),
            'generate_presentation': () => this.generatePPT(params),
            'generate_slides': () => this.generatePPT(params),
            'generate_ppt': () => this.generatePPT(params),

            // PowerPoint COM automation (themes, animations, layouts)
            'ppt_apply_theme': () => this.ppt_apply_theme(params.theme_name),
            'ppt_add_animation': () => this.ppt_add_animation(params.animation_type, params.apply_to_all),
            'ppt_change_layout': () => this.ppt_change_layout(params.layout_name),

            // PowerPoint COM — find & modify existing slides
            'ppt_find_slide': () => powerPointCOM.findSlideByText(params.search_text),
            'ppt_get_slide_content': () => powerPointCOM.getSlideContent(params.slide_number),
            'ppt_update_slide_text': () => powerPointCOM.updateSlideText(params.slide_number, params.old_text, params.new_text),
            
            // Word COM automation - pass all params as options object
            'word_create_document': async () => {
                try {
                    await wordCOM.initializeSession();
                    await wordCOM.createDocument(params.title, params.content);
                    return { success: true, message: 'Word document created via Word COM' };
                } catch (err) {
                    console.warn('[action-executor] word_create_document COM failed, falling back to python-docx:', err.message);
                    const path = require('path');
                    const os = require('os');
                    const title = params.title || 'Document';
                    const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 60) || 'Document';
                    const filename = path.join(os.homedir(), 'Desktop', `${safeTitle}.docx`);
                    const structure = {
                        title: params.title || 'Document',
                        sections: [{
                            heading: params.title || 'Document',
                            content: [{ type: 'paragraph', text: params.content || '' }]
                        }]
                    };
                    const BACKEND = process.env.PECIFICS_BACKEND_URL || 'http://localhost:8000';
                    const axios = require('axios');
                    try {
                        const fbResp = await axios.post(`${BACKEND}/create_docx_file`, {
                            structure, filename, topic: params.title || 'Document'
                        }, { timeout: 15000 });
                        if (fbResp.data && fbResp.data.success) {
                            const { shell } = require('electron');
                            shell.openPath(fbResp.data.path || filename);
                            return { success: true, message: `Word document created via fallback at ${fbResp.data.path || filename}`, filename };
                        }
                    } catch (fbErr) {
                        console.warn('[word-doc] Backend docx fallback also failed:', fbErr.message);
                    }
                    const fs = require('fs');
                    const txtPath = filename.replace(/\.docx$/i, '.txt');
                    fs.writeFileSync(txtPath, `${title}\n\n${params.content || ''}`, 'utf8');
                    const { shell } = require('electron');
                    shell.openPath(txtPath);
                    return { success: true, message: `Word document saved as text file: ${txtPath}`, filename: txtPath };
                }
            },
            'word_open_document': () => wordCOM.openDocument(params.filepath),
            'word_read_content': () => wordCOM.readDocumentContent(),
            'word_find_replace': () => wordCOM.findAndReplace(params.search_text, params.replacement_text, params.replace_all !== false),
            'word_add_paragraph': () => wordCOM.addParagraph(params.text, params),
            'word_add_heading': () => wordCOM.addHeading(params.text, params.level || 1, params),
            'word_insert_table': () => wordCOM.insertTable(params.rows, params.cols),
            'word_apply_theme': () => wordCOM.applyTheme(params.theme_name),
            'word_save': () => wordCOM.saveDocument(params.filename),
            'word_remove_table_borders': () => wordCOM.removeTableBorders(params.table_number),
            'word_change_font': () => wordCOM.changeFont(params.font_name, params.font_size, params.start_paragraph, params.end_paragraph),
            'word_clear_formatting': () => wordCOM.clearFormatting(params.start_paragraph, params.end_paragraph),
            'word_change_color': () => wordCOM.changeColor(params.color, params.start_paragraph, params.end_paragraph),
            
            // Excel COM automation
            'excel_create_workbook': async () => {
                try {
                    await excelCOM.initializeSession();
                    await excelCOM.createWorkbook();
                    return { success: true, message: 'Excel workbook created' };
                } catch (err) {
                    console.warn('[action-executor] excel_create_workbook failed:', err.message);
                    const fs = require('fs');
                    const path = require('path');
                    const os = require('os');
                    const filename = path.join(os.homedir(), 'Desktop', `Book1.csv`);
                    fs.writeFileSync(filename, '', 'utf8');
                    const { shell } = require('electron');
                    shell.openPath(filename);
                    return { success: true, message: `Excel COM failed. Opened blank CSV at: ${filename}`, filename };
                }
            },
            'excel_open_workbook': () => excelCOM.openWorkbook(params.filepath),
            'excel_write_cell': () => excelCOM.writeCell(params.row, params.col, params.value),
            'excel_write_data': () => excelCOM.writeData(params.data),
            'excel_add_worksheet': () => excelCOM.addWorksheet(params.name),
            'excel_create_chart': () => excelCOM.createChart(params.chart_type),
            'excel_format_cell': () => excelCOM.formatCell(params.row, params.col, params),
            'excel_format_range': () => excelCOM.formatRange(params.start_row, params.start_col, params.end_row, params.end_col, params),
            'excel_autofit_columns': () => excelCOM.autoFitColumns(),
            'excel_save': () => excelCOM.saveWorkbook(params.filename),
            'excel_remove_borders': () => excelCOM.removeBorders(params.start_row, params.start_col, params.end_row, params.end_col),
            'excel_clear_formatting': () => excelCOM.clearFormatting(params.start_row, params.start_col, params.end_row, params.end_col),
            'excel_remove_background': () => excelCOM.removeBackgroundColor(params.start_row, params.start_col, params.end_row, params.end_col),
            'excel_change_font': () => excelCOM.changeFont(params.font_name, params.font_size, params.start_row, params.start_col, params.end_row, params.end_col),

            // ── AI-powered high-level document creation ─────────────────────
            'create_word_document': () => this._createWordDocumentAI(params),
            'create_excel_spreadsheet': () => this._createExcelSpreadsheetAI(params),

            // ── Screen Reading ───────────────────────────────────────────────
            'read_screen': async () => {
                // Auto-capture screenshot if not provided
                let screenshot = params.screenshot || null;
                if (!screenshot) {
                    try {
                        screenshot = await this.captureScreenshotBase64();
                    } catch (e) {
                        console.warn('[read_screen] Screenshot capture failed:', e.message);
                    }
                }
                let ocr_text = null;
                if (screenshot) {
                    ocr_text = await this.runLocalOCR(screenshot);
                }
                const res = await this._callBackend('/read_screen', {
                    screenshot,
                    ocr_text,
                    question: params.question || params.query || 'What is on my screen?',
                });
                return res;
            },

            // ── File Search & Open (backend-powered, broader scope) ──────────
            'find_files': () => this._callBackend('/search_files', {
                query: params.query || params.pattern || params.search_term || '',
                file_type: params.file_type || null,
                location: params.location || null,
                max_results: params.max_results || 10,
            }).then(async (res) => {
                if (res && res.files && res.files.length > 0 && params.open_result !== false) {
                    const { shell } = require('electron');
                    const firstFile = res.files[0];
                    const filePath = firstFile.path || firstFile.Path || firstFile.FullName || '';
                    if (filePath) shell.openPath(filePath);
                    res.opened = filePath;
                    res.success = true;
                } else if (res) {
                    res.success = true;  // No results is still a success (just empty)
                }
                return res || { success: false, error: 'No response from backend', files: [] };
            }),

            // ── Clipboard ────────────────────────────────────────────────────
            'clipboard_action': () => this._handleClipboard(params),

            // ── System Info ──────────────────────────────────────────────────
            'get_system_info': () => this._callBackend('/system_info', {
                metric: params.metric || 'all',
            }),

            // ── Memory Recall ────────────────────────────────────────────────
            'recall_memory': () => this._callBackend('/recall_memory', {
                query: params.query || null,
                action: params.action || 'recall',
                days_back: params.days_back || 7,
            }),

            // ── PDF Operations ───────────────────────────────────────────────
            'pdf_operation': () => this._callBackend('/pdf_operation', {
                operation: params.operation || 'read',
                filepath: params.filepath || params.file_path || null,
                content: params.content || null,
                output_path: params.output_path || null,
                pages: params.pages || 'all',
            }),

            // ── Calendar & Reminders ─────────────────────────────────────────
            'calendar_operation': () => this._callBackend('/calendar_operation', {
                operation: params.operation || 'set_reminder',
                message: params.message || null,
                time: params.time || null,
                date: params.date || null,
                reminder_name: params.reminder_name || null,
            }),

            // OneNote COM automation
            'onenote_open': () => onenoteCOM.openOneNote(),
            'onenote_create_page': () => onenoteCOM.createPage(params.title, params.section),
            'onenote_add_content': () => onenoteCOM.addContent(params.content),
            'onenote_list_notebooks': () => onenoteCOM.listNotebooks(),
            
            // Publisher COM automation
            'publisher_create': () => publisherCOM.createPublication(params.template_type),
            'publisher_add_textbox': () => publisherCOM.addTextBox(params.text, params.left, params.top, params.width, params.height),
            'publisher_add_page': () => publisherCOM.addPage(),
            'publisher_save': () => publisherCOM.savePublication(params.filename),
            
            // Paint automation (cursor-based)
            'paint_open': () => this.openApplication('mspaint.exe'),
            'paint_draw_line': () => this.paintDrawLine(params.start_x, params.start_y, params.end_x, params.end_y),
            'paint_select_tool': () => this.paintSelectTool(params.tool),
            'paint_select_color': () => this.paintSelectColor(params.color),
            
            // Whiteboard automation (cursor-based)
            'whiteboard_open': () => this.openApplication('Microsoft Whiteboard'),
            
            // File system utilities
            'check_file_exists': () => this.checkFileExists(params.filepath),
            'search_files_legacy': () => this.searchFiles(params.search_term, params.file_type, params.search_location),
            'generate_unique_filename': () => this.generateUniqueFilename(params.filepath, params.content_description),
            
            // Word specific (backward compatibility)
            'word_type_paragraph': () => this.wordTypeParagraph(params.text),
            'word_insert_heading': () => this.wordInsertHeading(params.text, params.level),
            
            // Common document actions
            'save': () => this.saveDocument(params.filename),
            'save_document': () => this.saveDocument(params.filename),
            'save_as': () => this.saveDocument(params.filename),
            'select_all': () => this.pressKey('ctrl+a'),
            'copy': () => this.pressKey('ctrl+c'),
            'paste': () => this.paste(),
            'cut': () => this.pressKey('ctrl+x'),
            'undo': () => this.undo(),
            'redo': () => this.redo(),
            'select_all_copy': () => this.selectAllCopy(),
            
            // Advanced File Management
            'search_files_advanced': () => fileManager.searchFiles(params.pattern, params.location, params.max_results),
            'search_file_content': () => fileManager.searchFileContent(params.search_text, params.location, params.file_pattern),
            'delete_files': () => fileManager.deleteFiles(params.file_paths),
            'delete_multiple_files': () => fileManager.deleteFiles(params.file_paths),
            'copy_files': () => fileManager.copyFiles(params.file_paths, params.destination),
            'copy_multiple_files': () => fileManager.copyFiles(params.file_paths, params.destination),
            'move_files': () => fileManager.moveFiles(params.file_paths, params.destination),
            'move_multiple_files': () => fileManager.moveFiles(params.file_paths, params.destination),
            'create_copies': () => fileManager.createCopies(params.source_file, params.new_names, params.destination),
            'get_files_by_type': () => fileManager.getFilesByType(params.file_type, params.location, params.max_results),
            'get_file_info': () => fileManager.getFileInfo(params.file_path),
            'open_file': () => fileManager.openFile(params.file_path || params.path),
            'open_path': () => fileManager.openFile(params.path || params.file_path),
            'open_folder': () => fileManager.openFile(params.path || params.folder_path || params.file_path),
            'show_in_explorer': () => fileManager.showInExplorer(params.file_path || params.path),
            
            // Application Management
            'search_applications': () => fileManager.searchApplications(params.app_name),
            'search_apps': () => fileManager.searchApplications(params.app_name),
            'find_application': () => fileManager.searchApplications(params.app_name),
            'get_running_apps': () => fileManager.getRunningApplications(),
            'get_running_applications': () => fileManager.getRunningApplications(),
            'list_running_apps': () => fileManager.getRunningApplications(),
            'close_app_by_id': () => fileManager.closeApplication(params.identifier),
            'kill_process': () => fileManager.closeApplication(params.identifier),
            'uninstall_application': () => fileManager.uninstallApplication(params.app_name, params.force || false),
            'delete_application': () => fileManager.uninstallApplication(params.app_name, params.force || false),
            'remove_application': () => fileManager.uninstallApplication(params.app_name, params.force || false),
            'move_application': () => fileManager.moveApplication(params.app_name, params.new_location, params.update_registry !== false),
            'relocate_application': () => fileManager.moveApplication(params.app_name, params.new_location, params.update_registry !== false),
            
            // System Management
            'clear_temp_files': () => systemManager.clearTempFiles(params.include_cache !== false),
            'cleanup_temp': () => systemManager.clearTempFiles(params.include_cache !== false),
            'delete_temp_files': () => systemManager.clearTempFiles(params.include_cache !== false),
            'set_wallpaper': () => systemManager.setWallpaper(params.image_path),
            'change_wallpaper': () => systemManager.setWallpaper(params.image_path),
            'update_background': () => systemManager.setWallpaper(params.image_path),
            'toggle_wifi': () => systemManager.toggleWiFi(params.enable),
            'enable_wifi': () => systemManager.toggleWiFi(true),
            'disable_wifi': () => systemManager.toggleWiFi(false),
            'wifi_on': () => systemManager.toggleWiFi(true),
            'wifi_off': () => systemManager.toggleWiFi(false),
            'toggle_bluetooth': () => systemManager.toggleBluetooth(params.enable),
            'enable_bluetooth': () => systemManager.toggleBluetooth(true),
            'disable_bluetooth': () => systemManager.toggleBluetooth(false),
            'bluetooth_on': () => systemManager.toggleBluetooth(true),
            'bluetooth_off': () => systemManager.toggleBluetooth(false),
            'set_brightness': () => systemManager.setBrightness(params.brightness),
            'change_brightness': () => systemManager.setBrightness(params.brightness),
            'adjust_brightness': () => systemManager.setBrightness(params.brightness),
            'get_battery_status': () => systemManager.getBatteryStatus(),
            'check_battery': () => systemManager.getBatteryStatus(),
            'battery_info': () => systemManager.getBatteryStatus(),
            'set_resolution': () => systemManager.setResolution(params.width, params.height),
            'change_resolution': () => systemManager.setResolution(params.width, params.height),
            'screen_resolution': () => systemManager.setResolution(params.width, params.height),
            'get_system_info': () => systemManager.getSystemInfo(),
            'system_info': () => systemManager.getSystemInfo(),
            'computer_info': () => systemManager.getSystemInfo(),
            // Screenshot / vision — these are intercepted in renderer.js; here just acknowledge
            'get_screenshot': () => Promise.resolve({ success: true, message: 'Screenshot captured for analysis' }),
            'describe_screen': () => Promise.resolve({ success: true, message: 'Screen analysis requested' }),
            'analyze_screen': () => Promise.resolve({ success: true, message: 'Screen analysis requested' }),
            'what_is_on_screen': () => Promise.resolve({ success: true, message: 'Screen analysis requested' }),
            'toggle_night_light': () => systemManager.toggleNightLight(params.enable),
            'enable_night_light': () => systemManager.toggleNightLight(true),
            'disable_night_light': () => systemManager.toggleNightLight(false),
            'night_light_on': () => systemManager.toggleNightLight(true),
            'night_light_off': () => systemManager.toggleNightLight(false),
            'empty_recycle_bin': () => systemManager.emptyRecycleBin(),
            'clear_recycle_bin': () => systemManager.emptyRecycleBin(),
            'delete_trash': () => systemManager.emptyRecycleBin(),
            'get_disk_space': () => systemManager.getDiskSpace(),
            'check_disk_space': () => systemManager.getDiskSpace(),
            'disk_usage': () => systemManager.getDiskSpace(),
            'set_volume': () => systemManager.setVolume(params.volume ?? params.level),
            'change_volume': () => systemManager.setVolume(params.volume),
            'adjust_volume': () => systemManager.setVolume(params.volume),
            'lock_computer': () => systemManager.lockComputer(),
            'lock_screen': () => systemManager.lockComputer(),
            'lock_pc': () => systemManager.lockComputer(),
            'sleep_computer': () => systemManager.sleep(),
            'sleep': () => systemManager.sleep(),
            'suspend': () => systemManager.sleep(),
            'get_network_status': () => systemManager.getNetworkStatus(),
            'network_status': () => systemManager.getNetworkStatus(),
            'network_info': () => systemManager.getNetworkStatus(),
            'run_disk_cleanup': () => systemManager.runDiskCleanup(),
            'disk_cleanup': () => systemManager.runDiskCleanup(),
            'cleanup_disk': () => systemManager.runDiskCleanup(),
            'toggle_windows_defender': () => systemManager.toggleWindowsDefender(params.enable),
            'enable_defender': () => systemManager.toggleWindowsDefender(true),
            'disable_defender': () => systemManager.toggleWindowsDefender(false),
            
            // Info
            'get_mouse_position': () => this.getMousePosition(),
            'get_screen_size': () => this.getScreenSize(),
            
            // Interactive choices
            'detect_browsers': () => this.detectInstalledBrowsers(),
            'detect_chrome_profiles': () => this.detectChromeProfiles(),
            'detect_edge_profiles': () => this.detectEdgeProfiles(),

            // ── OS Tasks (os-tasks.js) ──────────────────────────────────────
            // Win+R / run commands
            'run_winr': () => osTasks.runWinR(params.command),
            'open_run_dialog': () => osTasks.runWinR(params.command),
            'open_msconfig': () => osTasks.openMsconfig(),
            'open_services': () => osTasks.openServices(),
            'open_device_manager': () => osTasks.openDeviceManager(),
            'open_disk_management': () => osTasks.openDiskMgmt(),
            'open_regedit': () => osTasks.openRegedit(),
            'open_registry': () => osTasks.openRegedit(),
            'open_event_viewer': () => osTasks.openEventViewer(),
            'open_task_scheduler': () => osTasks.openTaskScheduler(),
            'open_group_policy': () => osTasks.openGroupPolicy(),
            'open_firewall': () => osTasks.openFirewall(),
            'open_network_connections': () => osTasks.openNetworkConns(),
            'open_power_options': () => osTasks.openPowerOptions(),
            'open_programs_features': () => osTasks.openProgramsAndFeatures(),
            'open_user_accounts': () => osTasks.openUserAccounts(),
            'open_display_settings': () => osTasks.openDisplaySettings(),
            'open_windows_update': () => osTasks.openWindowsUpdate(),
            'open_apps_settings': () => osTasks.openAppsSettings(),
            'open_bluetooth_settings': () => osTasks.openBluetooth(),
            'open_task_manager': () => osTasks.openTaskManager(),
            'open_control_panel': () => osTasks.openControlPanel(),
            'open_cmd': () => osTasks.openCmd(),
            'open_powershell': () => osTasks.openPowershell(),
            // Cache clearing
            'clear_cache': () => osTasks.clearCache(params.cache_type || params.type || 'all'),
            'clear_temp': () => osTasks.clearWindowsTemp(),
            'clear_windows_temp': () => osTasks.clearWindowsTemp(),
            'flush_dns': () => osTasks.flushDns(),
            'clear_dns_cache': () => osTasks.flushDns(),
            'clear_arp_cache': () => osTasks.clearArpCache(),
            'clear_icon_cache': () => osTasks.clearIconCache(),
            'clear_font_cache': () => osTasks.clearFontCache(),
            'clear_windows_update_cache': () => osTasks.clearWindowsUpdateCache(),
            'clear_chrome_cache': () => osTasks.clearChromeCache(),
            'clear_edge_cache': () => osTasks.clearEdgeCache(),
            'clear_firefox_cache': () => osTasks.clearFirefoxCache(),
            'clear_browser_cache': () => osTasks.clearBrowserCache(),
            'clear_all_cache': () => osTasks.clearCache('all'),
            // Network
            'reset_network': () => osTasks.resetNetwork(),
            'ping_host': () => osTasks.pingHost(params.host, params.count),
            'check_port': () => osTasks.checkPort(params.host, params.port),
            'get_public_ip': () => osTasks.getPublicIp(),
            'get_wifi_networks': () => osTasks.getWifiNetworks(),
            'connect_wifi': () => osTasks.connectWifi(params.ssid, params.password),
            // Services
            'manage_service': () => osTasks.manageService(params.service_name || params.name, params.action),
            'start_service': () => osTasks.manageService(params.service_name || params.name, 'start'),
            'stop_service': () => osTasks.manageService(params.service_name || params.name, 'stop'),
            'restart_service': () => osTasks.manageService(params.service_name || params.name, 'restart'),
            'list_services': () => osTasks.listServices(params.filter),
            // Processes
            'get_running_processes': () => osTasks.getRunningProcesses(params.sort_by),
            'list_processes': () => osTasks.getRunningProcesses(params.sort_by),
            'kill_process': () => osTasks.killProcess(params.name_or_pid || params.name || params.pid),
            'end_process': () => osTasks.killProcess(params.name_or_pid || params.name || params.pid),
            'get_process_details': () => osTasks.getProcessDetails(params.name),
            // Startup
            'list_startup_programs': () => osTasks.listStartupPrograms(),
            'toggle_startup_program': () => osTasks.toggleStartupProgram(params.name, params.enable !== false),
            'enable_startup_program': () => osTasks.toggleStartupProgram(params.name, true),
            'disable_startup_program': () => osTasks.toggleStartupProgram(params.name, false),
            // Windows Update
            'check_windows_update': () => osTasks.checkWindowsUpdate(),
            'windows_update': () => osTasks.checkWindowsUpdate(),
            'get_update_history': () => osTasks.getWindowsUpdateHistory(),
            // Event logs
            'get_event_logs': () => osTasks.getEventLogs(params.log_type, params.count, params.level),
            'clear_event_log': () => osTasks.clearEventLog(params.log_type || 'Application'),
            // Restore points
            'create_restore_point': () => osTasks.createRestorePoint(params.description || 'AI Created Restore Point'),
            'list_restore_points': () => osTasks.listRestorePoints(),
            // Installed apps
            'get_installed_apps': () => osTasks.getInstalledApps(),
            'list_installed_apps': () => osTasks.getInstalledApps(),
            'uninstall_app': () => osTasks.uninstallApp(params.app_name || params.name),
            // Environment variables
            'get_env_variable': () => osTasks.getEnvVariable(params.name),
            'set_env_variable': () => osTasks.setEnvVariable(params.name, params.value, params.scope),
            'delete_env_variable': () => osTasks.deleteEnvVariable(params.name, params.scope),
            'manage_env_variable': () => osTasks.setEnvVariable(params.name, params.value, params.scope),
            // Registry (user-safe only)
            'read_registry': () => osTasks.readRegistry(params.key_path, params.value_name),
            'write_registry': () => osTasks.writeRegistry(params.key_path, params.value_name, params.value, params.value_type),
            // Disk
            'get_disk_health': () => osTasks.getDiskHealth(),
            'disk_health': () => osTasks.getDiskHealth(),
            'analyze_storage': () => osTasks.analyzeStorageByFolder(params.path),
            'run_disk_cleanup_silent': () => osTasks.runDiskCleanupSilent(),
            // Power management
            'get_power_plan': () => osTasks.getPowerPlan(),
            'set_power_plan': () => osTasks.setPowerPlan(params.plan),
            'hibernate': () => osTasks.hibernate(),
            'hibernate_computer': () => osTasks.hibernate(),
            'restart_computer': () => osTasks.restart(params.delay || 0),
            'reboot': () => osTasks.restart(params.delay || 0),
            'shutdown_computer': () => osTasks.shutdown(params.delay || 0),
            'cancel_shutdown': () => osTasks.cancelShutdown(),
            // Security
            'windows_defender_scan': () => osTasks.quickScan(),
            'quick_scan': () => osTasks.quickScan(),
            'get_defender_status': () => osTasks.getDefenderStatus(),
            'check_firewall': () => osTasks.checkFirewallStatus(),
            // Scheduled tasks
            'list_scheduled_tasks': () => osTasks.listScheduledTasks(),
            'run_scheduled_task': () => osTasks.runScheduledTask(params.task_name || params.name),
            'disable_scheduled_task': () => osTasks.disableScheduledTask(params.task_name || params.name),
            // Display
            'toggle_dark_mode': () => osTasks.toggleDarkMode(params.enable !== false),
            'enable_dark_mode': () => osTasks.toggleDarkMode(true),
            'disable_dark_mode': () => osTasks.toggleDarkMode(false),
            'light_mode': () => osTasks.toggleDarkMode(false),
            'dark_mode': () => osTasks.toggleDarkMode(true),
            'set_taskbar_position': () => osTasks.setTaskbarPosition(params.position),
            'refresh_desktop': () => osTasks.refreshDesktop(),
            // Misc OS
            'get_clipboard': () => osTasks.getClipboard(),
            'set_clipboard': () => osTasks.setClipboard(params.text),
            'clipboard_get': () => osTasks.getClipboard(),
            'clipboard_set': () => osTasks.setClipboard(params.text),
            'show_notification': () => osTasks.showNotification(params.title, params.message || params.body, params.duration),
            'toast_notification': () => osTasks.showNotification(params.title, params.message || params.body, params.duration),
            'open_cmd_admin': () => osTasks.openCommandPromptAsAdmin(),
            'open_powershell_admin': () => osTasks.openPowerShellAsAdmin(),
            'get_system_health': () => osTasks.getFullSystemHealth(),
            'full_system_health': () => osTasks.getFullSystemHealth(),
            'list_fonts': () => osTasks.listInstalledFonts(),
            'get_installed_fonts': () => osTasks.listInstalledFonts(),
            'relaunch_chrome': () => systemManager.forceRelaunchChrome(),
            'restart_chrome': () => systemManager.forceRelaunchChrome(),
            'reopen_chrome': () => systemManager.forceRelaunchChrome(),
            'ensure_chrome_debug': () => systemManager.ensureChromeWithDebugPort(),
            'check_chrome_debug': () => systemManager.isChromeDebugPortOpen().then(open => ({ success: true, debug_port_open: open, port: 9222 })),
            'spotify_play': () => appHandlers.executeAppEngine('spotify', 'play_music', params),
            'play_spotify': () => appHandlers.executeAppEngine('spotify', 'play_music', params),
            'spotify_pause': () => appHandlers.executeAppEngine('spotify', 'pause_playback', params),
            'spotify_next': () => appHandlers.executeAppEngine('spotify', 'next_track', params),

            // ── Browser Automation (browser-automation.js) ──────────────────
            'browser_open': () => browserAutomation.open(params.url, params.browser),
            'open_browser': () => browserAutomation.open(params.url, params.browser),
            'browser_navigate': () => browserAutomation.navigate(params.url),
            'navigate_to': () => browserAutomation.navigate(params.url),
            'navigate_and_login': async () => {
                // Try Playwright/CDP first; if unavailable, fall back to shell.openExternal
                if (params.url) {
                    try {
                        return await browserAutomation.navigateAndLogin(params);
                    } catch (cdpErr) {
                        console.warn('[navigate_and_login] CDP/Playwright failed, using shell.openExternal:', cdpErr.message);
                        const { shell } = require('electron');
                        await shell.openExternal(params.url);
                        return { success: true, message: `Opened ${params.url} in your browser`, method: 'shell' };
                    }
                }
                return { success: false, error: 'No URL provided' };
            },
            'browser_navigate_login': async () => {
                try { return await browserAutomation.navigateAndLogin(params); }
                catch { const { shell } = require('electron'); await shell.openExternal(params.url); return { success: true, method: 'shell' }; }
            },
            'browser_navigate_and_login': async () => {
                try { return await browserAutomation.navigateAndLogin(params); }
                catch { const { shell } = require('electron'); await shell.openExternal(params.url); return { success: true, method: 'shell' }; }
            },
            'browser_click': () => browserAutomation.click(params.selector || params.element),
            'browser_type': () => browserAutomation.type(params.selector || params.element, params.text),
            'browser_fill': () => browserAutomation.type(params.selector || params.element, params.text),
            'browser_get_text': () => browserAutomation.getText(params.selector),
            'browser_get_page_info': () => browserAutomation.getPageInfo(),
            'browser_screenshot': () => browserAutomation.screenshot(),
            'browser_scroll': () => browserAutomation.scroll(params.direction || 'down', params.amount || 300),
            'browser_scroll_up': () => browserAutomation.scroll('up', params.amount || 300),
            'browser_scroll_down': () => browserAutomation.scroll('down', params.amount || 300),
            'browser_wait_for': () => browserAutomation.waitFor(params.selector, params.timeout),
            'browser_wait_ready': () => browserAutomation.waitReady(params.timeout || params.ms || 3000),
            'browser_close': () => browserAutomation.close(),
            'close_browser': () => browserAutomation.close(),
            'browser_login': () => browserAutomation.login(params.url, params.username, params.password, params.user_field, params.pass_field),
            'web_login': () => browserAutomation.login(params.url, params.username, params.password, params.user_field, params.pass_field),
            'browser_smart_login': () => browserAutomation.smartLogin(params.url, params.name, params.email || params.username, params.password, params.is_new_user || false),
            'browser_signup': () => browserAutomation.smartLogin(params.url, params.name, params.email, params.password, true),
            'browser_create_account': () => browserAutomation.smartLogin(params.url, params.name, params.email, params.password, true),
            'click_text': () => browserAutomation.clickByText(params.text || params.label || params.selector || '', { selector: params.selector, exact: params.exact }),
            'browser_click_text': () => browserAutomation.clickByText(params.text || params.label || params.selector || '', { selector: params.selector, exact: params.exact }),
            'fill_field': () => browserAutomation.typeInField(params.selector || params.field || params.label || params.name || '', params.value || params.text || ''),
            'browser_fill_field': () => browserAutomation.typeInField(params.selector || params.field || params.label || params.name || '', params.value || params.text || ''),
            'wait': async () => {
                await new Promise(resolve => setTimeout(resolve, Math.max(0, Number(params.ms || params.seconds * 1000 || 1000))));
                return { success: true, message: 'Waited.' };
            },
            'browser_search_in_page': () => browserAutomation.searchInPage(params.text || params.query),
            'browser_chat': () => browserAutomation.searchInPage(params.text || params.message || params.query),
            'browser_detect_page': () => browserAutomation.detectPageState(),
            'browser_auto_handle_blockers': () => browserAutomation.autoHandleBlockers(),
            'browser_page_screenshot_b64': async () => {
                const data = await browserAutomation.pageScreenshotBase64();
                return data ? { success: true, data } : { success: false, error: 'no page' };
            },
            'browser_search': () => browserAutomation.googleSearch(params.query),
            'google_search': () => browserAutomation.googleSearch(params.query),
            'web_search': () => browserAutomation.googleSearch(params.query),
            'browser_send_gmail': () => browserAutomation.sendGmail(params.to, params.subject, params.body, params.account_email || params.from || ''),
            'send_gmail': () => browserAutomation.sendGmail(params.to, params.subject, params.body, params.account_email || params.from || ''),
            'email_via_gmail': () => browserAutomation.sendGmail(params.to, params.subject, params.body, params.account_email || params.from || ''),
            'gmail_compose': () => browserAutomation.composeGmail(params),
            'compose_gmail': () => browserAutomation.composeGmail(params),
            'save_google_credentials': () => browserAutomation.saveGoogleCredential(params.email || params.username || params.account_email, params.password),
            'save_google_account': () => browserAutomation.saveGoogleCredential(params.email || params.username || params.account_email, params.password),
            // 9.1: Forget/remove saved Google credentials from Windows Credential Manager
            'forget_google_credentials': async () => {
                const { execSync } = require('child_process');
                const targets = ['pecifics_google_email', 'pecifics_google_password', 'pecifics_google_token'];
                let removed = 0;
                for (const t of targets) {
                    try { execSync(`cmdkey /delete:${t}`, { encoding: 'utf8' }); removed++; } catch { /* not stored */ }
                }
                return { success: true, message: `Google credentials removed from Pecifics (${removed} entries cleared).` };
            },
            'remove_google_credentials': async () => {
                const { execSync } = require('child_process');
                const targets = ['pecifics_google_email', 'pecifics_google_password', 'pecifics_google_token'];
                for (const t of targets) { try { execSync(`cmdkey /delete:${t}`, { encoding: 'utf8' }); } catch { } }
                return { success: true, message: 'Google credentials cleared.' };
            },
            'browser_probe_state': () => browserAutomation.probeBrowserState(params),
            'browser_open_gmail': () => browserAutomation.openGmailAccount(params.email || params.account_email || ''),
            'open_gmail': () => browserAutomation.openGmailAccount(params.email || params.account_email || ''),
            'browser_youtube_search': () => browserAutomation.youtubeSearch(params.query),
            'youtube_search': () => browserAutomation.youtubeSearch(params.query),
            'browser_play_video': () => browserAutomation.youtubePlay(params.query || params.video || params.title || params.search || params.prompt),
            'youtube_play': () => browserAutomation.youtubePlay(params.query || params.video || params.title || params.search || params.prompt),
            'play_youtube': () => browserAutomation.youtubePlay(params.query || params.video || params.title || params.search || params.prompt),
            'browser_go_back': () => browserAutomation.goBack(),
            'browser_go_forward': () => browserAutomation.goForward(),
            'browser_reload': () => browserAutomation.reload(),
            'browser_new_tab': () => browserAutomation.newTab(params.url),
            'browser_execute_script': () => browserAutomation.executeScript(params.script || params.js),
            'browser_fill_form': () => browserAutomation.fillForm(params.fields),
            'google_forms_fill': () => browserAutomation.fillGoogleForm(params),
            'google_form_fill': () => browserAutomation.fillGoogleForm(params),
            'fill_google_form': () => browserAutomation.fillGoogleForm(params),
            'google_forms_intelligent_fill': () => browserAutomation.fillGoogleForm({ ...params, auto_answer: true }),
            'intelligent_google_form_fill': () => browserAutomation.fillGoogleForm({ ...params, auto_answer: true }),
            'gamma_create_presentation': () => browserAutomation.gammaCreatePresentation(params.topic, params.instructions || params.prompt, params),
            'gamma_probe': () => browserAutomation.gammaProbeState(params),
            'install_playwright': () => browserAutomation.installPlaywright(),
            'check_browser_ready': () => ({ success: true, ready: browserAutomation.isAvailable(), message: browserAutomation.isAvailable() ? 'Playwright ready' : 'Playwright not installed' })
        };

        const handler = actions[actionName];
        if (handler) {
            return await handler();
        } else {
            return { success: false, error: `Unknown action: ${actionName}` };
        }
    }

    // Focus an application
    async focusApp(appName) {
        const resolved = resolveAppName(appName);
        const processName = path.basename(resolved, '.exe').toUpperCase();
        
        const focused = await this.focusApplicationWindow(appName, processName);
        if (focused) {
            return { success: true, message: `Focused ${appName}` };
        } else {
            return { success: false, error: `Could not focus ${appName}` };
        }
    }

    // Wait/delay action
    async wait(ms) {
        await this.delay(ms);
        return { success: true, message: `Waited ${ms}ms` };
    }

    // ========================================
    // PowerPoint COM Automation Actions
    // ========================================

    /**
     * Apply design theme to PowerPoint presentation using keyboard shortcuts
     */
    async ppt_apply_theme(themeName) {
        try {
            // Use Design tab keyboard shortcut approach
            // Alt+G opens Design tab, then use arrow keys to select theme
            await this.wait(500);
            await this.pressKey('alt+g');  // Open Design tab
            await this.wait(300);
            await this.pressKey('h');  // Themes dropdown
            await this.wait(300);
            
            // Navigate to specific themes (Ion, Facet, etc.)
            const themeIndex = {
                'ion': 2,
                'facet': 3,
                'integral': 4,
                'ion_boardroom': 5,
                'office_theme': 1
            };
            
            const index = themeIndex[themeName.toLowerCase()] || 2;
            for (let i = 0; i < index; i++) {
                await this.pressKey('down');
                await this.wait(100);
            }
            
            await this.pressKey('enter');
            await this.wait(1000);
            
            return { 
                success: true, 
                message: `Applied theme: ${themeName}` 
            };
        } catch (error) {
            console.error('PowerPoint theme error:', error);
            return { 
                success: false, 
                error: `Failed to apply theme: ${error.message}` 
            };
        }
    }

    /**
     * Add animation to PowerPoint slide using keyboard shortcuts
     */
    async ppt_add_animation(animationType, applyToAll = false) {
        try {
            // Go to first slide
            await this.pressKey('home');
            await this.wait(500);
            
            // Select the title text box (click in center of slide)
            await this.pressKey('tab');
            await this.wait(300);
            
            // Open Animations tab with Alt+A
            await this.pressKey('alt+a');
            await this.wait(800);
            
            // Press F to get to Fade animation directly
            await this.pressKey('f');
            await this.wait(300);
            await this.pressKey('f');  // Press F again to select Fade
            await this.wait(500);
            
            return { 
                success: true, 
                message: `Added ${animationType} animation` 
            };
        } catch (error) {
            console.error('PowerPoint animation error:', error);
            return { 
                success: false, 
                error: `Failed to add animation: ${error.message}` 
            };
        }
    }

    /**
     * Change slide layout in PowerPoint
     */
    async ppt_change_layout(layoutName) {
        try {
            // Check if PowerPoint is active
            const isActive = await powerPointCOM.isPowerPointActive();
            if (!isActive) {
                return { 
                    success: false, 
                    error: 'No active PowerPoint presentation found. Please create slides first.' 
                };
            }

            // Change layout
            await powerPointCOM.changeLayout(layoutName);
            return { 
                success: true, 
                message: `Changed layout to: ${layoutName}` 
            };
        } catch (error) {
            console.error('PowerPoint layout error:', error);
            return { 
                success: false, 
                error: `Failed to change layout: ${error.message}` 
            };
        }
    }

    // ========================================
    // Paint Helper Methods (Cursor-Based)
    // ========================================

    /**
     * Draw line in Paint using cursor automation
     */
    async paintDrawLine(startX, startY, endX, endY) {
        try {
            // Draw line by dragging
            await this.drag(startX, startY, endX, endY);
            return { success: true, message: 'Line drawn in Paint' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Select tool in Paint (pencil, brush, line, etc.)
     * This would require vision-guided cursor automation
     */
    async paintSelectTool(toolName) {
        // This is a placeholder - would need cursor coordinates from vision AI
        return { 
            success: true, 
            message: `Paint tool selection: ${toolName} (requires vision guidance)` 
        };
    }

    /**
     * Select color in Paint
     */
    async paintSelectColor(color) {
        // Placeholder - would need vision-guided cursor automation
        return { 
            success: true, 
            message: `Paint color selection: ${color} (requires vision guidance)` 
        };
    }

    // ========================================
    // File System Utilities
    // ========================================

    /**
     * Check if file exists and return result with suggested alternative
     */
    async checkFileExists(filepath) {
        try {
            // Expand environment variables
            const expandedPath = filepath.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
            
            const fs = require('fs').promises;
            try {
                await fs.access(expandedPath);
                // File exists - suggest numbered alternative
                const uniquePath = await this.findUniqueFilename(expandedPath);
                return {
                    success: true,
                    exists: true,
                    original_path: expandedPath,
                    suggested_path: uniquePath,
                    message: `File exists. Suggested alternative: ${path.basename(uniquePath)}`
                };
            } catch {
                // File doesn't exist - safe to use
                return {
                    success: true,
                    exists: false,
                    path: expandedPath,
                    message: 'File does not exist - safe to save'
                };
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate unique filename by adding numbers if file exists
     */
    async generateUniqueFilename(filepath, contentDescription = '') {
        try {
            // If no filepath provided, generate from content description
            if (!filepath || filepath.trim() === '') {
                const timestamp = new Date().toISOString().split('T')[0].replace(/-/g, '_');
                const safeName = contentDescription
                    ? contentDescription.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)
                    : 'Document';
                filepath = `C:\\Users\\${process.env.USERNAME}\\Documents\\${safeName}_${timestamp}.docx`;
            }

            // Expand environment variables
            const expandedPath = filepath.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
            
            // Find unique filename
            const uniquePath = await this.findUniqueFilename(expandedPath);
            
            const wasNumbered = uniquePath !== expandedPath;
            return {
                success: true,
                path: uniquePath,
                original_path: expandedPath,
                was_numbered: wasNumbered,
                message: wasNumbered 
                    ? `Generated unique filename: ${path.basename(uniquePath)} (original name was taken)`
                    : `Filename is unique: ${path.basename(uniquePath)}`
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Helper: Find unique filename by adding _2, _3, etc.
     */
    async findUniqueFilename(filepath) {
        const fs = require('fs').promises;
        const dir = path.dirname(filepath);
        const ext = path.extname(filepath);
        const base = path.basename(filepath, ext);
        
        let counter = 2;
        let testPath = filepath;
        
        while (true) {
            try {
                await fs.access(testPath);
                // File exists, try next number
                testPath = path.join(dir, `${base}_${counter}${ext}`);
                counter++;
            } catch {
                // File doesn't exist - this is our unique name
                return testPath;
            }
        }
    }

    /**
     * Search for files in common locations
     */
    async searchFiles(searchTerm, fileType = '', searchLocation = '') {
        try {
            // Determine search locations
            const locations = searchLocation 
                ? [searchLocation.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '')]
                : [
                    path.join(process.env.USERPROFILE, 'Documents'),
                    path.join(process.env.USERPROFILE, 'Desktop'),
                    path.join(process.env.USERPROFILE, 'Downloads')
                ];

            // Determine file extensions to search
            const extensions = fileType 
                ? this.getFileExtensions(fileType)
                : ['.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.pub'];

            const command = `
                $searchTerm = "${searchTerm}"
                $locations = @(${locations.map(l => `"${l.replace(/\\/g, '\\\\')}"`).join(', ')})
                $extensions = @(${extensions.map(e => `"${e}"`).join(', ')})
                $results = @()
                
                foreach ($location in $locations) {
                    if (Test-Path $location) {
                        foreach ($ext in $extensions) {
                            $files = Get-ChildItem -Path $location -Filter "*$searchTerm*$ext" -File -ErrorAction SilentlyContinue
                            foreach ($file in $files) {
                                $results += [PSCustomObject]@{
                                    Name = $file.Name
                                    Path = $file.FullName
                                    Size = $file.Length
                                    Modified = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                                }
                            }
                        }
                    }
                }
                
                if ($results.Count -gt 0) {
                    $results | ConvertTo-Json -Compress
                } else {
                    Write-Output "NO_RESULTS"
                }
            `;

            return new Promise((resolve, reject) => {
                exec(`powershell -Command "${command.replace(/"/g, '\\"')}"`, { 
                    encoding: 'utf8',
                    maxBuffer: 10 * 1024 * 1024 
                }, (error, stdout, stderr) => {
                    if (error && !stdout.includes('NO_RESULTS')) {
                        return resolve({ 
                            success: false, 
                            error: error.message,
                            results: []
                        });
                    }

                    if (stdout.trim() === 'NO_RESULTS' || stdout.trim() === '') {
                        return resolve({
                            success: true,
                            results: [],
                            message: `No files found matching "${searchTerm}"`
                        });
                    }

                    try {
                        const results = JSON.parse(stdout.trim());
                        const fileList = Array.isArray(results) ? results : [results];
                        resolve({
                            success: true,
                            results: fileList,
                            count: fileList.length,
                            message: `Found ${fileList.length} file(s) matching "${searchTerm}"`
                        });
                    } catch (parseError) {
                        resolve({ 
                            success: false, 
                            error: 'Failed to parse results',
                            results: []
                        });
                    }
                });
            });
        } catch (error) {
            return { success: false, error: error.message, results: [] };
        }
    }

    /**
     * Get file extensions for file type
     */
    getFileExtensions(fileType) {
        const typeMap = {
            'word': ['.docx', '.doc'],
            'excel': ['.xlsx', '.xls'],
            'powerpoint': ['.pptx', '.ppt'],
            'pdf': ['.pdf'],
            'text': ['.txt'],
            'publisher': ['.pub'],
            'all': ['.docx', '.xlsx', '.pptx', '.pdf', '.txt', '.pub']
        };
        return typeMap[fileType.toLowerCase()] || ['.docx', '.xlsx', '.pptx'];
    }

    // ── AI-powered Word document creation ────────────────────────────────────
    async _createWordDocumentAI(params) {
        const axios = require('axios');
        const path = require('path');
        const os = require('os');
        const fs = require('fs');

        const topic = params.topic || params.title || 'document';
        const instructions = params.instructions || params.content || '';
        const style = params.style || 'professional';
        const BACKEND = process.env.PECIFICS_BACKEND_URL || 'http://localhost:8000';

        try {
            // 1. Ask backend to generate document structure via LLM
            const resp = await axios.post(`${BACKEND}/generate_word_document`, {
                topic, title: params.title, instructions, style
            }, { timeout: 60000 });

            const structure = resp.data.structure;
            if (!structure || !structure.sections) {
                return { success: false, error: 'Backend returned empty document structure' };
            }

            const title = structure.title || topic;
            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 60) || 'Document';
            const filename = params.filename || path.join(os.homedir(), 'Desktop', `${safeTitle}.docx`);

            // 2. Try Word COM via timed child process (requires Microsoft Word installed)
            try {
                const tempJsonPath = path.join(os.tmpdir(), `word_struct_${Date.now()}.json`);
                fs.writeFileSync(tempJsonPath, JSON.stringify(structure, null, 2), 'utf8');

                const scriptPath = path.join(__dirname, 'word_create.ps1');
                const spawn = require('child_process').spawn;

                const comResult = await new Promise((resolve, reject) => {
                    const child = spawn('powershell.exe', [
                        '-NoProfile',
                        '-ExecutionPolicy', 'Bypass',
                        '-File', scriptPath,
                        '-JsonPath', tempJsonPath,
                        '-OutputPath', filename
                    ]);

                    let stdout = '';
                    let stderr = '';

                    child.stdout.on('data', data => { stdout += data.toString(); });
                    child.stderr.on('data', data => { stderr += data.toString(); });

                    const timer = setTimeout(() => {
                        child.kill('SIGTERM');
                        try {
                            const { execSync } = require('child_process');
                            execSync(`taskkill /F /PID ${child.pid}`, { stdio: 'ignore' });
                        } catch {}
                        reject(new Error('Word COM timeout after 15s'));
                    }, 15000);

                    child.on('close', code => {
                        clearTimeout(timer);
                        try { fs.unlinkSync(tempJsonPath); } catch {}
                        
                        if (code === 0 && stdout.includes('SUCCESS')) {
                            const { shell } = require('electron');
                            shell.openPath(filename);
                            resolve({ success: true, message: `Word document "${title}" created at ${filename}`, filename });
                        } else {
                            reject(new Error(stderr || stdout || `Process exited with code ${code}`));
                        }
                    });
                });

                return comResult;
            } catch (comErr) {
                console.warn('[word-doc] COM failed, trying backend fallback:', comErr.message);
                // 3. Fallback: ask backend to create .docx using python-docx
                try {
                    const fbResp = await axios.post(`${BACKEND}/create_docx_file`, {
                        structure, filename, topic
                    }, { timeout: 30000 });
                    if (fbResp.data && fbResp.data.success) {
                        const { shell } = require('electron');
                        shell.openPath(fbResp.data.path || filename);
                        return { success: true, message: `Word document "${title}" created at ${fbResp.data.path || filename}`, filename };
                    }
                } catch (fbErr) {
                    console.warn('[word-doc] Backend docx fallback also failed:', fbErr.message);
                }
                // Last resort: save as plain text
                let textContent = `${title}\n${'='.repeat(title.length)}\n\n`;
                for (const section of structure.sections || []) {
                    textContent += `\n${section.heading}\n${'-'.repeat(section.heading.length)}\n`;
                    for (const block of section.content || []) {
                        if (block.type === 'paragraph') textContent += `${block.text}\n\n`;
                        else if (block.type === 'bullet') textContent += block.items.map(i => `• ${i}`).join('\n') + '\n\n';
                        else if (block.type === 'numbered') textContent += block.items.map((i,n) => `${n+1}. ${i}`).join('\n') + '\n\n';
                    }
                }
                const txtPath = filename.replace(/\.docx$/i, '.txt');
                fs.writeFileSync(txtPath, textContent, 'utf8');
                const { shell } = require('electron');
                shell.openPath(txtPath);
                return { success: true, message: `Word not available — saved as text: ${txtPath}. Install Microsoft Word for .docx files.`, filename: txtPath };
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }



    // ── AI-powered Excel spreadsheet creation ────────────────────────────────
    async _createExcelSpreadsheetAI(params) {
        const axios = require('axios');
        const path = require('path');
        const os = require('os');

        const topic = params.topic || params.title || 'spreadsheet';
        const instructions = params.instructions || '';
        const BACKEND = process.env.PECIFICS_BACKEND_URL || 'http://localhost:8000';

        try {
            // 1. Ask backend to generate spreadsheet structure via LLM
            const resp = await axios.post(`${BACKEND}/generate_excel_spreadsheet`, {
                topic, title: params.title, instructions, sheet_name: params.sheet_name
            }, { timeout: 60000 });

            const structure = resp.data.structure;
            if (!structure || !structure.sheets) {
                return { success: false, error: 'Backend returned empty spreadsheet structure' };
            }

            // 2. Create the workbook
            await excelCOM.initializeSession();
            await excelCOM.createWorkbook();

            let firstSheet = true;
            for (const sheet of structure.sheets || []) {
                if (!firstSheet) {
                    await excelCOM.addWorksheet(sheet.name || '');
                } else {
                    // Rename the default sheet
                    const renameCmd = `$global:ExcelWorkbook.ActiveSheet.Name = "${(sheet.name || 'Sheet1').replace(/"/g, '')}"; Write-Output "renamed"`;
                    await excelCOM.executeInSession(renameCmd);
                    firstSheet = false;
                }

                const headers = sheet.headers || [];
                const dataRows = sheet.rows || [];
                const hasTotals = sheet.has_totals && sheet.totals_row;

                // Write headers
                for (let c = 0; c < headers.length; c++) {
                    await excelCOM.writeCell(1, c + 1, headers[c]);
                }

                // Style header row — bold + light blue background
                if (headers.length > 0) {
                    await excelCOM.formatRange(1, 1, 1, headers.length, {
                        bold: true,
                        bg_color: 'lightblue',
                        border: true,
                        font_size: 12,
                    });
                }

                // Write data rows
                for (let r = 0; r < dataRows.length; r++) {
                    const row = dataRows[r];
                    for (let c = 0; c < row.length; c++) {
                        await excelCOM.writeCell(r + 2, c + 1, row[c]);
                    }
                }

                // Write totals row if present
                if (hasTotals) {
                    const totalsRowNum = dataRows.length + 2;
                    const totalsRow = sheet.totals_row || [];
                    // Replace {n} placeholder with last data row number
                    const lastDataRow = dataRows.length + 1;
                    for (let c = 0; c < totalsRow.length; c++) {
                        const val = String(totalsRow[c]).replace(/\{n\}/g, String(lastDataRow));
                        await excelCOM.writeCell(totalsRowNum, c + 1, val);
                    }
                    // Bold the totals row
                    await excelCOM.formatRange(totalsRowNum, 1, totalsRowNum, headers.length, { bold: true, border: true });
                }

                // Auto-fit all columns
                await excelCOM.autoFitColumns();
            }

            // 3. Save workbook
            const title = structure.title || topic;
            const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 60) || 'Spreadsheet';
            const filename = params.filename || path.join(os.homedir(), 'Desktop', `${safeTitle}.xlsx`);
            await excelCOM.saveWorkbook(filename);

            return {
                success: true,
                message: `Excel spreadsheet "${title}" created and saved to ${filename}`,
                filename,
                sheets: structure.sheets.length,
            };
        } catch (e) {
            console.warn('[excel-doc] Excel COM failed, creating CSV fallback:', e.message);
            try {
                const fs = require('fs');
                const title = structure.title || topic;
                const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 60) || 'Spreadsheet';
                const filename = params.filename 
                    ? params.filename.replace(/\.xlsx$/i, '.csv')
                    : path.join(os.homedir(), 'Desktop', `${safeTitle}.csv`);
                
                const firstSheet = (structure.sheets && structure.sheets[0]) ? structure.sheets[0] : {};
                const headers = firstSheet.headers || [];
                const rows = firstSheet.rows || [];
                
                let csvContent = '';
                if (headers.length > 0) {
                    csvContent += headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',') + '\n';
                }
                for (const row of rows) {
                    csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
                }
                
                fs.writeFileSync(filename, csvContent, 'utf8');
                const { shell } = require('electron');
                shell.openPath(filename);
                return {
                    success: true,
                    message: `Excel COM failed. Saved data as CSV at ${filename}`,
                    filename,
                    fallback: 'csv'
                };
            } catch (fallbackErr) {
                return { success: false, error: `Excel COM failed (${e.message}) and CSV fallback failed (${fallbackErr.message})` };
            }
        }
    }



    // ── Generic backend caller ────────────────────────────────────────────────
    async _callBackend(path, body = {}) {
        const axios = require('axios');
        const BACKEND = process.env.PECIFICS_BACKEND_URL || 'http://localhost:8000';
        try {
            const resp = await axios.post(`${BACKEND}${path}`, body, { timeout: 30000 });
            return resp.data;
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    // ── Clipboard (Electron-native first, backend fallback) ───────────────────
    async _handleClipboard(params) {
        const { clipboard } = require('electron');
        const action = params.action || 'read';
        try {
            if (action === 'write' || action === 'copy') {
                const text = params.content || '';
                clipboard.writeText(text);
                return { success: true, message: 'Copied to clipboard', action };
            }
            // Read
            const text = clipboard.readText();
            if (!text) return { success: true, text: '', message: 'Clipboard is empty', action };

            if (action === 'summarize') {
                // Ask backend to summarize
                const res = await this._callBackend('/clipboard', { action: 'summarize', content: text });
                return res;
            }
            return { success: true, text, length: text.length, action: 'read' };
        } catch (e) {
            // Fallback to backend
            return this._callBackend('/clipboard', { action, content: params.content });
        }
    }
}

module.exports = new ActionExecutor();
