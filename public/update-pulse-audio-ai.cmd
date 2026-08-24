@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "SERVER_FILE=%ENGINE_DIR%\server.py"
set "SERVER_NEW=%TEMP%\pulse-audio-ai-server-6.3.py"
set "SERVER_URL=https://pulse-charts-asia.vercel.app/pulse-audio-ai-server.py"

if not exist "%ENGINE_DIR%\venv\Scripts\python.exe" goto not_installed

echo Dang cap nhat bo dung de font tren review va MP4 giong nhau...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadFile('%SERVER_URL%','%SERVER_NEW%'); if((Get-Item '%SERVER_NEW%').Length -lt 10000){exit 2}; exit 0 } catch { exit 1 }"
if errorlevel 1 goto download_failed

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=@(); try { $ids+=(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop).OwningProcess } catch {}; try { $ids+=Get-CimInstance Win32_Process -ErrorAction Stop ^| Where-Object { $_.CommandLine -like '*PulseChartsAudioAI*server.py*' } ^| Select-Object -ExpandProperty ProcessId } catch {}; $ids ^| Sort-Object -Unique ^| Where-Object { $_ -and $_ -ne $PID } ^| ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul
copy /Y "%SERVER_NEW%" "%SERVER_FILE%" >nul

if exist "%ENGINE_DIR%\start-hidden.vbs" (
  start "" wscript.exe "%ENGINE_DIR%\start-hidden.vbs"
) else (
  start "" /min "%ENGINE_DIR%\start.cmd" --silent
)
timeout /t 5 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 5; if($h.mvExtendedFontFamilies -and $h.mvFontWeightStyleParity){exit 0}; exit 2 } catch { exit 1 }"
if errorlevel 1 goto start_failed

echo.
echo Da cap nhat xong. Font tren review va file MP4 bay gio dung cung mot kieu.
echo Quay lai MV Studio, bam KIEM TRA KET NOI roi xuat lai MV.
pause
exit /b 0

:not_installed
echo May chua co Pulse Charts Audio AI. Hay dung nut CAI MOT LAN tren MV Studio.
pause
exit /b 2

:download_failed
echo Khong tai duoc ban cap nhat. Hay kiem tra Internet roi chay lai.
pause
exit /b 1

:start_failed
echo Da chep ban moi nhung bo dung chua khoi dong. Hay mo lai Pulse Charts Audio AI roi kiem tra ket noi.
pause
exit /b 1
