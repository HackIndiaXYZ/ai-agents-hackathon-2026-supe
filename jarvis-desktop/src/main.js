const { app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen, nativeImage, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const screenshot = require('screenshot-desktop');
const sharp = require('sharp');
const actionExecutor = require('./modules/action-executor');
const { spawn, execSync, execFileSync } = require('child_process');
const http = require('http');
const fs = require('fs');

// Initialize store for settings
const store = new Store({
    defaults: {
        colabUrl: 'http://localhost:8000',
        cogagentUrl: '',
        screenshotInterval: 1000, // ms
        screenshotQuality: 80,
        autoScreenshot: true,
        alwaysOnTop: true,
        hotkey: 'CommandOrControl+Shift+J',
        credentials: {}, // site hostname -> { username, password }
        firstLaunch: true
    }
});

let mainWindow = null;
let commandBarWindow = null;
let statusHudWindow = null;
let tray = null;
let screenshotInterval = null;
let isCapturing = false;

const PROCESS_TO_READABLE_APP = {
    Code: 'VS Code',
    WINWORD: 'Microsoft Word',
    EXCEL: 'Microsoft Excel',
    POWERPNT: 'PowerPoint',
    chrome: 'Chrome browser',
    msedge: 'Microsoft Edge',
    firefox: 'Firefox',
    spotify: 'Spotify',
    WhatsApp: 'WhatsApp',
    Telegram: 'Telegram',
    notepad: 'Notepad',
    WindowsTerminal: 'Terminal',
    explorer: 'File Explorer'
};

const CHROME_CDP_PORT = Number(process.env.PECIFICS_CHROME_CDP_PORT || 9222);
const CHROME_PROFILE_DIRECTORY = process.env.PECIFICS_CHROME_PROFILE || 'Default';
const CHROME_USER_DATA = process.env.PECIFICS_CHROME_USER_DATA ||
    path.join(app.getPath('home'), 'AppData', 'Local', 'Pecifics', 'ChromeProfile');

const ACTIONS_THAT_NEED_DESKTOP_FOCUS = new Set([
    'vision_execute',
    'send_whatsapp_message',
    'whatsapp_send_message',
    'open_app_and_type',
    'open_and_type',
    'type_text',
    'type-text',
    'type',
    'type_into_app',
    'type-into-app',
    'press_key',
    'press-key',
    'press',
    'hotkey',
    'click_at',
    'click',
    'move_mouse',
    'move-mouse',
    'scroll',
    'drag'
]);

function shouldHidePecificsForAction(action, params = {}) {
    if (params && params.hidePecifics === false) return false;
    if (params && params.hidePecifics === true) return true;
    return ACTIONS_THAT_NEED_DESKTOP_FOCUS.has(String(action || '').toLowerCase());
}

async function hidePecificsWindow() {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    mainWindow.hide();
    await new Promise(resolve => setTimeout(resolve, 120));
    return true;
}

async function showPecificsWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
}

function positionCommandBar() {
    if (!commandBarWindow || commandBarWindow.isDestroyed()) return;
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    commandBarWindow.setPosition(Math.floor(width / 2) - 340, 24);
}

