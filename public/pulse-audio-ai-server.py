import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pulse-charts-asia.minqbuiphoto.chatgpt.site",
        "https://pulse-charts-asia.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "demucs-htdemucs"}


@app.post("/separate")
async def separate(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    suffix = Path(file.filename or "song.wav").suffix or ".wav"
    work = Path(tempfile.mkdtemp(prefix="pulse-audio-ai-"))
    source = work / f"input{suffix}"
    with source.open("wb") as target:
        while chunk := await file.read(1024 * 1024):
            target.write(chunk)
    if source.stat().st_size > 500 * 1024 * 1024:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(413, "File exceeds 500 MB")
    command = [
        sys.executable, "-m", "demucs.separate", "-n", "htdemucs",
        "--two-stems", "vocals", "-o", str(work / "separated"), str(source),
    ]
    try:
        subprocess.run(command, check=True, timeout=60 * 60)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"Demucs failed: {error}") from error
    beat = work / "separated" / "htdemucs" / source.stem / "no_vocals.wav"
    if not beat.exists():
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, "Demucs did not create the instrumental stem")
    background_tasks.add_task(shutil.rmtree, work, True)
    return FileResponse(beat, media_type="audio/wav", filename=f"{source.stem}_instrumental.wav")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
