const input = document.getElementById('commandInput');
const send = document.getElementById('sendCommand');
let currentContext = null;

function submit() {
    const text = input.value.trim();
    if (!text) return;
    window.electronAPI.submitCommandBar({ command: text, context: currentContext });
    input.value = '';
    currentContext = null;
}

send.addEventListener('click', submit);
input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        submit();
    }
    if (event.key === 'Escape') {
        event.preventDefault();
        window.electronAPI.hideCommandBar();
    }
});

window.electronAPI.onCommandBarFocus(() => {
    setTimeout(() => input.focus(), 30);
});

window.electronAPI.onCommandBarOpenWithContext?.((context = {}) => {
    currentContext = context;
    const active = context.activeApp || context.process || '';
    input.placeholder = active && active !== 'unknown'
        ? `Ask Pecifics... (${active} is active)`
        : 'Ask Pecifics...';
});

setTimeout(() => input.focus(), 100);