function createCommandBarWindow() {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    commandBarWindow = new BrowserWindow({
        width: 680,
        height: 76,
        x: Math.floor(width / 2) - 340,
        y: 24,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    commandBarWindow.loadFile(path.join(__dirname, 'renderer/command-bar.html'));
    if (commandBarWindow.setBackgroundMaterial) {
        try { commandBarWindow.setBackgroundMaterial('acrylic'); } catch {}
    }
    commandBarWindow.on('blur', () => {
        if (commandBarWindow && commandBarWindow.isVisible()) commandBarWindow.hide();
    });
}

function createStatusHudWindow() {
    const display = screen.getPrimaryDisplay().workAreaSize;
    statusHudWindow = new BrowserWindow({
        width: 240,
        height: 44,
        x: display.width - 260,
        y: 22,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        show: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    statusHudWindow.loadFile(path.join(__dirname, 'renderer/status-hud.html'));
    statusHudWindow.setIgnoreMouseEvents(true, { forward: true });
    if (statusHudWindow.setBackgroundMaterial) {
        try { statusHudWindow.setBackgroundMaterial('acrylic'); } catch {}
    }
}

async function getActiveWindowContext() {
    const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32ActiveWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$hwnd = [Win32ActiveWindow]::GetForegroundWindow()
$pidValue = 0
[void][Win32ActiveWindow]::GetWindowThreadProcessId($hwnd, [ref]$pidValue)
$builder = New-Object System.Text.StringBuilder 512
[void][Win32ActiveWindow]::GetWindowText($hwnd, $builder, $builder.Capacity)
$proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
[pscustomobject]@{
  title = $builder.ToString()
  pid = $pidValue
  process = if ($proc) { $proc.ProcessName } else { "unknown" }
} | ConvertTo-Json -Compress
`;
    try {
        const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
            encoding: 'utf8',
            timeout: 1800,
            windowsHide: true
        }).trim();
        const parsed = JSON.parse(raw || '{}');
        const processName = parsed.process || 'unknown';
        return {
            title: parsed.title || 'unknown',
            pid: parsed.pid || null,
            process: processName,
            activeApp: PROCESS_TO_READABLE_APP[processName] || processName || 'unknown'
        };
    } catch (err) {
        return { title: 'unknown', pid: null, process: 'unknown', activeApp: 'unknown', error: err.message };
    }
}

async function showCommandBar() {
    if (!commandBarWindow || commandBarWindow.isDestroyed()) createCommandBarWindow();
    const context = await getActiveWindowContext();
    positionCommandBar();
    commandBarWindow.show();
    commandBarWindow.focus();
    commandBarWindow.webContents.send('open-with-context', context);
    commandBarWindow.webContents.send('command-bar-focus');
}

function hideCommandBar() {
    if (commandBarWindow && !commandBarWindow.isDestroyed()) commandBarWindow.hide();
}

function updateStatusHud(status = 'ready', text = 'Ready') {
    if (statusHudWindow && !statusHudWindow.isDestroyed()) {
        statusHudWindow.webContents.send('status-hud-update', { status, text });
    }
    if (tray) tray.setToolTip(`Pecifics - ${text}`);
}

// 7.4: Task complete/fail notification
function notifyTaskComplete(taskDescription, success, detail) {
    if (!Notification.isSupported()) return;
    try {
        new Notification({
            title: success ? '✅ Pecifics: Done' : '❌ Pecifics: Failed',
            body: `${taskDescription || 'Task'}${detail ? '\n' + detail : ''}`,
            silent: false,
        }).show();
    } catch (e) {
        console.warn('[notify] Notification error:', e.message);
    }
}

function findChromeExecutable() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(app.getPath('home'), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function waitForChromeDebug(timeoutMs = 700) {
    return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
            const req = http.get(`http://127.0.0.1:${CHROME_CDP_PORT}/json/version`, (res) => {
                res.resume();
                resolve(res.statusCode >= 200 && res.statusCode < 300);
            });
            req.on('error', () => {
                if (Date.now() - started >= timeoutMs) resolve(false);
                else setTimeout(check, 250);
            });
            req.setTimeout(500, () => {
                req.destroy();
                if (Date.now() - started >= timeoutMs) resolve(false);
                else setTimeout(check, 250);
            });
        };
        check();
    });
}

