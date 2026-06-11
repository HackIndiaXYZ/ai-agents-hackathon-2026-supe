# Changelog

## [0.2.0] - 2026-06-10

### Added
- Protocol-based action planning with fallback selector chains
- `findElement()` helper with multi-selector fallback for robust DOM interaction
- Per-action timeout constants (`ACTION_TIMEOUTS`) for navigate, click, form submit
- CDP session reconnection guard — auto-reconnects if browser session drops
- `enrich_profile_from_run()` — auto-updates frequent contacts and apps after each task
- `/debug/last_plan_input` and `/debug/recipe_usage` endpoints for diagnostics
- Implicit continuation patterns (yes/no, "send it", "try again") in context engine
- Expanded screen context triggers (fix, edit, save, close, copy, run, etc.)
- User-facing error translation layer — maps internal errors to plain English
- Full-content confirmation dialogs showing message/recipient before sending
- 60-second confirmation timeout with auto-cancel
- OS-level task completion notifications via Electron Notification API
- `forget_google_credentials` action to remove saved credentials from system vault
- `remove_google_credentials` alias action
- Groq fast-reject for simple system commands (volume, brightness, etc.)
- Word threshold for Groq fallback lowered from 9 → 7 words

### Fixed
- Active page selection now uses last focused tab, not first tab
- Gmail compose button now uses 6-selector fallback chain
- Groq protocol fallback no longer triggers on short simple commands

### Changed
- Confirmation dialogs now show full message content for WhatsApp/Gmail actions
- Error messages now show human-readable descriptions instead of stack traces

---

## [0.1.0] - 2026-06-07

### Added
- Initial project scaffold
- FastAPI backend with Groq + Ollama LLM planning
- Electron desktop shell with floating command bar
- Intent router with fast-path regex for Spotify, YouTube, WhatsApp, Google
- Browser automation via Playwright + Chrome CDP
- Protocol registry with JSON action schemas
- Persistent user profile memory
- Vision task loop (Gemini / CogAgent)
- PPT generation via `pptx` + AI content planning
- WhatsApp Web keyboard-driven automation
- Google OAuth handler with credential vault
- React landing page (blue-amoeba)
