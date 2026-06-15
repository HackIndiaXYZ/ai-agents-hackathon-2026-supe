// ============================================================
// Pecifics Browser Automation Module
// Uses Playwright (Node.js) for reliable browser control
// Falls back to keyboard/mouse Control if Playwright unavailable
// ============================================================

const { exec, execFile, spawn } = require('child_process');
const path = require('path');
const os   = require('os');
const fsSync = require('fs');
const http = require('http');
const https = require('https');
const systemManager = require('./system-manager');
const screenAgent = require('./screen-agent');

let playwright = null;
let chromium   = null;
let browser    = null;
let page       = null;
let persistentCtx = null;  // persistent browser context (cookies/logins survive)
let playwrightAvailable = false;
let browserMode = 'none';

// Persistent profile directory — logins & cookies survive across sessions
const BROWSER_DATA_DIR = path.join(os.homedir(), '.jarvis-browser-data');

// Dedicated Pecifics Chrome profile. The user logs into Google here once, then CDP works reliably.
const CHROME_USER_DATA = process.env.PECIFICS_CHROME_USER_DATA ||
    path.join(os.homedir(), 'AppData', 'Local', 'Pecifics', 'ChromeProfile');
const CDP_PORT = Number(process.env.PECIFICS_CHROME_CDP_PORT || 9222);
const LEGACY_CDP_PORT = 9223;
const CHROME_PROFILE_DIRECTORY = process.env.PECIFICS_CHROME_PROFILE || 'Default';

// Try to load Playwright at startup
(async () => {
    try {
        const pw = require('playwright');
        playwright = pw;
        chromium   = pw.chromium;
        playwrightAvailable = true;
        console.log('✅ Playwright loaded – rich browser automation available');
    } catch (e) {
        console.warn('⚠️  Playwright not installed. Browser automation will use keyboard/mouse fallback.');
        console.warn('    To enable: cd jarvis-desktop && npm install playwright && npx playwright install chromium');
    }
})();

// ─────────────────────────────────────────────────────────────
// PowerShell helper
// ─────────────────────────────────────────────────────────────
function ps(script) {
    return new Promise((resolve) => {
        exec(
            `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
            { maxBuffer: 1024 * 1024 * 5, timeout: 30000 },
            (err, stdout, stderr) => {
                const out = (stdout || '').trim();
                resolve({ success: !err || !!out, output: out, error: err ? err.message : null });
            }
        );
    });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// 5.4: Per-action timeouts based on expected duration
const ACTION_TIMEOUTS = {
    navigate: 15000,
    wait_for_selector: 8000,
    gamma_generate: 45000,      // AI generation is slow
    gmail_compose_open: 12000,  // Gmail compose can be slow
    form_submit: 10000,
    click: 5000,
    fill: 3000,
    wait_ready: 8000,
};

// 5.1: Fallback selector chain helper — never rely on a single selector
async function findElement(p, selectorChain, description, timeout = 5000) {
    for (const selector of selectorChain) {
        try {
            const el = await p.$(selector);
            if (el && await el.isVisible()) {
                return el;
            }
        } catch {
            continue;
        }
    }
    throw new Error(
        `Could not find ${description}. Tried: ${selectorChain.slice(0, 3).join(', ')}`
    );
}

function backendBaseUrl() {
    return String(process.env.PECIFICS_BACKEND_URL || process.env.COLAB_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
}

function postBackendJson(endpoint, payload, timeout = 45000) {
    return new Promise((resolve, reject) => {
        const base = backendBaseUrl();
        const target = new URL(endpoint.startsWith('http') ? endpoint : `${base}${endpoint}`);
        const body = JSON.stringify(payload || {});
        const client = target.protocol === 'https:' ? https : http;
        const req = client.request({
            method: 'POST',
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
            timeout,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data || '{}'));
                } catch (e) {
                    reject(new Error(`Backend returned non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy(new Error(`Backend request timed out after ${timeout}ms`));
        });
        req.write(body);
        req.end();
    });
}

function runPowerShell(script, timeout = 15000) {
    return new Promise((resolve) => {
        execFile('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script,
        ], { timeout, windowsHide: true, maxBuffer: 1024 * 1024 * 4 }, (err, stdout, stderr) => {
            resolve({
                success: !err,
                output: (stdout || '').trim(),
                error: err ? ((stderr || '').trim() || err.message) : null,
            });
        });
    });
}

function shellOpenUrl(url) {
    return new Promise((resolve) => {
        const safeUrl = String(url || '').replace(/"/g, '%22');
        exec(`start "" "${safeUrl}"`, (err) => {
            resolve({ success: !err, error: err ? err.message : null });
        });
    });
}

function findChromeExecutable() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    return candidates.find(candidate => fsSync.existsSync(candidate)) || null;
}

async function disconnectBrowserSession() {
    try {
        if (browserMode === 'cdp-user-chrome' && browser && typeof browser.disconnect === 'function') {
            browser.disconnect();
        } else if (browserMode === 'cdp-user-chrome' && browser) {
            await browser.close();
        } else if (browserMode === 'persistent-playwright' && persistentCtx) {
            await persistentCtx.close();
        } else if (browser && typeof browser.close === 'function') {
            await browser.close();
        }
    } catch {}
    browser = null;
    persistentCtx = null;
    page = null;
    browserMode = 'none';
}

async function connectToChromePort(port) {
    const connected = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const contexts = connected.contexts();
    const ctx = contexts[0] || await connected.newContext({ viewport: null });
    const pages = ctx.pages();
    browser = connected;
    persistentCtx = ctx;
    // 5.2: Use the most recently active page (last in list), not first
    const activePage = pages.filter(p => !p.isClosed() && !/^chrome:\/\//i.test(p.url()));
    page = activePage[activePage.length - 1] || pages[pages.length - 1] || await ctx.newPage();
    browserMode = 'cdp-user-chrome';
    console.log(`[browser-automation] Connected to user Chrome on CDP port ${port}`);
    return { browser, page };
}

async function tryConnectToUserChrome() {
    const ports = [...new Set([CDP_PORT, LEGACY_CDP_PORT])];
    for (const port of ports) {
        try {
            return await connectToChromePort(port);
        } catch {}
    }
    return null;
}

async function launchUserChromeWithDebug() {
    const chromeExe = findChromeExecutable();
    if (!chromeExe) {
        throw new Error('Google Chrome was not found on this system.');
    }
    fsSync.mkdirSync(CHROME_USER_DATA, { recursive: true });

    const args = [
        `--remote-debugging-port=${CDP_PORT}`,
        `--user-data-dir=${CHROME_USER_DATA}`,
        `--profile-directory=${CHROME_PROFILE_DIRECTORY}`,
        '--no-startup-window',
        '--no-first-run',
        '--no-default-browser-check',
    ];

    const chromeProcess = spawn(chromeExe, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
    });
    chromeProcess.unref();
    console.log(`[browser-automation] Launched user Chrome profile "${CHROME_PROFILE_DIRECTORY}" on CDP port ${CDP_PORT}`);
}

async function connectToUserChrome() {
    const existing = await tryConnectToUserChrome();
    if (existing) return existing;

    await launchUserChromeWithDebug();
    for (let i = 0; i < 20; i++) {
        await delay(500);
        const connected = await tryConnectToUserChrome();
        if (connected) return connected;
    }

    throw new Error(
        `Could not connect to your real Chrome on port ${CDP_PORT}. Close all Chrome windows, then restart Pecifics so Chrome starts with remote debugging.`
    );
}

async function fetchText(url, timeoutMs = 12000) {
    const https = require('https');
    return await new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                fetchText(new URL(res.headers.location, url).toString(), timeoutMs).then(resolve, reject);
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Timed out fetching ${url}`));
        });
    });
}

async function resolveYouTubeWatchUrl(query) {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query || '')}`;
    const html = await fetchText(searchUrl);
    const seen = new Set();
    const matches = html.matchAll(/(?:\/watch\?v=|watchEndpoint":\{"videoId":")([a-zA-Z0-9_-]{11})/g);
    for (const match of matches) {
        const id = match[1];
        if (!seen.has(id)) {
            seen.add(id);
            return `https://www.youtube.com/watch?v=${id}&autoplay=1`;
        }
    }
    throw new Error('No playable YouTube video found in search results');
}

// ─────────────────────────────────────────────────────────────
// Playwright session management
// ─────────────────────────────────────────────────────────────

async function ensureBrowser(browserName = 'chromium') {
    if (!playwrightAvailable) throw new Error('Playwright not available');

    // Already have a live session?
    if (browser && page && !page.isClosed()) {
        return { browser, page };
    }

    // Clean up stale session
    if (browser) {
        await disconnectBrowserSession();
    }

    const chromeState = await systemManager.ensureChromeWithDebugPort();
    if (chromeState && chromeState.status === 'needs_relaunch') {
        const err = new Error(chromeState.userMessage || 'Chrome needs to be relaunched with remote debugging.');
        err.code = 'CHROME_NEEDS_RELAUNCH';
        err.chromeState = chromeState;
        throw err;
    }
    if (chromeState && chromeState.success === false) {
        const err = new Error(chromeState.error || chromeState.userMessage || 'Chrome is not ready for browser automation.');
        err.code = chromeState.status || 'CHROME_NOT_READY';
        err.chromeState = chromeState;
        throw err;
    }

    try {
        // 3.4: CDP reconnection guard — check if browser session is still alive
        if (browser && page) {
            try {
                // Quick health check: if this succeeds, session is alive
                if (!page.isClosed()) {
                    return { browser, page };
                }
            } catch (healthErr) {
                console.warn('[browser-automation] CDP session dropped, reconnecting...', healthErr.message);
                await disconnectBrowserSession().catch(() => {});
                browser = null;
                page = null;
                persistentCtx = null;
            }
        }
        return await connectToUserChrome();
    } catch (e) {
        const allowFallback = String(process.env.PECIFICS_ALLOW_PLAYWRIGHT_FALLBACK || '').toLowerCase() === 'true';
        if (!allowFallback) {
            throw e;
        }
        console.warn(`[browser-automation] User Chrome unavailable: ${e.message}`);
        console.warn('[browser-automation] Falling back to isolated Playwright only because PECIFICS_ALLOW_PLAYWRIGHT_FALLBACK=true');
    }

    // ═══════════════════════════════════════════════════════════════
    // STRATEGY: Launch the user's REAL Chrome with remote-debugging
    // so Playwright can control it WITH all logged-in accounts.
    // ═══════════════════════════════════════════════════════════════

    // 1. Try connecting to an existing Chrome that's already in debug mode
    try {
        const cdpUrl = `http://127.0.0.1:${CDP_PORT}`;
        browser = await chromium.connectOverCDP(cdpUrl);
        const contexts = browser.contexts();
        const ctx = contexts[0] || await browser.newContext({ viewport: null });
        persistentCtx = ctx;
        page = ctx.pages()[0] || await ctx.newPage();
        console.log('✅ Connected to existing Chrome (all your accounts are available)');
        return { browser, page };
    } catch {
        // No Chrome with debug port running — we'll launch one
    }

    // 2. Do not kill the user's normal Chrome session. If fallback mode is
    // enabled, launch an isolated browser instead of closing their tabs.

    // 3. Launch Chrome with the REAL user profile + remote debugging
    const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ];
    let chromeExe = null;
    for (const p of chromePaths) {
        if (fsSync.existsSync(p)) { chromeExe = p; break; }
    }

    if (chromeExe && fsSync.existsSync(CHROME_USER_DATA)) {
        try {
            const { spawn: spawnProc } = require('child_process');
            const chromeArgs = [
                `--remote-debugging-port=${CDP_PORT}`,
                `--user-data-dir=${CHROME_USER_DATA}`,
                '--restore-last-session',
                '--no-first-run',
                '--no-default-browser-check',
                '--start-maximized',
            ];
            const chromeProcess = spawnProc(chromeExe, chromeArgs, {
                detached: true, stdio: 'ignore',
            });
            chromeProcess.unref();
            console.log(`🚀 Launched Chrome with your profile on debug port ${CDP_PORT}`);

            // Wait for Chrome to start accepting connections
            for (let i = 0; i < 20; i++) {
                await delay(800);
                try {
                    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
                    const contexts = browser.contexts();
                    const ctx = contexts[0] || await browser.newContext({ viewport: null });
                    persistentCtx = ctx;
                    page = ctx.pages()[0] || await ctx.newPage();
                    console.log('✅ Connected to YOUR Chrome (all logged-in accounts available)');
                    return { browser, page };
                } catch {
                    // Chrome not ready yet, retry
                }
            }
        } catch (e) {
            console.warn('Chrome CDP launch failed:', e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // FALLBACK: Use Playwright's bundled Chromium with persistent ctx
    // (won't have your Google accounts, but at least works)
    // ═══════════════════════════════════════════════════════════════
    console.warn('⚠️ Falling back to Playwright Chromium (won\'t have your logged-in accounts)');

    if (!fsSync.existsSync(BROWSER_DATA_DIR)) {
        fsSync.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
    }

    const launchOpts = {
        headless: false,
        viewport: null,
        args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
        ],
    };

    try {
        persistentCtx = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
            ...launchOpts,
            channel: 'chrome',
        });
        browser = persistentCtx;
        browserMode = 'persistent-playwright';
        page = persistentCtx.pages()[0] || await persistentCtx.newPage();
        return { browser, page };
    } catch {
        persistentCtx = await chromium.launchPersistentContext(BROWSER_DATA_DIR, launchOpts);
        browser = persistentCtx;
        browserMode = 'persistent-playwright';
        page = persistentCtx.pages()[0] || await persistentCtx.newPage();
        return { browser, page };
    }
}

