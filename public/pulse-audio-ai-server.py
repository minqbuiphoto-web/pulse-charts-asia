import shutil
import subprocess
import sys
import tempfile
import re
import unicodedata
import json
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="2.6")
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
    expose_headers=["Content-Disposition"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "demucs + faster-whisper + ffmpeg", "version": "2.6", "alignment": True, "mvRender": True, "mvIntroSeparate": True, "mvExactTextSize": True, "mvPreviewParity": True, "mvVietnameseTextRepair": True, "mvUnifiedFont": True, "mvDynamicLineGap": True}


def ffmpeg_executable() -> str:
    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        return get_ffmpeg_exe()
    except ImportError as error:
        raise RuntimeError("Missing imageio-ffmpeg. Run the Pulse Audio AI installer again.") from error


def ass_time(seconds: float) -> str:
    value = max(0.0, seconds)
    hours = int(value // 3600)
    minutes = int(value % 3600 // 60)
    remaining = value % 60
    return f"{hours}:{minutes:02d}:{remaining:05.2f}"


def clean_lyric_text(value: str) -> str:
    text = re.sub(r"[\u200B-\u200D\u2060\uFEFF]", "", str(value or ""))
    text = re.sub(r"[\u00A0\u2000-\u200A\u202F\u205F\u3000]", " ", text)
    text = re.sub(r"\s+([\u0300-\u036f])", r"\1", text)
    text = unicodedata.normalize("NFC", text)
    return re.sub(
        r"([AĂÂEÊIOÔƠUƯYĐaăâeêioôơuưyđÀ-ỹ])\s+(ng|nh|ch|[nmtcp])(?=[,.;:!?…\)\]}\"'’”]|\s|$)",
        r"\1\2", text, flags=re.IGNORECASE,
    )


def ass_escape(value: str) -> str:
    return clean_lyric_text(value).replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def ass_color(value: str, fallback: str) -> str:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    rgb = match.group(1) if match else fallback.replace("#", "")
    return f"&H00{rgb[4:6]}{rgb[2:4]}{rgb[0:2]}"


def safe_font(value: str, fallback: str) -> str:
    clean = re.sub(r"[^\w .-]+", "", str(value or ""), flags=re.UNICODE).strip()
    # Georgia and Trebuchet shipped on this Windows machine omit many Vietnamese
    # precomposed glyphs, causing libass to switch font for accented characters only.
    # Map every accepted family to one verified to contain the full Vietnamese set.
    verified = {
        "arial": "Arial", "tahoma": "Tahoma", "times new roman": "Times New Roman",
        "verdana": "Verdana", "courier new": "Courier New",
        "georgia": "Times New Roman", "trebuchet ms": "Tahoma",
    }
    return verified.get(clean.casefold(), verified.get(str(fallback).casefold(), "Arial"))


def write_ass_subtitles(target: Path, rows: list[dict], styles: dict, mode: str, width: int, height: int,
                        clip_start: float, clip_end: float, intro_duration: float):
    original = styles.get("original", {})
    literal = styles.get("literal", {})
    vietnamese = styles.get("vietnamese", {})
    original_size = max(12, min(96, round(float(original.get("fontSize", 25)))))
    literal_size = max(12, min(96, round(float(literal.get("fontSize", 19)))))
    original_top = 62
    literal_top = original_top + round(original_size * 1.2) + max(14, round(max(original_size, literal_size) * .45))
    def style_line(name: str, data: dict, fallback_font: str, fallback_size: int, fallback_color: str,
                   alignment: int, margin_v: int):
        font = safe_font(data.get("fontFamily"), fallback_font)
        # ASS PlayRes already matches the output resolution. Fontsize must therefore use the
        # exact value selected in MV Studio; scaling it again made 1080p text 1.5x larger and
        # vertical 1920p text 2.67x larger than the preview.
        size = max(12, min(96, round(float(data.get("fontSize", fallback_size)))))
        color = ass_color(data.get("color"), fallback_color)
        bold = -1 if int(data.get("fontWeight", 400)) >= 600 else 0
        italic = -1 if data.get("fontStyle") == "italic" else 0
        spacing_value = str(data.get("letterSpacing", "0") or "0").strip().lower()
        try:
            spacing = float(spacing_value[:-2]) * size if spacing_value.endswith("em") else float(spacing_value.removesuffix("px"))
        except ValueError:
            spacing = 0
        spacing = max(-10, min(20, spacing))
        outline = 3 if height >= 1080 else 2
        return f"Style: {name},{font},{size},{color},&H000000FF,&H00101010,&HA0000000,{bold},{italic},0,0,100,100,{spacing:.2f},0,1,{outline},1,{alignment},45,45,{margin_v},1"
    header = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes", "WrapStyle: 2", "", "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        style_line("Original", original, "Arial", 25, "#FFFFFF", 8, original_top),
        style_line("Literal", literal, "Arial", 19, "#BFE7FF", 8, literal_top),
        style_line("Vietnamese", vietnamese, "Arial", 36, "#D6FF4B", 2, 64),
        "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    events = []
    visible_rows = [row for row in rows if float(row.get("end", 0)) > clip_start and float(row.get("time", 0)) < clip_end]
    if visible_rows:
        first_start = max(0.0, float(visible_rows[0].get("time", 0)) - clip_start + intro_duration)
        label_start = intro_duration
        if first_start > label_start + .15:
            events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Original,,0,0,0,,Lời gốc")
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Literal,,0,0,0,,Nghĩa dịch sát")
            events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Vietnamese,,0,0,0,,Lời Việt")
    for row in visible_rows:
        start = max(0.0, float(row.get("time", 0)) - clip_start + intro_duration)
        end = min(clip_end - clip_start + intro_duration, float(row.get("end", 0)) - clip_start + intro_duration)
        if end <= start:
            continue
        original_text = ass_escape(row.get("original", ""))
        literal_text = ass_escape(row.get("literal", ""))
        vietnamese_text = ass_escape(row.get("vietnamese", ""))
        if original_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Original,,0,0,0,,{original_text}")
        if mode == "music" and literal_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Literal,,0,0,0,,{literal_text}")
        if vietnamese_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Vietnamese,,0,0,0,,{vietnamese_text}")
    target.write_text("\n".join(header + events), encoding="utf-8-sig")


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


@app.post("/render-mv")
async def render_mv(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    images: list[UploadFile] = File(...),
    motion_clips: list[UploadFile] | None = File(None),
    thumbnail: UploadFile | None = File(None),
    rows_json: str = Form(...),
    styles_json: str = Form("{}"),
    mode: str = Form("music"),
    video_format: str = Form("landscape"),
    clip_start: float = Form(0.0),
    clip_end: float = Form(0.0),
    intro_duration: float = Form(0.0),
):
    """Render a finished MP4 locally. This never records the browser or waits for real-time playback."""
    if not images:
        raise HTTPException(400, "At least one artwork image is required")
    try:
        rows = json.loads(rows_json)
        styles = json.loads(styles_json)
        if not isinstance(rows, list) or not isinstance(styles, dict):
            raise ValueError()
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(400, "Invalid timeline or text style data")
    clip_start = max(0.0, float(clip_start))
    clip_end = float(clip_end)
    if clip_end <= clip_start:
        raise HTTPException(400, "The end time must be after the start time")
    intro_duration = max(0.0, min(15.0, float(intro_duration if thumbnail else 0.0)))
    work = Path(tempfile.mkdtemp(prefix="pulse-mv-render-"))
    try:
        audio_path = work / f"audio{Path(audio.filename or 'song.wav').suffix or '.wav'}"
        await write_upload(audio, audio_path)
        image_paths = []
        for index, upload in enumerate(images):
            suffix = Path(upload.filename or "image.jpg").suffix or ".jpg"
            path = work / f"art-{index:03d}{suffix}"
            await write_upload(upload, path)
            image_paths.append(path)
        motion_paths = []
        for index, upload in enumerate(motion_clips or []):
            suffix = Path(upload.filename or "motion.webm").suffix or ".webm"
            path = work / f"motion-{index:03d}{suffix}"
            await write_upload(upload, path)
            motion_paths.append(path)
        thumbnail_path = None
        if thumbnail:
            suffix = Path(thumbnail.filename or "thumbnail.jpg").suffix or ".jpg"
            thumbnail_path = work / f"thumbnail{suffix}"
            await write_upload(thumbnail, thumbnail_path)

        width, height = (1080, 1920) if video_format == "vertical" else (1920, 1080)
        fps = 30
        song_duration = clip_end - clip_start
        artwork_duration = song_duration / len(image_paths)
        ffmpeg = ffmpeg_executable()
        segment_paths = []
        source_segments: list[tuple[Path, float, bool]] = []
        if thumbnail_path and intro_duration > 0:
            source_segments.append((thumbnail_path, intro_duration, False))
        source_segments.extend((motion_paths[index] if index < len(motion_paths) else path, artwork_duration, index < len(motion_paths)) for index, path in enumerate(image_paths))
        for index, (media_path, segment_duration, is_video) in enumerate(source_segments):
            segment = work / f"segment-{index:03d}.mp4"
            input_args = ["-stream_loop", "-1", "-i", str(media_path)] if is_video else ["-loop", "1", "-i", str(media_path)]
            command = [
                ffmpeg, "-y", *input_args, "-t", f"{segment_duration:.3f}",
                "-vf", f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,format=yuv420p",
                "-r", str(fps), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                "-movflags", "+faststart", str(segment),
            ]
            subprocess.run(command, check=True, timeout=60 * 30, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            segment_paths.append(segment)
        concat_file = work / "segments.txt"
        concat_file.write_text("\n".join(f"file '{path.as_posix()}'" for path in segment_paths), encoding="utf-8")
        silent_video = work / "visuals.mp4"
        subprocess.run([
            ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file),
            "-c", "copy", "-movflags", "+faststart", str(silent_video),
        ], check=True, timeout=60 * 20, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

        subtitle_path = work / "lyrics.ass"
        write_ass_subtitles(subtitle_path, rows, styles, mode, width, height, clip_start, clip_end, intro_duration)
        output = work / "pulse-mv.mp4"
        total_duration = intro_duration + song_duration
        subtitle_filter = str(subtitle_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        song_filter = (
            f"[1:a]atrim=start={clip_start:.3f}:end={clip_end:.3f},asetpts=PTS-STARTPTS,"
            "aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[song]"
        )
        if intro_duration > 0:
            audio_filter = (
                f"{song_filter};anullsrc=channel_layout=stereo:sample_rate=48000,"
                f"atrim=duration={intro_duration:.3f},asetpts=PTS-STARTPTS[intro_silence];"
                f"[intro_silence][song]concat=n=2:v=0:a=1,atrim=duration={total_duration:.3f}[a]"
            )
        else:
            audio_filter = f"{song_filter};[song]apad=whole_dur={total_duration:.3f},atrim=duration={total_duration:.3f}[a]"
        filter_complex = f"[0:v]subtitles='{subtitle_filter}'[v];{audio_filter}"
        subprocess.run([
            ffmpeg, "-y", "-i", str(silent_video), "-i", str(audio_path),
            "-filter_complex", filter_complex, "-map", "[v]", "-map", "[a]", "-t", f"{total_duration:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(output),
        ], check=True, timeout=60 * 60, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if not output.exists() or output.stat().st_size < 1024:
            raise RuntimeError("FFmpeg did not create a valid video")
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", Path(audio.filename or "pulse-mv").stem).strip("-") or "pulse-mv"
        suffix = "-vertical" if video_format == "vertical" else ""
        background_tasks.add_task(shutil.rmtree, work, True)
        return FileResponse(output, media_type="video/mp4", filename=f"{safe_name}{suffix}.mp4")
    except HTTPException:
        shutil.rmtree(work, ignore_errors=True)
        raise
    except subprocess.CalledProcessError as error:
        detail = error.stderr.decode("utf-8", errors="ignore")[-1200:] if error.stderr else str(error)
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"FFmpeg render failed: {detail}") from error
    except Exception as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"MV render failed: {error}") from error


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8765)
