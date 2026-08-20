@echo off
setlocal
set "ENGINE_DIR=%LOCALAPPDATA%\PulseChartsAudioAI"
set "SERVER_SOURCE=%TEMP%\pulse-audio-ai-server-latest.py"
set "SERVER_FALLBACK=%~dp0pulse-audio-ai-server.py"
set "SERVER_URL=https://pulse-charts-asia.vercel.app/pulse-audio-ai-server.py"
set "STARTER_URL=https://pulse-charts-asia.vercel.app/start-pulse-audio-ai.cmd"
set "STARTER_FILE=%ENGINE_DIR%\start.cmd"

where python >nul 2>nul
if errorlevel 1 (
  echo Can cai Python 3.11 hoac 3.12 truoc khi dung UVR AI.
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

echo Dang dong phien ban Pulse Audio AI cu neu dang chay...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ids=@(); try { $ids+=(Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction Stop).OwningProcess } catch {}; try { $ids+=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -like '*PulseChartsAudioAI*server.py*' } | Select-Object -ExpandProperty ProcessId } catch {}; $ids | Sort-Object -Unique | Where-Object { $_ -and $_ -ne $PID } | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

if not exist "%ENGINE_DIR%" mkdir "%ENGINE_DIR%"
copy /Y "%SERVER_SOURCE%" "%ENGINE_DIR%\server.py" >nul
if not exist "%ENGINE_DIR%\venv\Scripts\python.exe" python -m venv "%ENGINE_DIR%\venv"
call "%ENGINE_DIR%\venv\Scripts\activate.bat"
python -m pip install --upgrade pip
python -m pip install demucs faster-whisper fastapi uvicorn python-multipart imageio-ffmpeg pypinyin "audio-separator[cpu]"

echo Dang cai bo tu khoi dong cung Windows...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (New-Object Net.WebClient).DownloadFile('%STARTER_URL%','%STARTER_FILE%'); exit 0 } catch { exit 1 }"
if errorlevel 1 (
  if exist "%~dp0start-pulse-audio-ai.cmd" copy /Y "%~dp0start-pulse-audio-ai.cmd" "%STARTER_FILE%" >nul
)
if not exist "%STARTER_FILE%" (
  echo Khong tai duoc file khoi dong. Hay kiem tra Internet roi chay lai bo cai.
  pause
  exit /b 1
)

> "%ENGINE_DIR%\start-hidden.vbs" echo Set shell = CreateObject("WScript.Shell")
>> "%ENGINE_DIR%\start-hidden.vbs" echo shell.Run Chr(34) ^& "%STARTER_FILE%" ^& Chr(34) ^& " --silent", 0, False
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "PulseChartsAudioAI" /t REG_SZ /d "wscript.exe \"%ENGINE_DIR%\start-hidden.vbs\"" /f >nul
reg add "HKCU\Software\Classes\pulsecharts-audio" /ve /d "URL:Pulse Charts Audio AI" /f >nul
reg add "HKCU\Software\Classes\pulsecharts-audio" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\pulsecharts-audio\shell\open\command" /ve /d "wscript.exe \"%ENGINE_DIR%\start-hidden.vbs\"" /f >nul

echo.
echo Pulse Audio AI da cai xong. Tu nay bo dung se tu chay cung Windows.
echo UVR MDX-Net, Demucs du phong, FFmpeg va Faster-Whisper da san sang. Tat ca deu chay mien phi tren may.
echo Dang mo bo dung trong nen...
start "" wscript.exe "%ENGINE_DIR%\start-hidden.vbs"
timeout /t 5 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h=Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 4; if($h.ok){exit 0}; exit 1 } catch { exit 1 }"
if errorlevel 1 (
  echo Bo dung dang khoi dong cham. Hay bam MO BO DUNG NGAY tren MV Studio sau vai giay.
) else (
  echo Bo dung da chay tai http://127.0.0.1:8765
)
echo Ban co the dong cua so nay.
pause
