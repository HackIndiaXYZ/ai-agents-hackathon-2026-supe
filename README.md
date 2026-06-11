# NexAgent — AI-Powered Desktop Workflow Automation

An intelligent desktop agent that understands natural language commands and executes multi-step workflows across apps, browser, and system tools — all from a lightweight floating UI.

## Overview

NexAgent bridges the gap between natural language and desktop automation. Say what you want done, and NexAgent routes the command to the right tool — browser, file system, messaging apps, or AI generation — without any manual scripting.

**Key capabilities:**
- 🗣️ Natural language command routing
- 🌐 Browser automation (Gmail, WhatsApp Web, YouTube, Google Search)
- 📊 AI-powered presentation generation
- 📁 File & system management
- 🔌 Protocol-based action planning with fallback chains
- 🧠 Persistent memory and session continuity

## Architecture

```
nexagent/
├── blue-amoeba/          # Landing page (React + Vite)
├── colab-backend/        # FastAPI backend + LLM planner
│   ├── langchain_backend.py   # Main API server
│   ├── ppt_generator_pro.py   # Presentation AI engine
│   ├── voice_engine.py        # Clap detection + voice state
│   └── protocol_learner.py    # Adaptive protocol learning
├── jarvis-desktop/       # Electron desktop app
│   ├── src/main.js            # Electron main process
│   ├── src/preload.js         # IPC bridge
│   └── src/
│       ├── renderer/          # UI + intent router
│       └── modules/           # Automation modules
└── protocols/            # JSON action protocol schemas
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop Shell | Electron |
| UI | HTML/CSS/JS (vanilla) |
| Backend | FastAPI + Python |
| LLM Planning | Groq (Llama 3) + Ollama (local) |
| Browser Automation | Playwright (CDP) |
| Vision | Gemini Vision / CogAgent |
| Landing Page | React + Vite + TailwindCSS |

## Quick Start

### 1. Backend
```bash
cd colab-backend
pip install -r requirements_langchain.txt
# Copy .env.example to .env and fill in API keys
python langchain_backend.py
```

### 2. Desktop App
```bash
cd jarvis-desktop
npm install
npm start
```

### 3. Landing Page (optional)
```bash
cd blue-amoeba
npm install
npm run dev
```

## How It Works

1. User types or speaks a command
2. Local intent router fast-paths simple commands (Spotify, YouTube, WhatsApp, etc.)
3. Complex commands go to the FastAPI backend's protocol planner
4. The planner returns a task graph with action steps
5. Electron executes each action via the automation modules
6. Results are shown inline with progress tracking

## Protocols

Action schemas live in `/protocols/`. Each JSON file defines:
- What the action does
- Required parameters
- Fallback strategies
- Risk level

This makes it easy to add new integrations without changing core logic.

## Environment Variables

See `colab-backend/.env.example` for all required keys:
- `GROQ_API_KEY` — LLM planning
- `GEMINI_API_KEY` — Vision tasks
- `OLLAMA_URL` — Local LLM (optional)

## License

MIT
