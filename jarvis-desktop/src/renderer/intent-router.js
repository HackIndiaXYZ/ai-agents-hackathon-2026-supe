(function () {
    function compact(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function stripQuotes(value) {
        return compact(value).replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    function action(name, parameters) {
        return { name, parameters: parameters || {} };
    }

    const SITE_SHORTCUTS = {
        amazon: 'https://www.amazon.in',
        'amazon.in': 'https://www.amazon.in',
        'amazon.com': 'https://www.amazon.com',
        youtube: 'https://www.youtube.com',
        gmail: 'https://mail.google.com',
        google: 'https://www.google.com',
        gamma: 'https://gamma.app',
        'gamma.app': 'https://gamma.app',
        github: 'https://github.com',
        linkedin: 'https://www.linkedin.com',
        twitter: 'https://www.x.com',
        x: 'https://www.x.com',
        instagram: 'https://www.instagram.com',
        reddit: 'https://www.reddit.com',
        netflix: 'https://www.netflix.com',
        spotify: 'https://open.spotify.com',
        flipkart: 'https://www.flipkart.com',
        myntra: 'https://www.myntra.com',
        figma: 'https://www.figma.com',
        notion: 'https://www.notion.so',
        canva: 'https://www.canva.com',
        chatgpt: 'https://chat.openai.com',
        openai: 'https://chat.openai.com',
        claude: 'https://claude.ai',
        gemini: 'https://gemini.google.com',
        whatsapp: 'https://web.whatsapp.com',
        trello: 'https://trello.com',
        slack: 'https://app.slack.com',
        drive: 'https://drive.google.com',
        'google drive': 'https://drive.google.com',
        docs: 'https://docs.google.com',
        sheets: 'https://sheets.google.com',
    };


    function resolveUrl(raw) {
        let target = compact(raw).toLowerCase().replace(/\s+/g, '').replace(/\.$/, '');
        target = target.replace('amaazon', 'amazon').replace('gogle', 'google');
        if (!target) return '';
        if (/^https?:\/\//i.test(target)) return target;
        if (SITE_SHORTCUTS[target]) return SITE_SHORTCUTS[target];
        if (target.includes('.')) return target.startsWith('www.') ? `https://${target}` : `https://www.${target}`;
        return `https://www.${target}.com`;
    }

    function siteSearchUrl(site, query) {
        const siteKey = compact(site).toLowerCase().replace(/^www\./, '');
        const q = encodeURIComponent(compact(query));
        if (!siteKey || !q) return '';
        if (siteKey === 'amazon' || siteKey === 'amazon.in') return `https://www.amazon.in/s?k=${q}`;
        if (siteKey === 'amazon.com') return `https://www.amazon.com/s?k=${q}`;
        if (siteKey === 'flipkart' || siteKey === 'flipkart.com') return `https://www.flipkart.com/search?q=${q}`;
        if (siteKey === 'myntra' || siteKey === 'myntra.com') return `https://www.myntra.com/${q}`;
        if (siteKey === 'youtube' || siteKey === 'youtube.com') return `https://www.youtube.com/results?search_query=${q}`;
        if (siteKey === 'google' || siteKey === 'google.com') return `https://www.google.com/search?q=${q}`;
        return '';
    }

    function extractNavigationTarget(raw) {
        const text = compact(raw);
        const patterns = [
            /\b(?:open|launch|start)\s+chrome\s+(?:and\s+)?(?:go to|open|visit)?\s*([a-zA-Z0-9][a-zA-Z0-9-.]*)/i,
            /\b(?:go to|open|visit|navigate to|browse to|take me to)\s+(?:chrome\s+(?:and\s+)?)?([a-zA-Z0-9][a-zA-Z0-9-.]*)/i,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] && !/^(chrome|browser)$/i.test(match[1])) return match[1];
        }
        return null;
    }

    function isReferenceTarget(target) {
        return /^(both|it|that|this|them|those|these|all|results?|folders?|files?)$/i.test(compact(target));
    }

    function navigationLoginMethod(raw) {
        const lower = compact(raw).toLowerCase();
        if (!/\b(?:login|log in|sign in|signin|using my|with my)\b/.test(lower)) return null;
        if (/\b(?:google|gmail|gogle|gamil)\b/.test(lower)) return 'google_oauth';
        if (/\b(?:saved|credential|account)\b/.test(lower)) return 'saved_credentials';
        return 'site_default';
    }

    function isComplexNavigationInstruction(raw) {
        const lower = compact(raw).toLowerCase();
        if (!extractNavigationTarget(raw)) return false;
        const followupWork = /\b(search|find|look\s+for|click|select|choose|filter|sort|fill|answer|compare|add\s+to\s+cart|cart|under|less\s+than|below|price)\b/.test(lower);
        const sequenced = /\b(and then|then|after that|next|continue)\b/.test(lower);
        return followupWork || sequenced;
    }

    function topicFromPresentationText(text) {
        const raw = compact(text);
        const patterns = [
            /\b(?:ppt|presentation|slides|deck)\s+for\s+me\s+(?:on|about)\s+(.+)$/i,
            /\bfor\s+me\s+(?:on|about)\s+(.+)$/i,
            /\b(?:ppt|presentation|slides|deck)\s+(?:for|on|about)\s+(.+)$/i,
            /\b(?:for|on|about)\s+(.+)$/i,
        ];
        for (const pattern of patterns) {
            const match = raw.match(pattern);
            if (match && stripQuotes(match[1])) return stripQuotes(match[1]);
        }
        return stripQuotes(raw.replace(/\b(?:open|go|to|login|with|google|account|gam{1,4}a(?:\.app)?|create|make|generate|build|a|an|ppt|presentation|slides|deck|for me)\b/gi, ' ')) || 'Presentation';
    }

    function buildGammaPlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (!/\bgam{1,4}a(?:\.app)?\b/.test(lower)) return null;
        if (!/\b(?:create|make|generate|build|login|open)\b/.test(lower)) return null;
        if (!/\b(?:ppt|presentation|slides|deck)\b/.test(lower)) return null;

        const afterGamma = text.split(/gam{1,4}a(?:\.app)?/i).slice(1).join('gamma.app') || text;
        const topic = topicFromPresentationText(afterGamma);
        const instructions = stripQuotes(
            afterGamma.replace(/^\s*(?:and|then)?\s*/i, '').replace(/\bgam{1,4}a(?:\.app)?\b/i, '')
        ) || `create a presentation about ${topic}`;

        return {
            message: `Creating a Gamma presentation about ${topic}.`,
            tasks: [{
                id: 1,
                description: `Create Gamma presentation: ${topic}`,
                protocol_id: 'gamma.create_presentation',
                capability: 'create_presentation',
                engine: 'browser_recipe',
                dependsOn: null,
                depends_on: [],
                parallel: false,
                needs_input: false,
                input_fields: [],
                actions: [action('gamma_create_presentation', {
                    topic,
                    instructions,
                    url: 'https://gamma.app'
                })]
            }],
            expected_result: `Gamma presentation workflow started for ${topic}`,
            fast_path: true,
            engine: 'browser_recipe',
            protocol_id: 'gamma.create_presentation'
        };
    }

    // ── MS Word document creation fast-path ─────────────────────────────────
    function buildWordDocPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:word|ms word|microsoft word|\.docx?)\b/.test(lower)) return null;
        if (!/\b(?:create|make|write|generate|draft|build)\b/.test(lower)) return null;

        let topic = '';
        const topicPatterns = [
            /\b(?:create|make|write|generate|draft|build)\s+(?:a\s+)?(?:word\s+)?(?:doc(?:ument)?|report|letter|essay|proposal|summary|article)\s+(?:about|on|for|regarding|titled?)\s+(.+?)(?:\s+in\s+(?:ms\s+)?word)?$/i,
            /\b(?:create|make|write|generate|draft|build)\s+(?:a\s+)?(?:ms\s+word|microsoft\s+word|word)\s+(?:doc(?:ument)?|report|letter|file)\s+(?:about|on|for|regarding)?\s*(.+)$/i,
            /\b(?:create|make|write|generate|draft|build)\s+(?:a\s+)?(?:ms\s+word|microsoft\s+word|word)\s+(.+?)(?:\s+doc(?:ument)?)?$/i,
        ];
        for (const pat of topicPatterns) {
            const m = raw.match(pat);
            if (m && m[1] && m[1].trim().split(/\s+/).length >= 2) {
                topic = stripQuotes(m[1].replace(/\bin\s+(?:ms\s+)?word\b/i, '').replace(/\.\s*$/, ''));
                break;
            }
        }
        if (!topic) return null;

        let style = 'professional';
        if (/\b(?:academic|formal|research|essay|thesis)\b/i.test(raw)) style = 'academic';
        else if (/\b(?:casual|informal|simple)\b/i.test(raw)) style = 'casual';
        else if (/\b(?:report|analysis)\b/i.test(raw)) style = 'report';

        return {
            message: `Creating a Word document about "${topic}".`,
            tasks: [{ id: 1, description: `Create Word document: ${topic}`,
                protocol_id: 'msword.create_document', capability: 'create_word_document',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false,
                needs_input: false, input_fields: [],
                actions: [action('create_word_document', { topic, style })]
            }],
            expected_result: `Word document created on Desktop about ${topic}`,
            fast_path: true, engine: 'action', protocol_id: 'msword.create_document'
        };
    }

    // ── MS Excel spreadsheet creation fast-path ───────────────────────────────
    function buildExcelSheetPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:excel|ms excel|microsoft excel|spreadsheet|xlsx?)\b/.test(lower)) return null;
        if (!/\b(?:create|make|build|generate|prepare|draft)\b/.test(lower)) return null;

        let topic = '';
        const topicPatterns = [
            /\b(?:create|make|build|generate|prepare|draft)\s+(?:a\s+)?(?:excel|ms\s*excel|microsoft\s*excel|spreadsheet)\s+(?:for|about|on|regarding|of)?\s*(.+?)(?:\s+in\s+(?:ms\s+)?excel)?$/i,
            /\b(?:create|make|build|generate|prepare|draft)\s+(?:a\s+)?(?:ms\s+excel|microsoft\s+excel|excel)\s+(.+?)(?:\s+sheet|\s+file|\s+workbook)?$/i,
        ];
        for (const pat of topicPatterns) {
            const m = raw.match(pat);
            if (m && m[1] && m[1].trim().split(/\s+/).length >= 2) {
                topic = stripQuotes(m[1].replace(/\bin\s+(?:ms\s+)?excel\b/i, '').replace(/\.\s*$/, ''));
                break;
            }
        }
        if (!topic) return null;

        return {
            message: `Creating an Excel spreadsheet for "${topic}".`,
            tasks: [{ id: 1, description: `Create Excel spreadsheet: ${topic}`,
                protocol_id: 'msexcel.create_spreadsheet', capability: 'create_excel_spreadsheet',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false,
                needs_input: false, input_fields: [],
                actions: [action('create_excel_spreadsheet', { topic })]
            }],
            expected_result: `Excel spreadsheet created on Desktop for ${topic}`,
            fast_path: true, engine: 'action', protocol_id: 'msexcel.create_spreadsheet'
        };
    }

    function buildCredentialPlan(raw) {
        const text = compact(raw);
        const patterns = [
            /\bsave\s+(?:my\s+)?google\s+account\b/i,
            /\bstore\s+(?:my\s+)?google\s+(?:account|credentials|login|password)\b/i,
            /\bremember\s+(?:my\s+)?google\s+account\b/i,
            /\badd\s+(?:my\s+)?google\s+account\b/i,
        ];
        if (!patterns.some(pattern => pattern.test(text))) return null;
        return {
            message: 'Saving Google account credentials securely.',
            tasks: [{
                id: 1,
                description: 'Save Google account credentials securely',
                protocol_id: 'credentials.save_google_account',
                capability: 'save_google_account',
                needs_input: false,
                input_fields: [],
                actions: [action('save_google_credentials', {})],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'high',
                requires_confirmation: true,
            }],
            expected_result: 'Google credential saved in Windows Credential Manager.',
            fast_path: true,
            engine: 'credential',
            protocol_id: 'credentials.save_google_account',
            requires_confirmation: true,
        };
    }

    function buildChromeRelaunchPlan(raw) {
        const text = compact(raw);
        const patterns = [
            /\brelaunch\s+chrome\b/i,
            /\brestart\s+chrome\b/i,
            /\breopen\s+chrome\b/i,
            /\bclose\s+and\s+(?:re)?open\s+chrome\b/i,
        ];
        if (!patterns.some(pattern => pattern.test(text))) return null;
        return {
            message: 'Relaunching Chrome with the Pecifics debug bridge.',
            tasks: [{
                id: 1,
                description: 'Relaunch Chrome with remote debugging',
                protocol_id: 'system.relaunch_chrome',
                capability: 'relaunch_chrome',
                needs_input: false,
                input_fields: [],
                actions: [action('relaunch_chrome', {})],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'medium',
                requires_confirmation: true,
            }],
            expected_result: 'Chrome relaunched with remote debugging enabled.',
            fast_path: true,
            engine: 'system',
            protocol_id: 'system.relaunch_chrome',
            requires_confirmation: true,
        };
    }

    function buildNavigationPlan(raw) {
        if (isComplexNavigationInstruction(raw)) return null;
        const target = extractNavigationTarget(raw);
        if (!target) return null;
        if (isReferenceTarget(target)) return null;
        const url = resolveUrl(target);
        if (!url) return null;
        const method = navigationLoginMethod(raw);
        let site = '';
        try { site = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        return {
            message: method ? `Opening ${url} and attempting login.` : `Opening ${url}.`,
            tasks: [{
                id: 1,
                description: method ? `Open ${site || url} and attempt login` : `Open ${site || url}`,
                protocol_id: 'browser.navigate',
                capability: 'navigate',
                needs_input: false,
                input_fields: [],
                actions: [action('navigate_and_login', {
                    url,
                    login: Boolean(method),
                    login_method: method,
                    site,
                })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: method ? `${url} opened and login attempted.` : `${url} opened.`,
            fast_path: true,
            engine: 'browser',
            protocol_id: 'browser.navigate',
        };
    }

    function buildSiteSearchPlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (!/\b(search|find|look\s+for)\b/.test(lower)) return null;
        const target = extractNavigationTarget(text);
        if (!target) return null;
        const url = resolveUrl(target);
        let site = target;
        try { site = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        let query = extractSearchQuery(text)
            .replace(/\s+(?:on|in|at)\s+(?:amazon(?:\.in|\.com)?|flipkart|myntra|youtube|google).*$/i, '')
            .replace(/^\s*for\s+/i, '')
            .trim();
        const searchUrl = siteSearchUrl(site, query);
        if (!searchUrl || !query) return null;
        return {
            message: `Searching ${site} for: ${query}`,
            tasks: [{
                id: 1,
                description: `Search ${site}: ${query}`,
                protocol_id: 'browser.navigate',
                capability: 'site_search',
                needs_input: false,
                input_fields: [],
                actions: [action('navigate_and_login', {
                    url: searchUrl,
                    login: false,
                    login_method: null,
                    site,
                    query,
                })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: `${site} search results are open.`,
            fast_path: true,
            engine: 'browser',
            protocol_id: 'browser.navigate',
        };
    }

    function cleanWhatsAppContact(value) {
        return stripQuotes(value)
            .replace(/\b(?:open|launch)\b/gi, ' ')
            .replace(/\bwhats\s*app\b|\bwhatsapp\b|\bwa\b/gi, ' ')
            .replace(/\b(?:and|then|please|for|to|on|via|through|using|with)\b/gi, ' ')
            .replace(/\b(?:msg|message|send|text|tell|say|write|dm|search|find)\b/gi, ' ')
            .replace(/\b(?:her|him|them)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function parseWhatsAppMessageCommand(text) {
        const raw = compact(text);
        const lower = raw.toLowerCase();
        if (!/\b(?:whatsapp|whats\s*app|wa)\b/.test(lower)) return null;
        // Require an explicit send/message intent — prevent 'message me a reminder' routing here
        if (!/\b(?:msg|message|send|text|tell|dm)\s+(?!me\b)/.test(lower) &&
            !/\b(?:tell|say)\s+(?!me\b)/.test(lower)) return null;

        let contact = null;
        let message = null;

        const quoted = raw.match(/["']([^"']+)["']\s*$/);
        if (quoted) {
            message = stripQuotes(quoted[1]);
            const beforeQuote = raw.slice(0, quoted.index).trim();

            const searchContact = beforeQuote.match(/\b(?:search|find)\s+(?:for\s+)?(.+?)\s+(?:and\s+)?(?:msg|message|send|text|tell|dm)\s+(?:her|him|them)?\s*$/i);
            const toContact = beforeQuote.match(/\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s*$/i);
            contact = cleanWhatsAppContact((searchContact && searchContact[1]) || (toContact && toContact[1]) || beforeQuote);
        }

        if (!contact) {
            const colon = raw.match(/\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?([^:]+):\s*(.+)$/i);
            if (colon) {
                contact = cleanWhatsAppContact(colon[1]);
                message = stripQuotes(colon[2]);
            }
        }

        if (!contact) {
            const natural = raw.match(/\b(?:msg|message|send|text|tell|dm)\s+(?:to\s+)?(.+?)\s+\b(?:that|saying)\b\s+(.+)$/i);
            if (natural) {
                contact = cleanWhatsAppContact(natural[1]);
                message = stripQuotes(natural[2]);
            }
        }

        if (!contact) {
            let cleaned = raw
                .replace(/\b(?:open|launch)\s+whats\s*app(?:\s+and)?/gi, ' ')
                .replace(/\bwhatsapp\b|\bwhats app\b|\bwa\b/gi, ' ')
                .replace(/\b(?:msg|message|send|text|tell|say|write|dm)\b/gi, ' ')
                .replace(/\b(?:on|via|through|using|with)\b/gi, ' ')
                .trim();
            const parts = cleaned.split(/\s+/).filter(Boolean);
            if (parts.length >= 2) {
                contact = parts[0];
                message = parts.slice(1).join(' ');
            }
        }

        if (!contact || !message || contact.length < 2 || message.length < 1) return null;

        return {
            contact: cleanWhatsAppContact(contact),
            message: stripQuotes(message),
        };
    }

    function buildWhatsAppPlan(raw) {
        const parsed = parseWhatsAppMessageCommand(raw);
        if (!parsed) return null;

        return {
            message: `Sending WhatsApp message to ${parsed.contact}.`,
            tasks: [{
                id: 1,
                description: `Send WhatsApp message to ${parsed.contact}: "${parsed.message}"`,
                protocol_id: 'whatsapp.send_message',
                capability: 'send_message',
                needs_input: false,
                input_fields: [],
                actions: [action('send_whatsapp_message', {
                    contact: parsed.contact,
                    message: parsed.message,
                    send: true,
                })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'medium',
            }],
            expected_result: '',
            fast_path: true,
            engine: 'app',
            protocol_id: 'whatsapp.send_message'
        };
    }

    function parseTelegramMessageCommand(text) {
        const raw = compact(text);
        const lower = raw.toLowerCase();
        if (!/\b(?:telegram|tg)\b/.test(lower)) return null;
        const whatsappStyle = parseWhatsAppMessageCommand(
            raw.replace(/\btelegram\b|\btg\b/gi, 'whatsapp')
        );
        return whatsappStyle;
    }

    function buildTelegramPlan(raw) {
        const parsed = parseTelegramMessageCommand(raw);
        if (!parsed) return null;
        return {
            message: `Sending Telegram message to ${parsed.contact}.`,
            tasks: [{
                id: 1,
                description: `Send Telegram message to ${parsed.contact}: "${parsed.message}"`,
                protocol_id: 'telegram.send_message',
                capability: 'send_message',
                needs_input: false,
                input_fields: [],
                actions: [action('app_engine', {
                    app: 'telegram',
                    operation: 'send_message',
                    contact: parsed.contact,
                    message: parsed.message,
                    send: true,
                })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'medium',
                requires_confirmation: true,
            }],
            expected_result: '',
            fast_path: true,
            engine: 'app',
            protocol_id: 'telegram.send_message',
            requires_confirmation: true,
        };
    }

    function extractYouTubeQuery(raw) {
        return stripQuotes(compact(raw)
            .replace(/\b(?:please|open|go\s+to|search|find|play|watch|show|youtube|you\s*tube|on|from|in|any|video|scene)\b/gi, ' ')
            .replace(/\s+/g, ' ')) || 'video';
    }

    function extractSpotifyQuery(raw) {
        return stripQuotes(compact(raw)
            .replace(/\b(?:please|open|launch|start|play|put\s+on|listen\s+to|spotify|music|song|track|playlist|album|on|from|in)\b/gi, ' ')
            .replace(/\b(?:some|any)\s+music\b/gi, ' ')
            .replace(/\s+/g, ' '));
    }

    function buildSpotifyPlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (!/\bspotify\b/.test(lower)) return null;
        // Require an explicit play/listen intent word — prevent 'play it safe' etc.
        if (!/\b(?:play|listen\s+to|put\s+on|stream|queue)\b/.test(lower)) return null;
        // Guard: command must have at least 3 meaningful words after action word
        const query = extractSpotifyQuery(text);
        if (!query || query.split(/\s+/).filter(Boolean).length < 1) return null;
        return {
            message: `Playing Spotify music: ${query}`,
            tasks: [{
                id: 1,
                description: `Play Spotify: ${query}`,
                protocol_id: 'spotify.play',
                capability: 'play_music',
                needs_input: false,
                input_fields: [],
                actions: [action('app_engine', {
                    app: 'spotify',
                    operation: 'play_music',
                    query,
                })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: 'Spotify is playing or showing the requested search.',
            fast_path: true,
            engine: 'app',
            protocol_id: 'spotify.play'
        };
    }

    function buildYouTubePlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (!/\b(?:youtube|you\s*tube|yt)\b/.test(lower)) return null;
        // Require explicit video action — prevent 'search for my notes on youtube'
        if (!/\b(?:play|watch|show\s+me|search\s+on|find\s+on|look\s+up\s+on)\b/.test(lower)) return null;
        const query = extractYouTubeQuery(text);
        return {
            message: `Playing YouTube video for: ${query}`,
            tasks: [{
                id: 1,
                description: `Play YouTube video: ${query}`,
                protocol_id: 'youtube.play_video',
                capability: 'play_video',
                needs_input: false,
                input_fields: [],
                actions: [action('browser_play_video', { query })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: 'YouTube video is opened.',
            fast_path: true,
            engine: 'browser',
            protocol_id: 'youtube.play_video'
        };
    }

    function extractSearchQuery(raw) {
        const text = compact(raw);
        const match = text.match(/\bsearch\s+(?:google|web|internet)\s+(?:for\s+)?(.+)$/i)
            || text.match(/\b(?:search|google|look up|find)\s+(?:web\s+)?(?:for\s+)?(.+)$/i);
        const query = match ? match[1] : text;
        return stripQuotes(query.replace(/\b(?:on|in)\s+(?:google|web|internet)$/i, '')) || 'search';
    }

    function buildGoogleSearchPlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (/\bgoogle\s+form\b|forms\.gle|docs\.google\.com\/forms/.test(lower)) return null;
        if (/^(?:also\s+|and\s+also\s+|now\s+|then\s+|next\s+)?(?:login|log in|sign in|signin)\b/.test(lower)) return null;
        if (/\b(?:login|log in|sign in|signin)\b/.test(lower) && /\b(?:account|google|gmail)\b/.test(lower)) return null;
        // Require explicit search+google shape — prevent 'search for my notes on machine learning'
        if (!/\b(?:search|look\s+up|google)\b/.test(lower)) return null;
        if (!/\b(?:google|web|internet|online)\b/.test(lower)) return null;
        // Must have a query after the search word — not just 'search google'
        const query = extractSearchQuery(text);
        if (!query || query === 'search' || query.length < 2) return null;
        return {
            message: `Searching Google for: ${query}`,
            tasks: [{
                id: 1,
                description: `Search Google: ${query}`,
                protocol_id: 'google_search.search',
                capability: 'search',
                needs_input: false,
                input_fields: [],
                actions: [action('browser_search', { query })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: 'Google search results are open.',
            fast_path: true,
            engine: 'browser',
            protocol_id: 'google_search.search'
        };
    }

    function buildVolumePlan(raw) {
        const text = compact(raw);
        if (!/\b(?:set|change)\s+(?:system\s+)?volume\b/i.test(text)) return null;
        const match = text.match(/(\d{1,3})\s*%?/);
        if (!match) return null;
        const volume = Math.max(0, Math.min(100, Number(match[1])));
        return {
            message: `Setting system volume to ${volume}%.`,
            tasks: [{
                id: 1,
                description: `Set system volume to ${volume}%`,
                protocol_id: 'windows.set_volume',
                capability: 'set_volume',
                needs_input: false,
                input_fields: [],
                actions: [action('set_volume', { volume })],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'low',
            }],
            expected_result: '',
            fast_path: true,
            engine: 'system',
            protocol_id: 'windows.set_volume'
        };
    }

    // 9.1: Forget/remove saved credentials
    function buildForgetCredentialsPlan(raw) {
        const text = compact(raw);
        const lower = text.toLowerCase();
        if (!/\b(?:forget|remove|delete|clear|reset)\b/.test(lower)) return null;
        if (!/\b(?:google|gmail|credentials?|account|password|login)\b/.test(lower)) return null;
        return {
            message: 'Removing saved Google credentials from Pecifics.',
            tasks: [{
                id: 1,
                description: 'Remove saved Google credentials',
                protocol_id: 'credentials.forget_google_account',
                capability: 'forget_credentials',
                needs_input: false,
                input_fields: [],
                actions: [action('forget_google_credentials', {})],
                dependsOn: null,
                depends_on: [],
                parallel: false,
                risk: 'medium',
                requires_confirmation: true,
            }],
            expected_result: 'Google credentials removed.',
            fast_path: true,
            engine: 'system',
            protocol_id: 'credentials.forget_google_account',
            requires_confirmation: true,
        };
    }


    // ══ CONVERSATIONAL QUERY DETECTOR ════════════════════════════════════════
    // Returns true if the input is a conversational question (not a task command)
    function isConversationalQuery(raw) {
        const lower = raw.toLowerCase().trim();
        // Very short conversational phrases
        if (/^(?:hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|bye|good(?:bye)?)[\.!?]*$/.test(lower)) return true;
        // "Where did you..." / "Why did you..." — meta questions about past actions
        if (/^(?:where|why|when|how)\s+did\s+(?:you|it)\b/.test(lower)) return true;
        // "What did you..." past tense questions about actions
        if (/^what\s+did\s+(?:you|it)\b/.test(lower)) return true;
        // "Can you explain..." / "Tell me about..."
        if (/^(?:can\s+you\s+(?:explain|tell|describe|help)|tell\s+me\s+(?:about|how|why|what)|explain\s+(?:how|why|what))/.test(lower)) return true;
        // "What does X mean"
        if (/what\s+does\s+.+\s+mean/.test(lower)) return true;
        return false;
    }

    // ══ FAST-PATH: SCREEN READING ════════════════════════════════════════════
    function buildReadScreenPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:what(?:'s|\s+is|\s+are)?\s+(?:there\s+on|on)\s+(?:my\s+)?screen|what(?:'s|\s+is)\s+on\s+(?:my\s+)?screen|read\s+(?:my\s+)?screen|describe\s+(?:my\s+)?screen|what(?:'s|\s+is)\s+(?:this|open|visible)|what\s+does\s+(?:this|the)\s+(?:error|message|page|window)|what\s+am\s+i\s+looking\s+at|what\s+do\s+(?:you\s+)?see|show\s+me\s+(?:what(?:'s|\s+is)\s+on|my\s+screen)|screen\s+content|whats\s+on\s+screen)\b/.test(lower)) return null;
        const question = raw.trim();
        return {
            message: 'Reading your screen…',
            tasks: [{ id: 1, description: 'Read screen content', protocol_id: 'screen.read_content', capability: 'read_screen',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('read_screen', { question })]
            }],
            expected_result: 'Screen content described', fast_path: true, engine: 'action', protocol_id: 'screen.read_content'
        };
    }

    // ══ FAST-PATH: FILE SEARCH & LISTING ═════════════════════════════════════
    function buildFileSearchPlan(raw) {
        const lower = raw.toLowerCase();
        // Don't intercept conversational questions about past searches
        if (isConversationalQuery(raw)) return null;
        if (/^(?:where|why|when)\s+did\s+(?:you|it)\s+(?:search|look|find)/.test(lower)) return null;

        const isListAll = /\b(?:list|show|display)\s+(?:all\s+)?(?:my\s+)?(?:files?|documents?|folders?|everything)\b/.test(lower)
                       || /\blist\s+all\s+(?:the\s+)?files?\b/.test(lower);
        const isSearch = /\b(?:find|search\s+for|search|look\s+for|where\s+is|where\s+are|open\s+(?:the\s+)?(?:file|doc|pdf|excel|word|latest)|locate)\b/.test(lower);

        if (!isSearch && !isListAll) return null;
        // For isSearch, require a file-like noun unless it's a direct file name query
        if (isSearch && !isListAll) {
            const hasFileNoun = /\b(?:file|doc(?:ument)?|pdf|xlsx?|docx?|ppt|image|photo|folder|resume|report|presentation|txt|png|jpg|mp4|mp3|zip)\b/.test(lower)
                             || /\b(?:yesterday|last\s+week|recent|latest|newest)\b/.test(lower)
                             || /\.[a-zA-Z0-9]{2,5}\b/.test(raw); // has extension like .pdf
            if (!hasFileNoun) return null;
        }

        let query = isListAll ? '' : raw.replace(/\b(?:find|search\s+for|look\s+for|where\s+is|where\s+are|locate|open\s+the|search\s+for)\b/gi, '').trim();
        let fileType = null;
        const typeMatch = lower.match(/\b(pdf|docx?|xlsx?|pptx?|txt|png|jpg|mp4|mp3|zip)\b/);
        if (typeMatch) fileType = typeMatch[1];

        // Search entire laptop by default (all drives)
        const searchLocation = 'all';

        if (isListAll) {
            return {
                message: 'Listing files on your laptop…',
                tasks: [{ id: 1, description: 'List all files', protocol_id: 'filesystem.search_and_open', capability: 'list_files',
                    engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                    actions: [action('find_files', { query: fileType || '', file_type: fileType, location: searchLocation, max_results: 20, open_result: false })]
                }],
                expected_result: 'Files listed', fast_path: true, engine: 'action', protocol_id: 'filesystem.search_and_open'
            };
        }

        return {
            message: `Searching your laptop for "${query}"…`,
            tasks: [{ id: 1, description: `Find: ${query}`, protocol_id: 'filesystem.search_and_open', capability: 'find_files',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('find_files', { query, file_type: fileType, location: searchLocation, max_results: 10 })]
            }],
            expected_result: `File found and opened`, fast_path: true, engine: 'action', protocol_id: 'filesystem.search_and_open'
        };
    }

    // ══ FAST-PATH: CLIPBOARD ═════════════════════════════════════════════════
    function buildClipboardPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:clipboard|what\s+(?:did\s+i\s+)?copy|what(?:'s|\s+is)\s+(?:on\s+my\s+clipboard|copied|in\s+(?:my\s+)?clipboard)|read\s+(?:my\s+)?clipboard|summarize\s+(?:whatever\s+(?:is|are)\s+(?:there\s+on|on|in)\s+(?:my\s+)?)?clipboard|send\s+clipboard|paste|whats.*clipboard|what.*copied)\b/.test(lower)) return null;

        let clipAction = 'read';
        if (/\bsummarize\b/.test(lower)) clipAction = 'summarize';
        else if (/\bsend\b/.test(lower)) clipAction = 'send';

        return {
            message: `${clipAction === 'read' ? 'Reading' : clipAction === 'summarize' ? 'Summarizing' : 'Sending'} clipboard…`,
            tasks: [{ id: 1, description: `Clipboard: ${clipAction}`, protocol_id: 'clipboard.read_and_act', capability: 'clipboard_action',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('clipboard_action', { action: clipAction })]
            }],
            expected_result: 'Clipboard action completed', fast_path: true, engine: 'action', protocol_id: 'clipboard.read_and_act'
        };
    }

    // ══ FAST-PATH: SYSTEM INFO ════════════════════════════════════════════════
    function buildSystemInfoPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:how\s+much\s+(?:ram|memory|cpu|disk|battery|space|storage)|check\s+(?:cpu|ram|memory|battery|disk|system)|what(?:'s|\s+is)\s+(?:my\s+)?(?:battery|ram|cpu|memory|disk|storage)|system\s+(?:status|health|info)|which\s+apps\s+(?:are\s+)?(?:using|running)|top\s+processes|show\s+(?:my\s+)?(?:ram|cpu|memory|battery|disk)|how\s+is\s+my\s+(?:ram|cpu|memory|battery|disk|system))\b/.test(lower)) return null;

        let metric = 'all';
        if (/\bcpu\b/.test(lower)) metric = 'cpu';
        else if (/\b(?:ram|memory)\b/.test(lower)) metric = 'ram';
        else if (/\bbattery\b/.test(lower)) metric = 'battery';
        else if (/\b(?:disk|storage|space)\b/.test(lower)) metric = 'disk';
        else if (/\bprocess(?:es)?\b/.test(lower)) metric = 'processes';

        return {
            message: `Checking ${metric === 'all' ? 'system status' : metric}…`,
            tasks: [{ id: 1, description: `System info: ${metric}`, protocol_id: 'system.health_check', capability: 'system_info',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('get_system_info', { metric })]
            }],
            expected_result: 'System info retrieved', fast_path: true, engine: 'action', protocol_id: 'system.health_check'
        };
    }

    // ══ FAST-PATH: MEMORY RECALL ══════════════════════════════════════════════
    function buildMemoryRecallPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\b(?:what\s+did\s+i\s+(?:do|ask|say|create|make)|show\s+(?:my\s+)?(?:history|recent|last|previous)|repeat\s+(?:my\s+)?(?:last|previous)\s+task|what\s+(?:tasks|things)\s+(?:did\s+i|have\s+i)|remind\s+me\s+what)\b/.test(lower)) return null;

        let memAction = 'recall';
        let query = raw;
        if (/\bhistory\b/.test(lower) || /\brecent\b/.test(lower)) memAction = 'history';
        if (/\brepeat\b/.test(lower) || /\bredo\b/.test(lower)) memAction = 'repeat';

        let daysBack = 7;
        if (/\byesterday\b/.test(lower)) { daysBack = 1; query = 'yesterday'; }
        else if (/\blast\s+week\b/.test(lower)) daysBack = 7;
        else if (/\btoday\b/.test(lower)) daysBack = 1;
        else if (/\blast\s+monday|monday\b/.test(lower)) daysBack = 7;

        return {
            message: `Looking through your history…`,
            tasks: [{ id: 1, description: `Memory recall: ${memAction}`, protocol_id: 'memory.recall_and_repeat', capability: 'task_recall',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('recall_memory', { query: raw, action: memAction, days_back: daysBack })]
            }],
            expected_result: 'History summarised', fast_path: true, engine: 'action', protocol_id: 'memory.recall_and_repeat'
        };
    }

    // ══ FAST-PATH: PDF ════════════════════════════════════════════════════════
    function buildPDFPlan(raw) {
        const lower = raw.toLowerCase();
        if (!/\bpdf\b/.test(lower)) return null;
        if (!/\b(?:read|open|summarize|summary|what\s+does|extract|convert|turn)\b/.test(lower)) return null;

        let operation = 'read';
        if (/\bsummar(?:ize|y)\b/.test(lower)) operation = 'summarize';
        else if (/\b(?:convert|turn|save)\b/.test(lower) && /\b(?:word|doc)\b/.test(lower)) operation = 'convert_from_word';

        // Try to extract a filepath from the command
        const pathMatch = raw.match(/["']([^"']+\.(?:pdf|docx?))["']|(\b[A-Za-z]:\\[^\s]+\.(?:pdf|docx?))/i);
        const filepath = pathMatch ? (pathMatch[1] || pathMatch[2]) : null;

        return {
            message: `${operation === 'summarize' ? 'Summarizing' : operation === 'convert_from_word' ? 'Converting to' : 'Reading'} PDF…`,
            tasks: [{ id: 1, description: `PDF: ${operation}`, protocol_id: 'pdf.create_and_read', capability: 'pdf_operations',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: !filepath, input_fields: filepath ? [] : [{ id: 'filepath', label: 'PDF file path', type: 'text' }],
                actions: filepath ? [action('pdf_operation', { operation, filepath })] : []
            }],
            expected_result: 'PDF processed', fast_path: true, engine: 'action', protocol_id: 'pdf.create_and_read'
        };
    }

    // ══ FAST-PATH: CALENDAR & REMINDERS ══════════════════════════════════════
    function buildCalendarPlan(raw) {
        const lower = raw.toLowerCase();
        const isReminder = /\b(?:remind\s+me|set\s+(?:a\s+)?reminder|remind\s+at|alert\s+me)\b/.test(lower);
        const isCalendar = /\b(?:what(?:'s|\s+is)\s+(?:on\s+my\s+)?(?:calendar|schedule)|show\s+(?:my\s+)?(?:events|meetings|schedule|calendar)|upcoming\s+(?:events|meetings))\b/.test(lower);
        const isList = /\b(?:show|list)\s+(?:my\s+)?reminders?\b/.test(lower);
        const isCancel = /\b(?:cancel|delete|remove)\s+(?:the\s+)?reminder\b/.test(lower);

        if (!isReminder && !isCalendar && !isList && !isCancel) return null;

        let operation = 'set_reminder';
        if (isCalendar) operation = 'get_events';
        else if (isList) operation = 'list_reminders';
        else if (isCancel) operation = 'cancel_reminder';

        // Extract reminder message (what to remind about)
        let message = '';
        let time = '';
        if (isReminder) {
            const msgMatch = raw.match(/remind\s+me\s+(?:at\s+[\d:apm]+\s+)?(?:to\s+)?(.+?)(?:\s+at\s+[\d:apm]+)?$/i);
            if (msgMatch) message = msgMatch[1].replace(/\s+at\s+[\d:]+(?:am|pm)?$/i, '').trim();
            const timeMatch = raw.match(/(?:at\s+)([\d]{1,2}(?::\d{2})?\s*(?:am|pm)?)|(?:in\s+\d+\s+(?:minutes?|hours?))/i);
            if (timeMatch) time = timeMatch[0];
        }

        const dateMatch = raw.match(/\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
        const date = dateMatch ? dateMatch[0] : 'today';

        return {
            message: isReminder ? `Setting reminder: "${message}"…` : isCalendar ? 'Checking your calendar…' : 'Managing reminders…',
            tasks: [{ id: 1, description: `Calendar: ${operation}`, protocol_id: 'calendar.reminders', capability: 'calendar_and_reminders',
                engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                actions: [action('calendar_operation', { operation, message, time, date })]
            }],
            expected_result: isReminder ? 'Reminder set' : 'Calendar events retrieved', fast_path: true, engine: 'action', protocol_id: 'calendar.reminders'
        };
    }

    // ══ FAST-PATH: OPEN APP (locally installed apps not in other plans) ══════
    function buildOpenAppPlan(raw) {
        const lower = raw.toLowerCase().trim();
        // Only match simple "open X" or "launch X" patterns
        const match = lower.match(/^(?:open|launch|start|run)\s+(.+)$/);
        if (!match) return null;
        const appName = match[1].trim();
        // Don't intercept things that should go to other plans (navigation, browser sites etc)
        const webOnlyApps = ['figma','notion','canva','chatgpt','claude','gemini','drive','docs','sheets','trello','slack'];
        if (webOnlyApps.some(a => appName.includes(a))) {
            // These are web apps — use navigation plan
            const url = Object.entries(SITE_SHORTCUTS).find(([k]) => appName.includes(k))?.[1];
            if (url) return {
                message: `Opening ${appName} in browser…`,
                tasks: [{ id: 1, description: `Open ${appName}`, protocol_id: 'browser.navigate', capability: 'navigate_and_login',
                    engine: 'action', dependsOn: null, depends_on: [], parallel: false, needs_input: false, input_fields: [],
                    actions: [action('navigate_and_login', { url, login: false })]
                }],
                expected_result: `${appName} opened in browser`, fast_path: true, engine: 'action', protocol_id: 'browser.navigate'
            };
        }
        return null; // Let the backend handle app launching via vision_task
    }

    // ══ UPDATED buildPlan — all fast-paths wired in ════════════════════════
    function buildPlan(text) {
        const raw = compact(text);
        if (!raw) return null;

        // Conversational queries go to backend AI chat, not fast-path execution
        if (isConversationalQuery(raw)) return null;

        return buildReadScreenPlan(raw)
            || buildSystemInfoPlan(raw)
            || buildClipboardPlan(raw)
            || buildCalendarPlan(raw)
            || buildMemoryRecallPlan(raw)
            || buildFileSearchPlan(raw)
            || buildPDFPlan(raw)
            || buildWordDocPlan(raw)
            || buildExcelSheetPlan(raw)
            || buildOpenAppPlan(raw)
            || buildGammaPlan(raw)
            || buildChromeRelaunchPlan(raw)
            || buildCredentialPlan(raw)
            || buildForgetCredentialsPlan(raw)
            || buildWhatsAppPlan(raw)
            || buildTelegramPlan(raw)
            || buildSpotifyPlan(raw)
            || buildYouTubePlan(raw)
            || buildSiteSearchPlan(raw)
            || buildNavigationPlan(raw)
            || buildGoogleSearchPlan(raw)
            || buildVolumePlan(raw);
    }

    window.PecificsIntentRouter = {
        buildPlan,
        buildReadScreenPlan,
        buildFileSearchPlan,
        buildClipboardPlan,
        buildSystemInfoPlan,
        buildMemoryRecallPlan,
        buildPDFPlan,
        buildCalendarPlan,
        buildWordDocPlan,
        buildExcelSheetPlan,
        buildGammaPlan,
        buildGoogleSearchPlan,
        buildCredentialPlan,
        buildForgetCredentialsPlan,
        buildChromeRelaunchPlan,
        buildNavigationPlan,
        buildYouTubePlan,
        buildSpotifyPlan,
        buildVolumePlan,
        buildWhatsAppPlan,
        buildTelegramPlan,
        buildOpenAppPlan,
        isConversationalQuery,
        parseWhatsAppMessageCommand,
        parseTelegramMessageCommand,
    };
})();
