@echo off
setlocal
title Pecifics LAM Launcher

cd /d "%~dp0"

echo.
echo Pecifics LAM
echo ============
echo Starting backend and desktop app...
echo.

if not exist ".venv\Scripts\activate.bat" (
  echo [ERROR] Python virtual environment not found: .venv
  echo Create it with: python -m venv .venv
  echo Then install: .venv\Scripts\python -m pip install -r colab-backend\requirements_langchain.txt
  pause
  exit /b 1
)

if not exist "jarvis-desktop\node_modules" (
  echo [ERROR] Electron dependencies not found: jarvis-desktop\node_modules
  echo Install them with: cd jarvis-desktop ^&^& npm install
  pause
  exit /b 1
)

echo [0/4] Ensuring Ollama/Qwen on http://127.0.0.1:11434
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 } catch { $cmd=Get-Command ollama -ErrorAction SilentlyContinue; if ($cmd) { Start-Process -FilePath $cmd.Source -WindowStyle Hidden; Start-Sleep -Seconds 5; exit 0 } else { Write-Host '[WARN] Ollama not found. Local Qwen planner will be unavailable.'; exit 0 } }" 

echo [1/4] Ensuring Chrome debug bridge on http://127.0.0.1:9222
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://127.0.0.1:9222/json/version' -TimeoutSec 1 -UseBasicParsing | Out-Null; exit 0 } catch { taskkill /F /IM chrome.exe /T | Out-Null; Start-Sleep -Seconds 2; $paths=@('C:\Program Files\Google\Chrome\Application\chrome.exe','C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',($env:LOCALAPPDATA + '\Google\Chrome\Application\chrome.exe')); $chrome=$paths | Where-Object { Test-Path $_ } | Select-Object -First 1; $profile=($env:LOCALAPPDATA + '\Pecifics\ChromeProfile'); New-Item -ItemType Directory -Path $profile -Force | Out-Null; if ($chrome) { Start-Process -FilePath $chrome -ArgumentList '--remote-debugging-port=9222',('--user-data-dir=' + $profile),'--profile-directory=Default','--no-startup-window','--no-first-run','--no-default-browser-check'; Start-Sleep -Seconds 4 } }" >nul 2>&1

echo [2/4] Starting backend on http://127.0.0.1:8000
start "Pecifics Backend" cmd /k "cd /d "%~dp0colab-backend" && ..\.venv\Scripts\python langchain_backend.py --host 127.0.0.1 --port 8000"

echo Waiting for backend health...
for /l %%i in (1,1,40) do (
  powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto backend_ready
  timeout /t 2 /nobreak >nul
)

echo [ERROR] Backend did not become ready within 80 seconds.
pause
exit /b 1

:backend_ready
echo [OK] Backend is ready.

echo [3/4] Starting Electron desktop app
start "Pecifics Desktop" cmd /k "cd /d "%~dp0jarvis-desktop" && npm run dev"

echo.
echo Started:
echo   Backend: http://127.0.0.1:8000/health
echo   Desktop: Electron dev window
echo.
echo Close the backend and desktop terminal windows to stop Pecifics.
timeout /t 3 /nobreak >nul
