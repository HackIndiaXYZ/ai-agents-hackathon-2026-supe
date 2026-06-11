/**
 * WhatsApp handler — supports PWA (taskbar/installed app), WhatsApp Web browser tab,
 * and desktop app — tries each in order.
 */

const {
    execPowerShellInline,
    clickAt,
    pressKeyDirect,
    pressKeyComboDirect,
    delay,
} = require('../screen-agent');

// ── Find any WhatsApp window (PWA, desktop app, or browser with WA open) ───

async function findWhatsAppWindow() {
    const result = await execPowerShellInline(`
$proc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and (
            $_.MainWindowTitle -like "*WhatsApp*" -or
            $_.Name -like "WhatsApp*"
        )
    } | Select-Object -First 1
if ($proc) {
    "$($proc.Id):::$($proc.Name):::$($proc.MainWindowTitle):::$($proc.MainWindowHandle)"
} else { "not_found" }
    `).catch(() => 'not_found');

    const txt = String(result || '').trim();
    if (txt === 'not_found' || !txt) return null;
    const [pid, name, title, handle] = txt.split(':::');
    return { pid: Number(pid), name, title, handle };
}

async function launchWhatsApp() {
    // 1. Try PWA launch (Chrome app — installed from browser)
    await execPowerShellInline(`
$appId = (Get-StartApps | Where-Object { $_.Name -like "*WhatsApp*" } | Select-Object -First 1).AppId
if ($appId) {
    Start-Process "shell:AppsFolder\\$appId"
} else {
    # Fallback: open web.whatsapp.com in default browser
    Start-Process "https://web.whatsapp.com"
}
    `).catch(() => null);

    // Wait up to 15s for any WhatsApp window to appear
    for (let i = 0; i < 15; i++) {
        await delay(1000);
        const win = await findWhatsAppWindow();
        if (win) return win;
    }
    return null;
}

async function ensureWhatsAppOpen() {
    let win = await findWhatsAppWindow();
    if (win) return { success: true, alreadyOpen: true, window: win };

    console.log('[whatsapp] No WhatsApp window found — launching...');
    win = await launchWhatsApp();
    if (!win) {
        return {
            success: false,
            error: 'Could not open WhatsApp. Open it manually from your taskbar once, then retry.',
        };
    }
    await delay(2000); // let the app settle
    return { success: true, alreadyOpen: false, window: win };
}

// ── Window focus & rect ─────────────────────────────────────────────────────

async function focusWhatsAppWindow() {
    for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WAFocus {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$proc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and (
            $_.MainWindowTitle -like "*WhatsApp*" -or
            $_.Name -like "WhatsApp*"
        )
    } | Select-Object -First 1
if ($proc) {
    [WAFocus]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    Start-Sleep -Milliseconds 200
    [WAFocus]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    "focused:$($proc.Name):$($proc.MainWindowTitle)"
} else { "not_found" }
        `).catch(() => 'error');

        if (String(result || '').startsWith('focused')) return { success: true, result };
        await delay(500 * attempt);
    }
    return { success: false, error: 'Could not focus WhatsApp window' };
}

async function getWhatsAppWindowRect() {
    const result = await execPowerShellInline(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WARect {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$proc = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.MainWindowHandle -ne [IntPtr]::Zero -and (
            $_.MainWindowTitle -like "*WhatsApp*" -or
            $_.Name -like "WhatsApp*"
        )
    } | Select-Object -First 1
if ($proc) {
    $r = New-Object WARect+RECT
    [WARect]::GetWindowRect($proc.MainWindowHandle, [ref]$r) | Out-Null
    "$($r.L),$($r.T),$($r.R),$($r.B)"
}
    `).catch(() => '');

    const parts = String(result || '').trim().split(',').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    const [left, top, right, bottom] = parts;
    return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// ── Input helpers ───────────────────────────────────────────────────────────

async function pasteTextExact(text) {
    const value = String(text || '');
    if (!value) return { success: false, error: 'No text to paste' };
    const { clipboard } = require('electron');
    clipboard.writeText(value);
    await delay(150);
    await pressKeyComboDirect('ctrl+v');
    await delay(200);
    return { success: true };
}

// ── Click helpers (layout-based, works for both PWA and browser) ────────────

async function openSearchAndType(contact) {
    // Ctrl+F opens WhatsApp's own search in both PWA and browser tab
    await pressKeyComboDirect('ctrl+f');
    await delay(700);

    // Clear any pre-existing search text
    await pressKeyComboDirect('ctrl+a');
    await delay(150);

    // Paste contact name
    await pasteTextExact(contact);
    return { success: true };
}