async function ensureChromeDebugLaunched() {
    if (await waitForChromeDebug(700)) {
        console.log(`[chrome-cdp] Chrome debug port ${CHROME_CDP_PORT} is already available`);
        return { success: true, alreadyRunning: true };
    }

    const chromeExe = findChromeExecutable();
    if (!chromeExe) {
        console.warn('[chrome-cdp] Google Chrome was not found; browser automation will report a clear error if used.');
        return { success: false, error: 'Chrome not found' };
    }
    try {
        fs.mkdirSync(CHROME_USER_DATA, { recursive: true });
    } catch {}

    try {
        execSync('taskkill /F /IM chrome.exe /T', {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 10000,
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
    } catch {
        // Chrome was already closed.
    }

    const args = [
        `--remote-debugging-port=${CHROME_CDP_PORT}`,
        `--user-data-dir=${CHROME_USER_DATA}`,
        `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
        '--no-startup-window',
        '--no-first-run',
        '--no-default-browser-check',
    ];
    const child = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
    });
    child.unref();

    if (await waitForChromeDebug(6000)) {
        console.log(`[chrome-cdp] Launched user Chrome profile "${CHROME_PROFILE_DIRECTORY}" on port ${CHROME_CDP_PORT}`);
        return { success: true, launched: true };
    }

    console.warn(`[chrome-cdp] Chrome did not expose debug port ${CHROME_CDP_PORT}. Close all Chrome windows and restart Pecifics once.`);
    return { success: false, error: 'Chrome debug port unavailable' };
}

function showCredentialDialog(options = {}) {
    return new Promise((resolve) => {
        const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const dialogWindow = new BrowserWindow({
            width: 420,
            height: 320,
            parent,
            modal: !!parent,
            frame: true,
            title: options.title || 'Save Google Account',
            resizable: false,
            minimizable: false,
            maximizable: false,
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            }
        });

        let settled = false;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            ipcMain.removeListener('credential-dialog-submit', onSubmit);
            ipcMain.removeListener('credential-dialog-cancel', onCancel);
            if (!dialogWindow.isDestroyed()) dialogWindow.close();
            resolve(result);
        };
        const onSubmit = (event, payload = {}) => {
            if (event.sender !== dialogWindow.webContents) return;
            const email = String(payload.email || '').trim();
            const password = String(payload.password || '');
            if (!email || !password) {
                dialogWindow.webContents.send('credential-dialog-error', 'Email and password are required.');
                return;
            }
            finish({ success: true, email, password });
        };
        const onCancel = (event) => {
            if (event.sender !== dialogWindow.webContents) return;
            finish({ success: false, cancelled: true, error: 'Credential entry cancelled.' });
        };

        ipcMain.on('credential-dialog-submit', onSubmit);
        ipcMain.on('credential-dialog-cancel', onCancel);
        dialogWindow.once('ready-to-show', () => dialogWindow.show());
        dialogWindow.on('closed', () => finish({ success: false, cancelled: true, error: 'Credential entry cancelled.' }));
        dialogWindow.loadFile(path.join(__dirname, 'renderer/credential-dialog.html'));
    });
}

// Create main window
function createWindow() {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    
    mainWindow = new BrowserWindow({
        width: 450,
        height: 700,
        x: width - 470,
        y: height - 720,
        frame: false,
        transparent: false,
        backgroundColor: '#001a33',
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, '../assets/icon.png')
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer/index.html'));
    
    // Hide on close, don't quit
    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    // DevTools in dev mode
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
}

// Create system tray
function createTray() {
    const iconPath = path.join(__dirname, '../assets/icon.png');
    
    // Create a simple icon if file doesn't exist
    let trayIcon;
    try {
        trayIcon = nativeImage.createFromPath(iconPath);
        if (trayIcon.isEmpty()) {
            trayIcon = nativeImage.createEmpty();
        }
    } catch {
        trayIcon = nativeImage.createEmpty();
    }
    
    tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
    
    const contextMenu = Menu.buildFromTemplate([
        { 
            label: 'Show Pecifics', 
            click: () => {
                mainWindow.show();
                mainWindow.focus();
            }
        },
        {
            label: 'Command Bar',
            click: () => showCommandBar()
        },
        { 
            label: 'Settings', 
            click: () => {
                mainWindow.show();
                mainWindow.webContents.send('show-settings');
            }
        },
        { type: 'separator' },
        { 
            label: 'Toggle Screenshot Capture',
            type: 'checkbox',
            checked: store.get('autoScreenshot'),
            click: (menuItem) => {
                store.set('autoScreenshot', menuItem.checked);
                if (menuItem.checked) {
                    startScreenshotCapture();
                } else {
                    stopScreenshotCapture();
                }
            }
        },
        { type: 'separator' },
        { 
            label: 'Quit Pecifics', 
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);
    
    tray.setToolTip('Pecifics - AI Desktop Assistant');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// Take screenshot and return as base64
async function takeScreenshot() {
    try {
        isCapturing = true;
        
        // Capture screenshot — try PNG first, fall back to JPG
        let imgBuffer;
        try {
            imgBuffer = await screenshot({ format: 'png' });
        } catch {
            imgBuffer = await screenshot({ format: 'jpg' });
        }
        
        if (!imgBuffer || imgBuffer.length < 100) {
            isCapturing = false;
            return null;
        }
        
        // Get screen dimensions
        const { width, height } = screen.getPrimaryDisplay().size;
        const quality = store.get('screenshotQuality');

        // Use sharp with failOn:'none' — tolerates slightly corrupt input
        let resizedBuffer;
        try {
            resizedBuffer = await sharp(imgBuffer, { failOn: 'none' })
                .resize(Math.floor(width / 2), Math.floor(height / 2))
                .jpeg({ quality })
                .toBuffer();
        } catch {
            // If PNG decoding fails, try re-capturing as JPEG directly
            try {
                imgBuffer = await screenshot({ format: 'jpg' });
                resizedBuffer = await sharp(imgBuffer, { failOn: 'none' })
                    .resize(Math.floor(width / 2), Math.floor(height / 2))
                    .jpeg({ quality })
                    .toBuffer();
            } catch (e2) {
                isCapturing = false;
                if (!takeScreenshot._lastErr || Date.now() - takeScreenshot._lastErr > 60000) {
                    console.error('Screenshot error:', e2.message);
                    takeScreenshot._lastErr = Date.now();
                }
                return null;
            }
        }
        
        isCapturing = false;
        return {
            screenshot: resizedBuffer.toString('base64'),
            width,
            height,
            timestamp: Date.now()
        };
    } catch (error) {
        isCapturing = false;
        if (!takeScreenshot._lastErr || Date.now() - takeScreenshot._lastErr > 60000) {
            console.error('Screenshot error:', error.message);
            takeScreenshot._lastErr = Date.now();
        }
        return null;
    }
}

// Start continuous screenshot capture
function startScreenshotCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
    }
    
    const interval = store.get('screenshotInterval');
    
    screenshotInterval = setInterval(async () => {
        if (!isCapturing && mainWindow && !mainWindow.isDestroyed()) {
            const screenshotData = await takeScreenshot();
            if (screenshotData) {
                mainWindow.webContents.send('screenshot-captured', screenshotData);
            }
        }
    }, interval);
    
    console.log(`Screenshot capture started (interval: ${interval}ms)`);
}

// Stop screenshot capture
function stopScreenshotCapture() {
    if (screenshotInterval) {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
    }
    console.log('Screenshot capture stopped');
}

// Register global hotkey
function registerHotkey() {
    const hotkey = store.get('hotkey');
    
    globalShortcut.unregisterAll();
    
    const success = globalShortcut.register(hotkey, async () => {
        await showCommandBar();
    });
    
    if (success) {
        console.log(`Hotkey registered: ${hotkey}`);
    } else {
        console.error(`Failed to register hotkey: ${hotkey}`);
    }

    const escapeSuccess = globalShortcut.register('Escape', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('cancel-current-task');
        }
    });
    if (!escapeSuccess) {
        console.warn('Escape cancellation shortcut could not be registered.');
    }
}

// App ready
app.whenReady().then(async () => {
    await ensureChromeDebugLaunched().catch(err => {
        console.warn('[chrome-cdp] Startup check failed:', err.message);
    });
    createWindow();
    createCommandBarWindow();
    createStatusHudWindow();
    createTray();
    registerHotkey();
    
    if (store.get('autoScreenshot')) {
        startScreenshotCapture();
    }
    
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Quit when all windows closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Cleanup on quit
app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopScreenshotCapture();
});

// ============== IPC HANDLERS ==============

// Get settings
ipcMain.handle('get-settings', () => {
    return {
        colabUrl: store.get('colabUrl'),
        cogagentUrl: store.get('cogagentUrl'),
        screenshotInterval: store.get('screenshotInterval'),
        screenshotQuality: store.get('screenshotQuality'),
        autoScreenshot: store.get('autoScreenshot'),
        alwaysOnTop: store.get('alwaysOnTop'),
        hotkey: store.get('hotkey'),
        firstLaunch: store.get('firstLaunch')
    };
});

// Credentials Vault Handlers
ipcMain.handle('get-credentials', () => {
    return store.get('credentials') || {};
});

ipcMain.handle('save-credential', (event, { site, username, password }) => {
    const credentials = store.get('credentials') || {};
    credentials[site] = { username, password };
    store.set('credentials', credentials);
    return { success: true };
});

ipcMain.handle('delete-credential', (event, { site }) => {
    const credentials = store.get('credentials') || {};
    delete credentials[site];
    store.set('credentials', credentials);
    return { success: true };
});

// Save settings
ipcMain.handle('save-settings', (event, settings) => {
    if (settings.colabUrl !== undefined) store.set('colabUrl', settings.colabUrl);
    if (settings.screenshotInterval !== undefined) store.set('screenshotInterval', settings.screenshotInterval);
    if (settings.screenshotQuality !== undefined) store.set('screenshotQuality', settings.screenshotQuality);
    const autoScreenshot = settings.autoScreenshot !== undefined ? settings.autoScreenshot : settings.autoCapture;
    if (autoScreenshot !== undefined) {
        store.set('autoScreenshot', autoScreenshot);
        if (autoScreenshot) {
            startScreenshotCapture();
        } else {
            stopScreenshotCapture();
        }
    }
    if (settings.cogagentUrl !== undefined) store.set('cogagentUrl', normalizeCogAgentUrl(settings.cogagentUrl));
    if (settings.alwaysOnTop !== undefined) {
        store.set('alwaysOnTop', settings.alwaysOnTop);
        if (mainWindow) mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    }
    if (settings.hotkey !== undefined) {
        store.set('hotkey', settings.hotkey);
        registerHotkey();
    }
    if (settings.firstLaunch !== undefined) {
        store.set('firstLaunch', settings.firstLaunch);
    }
    return true;
});

// Take single screenshot
ipcMain.handle('take-screenshot', async () => {
    return await takeScreenshot();
});

// Take HIGH-RES screenshot for vision agent (no downscaling — Gemini needs accuracy)
ipcMain.handle('take-screenshot-hires', async (event, opts = {}) => {
    try {
        const { exec: execCb } = require('child_process');
        const wasVisible = mainWindow && mainWindow.isVisible();
        if (wasVisible) mainWindow.hide();

        if (opts && opts.minimizeAll) {
            // First step: minimize everything so CogAgent sees clean desktop
            await new Promise(resolve => {
                execCb(
                    'powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject Shell.Application).MinimizeAll()"',
                    { timeout: 3000 },
                    () => resolve()
                );
            });
            await new Promise(r => setTimeout(r, 700)); // wait for animations
        } else {
            await new Promise(r => setTimeout(r, 350)); // just wait for Jarvis to hide
        }

        let imgBuffer;
        try { imgBuffer = await screenshot({ format: 'png' }); }
        catch { imgBuffer = await screenshot({ format: 'jpg' }); }

        // Restore Jarvis window
        if (wasVisible) {
            await new Promise(r => setTimeout(r, 150));
            mainWindow.show();
        }

        if (!imgBuffer || imgBuffer.length < 100) return null;

        const display = screen.getPrimaryDisplay();
        const { width, height } = display.size;
        const scale = display.scaleFactor || 1;

        // Resize to FULL logical resolution (not half) — much better for coordinate accuracy
        // Physical capture may be width*scale, so we resize to exactly width×height logical pixels
        let image = sharp(imgBuffer, { failOn: 'none' }).resize(width, height);
        let outputWidth = width;
        let outputHeight = height;
        let region = null;

        if (opts && opts.region && Number.isFinite(Number(opts.region.width)) && Number.isFinite(Number(opts.region.height))) {
            const raw = opts.region;
            const left = Math.max(0, Math.min(width - 1, Math.round(Number(raw.x || raw.left || 0))));
            const top = Math.max(0, Math.min(height - 1, Math.round(Number(raw.y || raw.top || 0))));
            const cropWidth = Math.max(1, Math.min(width - left, Math.round(Number(raw.width))));
            const cropHeight = Math.max(1, Math.min(height - top, Math.round(Number(raw.height))));
            region = { x: left, y: top, width: cropWidth, height: cropHeight };
            image = image.extract({ left, top, width: cropWidth, height: cropHeight });
            outputWidth = cropWidth;
            outputHeight = cropHeight;
        }

        const resized = await image
            .jpeg({ quality: 85 })
            .toBuffer();

        return {
            screenshot: resized.toString('base64'),
            width: outputWidth,
            height: outputHeight,
            screenWidth: width,
            screenHeight: height,
            region,
            physicalWidth: Math.round(width * scale),   // physical capture resolution
            physicalHeight: Math.round(height * scale),
            scaleFactor: scale,
            timestamp: Date.now()
        };
    } catch (e) {
        console.error('HiRes screenshot error:', e.message);
        return null;
    }
});

// Get screen info
ipcMain.handle('get-screen-info', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return {
        width: primaryDisplay.size.width,
        height: primaryDisplay.size.height,
        scaleFactor: primaryDisplay.scaleFactor
    };
});

ipcMain.handle('get-user-home', () => {
    return require('os').homedir();
});

// Window controls
ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.handle('hide-window', async () => {
    await hidePecificsWindow();
    return true;
});

ipcMain.handle('show-window', async () => {
    await showPecificsWindow();
    return true;
});

ipcMain.handle('show-command-bar', async () => {
    await showCommandBar();
    return true;
});

ipcMain.handle('hide-command-bar', async () => {
    hideCommandBar();
    return true;
});

ipcMain.handle('command-bar-submit', async (event, payload) => {
    const command = String(typeof payload === 'string' ? payload : payload?.command || '').trim();
    const context = (payload && typeof payload === 'object') ? (payload.context || null) : null;
    if (!command) return { success: false, error: 'empty command' };
    hideCommandBar();
    updateStatusHud('thinking', 'Thinking');
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('external-command', { command, context });
    }
    return { success: true };
});

ipcMain.handle('update-status-hud', async (event, payload = {}) => {
    updateStatusHud(payload.status || 'ready', payload.text || 'Ready');
    return true;
});

ipcMain.on('close-window', () => {
    mainWindow.hide();
});

ipcMain.on('toggle-always-on-top', (event, value) => {
    mainWindow.setAlwaysOnTop(value);
});

// Start/stop screenshot capture
ipcMain.on('start-capture', () => {
    startScreenshotCapture();
});

ipcMain.on('stop-capture', () => {
    stopScreenshotCapture();
});

// Action execution
ipcMain.handle('execute-action', async (event, { action, params }) => {
    let finalParams = params || {};
    if (['save_google_credentials', 'save_google_account'].includes(String(action || '').toLowerCase())) {
        const hasUsername = finalParams.email || finalParams.username || finalParams.account_email;
        if (!hasUsername || !finalParams.password) {
            const credential = await showCredentialDialog({ title: 'Save Google Account' });
            if (!credential.success) {
                return { success: false, error_class: 'credential_entry_cancelled', error: credential.error || 'Credential entry cancelled.' };
            }
            finalParams = {
                ...finalParams,
                email: credential.email,
                password: credential.password
            };
        }
    }
    const shouldHide = shouldHidePecificsForAction(action, params);
    const wasHidden = shouldHide ? await hidePecificsWindow() : false;
    try {
        const result = await actionExecutor.execute(action, finalParams);
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    } finally {
        if (wasHidden && !(finalParams && finalParams.keepPecificsHidden === true)) {
            await showPecificsWindow();
        }
    }
});

// Stop execution
ipcMain.handle('stop-execution', async () => {
    try {
        const result = actionExecutor.stopExecution();
        return result;
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Reset stop flag
ipcMain.handle('reset-stop-flag', async () => {
    try {
        actionExecutor.resetStopFlag();
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

// Check stop flag
ipcMain.handle('check-stop-flag', async () => {
    try {
        return actionExecutor.isStopped();
    } catch (error) {
        return false;
    }
});

// 7.4: Task completion notification
ipcMain.handle('notify-task-result', (event, data) => {
    notifyTaskComplete(data?.task, data?.success, data?.detail);
    return true;
});

// ============== COGAGENT DIRECT CONNECTION ==============
// Bypasses the langchain backend for vision tasks — calls CogAgent Kaggle directly
// from the main process (avoids CORS issues, custom timeout for ~31s inference)

const axios = require('axios');
const COGAGENT_VISION_TIMEOUT_MS = 600000;

function normalizeCogAgentUrl(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/https?:\/\/[^\s"']+/i);
    return (match ? match[0] : raw).replace(/\/+$/, '');
}

function parseCogAgentHealthResponse(resp, path) {
    const status = Number(resp && resp.status);
    if (status < 200 || status >= 300) {
        return { ok: false, error: `HTTP ${status}` };
    }

    const data = resp.data;
    const contentType = String(resp.headers && resp.headers['content-type'] || '').toLowerCase();

    if (data && typeof data === 'object' && !Array.isArray(data)) {
        const keys = Object.keys(data).map(k => k.toLowerCase());
        const statusText = String(data.status || data.state || '').toLowerCase();
        if (statusText && /error|fail|offline|unreachable/.test(statusText)) {
            return { ok: false, error: data.error || data.detail || data.status };
        }

        const hasHealthShape = keys.some(k => (
            k === 'status' || k === 'model' || k === 'version' || k === 'device' ||
            k === 'vision' || k === 'endpoints' || k === 'service'
        ));
        if (hasHealthShape) {
            return { ok: true, data, status };
        }

        return { ok: false, error: 'Health endpoint returned JSON, but not CogAgent health data' };
    }

    const text = typeof data === 'string' ? data : JSON.stringify(data || '');
    const looksLikeCogAgent = /\b(cogagent|vision_act|describe|vision server)\b/i.test(text);
    const looksLikeHtml = contentType.includes('text/html') || /^\s*</.test(text);
    if (path === '/' && looksLikeCogAgent && !/ngrok|not found|error/i.test(text)) {
        return { ok: true, data: { status: 'ok', service: 'CogAgent', note: 'validated from root endpoint' }, status };
    }

    return {
        ok: false,
        error: looksLikeHtml ? 'Response was HTML, not CogAgent health JSON' : 'Response did not look like CogAgent health data'
    };
}

// Check CogAgent health. Require a real 2xx CogAgent-like response; ngrok/404 pages are not connected.
ipcMain.handle('cogagent-health', async (event, urlOverride) => {
    const url = normalizeCogAgentUrl(urlOverride || store.get('cogagentUrl'));
    if (!url) return { ok: false, error: 'No CogAgent URL configured' };
    const base = url.replace(/\/+$/, '');
    let lastError = 'CogAgent unreachable';

    for (const path of ['/health', '/']) {
        try {
            const resp = await axios.get(`${base}${path}`, {
                timeout: 8000,
                validateStatus: () => true,
                headers: { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'PecificsLAM/1.0' },
            });
            const parsed = parseCogAgentHealthResponse(resp, path);
            if (parsed.ok) return { ...parsed, endpoint: `${base}${path}` };
            lastError = `${path}: ${parsed.error}`;
        } catch (error) {
            lastError = `${path}: ${error.message}`;
        }
    }

    return { ok: false, error: lastError };
});

// Direct vision action — POST screenshot+goal to CogAgent and return the action
ipcMain.handle('cogagent-vision-act', async (event, payload) => {
    const url = normalizeCogAgentUrl((payload && payload.cogagent_url) || store.get('cogagentUrl'));
    if (!url) return { action: 'fail', description: 'No CogAgent URL configured. Set it in Settings.' };
    try {
        const resp = await axios.post(`${url.replace(/\/+$/, '')}/vision_act`, {
            screenshot:    payload.screenshot,
            goal:          payload.goal,
            step_history:  payload.step_history || [],
            screen_width:  payload.screen_width || 1920,
            screen_height: payload.screen_height || 1080,
        }, {
            timeout: COGAGENT_VISION_TIMEOUT_MS,       // Kaggle can queue + infer for several minutes
            maxContentLength: 50 * 1024 * 1024,       // 50 MB (screenshots are large)
            maxBodyLength:    50 * 1024 * 1024,
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'PecificsLAM/1.0' },
        });
        const result = resp.data;
        result.action      = result.action      || 'fail';
        result.description = result.description || '';
        return result;
    } catch (error) {
        const msg = error.response
            ? `CogAgent HTTP ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 200)}`
            : `CogAgent unreachable: ${error.message}`;
        console.error('[cogagent-vision-act]', msg);
        return { action: 'fail', description: msg, timed_out: error.code === 'ECONNABORTED' };
    }
});