async function getOrCreatePage() {
    if (!playwrightAvailable) return null;
    try {
        if (page && !page.isClosed()) return page;
        if (persistentCtx) {
            const pages = persistentCtx.pages ? persistentCtx.pages() : [];
            if (pages.length > 0) { page = pages[pages.length - 1]; return page; }
            page = await persistentCtx.newPage();
            return page;
        }
        return (await ensureBrowser()).page;
    } catch (e) {
        console.error('Browser session error:', e.message);
        return null;
    }
}

/**
 * Find an existing browser tab whose URL contains the given substring.
 * Returns the page if found, or null.
 */
function findTabByUrl(urlSubstring) {
    if (!persistentCtx) return null;
    const pages = persistentCtx.pages ? persistentCtx.pages() : [];
    for (const p of pages) {
        try {
            if (p.url().includes(urlSubstring)) return p;
        } catch {}
    }
    return null;
}

/**
 * Get an existing tab matching urlSubstring, or navigate the current page.
 * Avoids opening new tabs when one already exists.
 */
async function getOrNavigateTo(urlSubstring, fullUrl) {
    // First check if an existing tab already has this site open
    const existing = findTabByUrl(urlSubstring);
    if (existing) {
        page = existing;
        await existing.bringToFront().catch(() => {});
        if (fullUrl) {
            const currentUrl = existing.url();
            if (currentUrl !== fullUrl) {
                await existing.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            }
        }
        return existing;
    }
    // Otherwise navigate the current page (no new tab)
    const p = await getOrCreatePage();
    if (p) {
        await p.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    return p;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

class BrowserAutomation {

    /**
     * Open a URL in a specific browser.
     * Uses Playwright if available, otherwise falls back to shell open.
     */
    async open(url, browserName = 'chrome') {
        if (playwrightAvailable) {
            try {
                await ensureBrowser(browserName);
                // Try to reuse an existing tab for this domain
                const domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname;
                const p = await getOrNavigateTo(domain, url);
                const title = await p.title();
                return { success: true, message: `Opened: ${url}`, title };
            } catch (e) {
                console.warn('Playwright open failed, using shell fallback:', e.message);
            }
        }
        // Fallback: open with OS default
        return new Promise((resolve) => {
            exec(`start "" "${url}"`, (err) => {
                resolve({ success: !err, message: err ? err.message : `Opened ${url} in browser` });
            });
        });
    }

    /**
     * Navigate the current tab to a URL.
     */
    async navigate(url) {
        if (!url.startsWith('http')) url = 'https://' + url;
        try {
            await ensureBrowser();
            const domain = new URL(url).hostname;
            const p = await getOrNavigateTo(domain, url);
            if (p) {
                const title = await p.title();
                return { success: true, message: `Navigated to: ${url}`, title, url, automationAvailable: true };
            }
            throw new Error("Could not find or create page in Playwright browser");
        } catch (cdpErr) {
            console.log(`[Navigate] CDP/Playwright unavailable (${cdpErr.message}) — opening in default browser`);
            try {
                const { shell } = require('electron');
                await shell.openExternal(url);
            } catch (openErr) {
                const { exec } = require('child_process');
                exec(`start "" "${url}"`);
            }
            return {
                success: true,
                message: `Opened ${url} in your default browser.`,
                automationAvailable: false,
                url,
                note: "I can't automate clicks or typing here since this opened outside the Pecifics Chrome window. Say 'reopen in Pecifics Chrome' if you need me to interact with the page."
            };
        }
    }

    async navigateAndLogin(params = {}) {
        const url = String(params.url || '').trim();
        if (!url) return { success: false, error_class: 'missing_url', error: 'No URL was provided.' };
        const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        const loginRequested = params.login === true || String(params.login).toLowerCase() === 'true';
        const method = params.login_method || params.loginMethod || 'site_default';

        try {
            await ensureBrowser();
            const domain = new URL(finalUrl).hostname;
            const p = await getOrNavigateTo(domain, finalUrl);
            if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open.' };
            await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            await p.bringToFront().catch(() => {});
            const title = await p.title().catch(() => '');

            if (!loginRequested) {
                return { success: true, message: `Opened: ${finalUrl}`, url: p.url(), title, automationAvailable: true };
            }

            const current = p.url();
            let loginResult;
            if (/amazon\./i.test(current) || /amazon\./i.test(finalUrl)) {
                loginResult = await this.loginAmazon(p, method, params);
            } else if (/google\.|gmail\.|gamma\.app/i.test(current) || /google\.|gmail\.|gamma\.app/i.test(finalUrl)) {
                loginResult = await this.handleGoogleOAuth(p, { ...params, app: params.site || domain });
            } else {
                loginResult = await this.handleLoginBlocker(p, {}, { ...params, app: params.site || domain, login_method: method });
            }

            if (loginResult?.success) {
                return {
                    success: true,
                    message: `Opened ${finalUrl} and login is ready.`,
                    url: p.url(),
                    title: await p.title().catch(() => title),
                    login_result: loginResult,
                    automationAvailable: true
                };
            }
            return {
                success: false,
                error_class: loginResult?.error_class || loginResult?.reason || 'login_not_completed',
                error: loginResult?.error || loginResult?.userMessage || 'Login could not be completed automatically.',
                needs_user: loginResult?.needs_user !== false,
                url: p.url(),
                title: await p.title().catch(() => title),
                login_result: loginResult,
                automationAvailable: true
            };
        } catch (e) {
            console.log(`[navigateAndLogin] CDP/Playwright failed, using shell.openExternal:`, e.message);
            try {
                const { shell } = require('electron');
                await shell.openExternal(finalUrl);
            } catch (openErr) {
                const { exec } = require('child_process');
                exec(`start "" "${finalUrl}"`);
            }
            return {
                success: true,
                message: `Opened ${finalUrl} in your default browser.`,
                automationAvailable: false,
                url: finalUrl,
                note: "I can't automate clicks or typing here since this opened outside the Pecifics Chrome window. Say 'reopen in Pecifics Chrome' if you need me to interact with the page."
            };
        }
    }

    async isAmazonLoggedIn(p) {
        try {
            const text = await p.locator('#nav-link-accountList-nav-line-1').first().innerText({ timeout: 3000 }).catch(() => '');
            return Boolean(text && !/sign\s*in/i.test(text));
        } catch {
            return false;
        }
    }

    async loginAmazon(p, method = 'site_default', params = {}) {
        if (await this.isAmazonLoggedIn(p)) {
            return { success: true, reason: 'already_logged_in' };
        }

        await p.goto('https://www.amazon.in/ap/signin', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await delay(1500);
        if (await this.isAmazonLoggedIn(p)) {
            return { success: true, reason: 'already_logged_in_after_nav' };
        }

        const googleRequested = /google|gmail/i.test(String(method || '')) || /google|gmail/i.test(String(params.login_method || ''));
        if (googleRequested) {
            const googleButton = await this._clickFirstSelector(p, [
                'button:has-text("Continue with Google")',
                'button:has-text("Sign in with Google")',
                'a:has-text("Continue with Google")',
                'a:has-text("Sign in with Google")',
                '[aria-label*="Google" i]',
                'div[role="button"]:has-text("Google")',
            ], 2500).catch(() => false);
            if (googleButton) {
                await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                return await this.handleGoogleOAuth(p, { ...params, app: 'amazon' });
            }
            return {
                success: false,
                error_class: 'unsupported_login_method',
                blocker: 'login',
                needs_user: true,
                error: 'Amazon did not show a Google sign-in option. Use a saved Amazon account or log in manually in Chrome.',
                userMessage: 'Amazon usually requires an Amazon email/password or OTP. Google/Gmail credentials cannot be reused safely unless Amazon offers a Google button.',
            };
        }

        return {
            success: false,
            error_class: 'credentials_required',
            blocker: 'login',
            needs_user: true,
            error: 'Amazon login requires Amazon credentials or manual login. Please log in in Chrome, then retry or continue.',
            userMessage: 'Amazon sign-in is open. Complete it manually or add a dedicated Amazon credential flow.',
        };
    }

    /**
     * Click an element by CSS selector, text content, or aria-label.
     * Falls back to JS-based element discovery when static selectors fail.
     */
    async click(selector) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            // Strategy 1: exact and common selector variants
            const strategies = [
                () => p.click(selector, { timeout: 4000 }),
                () => p.click(`text=${selector}`, { timeout: 4000 }),
                () => p.click(`[aria-label="${selector}"]`, { timeout: 4000 }),
                () => p.click(`[placeholder="${selector}"]`, { timeout: 4000 }),
                () => p.click(`[name="${selector}"]`, { timeout: 4000 }),
                () => p.click(`button:has-text("${selector}")`, { timeout: 4000 }),
                () => p.click(`a:has-text("${selector}")`, { timeout: 4000 }),
                () => p.click(`[data-testid="${selector}"]`, { timeout: 4000 }),
                () => p.click(`[id*="${selector.replace(/^[#.]/, '')}"]`, { timeout: 4000 }),
                () => p.click(`[class*="${selector.replace(/^[#.]/, '')}"]`, { timeout: 4000 }),
            ];
            for (const strat of strategies) {
                try { await strat(); return { success: true, message: `Clicked: ${selector}` }; }
                catch {}
            }
            // Strategy 2: JS-based smart finder — search all clickable elements for matching text/attr
            const hint = selector.replace(/^[#.\[\]]/, '').toLowerCase();
            const clicked = await p.evaluate((hint) => {
                const candidates = Array.from(document.querySelectorAll(
                    'button, a, [role="button"], input[type="submit"], input[type="button"], [onclick], [tabindex]'
                ));
                for (const el of candidates) {
                    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
                    const id   = (el.id || '').toLowerCase();
                    const cls  = (el.className || '').toLowerCase();
                    if (text.includes(hint) || id.includes(hint) || cls.includes(hint)) {
                        el.scrollIntoView({ behavior: 'instant', block: 'center' });
                        el.click();
                        return true;
                    }
                }
                return false;
            }, hint);
            if (clicked) return { success: true, message: `Clicked element matching: ${selector}` };
            return { success: false, error: `Could not find element: ${selector}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Type text into a field by selector.
     * Falls back to JS-based input discovery when selector doesn't match.
     */
    async type(selector, text, clearFirst = true) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const hint = selector.toLowerCase();
            const isPassword = hint.includes('pass');
            const isEmail    = hint.includes('email') || hint.includes('user');

            const strategies = [
                selector,
                `[placeholder*="${selector.replace(/^[#.]/, '')}" i]`,
                `[name*="${selector.replace(/^[#.]/, '')}" i]`,
                `[id*="${selector.replace(/^[#.]/, '')}" i]`,
                `[aria-label*="${selector.replace(/^[#.]/, '')}" i]`,
                `input[type="${selector.replace(/^[#.]/, '')}"]`,
            ];
            if (isPassword) strategies.push('input[type="password"]');
            if (isEmail)    strategies.push('input[type="email"]', 'input[type="text"]');

            for (const sel of strategies) {
                try {
                    await p.waitForSelector(sel, { timeout: 4000, state: 'visible' });
                    if (clearFirst) await p.fill(sel, '');
                    await p.fill(sel, text);
                    return { success: true, message: `Typed into: ${selector}` };
                } catch {}
            }

            // JS-based smart finder — look for any visible input matching the hint
            const typed = await p.evaluate(({ hint, text, isPassword, isEmail }) => {
                const inputs = Array.from(document.querySelectorAll('input, textarea'));
                for (const el of inputs) {
                    if (el.offsetParent === null) continue; // hidden
                    const type  = (el.type || '').toLowerCase();
                    const id    = (el.id || '').toLowerCase();
                    const name  = (el.name || '').toLowerCase();
                    const ph    = (el.placeholder || '').toLowerCase();
                    const label = (el.getAttribute('aria-label') || '').toLowerCase();
                    const combined = id + name + ph + label + type;
                    if (
                        combined.includes(hint) ||
                        (isPassword && type === 'password') ||
                        (isEmail && (type === 'email' || combined.includes('email') || combined.includes('user')))
                    ) {
                        el.focus();
                        el.value = text;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
                // Last resort: first visible text/email input
                for (const el of inputs) {
                    if (el.offsetParent === null) continue;
                    if (['text', 'email', 'password', 'search', ''].includes(el.type)) {
                        el.focus();
                        el.value = text;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            }, { hint: selector.replace(/^[#.]/, '').toLowerCase(), text, isPassword, isEmail });

            if (typed) return { success: true, message: `Typed into field matching: ${selector}` };
            return { success: false, error: `Could not find input: ${selector}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Get text content of an element.
     */
    async getText(selector) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const text = await p.textContent(selector, { timeout: 5000 });
            return { success: true, text, message: text };
        } catch (e) {
            // Try inner text of body as fallback
            try {
                const bodyText = await p.evaluate(() => document.body.innerText);
                return { success: true, text: bodyText.substring(0, 2000), message: 'Page text (full body)' };
            } catch {
                return { success: false, error: e.message };
            }
        }
    }

    /**
     * Get the current page title and URL.
     */
    async getPageInfo() {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const title = await p.title();
            const url   = p.url();
            return { success: true, title, url };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Search Google and return first N result URLs + titles.
     */
    async googleSearch(query, resultCount = 5) {
        const p = await getOrCreatePage();
        if (!p) {
            // Fallback: just open Google in default browser
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
            exec(`start "" "${searchUrl}"`);
            return { success: true, message: `Opened Google search for: ${query}`, results: [] };
        }
        try {
            await p.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`, { waitUntil: 'domcontentloaded' });
            const results = await p.evaluate((count) => {
                const items = [];
                document.querySelectorAll('h3').forEach((h3) => {
                    const a = h3.closest('a');
                    if (a && items.length < count) {
                        items.push({ title: h3.innerText, url: a.href });
                    }
                });
                return items;
            }, resultCount);
            return { success: true, query, results, message: `Found ${results.length} results for: ${query}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Generic browser state probe shared by site-specific executors.
     */
    async probeBrowserState(targetPage = null, hints = {}) {
        if (targetPage && typeof targetPage.url !== 'function') {
            hints = targetPage || {};
            targetPage = null;
        }
        const p = targetPage || await getOrCreatePage();
        if (!p) {
            return {
                success: false,
                url: '',
                isLoggedIn: false,
                blocker: 'browser_missing',
                pageType: 'unknown',
                readySelectors: [],
                error: 'Browser is not open',
            };
        }

        try {
            const url = p.url();
            const title = await p.title().catch(() => '');
            const bodyText = await p.locator('body').innerText({ timeout: 4000 }).catch(() => '');
            const lower = `${url}\n${title}\n${bodyText}`.toLowerCase();

            let blocker = null;
            if (/accounts\.google\.com|\/signin|\/login|sign in|log in|continue with google|continue with email/.test(lower)) blocker = 'login';
            else if (/2-step|two-step|verification code|verify it'?s you|authenticator|security key|passkey/.test(lower)) blocker = '2fa';
            else if (/captcha|recaptcha|i'm not a robot|verify you are human/.test(lower)) blocker = 'captcha';
            else if (/onboarding|tell us about|choose how|what brings you|set up your/.test(lower)) blocker = 'onboarding';
            else if (/subscribe|upgrade|payment required|paywall|start trial/.test(lower)) blocker = 'paywall';

            const readinessSelectors = [
                { selector: 'input[name="to"]', label: 'gmail_to' },
                { selector: '[aria-label="Message Body"]', label: 'gmail_body' },
                { selector: 'input[name="subjectbox"]', label: 'gmail_subject' },
                { selector: 'div[gh="cm"], [data-tooltip="Compose"], [aria-label="Compose"]', label: 'gmail_dashboard' },
                { selector: 'div[role="listitem"]', label: 'google_form_question' },
                { selector: 'textarea, [contenteditable="true"], div[role="textbox"], input[type="text"]', label: 'prompt_or_form_field' },
                { selector: 'button[type="submit"], [aria-label="Send"], div[data-tooltip="Send"]', label: 'submit_or_send' },
            ];
            const readySelectors = [];
            for (const item of readinessSelectors) {
                const count = await p.locator(item.selector).count().catch(() => 0);
                if (count > 0) readySelectors.push(item.label);
            }

            let pageType = 'unknown';
            if (/mail\.google\.com/.test(url) && (readySelectors.includes('gmail_to') || /#compose/.test(url))) pageType = 'compose';
            else if (/mail\.google\.com/.test(url)) pageType = 'dashboard';
            else if (/docs\.google\.com\/forms|forms\.gle/.test(url) || readySelectors.includes('google_form_question')) pageType = 'form';
            else if (/gamma\.app/.test(url) && readySelectors.includes('prompt_or_form_field')) pageType = 'compose';
            else if (/gamma\.app/.test(url)) pageType = 'dashboard';

            return {
                success: true,
                url,
                title,
                isLoggedIn: !blocker || !['login', '2fa'].includes(blocker),
                blocker,
                pageType,
                readySelectors,
                hints,
            };
        } catch (e) {
            return {
                success: false,
                url: '',
                isLoggedIn: false,
                blocker: 'probe_error',
                pageType: 'unknown',
                readySelectors: [],
                error: e.message,
            };
        }
    }

    _isRecoverableBlocker(blocker) {
        return ['login', '2fa', 'captcha', 'onboarding', 'paywall', 'requires_login', 'requires_onboarding'].includes(String(blocker || '').toLowerCase());
    }

    _mergeRecoveryMeta(result = {}, meta = {}) {
        const blockersEncountered = [
            ...(Array.isArray(result.blockers_encountered) ? result.blockers_encountered : []),
            ...(Array.isArray(meta.blockers_encountered) ? meta.blockers_encountered : []),
        ].filter(Boolean);
        const blockersResolved = [
            ...(Array.isArray(result.blockers_resolved) ? result.blockers_resolved : []),
            ...(Array.isArray(meta.blockers_resolved) ? meta.blockers_resolved : []),
        ].filter(Boolean);
        const resolutionPath = [
            ...(Array.isArray(result.resolution_path) ? result.resolution_path : []),
            ...(Array.isArray(meta.resolution_path) ? meta.resolution_path : []),
        ].filter(Boolean);
        return {
            ...result,
            blockers_encountered: [...new Set(blockersEncountered)],
            blockers_resolved: [...new Set(blockersResolved)],
            resolution_path: [...new Set(resolutionPath)],
        };
    }

    async executeWithBlockerRecovery(targetPage, attemptStep, context = {}) {
        const p = targetPage || await getOrCreatePage();
        const first = await attemptStep();
        if (first && first.success !== false) return first;

        const firstBlocker = first?.blocker || first?.error_class || first?.state;
        let probe = first?.state && typeof first.state === 'object'
            ? first.state
            : await this.probeBrowserState(p, context).catch(() => null);
        const blocker = probe?.blocker || firstBlocker;

        if (!this._isRecoverableBlocker(blocker)) {
            return first;
        }

        const normalized = String(blocker || '').replace(/^requires_/, '');
        const meta = {
            blockers_encountered: [normalized],
            blockers_resolved: [],
            resolution_path: [],
        };

        if (normalized === 'login') {
            const loginResult = await this.handleLoginBlocker(p, probe || {}, context);
            meta.resolution_path.push(loginResult.path || 'handleLoginBlocker');
            if (!loginResult.success) {
                return this._mergeRecoveryMeta({
                    ...first,
                    success: false,
                    error_class: loginResult.error_class || 'login_failed',
                    blocker: loginResult.blocker || 'login',
                    needs_user: loginResult.needs_user !== false,
                    error: loginResult.error || 'Login blocker could not be resolved automatically.',
                    login_result: loginResult,
                }, meta);
            }
            meta.blockers_resolved.push('login');
            await delay(1500);
            const retry = await attemptStep();
            return this._mergeRecoveryMeta(retry, meta);
        }

        if (normalized === 'onboarding') {
            const dismissed = await this.dismissOnboarding(p, probe || {}, context);
            meta.resolution_path.push('dismissOnboarding');
            if (!dismissed.success) {
                return this._mergeRecoveryMeta({
                    ...first,
                    success: false,
                    error_class: 'requires_onboarding',
                    blocker: 'onboarding',
                    needs_user: true,
                    error: dismissed.error || 'Onboarding is blocking automation.',
                }, meta);
            }
            meta.blockers_resolved.push('onboarding');
            const retry = await attemptStep();
            return this._mergeRecoveryMeta(retry, meta);
        }

        return this._mergeRecoveryMeta({
            ...first,
            success: false,
            error_class: normalized,
            blocker: normalized,
            needs_user: true,
            error: `${normalized.toUpperCase()} is blocking automation. Please complete it in Chrome, then resume.`,
        }, meta);
    }

    async handleLoginBlocker(targetPage, probe = {}, context = {}) {
        const p = targetPage || await getOrCreatePage();
        if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open', needs_user: true };
        const url = p.url();
        const title = await p.title().catch(() => '');
        const bodyText = await p.locator('body').innerText({ timeout: 3000 }).catch(() => '');
        const lower = `${url}\n${title}\n${bodyText}`.toLowerCase();
        if (/accounts\.google\.com|continue with google|sign in with google|google account/.test(lower)) {
            return await this.handleGoogleOAuth(p, context);
        }
        const googleClicked = await this._clickFirstSelector(p, [
            'button:has-text("Continue with Google")',
            'button:has-text("Sign in with Google")',
            'a:has-text("Continue with Google")',
            'a:has-text("Sign in with Google")',
            '[aria-label*="Google" i]',
        ], 2500).catch(() => false);
        if (googleClicked) {
            await delay(2500);
            return await this.handleGoogleOAuth(p, context);
        }
        return {
            success: false,
            error_class: 'unsupported_login',
            blocker: 'login',
            needs_user: true,
            error: 'Login is required, but no supported Google OAuth path was detected.',
            probe,
        };
    }

    async handleGoogleOAuth(targetPage, context = {}) {
        const p = targetPage || await getOrCreatePage();
        if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open', needs_user: true };
        await delay(2000);
        const preferredEmail = String(context.account_email || context.email || '').trim().toLowerCase();
        const credential = await this.getGoogleCredential().catch(() => ({ success: false }));
        const credentialEmail = String(credential.username || '').trim().toLowerCase();

        const currentUrl = p.url();
        const currentState = await this.probeBrowserState(p, { app: context.app || 'google_oauth' }).catch(() => null);
        if (!/accounts\.google\.com|signin|login/i.test(currentUrl) && currentState?.blocker !== 'login') {
            return { success: true, path: 'handleGoogleOAuth.already_logged_in', state: currentState };
        }

        const accountSelector = preferredEmail
            ? `[data-identifier="${preferredEmail}"], [data-email="${preferredEmail}"], div[role="link"][data-identifier="${preferredEmail}"]`
            : '[data-email], [data-authuser], [data-identifier], div[role="link"][data-identifier], .k6Zj8d';
        try {
            let account = p.locator(accountSelector).first();
            if ((preferredEmail || credentialEmail) && await p.locator('[data-email], [data-identifier]').count().catch(() => 0)) {
                const targetEmail = preferredEmail || credentialEmail;
                const matches = p.locator(`[data-email="${targetEmail}"], [data-identifier="${targetEmail}"]`).first();
                if (await matches.count().catch(() => 0)) account = matches;
            }
            if (await account.count().catch(() => 0)) {
                await account.click({ timeout: 4000 });
                await p.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
                await delay(2500);
                const state = await this.probeBrowserState(p, { app: context.app || 'google_oauth' });
                if (!state.blocker || state.blocker === 'onboarding') {
                    return { success: true, path: 'handleGoogleOAuth.account_picker', state };
                }
                if (state.blocker === '2fa') {
                    return { success: false, error_class: '2fa', blocker: '2fa', needs_user: true, error: 'Google requires 2FA/passkey confirmation.', state };
                }
            }
            if ((preferredEmail || credentialEmail) && /accounts\.google\.com/i.test(p.url())) {
                const useOther = p.getByText(/use another account/i).first();
                if (await useOther.count().catch(() => 0)) {
                    await useOther.click({ timeout: 3000 });
                    await delay(1500);
                }
            }
        } catch {}

        const hasEmailInput = await p.locator('input[type="email"], input#identifierId, input[name="identifier"]').count().catch(() => 0);
        if (hasEmailInput) {
            if (!credential.success) {
                return {
                    success: false,
                    error_class: 'credentials_missing',
                    blocker: 'login',
                    needs_user: true,
                    error: 'Google credentials are not saved. Run: save my Google account',
                    path: 'handleGoogleOAuth.credentials_missing',
                };
            }
            try {
                await this._fillField(p, ['input[type="email"]', 'input#identifierId', 'input[name="identifier"]'], credential.username);
                const advanced = await this._clickFirstSelector(p, ['#identifierNext button', '#identifierNext', 'button:has-text("Next")'], 5000);
                if (!advanced) await p.keyboard.press('Enter').catch(() => {});
                await delay(2500);
            } catch (e) {
                return { success: false, error_class: 'login_failed', blocker: 'login', needs_user: true, error: e.message, path: 'handleGoogleOAuth.stored_credentials' };
            }
        }

        const hasPasswordInput = await p.locator('input[type="password"], input[name="password"]').count().catch(() => 0);
        if (hasPasswordInput) {
            if (!credential.success) {
                return {
                    success: false,
                    error_class: 'credentials_missing',
                    blocker: 'login',
                    needs_user: true,
                    error: 'Google credentials are not saved. Run: save my Google account',
                    path: 'handleGoogleOAuth.credentials_missing_password_step',
                };
            }
            try {
                await this._fillField(p, ['input[type="password"]', 'input[name="password"]'], credential.password);
                const advanced = await this._clickFirstSelector(p, ['#passwordNext button', '#passwordNext', 'button:has-text("Next")'], 5000);
                if (!advanced) await p.keyboard.press('Enter').catch(() => {});
                await p.waitForLoadState('domcontentloaded', { timeout: 12000 }).catch(() => {});
                await delay(3500);
                const state = await this.probeBrowserState(p, { app: context.app || 'google_oauth' });
                if (state.blocker === '2fa') {
                    return { success: false, error_class: '2fa', blocker: '2fa', needs_user: true, error: 'Google requires 2FA/passkey confirmation.', state };
                }
                if (state.blocker === 'login') {
                    return { success: false, error_class: 'login_failed', blocker: 'login', needs_user: true, error: 'Google login did not complete after submitting credentials.', state };
                }
                return { success: true, path: 'handleGoogleOAuth.stored_credentials', state };
            } catch (e) {
                return { success: false, error_class: 'login_failed', blocker: 'login', needs_user: true, error: e.message, path: 'handleGoogleOAuth.password_step' };
            }
        }

        const continued = await this._clickFirstSelector(p, [
            'button:has-text("Continue")',
            '[aria-label="Continue"]',
            'button:has-text("Next")',
            'button:has-text("Sign in")',
            'a:has-text("Sign in")',
        ], 2500).catch(() => false);
        if (continued) {
            await p.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            await delay(2500);
            const state = await this.probeBrowserState(p, { app: context.app || 'google_oauth' });
            if (!state.blocker || state.blocker === 'onboarding') {
                return { success: true, path: 'handleGoogleOAuth.continue_button', state };
            }
        }

        const state = await this.probeBrowserState(p, { app: context.app || 'google_oauth' });
        if (state.blocker === '2fa') {
            return { success: false, error_class: '2fa', blocker: '2fa', needs_user: true, error: 'Google requires 2FA/passkey confirmation.', state };
        }
        return {
            success: false,
            error_class: 'unknown_login_state',
            blocker: 'login',
            needs_user: true,
            error: `Unknown Google login state at ${p.url()}. Please log in manually, then retry.`,
            debug_url: p.url(),
            state,
        };
    }

    async dismissOnboarding(targetPage, probe = {}, context = {}) {
        const p = targetPage || await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser is not open' };
        const labels = [
            /skip/i,
            /not now/i,
            /maybe later/i,
            /continue/i,
            /done/i,
            /get started/i,
            /start/i,
            /next/i,
        ];
        const clicked = [];
        for (let round = 0; round < 4; round++) {
            let moved = false;
            for (const label of labels) {
                try {
                    const button = p.getByRole('button', { name: label }).first();
                    if (await button.count().catch(() => 0)) {
                        await button.click({ timeout: 2000 });
                        clicked.push(String(label));
                        moved = true;
                        await delay(1000);
                        break;
                    }
                } catch {}
            }
            const state = await this.probeBrowserState(p, context);
            if (state.blocker !== 'onboarding') {
                return { success: true, clicked, state };
            }
            if (!moved) break;
        }
        return { success: false, error: 'Could not dismiss onboarding automatically.', clicked, probe };
    }

    async saveGoogleCredential(email, password) {
        const username = String(email || '').trim();
        const secret = String(password || '');
        if (!username || !secret) {
            return { success: false, error_class: 'missing_parameters', error: 'Email and password are required.' };
        }
        return await new Promise((resolve) => {
            execFile('cmdkey.exe', [
                '/generic:Pecifics.Google',
                `/user:${username}`,
                `/pass:${secret}`,
            ], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
                if (err) {
                    resolve({ success: false, error_class: 'credential_store_failed', error: (stderr || err.message).trim() });
                } else {
                    resolve({ success: true, message: `Saved Google credential for ${username} in Windows Credential Manager.`, username });
                }
            });
        });
    }

    async getGoogleCredential() {
        const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
public class WinCred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public string TargetName;
    public string Comment;
    public FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);
  [DllImport("advapi32.dll", SetLastError=true)]
  public static extern void CredFree(IntPtr buffer);
}
"@
$ptr = [IntPtr]::Zero
$ok = [WinCred]::CredRead("Pecifics.Google", 1, 0, [ref]$ptr)
if (-not $ok -or $ptr -eq [IntPtr]::Zero) {
  [pscustomobject]@{ success = $false; error = "Credential Pecifics.Google not found" } | ConvertTo-Json -Compress
  exit
}
$cred = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][WinCred+CREDENTIAL])
$password = ""
if ($cred.CredentialBlob -ne [IntPtr]::Zero -and $cred.CredentialBlobSize -gt 0) {
  $password = [Runtime.InteropServices.Marshal]::PtrToStringUni($cred.CredentialBlob, [int]($cred.CredentialBlobSize / 2))
}
[WinCred]::CredFree($ptr)
[pscustomobject]@{ success = $true; username = $cred.UserName; password = $password } | ConvertTo-Json -Compress
`;
        const result = await runPowerShell(script, 12000);
        if (!result.success || !result.output) {
            return { success: false, error_class: 'credential_read_failed', error: result.error || 'Credential read failed' };
        }
        try {
            const data = JSON.parse(result.output);
            if (!data.success) return { success: false, error_class: 'credentials_missing', error: data.error || 'Google credential not found' };
            return { success: true, username: data.username, password: data.password };
        } catch (e) {
            return { success: false, error_class: 'credential_parse_failed', error: e.message };
        }
    }

    /**
     * Gamma recipe: open Gamma once, locate the prompt field, enter the topic,
     * and start generation. This intentionally returns a clear blocker instead
     * of pretending success when login/onboarding is in the way.
     */
    async gammaProbeState(params = {}) {
        try {
            await ensureBrowser('chrome');
            const p = await getOrNavigateTo('gamma.app', params.url || 'https://gamma.app');
            if (!p) return { success: false, state: 'browser_missing', error_class: 'browser_not_open', error: 'Browser is not open' };

            await p.bringToFront().catch(() => {});
            await p.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            await delay(1000);

            const url = p.url();
            const title = await p.title().catch(() => '');
            const bodyText = await p.locator('body').innerText({ timeout: 5000 }).catch(() => '');
            const genericState = await this.probeBrowserState(p, { app: 'gamma' });
            const promptCandidates = await p.$$eval('textarea,input,[contenteditable="true"],div[role="textbox"]', els =>
                els.slice(0, 12).map(el => ({
                    tag: el.tagName,
                    text: (el.innerText || el.value || '').slice(0, 120),
                    placeholder: el.getAttribute('placeholder') || '',
                    aria: el.getAttribute('aria-label') || '',
                    visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
                }))
            ).catch(() => []);

            const loginBlocked = /accounts\.google\.com|\/signin|\/login/i.test(url) ||
                /sign in|log in|continue with google|continue with email|verify your email/i.test(bodyText);
            const onboardingBlocked = /onboarding|workspace|tell us about|choose how|what brings you/i.test(bodyText) &&
                !/what would you like|paste in text|describe/i.test(bodyText);
            const promptReady = promptCandidates.some(c =>
                c.visible && /describe|what would you like|prompt|topic|paste/i.test(`${c.placeholder} ${c.aria} ${c.text}`)
            );

            if (genericState.blocker === 'captcha' || genericState.blocker === 'paywall') {
                return {
                    success: false,
                    state: `requires_${genericState.blocker}`,
                    error_class: genericState.blocker,
                    needs_user: true,
                    title,
                    url,
                    promptCandidates,
                    genericState,
                };
            }
            if (loginBlocked) {
                return { success: false, state: 'requires_login', error_class: 'requires_login', needs_user: true, title, url, promptCandidates, genericState };
            }
            if (onboardingBlocked) {
                return { success: false, state: 'requires_onboarding', error_class: 'requires_onboarding', needs_user: true, title, url, promptCandidates, genericState };
            }
            return { success: true, state: promptReady ? 'ready' : genericState.pageType, title, url, promptCandidates, genericState };
        } catch (e) {
            return { success: false, state: 'probe_error', error_class: 'network_error', error: e.message };
        }
    }

    async gammaCreatePresentation(topic, instructions = '', params = {}) {
        const finalTopic = String(topic || params.topic || 'Presentation').trim();
        const prompt = String(
            instructions ||
            params.instructions ||
            params.prompt ||
            `Create a professional presentation about ${finalTopic}`
        ).trim();

        try {
            await ensureBrowser('chrome');
            const p = await getOrNavigateTo('gamma.app', params.url || 'https://gamma.app');
            if (!p) return { success: false, error: 'Browser is not open' };

            await p.bringToFront().catch(() => {});
            await p.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            await delay(1500);

            const recoveryCheck = await this.executeWithBlockerRecovery(p, async () => {
                const probe = await this.gammaProbeState({ url: params.url || 'https://gamma.app' });
                if (probe.state === 'requires_login' || probe.state === 'requires_onboarding' || probe.error_class === 'captcha' || probe.error_class === 'paywall') {
                    return {
                        success: false,
                        blocker: probe.state === 'requires_login' ? 'login' : String(probe.state || probe.error_class || '').replace(/^requires_/, ''),
                        error_class: probe.error_class,
                        needs_user: true,
                        probe,
                        state: probe.genericState || probe,
                    };
                }
                return { success: true, probe };
            }, { app: 'gamma', account_email: params.account_email || params.email });

            const probe = recoveryCheck.probe || recoveryCheck.state || await this.gammaProbeState({ url: params.url || 'https://gamma.app' });
            const title = probe.title || await p.title().catch(() => '');
            const url = probe.url || p.url();
            if (recoveryCheck.success === false || probe.state === 'requires_login' || probe.state === 'requires_onboarding') {
                return {
                    success: false,
                    error: (probe.state === 'requires_login' || recoveryCheck.blocker === 'login')
                        ? 'Gamma requires login. Please complete login in Chrome, then run the command again.'
                        : 'Gamma onboarding is blocking automation. Please complete onboarding in Chrome, then run the command again.',
                    error_class: recoveryCheck.error_class || probe.error_class,
                    blocker: recoveryCheck.blocker,
                    needs_user: true,
                    step: probe.state || recoveryCheck.blocker,
                    title,
                    url,
                    promptCandidates: probe.promptCandidates || [],
                    blockers_encountered: recoveryCheck.blockers_encountered || [],
                    blockers_resolved: recoveryCheck.blockers_resolved || [],
                    resolution_path: recoveryCheck.resolution_path || [],
                    login_result: recoveryCheck.login_result,
                };
            }

            const clickFirstVisible = async (locators, timeout = 2500) => {
                for (const locator of locators) {
                    try {
                        const el = typeof locator === 'string' ? p.locator(locator).first() : locator.first();
                        await el.waitFor({ state: 'visible', timeout });
                        await el.click({ timeout });
                        return true;
                    } catch {}
                }
                return false;
            };

            const fillFirstPrompt = async () => {
                const promptLocators = [
                    p.getByPlaceholder(/describe|what would you like|prompt|topic|paste|ask ai/i),
                    p.getByRole('textbox', { name: /describe|prompt|topic|content|ask ai/i }),
                    p.locator('textarea').first(),
                    p.locator('[contenteditable="true"]').first(),
                    p.locator('div[role="textbox"]').first(),
                    p.locator('input[type="text"]').first(),
                ];

                for (const locator of promptLocators) {
                    try {
                        await locator.waitFor({ state: 'visible', timeout: 2500 });
                        await locator.click({ timeout: 2000 });
                        const tag = await locator.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
                        if (tag === 'textarea' || tag === 'input') {
                            await locator.fill(prompt, { timeout: 3000 });
                        } else {
                            await p.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
                            await p.keyboard.insertText(prompt);
                        }
                        return true;
                    } catch {}
                }
                return false;
            };

            await this.autoHandleBlockers().catch(() => {});
            let promptFilled = await fillFirstPrompt();

            for (let round = 0; !promptFilled && round < 4; round++) {
                const movedForward = await clickFirstVisible([
                    p.getByRole('button', { name: /new presentation|new deck|new|create|generate|presentation|start/i }),
                    p.getByRole('link', { name: /new presentation|create|generate|presentation|start/i }),
                    p.getByText(/new presentation|create new|generate with ai|paste in text|text to deck|from prompt|start from scratch/i),
                    'a[href*="create"]',
                    'a[href*="generate"]',
                    'button:has-text("New")',
                    'button:has-text("Create")',
                    'button:has-text("Generate")',
                ], 2200).catch(() => false);

                if (!movedForward && round === 1) {
                    await p.goto('https://gamma.app/create', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
                }

                await delay(900);
                await this.autoHandleBlockers().catch(() => {});
                promptFilled = await fillFirstPrompt();
            }

            if (!promptFilled) {
                const visibleInputs = await p.$$eval('textarea,input,[contenteditable="true"],div[role="textbox"]', els =>
                    els.slice(0, 8).map(el => ({
                        tag: el.tagName,
                        text: (el.innerText || el.value || '').slice(0, 80),
                        placeholder: el.getAttribute('placeholder') || '',
                        aria: el.getAttribute('aria-label') || '',
                    }))
                ).catch(() => []);
                return {
                    success: false,
                    error: 'Could not find Gamma prompt field. Login, onboarding, or UI changes may be blocking the recipe.',
                    error_class: 'element_not_found',
                    step: 'gamma_prompt_field_not_found',
                    title,
                    url,
                    visibleInputs,
                };
            }

            await delay(500);
            const generateClicked = await clickFirstVisible([
                p.getByRole('button', { name: /generate|create|continue|make|next|outline|presentation/i }),
                p.getByText(/generate|create|continue|make|next|outline|presentation/i),
                'button[type="submit"]',
            ], 3000);

            if (!generateClicked) {
                await p.keyboard.press('Enter').catch(() => {});
            }

            await delay(2000);
            return {
                success: true,
                message: `Started Gamma presentation workflow for: ${finalTopic}`,
                topic: finalTopic,
                url: p.url(),
                blockers_encountered: recoveryCheck.blockers_encountered || [],
                blockers_resolved: recoveryCheck.blockers_resolved || [],
                resolution_path: recoveryCheck.resolution_path || [],
            };
        } catch (e) {
            return { success: false, error: e.message, step: 'gamma_recipe_exception' };
        }
    }

    /**
     * Auto-fill and submit a login form.
     */
    async login(url, username, password, usernameSelector = '', passwordSelector = '') {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };

        try {
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
            await delay(1500);

            // Detect username field
            const userSelectors = [
                usernameSelector,
                'input[type="email"]',
                'input[name="email"]',
                'input[name="username"]',
                'input[name="user"]',
                'input[id*="email"]',
                'input[id*="user"]',
                'input[placeholder*="email" i]',
                'input[placeholder*="username" i]',
                'input[type="text"]:first-of-type',
            ].filter(Boolean);

            const passSelectors = [
                passwordSelector,
                'input[type="password"]',
                'input[name="password"]',
                'input[name="pass"]',
                'input[id*="password"]',
                'input[id*="pass"]',
            ].filter(Boolean);

            let userFilled = false;
            for (const sel of userSelectors) {
                try {
                    await p.fill(sel, username, { timeout: 3000 });
                    userFilled = true;
                    break;
                } catch {}
            }
            if (!userFilled) return { success: false, error: 'Could not find username/email field' };

            await delay(500);

            // Some sites show password on next page
            try { await p.press(userSelectors[0], 'Tab'); } catch {}
            await delay(300);
            try { await p.press(userSelectors[0], 'Enter'); } catch {}
            await delay(1500);

            let passFilled = false;
            for (const sel of passSelectors) {
                try {
                    await p.fill(sel, password, { timeout: 3000 });
                    passFilled = true;
                    break;
                } catch {}
            }
            if (!passFilled) return { success: false, error: 'Could not find password field' };

            await delay(300);

            // Submit
            const submitSelectors = [
                'button[type="submit"]',
                'input[type="submit"]',
                'button:has-text("Sign in")',
                'button:has-text("Log in")',
                'button:has-text("Login")',
                'button:has-text("Continue")',
                '[data-testid*="submit"]',
            ];
            let submitted = false;
            for (const sel of submitSelectors) {
                try {
                    await p.click(sel, { timeout: 3000 });
                    submitted = true;
                    break;
                } catch {}
            }
            if (!submitted) {
                await p.keyboard.press('Enter');
            }

            await delay(3000); // Wait for navigation
            const title = await p.title();
            const urlNow = p.url();

            return {
                success: true,
                message: `Login attempted at ${url}`,
                currentPage: { title, url: urlNow },
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Detect the current page state: 'login' | 'signup' | 'chat' | 'search' | 'main'
     */
    async detectPageState() {
        const p = await getOrCreatePage();
        if (!p) return { success: false, state: 'unknown' };
        try {
            const state = await p.evaluate(() => {
                const body = (document.body && document.body.innerText || '').toLowerCase();
                const inputs = Array.from(document.querySelectorAll('input'));
                const hasPassword = inputs.some(i => i.type === 'password');
                const passCount   = inputs.filter(i => i.type === 'password').length;
                const hasNameField = inputs.some(i => {
                    const combined = (i.name + i.id + i.placeholder).toLowerCase();
                    return ['name','full','first','last'].some(k => combined.includes(k));
                });
                const hasSignupText = /create[\s\w]*account|sign[\s-]?up|register|get started/i.test(body);
                const hasLoginText  = /sign[\s-]?in|log[\s-]?in|welcome back|password/i.test(body);
                const hasChatInput  = !!(document.querySelector('#prompt-textarea') ||
                    document.querySelector('textarea[data-id]') ||
                    document.querySelector('div[contenteditable="true"][class*="prompt"]'));
                if (passCount >= 2 || (hasSignupText && hasNameField)) return 'signup';
                if (hasPassword) return 'login';
                if (hasChatInput) return 'chat';
                if (document.querySelector('input[type="search"], input[name="q"]')) return 'search';
                return 'main';
            });
            return { success: true, state, url: p.url(), title: await p.title() };
        } catch (e) {
            return { success: false, state: 'unknown', error: e.message };
        }
    }

    /**
     * Smart login — auto-detects login vs signup, handles multi-step flows.
     * isNewUser=true  → navigate to signup/register form and create account
     * isNewUser=false → sign into existing account
     */
    async smartLogin(url, name, email, password, isNewUser = false) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await delay(2000);

            const stateInfo = await this.detectPageState();
            let state = stateInfo.state;

            // ── New user: navigate to signup form ──
            if (isNewUser && state !== 'signup') {
                const signupLinks = [
                    'a:has-text("Sign up")', 'a:has-text("Create account")',
                    'a:has-text("Register")', 'button:has-text("Sign up")',
                    'a[href*="signup"]', 'a[href*="register"]',
                    'a[href*="join"]', 'a[href*="create"]',
                ];
                for (const sel of signupLinks) {
                    try { await p.click(sel, { timeout: 3000 }); await delay(2000); break; } catch {}
                }
                state = (await this.detectPageState()).state;
            }

            if (state === 'signup' || isNewUser) {
                return await this._doSignup(p, name, email || name, password);
            }
            return await this._doLoginSteps(p, email || name, password);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /** Internal: fill signup form (name, email, passwords) and submit */
    async _doSignup(p, name, email, password) {
        try {
            // Name field
            if (name) {
                const nameSelectors = [
                    'input[name*="name" i]', 'input[id*="name" i]',
                    'input[placeholder*="name" i]', 'input[autocomplete="name"]',
                ];
                for (const sel of nameSelectors) {
                    try { await p.fill(sel, name, { timeout: 3000 }); break; } catch {}
                }
                await delay(300);
            }
            // Email
            const emailSelectors = [
                'input[type="email"]', 'input[name*="email" i]',
                'input[id*="email" i]', 'input[placeholder*="email" i]',
            ];
            for (const sel of emailSelectors) {
                try { await p.fill(sel, email, { timeout: 3000 }); break; } catch {}
            }
            await delay(300);
            // All password fields (new + confirm)
            const passFields = await p.$$('input[type="password"]');
            for (const field of passFields) {
                try { await field.fill(password); await delay(200); } catch {}
            }
            await delay(400);
            // Submit
            const submitSelectors = [
                'button[type="submit"]', 'input[type="submit"]',
                'button:has-text("Sign up")', 'button:has-text("Create account")',
                'button:has-text("Register")', 'button:has-text("Get started")',
                'button:has-text("Continue")', 'button:has-text("Next")',
            ];
            for (const sel of submitSelectors) {
                try { await p.click(sel, { timeout: 3000 }); break; } catch {}
            }
            await delay(3000);
            return { success: true, message: `Account creation attempted for ${email}`, action: 'signup' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /** Internal: multi-step login (email → Enter → password may appear on next step) */
    async _doLoginSteps(p, usernameOrEmail, password) {
        try {
            const userSelectors = [
                'input[type="email"]', 'input[name="email"]', 'input[name="username"]',
                'input[name="user"]', 'input[id*="email" i]', 'input[id*="user" i]',
                'input[placeholder*="email" i]', 'input[placeholder*="username" i]',
                'input[autocomplete="email"]', 'input[autocomplete="username"]',
            ];
            let userFilled = false;
            let usedSel = userSelectors[0];
            for (const sel of userSelectors) {
                try {
                    await p.fill(sel, usernameOrEmail, { timeout: 3000 });
                    userFilled = true; usedSel = sel; break;
                } catch {}
            }
            if (!userFilled) return { success: false, error: 'Could not find email/username field' };
            await delay(400);

            // Try Continue/Next button first (multi-step sites like Google, Microsoft)
            const continueSelectors = [
                'button:has-text("Next")', 'button:has-text("Continue")',
                'input[value*="Next" i]', 'button[id*="next" i]',
            ];
            let stepped = false;
            for (const sel of continueSelectors) {
                try { await p.click(sel, { timeout: 2500 }); stepped = true; await delay(2000); break; } catch {}
            }
            if (!stepped) {
                // Press Enter to advance
                try { await p.press(usedSel, 'Enter'); await delay(1800); } catch {}
            }

            // Now fill password (may be on new step/page)
            const passSelectors = [
                'input[type="password"]', 'input[name="password"]',
                'input[name="pass"]', 'input[id*="password" i]',
            ];
            let passFilled = false;
            for (const sel of passSelectors) {
                try {
                    await p.fill(sel, password, { timeout: 4000 });
                    passFilled = true; break;
                } catch {}
            }
            if (!passFilled) return { success: false, error: 'Could not find password field' };
            await delay(300);

            // Submit
            const submitSelectors = [
                'button[type="submit"]', 'input[type="submit"]',
                'button:has-text("Sign in")', 'button:has-text("Log in")',
                'button:has-text("Login")', 'button:has-text("Continue")',
                'button:has-text("Next")', '[data-testid*="submit"]',
            ];
            let submitted = false;
            for (const sel of submitSelectors) {
                try { await p.click(sel, { timeout: 3000 }); submitted = true; break; } catch {}
            }
            if (!submitted) await p.keyboard.press('Enter');

            await delay(3500);
            const title  = await p.title();
            const urlNow = p.url();
            return { success: true, message: `Signed in successfully`, currentPage: { title, url: urlNow }, action: 'login' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Type into the main search box or chat prompt on the current page and submit.
     * Works with ChatGPT, YouTube search, Google, Bing, site search bars, etc.
     */
    async searchInPage(text) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const searchSelectors = [
                // ChatGPT / AI chat prompts
                '#prompt-textarea',
                'textarea[data-id="root"]',
                'div[id="prompt-textarea"][contenteditable]',
                'p[data-placeholder]',
                // Generic textareas
                'textarea[placeholder*="message" i]',
                'textarea[placeholder*="ask" i]',
                'textarea[placeholder*="search" i]',
                'textarea[placeholder*="type" i]',
                // Standard search inputs
                'input[type="search"]',
                'input[name="q"]',
                'input[name="search_query"]',
                'input[placeholder*="search" i]',
                'input[placeholder*="ask" i]',
                // Contenteditable
                '[contenteditable="true"]',
            ];

            for (const sel of searchSelectors) {
                try {
                    await p.waitForSelector(sel, { timeout: 3000, state: 'visible' });
                    await p.click(sel);
                    await delay(300);
                    // contenteditable? use keyboard type
                    const isEditable = await p.$eval(sel, el => el.contentEditable === 'true').catch(() => false);
                    if (isEditable) {
                        // Clear existing content
                        await p.keyboard.press('Control+a');
                        await p.keyboard.press('Delete');
                        await p.keyboard.type(text, { delay: 30 });
                    } else {
                        await p.fill(sel, text);
                    }
                    await delay(400);
                    await p.keyboard.press('Enter');
                    return { success: true, message: `Sent: "${text}"` };
                } catch {}
            }
            return { success: false, error: 'No search or chat input found on this page' };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Scroll in the page.
     */
    async scroll(direction = 'down', amount = 500) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const delta = direction === 'up' ? -amount : amount;
            await p.mouse.wheel(0, delta);
            return { success: true, message: `Scrolled ${direction}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Wait for a selector to appear.
     */
    async waitFor(selector, timeout = 10000) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            await p.waitForSelector(selector, { timeout });
            return { success: true, message: `Element appeared: ${selector}` };
        } catch (e) {
            return { success: false, error: `Timeout waiting for: ${selector}` };
        }
    }

    /**
     * Take a screenshot of the current browser page as base64.
     */
    async pageScreenshotBase64() {
        const p = await getOrCreatePage();
        if (!p) return null;
        try {
            const buf = await p.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
            return buf.toString('base64');
        } catch { return null; }
    }

    /**
     * DOM-based fast blocker detection and auto-handling.
     * Handles: cookie banners, GDPR popups, generic confirm/close dialogs.
     * Returns { handled: bool, what: string }
     */
    async autoHandleBlockers() {
        const p = await getOrCreatePage();
        if (!p) return { handled: false, what: 'no browser' };
        try {
            const acceptSelectors = [
                // Cookie consent
                'button:has-text("Accept all")', 'button:has-text("Accept All")',
                'button:has-text("Accept cookies")', 'button:has-text("Accept Cookies")',
                'button:has-text("Allow all")', 'button:has-text("Allow All")',
                'button:has-text("Allow cookies")', 'button:has-text("I Accept")',
                'button:has-text("I agree")', 'button:has-text("Agree")',
                '#onetrust-accept-btn-handler',
                'button[id*="accept" i][id*="cookie" i]',
                'button[class*="accept" i][class*="cookie" i]',
                // Confirm/dismiss
                'button:has-text("Got it")', 'button:has-text("OK")',
                'button:has-text("Close")', 'button:has-text("Dismiss")',
                'button:has-text("Continue")', 'button:has-text("Not now")',
                '[aria-label="Close"]', '[aria-label="Dismiss"]',
            ];
            for (const sel of acceptSelectors) {
                try {
                    const el = await p.$(sel);
                    if (el && await el.isVisible()) {
                        await el.click();
                        await delay(800);
                        return { handled: true, what: `Clicked: ${sel}` };
                    }
                } catch {}
            }
            return { handled: false, what: 'no known blocker found' };
        } catch (e) {
            return { handled: false, what: e.message };
        }
    }

    /**
     * Take a screenshot of the current browser page.
     */
    async screenshot() {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const imgPath = path.join(os.tmpdir(), `browser_shot_${Date.now()}.png`);
            await p.screenshot({ path: imgPath, fullPage: false });
            return { success: true, path: imgPath, message: `Screenshot saved: ${imgPath}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Execute JavaScript in the page context.
     */
    async executeScript(script) {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            const result = await p.evaluate(new Function(`return (${script})`));
            return { success: true, result: JSON.stringify(result), message: String(result) };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    normalizeFieldMap(fields = {}) {
        if (Array.isArray(fields)) {
            return Object.fromEntries(fields.map(item => [
                item.name || item.label || item.field || item.selector || '',
                item.value ?? item.text ?? '',
            ]).filter(([key]) => key));
        }
        if (typeof fields === 'string') {
            const map = {};
            fields.split(/[,;\n]/).forEach(part => {
                const idx = part.indexOf(':');
                if (idx > 0) map[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
            });
            return map;
        }
        return fields && typeof fields === 'object' ? fields : {};
    }

    async extractGoogleFormQuestions(targetPage = null) {
        const p = targetPage || await getOrCreatePage();
        if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open', questions: [] };
        try {
            await p.waitForSelector('div[role="listitem"]', { timeout: 8000 }).catch(() => {});
            const questions = await p.$$eval('div[role="listitem"]', (items) => {
                const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim();
                const detectType = (item) => {
                    if (item.querySelector('[role="radio"]')) return 'radio';
                    if (item.querySelector('[role="checkbox"]')) return 'checkbox';
                    if (item.querySelector('[role="listbox"], select')) return 'dropdown';
                    if (item.querySelector('textarea')) return 'textarea';
                    if (item.querySelector('input[type="date"]')) return 'date';
                    if (item.querySelector('input[type="time"]')) return 'time';
                    if (item.querySelector('input[type="email"]')) return 'email';
                    if (item.querySelector('input[type="number"]')) return 'number';
                    if (item.querySelector('input[type="text"], input:not([type])')) return 'text';
                    return 'unknown';
                };
                return items.map((item, index) => {
                    const heading = item.querySelector('[role="heading"]');
                    let question = clean(heading ? heading.innerText : '');
                    if (!question) {
                        const candidate = clean(item.innerText).split(/\s+(?:Your answer|Choose|Required)\b/i)[0];
                        question = clean(candidate);
                    }
                    const type = detectType(item);
                    const optionEls = Array.from(item.querySelectorAll('[role="radio"], [role="checkbox"], [role="option"]'));
                    const options = optionEls.map(opt => clean(opt.getAttribute('aria-label') || opt.innerText)).filter(Boolean);
                    const required = !!item.querySelector('[aria-required="true"]') || /\*\s*$/.test(question) || /required/i.test(clean(item.innerText));
                    return { index, question: question.replace(/\s*\*\s*$/, ''), type, options: [...new Set(options)], required };
                }).filter(q => q.question || q.options.length || q.type !== 'unknown');
            });
            return { success: true, questions, url: p.url() };
        } catch (e) {
            return { success: false, error_class: 'form_schema_error', error: e.message, questions: [] };
        }
    }

    async getGoogleFormSchema() {
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        try {
            return await this.extractGoogleFormQuestions(p);
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    fieldScore(a, b) {
        const left = String(a || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
        const right = String(b || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
        if (!left || !right) return 0;
        if (right.includes(left) || left.includes(right)) return 10 + Math.min(left.length, right.length) / 100;
        const tokens = left.split(/\s+/).filter(Boolean);
        return tokens.reduce((score, token) => score + (right.includes(token) ? 1 : 0), 0);
    }

    _answersToFieldMap(answers = []) {
        const map = {};
        for (const answer of answers || []) {
            const key = answer.question || answer.label || answer.field;
            if (!key) continue;
            map[key] = answer.answer ?? answer.value ?? '';
        }
        return map;
    }

    async prepareIntelligentGoogleFormFill(p, params = {}) {
        const schema = await this.extractGoogleFormQuestions(p);
        if (!schema.success || !schema.questions.length) {
            return {
                success: false,
                error_class: schema.error_class || 'no_questions_found',
                error: schema.error || 'No Google Form questions were found on the current page.',
                url: p.url(),
            };
        }

        const answerDraft = await postBackendJson('/generate_form_answers', {
            questions: schema.questions,
            user_context: params.user_context || params.context || params.instructions || params.prompt || '',
            command: params.command || params.user_context || '',
        }, 75000);

        const answers = Array.isArray(answerDraft.answers) ? answerDraft.answers : [];
        const fields = this._answersToFieldMap(answers);
        const previewLines = answers.map((answer, idx) => {
            const flag = answer.needs_review || Number(answer.confidence || 0) < 0.72 ? ' [review]' : '';
            return `${idx + 1}. ${answer.question || `Question ${idx + 1}`}: ${answer.answer || '(blank)'}${flag}`;
        });

        if (!params.confirmed) {
            return {
                success: false,
                requiresConfirmation: true,
                error_class: 'confirmation_required',
                message: `I found ${schema.questions.length} Google Form questions and drafted answers. Review before filling${params.submit ? ' and submitting' : ''}.`,
                preview: previewLines.join('\n'),
                questions: schema.questions,
                answers,
                generated_fields: fields,
                needs_review_count: answerDraft.needs_review_count ?? answers.filter(a => a.needs_review).length,
                url: p.url(),
            };
        }

        return {
            success: true,
            fields,
            answers,
            questions: schema.questions,
            needs_review_count: answerDraft.needs_review_count ?? 0,
        };
    }

    async fillGoogleForm(params = {}) {
        const fields = this.normalizeFieldMap(params.fields || params.values || params.answers || {});

        try {
            await ensureBrowser('chrome');
            const p = params.url ? await getOrNavigateTo('docs.google.com/forms', params.url) : await getOrCreatePage();
            if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open' };
            await p.bringToFront().catch(() => {});
            await p.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
            await delay(800);

            const recoveryCheck = await this.executeWithBlockerRecovery(p, async () => {
                const state = await this.probeBrowserState(p, { app: 'google_forms', account_email: params.account_email || params.email });
                const url = p.url();
                const bodyText = await p.locator('body').innerText({ timeout: 5000 }).catch(() => '');
                if (/not accepting responses/i.test(bodyText)) {
                    return { success: false, blocker: 'permission_blocked', error_class: 'permission_blocked', needs_user: true, state };
                }
                if (/accounts\.google\.com/i.test(url) || /sign in|required to view|permission/i.test(bodyText) || state.blocker) {
                    return { success: false, blocker: state.blocker || 'login', error_class: state.blocker || 'requires_login', needs_user: true, state };
                }
                return { success: true, state };
            }, { app: 'google_forms', account_email: params.account_email || params.email });

            const url = p.url();
            const bodyText = await p.locator('body').innerText({ timeout: 5000 }).catch(() => '');
            if (recoveryCheck.success === false || /accounts\.google\.com/i.test(url) || /sign in|required to view|permission|not accepting responses/i.test(bodyText)) {
                return {
                    success: false,
                    error_class: /not accepting responses/i.test(bodyText) ? 'permission_blocked' : 'requires_login',
                    blocker: recoveryCheck.blocker,
                    needs_user: true,
                    error: recoveryCheck.error || 'Google Form is blocked by login, permissions, or response availability.',
                    url,
                    blockers_encountered: recoveryCheck.blockers_encountered || [],
                    blockers_resolved: recoveryCheck.blockers_resolved || [],
                    resolution_path: recoveryCheck.resolution_path || [],
                };
            }

            let effectiveFields = fields;
            if (!Object.keys(effectiveFields).length || params.auto_answer === true || String(params.auto_answer).toLowerCase() === 'true') {
                const prepared = await this.prepareIntelligentGoogleFormFill(p, params);
                if (prepared.requiresConfirmation || prepared.success === false) {
                    return prepared;
                }
                effectiveFields = prepared.fields || {};
            }

            if (!Object.keys(effectiveFields).length) {
                return { success: false, error_class: 'missing_parameters', error: 'No form fields were provided or generated' };
            }

            const blocks = p.locator('div[role="listitem"]');
            const count = await blocks.count().catch(() => 0);
            const details = [];

            for (const [label, value] of Object.entries(effectiveFields)) {
                let bestIndex = -1;
                let bestScore = 0;
                for (let i = 0; i < count; i++) {
                    const text = await blocks.nth(i).innerText({ timeout: 1000 }).catch(() => '');
                    const score = this.fieldScore(label, text);
                    if (score > bestScore) {
                        bestScore = score;
                        bestIndex = i;
                    }
                }
                if (bestIndex < 0 || bestScore <= 0) {
                    details.push({ field: label, success: false, error_class: 'element_not_found', error: 'No matching question found' });
                    continue;
                }

                const block = blocks.nth(bestIndex);
                try {
                    const textbox = block.locator('input[type="text"], input[type="email"], input[type="number"], textarea').first();
                    if (await textbox.count()) {
                        await textbox.fill(String(value), { timeout: 4000 });
                        details.push({ field: label, success: true, method: 'text', score: bestScore });
                        continue;
                    }

                    const option = block.getByText(new RegExp(`^\\s*${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i')).first();
                    await option.click({ timeout: 3000 });
                    details.push({ field: label, success: true, method: 'option', score: bestScore });
                } catch (e) {
                    details.push({ field: label, success: false, error_class: 'element_not_found', error: e.message, score: bestScore });
                }
            }

            const filled = details.filter(d => d.success).length;
            if (params.submit === true || params.confirmed === true) {
                if (!params.confirmed) {
                    return { success: false, requiresConfirmation: true, error_class: 'confirmation_required', message: `Filled ${filled}/${details.length} fields. Confirm before submitting.`, details };
                }
                await p.getByRole('button', { name: /^submit$/i }).click({ timeout: 5000 });
                await delay(1200);
            }

            return {
                success: filled > 0 && filled === details.length,
                partial: filled > 0 && filled < details.length,
                message: `Filled ${filled}/${details.length} Google Form fields`,
                details,
                url: p.url(),
                blockers_encountered: recoveryCheck.blockers_encountered || [],
                blockers_resolved: recoveryCheck.blockers_resolved || [],
                resolution_path: recoveryCheck.resolution_path || [],
            };
        } catch (e) {
            return { success: false, error_class: 'form_fill_error', error: e.message };
        }
    }

    /**
     * Fill a form with key-value pairs.
     */
    async fillForm(fields) {
        // fields = [{ selector: "...", value: "..." }, ...]
        const p = await getOrCreatePage();
        if (!p) return { success: false, error: 'Browser not open' };
        const results = [];
        for (const { selector, value } of fields) {
            try {
                await p.fill(selector, value, { timeout: 5000 });
                results.push({ selector, success: true });
            } catch (e) {
                results.push({ selector, success: false, error: e.message });
            }
        }
        const ok = results.filter(r => r.success).length;
        return { success: ok > 0, message: `Filled ${ok}/${results.length} form fields`, details: results };
    }

    /**
     * Go back/forward in browser history.
     */
    async goBack()    { const p = await getOrCreatePage(); if (p) { await p.goBack();    return { success: true, message: 'Went back' }; } return { success: false }; }
    async goForward() { const p = await getOrCreatePage(); if (p) { await p.goForward(); return { success: true, message: 'Went forward' }; } return { success: false }; }
    async reload()    { const p = await getOrCreatePage(); if (p) { await p.reload();    return { success: true, message: 'Page reloaded' }; } return { success: false }; }

    /**
     * Open a new tab.
     */
    async newTab(url = '') {
        const ctx = persistentCtx || (browser && browser.contexts && browser.contexts()[0]);
        if (!ctx) return { success: false, error: 'Browser not open' };
        try {
            const newPage = await ctx.newPage();
            if (url) await newPage.goto(url, { waitUntil: 'domcontentloaded' });
            page = newPage;
            return { success: true, message: `New tab opened${url ? ': ' + url : ''}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * Close the browser completely.
     */
    async close() {
        try {
            // For CDP connections, just disconnect — don't close the user's Chrome
            await disconnectBrowserSession();
            return { success: true, message: 'Browser session disconnected' };
        } catch (e) {
            browser = null; persistentCtx = null; page = null; browserMode = 'none';
            return { success: false, error: e.message };
        }
    }

    /**
     * Resolve which Gmail account slot (u/0, u/1, ...) belongs to the given email.
     * Returns the index (0-based) or -1 if not found.
     */
    async resolveGmailIndex(email) {
        if (!playwrightAvailable) return -1;
        const emailLower = email.toLowerCase().trim();
        // Try up to 5 account slots
        for (let i = 0; i < 5; i++) {
            try {
                const { page: p } = await ensureBrowser();
                await p.goto(`https://mail.google.com/mail/u/${i}/`, { waitUntil: 'domcontentloaded', timeout: 12000 });
                await delay(1500);
                const url = p.url();
                // Redirected to login/accounts page means this slot isn't logged in
                if (url.includes('accounts.google.com')) break;
                // Look for the signed-in email shown in page DOM
                const pageEmail = await p.evaluate(() => {
                    // Gmail exposes the account email in several places
                    const el =
                        document.querySelector('a[aria-label*="@"]') ||
                        document.querySelector('div[data-email]') ||
                        document.querySelector('[aria-label*="Google Account"]') ||
                        document.querySelector('span.gb_mb') ||
                        document.querySelector('div.gb_Cb');
                    if (el) {
                        const label = el.getAttribute('aria-label') || el.getAttribute('data-email') || el.innerText || '';
                        const match = label.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
                        return match ? match[0].toLowerCase() : '';
                    }
                    // Fallback: scan all text nodes
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    while (walker.nextNode()) {
                        const t = walker.currentNode.nodeValue || '';
                        const m = t.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
                        if (m) return m[0].toLowerCase();
                    }
                    return '';
                });
                if (pageEmail && pageEmail === emailLower) return i;
            } catch { break; }
        }
        return -1;
    }

    /**
     * Open Gmail for a specific email account.
     * - If the account is already signed in, navigates to its slot.
     * - If not found, navigates to account chooser / prompts login.
     */
    async openGmailAccount(email) {
        try {
            await ensureBrowser();
            const idx = email ? await this.resolveGmailIndex(email) : 0;
            const gmailUrl = idx >= 0
                ? `https://mail.google.com/mail/u/${idx}/`
                : 'https://mail.google.com';

            // Reuse an existing Gmail tab if available
            const p = await getOrNavigateTo('mail.google.com', gmailUrl);
            if (!p) return { success: false, error: 'Browser not open.' };

            // If the current Gmail tab is for a different account slot, navigate
            if (idx >= 0 && !p.url().includes(`/u/${idx}/`)) {
                await p.goto(gmailUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            }

            if (idx >= 0) {
                return { success: true, message: `Opened Gmail for ${email} (account slot ${idx})`, accountIndex: idx };
            }
            // Account not found — navigate to account chooser
            const chooserUrl = email
                ? `https://accounts.google.com/AccountChooser?Email=${encodeURIComponent(email)}&continue=https://mail.google.com`
                : 'https://mail.google.com';
            await p.goto(chooserUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
            return {
                success: true,
                message: `Account ${email} not found in signed-in accounts. Opened account chooser — please sign in.`,
                needsLogin: true
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /** Helper: try multiple selectors to fill a field */
    async _fillField(p, selectors, value) {
        for (const sel of selectors) {
            try {
                await p.waitForSelector(sel, { timeout: 3000, state: 'visible' });
                await p.fill(sel, value);
                return true;
            } catch {}
        }
        return false;
    }

    async _clickFirstSelector(p, selectors, timeout = 3000) {
        for (const sel of selectors) {
            try {
                await p.waitForSelector(sel, { timeout, state: 'visible' });
                await p.click(sel, { timeout });
                return true;
            } catch {}
        }
        return false;
    }

    async _waitForGmailReady(p, maxAttempts = 15) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const ready = await p.evaluate(() => {
                return !!document.querySelector('div[gh="cm"]') ||
                       !!document.querySelector('[data-tooltip="Compose"]') ||
                       !!document.querySelector('[aria-label="Compose"]') ||
                       !!document.querySelector('input[name="to"]') ||
                       !!document.querySelector('table[role="grid"]') ||
                       !!document.querySelector('div[role="navigation"]');
            }).catch(() => false);
            if (ready) return true;
            await delay(1200);
        }
        return false;
    }

    /**
     * Compose and optionally send Gmail through DOM selectors.
     */
    async openGmailComposeInUserChrome(params = {}, cause = null) {
        const to = String(params.to || params.recipient || params.email || '').trim();
        const subject = String(params.subject || 'Message from Pecifics').trim();
        const body = String(params.body || params.message || params.text || '').trim();
        const shouldSend = params.send !== false;

        if (!to) return { success: false, error_class: 'missing_parameters', error: 'No recipient provided' };
        if (!body) return { success: false, error_class: 'missing_parameters', error: 'No email body provided' };

        const composeUrl =
            `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}` +
            `&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        const opened = await shellOpenUrl(composeUrl);
        if (!opened.success) {
            return { success: false, error_class: 'browser_open_failed', error: opened.error || 'Could not open Gmail in Chrome' };
        }

        if (shouldSend) {
            return {
                success: false,
                needs_user: true,
                error_class: 'chrome_cdp_unavailable_for_send',
                error: `Gmail send requires the Pecifics Chrome profile with CDP. Please log into Gmail once in the Pecifics Chrome window, then retry. ${cause ? cause.message : ''}`.trim(),
                to,
                subject,
            };
        }

        return {
            success: true,
            drafted: true,
            message: `Opened Gmail draft in your real Chrome profile for ${to}: "${subject}"`,
            to,
            subject,
        };
    }

    async composeGmail(params = {}) {
        const to = String(params.to || params.recipient || params.email || '').trim();
        const subject = String(params.subject || 'Message from Pecifics').trim();
        const body = String(params.body || params.message || params.text || '').trim();
        const accountEmail = String(params.account_email || params.from || '').trim();
        const shouldSend = params.send !== false;

        if (!to) return { success: false, error_class: 'missing_parameters', error: 'No recipient provided' };
        if (!body) return { success: false, error_class: 'missing_parameters', error: 'No email body provided' };

        try {
            try {
                await ensureBrowser();
            } catch (bridgeError) {
                if (shouldSend) {
                    return {
                        success: false,
                        needs_user: true,
                        error_class: 'chrome_cdp_unavailable_for_send',
                        error: `Gmail send requires the Pecifics Chrome profile with CDP. Please log into Gmail once in the Pecifics Chrome window, then retry. ${bridgeError.message}`,
                        to,
                        subject,
                    };
                }
                return await this.openGmailComposeInUserChrome(params, bridgeError);
            }
            let gmailUrl = 'https://mail.google.com/mail/#compose';
            if (accountEmail) {
                const idx = await this.resolveGmailIndex(accountEmail);
                if (idx >= 0) gmailUrl = `https://mail.google.com/mail/u/${idx}/#compose`;
            }

            const p = await getOrNavigateTo('mail.google.com', gmailUrl);
            if (!p) return { success: false, error_class: 'browser_not_open', error: 'Browser is not open' };
            await p.bringToFront().catch(() => {});
            if (!/#compose/.test(p.url())) {
                const baseUrl = p.url().split('#')[0] || gmailUrl.split('#')[0];
                await p.goto(`${baseUrl}#compose`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
            }
            await delay(1800);

            const recoveryCheck = await this.executeWithBlockerRecovery(p, async () => {
                const state = await this.probeBrowserState(p, { app: 'gmail', account_email: accountEmail });
                if (state.blocker) {
                    return {
                        success: false,
                        blocker: state.blocker,
                        error_class: state.blocker,
                        needs_user: true,
                        state,
                    };
                }
                return { success: true, state };
            }, { app: 'gmail', account_email: accountEmail });

            let state = recoveryCheck.state || await this.probeBrowserState(p, { app: 'gmail', account_email: accountEmail });
            if (recoveryCheck.success === false || state.blocker) {
                return {
                    success: false,
                    error_class: recoveryCheck.error_class || state.blocker,
                    blocker: recoveryCheck.blocker || state.blocker,
                    needs_user: true,
                    error: recoveryCheck.error || `Gmail is blocked by ${state.blocker}. Please resolve it in Chrome, then run the command again.`,
                    state,
                    blockers_encountered: recoveryCheck.blockers_encountered || [],
                    blockers_resolved: recoveryCheck.blockers_resolved || [],
                    resolution_path: recoveryCheck.resolution_path || [],
                };
            }

            const ready = await this._waitForGmailReady(p);
            if (!ready) {
                return { success: false, error_class: 'timeout', error: 'Gmail did not finish loading', state };
            }

            let composeReady = await p.locator('input[name="to"], input[aria-label="To recipients"], [aria-label="To"]').count().catch(() => 0);
            if (!composeReady) {
                await p.goto(`${p.url().split('#')[0]}#compose`, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUTS.gmail_compose_open }).catch(() => {});
                await delay(1800);
                composeReady = await p.locator('input[name="to"], input[aria-label="To recipients"], [aria-label="To"]').count().catch(() => 0);
            }
            if (!composeReady) {
                // 5.1: Use findElement fallback chain for compose button
                try {
                    const composeBtn = await findElement(p, [
                        'div[gh="cm"]',
                        '[data-tooltip="Compose"]',
                        '[aria-label="Compose"]',
                        'div.T-I.T-I-KE.L3',
                        'button:has-text("Compose")',
                        '[data-action-ids="compose"]',
                    ], 'Gmail Compose button', ACTION_TIMEOUTS.click);
                    await composeBtn.click();
                } catch {
                    await this._clickFirstSelector(p, ['div[gh="cm"]', '[data-tooltip="Compose"]', '[aria-label="Compose"]'], 3000);
                }
                await delay(1800);
            }

            const toFilled = await this._fillField(p, [
                'input[name="to"]',
                'input[aria-label="To recipients"]',
                'input[aria-label="To"]',
                'textarea[name="to"]',
                // 5.1: Additional fallback selectors
                '[data-tooltip*="recipients" i] input',
                'input.agP.aFw',
            ], to);
            if (!toFilled) return { success: false, error_class: 'element_not_found', error: 'Could not fill Gmail To field' };
            await p.keyboard.press('Tab').catch(() => {});
            await delay(300);

            const subjectFilled = await this._fillField(p, [
                'input[name="subjectbox"]',
                'input[aria-label="Subject"]',
                'input[placeholder="Subject"]',
            ], subject);
            if (!subjectFilled) return { success: false, error_class: 'element_not_found', error: 'Could not fill Gmail Subject field' };
            await delay(300);

            const bodySelectors = [
                'div[aria-label="Message Body"]',
                'div[aria-label*="Message Body"]',
                'div[role="textbox"][aria-label*="body" i]',
                'div.Am.Al.editable.LW-avf',
                'div[contenteditable="true"][aria-label]',
            ];
            let bodyFilled = false;
            for (const sel of bodySelectors) {
                try {
                    await p.waitForSelector(sel, { timeout: 4000, state: 'visible' });
                    await p.click(sel, { timeout: 2000 });
                    await p.keyboard.insertText(body);
                    bodyFilled = true;
                    break;
                } catch {}
            }
            if (!bodyFilled) return { success: false, error_class: 'element_not_found', error: 'Could not fill Gmail message body' };

            if (!shouldSend) {
                return {
                    success: true,
                    drafted: true,
                    message: `Drafted Gmail to ${to}: "${subject}"`,
                    to,
                    subject,
                    blockers_encountered: recoveryCheck.blockers_encountered || [],
                    blockers_resolved: recoveryCheck.blockers_resolved || [],
                    resolution_path: recoveryCheck.resolution_path || [],
                };
            }

            const sent = await this._clickFirstSelector(p, [
                'div[aria-label="Send"]',
                '[aria-label="Send"]',
                'div[data-tooltip="Send"]',
                'div[role="button"][aria-label*="Send"]',
            ], 5000);
            if (!sent) {
                await p.keyboard.press('Control+Enter').catch(() => {});
            }
            await delay(1800);
            const stillComposing = await p.locator('input[name="subjectbox"]').count().catch(() => 0);
            return {
                success: true,
                verified: !stillComposing,
                message: `Email sent to ${to}: "${subject}"`,
                to,
                subject,
                blockers_encountered: recoveryCheck.blockers_encountered || [],
                blockers_resolved: recoveryCheck.blockers_resolved || [],
                resolution_path: recoveryCheck.resolution_path || [],
            };
        } catch (e) {
            return { success: false, error_class: 'gmail_compose_error', error: e.message };
        }
    }

    /**
     * Send an email via Gmail web interface (Playwright).
     * Uses keyboard shortcuts for maximum reliability.
     */
    async sendGmail(to, subject, body, accountEmail = '') {
        return await this.composeGmail({ to, subject, body, account_email: accountEmail, send: true });
        await ensureBrowser();

        try {
            // ── 1. Find or navigate to Gmail (reuse existing tab) ──
            let gmailUrl = 'https://mail.google.com';
            if (accountEmail) {
                const idx = await this.resolveGmailIndex(accountEmail);
                if (idx >= 0) gmailUrl = `https://mail.google.com/mail/u/${idx}/`;
            }

            // Reuse an existing Gmail tab if one is already open
            const p = await getOrNavigateTo('mail.google.com', gmailUrl);
            if (!p) return { success: false, error: 'Browser not open.' };

            // ── 2. Wait for Gmail to ACTUALLY load (inbox or compose visible) ──
            const gmailReady = async () => {
                // Give Gmail generous time to fully load
                for (let attempt = 0; attempt < 15; attempt++) {
                    const ready = await p.evaluate(() => {
                        // Gmail is loaded when we see the compose button OR the inbox
                        return !!document.querySelector('div[gh="cm"]') ||
                               !!document.querySelector('[data-tooltip="Compose"]') ||
                               !!document.querySelector('div.T-I.T-I-KE.L3') ||
                               !!document.querySelector('div[role="navigation"]') ||
                               !!document.querySelector('table[role="grid"]') ||
                               !!document.querySelector('.aim');
                    }).catch(() => false);
                    if (ready) return true;
                    await delay(1500);
                }
                return false;
            };
            const loaded = await gmailReady();
            if (!loaded) {
                // Fallback: try compose URL directly
                await p.goto(gmailUrl + '#compose', { waitUntil: 'domcontentloaded', timeout: 20000 });
                await delay(4000);
            }

            // Handle any cookie banners / consent dialogs
            await this.autoHandleBlockers();
            await delay(500);

            // ── 3. Open Compose (multiple strategies) ──
            let composed = false;

            // Strategy A: Direct compose URL (most reliable — no need for keyboard shortcuts)
            if (!composed) {
                try {
                    const composeCheck = await p.evaluate(() => {
                        return !!document.querySelector('input[name="to"]') ||
                               !!document.querySelector('[aria-label="To recipients"]') ||
                               !!document.querySelector('div[aria-label="New Message"]');
                    });
                    if (composeCheck) composed = true;
                } catch {}
            }

            if (!composed) {
                try {
                    const currentUrl = p.url();
                    if (!currentUrl.includes('#compose')) {
                        // Navigate to compose via URL hash
                        const baseUrl = currentUrl.split('#')[0];
                        await p.goto(baseUrl + '#compose', { waitUntil: 'domcontentloaded', timeout: 15000 });
                        await delay(3000);
                        const check = await p.evaluate(() => {
                            return !!document.querySelector('input[name="to"]') ||
                                   !!document.querySelector('[aria-label="To recipients"]');
                        }).catch(() => false);
                        if (check) composed = true;
                    }
                } catch {}
            }

            // Strategy B: Click the Compose button
            if (!composed) {
                const composeSelectors = [
                    'div[gh="cm"]',
                    '.T-I.T-I-KE.L3',
                    '[data-tooltip="Compose"]',
                    '[aria-label="Compose"]',
                ];
                for (const sel of composeSelectors) {
                    try { await p.click(sel, { timeout: 3000 }); await delay(2000); composed = true; break; } catch {}
                }
            }

            // Strategy C: JS — click any element whose text says "Compose"
            if (!composed) {
                composed = await p.evaluate(() => {
                    const els = document.querySelectorAll('div[role="button"], button, a, span');
                    for (const el of els) {
                        if ((el.textContent || '').trim() === 'Compose') { el.click(); return true; }
                    }
                    return false;
                }).catch(() => false);
                if (composed) await delay(2000);
            }

            // Strategy D: Keyboard shortcut 'c' (needs Gmail shortcuts enabled)
            if (!composed) {
                try {
                    await p.click('body', { timeout: 2000 }).catch(() => {});
                    await delay(300);
                    await p.keyboard.press('c');
                    await delay(2500);
                    composed = await p.evaluate(() => {
                        return !!document.querySelector('input[name="to"]') ||
                               !!document.querySelector('[aria-label="To recipients"]');
                    }).catch(() => false);
                } catch {}
            }

            if (!composed) return { success: false, error: 'Could not open Compose. Make sure Gmail is fully loaded and you are logged in.' };
            await delay(1500);

            // ── 4. Fill To field ──
            const toFilled = await this._fillField(p, [
                'input[name="to"]',
                'input[aria-label="To recipients"]',
                'input[aria-label="To"]',
                'textarea[name="to"]',
            ], to);
            if (!toFilled) return { success: false, error: 'Could not fill To field' };
            await p.keyboard.press('Tab');
            await delay(500);

            // ── 5. Fill Subject field ──
            await this._fillField(p, [
                'input[name="subjectbox"]',
                'input[aria-label="Subject"]',
                'input[placeholder="Subject"]',
            ], subject);
            await delay(500);

            // ── 6. Fill Body ──
            const bodySelectors = [
                'div[aria-label="Message Body"]',
                'div[aria-label*="Message Body"]',
                'div.Am.Al.editable.LW-avf',
                'div[role="textbox"][aria-label*="body" i]',
                'div[contenteditable="true"][aria-label]',
            ];
            let bodyFilled = false;
            for (const sel of bodySelectors) {
                try {
                    await p.click(sel, { timeout: 3000 });
                    await p.keyboard.type(body, { delay: 10 });
                    bodyFilled = true;
                    break;
                } catch {}
            }
            if (!bodyFilled) {
                // Fallback: Tab into body area and type
                await p.keyboard.press('Tab');
                await delay(300);
                await p.keyboard.type(body, { delay: 10 });
            }
            await delay(500);

            // ── 7. Send via Ctrl+Enter ──
            await p.keyboard.press('Control+Enter');
            await delay(2000);
            return { success: true, message: `Email sent to ${to}: "${subject}"` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * YouTube control (play/pause/search)
     */
    async youtubeSearch(query) {
        const p = await getOrCreatePage();
        if (!p) {
            exec(`start "" "https://www.youtube.com/results?search_query=${encodeURIComponent(query)}"`);
            return { success: true, message: `Opened YouTube search for: ${query}` };
        }
        try {
            await p.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
            const results = await p.evaluate(() => {
                const vids = [];
                document.querySelectorAll('ytd-video-renderer a#video-title').forEach(a => {
                    if (vids.length < 5) vids.push({ title: a.innerText, url: 'https://youtube.com' + a.getAttribute('href') });
                });
                return vids;
            });
            return { success: true, results, message: `Found ${results.length} YouTube results for: ${query}` };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async youtubePlay(query) {
        if (!query || !String(query).trim()) {
            return { success: false, error: 'No YouTube search query provided' };
        }

        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query || '')}`;
        try {
            const watchUrl = await resolveYouTubeWatchUrl(query);
            const opened = await shellOpenUrl(watchUrl);
            if (opened.success) {
                return { success: true, message: `Playing YouTube video for: ${query}`, url: watchUrl };
            }
            throw new Error(opened.error || 'Could not open resolved YouTube URL');
        } catch (directErr) {
            console.warn(`[browser-dom-engine] Direct YouTube play failed, falling back to DOM/search: ${directErr.message}`);
        }

        const p = await getOrCreatePage();
        if (!p) {
            await shellOpenUrl(searchUrl);
            return { success: true, message: `Opened YouTube search for: ${query}` };
        }
        try {
            await p.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await p.waitForSelector('ytd-video-renderer a#video-title, a#video-title', { timeout: 12000 }).catch(() => {});
            const first = p.locator('ytd-video-renderer a#video-title, a#video-title').first();
            const title = await first.innerText({ timeout: 5000 }).catch(() => query);
            await first.click({ timeout: 8000 });
            await p.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            return { success: true, message: `Playing YouTube video: ${title || query}`, title };
        } catch (e) {
            return { success: false, error: `Could not play YouTube video: ${e.message}` };
        }
    }

    // Click by visible text (more reliable than coordinates)
    async clickByText(text, options = {}) {
        console.log(`[browser-dom-engine] Clicking element with text: "${text}"`);
        const page = await getOrCreatePage();
        if (!page) return { success: false, error: 'Browser is not open' };
        
        const exact = options.exact !== false;
        
        // Try multiple strategies
        try {
            // Strategy 1: exact/inexact text match
            await page.getByText(text, { exact }).first().click({ timeout: 5000 });
            return { success: true, method: 'text' };
        } catch {
            try {
                // Strategy 2: role-based (button, link, etc)
                await page.getByRole('button', { name: text }).first().click({ timeout: 3000 });
                return { success: true, method: 'role_button' };
            } catch {
                try {
                    await page.getByRole('link', { name: text }).first().click({ timeout: 3000 });
                    return { success: true, method: 'role_link' };
                } catch {
                    try {
                        // Strategy 3: placeholder text (for inputs)
                        await page.getByPlaceholder(text).first().click({ timeout: 3000 });
                        return { success: true, method: 'placeholder' };
                    } catch {
                        try {
                            // Strategy 4: CSS locator fallback
                            await page.locator(`text=${text}`).first().click({ timeout: 3000 });
                            return { success: true, method: 'css_text' };
                        } catch (err) {
                            return { success: false, error: `Element with text "${text}" not found: ${err.message}` };
                        }
                    }
                }
            }
        }
    }

    // Type into a field identified by label/placeholder/name
    async typeInField(fieldIdentifier, text) {
        console.log(`[browser-dom-engine] Typing into field "${fieldIdentifier}"`);
        const page = await getOrCreatePage();
        if (!page) return { success: false, error: 'Browser is not open' };
        
        try {
            const field = page.getByLabel(fieldIdentifier).or(
                page.getByPlaceholder(fieldIdentifier)
            ).or(
                page.locator(`[name="${fieldIdentifier}"]`)
            ).or(
                page.locator(`[id="${fieldIdentifier}"]`)
            ).first();
            
            await field.fill(text);
            return { success: true };
        } catch (err) {
            try {
                // Strategy 2: Click then type direct keyboard input
                await page.click(`input[placeholder*="${fieldIdentifier}" i], input[id*="${fieldIdentifier}" i], input[name*="${fieldIdentifier}" i]`, { timeout: 3000 });
                await page.keyboard.insertText(text);
                return { success: true, method: 'fallback_click_type' };
            } catch (err2) {
                return { success: false, error: `Field "${fieldIdentifier}" not found: ${err2.message}` };
            }
        }
    }

    // Extract structured data from current page
    async extractPageData(dataType) {
        console.log(`[browser-dom-engine] Extracting data type: "${dataType}"`);
        const page = await getOrCreatePage();
        if (!page) return { success: false, error: 'Browser is not open' };
        
        try {
            switch (dataType) {
                case 'title':
                    return { success: true, data: await page.title() };
                case 'text':
                    return { success: true, data: await page.innerText('body') };
                case 'links':
                    const links = await page.$$eval('a[href]', els => 
                        els.map(el => ({ text: el.innerText.trim(), href: el.href })).slice(0, 40)
                    );
                    return { success: true, data: links };
                case 'inputs':
                    const inputs = await page.$$eval('input,textarea,select', els =>
                        els.map(el => ({ type: el.type, name: el.name, placeholder: el.placeholder, id: el.id }))
                    );
                    return { success: true, data: inputs };
                default:
                    return { success: true, data: await page.content() };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // Smart browser action dispatcher for the browser engine
    async executeBrowserEngine(operation, params = {}) {
        console.log(`[browser-dom-engine] Executing browser operation: "${operation}"`);
        try {
            switch (operation) {
                case 'search':
                    return await this.googleSearch(params.query);
                case 'youtube_search':
                    return await this.youtubeSearch(params.query);
                case 'play_video':
                case 'youtube_play':
                case 'play_youtube':
                    return await this.youtubePlay(params.query || params.video || params.title || params.search || params.prompt);
                case 'navigate':
                case 'navigate_url':
                case 'open_url':
                case 'open':
                    return await this.open(params.url);
                case 'navigate_and_login':
                case 'browser_navigate_login':
                case 'browser_navigate_and_login':
                    return await this.navigateAndLogin(params);
                case 'click_text':
                    return await this.clickByText(params.text, params.options);
                case 'type_field':
                    return await this.typeInField(params.field || params.fieldIdentifier, params.text);
                case 'extract':
                    return await this.extractPageData(params.data_type || params.dataType || 'text');
                case 'probe_state':
                case 'browser_probe_state':
                    return await this.probeBrowserState(params);
                case 'gamma_probe':
                case 'gamma_state':
                    return await this.gammaProbeState(params);
                case 'gamma_create_presentation':
                case 'create_gamma_presentation':
                    return await this.gammaCreatePresentation(params.topic, params.instructions || params.prompt, params);
                case 'gmail_compose':
                case 'compose_gmail':
                case 'send_gmail':
                    return await this.composeGmail(params);
                case 'google_forms_fill':
                case 'google_form_fill':
                case 'fill_google_form':
                    return await this.fillGoogleForm(params);
                case 'google_forms_intelligent_fill':
                case 'intelligent_google_form_fill':
                    return await this.fillGoogleForm({ ...params, auto_answer: true });
                case 'go_back':
                    const pBack = await getOrCreatePage();
                    if (pBack) {
                        await pBack.goBack();
                        return { success: true, message: 'Went back' };
                    }
                    return { success: false, error: 'Browser is not open' };
                case 'reload':
                    const pReload = await getOrCreatePage();
                    if (pReload) {
                        await pReload.reload();
                        return { success: true, message: 'Page reloaded' };
                    }
                    return { success: false, error: 'Browser is not open' };
                case 'take_screenshot':
                    const pSnap = await getOrCreatePage();
                    if (pSnap) {
                        const snap = await pSnap.screenshot({ type: 'jpeg', quality: 80 });
                        return { success: true, screenshot: snap.toString('base64') };
                    }
                    return { success: false, error: 'Browser is not open' };
                case 'run_script':
                    const pScript = await getOrCreatePage();
                    if (pScript) {
                        const scriptResult = await pScript.evaluate(params.script);
                        return { success: true, result: scriptResult };
                    }
                    return { success: false, error: 'Browser is not open' };
                case 'fill_form':
                    if ((params.url && /docs\.google\.com\/forms/i.test(params.url)) || /docs\.google\.com\/forms/i.test(page?.url?.() || '')) {
                        return await this.fillGoogleForm(params);
                    }
                    for (const [field, value] of Object.entries(params.fields || {})) {
                        await this.typeInField(field, value);
                    }
                    return { success: true };
                default:
                    return { success: false, error: `Unknown browser operation: ${operation}` };
            }
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    /**
     * Check if Playwright is available.
     */
    isAvailable() { return playwrightAvailable; }

    /**
     * Install Playwright and browsers (runs npm install).
     */
    async installPlaywright() {
        return new Promise((resolve) => {
            const appDir = path.join(__dirname, '..', '..');
            const child = spawn('cmd.exe', ['/c', 'npm install playwright && npx playwright install chromium'], {
                cwd: appDir,
                stdio: 'pipe',
                shell: true,
            });
            let output = '';
            child.stdout.on('data', d => { output += d.toString(); });
            child.stderr.on('data', d => { output += d.toString(); });
            child.on('close', (code) => {
                if (code === 0) {
                    // Reload playwright
                    try {
                        playwright = require('playwright');
                        chromium   = playwright.chromium;
                        playwrightAvailable = true;
                    } catch {}
                    resolve({ success: true, message: 'Playwright installed. Browser automation now available.' });
                } else {
                    resolve({ success: false, error: output.slice(-500), message: 'Playwright install failed' });
                }
            });
        });
    }
}

module.exports = new BrowserAutomation();
