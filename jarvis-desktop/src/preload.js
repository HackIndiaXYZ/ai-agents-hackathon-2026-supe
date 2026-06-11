const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Settings
    getSettings: () => ipcRenderer.invoke('get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
    
    // Credentials Vault
    getCredentials: () => ipcRenderer.invoke('get-credentials'),
    saveCredential: (site, username, password) => ipcRenderer.invoke('save-credential', { site, username, password }),
    deleteCredential: (site) => ipcRenderer.invoke('delete-credential', { site }),
    
    // Screenshot
    takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
    takeScreenshotHires: (opts) => ipcRenderer.invoke('take-screenshot-hires', opts),
    onScreenshotCaptured: (callback) => {
        ipcRenderer.on('screenshot-captured', (event, data) => callback(data));
    },
    
    // Screen info
    getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
    
    // Window controls
    minimizeWindow: () => ipcRenderer.send('minimize-window'),
    hideWindow: () => ipcRenderer.invoke('hide-window'),
    showWindow: () => ipcRenderer.invoke('show-window'),
    showCommandBar: () => ipcRenderer.invoke('show-command-bar'),
    hideCommandBar: () => ipcRenderer.invoke('hide-command-bar'),
    submitCommandBar: (payload) => ipcRenderer.invoke('command-bar-submit', payload),
    updateStatusHud: (payload) => ipcRenderer.invoke('update-status-hud', payload),
    submitCredentialDialog: (payload) => ipcRenderer.send('credential-dialog-submit', payload),
    cancelCredentialDialog: () => ipcRenderer.send('credential-dialog-cancel'),
    closeWindow: () => ipcRenderer.send('close-window'),
    toggleAlwaysOnTop: (value) => ipcRenderer.send('toggle-always-on-top', value),
    
    // Capture control
    startCapture: () => ipcRenderer.send('start-capture'),
    stopCapture: () => ipcRenderer.send('stop-capture'),
    
    // Action execution (forward to action-executor)
    executeAction: (action) => ipcRenderer.invoke('execute-action', action),
    
    // Stop execution
    stopExecution: () => ipcRenderer.invoke('stop-execution'),
    resetStopFlag: () => ipcRenderer.invoke('reset-stop-flag'),
    checkStopFlag: () => ipcRenderer.invoke('check-stop-flag'),
    // 7.4: Task completion notification
    notifyTaskResult: (data) => ipcRenderer.invoke('notify-task-result', data),
    
    // User home directory
    getUserHome: () => ipcRenderer.invoke('get-user-home'),

    // CogAgent direct connection (bypasses langchain backend for vision)
    cogagentHealth:    (url)     => ipcRenderer.invoke('cogagent-health', url),
    cogagentVisionAct: (payload) => ipcRenderer.invoke('cogagent-vision-act', payload),

    // Events
    onShowSettings: (callback) => {
        ipcRenderer.on('show-settings', () => callback());
    },
    onExternalCommand: (callback) => {
        ipcRenderer.on('external-command', (event, payload) => callback(payload));
    },
    onCommandBarFocus: (callback) => {
        ipcRenderer.on('command-bar-focus', () => callback());
    },
    onCommandBarOpenWithContext: (callback) => {
        ipcRenderer.on('open-with-context', (event, payload) => callback(payload));
    },
    onCancelCurrentTask: (callback) => {
        ipcRenderer.on('cancel-current-task', () => callback());
    },
    onStatusHudUpdate: (callback) => {
        ipcRenderer.on('status-hud-update', (event, payload) => callback(payload));
    },
    onCredentialDialogError: (callback) => {
        ipcRenderer.on('credential-dialog-error', (event, message) => callback(message));
    }
});

// Also expose versions
contextBridge.exposeInMainWorld('versions', {
    node: () => process.versions.node,
    chrome: () => process.versions.chrome,
    electron: () => process.versions.electron
});
