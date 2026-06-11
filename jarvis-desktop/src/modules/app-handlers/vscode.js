const { execPowerShellInline, bringToForeground, typeTextDirect, pressKeyDirect, pressKeyComboDirect, delay } = require('../screen-agent');

async function openFile(params) {
    const filePath = params.path || params.filePath || params.file;
    if (!filePath) {
        throw new Error('Missing parameter: path');
    }
    console.log(`[vscode-handler] Opening file: "${filePath}"`);
    await execPowerShellInline(`code "${filePath}"`);
    return { success: true, message: `Opened file in VS Code: ${filePath}` };
}

async function runTerminalCommand(params) {
    const command = params.command || params.cmd || '';
    if (!command) {
        throw new Error('Missing parameter: command');
    }
    console.log(`[vscode-handler] Running terminal command: "${command}"`);
    await bringToForeground(['Visual Studio Code']);
    await delay(300);
    await pressKeyComboDirect('ctrl+`');  // open terminal
    await delay(600);
    await typeTextDirect(command);
    await delay(200);
    await pressKeyDirect('Enter');
    return { success: true, message: `Ran terminal command: "${command}"` };
}

async function openCommandPalette(params) {
    const command = params.command || '';
    console.log(`[vscode-handler] Triggering Command Palette command: "${command}"`);
    await bringToForeground(['Visual Studio Code']);
    await delay(300);
    await pressKeyComboDirect('ctrl+shift+p');
    await delay(400);
    if (command) {
        await typeTextDirect(command);
        await delay(300);
        await pressKeyDirect('Enter');
    }
    return { success: true, message: `Opened Command Palette and triggered "${command}"` };
}

async function searchInFiles(params) {
    const query = params.query || params.searchText || '';
    if (!query) {
        throw new Error('Missing parameter: query');
    }
    console.log(`[vscode-handler] Searching files for: "${query}"`);
    await bringToForeground(['Visual Studio Code']);
    await delay(300);
    await pressKeyComboDirect('ctrl+shift+f');
    await delay(400);
    await pressKeyComboDirect('ctrl+a');
    await delay(100);
    await typeTextDirect(query);
    await delay(200);
    await pressKeyDirect('Enter');
    return { success: true, message: `Searching files for: "${query}"` };
}

module.exports = { openFile, runTerminalCommand, openCommandPalette, searchInFiles };
