const dot = document.getElementById('hudDot');
const text = document.getElementById('hudText');

window.electronAPI.onStatusHudUpdate((payload = {}) => {
    const status = payload.status || 'ready';
    dot.className = `dot ${status}`;
    text.textContent = payload.text || 'Ready';
});
