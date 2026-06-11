# 🧪 Pecifics — End-to-End Testing & Verification Checklist

Use this guide to formally test and verify all three components of the Pecifics Large Action Model (LAM) system.

---

## 🚦 Phase 1: Connection & Health Check
- [ ] **Start Python Backend:** Run `colab-backend/start_backend.bat` and verify it starts on `http://localhost:8000`.
- [ ] **Check `/health` Endpoint:** Open `http://localhost:8000/health` in a browser. It should return:
  ```json
  {"status": "ok", "llm": "groq/llama-3.3-70b-versatile", "vision": "gemini", ...}
  ```
- [ ] **Start Electron App:** Run `npm run dev` in `jarvis-desktop`.
- [ ] **App Connectivity Indicator:** Look at the bottom of the Electron window. Verify that the connection indicator turns **green** (showing it successfully connected to the backend).

---

## 🖥️ Phase 2: System Control Verification
Perform the following speech or text commands inside the Electron app and verify they execute successfully without silent failures:
- [ ] **Command: "Open Notepad"**
  - *Expected Result:* Notepad application launches successfully on the screen.
- [ ] **Command: "Set volume to 50"**
  - *Expected Result:* System master volume level is set exactly to 50% and confirmed in the UI.
- [ ] **Command: "Create a file on desktop called test.txt with text hello world"**
  - *Expected Result:* File `test.txt` appears on the Desktop with the correct content.
- [ ] **Command: "Toggle dark mode"**
  - *Expected Result:* The registry key updates, the `WM_SETTINGCHANGE` broadcast fires, and Windows dark mode applies immediately.

---

## 🌐 Phase 3: Vision & Browser Control (LAM Loop)
Verify that the vision feedback loop is functioning properly:
- [ ] **Command: "Open Chrome and search for weather"**
  - *Expected Result:* Playwright opens Chromium (or starts system Chrome), navigates to google.com, dismisses any cookie consent popups automatically, types "weather", hits enter, and finishes with a `{action: "done"}` when the search results are visible.
  - [ ] **DPI Mismatch Test:** Try on a display with 125%/150% scaling. Clicks must land accurately on search bars and buttons.
