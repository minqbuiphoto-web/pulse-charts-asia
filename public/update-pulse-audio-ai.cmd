@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "SERVER_FILE=%ENGINE_DIR%\server.py"
set "SERVER_NEW=%TEMP%\pulse-audio-ai-server-6.3.1.py"
set "SERVER_URL=https://pulse-charts-asia.vercel.app/pulse-audio-ai-server.py"

if not exist "%ENGINE_DIR%\venv\Scripts\python.exe" goto not_installed

echo Dang cap nhat bo dung MV: sua kiem tra sai so khung hinh va giu font dong bo...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadFile('%SERVER_URL%','%SERVER_NEW%'); if((Get-Item '%SERVER_NEW%').Length -lt 10000){exit 2}; exit 0 } catch { exit 1 }"
if errorlevel 1 goto download_failed

if exist "%SERVER_FILE%" copy /Y "%SERVER_FILE%" "%ENGINE_DIR%\server.py.before-mv-tail-fix.bak" >nul
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8765 .*LISTENING"') do taskkill /PID %%P /F >nul 2>nul
powershell -NoProfile -Command "Start-Sleep -Seconds 2"
copy /Y "%SERVER_NEW%" "%SERVER_FILE%" >nul

if exist "%ENGINE_DIR%\start-hidden.vbs" (
  start "" wscript.exe "%ENGINE_DIR%\start-hidden.vbs"
) else (
  start "" /min "%ENGINE_DIR%\start.cmd" --silent
)
powershell -NoProfile -Command "Start-Sleep -Seconds 5"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 5; if($h.mvExtendedFontFamilies -and $h.mvFontWeightStyleParity -and $h.mvPacketTailTolerance){exit 0}; exit 2 } catch { exit 1 }"
if errorlevel 1 goto start_failed

echo.
echo Da cap nhat xong. Bo dung chap nhan sai so lam tron cuoi file, van kiem tra lech am thanh.
echo Quay lai MV Studio, bam KIEM TRA KET NOI roi xuat lai MV.
if /I not "%~1"=="--silent" pause
exit /b 0

:not_installed
echo May chua co Pulse Charts Audio AI. Hay dung nut CAI MOT LAN tren MV Studio.
if /I not "%~1"=="--silent" pause
exit /b 2

:download_failed
echo Khong tai duoc ban cap nhat. Hay kiem tra Internet roi chay lai.
if /I not "%~1"=="--silent" pause
exit /b 1

:start_failed
echo Da chep ban moi nhung bo dung chua khoi dong. Hay mo lai Pulse Charts Audio AI roi kiem tra ket noi.
if /I not "%~1"=="--silent" pause
exit /b 1
