// ============================================================
// Pecifics Screen Agent — Vision-Based Desktop Control
// ============================================================

const { exec, execFile } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

let nutjsAvailable = false;
let nutMouse = null;
let nutKeyboard = null;
let nutKey = null;
let nutButton = null;

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

// Call at module load
initNutJs().catch(() => {});

// ─── NUT-JS KEY MAP ───────────────────────────────────────────────
const NUT_KEY_MAP = {
    'enter': 'Return', 'return': 'Return', 'tab': 'Tab', 'escape': 'Escape',
    'esc': 'Escape', 'backspace': 'Backspace', 'delete': 'Delete', 'del': 'Delete',
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'arrowup': 'Up', 'arrowdown': 'Down', 'arrowleft': 'Left', 'arrowright': 'Right',
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
    'ctrl+enter': ['LeftControl', 'Return'], 'ctrl+return': ['LeftControl', 'Return'],
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
    if (text.length > 5) {
        const { clipboard } = require('electron');
        const previousText = clipboard.readText();
        clipboard.writeText(text);
        await delay(50);
        await nutKeyboard.pressKey(nutKey.LeftControl, nutKey.V);
        await nutKeyboard.releaseKey(nutKey.LeftControl, nutKey.V);
        setTimeout(() => {
            try { clipboard.writeText(previousText); } catch {}
        }, 500);
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
    let k = nutKey[singleKey];
    if (k === undefined || k === null) k = nutKey[keyCombo];
    if (k !== undefined && k !== null) {
        await nutKeyboard.pressKey(k);
        await nutKeyboard.releaseKey(k);
        return;
    }
    throw new Error(`Unknown key for nut-js: ${keyCombo}`);
}

// ─── POWERSHELL FALLBACK ──────────────────────────────────────────

function execPowerShellInline(script) {
    return new Promise((resolve, reject) => {
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
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait('^v')
    `);
}

async function pressKey_ps(keyCombo) {
    const PS_KEY_MAP = {
        'enter': '{ENTER}', 'return': '{ENTER}', 'tab': '{TAB}',
        'escape': '{ESC}', 'esc': '{ESC}', 'backspace': '{BACKSPACE}',
        'delete': '{DELETE}', 'up': '{UP}', 'down': '{DOWN}',
        'left': '{LEFT}', 'right': '{RIGHT}',
        'arrowup': '{UP}', 'arrowdown': '{DOWN}',
        'arrowleft': '{LEFT}', 'arrowright': '{RIGHT}',
        'ctrl+a': '^a', 'ctrl+c': '^c', 'ctrl+v': '^v', 'ctrl+f': '^f',
        'ctrl+s': '^s', 'ctrl+z': '^z', 'ctrl+n': '^n', 'ctrl+w': '^w',
        'ctrl+enter': '^{ENTER}', 'ctrl+return': '^{ENTER}',
        'ctrl+shift+p': '^+p', 'alt+f4': '%{F4}',
    };
    const key = PS_KEY_MAP[keyCombo.toLowerCase()];
    if (!key) throw new Error(`Unknown key for PowerShell SendKeys: ${keyCombo}`);
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
    `).catch(() => 'not_found');
    
    return result && result.startsWith('focused');
}

// ─── PUBLIC APIs ─────────────────────────────────────────────

async function clickAt(x, y, button = 'left') {
    if (nutjsAvailable) await clickAt_nut(x, y, button);
    else await clickAt_ps(x, y, button);
    return { success: true };
}

async function typeTextDirect(text) {
    if (nutjsAvailable) await typeText_nut(text);
    else await typeText_ps(text);
    return { success: true };
}

async function pressKeyDirect(key) {
    if (nutjsAvailable) await pressKey_nut(key);
    else await pressKey_ps(key);
    return { success: true };
}

async function pressKeyComboDirect(combo) {
    if (nutjsAvailable) await pressKey_nut(combo);
    else await pressKey_ps(combo);
    return { success: true };
}

async function moveTo(x, y) {
    if (nutjsAvailable) {
        const { straightTo } = require('@nut-tree-fork/nut-js');
        await nutMouse.move(straightTo({ x: Math.round(x), y: Math.round(y) }));
    } else {
        await execPowerShellInline(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
        `);
    }
}

async function _drag(x1, y1, x2, y2) {
    await moveTo(x1, y1);
    await delay(100);
    
    if (nutjsAvailable) {
        const { straightTo } = require('@nut-tree-fork/nut-js');
        await nutMouse.pressButton(nutButton.LEFT);
        await delay(50);
        await nutMouse.move(straightTo({ x: Math.round(x2), y: Math.round(y2) }));
        await delay(50);
        await nutMouse.releaseButton(nutButton.LEFT);
    } else {
        await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int i);
}
"@
[Mouse]::mouse_event(0x02, 0, 0, 0, 0)
        `);
        await delay(50);
        const steps = 10;
        for (let i = 1; i <= steps; i++) {
            const cx = Math.round(x1 + (x2 - x1) * (i / steps));
            const cy = Math.round(y1 + (y2 - y1) * (i / steps));
            await moveTo(cx, cy);
            await delay(15);
        }
        await delay(50);
        await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int i);
}
"@
[Mouse]::mouse_event(0x04, 0, 0, 0, 0)
        `);
    }
    return { success: true, message: `Dragged from (${x1},${y1}) to (${x2},${y2})` };
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractTextFromTypeDescription(description = '') {
    const text = String(description || '');
    const quoted = text.match(/type\s+['"“”]([^'"“”]+)['"“”]/i);
    if (quoted && quoted[1]) return quoted[1].trim();
    return '';
}

async function executeVisionAction(act) {
    if (!act || !act.action) {
        return { success: false, error: 'No action provided' };
    }

    const action = act.action.toLowerCase();
    console.log(`[screen-agent] Executing vision action: ${action}`, act);

    if (['click', 'double_click', 'doubleclick', 'right_click', 'rightclick', 'type'].includes(action) && act.windowTitle) {
        await bringToForeground(act.windowTitle);
        await delay(100);
    }

    switch (action) {
        case 'click':
            console.log(`[screen-agent] Clicking at (${act.x}, ${act.y})`);
            return await clickAt(act.x, act.y, act.button || 'left');

        case 'double_click':
        case 'doubleclick':
            await clickAt(act.x, act.y);
            await delay(80);
            return await clickAt(act.x, act.y);

        case 'right_click':
        case 'rightclick':
            return await clickAt(act.x, act.y, 'right');

        case 'type':
            if (act.x !== undefined && act.y !== undefined) {
                await clickAt(act.x, act.y);
                await delay(200);
            }
            const textToType = act.text || extractTextFromTypeDescription(act.description);
            if (!textToType) {
                return { success: false, error: 'Vision type action did not include text' };
            }
            await typeTextDirect(textToType);
            return { success: true };

        case 'key':
        case 'press_key':
        case 'hotkey':
            await pressKeyDirect(act.key || '');
            return { success: true };

        case 'scroll':
            if (act.x !== undefined && act.y !== undefined) {
                await moveTo(act.x, act.y);
                await delay(100);
            }
            if (nutjsAvailable) {
                const amount = (act.clicks || 3) * 120;
                if (act.direction === 'up') await nutMouse.scrollUp(amount);
                else await nutMouse.scrollDown(amount);
            } else {
                const value = act.direction === 'up' ? ((act.clicks || 3) * 120) : -((act.clicks || 3) * 120);
                await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int i);
}
"@
[Mouse]::mouse_event(0x0800, 0, 0, ${value}, 0)
                `);
            }
            return { success: true };

        case 'move':
            await moveTo(act.x, act.y);
            return { success: true };

        case 'drag':
            return await _drag(act.x, act.y, act.end_x, act.end_y);

        case 'wait':
            await delay(act.duration || 1000);
            return { success: true, message: `Waited ${act.duration || 1000}ms` };

        case 'done':
            return { success: true, done: true, message: act.description || 'Task complete' };

        case 'fail':
            return { success: false, done: true, error: act.description || 'Cannot proceed' };

        default:
            return { success: false, error: `Unknown vision action: ${action}` };
    }
}

// Support both standard Class APIs & Direct Exports seamlessly
module.exports = {
    // Direct exports for Part 7 spec
    clickAt, 
    typeTextDirect, 
    pressKeyDirect, 
    pressKeyComboDirect,
    bringToForeground, 
    execPowerShellInline, 
    delay,
    executeVisionAction,
    moveTo,

    // Class aliases for backward compatibility (in action-executor.js)
    typeText: typeTextDirect,
    pressKey: pressKeyDirect,
    bringWindowToForeground: bringToForeground
};
