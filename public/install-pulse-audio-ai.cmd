@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "SERVER_SOURCE=%TEMP%\pulse-audio-ai-server-latest.py"
set "SERVER_FALLBACK=%~dp0pulse-audio-ai-server.py"
set "SERVER_URL=https://pulse-charts-asia.vercel.app/pulse-audio-ai-server.py"

where python >nul 2>nul
if errorlevel 1 (
  echo Can cai Python 3.11 hoac 3.12 truoc khi dung Demucs AI.
  echo https://www.python.org/downloads/windows/
  pause
  exit /b 1
)

echo Dang tai bo xu ly moi nhat tu Pulse Charts...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadFile('%SERVER_URL%','%SERVER_SOURCE%'); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%SERVER_FALLBACK%" (
    set "SERVER_SOURCE=%SERVER_FALLBACK%"
  ) else (
    echo Khong tai duoc file xu ly. Hay kiem tra Internet roi chay lai.
    pause
    exit /b 1
  )
)

if not exist "%ENGINE_DIR%" mkdir "%ENGINE_DIR%"
copy /Y "%SERVER_SOURCE%" "%ENGINE_DIR%\server.py" >nul
python -m venv "%ENGINE_DIR%\venv"
call "%ENGINE_DIR%\venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install demucs faster-whisper fastapi uvicorn python-multipart imageio-ffmpeg

echo.
echo Pulse Audio AI da san sang. Giu cua so nay mo khi tach beat, can lyric hoac xuat MV.
echo FFmpeg mien phi da duoc cai kem. Model Demucs va Faster-Whisper se tu tai o lan chay dau tien.
python "%ENGINE_DIR%\server.py"
