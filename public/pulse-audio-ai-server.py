import shutil
import subprocess
import sys
import tempfile
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="2.0")
whisper_model = None
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
    return {"ok": True, "engine": "demucs + faster-whisper", "alignment": True}


def get_whisper_model():
    global whisper_model
    if whisper_model is None:
        from faster_whisper import WhisperModel
        whisper_model = WhisperModel("small", device="cpu", compute_type="int8")
    return whisper_model


def save_upload(file: UploadFile, work: Path) -> Path:
    suffix = Path(file.filename or "song.wav").suffix or ".wav"
    return work / f"input{suffix}"


async def write_upload(file: UploadFile, target: Path):
    with target.open("wb") as output:
        while chunk := await file.read(1024 * 1024):
            output.write(chunk)
    if target.stat().st_size > 500 * 1024 * 1024:
        raise HTTPException(413, "File exceeds 500 MB")


def isolate_vocals(source: Path, work: Path) -> Path:
    command = [
        sys.executable, "-m", "demucs.separate", "-n", "htdemucs",
        "--two-stems", "vocals", "-o", str(work / "separated"), str(source),
    ]
    subprocess.run(command, check=True, timeout=60 * 60)
    vocal = work / "separated" / "htdemucs" / source.stem / "vocals.wav"
    if not vocal.exists():
        raise RuntimeError("Demucs did not create the vocal stem")
    return vocal


def normalize_word(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    without_marks = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9đ]+", "", without_marks)


def lyric_tokens(lines: list[str]):
    tokens = []
    starts = []
    for line_index, line in enumerate(lines):
        starts.append(len(tokens))
        for raw in re.findall(r"[\wÀ-ỹĐđ]+", line, flags=re.UNICODE):
            word = normalize_word(raw)
            if word:
                tokens.append((word, line_index))
    return tokens, starts


def token_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    if len(left) <= 2 or len(right) <= 2:
        return 0.0
    return SequenceMatcher(None, left, right).ratio()


def align_line_times(lines: list[str], heard: list[dict], duration: float) -> list[float]:
    wanted, line_token_starts = lyric_tokens(lines)
    recognized = [(normalize_word(item["word"]), float(item["start"])) for item in heard]
    recognized = [item for item in recognized if item[0]]
    if not wanted or not recognized:
        step = max(duration, len(lines) * 4) / max(len(lines), 1)
        return [round(index * step, 3) for index in range(len(lines))]

    rows, cols = len(wanted), len(recognized)
    gap = -0.9
    score = [[0.0] * (cols + 1) for _ in range(rows + 1)]
    trace = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(1, rows + 1):
        score[i][0] = i * gap
        trace[i][0] = 1
    for j in range(1, cols + 1):
        score[0][j] = j * gap
        trace[0][j] = 2
    for i in range(1, rows + 1):
        wanted_word = wanted[i - 1][0]
        for j in range(1, cols + 1):
            similarity = token_similarity(wanted_word, recognized[j - 1][0])
            match = score[i - 1][j - 1] + (3.0 if similarity >= .98 else 1.4 if similarity >= .72 else -1.2)
            delete = score[i - 1][j] + gap
            insert = score[i][j - 1] + gap
            best = max(match, delete, insert)
            score[i][j] = best
            trace[i][j] = 0 if best == match else 1 if best == delete else 2

    token_matches = {}
    i, j = rows, cols
    while i and j:
        direction = trace[i][j]
        if direction == 0:
            if token_similarity(wanted[i - 1][0], recognized[j - 1][0]) >= .58:
                token_matches[i - 1] = j - 1
            i -= 1
            j -= 1
        elif direction == 1:
            i -= 1
        else:
            j -= 1

    known = {}
    for line_index, token_start in enumerate(line_token_starts):
        next_start = line_token_starts[line_index + 1] if line_index + 1 < len(line_token_starts) else len(wanted)
        matches = [token_matches[index] for index in range(token_start, next_start) if index in token_matches]
        if matches:
            known[line_index] = recognized[min(matches)][1]

    if not known:
        first = recognized[0][1]
        usable = max(first, min(duration, recognized[-1][1] + 2))
        return [round(first + (usable - first) * index / max(len(lines), 1), 3) for index in range(len(lines))]

    times = [0.0] * len(lines)
    anchors = sorted(known)
    for line_index in range(len(lines)):
        if line_index in known:
            times[line_index] = known[line_index]
            continue
        before = next((index for index in reversed(anchors) if index < line_index), None)
        after = next((index for index in anchors if index > line_index), None)
        if before is not None and after is not None:
            ratio = (line_index - before) / (after - before)
            times[line_index] = known[before] + (known[after] - known[before]) * ratio
        elif after is not None:
            times[line_index] = max(0.0, known[after] - (after - line_index) * 3.5)
        else:
            times[line_index] = min(duration, known[before] + (line_index - before) * 3.5)
    for index in range(1, len(times)):
        times[index] = max(times[index], times[index - 1] + .12)
    return [round(min(max(value, 0.0), max(duration - .1, 0.0)), 3) for value in times]


