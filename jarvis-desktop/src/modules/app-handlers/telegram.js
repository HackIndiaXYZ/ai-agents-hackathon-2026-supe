const { execPowerShellInline, bringToForeground, typeTextDirect, pressKeyDirect, pressKeyComboDirect, delay } = require('../screen-agent');

const TELEGRAM_WINDOW_TITLES = ['Telegram'];

async function ensureTelegramOpen() {
    console.log('[telegram-handler] Ensuring Telegram is open and active');
    const ps = `Get-Process -Name "Telegram" -ErrorAction SilentlyContinue | Select-Object -First 1 | ConvertTo-Json`;
    const result = await execPowerShellInline(ps).catch(() => null);
    
    if (!result || result.trim() === '' || result.trim() === 'null') {
        console.log('[telegram-handler] Telegram process not found. Starting Telegram.');
        await execPowerShellInline(`Start-Process "tg://"`).catch(() => null);   // URI protocol
        await delay(3000);
    }
    
    const focused = await bringToForeground(TELEGRAM_WINDOW_TITLES);
    if (!focused) {
        await execPowerShellInline(`
            $proc = Get-Process | Where-Object {$_.MainWindowTitle -like "*Telegram*"} | Select-Object -First 1
            if ($proc) {
                Add-Type @"
using System;
using System.Runtime.InteropServices;
public class TG {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
                [TG]::ShowWindow($proc.MainWindowHandle, 9)
                [TG]::SetForegroundWindow($proc.MainWindowHandle)
            }
        `).catch(() => null);
        await delay(600);
    }
    
    return true;
}

async function sendMessage(params) {
    const contact = params.contact || params.contactName || params.recipient;
    const message = params.message || params.text || '';
    const send = params.send !== false;
    
    if (!contact) {
        throw new Error('Missing parameter: contact');
    }
    
    console.log(`[telegram-handler] Sending Telegram message to: "${contact}", Message: "${message}"`);
    await ensureTelegramOpen();
    await delay(500);
    
    // Telegram search shortcut is Ctrl+F or Esc key (to clear and focus search box)
    console.log('[telegram-handler] Triggering Telegram search box');
    await pressKeyDirect('Escape');
    await delay(200);
    await pressKeyComboDirect('ctrl+f');
    await delay(400);
    
    // Type contact
    await typeTextDirect(contact);
    await delay(1200); // Wait for search population
    
    // Navigate to first item
    await pressKeyDirect('ArrowDown');
    await delay(200);
    await pressKeyDirect('Enter');
    await delay(600);
    
    // Type message
    await typeTextDirect(message);
    await delay(200);
    
    if (send) {
        await pressKeyDirect('Enter');
        await delay(200);
    }
    
    return { success: true, message: `Sent Telegram message to ${contact}` };
}

module.exports = { sendMessage, ensureTelegramOpen };
