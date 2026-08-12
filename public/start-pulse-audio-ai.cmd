@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "PYTHON_EXE=%ENGINE_DIR%\venv\Scripts\python.exe"
set "SERVER_FILE=%ENGINE_DIR%\server.py"
set "SERVER_LOG=%ENGINE_DIR%\server.log"
set "SERVER_ERROR=%ENGINE_DIR%\server-error.log"

if not exist "%PYTHON_EXE%" goto not_installed
if not exist "%SERVER_FILE%" goto not_installed

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2; if($h.ok){exit 0}; exit 1 } catch { exit 1 }"
if not errorlevel 1 goto ready

echo Dang mo Pulse Charts Audio AI...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%PYTHON_EXE%' -ArgumentList @('%SERVER_FILE%') -WindowStyle Hidden -RedirectStandardOutput '%SERVER_LOG%' -RedirectStandardError '%SERVER_ERROR%'"

for /L %%I in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2; if($h.ok){exit 0}; exit 1 } catch { exit 1 }"
  if not errorlevel 1 goto ready
)

echo Khong mo duoc bo dung. Hay chay lai BO CAI TU DONG tren MV Studio.
if /I not "%~1"=="--silent" pause
exit /b 1

:ready
echo Pulse Charts Audio AI da san sang.
if /I not "%~1"=="--silent" start "" "https://pulse-charts-asia.vercel.app/mv-studio/"
exit /b 0

:not_installed
echo Chua cai Pulse Charts Audio AI. Hay tai BO CAI TU DONG tren MV Studio.
if /I not "%~1"=="--silent" start "" "https://pulse-charts-asia.vercel.app/mv-studio/"
if /I not "%~1"=="--silent" pause
exit /b 2
