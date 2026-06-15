@echo off
setlocal
title Pecifics LAM Launcher

cd /d "%~dp0"

echo.
echo Pecifics LAM
echo ============
echo Starting backend and desktop app...
echo.

set "PYTHON_HOME="
if exist ".venv\pyvenv.cfg" (
  for /f "tokens=2 delims==" %%a in ('findstr /i "home" .venv\pyvenv.cfg') do set "PYTHON_HOME=%%a"
)
if defined PYTHON_HOME (
  for /f "tokens=* delims= " %%b in ("%PYTHON_HOME%") do set "PYTHON_HOME=%%b"
)
if defined PYTHON_HOME (
  if not exist "%PYTHON_HOME%\python.exe" (
    echo [WARN] Local Python interpreter not found at "%PYTHON_HOME%".
    echo Re-creating the virtual environment locally for this computer...
    taskkill /F /IM python.exe /T >nul 2>&1
    rmdir /s /q .venv
  )
)

if not exist ".venv\Scripts\activate.bat" (
  echo [INFO] Python virtual environment not found. Creating it now...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create virtual environment. Make sure Python is installed and in your PATH.
    pause
    exit /b 1
  )
  echo [INFO] Installing backend dependencies...
  .venv\Scripts\python -m pip install -r colab-backend\requirements_langchain.txt
  if errorlevel 1 (
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
  )
) else (
  rem Check if virtual environment is fully installed; if not, repair it
  .venv\Scripts\python -c "import httpx, fastapi, pydantic" >nul 2>&1
  if errorlevel 1 (
    echo [WARN] Virtual environment is missing required packages.
    echo [INFO] Installing/repairing backend dependencies. This may take a moment...
    .venv\Scripts\python -m pip install -r colab-backend\requirements_langchain.txt
    if errorlevel 1 (
      echo [ERROR] Failed to install dependencies.
      pause
      exit /b 1
    )
  )
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
start "Pecifics Backend" cmd /k cd /d "%~dp0colab-backend" ^&^& ..\.venv\Scripts\python langchain_backend.py --host 127.0.0.1 --port 8000

echo Waiting 5 seconds for backend to initialize...
timeout /t 5 /nobreak >nul

echo [3/4] Starting Electron desktop app
start "Pecifics Desktop" cmd /k cd /d "%~dp0jarvis-desktop" ^&^& npm run dev

echo.
echo Started:
echo   Backend: http://127.0.0.1:8000/health
echo   Desktop: Electron dev window
echo.
echo Close the backend and desktop terminal windows to stop Pecifics.
timeout /t 3 /nobreak >nul
