# 🚀 Pecifics LAM — Complete Setup & Operation Guide

> **Pecifics** is an AI Desktop Assistant (Large Action Model) that can **see your screen** and **control your computer** — clicking, typing, scrolling, opening apps, managing files, and more.

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  YOUR PC (Local)                                        │
│                                                         │
│  ┌──────────────┐     IPC      ┌────────────────────┐   │
│  │  Electron UI  │◄───────────►│  FastAPI Backend    │   │
│  │ jarvis-desktop │             │  colab-backend      │   │
│  │ (Chat + OS    │             │  (Brain 1: Groq     │   │
│  │  Control)     │             │   LLM Planner)      │   │
│  └──────┬───────┘             └────────┬───────────┘   │
│         │ screenshot                   │ HTTP POST      │
│         │ + mouse/keyboard             │                │
│         ▼                              ▼                │
│  ┌──────────────┐           ┌────────────────────┐     │
│  │  Windows OS   │           │ Vision Provider    │     │
│  │  (your screen)│           │ (pick ONE below)   │     │
│  └──────────────┘           └────────────────────┘     │
│                                      │                  │
│                      ┌───────────────┴──────────┐       │
│                      ▼                          ▼       │
│             ┌──────────────┐          ┌─────────────┐   │
│             │ Option A:    │          │ Option B:   │   │
│             │ CogAgent GPU │          │ Gemini API  │   │
│             │ (Kaggle +    │          │ (FREE, no   │   │
│             │  ngrok)      │          │  GPU needed)│   │
│             └──────────────┘          └─────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Two "Brains":**
| Brain | Purpose | Runs Where | Cost |
|-------|---------|-----------|------|
| **Brain 1 — Groq (Llama-3.3-70b)** | Plans tasks, splits multi-step prompts into actions | Cloud API call from your PC | FREE |
| **Brain 2 — Vision Provider** | Looks at screenshots and decides what to click/type | See options below | FREE |

**Vision Provider Options:**

| Option | What It Is | GPU Needed? | Quality | Rate Limit |
|--------|-----------|------------|---------|-----------|
| **A: CogAgent on Kaggle** | Runs CogAgent VLM on a free Kaggle T4 GPU, exposed via ngrok tunnel | Yes (Kaggle provides it) | Higher accuracy for UI grounding | ~30hrs/week free GPU |
| **B: Gemini API** | Google's Gemini 2.0 Flash vision model via API | No GPU needed | Good, but may hit quota | 15 RPM free tier |

> **Recommendation:** Start with **Option B (Gemini)** — it's simpler and requires zero GPU setup. Switch to **Option A (CogAgent)** only if you need higher accuracy or hit Gemini rate limits.

---

## 📋 Prerequisites

Install these on your Windows PC:

