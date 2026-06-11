# Contributing to NexAgent

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/nexagent`
3. Install dependencies (see README for per-module setup)
4. Create a feature branch: `git checkout -b feat/your-feature`

## Project Structure

- **`colab-backend/`** — FastAPI server, LLM planner, protocol engine
- **`jarvis-desktop/`** — Electron app, automation modules, renderer UI
- **`protocols/`** — JSON action schema definitions
- **`blue-amoeba/`** — React landing page

## Adding a New Protocol

1. Create a JSON file in `protocols/` following the existing schema:
   ```json
   {
     "id": "app.action_name",
     "domain": "app",
     "capability": "what it does",
     "description": "Human-readable description",
     "risk": "low",
     "requires_confirmation": false,
     "parameters": {
       "param_name": { "type": "string", "required": true }
     },
     "steps": [
       { "action": "action_name", "parameters": { "key": "{{param_name}}" } }
     ],
     "fallbacks": []
   }
   ```
2. Register the action handler in `action-executor.js`
3. Add a fast-path regex in `intent-router.js` if it's a common command

## Adding a New App Handler

1. Create `jarvis-desktop/src/modules/app-handlers/yourapp.js`
2. Export a class with `execute(operation, params)` method
3. Register it in `app-handlers/index.js`

## Code Style

- JavaScript: no semicolons optional, prefer `async/await` over `.then()`
- Python: follow PEP 8, use type hints where possible
- Keep action handlers focused — one action per function

## Pull Requests

- Keep PRs small and focused
- Include a clear description of what changed and why
- Test your changes locally before submitting

## Reporting Issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- OS and Node/Python version
