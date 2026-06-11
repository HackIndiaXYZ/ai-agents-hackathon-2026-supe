const { execPowerShellInline, bringToForeground, typeTextDirect, pressKeyDirect, pressKeyComboDirect, delay } = require('../screen-agent');

async function openNotes(params) {
    console.log('[notes-handler] Opening Notepad');
    await execPowerShellInline('Start-Process "notepad.exe"');
    await delay(1000);
    return { success: true, message: 'Opened Notepad' };
}

async function writeText(params) {
    const text = params.text || params.content || '';
    console.log(`[notes-handler] Typing text into Notepad: "${text.substring(0, 40)}..."`);
    await bringToForeground(['Notepad', 'Untitled - Notepad']);
    await delay(300);
    await typeTextDirect(text);
    return { success: true, message: 'Wrote text to Notepad' };
}

async function saveDocument(params) {
    const filePath = params.path || params.filePath || '';
    if (!filePath) {
        throw new Error('Missing parameter: path');
    }
    console.log(`[notes-handler] Saving Notepad document to: "${filePath}"`);
    await bringToForeground(['Notepad', 'Untitled - Notepad']);
    await delay(300);
    
    // Trigger Save As
    await pressKeyComboDirect('ctrl+s');
    await delay(800);
    
    // Type path & save
    await typeTextDirect(filePath);
    await delay(400);
    await pressKeyDirect('Enter');
    await delay(500);
    
    return { success: true, message: `Saved document to: ${filePath}` };
}

module.exports = { openNotes, writeText, saveDocument };