| Tool | Version | Check | Get It |
|------|---------|-------|--------|
| **Python** | 3.10+ | `python --version` | [python.org](https://www.python.org/downloads/) |
| **Node.js** | 18+ | `node --version` | [nodejs.org](https://nodejs.org/) |
| **Git** | Any | `git --version` | [git-scm.com](https://git-scm.com/) |

**API Keys (all FREE):**

| Key | Where to Get | Required? |
|-----|-------------|----------|
| **Groq API Key** | [console.groq.com](https://console.groq.com) | ✅ Yes — always needed |
| **Gemini API Key** | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) | ✅ Yes if using Gemini vision (Option B) |
| **Kaggle Account** | [kaggle.com](https://www.kaggle.com) | Only if using CogAgent (Option A) |
| **Ngrok Account** | [ngrok.com](https://ngrok.com) | Only if using CogAgent (Option A) |

---

## 🛠️ Step 1 — Clone & Set Up Python Backend

```powershell
# Navigate to the project root
cd "C:\Users\adiin\OneDrive\Desktop\LAM\LAM"

# Create Python virtual environment (skip if .venv already exists)
python -m venv .venv

# Activate it
.\.venv\Scripts\activate

# Install all Python dependencies
pip install -r colab-backend\requirements_langchain.txt
```

> **Verify:** Run `python -c "import fastapi, httpx, tenacity; print('OK')"` — should print `OK`.

---

## 🛠️ Step 2 — Configure Environment Variables

Open `colab-backend\.env` in any text editor and fill in your keys:

```env
# REQUIRED — your Groq API key (free)
GROQ_API_KEY=gsk_YOUR_GROQ_KEY_HERE

# REQUIRED for Gemini vision (Option B) — your Google AI key (free)  
GEMINI_API_KEY=AIzaSy_YOUR_GEMINI_KEY_HERE

# Which LLM to use for planning (keep as groq)
LLM_PROVIDER=groq

# Which vision provider (gemini or cogagent)
VISION_PROVIDER=gemini

# Keep defaults unless you have a reason to change
GROQ_MODEL=llama-3.3-70b-versatile
GEMINI_MODEL=gemini-2.0-flash

# OPTIONAL — CogAgent URL from Kaggle notebook (Option A only)
# Leave blank to use Gemini vision instead
COGAGENT_URL=
```

---

## 🛠️ Step 3 — Set Up Electron Desktop App

```powershell
# From the project root
cd jarvis-desktop

# Install Node dependencies
npm install

# Install Chromium for Playwright (browser automation)
npx playwright install chromium

# Go back to root
cd ..
```

> **Verify:** Run `cd jarvis-desktop && npx electron --version && cd ..` — should print the Electron version.

---

## 🛠️ Step 4 — (Optional) Set Up Marketing Website

```powershell
cd blue-amoeba
npm install
cd ..
```

This is the Pecifics marketing/landing page. Not needed for the assistant itself.

---

## 🚀 Running Pecifics (Gemini Vision Mode — Option B)

This is the **simplest mode** — no GPU, no Kaggle, no ngrok. Just API keys.

### Quick Start:
```powershell
# Double-click this file, or run from terminal:
.\start_all.bat
```

This opens **two terminal windows**:
1. **Backend** — FastAPI server on `http://localhost:8000`
2. **Electron** — The Pecifics desktop app window

### What Happens:
1. The Electron app starts and shows the chat interface
2. The green dot in the top-right corner should turn **green** (backend connected)
3. You type a command like "Open Notepad and type hello world"
4. **Brain 1 (Groq)** plans the steps
5. The app takes a screenshot of your screen
6. **Brain 2 (Gemini)** looks at the screenshot and decides where to click
7. The app clicks/types for you
8. Repeat until task is done

### Verify Backend is Running:
Open your browser and go to: **http://localhost:8000/health**

You should see:
```json
{
  "status": "ok",
  "version": "4.0.0",
  "llm": "groq/llama-3.3-70b-versatile",
  "vision": "gemini",
  "cogagent_url": "not set",
  "gemini_quota": "ok"
}
```

---

## 🚀 Running Pecifics (CogAgent GPU Mode — Option A)

This mode runs the **CogAgent VLM** on a free Kaggle T4 GPU. It's more accurate for UI grounding but requires more setup.

### Step A1 — Get Your Ngrok Auth Token

1. Sign up at [ngrok.com](https://dashboard.ngrok.com/signup) (free)
2. Go to [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy your authtoken — looks like `2abc123_XYZ...`

### Step A2 — Launch the Kaggle Notebook

1. Log into [kaggle.com](https://www.kaggle.com)
2. Upload the notebook `colab-backend/CogAgent_Vision_Kaggle.ipynb` to Kaggle:
   - Click **"+ New Notebook"**
   - Click **File → Import Notebook** → upload `CogAgent_Vision_Kaggle.ipynb`
3. **Configure GPU:**
   - Click the **three dots (⋯)** on the right panel → **Accelerator** → **GPU T4 x2**
   - Make sure **Internet** is turned **ON** (right side panel)
4. **Set your Ngrok token:**
   - Find the cell that has `NGROK_AUTH_TOKEN = "..."` and paste your token
5. **Run All Cells** (click ▶▶ "Run All")
6. Wait for the model to download and load (~3-5 minutes)
7. **Copy the ngrok URL** — it will print something like:
   ```
   ✅ CogAgent server running at: https://abc123.ngrok-free.app
   ```

### Step A3 — Connect Pecifics to CogAgent

**Method 1 — Via the Settings UI (recommended):**
1. Open Pecifics (run `start_all.bat`)
2. Click the **⚙️ Settings** gear icon
3. Paste the ngrok URL into the **"CogAgent URL"** field
4. Click **Save**
5. The status dot should turn **green** and show "Backend + CogAgent"

**Method 2 — Via `.env` file:**
1. Edit `colab-backend\.env`
2. Set: `COGAGENT_URL=https://abc123.ngrok-free.app`
3. Restart the backend

### Step A4 — Verify CogAgent Connection

In the Pecifics app, click **Settings → Test Connection**. You should see:
```
✓ Backend — ok
✓ CogAgent — connected
```

Or hit `http://localhost:8000/health` — the `vision` field should say `"cogagent"`.

### ⚠️ Important Notes About Kaggle GPU:

| Item | Detail |
|------|--------|
| **GPU Time** | Kaggle gives ~30 hours/week of free T4 GPU |
| **Session Timeout** | Kaggle notebooks auto-stop after **12 hours** of inactivity |
| **New URL Each Time** | Every time you restart the Kaggle notebook, ngrok gives a **new URL** — you must paste the new URL in Settings |
| **Fallback** | If CogAgent is unreachable, Pecifics automatically falls back to Gemini vision |
| **Keep Tab Open** | Keep the Kaggle browser tab open while using Pecifics — closing it stops the GPU |

---

## 🧪 Manual Testing Checklist

After setup, test these to make sure everything works:

### Test 1 — Backend Health
```powershell
# In PowerShell:
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json
```
Expected: `"status": "ok"`, `"vision": "gemini"` (or `"cogagent"`)

### Test 2 — Chat (LLM Planning)
In the Electron app, type:
```
What is the weather today?
```
This tests Brain 1 (Groq). It should respond with a plan to open a browser.

### Test 3 — Vision Loop (Screen Control)
In the Electron app, type:
```
Open Notepad
```
Then click the **"Execute on Screen"** (🖥️) button. This starts the vision loop:
1. Takes a screenshot
2. Sends to vision provider
3. Receives action (e.g., "click on search bar, type notepad")
4. Executes the action
5. Takes new screenshot
6. Repeats until task is done or 30 iterations

### Test 4 — Volume Control
```
Set volume to 50%
```
Should use COM-based audio control to change Windows volume.

### Test 5 — File Operations
```
Create a folder called TestFolder on the Desktop
```
Should create the folder via PowerShell.

### Test 6 — System Info
```
What is my computer's IP address?
```
Should run a command and return the output.

---

## 🔧 Troubleshooting

### Status dot stays RED
| Cause | Fix |
|-------|-----|
| Backend not running | Check the backend terminal for errors. Re-run: `.venv\Scripts\activate && python colab-backend\langchain_backend.py` |
| Port 8000 in use | Kill the process: `netstat -ano | findstr :8000` then `taskkill /PID <PID> /F` |
| Missing packages | Re-install: `pip install -r colab-backend\requirements_langchain.txt` |

### Vision loop doesn't do anything
| Cause | Fix |
|-------|-----|
| No vision provider | Check `.env` — at least one of `GEMINI_API_KEY` or `COGAGENT_URL` must be set |
| Gemini quota exceeded | You'll see a warning banner. Wait 60s or switch to CogAgent |
| CogAgent URL expired | Restart Kaggle notebook and paste new ngrok URL |
| Wrong coordinates (clicks miss) | Check DPI scaling — go to Windows Settings → Display → Scale. If not 100%, the DPI correction code in `main.js` handles this automatically |

### Kaggle notebook crashes
| Cause | Fix |
|-------|-----|
| Out of GPU memory | Restart the notebook (it auto-clears VRAM) |
| Session timed out | Re-run all cells and get a new ngrok URL |
| Ngrok error | Check your auth token is correct. Free tier allows 1 tunnel at a time |

### Backend shows "LLM unavailable"
| Cause | Fix |
|-------|-----|
| Bad Groq API key | Get a new one from [console.groq.com](https://console.groq.com) |
| Groq rate limit | Wait a few seconds. Free tier allows 30 RPM |

---

## 📁 Project Structure

```
LAM/
├── start_all.bat              # ← Double-click to start everything
├── .venv/                     # Python virtual environment
├── colab-backend/
│   ├── .env                   # ← YOUR API KEYS GO HERE
│   ├── .env.example           # Template with all available options
│   ├── langchain_backend.py   # FastAPI server (Brain 1 + vision routing)
│   ├── ppt_generator_pro.py   # PowerPoint generation module
│   ├── requirements_langchain.txt
│   ├── CogAgent_Vision_Kaggle.ipynb    # ← Upload this to Kaggle
│   └── JARVIS_LAM_Backend_Kaggle.ipynb # Alternative Kaggle notebook
├── jarvis-desktop/
│   ├── src/
│   │   ├── main/main.js       # Electron main process (screenshots, IPC)
│   │   ├── renderer/          # Chat UI (HTML + JS + CSS)
│   │   └── modules/           # OS control modules (actions, files, etc.)
│   ├── package.json
│   └── assets/                # App icons
└── blue-amoeba/               # Marketing website (React)
```

---

## ⚡ Quick Reference

| I want to... | Do this |
|--------------|---------|
| Start Pecifics | `.\start_all.bat` |
| Stop Pecifics | Close both terminal windows |
| Change API keys | Edit `colab-backend\.env` and restart |
| Update CogAgent URL | Settings ⚙️ → paste new URL → Save |
| Check health | `http://localhost:8000/health` |
| Use Gemini only (no GPU) | Leave `COGAGENT_URL=` blank in `.env` |
| Use CogAgent + GPU | Upload notebook to Kaggle → get ngrok URL → paste in Settings |
| Run marketing site | `cd blue-amoeba && npm run dev` |