async function selectFirstSearchResult() {
    // Use keyboard to select first result — reliable regardless of window size
    // ArrowDown highlights the first contact in results list
    await pressKeyDirect('arrowdown');
    await delay(400);
    // Enter opens that chat
    await pressKeyDirect('enter');
    await delay(600);
    return { success: true };
}

async function focusMessageInput() {
    // After opening a chat, message input gets focus automatically in WhatsApp Web.
    // Press Escape first to close any leftover search, then Tab into the message box.
    await pressKeyDirect('escape');
    await delay(200);

    // Click the message area by coordinate as a reliable fallback
    const rect = await getWhatsAppWindowRect();
    if (rect) {
        // Message input: right ~60% of window, bottom ~93% vertically
        const x = rect.left + Math.floor(rect.width * 0.62);
        const y = rect.top + Math.floor(rect.height * 0.93);
        await clickAt(x, y);
        await delay(200);
    }
    return { success: true };
}

// ── Step runner ─────────────────────────────────────────────────────────────

async function runStep(stepResults, step, fn) {
    const t0 = Date.now();
    try {
        const result = await fn();
        const ok = !result || result.success !== false;
        stepResults.push({ step, success: ok, duration_ms: Date.now() - t0, result });
        console.log(`[whatsapp] ${ok ? '✓' : '✗'} ${step} (${Date.now() - t0}ms)`);
        if (!ok) {
            const err = new Error(result?.error || `${step} failed`);
            err.step = step;
            throw err;
        }
        return result;
    } catch (err) {
        stepResults.push({ step, success: false, duration_ms: Date.now() - t0, error: err.message });
        err.step = err.step || step;
        throw err;
    }
}

// ── Main export ─────────────────────────────────────────────────────────────

async function sendMessage(params = {}) {
    const contact = String(params.contact || params.contactName || params.recipient || params.to || '').trim();
    const message = String(params.message || params.text || params.msg || '').trim();
    const shouldSend = params.send !== false;
    const stepResults = [];

    if (!contact) return { success: false, error: 'Missing parameter: contact', stepResults };
    if (!message) return { success: false, error: 'Missing parameter: message', stepResults };

    console.log(`[whatsapp] sendMessage → contact="${contact}" message="${message}"`);

    // Step 1: Make sure WhatsApp is open (PWA, browser, or desktop app)
    const opened = await runStep(stepResults, 'ensure_open', ensureWhatsAppOpen);
    if (!opened.success) return { ...opened, stepResults };

    // Hide Pecifics window while operating WhatsApp
    const pecificsWin = (() => {
        try {
            const { BrowserWindow } = require('electron');
            return BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null;
        } catch { return null; }
    })();
    const wasVisible = !!(pecificsWin && pecificsWin.isVisible());
    if (pecificsWin) { pecificsWin.hide(); await delay(200); }

    try {
        await runStep(stepResults, 'focus_window', focusWhatsAppWindow);
        await delay(700);

        // Dismiss any open dialogs/panels
        await pressKeyDirect('escape');
        await delay(300);

        // Search for the contact
        await runStep(stepResults, 'search_contact', () => openSearchAndType(contact));
        await delay(Number(params.searchWaitMs || 1800));

        // Select first result with ArrowDown + Enter (keyboard, not coordinates)
        await runStep(stepResults, 'select_result', selectFirstSearchResult);
        await delay(Number(params.chatOpenWaitMs || 1000));

        // Focus the message input
        await runStep(stepResults, 'focus_input', focusMessageInput);
        await delay(300);

        // Paste the message
        await runStep(stepResults, 'paste_message', () => pasteTextExact(message));
        await delay(250);

        // Send
        if (shouldSend) {
            await runStep(stepResults, 'send', () => pressKeyDirect('enter'));
            await delay(400);
        }

        return {
            success: true,
            message: shouldSend
                ? `✅ Sent "${message}" to ${contact} via WhatsApp`
                : `✅ Typed message for ${contact} (not sent)`,
            contact,
            sent: shouldSend,
            stepResults,
        };
    } catch (err) {
        console.error(`[whatsapp] Failed at "${err.step}": ${err.message}`);
        return {
            success: false,
            error: `WhatsApp failed at "${err.step}": ${err.message}`,
            step: err.step,
            contact,
            sent: false,
            stepResults,
        };
    } finally {
        if (wasVisible && pecificsWin && !pecificsWin.isDestroyed()) {
            await delay(500);
            pecificsWin.show();
        }
    }
}

async function readUnread() {
    return { success: false, reason: 'read_unread not yet implemented' };
}

module.exports = { sendMessage, readUnread, ensureWhatsAppOpen, focusWhatsAppWindow };
