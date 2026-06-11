const handlers = {};

const OPERATION_ALIASES = {
    send_message: 'sendMessage',
    'send-message': 'sendMessage',
    whatsapp_send_message: 'sendMessage',
    play_music: 'playMusic',
    'play-music': 'playMusic',
    pause_playback: 'pausePlayback',
    'pause-playback': 'pausePlayback',
    next_track: 'nextTrack',
    'next-track': 'nextTrack',
    set_volume: 'setVolume',
    'set-volume': 'setVolume',
    open_file: 'openFile',
    'open-file': 'openFile',
    run_terminal_command: 'runTerminalCommand',
    'run-terminal-command': 'runTerminalCommand',
    open_command_palette: 'openCommandPalette',
    'open-command-palette': 'openCommandPalette',
    search_in_files: 'searchInFiles',
    'search-in-files': 'searchInFiles',
    open_notes: 'openNotes',
    'open-notes': 'openNotes',
    write_text: 'writeText',
    'write-text': 'writeText',
    save_document: 'saveDocument',
    'save-document': 'saveDocument',
    read_unread: 'readUnread',
    'read-unread': 'readUnread',
};

function toCamelCase(operation) {
    return String(operation || '')
        .trim()
        .replace(/[-_]+([a-zA-Z0-9])/g, (_, ch) => ch.toUpperCase());
}

function resolveOperation(handler, operation) {
    const raw = String(operation || '').trim();
    const candidates = [
        raw,
        OPERATION_ALIASES[raw],
        OPERATION_ALIASES[raw.toLowerCase()],
        toCamelCase(raw),
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (typeof handler[candidate] === 'function') return candidate;
    }
    return null;
}

// Register handler for an app
function registerAppHandler(appName, handler) {
    const keys = Array.isArray(appName) ? appName : [appName];
    keys.forEach(k => {
        handlers[k.toLowerCase().trim()] = handler;
    });
}

// Get handler for an app
function getAppHandler(appName) {
    if (!appName) return null;
    return handlers[appName.toLowerCase().trim()] || null;
}

// Execute via app-specific handler
async function executeAppEngine(appName, operation, params) {
    console.log(`[app-engine] Dispatching request for App: "${appName}", Operation: "${operation}"`);
    const handler = getAppHandler(appName);
    
    if (!handler) {
        console.warn(`[app-engine] No registered handler for app: "${appName}". Falling back to vision.`);
        return { success: false, fallback: 'vision', reason: `No handler for ${appName}` };
    }
    
    const resolvedOperation = resolveOperation(handler, operation);
    if (!resolvedOperation) {
        console.warn(`[app-engine] Handler for "${appName}" exists but does not support operation: "${operation}". Falling back to vision.`);
        return { success: false, fallback: 'vision', reason: `${appName} handler does not support ${operation}` };
    }
    
    try {
        const result = await handler[resolvedOperation](params);
        if (result && result.success === false) {
            return {
                success: false,
                error: result.error || result.reason || `${appName} ${resolvedOperation} failed`,
                result,
                fallback: result.fallback,
            };
        }
        return {
            success: true,
            message: result?.message,
            result,
            operation: resolvedOperation,
        };
    } catch (err) {
        console.error(`[app-engine] Error in handler for "${appName}":`, err);
        return { success: false, error: err.message, fallback: 'vision' };
    }
}

module.exports = { registerAppHandler, getAppHandler, executeAppEngine };
