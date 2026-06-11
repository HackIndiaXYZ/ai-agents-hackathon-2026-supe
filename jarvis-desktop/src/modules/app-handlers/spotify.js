const { execPowerShellInline, bringToForeground, pressKeyDirect, pressKeyComboDirect, delay } = require('../screen-agent');

async function playMusic(params) {
    const query = params.query || params.song || params.artist || '';
    if (!query) {
        throw new Error('Missing parameter: query');
    }
    
    console.log(`[spotify-handler] Playing music for query: "${query}"`);
    // Use Spotify URI protocol — fastest, no UI interaction needed
    const searchUri = `spotify:search:${encodeURIComponent(query)}`;
    
    // Open Spotify search via URI
    await execPowerShellInline(`Start-Process "${searchUri}"`);
    await delay(2000);
    
    // Press Enter to play first result
    await pressKeyDirect('Enter');
    return { success: true, message: `Playing "${query}" on Spotify` };
}

async function pausePlayback() {
    console.log('[spotify-handler] Pausing music playback');
    await bringToForeground(['Spotify']);
    await delay(300);
    await pressKeyComboDirect('ctrl+alt+p');  // Spotify global pause shortcut
    return { success: true, message: 'Paused Spotify playback' };
}

async function nextTrack() {
    console.log('[spotify-handler] Skipping to next track');
    await bringToForeground(['Spotify']);
    await delay(300);
    await pressKeyComboDirect('ctrl+alt+right');
    return { success: true, message: 'Skipped to next track' };
}

async function setVolume(params) {
    const level = params.level || params.volume;
    if (level === undefined) {
        throw new Error('Missing parameter: level');
    }
    console.log(`[spotify-handler] Setting system volume for Spotify to: ${level}%`);
    // Use Windows audio instead of Spotify UI for volume
    return require('../system-manager').setVolume(level);
}

module.exports = { playMusic, pausePlayback, nextTrack, setVolume };
