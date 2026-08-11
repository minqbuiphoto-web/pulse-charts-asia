@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "SERVER_SOURCE=%~dp0pulse-audio-ai-server.py"

where python >nul 2>nul
if errorlevel 1 (
  echo Can cai Python 3.11 hoac 3.12 truoc khi dung Demucs AI.
  echo https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

if not exist "%SERVER_SOURCE%" (
  echo Hay dat pulse-audio-ai-server.py cung thu muc voi file nay.
  pause
  exit /b 1
)

if not exist "%ENGINE_DIR%" mkdir "%ENGINE_DIR%"
copy /Y "%SERVER_SOURCE%" "%ENGINE_DIR%\server.py" >nul
python -m venv "%ENGINE_DIR%\venv"
call "%ENGINE_DIR%\venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install demucs fastapi uvicorn python-multipart

echo.
echo Pulse Audio AI da san sang. Cua so nay phai duoc mo khi tach beat AI.
echo Model Demucs se tu tai o lan chay dau tien.
python "%ENGINE_DIR%\server.py"
