// =============================================================
// Pecifics AI — Renderer (Multi-Task, Vision, User Input)
// =============================================================

(function () {
    'use strict';

    // ─── DOM ────────────────────────────────────────────────────
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const chatContainer   = $('#chatContainer');
    const messageInput    = $('#messageInput');
    const sendBtn         = $('#sendBtn');
    const stopBtn         = $('#stopBtn');
    const progressArea    = $('#progressArea');
    const progressFill    = $('#progressFill');
    const progressText    = $('#progressText');
    const statusDot       = $('#statusDot');
    const previewToggle   = $('#previewToggle');
    const modeLabel       = $('#modeLabel');
    const welcomeMessage  = $('#welcomeMessage');
    const offlineBanner   = $('#offlineBanner');
    const retryBtn        = $('#retryBtn');

    // Settings
    const settingsBtn     = $('#settingsBtn');
    const backBtn         = $('#backBtn');
    const chatView        = $('#chatView');
    const settingsView    = $('#settingsView');
    const colabUrl        = $('#colabUrl');
    const cogagentUrl     = $('#cogagentUrl');
    const testConnectionBtn = $('#testConnectionBtn');
    const connectionStatus  = $('#connectionStatus');
    const saveSettingsBtn   = $('#saveSettingsBtn');
    const minimizeBtn     = $('#minimizeBtn');
    const closeBtn        = $('#closeBtn');
    const qualityRange    = $('#screenshotQuality');
    const qualityValue    = $('#qualityValue');

    // ─── STATE ──────────────────────────────────────────────────
    let backendUrl = 'http://localhost:8000';
    let conversationHistory = [];
    let isProcessing = false;
    let shouldStop = false;
    let previewMode = false;
    let screenWidth = 1920;
    let screenHeight = 1080;
    let userHome = '';
    let sessionId = localStorage.getItem('pecificsSessionId') || null;
    let currentTaskId = null;
    let currentActivationContext = null;
    let backendEventSource = null;
    let activeTaskCardPrefix = null;

    function perfNow() {
        return (window.performance && typeof window.performance.now === 'function')
            ? window.performance.now()
            : Date.now();
    }

    function logTiming(label, start) {
        const elapsed = Math.round(perfNow() - start);
        console.log(`[timing] ${label}: ${elapsed}ms`);
    }

    function normalizeSearchFileItem(file) {
        const filePath = file?.Path || file?.path || file?.FullPath || file?.fullPath || '';
        const name = file?.Name || file?.name || (filePath ? filePath.split(/[\\/]/).pop() : 'Item');
        const type = String(file?.Type || file?.type || '').toLowerCase() === 'folder' ? 'folder' : 'file';
        return { name, path: filePath, type };
    }

    function extractTaskResultData(task, actionResults, originalMessage) {
        const searchGroups = [];
        const allItems = [];
        let browserResult = null;

        for (const entry of actionResults || []) {
            const actionName = entry?.action;
            const result = entry?.result || {};

            if (['search_files', 'search-files', 'search_files_advanced', 'find_files'].includes(actionName) && result.success !== false) {
                const files = Array.isArray(result.files) ? result.files : (Array.isArray(result.results) ? result.results : []);
                const items = files.map(normalizeSearchFileItem).filter(item => item.path);
                const params = entry?.params || {};
                const group = {
                    pattern: params.pattern || params.search_term || params.query || params.name || '',
                    location: params.location || params.search_location || params.path || '',
                    items,
                };
                searchGroups.push(group);
                allItems.push(...items);
            }

            if (['browser_navigate', 'navigate_to', 'navigate_and_login', 'browser_navigate_login', 'browser_navigate_and_login', 'browser_open', 'open_browser'].includes(actionName) && result.success !== false) {
                browserResult = {
                    type: 'browser_navigation',
                    url: result.url || entry.params?.url || '',
                    automationAvailable: result.automationAvailable !== false,
                    message: result.message || ''
                };
            }
        }

        if (searchGroups.length) {
            return {
                type: 'file_search',
                command: originalMessage || '',
                task_description: task?.description || '',
                groups: searchGroups,
                items: allItems,
            };
        }

        if (browserResult) {
            return browserResult;
        }

        return null;
    }

    async function reportResultDataToBackend(data, command) {
        if (!data || !backendUrl) return;
        try {
            await fetch(`${backendUrl}/store_result_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    command: command || '',
                    data,
                }),
            });
            console.log('[context] Stored result data:', data.type);
        } catch (err) {
            console.warn('[context] Could not store result data:', err.message);
        }
    }

    // ─── INIT ───────────────────────────────────────────────────
    async function init() {
        try {
            const settings = await window.electronAPI.getSettings();
            if (settings.colabUrl) backendUrl = settings.colabUrl;
            if (settings.colabUrl) colabUrl.value = settings.colabUrl;
            if (settings.cogagentUrl) cogagentUrl.value = settings.cogagentUrl;
            if (settings.alwaysOnTop !== undefined) {
                $('#alwaysOnTop').checked = settings.alwaysOnTop;
            }

            // Push saved CogAgent URL to backend on startup so it persists in memory
            if (settings.cogagentUrl) {
                try {
                    await fetch(`${backendUrl}/set_config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ cogagent_url: settings.cogagentUrl }),
                    });
                    console.log('[init] Pushed CogAgent URL to backend:', settings.cogagentUrl);
                } catch (e) { console.warn('[init] Could not push CogAgent URL to backend:', e); }

                // Also verify direct CogAgent connectivity
                try {
                    const cogHealth = await window.electronAPI.cogagentHealth();
                    if (cogHealth.ok) {
                        console.log('[init] CogAgent DIRECT connection OK:', cogHealth.data);
                    } else {
                        console.warn('[init] CogAgent not reachable directly:', cogHealth.error);
                    }
                } catch (e) { console.warn('[init] CogAgent health check failed:', e); }
            }
        } catch (e) {}

        try {
            const info = await window.electronAPI.getScreenInfo();
            if (info) { screenWidth = info.width; screenHeight = info.height; }
        } catch (e) {}

        try { userHome = await window.electronAPI.getUserHome(); } catch (e) {}

        connectBackendEventStream();
        checkBackendConnection();
        setInterval(checkBackendConnection, 30000);
    }

    function connectBackendEventStream() {
        if (backendEventSource) {
            try { backendEventSource.close(); } catch {}
        }
        try {
            backendEventSource = new EventSource(`${backendUrl}/stream`);
            backendEventSource.onmessage = (event) => {
                let payload = null;
                try { payload = JSON.parse(event.data || '{}'); } catch { return; }
                if (payload.type === 'voice_state') {
                    const status = payload.state === 'listening' ? 'listening'
                        : payload.state === 'processing' ? 'processing'
                        : payload.state === 'speaking' ? 'speaking'
                        : 'ready';
                    window.electronAPI.updateStatusHud?.({
                        status,
                        text: payload.text || (status === 'ready' ? 'Ready' : status[0].toUpperCase() + status.slice(1)),
                    });
                    if (payload.command && !isProcessing) {
                        sendMessage(payload.command, { source: 'voice' });
                    }
                }
                if (payload.type === 'proactive_alert' && Array.isArray(payload.alerts)) {
                    payload.alerts.slice(0, 2).forEach(alert => addMessage(alert.message || 'Screen alert detected.', 'ai'));
                }
            };
            backendEventSource.onerror = () => {
                try { backendEventSource.close(); } catch {}
                backendEventSource = null;
                setTimeout(() => {
                    if (!backendEventSource) connectBackendEventStream();
                }, 15000);
            };
        } catch (e) {
            console.warn('[events] backend stream unavailable:', e.message);
        }
    }

    // ─── BACKEND CONNECTION ─────────────────────────────────────
    async function checkBackendConnection() {
        let langchainOk = false;
        try {
            const resp = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) langchainOk = true;
        } catch (e) {}

        // Also check CogAgent direct reachability
        let cogOk = false;
        const currentCogUrl = cogagentUrl.value.trim();
        if (currentCogUrl) {
            try {
                const cogHealth = await window.electronAPI.cogagentHealth();
                cogOk = cogHealth.ok;
            } catch (e) {}
        }

        // Update status indicator
        if (langchainOk || cogOk) {
            statusDot.classList.add('connected');
            const parts = [];
            if (langchainOk) parts.push('LLM Backend');
            if (cogOk) parts.push('CogAgent');
            statusDot.title = `Connected: ${parts.join(' + ')}`;
            offlineBanner.classList.remove('visible');
            return true;
        }

        statusDot.classList.remove('connected');
        statusDot.title = 'Disconnected — start backend and/or set CogAgent URL';
        offlineBanner.classList.add('visible');
        return false;
    }

    retryBtn.addEventListener('click', () => checkBackendConnection());

    // ─── MESSAGES ───────────────────────────────────────────────
    function addMessage(text, role = 'ai') {
        if (welcomeMessage) welcomeMessage.style.display = 'none';

        const msg = document.createElement('div');
        msg.className = `msg ${role}`;

        if (role === 'ai') {
            msg.innerHTML = `
                <div class="msg-avatar">P</div>
                <div class="msg-bubble">
                    <div class="msg-text">${escapeHtml(text)}</div>
                    <div class="msg-actions">
                        <button class="msg-action-btn copy-btn" title="Copy">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                            Copy
                        </button>
                    </div>
                </div>`;
        } else {
            msg.innerHTML = `
                <div class="msg-bubble">
                    <div class="msg-text">${escapeHtml(text)}</div>
                    <div class="msg-actions">
                        <button class="msg-action-btn copy-btn" title="Copy">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                            Copy
                        </button>
                        <button class="msg-action-btn edit-btn" title="Edit & resend">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            Edit
                        </button>
                    </div>
                </div>`;
        }

        chatContainer.appendChild(msg);
        scrollToBottom();

        // Wire copy/edit buttons
        const copyBtn = msg.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(text);
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy`;
                }, 2000);
            });
        }

        const editBtn = msg.querySelector('.edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', () => startEdit(msg, text));
        }

        return msg;
    }

    function addThinking() {
        if (welcomeMessage) welcomeMessage.style.display = 'none';
        const msg = document.createElement('div');
        msg.className = 'msg ai';
        msg.id = 'thinkingMsg';
        msg.innerHTML = `
            <div class="msg-avatar">P</div>
            <div class="msg-bubble">
                <div class="thinking">
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                    <div class="thinking-dot"></div>
                </div>
            </div>`;
        chatContainer.appendChild(msg);
        scrollToBottom();
        return msg;
    }

    function removeThinking() {
        const t = $('#thinkingMsg');
        if (t) t.remove();
    }

    // ─── EDIT USER MESSAGE ──────────────────────────────────────
    function startEdit(msgEl, originalText) {
        const bubble = msgEl.querySelector('.msg-bubble');
        bubble.classList.add('editing');
        bubble.innerHTML = `
            <textarea class="edit-textarea" rows="3">${escapeHtml(originalText)}</textarea>
            <div class="edit-actions">
                <button class="edit-save">Resend</button>
                <button class="edit-cancel">Cancel</button>
            </div>`;

        const textarea = bubble.querySelector('.edit-textarea');
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);

        bubble.querySelector('.edit-save').addEventListener('click', () => {
            const newText = textarea.value.trim();
            if (newText) {
                // Remove all messages after this one
                let next = msgEl.nextElementSibling;
                while (next) {
                    const toRemove = next;
                    next = next.nextElementSibling;
                    toRemove.remove();
                }
                // Trim conversation history
                const idx = conversationHistory.findLastIndex(h => h.role === 'user' && h.content === originalText);
                if (idx !== -1) conversationHistory.splice(idx);
                msgEl.remove();
                sendMessage(newText);
            }
        });

        bubble.querySelector('.edit-cancel').addEventListener('click', () => {
            bubble.classList.remove('editing');
            bubble.innerHTML = `
                <div class="msg-text">${escapeHtml(originalText)}</div>
                <div class="msg-actions">
                    <button class="msg-action-btn copy-btn" title="Copy">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                        Copy
                    </button>
                    <button class="msg-action-btn edit-btn" title="Edit & resend">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                    </button>
                </div>`;
            bubble.querySelector('.copy-btn').addEventListener('click', () => {
                navigator.clipboard.writeText(originalText);
            });
            bubble.querySelector('.edit-btn').addEventListener('click', () => startEdit(msgEl, originalText));
        });
    }

    // ─── TASK CARDS ─────────────────────────────────────────────
    function renderTaskCards(tasks) {
        activeTaskCardPrefix = currentTaskId || `render_${Date.now()}`;
        const container = document.createElement('div');
        container.className = 'task-container';

        tasks.forEach((task, idx) => {
            const card = document.createElement('div');
            card.className = 'task-card';
            card.id = `task-card-${activeTaskCardPrefix}-${task.id}`;
            card.innerHTML = `
                <div class="task-header">
                    <div class="task-number">${task.id}</div>
                    <div class="task-title">${escapeHtml(task.description)}</div>
                    <div class="task-status">${task.needs_input ? 'Needs Info' : 'Pending'}</div>
                </div>
                <div class="task-actions-list"></div>`;
            container.appendChild(card);
        });

        chatContainer.appendChild(container);
        scrollToBottom();
        return container;
    }

    function updateTaskCard(taskId, status, statusText) {
        const card = $(`#task-card-${activeTaskCardPrefix}-${taskId}`);
        if (!card) return;
        card.className = `task-card ${status}`;
        const st = card.querySelector('.task-status');
        if (st) st.textContent = statusText || status;
    }

    function addActionToTaskCard(taskId, actionDesc, state = 'running') {
        const card = $(`#task-card-${activeTaskCardPrefix}-${taskId}`);
        if (!card) return;
        const list = card.querySelector('.task-actions-list');
        if (!list) return;
        const item = document.createElement('div');
        item.className = `task-action-item ${state}`;
        item.innerHTML = `<span class="action-icon">${state === 'running' ? '<div class="spinner-sm"></div>' : state === 'complete' ? '✓' : '✗'}</span> ${escapeHtml(actionDesc)}`;
        list.appendChild(item);
        scrollToBottom();
        return item;
    }

    function completeActionItem(item, success = true) {
        if (!item) return;
        item.className = `task-action-item ${success ? 'complete' : 'failed'}`;
        const icon = item.querySelector('.action-icon');
        if (icon) icon.innerHTML = success ? '✓' : '✗';
    }

    // ─── USER INPUT FORM ────────────────────────────────────────
    function showInputForm(task) {
        return new Promise((resolve) => {
            const form = document.createElement('div');
            form.className = 'input-form-card';
            let fieldsHtml = `<h4>📝 Input needed: ${escapeHtml(task.description)}</h4>`;

            (task.input_fields || []).forEach(field => {
                const isTextarea = field.key === 'content' || field.key === 'body' || field.key === 'message';
                const inputType = field.type === 'password' || field.secret === true ? 'password' : 'text';
                fieldsHtml += `
                    <div class="form-field">
                        <label>${escapeHtml(field.label || field.key)}</label>
                        ${isTextarea
                            ? `<textarea data-key="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(field.default || '')}</textarea>`
                            : `<input type="${inputType}" data-key="${field.key}" placeholder="${escapeHtml(field.placeholder || '')}" value="${escapeHtml(field.default || '')}">`
                        }
                    </div>`;
            });

            fieldsHtml += `
                <div class="form-actions">
                    <button class="form-submit">Submit & Continue</button>
                    <button class="form-skip">Skip Task</button>
                </div>`;

            form.innerHTML = fieldsHtml;
            chatContainer.appendChild(form);
            scrollToBottom();

            // Focus first input
            const firstInput = form.querySelector('input, textarea');
            if (firstInput) firstInput.focus();

            form.querySelector('.form-submit').addEventListener('click', () => {
                const values = {};
                form.querySelectorAll('[data-key]').forEach(el => {
                    values[el.dataset.key] = el.value;
                });
                form.remove();
                resolve({ submitted: true, values });
            });

            form.querySelector('.form-skip').addEventListener('click', () => {
                form.remove();
                resolve({ submitted: false, values: {} });
            });
        });
    }

    // ─── SEND MESSAGE ───────────────────────────────────────────
    function makeTaskId() {
        return `task_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function showCancelTaskButton(taskId) {
        hideCancelTaskButton();
        const btn = document.createElement('button');
        btn.id = 'floatingCancelTaskBtn';
        btn.textContent = 'Cancel';
        btn.title = 'Stop the current Pecifics task';
        btn.style.cssText = [
            'position:fixed',
            'right:22px',
            'bottom:82px',
            'z-index:99999',
            'height:36px',
            'padding:0 14px',
            'border:0',
            'border-radius:8px',
            'background:#dc2626',
            'color:white',
            'font:700 13px Inter,Segoe UI,system-ui,sans-serif',
            'box-shadow:0 12px 30px rgba(0,0,0,.28)',
            'cursor:pointer'
        ].join(';');
        btn.addEventListener('click', () => requestTaskCancel(taskId));
        document.body.appendChild(btn);
    }

    function hideCancelTaskButton() {
        document.getElementById('floatingCancelTaskBtn')?.remove();
    }

    async function requestTaskCancel(taskId = currentTaskId) {
        await requestTaskCancel(currentTaskId);
        return;
        try { await window.electronAPI.stopExecution(); } catch (e) {}
        if (taskId) {
            try {
                await fetch(`${backendUrl}/cancel_task`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ task_id: taskId }),
                });
            } catch (e) {
                console.warn('[cancel] backend cancel failed:', e.message);
            }
        }
        hideCancelTaskButton();
        addMessage('Stopping current task...', 'ai');
        window.electronAPI.updateStatusHud?.({ status: 'ready', text: 'Cancelled' });
    }

    async function sendMessage(text, activationContext = null) {
        if (!text || isProcessing) return;
        isProcessing = true;
        shouldStop = false;
        currentTaskId = makeTaskId();
        currentActivationContext = activationContext || null;
        sendBtn.disabled = true;
        showCancelTaskButton(currentTaskId);
        window.electronAPI.updateStatusHud?.({ status: 'thinking', text: 'Routing' });

        addMessage(text, 'user');
        conversationHistory.push({ role: 'user', content: text });

        const thinkingEl = addThinking();
        showProgress('Routing command...', 5);

        // ── Groq Input Correction ────────────────────────────────────────────
        // Silently fix typos before routing. Show correction hint if changed.
        let processText = text;
        try {
            const corrResp = await fetch(`${backendUrl}/correct_input`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.trim() }),
                signal: AbortSignal.timeout(3000), // Fast timeout — don't slow UX
            });
            if (corrResp.ok) {
                const corrData = await corrResp.json();
                if (corrData.changed && corrData.corrected && corrData.corrected.trim()) {
                    processText = corrData.corrected.trim();
                    console.log(`[correction] "${text}" → "${processText}" (${corrData.method})`);
                    // Show a subtle correction hint in chat
                    addMessage(`✏️ _Understood as: "${processText}"_`, 'ai');
                }
            }
        } catch (corrErr) {
            // Correction is non-critical — proceed with original text
            console.log('[correction] skipped:', corrErr.message);
        }
        // ────────────────────────────────────────────────────────────────────

        try {
            const totalStart = perfNow();
            await window.electronAPI.resetStopFlag();

            // ── Conversational fast-path ─────────────────────────────────────
            // If it's a pure conversation (not a task), skip task planning entirely
            if (window.PecificsIntentRouter?.isConversationalQuery?.(processText)) {
                try {
                    const convResp = await fetch(`${backendUrl}/converse`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: processText,
                            conversation_history: conversationHistory.slice(-10),
                            session_id: sessionId,
                        }),
                    });
                    if (convResp.ok) {
                        const convData = await convResp.json();
                        removeThinking();
                        const answer = convData.answer || convData.message || 'I understand.';
                        addMessage(answer, 'ai');
                        conversationHistory.push({ role: 'assistant', content: answer });
                        finishProcessingUi();
                        return;
                    }
                } catch (convErr) {
                    console.warn('[converse] failed, falling through to planner:', convErr.message);
                }
            }
            // ────────────────────────────────────────────────────────────────

            const localPlan = window.PecificsIntentRouter?.buildPlan?.(processText);
            if (localPlan && Array.isArray(localPlan.tasks) && localPlan.tasks.length > 0) {
                console.log('[intent-router] Local fast plan:', localPlan);
                removeThinking();
                if (localPlan.message) {
                    addMessage(localPlan.message, 'ai');
                    conversationHistory.push({ role: 'assistant', content: localPlan.message });
                }
                renderTaskCards(localPlan.tasks);
                if (!(await confirmPlanIfNeeded(localPlan, localPlan.tasks))) {
                    addMessage('Cancelled before execution.', 'ai');
                    finishProcessingUi();
                    return;
                }
                await executeTasks(localPlan.tasks, localPlan.expected_result, processText);
                logTiming('sendMessage total (local plan)', totalStart);
                finishProcessingUi();
                return;
            }

            // Step 1: Protocol-aware planner. This is the preferred path for
            // known app/browser/system workflows because it returns executable
            // task graphs with protocol IDs and verification metadata.
            try {
                const protocolStart = perfNow();
                const protocolResp = await fetch(`${backendUrl}/plan_protocol`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: processText,
                        conversation_history: conversationHistory.slice(-10),
                        session_id: sessionId,
                        user_home: userHome,
                        app_state: currentActivationContext ? { activation_context: currentActivationContext } : null,
                    }),
                });
                logTiming('/plan_protocol', protocolStart);

                if (protocolResp.ok) {
                    const protocolPlan = await protocolResp.json();
                    if (protocolPlan && protocolPlan.session_id) {
                        sessionId = protocolPlan.session_id;
                        localStorage.setItem('pecificsSessionId', sessionId);
                    }

                    if (protocolPlan && protocolPlan.strategy === 'chat') {
                        console.log('[protocol-planner] Chat reply:', protocolPlan);
                        removeThinking();
                        const answer = protocolPlan.reply || protocolPlan.message || 'I understand.';
                        addMessage(answer, 'ai');
                        conversationHistory.push({ role: 'assistant', content: answer });
                        finishProcessingUi();
                        return;
                    }

                    const protocolTasks = protocolPlan.tasks || [];
                    const executableStrategy = ['protocol', 'recipe', 'dom', 'react'].includes(protocolPlan.strategy);
                    if (executableStrategy && protocolTasks.length > 0) {
                        console.log('[protocol-planner] Plan:', protocolPlan);
                        removeThinking();
                        if (protocolPlan.message) {
                            addMessage(protocolPlan.message, 'ai');
                            conversationHistory.push({ role: 'assistant', content: protocolPlan.message });
                        }
                        renderTaskCards(protocolTasks);
                        if (!(await confirmPlanIfNeeded(protocolPlan, protocolTasks))) {
                            addMessage('Cancelled before execution.', 'ai');
                            finishProcessingUi();
                            return;
                        }
                        await executeTasks(protocolTasks, protocolPlan.expected_result, processText);
                        logTiming('sendMessage total (protocol plan)', totalStart);
                        finishProcessingUi();
                        return;
                    }

                    if (protocolPlan.strategy === 'ask_user' && protocolTasks.length > 0) {
                        console.log('[protocol-planner] Needs user input:', protocolPlan);
                        removeThinking();
                        if (protocolPlan.message) addMessage(protocolPlan.message, 'ai');
                        renderTaskCards(protocolTasks);
                        if (!(await confirmPlanIfNeeded(protocolPlan, protocolTasks))) {
                            addMessage('Cancelled before execution.', 'ai');
                            finishProcessingUi();
                            return;
                        }
                        await executeTasks(protocolTasks, protocolPlan.expected_result, text);
                        logTiming('sendMessage total (protocol ask_user)', totalStart);
                        finishProcessingUi();
                        return;
                    }
                } else {
                    console.warn('[protocol-planner] HTTP failure:', protocolResp.status);
                }
            } catch (protocolErr) {
                console.warn('[protocol-planner] Falling back to /route:', protocolErr.message);
            }

            // Step 1: Call Intent Router (/route endpoint)
            const routeStart = perfNow();
            const routeResp = await fetch(`${backendUrl}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text })
            });
            logTiming('/route', routeStart);

            if (!routeResp.ok) {
                throw new Error(`Intent router failed: ${routeResp.status} ${routeResp.statusText}`);
            }

            const route = await routeResp.json();
            console.log('[intent-router] Classified Route:', route);

            removeThinking();
            showProgress(`Executing via ${route.engine} engine...`, 30);
            window.electronAPI.updateStatusHud?.({ status: 'executing', text: `Running ${route.engine.toUpperCase()}` });

            let result = null;
            let displayMsg = '';

            // Step 2: Engine Selector Switch
            switch (route.engine) {
                case 'system': {
                    console.log(`[renderer] Dispatching system direct operation: ${route.operation}`);
                    const r = await window.electronAPI.executeAction({ action: route.operation, params: route.params });
                    result = r;
                    displayMsg = r.success ? (r.message || r.result?.message || `Successfully executed system task: ${route.operation}`) : `System task failed: ${r.error || 'Unknown error'}`;
                    break;
                }
                case 'browser': {
                    console.log(`[renderer] Dispatching browser direct operation: ${route.operation}`);
                    const browserOperationAliases = {
                        play_video: 'play_video',
                        play: 'play_video',
                        watch: 'play_video',
                        youtube: 'youtube_search',
                    };
                    const browserOperation = browserOperationAliases[route.operation] || route.operation;
                    const r = await window.electronAPI.executeAction({ action: `browser_${browserOperation}`, params: route.params });
                    result = r;
                    displayMsg = r.success ? (r.message || r.result?.message || `Successfully executed browser task: ${browserOperation}`) : `Browser task failed: ${r.error || 'Unknown error'}`;
                    break;
                }
                case 'app': {
                    console.log(`[renderer] Dispatching app-specific driver: ${route.app_name} -> ${route.operation}`);
                    const r = await window.electronAPI.executeAction({ 
                        action: 'app_engine', 
                        params: { app: route.app_name, operation: route.operation, ...route.params } 
                    });
                    
                    if (r && r.fallback === 'vision') {
                        console.log(`[renderer] App engine requested vision fallback: ${r.reason}`);
                        showProgress('App driver falling back to vision loop...', 45);
                        const vResult = await executeVisionTask(text, 15);
                        result = vResult;
                        displayMsg = vResult.success ? `Successfully completed task via vision: ${text}` : `Vision task failed: ${vResult.reason}`;
                    } else {
                        result = r;
                        displayMsg = r.success ? (r.message || r.result?.message || `Successfully completed app action on ${route.app_name}`) : `App control failed: ${r.error || 'Unknown error'}`;
                    }
                    break;
                }
                case 'office': {
                    console.log(`[renderer] Dispatching Office action: ${route.operation}`);
                    const op = String(route.operation || '').toLowerCase();
                    const isPptGeneration = /(ppt|presentation|slides|deck)/i.test(op) || route.params?.topic || route.params?.title;
                    const action = isPptGeneration ? 'generate_ppt' : route.operation;
                    const params = isPptGeneration ? {
                        ...route.params,
                        topic: route.params?.topic || route.params?.title || route.params?.subject || 'Presentation',
                        title: route.params?.title || route.params?.topic || route.params?.subject || 'Presentation',
                    } : route.params;
                    const r = await window.electronAPI.executeAction({ action, params });
                    result = r;
                    displayMsg = r.success ? (r.message || r.result?.message || `Office action completed successfully`) : `Office action failed: ${r.error || 'Unknown error'}`;
                    break;
                }
                case 'vision': {
                    console.log('[renderer] Intent router requested vision execution');
                    showProgress('Initiating vision engine...', 30);
                    const vResult = await executeVisionTask(text, 15);
                    result = vResult;
                    displayMsg = vResult.success ? `Task completed successfully: ${text}` : `Vision task failed: ${vResult.reason}`;
                    break;
                }
                case 'compose': {
                    console.log('[renderer] Dispatching compose content request to planner');
                    // Fall back to planning endpoint for composition since it contains LLM generation capabilities
                    const chatStart = perfNow();
                    const chatResp = await fetch(`${backendUrl}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: text,
                            conversation_history: conversationHistory.slice(-10),
                            screen_width: screenWidth,
                            screen_height: screenHeight,
                            user_home: userHome,
                            session_id: sessionId,
                        }),
                    });
                    logTiming('/chat (compose)', chatStart);

                    if (!chatResp.ok) throw new Error(`Compose failed: ${chatResp.status}`);
                    const chatData = await chatResp.json();
                    if (chatData && chatData.session_id) {
                        sessionId = chatData.session_id;
                        localStorage.setItem('pecificsSessionId', sessionId);
                    }

                    result = chatData;
                    displayMsg = chatData.message || 'Draft composition ready.';
                    break;
                }
                default: {
                    // Fallback to legacy planner if routing is unknown
                    console.log('[renderer] Unknown routing category. Falling back to planner.');
                    const chatStart = perfNow();
                    const chatResp = await fetch(`${backendUrl}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: text,
                            conversation_history: conversationHistory.slice(-10),
                            screen_width: screenWidth,
                            screen_height: screenHeight,
                            user_home: userHome,
                            session_id: sessionId,
                        }),
                    });
                    logTiming('/chat (fallback planner)', chatStart);

                    if (!chatResp.ok) throw new Error(`Fallback planner failed: ${chatResp.status}`);
                    const chatData = await chatResp.json();
                    if (chatData && chatData.session_id) {
                        sessionId = chatData.session_id;
                        localStorage.setItem('pecificsSessionId', sessionId);
                    }

                    // Show AI message
                    if (chatData.message) {
                        addMessage(chatData.message, 'ai');
                        conversationHistory.push({ role: 'assistant', content: chatData.message });
                    }

                    const tasks = chatData.tasks || [];
                    if (tasks.length > 0) {
                        renderTaskCards(tasks);
                        if (!(await confirmPlanIfNeeded(chatData, tasks))) {
                            addMessage('Cancelled before execution.', 'ai');
                            result = chatData;
                            displayMsg = '';
                            break;
                        }
                        await executeTasks(tasks, chatData.expected_result, text);
                    }
                    result = chatData;
                    displayMsg = ''; // Already printed in loop or chatData.message
                    break;
                }
            }

            // Step 3: Print result
            if (displayMsg) {
                addMessage(displayMsg, 'ai');
                conversationHistory.push({ role: 'assistant', content: displayMsg });
            }

            logTiming('sendMessage total', totalStart);
            window.electronAPI.updateStatusHud?.({ status: 'ready', text: 'Ready' });

        } catch (err) {
            removeThinking();
            // 7.1: Translate top-level errors too
            const userFacingError = translateErrorToUserMessage(err.message, null);
            addMessage(`Error: ${userFacingError}`, 'ai');
            window.electronAPI.updateStatusHud?.({ status: 'error', text: 'Error' });
            console.error('Send error:', err);
        }

        hideProgress();
        isProcessing = false;
        currentTaskId = null;
        currentActivationContext = null;
        hideCancelTaskButton();
        sendBtn.disabled = false;
    }

    // 7.1: User-facing error translation — hides internal technical errors from the user
    function translateErrorToUserMessage(error, actionName) {
        const str = String(error || '').toLowerCase();
        const errorMap = [
            [/unknown google login state/i, 'Gmail is not logged in. Please log into Gmail in the Pecifics Chrome window, then try again.'],
            [/could not connect to chrome.*9222/i, 'Chrome is not connected. Restart Pecifics using start_all.bat.'],
            [/element not found|selector.*not found|no element.*found/i, 'The page layout changed and I could not find the right element. Will try a different approach.'],
            [/net::err_name_not_resolved|err_internet_disconnected/i, 'No internet connection or the website is unavailable.'],
            [/timeout|timed out/i, 'The page took too long to respond. Please check your internet connection.'],
            [/no amazon credentials/i, 'Say "save my Amazon account" to let me log in automatically next time.'],
            [/2fa_required|two.factor/i, 'Google is asking for two-factor authentication. Please complete it in the Chrome window, then say "continue".'],
            [/login_failed|login did not/i, 'Login did not succeed. Please log in manually in the Pecifics Chrome window.'],
            [/playwright.*not.*install/i, 'Browser automation is not set up. Say "install playwright" to enable it.'],
            [/could not open whatsapp/i, 'WhatsApp is not open. Please open WhatsApp Web or the app, then try again.'],
        ];
        for (const [pattern, message] of errorMap) {
            if (pattern.test(str)) return message;
        }
        // Generic fallback
        const taskName = actionName ? actionName.replace(/_/g, ' ') : 'this task';
        return `Something went wrong with ${taskName}. Try rephrasing the command or check if the app is open.`;
    }

    // 7.3: Full-content confirmation builder for messaging/email actions
    function buildConfirmationMessage(protocol_id, params, fallbackSummary) {
        if (protocol_id === 'whatsapp.send_message' || params?.contact) {
            const contact = params?.contact || params?.recipient || 'contact';
            const msg = params?.message || params?.text || '';
            return `💬 WhatsApp Message\nTo: ${contact}\nMessage: "${msg}"\n\nConfirm to send?`;
        }
        if (protocol_id === 'telegram.send_message') {
            const contact = params?.contact || params?.recipient || 'contact';
            const msg = params?.message || params?.text || '';
            return `✈️ Telegram Message\nTo: ${contact}\nMessage: "${msg}"\n\nConfirm to send?`;
        }
        if (protocol_id === 'gmail.compose' || params?.to) {
            const to = params?.to || 'recipient';
            const subject = params?.subject || '(no subject)';
            const body = params?.body ? params.body.slice(0, 200) : '(empty)';
            return `📧 Send Email\nTo: ${to}\nSubject: ${subject}\nBody: ${body}\n\nConfirm to send?`;
        }
        return fallbackSummary;
    }

    function finishProcessingUi() {
        window.electronAPI.updateStatusHud?.({ status: 'ready', text: 'Ready' });
        hideProgress();
        isProcessing = false;
        currentTaskId = null;
        currentActivationContext = null;
        hideCancelTaskButton();
        sendBtn.disabled = false;
    }

    function planNeedsConfirmation(plan, tasks = []) {
        if (plan?.requires_confirmation || plan?.requiresConfirmation) return true;
        return (tasks || []).some(task =>
            task.requires_confirmation || task.requiresConfirmation ||
            (task.actions || []).some(action => {
                const params = action.parameters || action.params || {};
                return params.requires_confirmation || params.requiresConfirmation;
            })
        );
    }

    function summarizePlanForConfirmation(plan, tasks = []) {
        const lines = [];
        const message = plan?.message || plan?.goal || '';
        if (message) lines.push(message);
        for (const task of tasks.slice(0, 4)) {
            const actions = (task.actions || []).map(action => {
                const name = action.name || action.action || 'action';
                const params = action.parameters || action.params || {};
                if (name === 'send_whatsapp_message') {
                    return `send WhatsApp message to ${params.contact || params.recipient || 'contact'}: "${params.message || params.text || ''}"`;
                }
                if (name === 'google_forms_fill') {
                    return `fill Google Form fields${params.submit ? ' and request submit' : ''}`;
                }
                return name;
            });
            lines.push(`Task ${task.id}: ${task.description || actions.join(', ')}`);
            if (actions.length) lines.push(`Action: ${actions.join(', ')}`);
        }
        return lines.filter(Boolean).join('\n');
    }

    // 9.2: Confirmation with 60-second auto-cancel timeout
    async function confirmPlanIfNeeded(plan, tasks = []) {
        if (!planNeedsConfirmation(plan, tasks)) return true;
        const summary = summarizePlanForConfirmation(plan, tasks);
        // Try to build full content confirmation
        const task = (tasks || [])[0];
        const action = (task?.actions || [])[0];
        const params = action?.parameters || action?.params || {};
        const fullMsg = buildConfirmationMessage(plan?.protocol_id || task?.protocol_id || '', params, summary);
        addMessage(`Confirmation required:\n${fullMsg}`, 'ai');
        await delay(50);
        // 9.2: Use a 60-second timed dialog
        const TIMEOUT_MS = 60000;
        let confirmed = false;
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(false), TIMEOUT_MS));
        const confirmPromise = Promise.resolve(window.confirm(`Pecifics wants confirmation before executing:\n\n${fullMsg}\n\nAuto-cancels in 60 seconds if no response.\n\nContinue?`));
        confirmed = await Promise.race([confirmPromise, timeoutPromise]);
        if (!confirmed) {
            addMessage('Confirmation timed out or cancelled. Task aborted.', 'ai');
        }
        return confirmed;
    }

    // ─── EXECUTE TASKS ──────────────────────────────────────────
    function applyTaskInputValues(task, values = {}) {
        const renderValue = (value) => {
            if (typeof value === 'string') {
                return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
                    return values[key] === undefined || values[key] === null ? '' : String(values[key]);
                });
            }
            if (Array.isArray(value)) return value.map(renderValue);
            if (value && typeof value === 'object') {
                return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, renderValue(val)]));
            }
            return value;
        };

        task.parameters = { ...(task.parameters || task.params || {}), ...values };
        task.actions = (task.actions || []).map(action => ({
            ...action,
            parameters: {
                ...renderValue(action.parameters || action.params || {}),
                ...values,
            },
        }));
        task.needs_input = false;
        return task;
    }

    function collectProtocolRunMeta(actionResults = []) {
        const blockersEncountered = new Set();
        const blockersResolved = new Set();
        const resolutionPath = new Set();
        const visit = (value) => {
            if (!value || typeof value !== 'object') return;
            const result = value.result && typeof value.result === 'object' ? value.result : value;
            for (const key of ['blockers_encountered', 'blockersEncountered']) {
                (Array.isArray(result[key]) ? result[key] : []).forEach(v => v && blockersEncountered.add(String(v)));
            }
            for (const key of ['blockers_resolved', 'blockersResolved']) {
                (Array.isArray(result[key]) ? result[key] : []).forEach(v => v && blockersResolved.add(String(v)));
            }
            for (const key of ['resolution_path', 'resolutionPath', 'fallback_path']) {
                (Array.isArray(result[key]) ? result[key] : []).forEach(v => v && resolutionPath.add(String(v)));
            }
            const blocker = result.blocker || result.error_class || result.step;
            if (blocker && /login|2fa|captcha|onboarding|paywall/i.test(String(blocker))) {
                blockersEncountered.add(String(blocker).replace(/^requires_/, ''));
            }
            if (result.login_result || result.recovery_result) visit(result.login_result || result.recovery_result);
        };
        actionResults.forEach(visit);
        return {
            blockers_encountered: Array.from(blockersEncountered),
            blockers_resolved: Array.from(blockersResolved),
            resolution_path: Array.from(resolutionPath),
        };
    }

    function sanitizeProtocolParameters(params = {}) {
        const clean = {};
        for (const [key, value] of Object.entries(params || {})) {
            if (/password|secret|token|credential|api[_-]?key/i.test(key)) continue;
            clean[key] = value;
        }
        return clean;
    }

    function sanitizeActionsForMemory(actions = []) {
        return (actions || []).map(action => ({
            ...action,
            parameters: sanitizeProtocolParameters(action.parameters || action.params || {}),
        }));
    }

    async function executeTasks(tasks, expectedResult, originalMessage) {
        const totalTasks = tasks.length;
        const taskContext = {
            completed: new Set(),
            failed: new Set(),
            skipped: new Set(),
            results: {},
        };

        const dependencyId = (task) => {
            const dep = task.dependsOn ?? task.depends_on ?? task.dependency ?? null;
            if (Array.isArray(dep)) {
                if (dep.length === 0) return null;
                const first = dep[0];
                const match = String(first).match(/\d+/);
                return match ? Number(match[0]) : first;
            }
            if (dep === null || dep === undefined || dep === '') return null;
            const match = String(dep).match(/\d+/);
            return match ? Number(match[0]) : dep;
        };

        for (let i = 0; i < tasks.length; i++) {
            if (shouldStop) {
                addMessage('⏹ Execution stopped by user.', 'ai');
                break;
            }

            const task = tasks[i];
            const dep = dependencyId(task);
            if (dep !== null && (!taskContext.completed.has(dep) || taskContext.failed.has(dep))) {
                const reason = taskContext.failed.has(dep) ? 'dependency failed' : 'dependency unavailable';
                updateTaskCard(task.id, 'error', `Skipped: ${reason}`);
                taskContext.skipped.add(task.id);
                addMessage(`Skipped task ${task.id}: ${reason} (${dep})`, 'ai');
                continue;
            }

            const pct = Math.round(((i) / totalTasks) * 100);
            showProgress(`Task ${task.id}/${totalTasks}: ${task.description}`, pct);
            updateTaskCard(task.id, 'running', 'Running...');

            // Handle needs_input tasks
            if (task.needs_input && task.input_fields && task.input_fields.length > 0) {
                updateTaskCard(task.id, 'running', 'Waiting for input...');
                const inputResult = await showInputForm(task);

                if (!inputResult.submitted) {
                    updateTaskCard(task.id, 'error', 'Skipped');
                    continue;
                }

                if (Array.isArray(task.actions) && task.actions.length > 0) {
                    applyTaskInputValues(task, inputResult.values);
                    updateTaskCard(task.id, 'running', 'Input received. Running...');
                } else {
                // Re-plan this task with user's input
                const inputDesc = Object.entries(inputResult.values)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ');

                try {
                    const resp = await fetch(`${backendUrl}/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: `${task.description}. User provided: ${inputDesc}`,
                            conversation_history: conversationHistory.slice(-6),
                            screen_width: screenWidth,
                            screen_height: screenHeight,
                            user_home: userHome,
                            user_choice: { type: 'input', value: inputResult.values },
                        }),
                    });
                    const reData = await resp.json();
                    // Replace task actions with new ones
                    const reTasks = reData.tasks || [];
                    if (reTasks.length > 0 && reTasks[0].actions) {
                        task.actions = reTasks[0].actions;
                        task.needs_input = false;
                    }
                } catch (e) {
                    console.error('Re-plan error:', e);
                    updateTaskCard(task.id, 'error', 'Re-plan failed');
                    continue;
                }
                }
            }

            // Execute task actions
            let taskSuccess = true;
            const actions = task.actions || [];
            const actionResults = [];
            const taskStartedAt = Date.now();

            for (let j = 0; j < actions.length; j++) {
                if (shouldStop) break;

                const action = actions[j];
                const actionName = action.name || action.action || 'unknown';
                const actionParams = action.parameters || action.params || {};
                const actionDesc = actionParams.goal || actionParams.description || actionName;

                showProgress(`Task ${task.id}: ${actionDesc}`, pct + Math.round(((j + 1) / actions.length) * (100 / totalTasks)));

                if (actionName === 'react_task') {
                    const result = await executeReactTask(
                        actionParams.goal || task.description || originalMessage,
                        actionParams.max_steps || actionParams.maxSteps || 10,
                        task.id
                    );
                    actionResults.push({ action: actionName, result });
                    if (!result.success) taskSuccess = false;

                } else if (actionName === 'vision_task') {
                    // Vision task — screenshot loop
                    const result = await executeVisionTask(
                        actionParams.goal || task.description,
                        actionParams.max_steps || 30,
                        task.id,
                        {
                            region: actionParams.region || actionParams.region_hint || actionParams.screenshot_region || null,
                        }
                    );
                    actionResults.push({ action: actionName, result });
                    if (!result.success) taskSuccess = false;

                } else if (actionName === 'generate_ppt') {
                    // PPT generation — route through action-executor so shell.openPath fires
                    const pptTopic = actionParams.topic || actionParams.title || task.description;
                    const item = addActionToTaskCard(task.id, `Creating PPT: ${pptTopic}`);
                    showProgress(`Generating presentation: ${pptTopic}...`, pct + 10);
                    try {
                        const result = await window.electronAPI.executeAction({
                            action: 'generate_ppt',
                            params: actionParams,
                        });
                        actionResults.push({ action: actionName, params: actionParams, result });
                        completeActionItem(item, result && result.success !== false);
                        if (result && result.success !== false) {
                            addMessage(`✅ Presentation created and opened:\n${result.path || ''}`, 'ai');
                        } else {
                            addMessage(`❌ PPT error: ${(result && result.error) || 'Unknown error'}`, 'ai');
                            taskSuccess = false;
                        }
                    } catch (e) {
                        completeActionItem(item, false);
                        addMessage(`❌ PPT error: ${e.message}`, 'ai');
                        taskSuccess = false;
                    }

                } else {
                    // Regular action — execute via Electron
                    const item = addActionToTaskCard(task.id, actionDesc);

                    if (previewMode) {
                        completeActionItem(item, true);
                        await delay(300);
                        continue;
                    }

                    try {
                        let result = await window.electronAPI.executeAction({
                            action: actionName,
                            params: actionParams,
                        });
                        if (result?.requiresConfirmation || result?.requires_confirmation) {
                            const preview = result.preview ? `\n\n${result.preview}` : '';
                            const confirmMessage = result.message || `Confirm ${actionName}`;
                            addMessage(`Confirmation required:\n${confirmMessage}${preview}`, 'ai');
                            const ok = window.confirm(`${confirmMessage}${preview ? `\n\n${preview}` : ''}\n\nContinue?`);
                            if (ok) {
                                const confirmedParams = {
                                    ...actionParams,
                                    confirmed: true,
                                    fields: result.generated_fields || actionParams.fields,
                                    answers: result.generated_fields || actionParams.answers,
                                };
                                result = await window.electronAPI.executeAction({
                                    action: actionName,
                                    params: confirmedParams,
                                });
                            }
                        }
                        actionResults.push({ action: actionName, result });
                        const success = result && result.success !== false;
                        completeActionItem(item, success);
                        if (!success) {
                            taskSuccess = false;
                            const detail = result?.error || result?.reason || result?.message || 'Unknown action failure';
                            // 7.1: Translate technical errors to user-friendly messages
                            const userMsg = translateErrorToUserMessage(detail, actionName);
                            addMessage(`Action failed: ${actionName.replace(/_/g, ' ')}\n${userMsg}`, 'ai');
                            console.warn(`[executeTasks] ${actionName} failed:`, result);
                        } else if (actionName === 'search_files' || actionName === 'search-files' || actionName === 'find_files') {
                            const found = result.files || result.results || [];
                            const lines = Array.isArray(found)
                                ? found.slice(0, 8).map(file => {
                                    const name = file.Name || file.name || 'Item';
                                    const filePath = file.Path || file.path || file.FullName || '';
                                    return `📄 ${name}${filePath ? `\n  ${filePath}` : ''}`;
                                  })
                                : [];
                            const openedMsg = result.opened ? `\n✅ Opened: ${result.opened}` : '';
                            addMessage(`${result.message || `Found ${lines.length} item(s).`}${lines.length ? `\n${lines.join('\n')}` : ''}${openedMsg}`, 'ai');
                        } else if (actionName === 'read_screen') {
                            // Show the AI vision answer
                            const answer = result.answer || result.text || result.message || 'Unable to read screen.';
                            addMessage(`👁️ **Screen Reading:**\n${answer}`, 'ai');
                        } else if (actionName === 'clipboard_action') {
                            const text = result.text || '';
                            const summary = result.summary || '';
                            const msg = result.message || '';
                            if (summary) {
                                addMessage(`📋 **Clipboard Summary:**\n${summary}`, 'ai');
                            } else if (text) {
                                addMessage(`📋 **Clipboard contents:**\n${text.slice(0, 1000)}${text.length > 1000 ? '\n...(truncated)' : ''}`, 'ai');
                            } else {
                                addMessage(`📋 ${msg || 'Clipboard is empty.'}`, 'ai');
                            }
                        } else if (actionName === 'get_system_info') {
                            const d = result;
                            const lines = [];
                            if (d.cpu_percent !== undefined) lines.push(`🖥️ CPU: ${d.cpu_percent}% (${d.cpu_cores} cores)`);
                            if (d.ram_used_gb !== undefined) lines.push(`💾 RAM: ${d.ram_used_gb}GB used / ${d.ram_total_gb}GB total (${d.ram_percent}% used)`);
                            if (d.battery_percent !== undefined) lines.push(`🔋 Battery: ${d.battery_percent}%${d.battery_charging ? ' ⚡ Charging' : ''}`);
                            if (d.disk_total_gb !== undefined) lines.push(`💿 Disk: ${d.disk_used_gb}GB used / ${d.disk_total_gb}GB total`);
                            addMessage(lines.length ? lines.join('\n') : result.message || 'System info retrieved.', 'ai');
                        }

                        // Small delay between actions
                        await delay(500);
                    } catch (e) {
                        completeActionItem(item, false);
                        taskSuccess = false;
                        console.error(`Action ${actionName} error:`, e);
                        addMessage(`Action error: ${actionName}\n${e.message}`, 'ai');
                    }
                }
            }

            taskContext.results[task.id] = actionResults;
            if (taskSuccess) taskContext.completed.add(task.id);
            else taskContext.failed.add(task.id);
            updateTaskCard(task.id, taskSuccess ? 'done' : 'error', taskSuccess ? 'Done' : 'Failed');

            const resultData = extractTaskResultData(task, actionResults, originalMessage);
            if (resultData) {
                await reportResultDataToBackend(resultData, originalMessage);
            }

            if (task.protocol_id) {
                try {
                    const lastFailed = actionResults.find(r => r.result && r.result.success === false);
                    const protocolMeta = collectProtocolRunMeta(actionResults);
                    await fetch(`${backendUrl}/store_protocol_run`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            command: originalMessage,
                            protocol_id: task.protocol_id,
                            success: taskSuccess,
                            task_id: task.id,
                            extracted_parameters: sanitizeProtocolParameters(task.parameters || task.params || {}),
                            step_results: actionResults,
                            fallback_path: task.fallbacks || [],
                            duration_ms: Date.now() - taskStartedAt,
                            blockers_encountered: protocolMeta.blockers_encountered,
                            blockers_resolved: protocolMeta.blockers_resolved,
                            resolution_path: protocolMeta.resolution_path,
                            error: lastFailed?.result?.error || lastFailed?.result?.reason || '',
                        }),
                    });
                } catch (e) {
                    console.warn('[executeTasks] protocol run store failed:', e.message);
                }
            }

            if (!taskSuccess && i < tasks.length - 1) {
                try {
                    const last = actionResults[actionResults.length - 1] || {};
                    const ssData = await window.electronAPI.takeScreenshot().catch(() => null);
                    const resp = await fetch(`${backendUrl}/next_step`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            original_task: originalMessage,
                            last_action: last.action ? { name: last.action } : {},
                            last_result: last.result || {},
                            screenshot: ssData?.screenshot || null,
                            remaining_actions: tasks.slice(i + 1),
                            completed_actions: Array.from(taskContext.completed).map(id => ({ id, result: taskContext.results[id] })),
                        }),
                    });
                    const correction = resp.ok ? await resp.json() : null;
                    if (correction?.decision === 'replace' && Array.isArray(correction.next_actions) && correction.next_actions.length > 0) {
                        tasks.splice(i + 1, tasks.length - i - 1, {
                            id: Math.max(...tasks.map(t => Number(t.id) || 0)) + 1,
                            description: correction.message || 'Recovery task',
                            needs_input: false,
                            input_fields: [],
                            actions: correction.next_actions,
                            dependsOn: null,
                            parallel: false,
                        });
                        renderTaskCards(tasks.slice(i + 1));
                    }
                } catch (e) {
                    console.warn('[executeTasks] replan-on-failure failed:', e.message);
                }
            }
        }

        // Final progress
        showProgress('All tasks complete', 100);

        // 7.4: Notify user via OS notification (fires even when minimized)
        const allSucceeded = taskContext.failed.size === 0 && taskContext.completed.size > 0;
        try {
            window.electronAPI.notifyTaskResult?.({
                task: originalMessage?.slice(0, 80) || 'Task',
                success: allSucceeded,
                detail: allSucceeded
                    ? `Completed ${taskContext.completed.size} task(s).`
                    : `${taskContext.failed.size} task(s) failed.`,
            });
        } catch { /* Notification not critical */ }

        if (originalMessage && taskContext.failed.size === 0 && taskContext.completed.size > 0) {
            try {
                const allActions = sanitizeActionsForMemory(tasks.flatMap(task => task.actions || []));
                await fetch(`${backendUrl}/store_recipe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        task: originalMessage,
                        actions: allActions,
                        result: { completed: Array.from(taskContext.completed), results: taskContext.results },
                    }),
                });
            } catch (e) {
                console.warn('[executeTasks] recipe store failed:', e.message);
            }
        }

        // Only verify browser/GUI tasks — collect action names from tasks first
        const _allVerifyActionNames = (tasks || []).flatMap(t => (t.actions || []).map(a => a.action || a.name || ''));
        const skipVerifyActions = new Set(['find_files', 'search_files', 'open_file', 'get_system_info',
            'clipboard_action', 'recall_memory', 'pdf_operation', 'calendar_operation',
            'read_screen', 'create_word_document', 'create_excel_spreadsheet']);
        const shouldSkipVerify = _allVerifyActionNames.some(n => skipVerifyActions.has(n));

        if (expectedResult && !shouldStop && taskContext.failed.size === 0 && !shouldSkipVerify) {
            await verifyCompletion(originalMessage, expectedResult);
        }

        setTimeout(hideProgress, 2000);
    }

    async function collectReactState() {
        let browser = null;
        try {
            browser = await window.electronAPI.executeAction({ action: 'browser_probe_state', params: {} });
        } catch (e) {
            browser = { success: false, error: e.message };
        }
        return {
            browser,
            recent_conversation: conversationHistory.slice(-6),
            activation_context: currentActivationContext,
            timestamp: new Date().toISOString(),
        };
    }

    async function executeReactAction(action, taskId) {
        const actionName = action.name || action.action || 'unknown';
        const actionParams = action.parameters || action.params || {};
        if (actionName === 'wait') {
            await delay(Math.max(0, Number(actionParams.ms || actionParams.seconds * 1000 || 1000)));
            return { success: true, message: 'Waited.' };
        }
        const item = addActionToTaskCard(taskId, actionParams.description || actionParams.goal || actionName);
        try {
            let result = await window.electronAPI.executeAction({ action: actionName, params: actionParams });
            if (result?.requiresConfirmation || result?.requires_confirmation) {
                const preview = result.preview ? `\n\n${result.preview}` : '';
                const confirmMessage = result.message || `Confirm ${actionName}`;
                addMessage(`Confirmation required:\n${confirmMessage}${preview}`, 'ai');
                const ok = window.confirm(`${confirmMessage}${preview ? `\n\n${preview}` : ''}\n\nContinue?`);
                if (!ok) {
                    completeActionItem(item, false);
                    return { success: false, error_class: 'user_cancelled', error: 'User cancelled confirmation.' };
                }
                result = await window.electronAPI.executeAction({
                    action: actionName,
                    params: { ...actionParams, confirmed: true, fields: result.generated_fields || actionParams.fields },
                });
            }
            completeActionItem(item, result && result.success !== false);
            return result;
        } catch (e) {
            completeActionItem(item, false);
            return { success: false, error: e.message };
        }
    }

    async function storeReactLearning(goal, history, success) {
        if (!goal || !Array.isArray(history) || history.length === 0) return null;
        try {
            const resp = await fetch(`${backendUrl}/learn_from_react_run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal,
                    history,
                    success: Boolean(success),
                    session_id: sessionId,
                }),
            });
            const data = resp.ok ? await resp.json() : null;
            if (data?.learned) {
                addMessage(`Learned a new protocol from this task: ${data.protocol_id}`, 'ai');
            } else if (data?.pending) {
                console.log('[react-learning] pending protocol candidate:', data);
            }
            return data;
        } catch (e) {
            console.warn('[react-learning] store failed:', e.message);
            return null;
        }
    }

    async function executeReactTask(goal, maxSteps = 10, taskId = 1) {
        const history = [];
        addMessage(`Adaptive execution started: ${goal}`, 'ai');
        for (let step = 1; step <= maxSteps && !shouldStop; step++) {
            showProgress(`Adaptive step ${step}/${maxSteps}`, Math.min(95, step * (100 / maxSteps)));
            const currentState = await collectReactState();
            let reactStep;
            try {
                const resp = await fetch(`${backendUrl}/react_next_step`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        goal,
                        step_num: step,
                        max_steps: maxSteps,
                        history,
                        current_state: currentState,
                        session_id: sessionId,
                    }),
                });
                reactStep = resp.ok ? await resp.json() : null;
            } catch (e) {
                return { success: false, reason: `ReAct planner failed: ${e.message}`, history };
            }

            if (!reactStep) return { success: false, reason: 'ReAct planner returned no step', history };
            const thought = reactStep.thought || reactStep.message || 'Thinking...';
            addActionToTaskCard(taskId, `Thought ${step}: ${thought}`);

            if (reactStep.stop === 'done') {
                addMessage(reactStep.message || 'Adaptive task complete.', 'ai');
                history.push({ step, thought, tool: reactStep.tool, stop: reactStep.stop, result: { success: true } });
                const learning = await storeReactLearning(goal, history, true);
                return { success: true, message: reactStep.message || 'Adaptive task complete.', history, learning };
            }
            if (reactStep.stop === 'need_user' || reactStep.stop === 'blocked' || reactStep.stop === 'failed') {
                const question = reactStep.message || reactStep.parameters?.question || thought;
                addMessage(`Adaptive task needs you:\n${question}`, 'ai');
                history.push({ step, thought, tool: reactStep.tool, stop: reactStep.stop, result: { success: false, needs_user: true } });
                await storeReactLearning(goal, history, false);
                return { success: false, needs_user: true, reason: question, history };
            }

            const actions = Array.isArray(reactStep.actions) ? reactStep.actions : [];
            if (!actions.length) {
                history.push({ step, thought, tool: reactStep.tool, result: { success: false, error: 'No executable actions returned.' } });
                await storeReactLearning(goal, history, false);
                return { success: false, reason: 'ReAct produced no executable action.', history };
            }

            const stepResults = [];
            let stepOk = true;
            for (const action of actions) {
                const result = await executeReactAction(action, taskId);
                stepResults.push({ action: action.name || action.action, result });
                if (!result || result.success === false) stepOk = false;
                await delay(250);
            }
            history.push({
                step,
                thought,
                tool: reactStep.tool,
                parameters: reactStep.parameters || {},
                actions,
                result: { success: stepOk, details: stepResults },
            });

            if (!stepOk && history.slice(-2).every(h => h.result && h.result.success === false)) {
                await storeReactLearning(goal, history, false);
                return { success: false, reason: 'Two adaptive steps failed in a row.', history };
            }
        }
        await storeReactLearning(goal, history, false);
        return { success: false, reason: 'Max adaptive steps reached.', history };
    }

    // ─── VISION TASK LOOP ───────────────────────────────────────
    async function executeVisionTask(goal, maxSteps = 15, taskId, options = {}) {
        const currentCogUrl = cogagentUrl.value.trim();
        const useDirect = !!currentCogUrl;          // direct CogAgent when URL is set
        let consecutiveErrors = 0;
        let stepCount = 0;
        const MAX_CONSECUTIVE_ERRORS = 3;
        const screenshotOptions = options && options.region ? { region: options.region } : {};

        if (!currentCogUrl) {
            console.warn('[vision] No CogAgent URL set! Go to Settings and paste your Kaggle ngrok URL.');
            addActionToTaskCard(taskId, '⚠️ No CogAgent URL set — open Settings and paste your Kaggle ngrok URL');
        } else {
            console.log('[vision] Using DIRECT CogAgent connection:', currentCogUrl);
        }

        const stepHistory = [];
        showVisionOverlay(goal);

        // Pre-fetch first screenshot immediately
        let nextScreenshotPromise = window.electronAPI.takeScreenshotHires(screenshotOptions);

        while (stepCount < maxSteps && !shouldStop) {
            stepCount++;
            const item = addActionToTaskCard(taskId, `Vision step ${stepCount}: analyzing screen...`);

            // PARALLEL: get screenshot (prefetched) + update UI status
            let screenshot;
            try {
                const ssData = await nextScreenshotPromise;
                if (!ssData || !ssData.screenshot) {
                    completeActionItem(item, false);
                    hideVisionOverlay();
                    return { success: false, reason: 'Screenshot failed' };
                }
                screenshot = ssData.screenshot;
                var activeRegion = ssData.region || null;
                var activeScreenWidth = ssData.width || screenWidth;
                var activeScreenHeight = ssData.height || screenHeight;
            } catch (err) {
                console.error('[vision] Pipelined screenshot prefetch failed:', err);
                completeActionItem(item, false);
                hideVisionOverlay();
                return { success: false, reason: `Prefetch screenshot error: ${err.message}` };
            }

            // Get next action from vision model
            let actionResponse;
            try {
                if (useDirect) {
                    actionResponse = await window.electronAPI.cogagentVisionAct({
                        screenshot,
                        goal,
                        step_history: stepHistory,
                        screen_width: activeScreenWidth,
                        screen_height: activeScreenHeight,
                    });
                } else {
                    const resp = await fetch(`${backendUrl}/vision_act`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            screenshot,
                            goal,
                            step_history: stepHistory,
                            screen_width: activeScreenWidth,
                            screen_height: activeScreenHeight,
                            cogagent_url: cogagentUrl.value.trim() || undefined,
                        }),
                    });

                    if (!resp.ok) {
                        completeActionItem(item, false);
                        continue;
                    }
                    actionResponse = await resp.json();
                }
                consecutiveErrors = 0;
            } catch (err) {
                console.error('[vision] Vision provider failed:', err);
                consecutiveErrors++;
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    completeActionItem(item, false);
                    hideVisionOverlay();
                    return { success: false, reason: `Aborted: 3 consecutive vision errors. Last: ${err.message}` };
                }
                // Prefetch next screenshot immediately even on error
                nextScreenshotPromise = window.electronAPI.takeScreenshotHires(screenshotOptions);
                completeActionItem(item, false);
                continue;
            }

            // Handle batched actions (array) or single action
            const actions = offsetVisionActions(actionResponse.actions || [actionResponse], activeRegion);
            const batchDesc = actionResponse.description || (actions[0] ? (actions[0].description || actions[0].action) : 'Executing');

            // Terminal states
            if (actions[0].action === 'done') {
                completeActionItem(item, true);
                item.querySelector('.action-icon').nextSibling.textContent = ` ✅ ${actions[0].description || 'Task complete'}`;
                stepHistory.push({ ...actions[0], success: true });
                hideVisionOverlay();
                return { success: true, steps: stepCount };
            }

            if (actions[0].action === 'fail') {
                const correction = await requestVisionCorrection(goal, actions[0], { success: false, reason: actions[0].description }, screenshot, stepHistory);
                if (correction?.decision === 'replace' && Array.isArray(correction.next_actions) && correction.next_actions.length > 0) {
                    updateVisionStep(correction.message || 'Trying alternate vision action');
                    const recovered = await executeBatchedVisionActions(correction.next_actions, goal);
                    completeActionItem(item, recovered);
                    stepHistory.push({ action: 'self_correction', next_actions: correction.next_actions, success: recovered });
                    nextScreenshotPromise = window.electronAPI.takeScreenshotHires(screenshotOptions);
                    if (recovered) continue;
                }
                completeActionItem(item, false);
                item.querySelector('.action-icon').nextSibling.textContent = ` ❌ ${actions[0].description || 'Cannot proceed'}`;
                stepHistory.push({ ...actions[0], success: false });
                hideVisionOverlay();
                return { success: false, reason: actions[0].description, steps: stepCount };
            }

            // Update step display
            updateVisionStep(`Step ${stepCount}: ${batchDesc}`);

            // Execute actions + SIMULTANEOUSLY start next screenshot pipeline
            const execPromise = executeBatchedVisionActions(actions, goal);

            // Start settle detection in parallel with execution
            const settlePromise = execPromise.then(() => waitForScreenSettle(800, 150));

            // Prefetch next screenshot after settle — runs in background
            nextScreenshotPromise = settlePromise.then(() => 
                window.electronAPI.takeScreenshotHires(screenshotOptions)
            );

            // Wait for execution to complete
            const finalSuccess = await execPromise;

            if (!finalSuccess) {
                const correction = await requestVisionCorrection(goal, actionResponse, { success: false }, screenshot, stepHistory);
                if (correction?.decision === 'replace' && Array.isArray(correction.next_actions) && correction.next_actions.length > 0) {
                    updateVisionStep(correction.message || 'Trying alternate vision action');
                    const recovered = await executeBatchedVisionActions(correction.next_actions, goal);
                    if (recovered) {
                        completeActionItem(item, true);
                        stepHistory.push({ action: 'self_correction', next_actions: correction.next_actions, success: true });
                        nextScreenshotPromise = window.electronAPI.takeScreenshotHires(screenshotOptions);
                        continue;
                    }
                }
            }

            completeActionItem(item, finalSuccess);
            item.querySelector('.action-icon').nextSibling.textContent = ` ${batchDesc}`;
            stepHistory.push({ ...actionResponse, success: finalSuccess });
        }

        hideVisionOverlay();
        return { success: false, reason: 'Max steps reached' };
    }

    async function requestVisionCorrection(goal, lastAction, lastResult, screenshot, stepHistory) {
        try {
            const resp = await fetch(`${backendUrl}/next_step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    original_task: goal,
                    last_action: lastAction || {},
                    last_result: lastResult || {},
                    screenshot,
                    remaining_actions: [],
                    completed_actions: stepHistory || [],
                }),
            });
            return resp.ok ? await resp.json() : null;
        } catch (e) {
            console.warn('[vision] self-correction request failed:', e.message);
            return null;
        }
    }

    function offsetVisionActions(actions, region) {
        if (!region || !Array.isArray(actions)) return actions;
        return actions.map(action => {
            if (!action || typeof action !== 'object') return action;
            const adjusted = { ...action, source_region: region };
            if (Number.isFinite(Number(adjusted.x))) adjusted.x = Math.round(Number(adjusted.x) + Number(region.x || 0));
            if (Number.isFinite(Number(adjusted.y))) adjusted.y = Math.round(Number(adjusted.y) + Number(region.y || 0));
            return adjusted;
        });
    }

    async function executeBatchedVisionActions(actions, windowTitle) {
        let batchSuccess = true;
        let pecificsHidden = false;
        try {
            await window.electronAPI.hideWindow();
            pecificsHidden = true;

            for (const action of actions) {
                if (shouldStop) break;
                if (action.action === 'wait') {
                    await delay(Math.min(action.ms || action.duration || 500, 2000));
                    continue;
                }
                
                // Focus target window before vision click/type
                const execResult = await window.electronAPI.executeAction({
                    action: 'vision_execute',
                    params: { 
                        ...action, 
                        windowTitle: action.windowTitle || windowTitle,
                        hidePecifics: true,
                        keepPecificsHidden: true
                    }
                });
                
                const success = execResult && execResult.success !== false;
                if (!success) {
                    batchSuccess = false;
                }
                await delay(80);  // tiny gap between batched actions
            }
        } finally {
            if (pecificsHidden) await window.electronAPI.showWindow();
        }
        return batchSuccess;
    }

    async function waitForScreenSettle(maxWaitMs = 800, intervalMs = 150) {
        const start = Date.now();
        let lastHash = null, stableCount = 0;
        
        while (Date.now() - start < maxWaitMs) {
            await delay(intervalMs);
            try {
                const snap = await window.electronAPI.takeScreenshot();
                const hash = quickHash(snap.screenshot.substring(200, 800));
                if (hash === lastHash) { 
                    stableCount++;
                    if (stableCount >= 2) return;  // stable for 2 checks = settled
                } else stableCount = 0;
                lastHash = hash;
            } catch { return; }
        }
    }

    function quickHash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h >>> 0;
    }

    // ─── VISION OVERLAY ─────────────────────────────────────────
    function showVisionOverlay(goal) {
        let overlay = $('.vision-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'vision-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = `
            <h4><div class="spinner-sm"></div> Vision Agent</h4>
            <div class="vision-step active">${escapeHtml(goal)}</div>`;
        overlay.classList.add('visible');
    }

    function updateVisionStep(text) {
        const overlay = $('.vision-overlay');
        if (!overlay) return;
        const step = document.createElement('div');
        step.className = 'vision-step active';
        step.textContent = text;
        // Keep only last 4 steps visible
        const steps = overlay.querySelectorAll('.vision-step');
        if (steps.length > 4) steps[0].remove();
        overlay.appendChild(step);
    }

    function hideVisionOverlay() {
        const overlay = $('.vision-overlay');
        if (overlay) overlay.classList.remove('visible');
    }

    // ─── VERIFY COMPLETION ──────────────────────────────────────
    async function verifyCompletion(task, expectedResult) {
        try {
            const ssData = await window.electronAPI.takeScreenshot();
            const screenshotB64 = ssData && ssData.screenshot ? ssData.screenshot : null;
            const resp = await fetch(`${backendUrl}/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ screenshot: screenshotB64, task, expected_result: expectedResult }),
            });
            const data = await resp.json();
            if (data.success) {
                addMessage(`✅ Verified: ${data.observation || 'Task completed successfully'}`, 'ai');
            } else if (data.should_retry) {
                addMessage(`⚠️ Verification: ${data.observation}. I can retry if needed.`, 'ai');
            }
        } catch (e) {
            console.warn('Verify error:', e);
        }
    }

    // ─── PROGRESS ───────────────────────────────────────────────
    function showProgress(text, pct = 0) {
        progressArea.classList.add('visible');
        progressText.textContent = text;
        progressFill.style.width = `${Math.min(pct, 100)}%`;
    }

    function hideProgress() {
        progressArea.classList.remove('visible');
        progressFill.style.width = '0%';
        progressText.textContent = 'Ready';
    }

    // ─── SETTINGS ───────────────────────────────────────────────
    function showSettings() {
        chatView.style.display = 'none';
        chatView.classList.remove('active');
        settingsView.style.display = 'flex';
        settingsView.classList.add('active');
    }

    function showChat() {
        settingsView.style.display = 'none';
        settingsView.classList.remove('active');
        chatView.style.display = 'flex';
        chatView.classList.add('active');
    }

    settingsBtn.addEventListener('click', () => showSettings());
    backBtn.addEventListener('click', () => showChat());

    testConnectionBtn.addEventListener('click', async () => {
        const url = colabUrl.value.trim() || 'http://localhost:8000';
        const cogUrl = cogagentUrl.value.trim();
        connectionStatus.textContent = 'Testing...';
        connectionStatus.className = 'conn-status';
        connectionStatus.style.display = 'block';

        const results = [];

        // Test LangChain backend
        try {
            const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
            if (resp.ok) {
                const data = await resp.json();
                results.push(`✓ LLM Backend — ${data.llm}`);
            } else {
                results.push(`✗ LLM Backend — HTTP ${resp.status}`);
            }
        } catch (e) {
            results.push(`✗ LLM Backend — cannot reach ${url}`);
        }

        // Test CogAgent direct
        if (cogUrl) {
            try {
                const cogHealth = await window.electronAPI.cogagentHealth();
                if (cogHealth.ok) {
                    results.push(`✓ CogAgent — ${cogHealth.data.model || 'connected'}`);
                } else {
                    results.push(`✗ CogAgent — ${cogHealth.error}`);
                }
            } catch (e) {
                results.push(`✗ CogAgent — ${e.message}`);
            }
        } else {
            results.push('⚠ CogAgent — no URL set');
        }

        const allOk = results.every(r => r.startsWith('✓'));
        connectionStatus.textContent = results.join('  |  ');
        connectionStatus.className = `conn-status ${allOk ? 'ok' : 'fail'}`;
    });

    saveSettingsBtn.addEventListener('click', async () => {
        const settings = {
            colabUrl: colabUrl.value.trim() || 'http://localhost:8000',
            cogagentUrl: cogagentUrl.value.trim(),
            screenshotInterval: parseInt($('#screenshotInterval').value) || 1000,
            screenshotQuality: parseInt(qualityRange.value) || 80,
            autoCapture: $('#autoCaptureToggle').checked,
            alwaysOnTop: $('#alwaysOnTop').checked,
        };
        backendUrl = settings.colabUrl;
        await window.electronAPI.saveSettings(settings);
        window.electronAPI.toggleAlwaysOnTop(settings.alwaysOnTop);

        // Push CogAgent URL to backend so it persists in memory
        if (settings.cogagentUrl) {
            try {
                await fetch(`${backendUrl}/set_config`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cogagent_url: settings.cogagentUrl }),
                });
            } catch(e) { console.warn('Could not push config to backend:', e); }
        }
        checkBackendConnection();

        // Flash save button
        saveSettingsBtn.textContent = 'Saved ✓';
        setTimeout(() => { saveSettingsBtn.textContent = 'Save Settings'; }, 1500);
    });

    qualityRange.addEventListener('input', () => {
        qualityValue.textContent = `${qualityRange.value}%`;
    });

    // ─── WINDOW CONTROLS ────────────────────────────────────────
    minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());

    // ─── INPUT ──────────────────────────────────────────────────
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const text = messageInput.value.trim();
            if (text && !isProcessing) {
                messageInput.value = '';
                messageInput.style.height = 'auto';
                sendMessage(text);
            }
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    });

    sendBtn.addEventListener('click', () => {
        const text = messageInput.value.trim();
        if (text && !isProcessing) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
            sendMessage(text);
        }
    });

    stopBtn.addEventListener('click', async () => {
        shouldStop = true;
        try { await window.electronAPI.stopExecution(); } catch (e) {}
        addMessage('⏹ Stopping...', 'ai');
    });

    // Preview toggle
    previewToggle.addEventListener('change', () => {
        previewMode = previewToggle.checked;
        modeLabel.textContent = previewMode ? 'Preview Mode' : 'Live Mode';
    });

    // Quick action buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prompt = btn.dataset.prompt;
            if (prompt && !isProcessing) {
                sendMessage(prompt);
            }
        });
    });

    // Show settings from system event
    window.electronAPI.onShowSettings(() => {
        showSettings();
    });

    window.electronAPI.onExternalCommand((payload) => {
        const command = String(typeof payload === 'string' ? payload : payload?.command || '').trim();
        const context = (payload && typeof payload === 'object') ? payload.context : null;
        if (!command) return;
        if (isProcessing) {
            messageInput.value = command;
            messageInput.focus();
            return;
        }
        sendMessage(command, context);
    });

    window.electronAPI.onCancelCurrentTask?.(() => {
        if (isProcessing) requestTaskCancel(currentTaskId);
    });

    // ─── HELPERS ────────────────────────────────────────────────
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
        });
    }

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    // ─── BOOT ───────────────────────────────────────────────────
    init();

})();