def align_line_ends(lines: list[str], times: list[float], heard: list[dict], duration: float) -> list[float]:
    """Find when each sung line ends so instrumental gaps remain lyric-free."""
    ends = []
    for index, start in enumerate(times):
        next_start = times[index + 1] if index + 1 < len(times) else duration
        ceiling = max(start + .18, next_start - .12) if index + 1 < len(times) else max(start + .18, duration)
        word_ends = [
            float(item["end"])
            for item in heard
            if float(item["start"]) >= start - .12 and float(item["start"]) < ceiling
        ]
        word_count = max(1, len(lines[index].split()))
        estimated = start + min(7.5, max(1.2, word_count * .46))
        detected = max(word_ends) if word_ends else estimated
        end = min(ceiling, max(start + .18, detected + .08))
        ends.append(round(end, 3))
    return ends


@app.post("/align-lyrics")
async def align_lyrics(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    lyrics: str = Form(...),
):
    lines = [line.strip() for line in lyrics.splitlines() if line.strip()]
    if not lines:
        raise HTTPException(400, "Vietnamese lyrics are required, one sentence per line")
    work = Path(tempfile.mkdtemp(prefix="pulse-lyric-align-"))
    source = save_upload(file, work)
    try:
        await write_upload(file, source)
        try:
            vocal = isolate_vocals(source, work)
            audio_for_alignment = vocal
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError):
            audio_for_alignment = source
        model = get_whisper_model()
        segments, info = model.transcribe(
            str(audio_for_alignment), language="vi", beam_size=5,
            word_timestamps=True, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 250},
        )
        heard = []
        transcript = []
        last_end = 0.0
        for segment in segments:
            transcript.append(segment.text.strip())
            last_end = max(last_end, float(segment.end))
            for word in segment.words or []:
                heard.append({"word": word.word.strip(), "start": float(word.start), "end": float(word.end)})
        duration = float(getattr(info, "duration", 0.0) or last_end)
        times = align_line_times(lines, heard, duration)
        ends = align_line_ends(lines, times, heard, duration)
        background_tasks.add_task(shutil.rmtree, work, True)
        return {
            "ok": True,
            "method": "demucs + faster-whisper-small + lyric alignment",
            "times": times,
            "ends": ends,
            "lineCount": len(lines),
            "recognizedWords": len(heard),
            "transcript": " ".join(part for part in transcript if part),
        }
    except HTTPException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    except Exception as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"Lyric alignment failed: {error}") from error


@app.post("/separate")
async def separate(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    work = Path(tempfile.mkdtemp(prefix="pulse-audio-ai-"))
    source = save_upload(file, work)
    try:
        await write_upload(file, source)
    except HTTPException:
        shutil.rmtree(work, ignore_errors=True)
        raise
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
