const fs = require('fs');
const path = require('path');

const PROTOCOLS_DIR = path.join(__dirname, '..', '..', '..', 'protocols');

let cache = null;

function loadProtocols(force = false) {
    if (cache && !force) return cache;
    const protocols = {};
    if (!fs.existsSync(PROTOCOLS_DIR)) {
        cache = protocols;
        return protocols;
    }

    for (const file of fs.readdirSync(PROTOCOLS_DIR)) {
        if (!file.endsWith('.json')) continue;
        const fullPath = path.join(PROTOCOLS_DIR, file);
        try {
            const protocol = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            const id = protocol.id || path.basename(file, '.json');
            if (!id || !Array.isArray(protocol.steps)) continue;
            protocols[id] = { ...protocol, id, _path: fullPath };
        } catch (err) {
            console.warn(`[protocol-registry] Could not load ${fullPath}: ${err.message}`);
        }
    }

    cache = protocols;
    return protocols;
}

function listProtocols() {
    return Object.values(loadProtocols()).map(p => ({
        id: p.id,
        domain: p.domain,
        capability: p.capability,
        description: p.description,
        risk: p.risk || 'low',
        requires_confirmation: !!p.requires_confirmation,
        parameters: p.parameters || {},
        fallbacks: p.fallbacks || [],
    }));
}

function renderTemplate(value, params = {}) {
    if (typeof value === 'string') {
        const full = value.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
        if (full) return params[full[1]];
        return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
            const replacement = params[key];
            return replacement === undefined || replacement === null ? '' : String(replacement);
        });
    }
    if (Array.isArray(value)) return value.map(v => renderTemplate(v, params));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderTemplate(v, params)]));
    }
    return value;
}

function actionsForProtocol(protocolId, params = {}) {
    const protocol = loadProtocols()[protocolId];
    if (!protocol) {
        return { success: false, error: `Unknown protocol: ${protocolId}`, actions: [] };
    }
    const actions = protocol.steps
        .map(step => ({
            name: step.action || step.primitive,
            parameters: renderTemplate(step.parameters || {}, params),
            protocol_step_id: step.id,
            primitive: step.primitive,
        }))
        .filter(action => action.name);
    return { success: true, protocol, actions };
}

async function executeProtocol(protocolId, params = {}, executeAction) {
    const expanded = actionsForProtocol(protocolId, params);
    if (!expanded.success) return expanded;
    if (typeof executeAction !== 'function') {
        return { success: false, error: 'executeAction callback is required' };
    }

    const stepResults = [];
    for (const action of expanded.actions) {
        const started = Date.now();
        const result = await executeAction(action.name, action.parameters);
        const ok = result && result.success !== false;
        stepResults.push({
            action: action.name,
            protocol_step_id: action.protocol_step_id,
            success: ok,
            duration_ms: Date.now() - started,
            result,
        });
        if (!ok) {
            return {
                success: false,
                error: result?.error || result?.reason || `Protocol step failed: ${action.name}`,
                protocol_id: protocolId,
                failed_step: action.protocol_step_id,
                stepResults,
            };
        }
    }

    return {
        success: true,
        message: `Protocol completed: ${protocolId}`,
        protocol_id: protocolId,
        stepResults,
    };
}

module.exports = {
    PROTOCOLS_DIR,
    loadProtocols,
    listProtocols,
    actionsForProtocol,
    executeProtocol,
};
