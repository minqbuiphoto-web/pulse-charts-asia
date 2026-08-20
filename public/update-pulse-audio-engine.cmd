@echo off
setlocal
title Update Pulse Charts Audio Engine
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "PYTHON_EXE=%ENGINE_DIR%\venv\Scripts\python.exe"
set "SERVER_FILE=%ENGINE_DIR%\server.py"
set "STARTER_FILE=%ENGINE_DIR%\start.cmd"
set "SERVER_TEMP=%TEMP%\pulse-audio-ai-server-6.2.py"
set "STARTER_TEMP=%TEMP%\start-pulse-audio-ai-6.2.cmd"
set "SERVER_URL=https://pulse-charts-asia.vercel.app/pulse-audio-ai-server.py"
set "STARTER_URL=https://pulse-charts-asia.vercel.app/start-pulse-audio-ai.cmd"

if not exist "%PYTHON_EXE%" (
  echo Chua cai Pulse Charts Audio AI.
  echo Hay chay file install-pulse-audio-ai.cmd truoc.
  pause
  exit /b 2
)

echo Dang tai engine Mix Enhance 6.2...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadFile('%SERVER_URL%','%SERVER_TEMP%'); (New-Object Net.WebClient).DownloadFile('%STARTER_URL%','%STARTER_TEMP%'); exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo Khong tai duoc engine moi. Hay kiem tra Internet roi thu lai.
  pause
  exit /b 1
)

echo Dang dong engine cu...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=@(); try { $ids+=(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop).OwningProcess } catch {}; try { $ids+=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -like '*PulseChartsAudioAI*server.py*' } | Select-Object -ExpandProperty ProcessId } catch {}; $ids | Sort-Object -Unique | Where-Object { $_ -and $_ -ne $PID } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

copy /Y "%SERVER_TEMP%" "%SERVER_FILE%" >nul
copy /Y "%STARTER_TEMP%" "%STARTER_FILE%" >nul
echo Dang mo engine moi...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%PYTHON_EXE%' -ArgumentList @('%SERVER_FILE%') -WindowStyle Hidden -RedirectStandardOutput '%ENGINE_DIR%\server.log' -RedirectStandardError '%ENGINE_DIR%\server-error.log'"

for /L %%I in (1,1,15) do (
  timeout /t 1 /nobreak >nul
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2; if($h.ok -and [version]$h.version -ge [version]'6.2'){exit 0}; exit 1 } catch { exit 1 }"
  if not errorlevel 1 goto ready
)

echo Engine moi khong khoi dong duoc. Hay chay lai bo cai tu dong.
pause
exit /b 1

:ready
echo.
echo Da cap nhat Mix Enhance 6.2 thanh cong.
echo Hay quay lai Audio Lab, bam Ctrl+F5 va chay lai file.
pause
exit /b 0
