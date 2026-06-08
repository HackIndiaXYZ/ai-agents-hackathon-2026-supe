@echo off
cd /d "%~dp0"
call ..\.venv\Scripts\activate
python langchain_backend.py
pause
