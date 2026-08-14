import shutil
import subprocess
import sys
import tempfile
import re
import unicodedata
import json
import logging
import math
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="4.5")
whisper_model = None
MV_EXPORT_LYRIC_LEAD_SECONDS = 1.0
UVR_INSTRUMENTAL_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pulse-charts-asia.minqbuiphoto.chatgpt.site",
        "https://pulse-charts-asia.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Pulse-Separation-Engine"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "UVR MDX-Net + Demucs fallback + faster-whisper + ffmpeg", "version": "4.5", "alignment": True, "lineStartAlignment": True, "mvImageScale": True, "mvImageScaleDown": True, "mvImageScaleContinuous": True, "mvRender": True, "mvIntroSeparate": True, "mvExactTextSize": True, "mvPreviewParity": True, "mvVietnameseTextRepair": True, "mvUnifiedFont": True, "mvDynamicLineGap": True, "mvVerticalMotion": True, "mvVerticalLyricLayout": True, "mvManualLyricPositions": True, "mvSmartLyricWrap": True, "mvUnifiedTimeline": True, "mvExportLyricLead": True, "mvFormatSpecificLyricLead": True, "mvIntroLabelSync": True, "mvLiteralAlways": True, "mvKaraokeSweep": True, "mvKaraokeReadableSweep": True, "mvAutoKaraokeBeat": True, "mvDirectKaraokeBeat": True, "mvKaraokeIntroClean": True, "uvrInstrumental": True, "uvrModel": UVR_INSTRUMENTAL_MODEL, "mvExportLyricLeadSeconds": MV_EXPORT_LYRIC_LEAD_SECONDS}


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


def readable_karaoke_color(value: str) -> str:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    if not match:
        return "#3B82F6"
    rgb = match.group(1)
    red, green, blue = (int(rgb[index:index + 2], 16) for index in (0, 2, 4))
    # Very dark selected colours become indistinguishable from the subtitle outline.
    return "#3B82F6" if (red * 299 + green * 587 + blue * 114) / 1000 < 105 else f"#{rgb.upper()}"


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


def write_ass_subtitles(target: Path, rows: list[dict], styles: dict, positions: dict, mode: str, width: int, height: int,
                        clip_start: float, clip_end: float, intro_duration: float, timeline_space: str = "source"):
    original = styles.get("original", {})
    literal = styles.get("literal", {})
    vietnamese = styles.get("vietnamese", {})
    if mode == "karaoke":
        vietnamese = {**vietnamese, "color": readable_karaoke_color(vietnamese.get("color"))}
    defaults = {"original": 48 if height > width else 6, "literal": 60 if height > width else 13, "vietnamese": 72 if height > width else 82}
    def position_margin(key: str) -> int:
        try:
            percent = max(3.0, min(92.0, float(positions.get(key, defaults[key]))))
        except (TypeError, ValueError):
            percent = defaults[key]
        return round(height * percent / 100)
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
        # SecondaryColour is the not-yet-sung karaoke colour. Normal MV text does
        # not use it, while ASS \kf fills it progressively with PrimaryColour.
        return f"Style: {name},{font},{size},{color},&H00C8C8C8,&H00101010,&HA0000000,{bold},{italic},0,0,100,100,{spacing:.2f},0,1,{outline},1,{alignment},45,45,{margin_v},1"
    header = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        # WrapStyle 0 makes libass wrap long lyrics within MarginL/MarginR. WrapStyle 2
        # disables automatic wrapping and caused vertical lyrics to be clipped off-screen.
        "ScaledBorderAndShadow: yes", "WrapStyle: 0", "", "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        style_line("Original", original, "Arial", 25, "#FFFFFF", 8, position_margin("original")),
        style_line("Literal", literal, "Arial", 19, "#BFE7FF", 8, position_margin("literal")),
        style_line("Vietnamese", vietnamese, "Arial", 36, "#D6FF4B", 8, position_margin("vietnamese")),
        "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    events = []
    output_timeline = timeline_space == "output"
    output_end = intro_duration + clip_end - clip_start
    # The vertical Windows render path needs a one-second subtitle lead. Landscape
    # already matches the browser preview, so the same shift made 16:9 lyrics early.
    export_lyric_lead = MV_EXPORT_LYRIC_LEAD_SECONDS if height > width else 0.0
    visible_rows = ([row for row in rows if float(row.get("end", 0)) > 0 and float(row.get("time", 0)) < output_end]
                    if output_timeline else
                    [row for row in rows if float(row.get("end", 0)) > clip_start and float(row.get("time", 0)) < clip_end])
    if visible_rows:
        first_start = (max(0.0, float(visible_rows[0].get("time", 0))) if output_timeline else
                       max(0.0, float(visible_rows[0].get("time", 0)) - clip_start + intro_duration))
        # The opening labels must disappear at the compensated first lyric start,
        # otherwise both the labels and the first lyric overlap for one second.
        first_start = max(intro_duration, first_start - export_lyric_lead)
        label_start = intro_duration
        if first_start > label_start + .15:
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Original,,0,0,0,,Lời gốc")
            if mode == "music" and any(str(row.get("literal", "")).strip() for row in visible_rows):
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Literal,,0,0,0,,Nghĩa dịch sát")
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Vietnamese,,0,0,0,,Lời Việt")
    for row in visible_rows:
        start = (max(0.0, float(row.get("time", 0))) if output_timeline else
                 max(0.0, float(row.get("time", 0)) - clip_start + intro_duration))
        end = (min(output_end, float(row.get("end", 0))) if output_timeline else
               min(output_end, float(row.get("end", 0)) - clip_start + intro_duration))
        # On the Windows FFmpeg/libass path used by the local renderer, burned-in
        # subtitles appear about one second later than the matching browser preview.
        # Compensate only while writing the MP4 subtitle track; the saved timeline
        # and preview remain unchanged. Never let a lyric overlap the thumbnail intro.
        start = max(intro_duration, start - export_lyric_lead)
        end = max(start + .05, end - export_lyric_lead)
        if end <= start:
            continue
        original_text = ass_escape(row.get("original", ""))
        literal_text = ass_escape(row.get("literal", ""))
        vietnamese_text = ass_escape(row.get("vietnamese", ""))
        if mode == "music" and original_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Original,,0,0,0,,{original_text}")
        if mode == "music" and literal_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Literal,,0,0,0,,{literal_text}")
        if vietnamese_text:
            if mode == "karaoke":
                sweep_cs = max(1, round((end - start) * 100))
                vietnamese_text = f"{{\\kf{sweep_cs}}}{vietnamese_text}"
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


def uvr_model_directory() -> Path:
    cache = Path(__file__).resolve().parent / "models"
    cache.mkdir(parents=True, exist_ok=True)
    cached_model = cache / UVR_INSTRUMENTAL_MODEL
    if cached_model.exists():
        return cache
    candidates = [
        Path.home() / "AppData" / "Local" / "Programs" / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
        Path.home() / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.parent
    return cache


def separate_instrumental(source: Path, work: Path) -> tuple[Path, str]:
    """Prefer UVR's instrumental model; retain Demucs as an automatic fallback."""
    output_dir = work / "uvr-separated"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        from audio_separator.separator import Separator
        separator = Separator(
            log_level=logging.WARNING,
            model_file_dir=str(uvr_model_directory()),
            output_dir=str(output_dir),
            output_format="WAV",
            output_single_stem="Instrumental",
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.5, "batch_size": 1, "enable_denoise": True},
        )
        separator.load_model(model_filename=UVR_INSTRUMENTAL_MODEL)
        outputs = separator.separate(str(source))
        for output_name in outputs:
            candidate = Path(output_name)
            if not candidate.is_absolute():
                candidate = output_dir / candidate
            if candidate.exists() and candidate.suffix.casefold() == ".wav":
                return candidate, f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        candidates = sorted(output_dir.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)
        if candidates:
            return candidates[0], f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        raise RuntimeError("UVR did not create an instrumental WAV")
    except Exception:
        logging.getLogger(__name__).warning(
            "UVR separation failed; using Demucs fallback.", exc_info=True
        )
        demucs_dir = work / "demucs-separated"
        command = [
            sys.executable, "-m", "demucs.separate", "-n", "htdemucs",
            "--two-stems", "vocals", "-o", str(demucs_dir), str(source),
        ]
        subprocess.run(command, check=True, timeout=60 * 60)
        beat = demucs_dir / "htdemucs" / source.stem / "no_vocals.wav"
        if not beat.exists():
            raise RuntimeError("Neither UVR nor Demucs created an instrumental stem")
        return beat, "Demucs fallback · htdemucs"


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
    line_words = [
        [normalize_word(raw) for raw in re.findall(r"[\wÀ-ỹĐđ]+", line, flags=re.UNICODE) if normalize_word(raw)]
        for line in lines
    ]
    recognized = [(normalize_word(item["word"]), float(item["start"])) for item in heard]
    recognized = [item for item in recognized if item[0]]
    if not any(line_words) or not recognized:
        step = max(duration, len(lines) * 4) / max(len(lines), 1)
        return [round(index * step, 3) for index in range(len(lines))]

    total_words = sum(max(len(words), 1) for words in line_words)
    consumed_words = 0
    previous_word = -1
    times = []
    for words in line_words:
        expected = round(consumed_words / max(total_words, 1) * (len(recognized) - 1))
        radius = max(14, round(len(recognized) / max(len(lines), 1) * 2.3))
        low = max(previous_word + 1, expected - radius)
        high = min(len(recognized) - 1, expected + radius)
        best_index = max(low, min(expected, high))
        best_score = float("-inf")
        for candidate in range(low, high + 1):
            window = [item[0] for item in recognized[candidate:candidate + max(len(words) + 3, 6)]]
            hits = sum(max((token_similarity(word, heard_word) for heard_word in window), default=0.0) for word in words)
            score = hits / max(len(words), 1) - abs(candidate - expected) / max(radius, 1) * .22
            lead = max((
                token_similarity(words[word_index], window[heard_index]) - .10 * heard_index - .04 * word_index
                for word_index in range(min(3, len(words)))
                for heard_index in range(min(4, len(window)))
            ), default=0.0)
            score += max(0.0, lead) * .48
            if score > best_score:
                best_score = score
                best_index = candidate
        # The whole-line score can land on a well-recognized word near the end of a
        # sung phrase. Walk back to the earliest plausible leading word so the lyric
        # appears when the singer starts the sentence, not several seconds later.
        leading_candidates = []
        for candidate in range(max(previous_word + 1, best_index - 6), min(len(recognized), best_index + 4)):
            leading_score = max((token_similarity(word, recognized[candidate][0]) for word in words[:3]), default=0.0)
            if leading_score >= .72:
                leading_candidates.append((leading_score, candidate))
        if leading_candidates:
            strongest = max(score for score, _ in leading_candidates)
            best_index = min(candidate for score, candidate in leading_candidates if score >= strongest - .02)
        segment_starts = [
            candidate for candidate in range(max(previous_word + 1, best_index - 4), min(len(heard), best_index + 5))
            if heard[candidate].get("segment_start")
        ]
        if segment_starts:
            best_index = min(segment_starts, key=lambda candidate: abs(candidate - best_index))
        times.append(recognized[best_index][1])
        previous_word = best_index
        consumed_words += max(len(words), 1)
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
            for word_index, word in enumerate(segment.words or []):
                heard.append({"word": word.word.strip(), "start": float(word.start), "end": float(word.end), "segment_start": word_index == 0})
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
    try:
        beat, separation_engine = separate_instrumental(source, work)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError) as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"UVR and Demucs separation failed: {error}") from error
    background_tasks.add_task(shutil.rmtree, work, True)
    return FileResponse(
        beat,
        media_type="audio/wav",
        filename=f"{source.stem}_instrumental.wav",
        headers={"X-Pulse-Separation-Engine": separation_engine},
    )


@app.post("/render-mv")
async def render_mv(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    images: list[UploadFile] = File(...),
    motion_clips: list[UploadFile] | None = File(None),
    thumbnail: UploadFile | None = File(None),
    rows_json: str = Form(...),
    styles_json: str = Form("{}"),
    positions_json: str = Form("{}"),
    mode: str = Form("music"),
    video_format: str = Form("landscape"),
    clip_start: float = Form(0.0),
    clip_end: float = Form(0.0),
    intro_duration: float = Form(0.0),
    timeline_space: str = Form("source"),
):
    """Render a finished MP4 locally. This never records the browser or waits for real-time playback."""
    if not images:
        raise HTTPException(400, "At least one artwork image is required")
    try:
        rows = json.loads(rows_json)
        styles = json.loads(styles_json)
        positions = json.loads(positions_json)
        if not isinstance(rows, list) or not isinstance(styles, dict) or not isinstance(positions, dict):
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
        image_scale = max(0.5, min(1.8, float(positions.get("imageScale", 100)) / 100.0))
        scaled_width = int(math.ceil(width * image_scale / 2.0) * 2)
        scaled_height = int(math.ceil(height * image_scale / 2.0) * 2)
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
            if image_scale >= 1.0:
                video_filter = f"scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,format=yuv420p"
            else:
                video_filter = (
                    f"split=2[background][foreground];"
                    f"[background]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                    f"boxblur=20:1,eq=brightness=-0.18[blurred];"
                    f"[foreground]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                    f"scale={scaled_width}:{scaled_height}[smaller];"
                    f"[blurred][smaller]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p"
                )
            command = [
                ffmpeg, "-y", *input_args, "-t", f"{segment_duration:.3f}",
                "-vf", video_filter,
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
        write_ass_subtitles(subtitle_path, rows, styles, positions, mode, width, height, clip_start, clip_end, intro_duration, timeline_space)
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
import shutil
import subprocess
import sys
import tempfile
import re
import unicodedata
import json
import logging
import math
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="4.4")
whisper_model = None
MV_EXPORT_LYRIC_LEAD_SECONDS = 1.0
UVR_INSTRUMENTAL_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pulse-charts-asia.minqbuiphoto.chatgpt.site",
        "https://pulse-charts-asia.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Pulse-Separation-Engine"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "UVR MDX-Net + Demucs fallback + faster-whisper + ffmpeg", "version": "4.4", "alignment": True, "lineStartAlignment": True, "mvImageScale": True, "mvImageScaleDown": True, "mvRender": True, "mvIntroSeparate": True, "mvExactTextSize": True, "mvPreviewParity": True, "mvVietnameseTextRepair": True, "mvUnifiedFont": True, "mvDynamicLineGap": True, "mvVerticalMotion": True, "mvVerticalLyricLayout": True, "mvManualLyricPositions": True, "mvSmartLyricWrap": True, "mvUnifiedTimeline": True, "mvExportLyricLead": True, "mvFormatSpecificLyricLead": True, "mvIntroLabelSync": True, "mvLiteralAlways": True, "mvKaraokeSweep": True, "mvKaraokeReadableSweep": True, "mvAutoKaraokeBeat": True, "mvDirectKaraokeBeat": True, "mvKaraokeIntroClean": True, "uvrInstrumental": True, "uvrModel": UVR_INSTRUMENTAL_MODEL, "mvExportLyricLeadSeconds": MV_EXPORT_LYRIC_LEAD_SECONDS}


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


def readable_karaoke_color(value: str) -> str:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    if not match:
        return "#3B82F6"
    rgb = match.group(1)
    red, green, blue = (int(rgb[index:index + 2], 16) for index in (0, 2, 4))
    # Very dark selected colours become indistinguishable from the subtitle outline.
    return "#3B82F6" if (red * 299 + green * 587 + blue * 114) / 1000 < 105 else f"#{rgb.upper()}"


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


def write_ass_subtitles(target: Path, rows: list[dict], styles: dict, positions: dict, mode: str, width: int, height: int,
                        clip_start: float, clip_end: float, intro_duration: float, timeline_space: str = "source"):
    original = styles.get("original", {})
    literal = styles.get("literal", {})
    vietnamese = styles.get("vietnamese", {})
    if mode == "karaoke":
        vietnamese = {**vietnamese, "color": readable_karaoke_color(vietnamese.get("color"))}
    defaults = {"original": 48 if height > width else 6, "literal": 60 if height > width else 13, "vietnamese": 72 if height > width else 82}
    def position_margin(key: str) -> int:
        try:
            percent = max(3.0, min(92.0, float(positions.get(key, defaults[key]))))
        except (TypeError, ValueError):
            percent = defaults[key]
        return round(height * percent / 100)
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
        # SecondaryColour is the not-yet-sung karaoke colour. Normal MV text does
        # not use it, while ASS \kf fills it progressively with PrimaryColour.
        return f"Style: {name},{font},{size},{color},&H00C8C8C8,&H00101010,&HA0000000,{bold},{italic},0,0,100,100,{spacing:.2f},0,1,{outline},1,{alignment},45,45,{margin_v},1"
    header = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        # WrapStyle 0 makes libass wrap long lyrics within MarginL/MarginR. WrapStyle 2
        # disables automatic wrapping and caused vertical lyrics to be clipped off-screen.
        "ScaledBorderAndShadow: yes", "WrapStyle: 0", "", "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        style_line("Original", original, "Arial", 25, "#FFFFFF", 8, position_margin("original")),
        style_line("Literal", literal, "Arial", 19, "#BFE7FF", 8, position_margin("literal")),
        style_line("Vietnamese", vietnamese, "Arial", 36, "#D6FF4B", 8, position_margin("vietnamese")),
        "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    events = []
    output_timeline = timeline_space == "output"
    output_end = intro_duration + clip_end - clip_start
    # The vertical Windows render path needs a one-second subtitle lead. Landscape
    # already matches the browser preview, so the same shift made 16:9 lyrics early.
    export_lyric_lead = MV_EXPORT_LYRIC_LEAD_SECONDS if height > width else 0.0
    visible_rows = ([row for row in rows if float(row.get("end", 0)) > 0 and float(row.get("time", 0)) < output_end]
                    if output_timeline else
                    [row for row in rows if float(row.get("end", 0)) > clip_start and float(row.get("time", 0)) < clip_end])
    if visible_rows:
        first_start = (max(0.0, float(visible_rows[0].get("time", 0))) if output_timeline else
                       max(0.0, float(visible_rows[0].get("time", 0)) - clip_start + intro_duration))
        # The opening labels must disappear at the compensated first lyric start,
        # otherwise both the labels and the first lyric overlap for one second.
        first_start = max(intro_duration, first_start - export_lyric_lead)
        label_start = intro_duration
        if first_start > label_start + .15:
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Original,,0,0,0,,Lời gốc")
            if mode == "music" and any(str(row.get("literal", "")).strip() for row in visible_rows):
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Literal,,0,0,0,,Nghĩa dịch sát")
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Vietnamese,,0,0,0,,Lời Việt")
    for row in visible_rows:
        start = (max(0.0, float(row.get("time", 0))) if output_timeline else
                 max(0.0, float(row.get("time", 0)) - clip_start + intro_duration))
        end = (min(output_end, float(row.get("end", 0))) if output_timeline else
               min(output_end, float(row.get("end", 0)) - clip_start + intro_duration))
        # On the Windows FFmpeg/libass path used by the local renderer, burned-in
        # subtitles appear about one second later than the matching browser preview.
        # Compensate only while writing the MP4 subtitle track; the saved timeline
        # and preview remain unchanged. Never let a lyric overlap the thumbnail intro.
        start = max(intro_duration, start - export_lyric_lead)
        end = max(start + .05, end - export_lyric_lead)
        if end <= start:
            continue
        original_text = ass_escape(row.get("original", ""))
        literal_text = ass_escape(row.get("literal", ""))
        vietnamese_text = ass_escape(row.get("vietnamese", ""))
        if mode == "music" and original_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Original,,0,0,0,,{original_text}")
        if mode == "music" and literal_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Literal,,0,0,0,,{literal_text}")
        if vietnamese_text:
            if mode == "karaoke":
                sweep_cs = max(1, round((end - start) * 100))
                vietnamese_text = f"{{\\kf{sweep_cs}}}{vietnamese_text}"
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


def uvr_model_directory() -> Path:
    cache = Path(__file__).resolve().parent / "models"
    cache.mkdir(parents=True, exist_ok=True)
    cached_model = cache / UVR_INSTRUMENTAL_MODEL
    if cached_model.exists():
        return cache
    candidates = [
        Path.home() / "AppData" / "Local" / "Programs" / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
        Path.home() / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.parent
    return cache


def separate_instrumental(source: Path, work: Path) -> tuple[Path, str]:
    """Prefer UVR's instrumental model; retain Demucs as an automatic fallback."""
    output_dir = work / "uvr-separated"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        from audio_separator.separator import Separator
        separator = Separator(
            log_level=logging.WARNING,
            model_file_dir=str(uvr_model_directory()),
            output_dir=str(output_dir),
            output_format="WAV",
            output_single_stem="Instrumental",
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.5, "batch_size": 1, "enable_denoise": True},
        )
        separator.load_model(model_filename=UVR_INSTRUMENTAL_MODEL)
        outputs = separator.separate(str(source))
        for output_name in outputs:
            candidate = Path(output_name)
            if not candidate.is_absolute():
                candidate = output_dir / candidate
            if candidate.exists() and candidate.suffix.casefold() == ".wav":
                return candidate, f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        candidates = sorted(output_dir.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)
        if candidates:
            return candidates[0], f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        raise RuntimeError("UVR did not create an instrumental WAV")
    except Exception:
        logging.getLogger(__name__).warning(
            "UVR separation failed; using Demucs fallback.", exc_info=True
        )
        demucs_dir = work / "demucs-separated"
        command = [
            sys.executable, "-m", "demucs.separate", "-n", "htdemucs",
            "--two-stems", "vocals", "-o", str(demucs_dir), str(source),
        ]
        subprocess.run(command, check=True, timeout=60 * 60)
        beat = demucs_dir / "htdemucs" / source.stem / "no_vocals.wav"
        if not beat.exists():
            raise RuntimeError("Neither UVR nor Demucs created an instrumental stem")
        return beat, "Demucs fallback · htdemucs"


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
    line_words = [
        [normalize_word(raw) for raw in re.findall(r"[\wÀ-ỹĐđ]+", line, flags=re.UNICODE) if normalize_word(raw)]
        for line in lines
    ]
    recognized = [(normalize_word(item["word"]), float(item["start"])) for item in heard]
    recognized = [item for item in recognized if item[0]]
    if not any(line_words) or not recognized:
        step = max(duration, len(lines) * 4) / max(len(lines), 1)
        return [round(index * step, 3) for index in range(len(lines))]

    total_words = sum(max(len(words), 1) for words in line_words)
    consumed_words = 0
    previous_word = -1
    times = []
    for words in line_words:
        expected = round(consumed_words / max(total_words, 1) * (len(recognized) - 1))
        radius = max(14, round(len(recognized) / max(len(lines), 1) * 2.3))
        low = max(previous_word + 1, expected - radius)
        high = min(len(recognized) - 1, expected + radius)
        best_index = max(low, min(expected, high))
        best_score = float("-inf")
        for candidate in range(low, high + 1):
            window = [item[0] for item in recognized[candidate:candidate + max(len(words) + 3, 6)]]
            hits = sum(max((token_similarity(word, heard_word) for heard_word in window), default=0.0) for word in words)
            score = hits / max(len(words), 1) - abs(candidate - expected) / max(radius, 1) * .22
            lead = max((
                token_similarity(words[word_index], window[heard_index]) - .10 * heard_index - .04 * word_index
                for word_index in range(min(3, len(words)))
                for heard_index in range(min(4, len(window)))
            ), default=0.0)
            score += max(0.0, lead) * .48
            if score > best_score:
                best_score = score
                best_index = candidate
        # The whole-line score can land on a well-recognized word near the end of a
        # sung phrase. Walk back to the earliest plausible leading word so the lyric
        # appears when the singer starts the sentence, not several seconds later.
        leading_candidates = []
        for candidate in range(max(previous_word + 1, best_index - 6), min(len(recognized), best_index + 4)):
            leading_score = max((token_similarity(word, recognized[candidate][0]) for word in words[:3]), default=0.0)
            if leading_score >= .72:
                leading_candidates.append((leading_score, candidate))
        if leading_candidates:
            strongest = max(score for score, _ in leading_candidates)
            best_index = min(candidate for score, candidate in leading_candidates if score >= strongest - .02)
        segment_starts = [
            candidate for candidate in range(max(previous_word + 1, best_index - 4), min(len(heard), best_index + 5))
            if heard[candidate].get("segment_start")
        ]
        if segment_starts:
            best_index = min(segment_starts, key=lambda candidate: abs(candidate - best_index))
        times.append(recognized[best_index][1])
        previous_word = best_index
        consumed_words += max(len(words), 1)
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
            for word_index, word in enumerate(segment.words or []):
                heard.append({"word": word.word.strip(), "start": float(word.start), "end": float(word.end), "segment_start": word_index == 0})
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
    try:
        beat, separation_engine = separate_instrumental(source, work)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError) as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"UVR and Demucs separation failed: {error}") from error
    background_tasks.add_task(shutil.rmtree, work, True)
    return FileResponse(
        beat,
        media_type="audio/wav",
        filename=f"{source.stem}_instrumental.wav",
        headers={"X-Pulse-Separation-Engine": separation_engine},
    )


@app.post("/render-mv")
async def render_mv(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    images: list[UploadFile] = File(...),
    motion_clips: list[UploadFile] | None = File(None),
    thumbnail: UploadFile | None = File(None),
    rows_json: str = Form(...),
    styles_json: str = Form("{}"),
    positions_json: str = Form("{}"),
    mode: str = Form("music"),
    video_format: str = Form("landscape"),
    clip_start: float = Form(0.0),
    clip_end: float = Form(0.0),
    intro_duration: float = Form(0.0),
    timeline_space: str = Form("source"),
):
    """Render a finished MP4 locally. This never records the browser or waits for real-time playback."""
    if not images:
        raise HTTPException(400, "At least one artwork image is required")
    try:
        rows = json.loads(rows_json)
        styles = json.loads(styles_json)
        positions = json.loads(positions_json)
        if not isinstance(rows, list) or not isinstance(styles, dict) or not isinstance(positions, dict):
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
        image_scale = max(0.5, min(1.8, float(positions.get("imageScale", 100)) / 100.0))
        scaled_width = int(math.ceil(width * image_scale / 2.0) * 2)
        scaled_height = int(math.ceil(height * image_scale / 2.0) * 2)
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
            if image_scale >= 1.0:
                video_filter = f"scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,format=yuv420p"
            else:
                video_filter = (
                    f"split=2[background][foreground];"
                    f"[background]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                    f"boxblur=20:1,eq=brightness=-0.18[blurred];"
                    f"[foreground]scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=decrease[smaller];"
                    f"[blurred][smaller]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p"
                )
            command = [
                ffmpeg, "-y", *input_args, "-t", f"{segment_duration:.3f}",
                "-vf", video_filter,
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
        write_ass_subtitles(subtitle_path, rows, styles, positions, mode, width, height, clip_start, clip_end, intro_duration, timeline_space)
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
import shutil
import subprocess
import sys
import tempfile
import re
import unicodedata
import json
import logging
import math
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

app = FastAPI(title="Pulse Audio AI", version="4.3")
whisper_model = None
MV_EXPORT_LYRIC_LEAD_SECONDS = 1.0
UVR_INSTRUMENTAL_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://pulse-charts-asia.minqbuiphoto.chatgpt.site",
        "https://pulse-charts-asia.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Pulse-Separation-Engine"],
)


@app.get("/health")
def health():
    return {"ok": True, "engine": "UVR MDX-Net + Demucs fallback + faster-whisper + ffmpeg", "version": "4.3", "alignment": True, "lineStartAlignment": True, "mvImageScale": True, "mvRender": True, "mvIntroSeparate": True, "mvExactTextSize": True, "mvPreviewParity": True, "mvVietnameseTextRepair": True, "mvUnifiedFont": True, "mvDynamicLineGap": True, "mvVerticalMotion": True, "mvVerticalLyricLayout": True, "mvManualLyricPositions": True, "mvSmartLyricWrap": True, "mvUnifiedTimeline": True, "mvExportLyricLead": True, "mvFormatSpecificLyricLead": True, "mvIntroLabelSync": True, "mvLiteralAlways": True, "mvKaraokeSweep": True, "mvKaraokeReadableSweep": True, "mvAutoKaraokeBeat": True, "mvDirectKaraokeBeat": True, "mvKaraokeIntroClean": True, "uvrInstrumental": True, "uvrModel": UVR_INSTRUMENTAL_MODEL, "mvExportLyricLeadSeconds": MV_EXPORT_LYRIC_LEAD_SECONDS}


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


def readable_karaoke_color(value: str) -> str:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    if not match:
        return "#3B82F6"
    rgb = match.group(1)
    red, green, blue = (int(rgb[index:index + 2], 16) for index in (0, 2, 4))
    # Very dark selected colours become indistinguishable from the subtitle outline.
    return "#3B82F6" if (red * 299 + green * 587 + blue * 114) / 1000 < 105 else f"#{rgb.upper()}"


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


def write_ass_subtitles(target: Path, rows: list[dict], styles: dict, positions: dict, mode: str, width: int, height: int,
                        clip_start: float, clip_end: float, intro_duration: float, timeline_space: str = "source"):
    original = styles.get("original", {})
    literal = styles.get("literal", {})
    vietnamese = styles.get("vietnamese", {})
    if mode == "karaoke":
        vietnamese = {**vietnamese, "color": readable_karaoke_color(vietnamese.get("color"))}
    defaults = {"original": 48 if height > width else 6, "literal": 60 if height > width else 13, "vietnamese": 72 if height > width else 82}
    def position_margin(key: str) -> int:
        try:
            percent = max(3.0, min(92.0, float(positions.get(key, defaults[key]))))
        except (TypeError, ValueError):
            percent = defaults[key]
        return round(height * percent / 100)
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
        # SecondaryColour is the not-yet-sung karaoke colour. Normal MV text does
        # not use it, while ASS \kf fills it progressively with PrimaryColour.
        return f"Style: {name},{font},{size},{color},&H00C8C8C8,&H00101010,&HA0000000,{bold},{italic},0,0,100,100,{spacing:.2f},0,1,{outline},1,{alignment},45,45,{margin_v},1"
    header = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {width}", f"PlayResY: {height}",
        # WrapStyle 0 makes libass wrap long lyrics within MarginL/MarginR. WrapStyle 2
        # disables automatic wrapping and caused vertical lyrics to be clipped off-screen.
        "ScaledBorderAndShadow: yes", "WrapStyle: 0", "", "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        style_line("Original", original, "Arial", 25, "#FFFFFF", 8, position_margin("original")),
        style_line("Literal", literal, "Arial", 19, "#BFE7FF", 8, position_margin("literal")),
        style_line("Vietnamese", vietnamese, "Arial", 36, "#D6FF4B", 8, position_margin("vietnamese")),
        "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    events = []
    output_timeline = timeline_space == "output"
    output_end = intro_duration + clip_end - clip_start
    # The vertical Windows render path needs a one-second subtitle lead. Landscape
    # already matches the browser preview, so the same shift made 16:9 lyrics early.
    export_lyric_lead = MV_EXPORT_LYRIC_LEAD_SECONDS if height > width else 0.0
    visible_rows = ([row for row in rows if float(row.get("end", 0)) > 0 and float(row.get("time", 0)) < output_end]
                    if output_timeline else
                    [row for row in rows if float(row.get("end", 0)) > clip_start and float(row.get("time", 0)) < clip_end])
    if visible_rows:
        first_start = (max(0.0, float(visible_rows[0].get("time", 0))) if output_timeline else
                       max(0.0, float(visible_rows[0].get("time", 0)) - clip_start + intro_duration))
        # The opening labels must disappear at the compensated first lyric start,
        # otherwise both the labels and the first lyric overlap for one second.
        first_start = max(intro_duration, first_start - export_lyric_lead)
        label_start = intro_duration
        if first_start > label_start + .15:
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Original,,0,0,0,,Lời gốc")
            if mode == "music" and any(str(row.get("literal", "")).strip() for row in visible_rows):
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Literal,,0,0,0,,Nghĩa dịch sát")
            if mode == "music":
                events.append(f"Dialogue: 0,{ass_time(label_start)},{ass_time(first_start)},Vietnamese,,0,0,0,,Lời Việt")
    for row in visible_rows:
        start = (max(0.0, float(row.get("time", 0))) if output_timeline else
                 max(0.0, float(row.get("time", 0)) - clip_start + intro_duration))
        end = (min(output_end, float(row.get("end", 0))) if output_timeline else
               min(output_end, float(row.get("end", 0)) - clip_start + intro_duration))
        # On the Windows FFmpeg/libass path used by the local renderer, burned-in
        # subtitles appear about one second later than the matching browser preview.
        # Compensate only while writing the MP4 subtitle track; the saved timeline
        # and preview remain unchanged. Never let a lyric overlap the thumbnail intro.
        start = max(intro_duration, start - export_lyric_lead)
        end = max(start + .05, end - export_lyric_lead)
        if end <= start:
            continue
        original_text = ass_escape(row.get("original", ""))
        literal_text = ass_escape(row.get("literal", ""))
        vietnamese_text = ass_escape(row.get("vietnamese", ""))
        if mode == "music" and original_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Original,,0,0,0,,{original_text}")
        if mode == "music" and literal_text:
            events.append(f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Literal,,0,0,0,,{literal_text}")
        if vietnamese_text:
            if mode == "karaoke":
                sweep_cs = max(1, round((end - start) * 100))
                vietnamese_text = f"{{\\kf{sweep_cs}}}{vietnamese_text}"
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


def uvr_model_directory() -> Path:
    cache = Path(__file__).resolve().parent / "models"
    cache.mkdir(parents=True, exist_ok=True)
    cached_model = cache / UVR_INSTRUMENTAL_MODEL
    if cached_model.exists():
        return cache
    candidates = [
        Path.home() / "AppData" / "Local" / "Programs" / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
        Path.home() / "Ultimate Vocal Remover" / "models" / "MDX_Net_Models" / UVR_INSTRUMENTAL_MODEL,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.parent
    return cache


def separate_instrumental(source: Path, work: Path) -> tuple[Path, str]:
    """Prefer UVR's instrumental model; retain Demucs as an automatic fallback."""
    output_dir = work / "uvr-separated"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        from audio_separator.separator import Separator
        separator = Separator(
            log_level=logging.WARNING,
            model_file_dir=str(uvr_model_directory()),
            output_dir=str(output_dir),
            output_format="WAV",
            output_single_stem="Instrumental",
            mdx_params={"hop_length": 1024, "segment_size": 256, "overlap": 0.5, "batch_size": 1, "enable_denoise": True},
        )
        separator.load_model(model_filename=UVR_INSTRUMENTAL_MODEL)
        outputs = separator.separate(str(source))
        for output_name in outputs:
            candidate = Path(output_name)
            if not candidate.is_absolute():
                candidate = output_dir / candidate
            if candidate.exists() and candidate.suffix.casefold() == ".wav":
                return candidate, f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        candidates = sorted(output_dir.glob("*.wav"), key=lambda path: path.stat().st_mtime, reverse=True)
        if candidates:
            return candidates[0], f"Ultimate Vocal Remover · {UVR_INSTRUMENTAL_MODEL}"
        raise RuntimeError("UVR did not create an instrumental WAV")
    except Exception:
        logging.getLogger(__name__).warning(
            "UVR separation failed; using Demucs fallback.", exc_info=True
        )
        demucs_dir = work / "demucs-separated"
        command = [
            sys.executable, "-m", "demucs.separate", "-n", "htdemucs",
            "--two-stems", "vocals", "-o", str(demucs_dir), str(source),
        ]
        subprocess.run(command, check=True, timeout=60 * 60)
        beat = demucs_dir / "htdemucs" / source.stem / "no_vocals.wav"
        if not beat.exists():
            raise RuntimeError("Neither UVR nor Demucs created an instrumental stem")
        return beat, "Demucs fallback · htdemucs"


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
    line_words = [
        [normalize_word(raw) for raw in re.findall(r"[\wÀ-ỹĐđ]+", line, flags=re.UNICODE) if normalize_word(raw)]
        for line in lines
    ]
    recognized = [(normalize_word(item["word"]), float(item["start"])) for item in heard]
    recognized = [item for item in recognized if item[0]]
    if not any(line_words) or not recognized:
        step = max(duration, len(lines) * 4) / max(len(lines), 1)
        return [round(index * step, 3) for index in range(len(lines))]

    total_words = sum(max(len(words), 1) for words in line_words)
    consumed_words = 0
    previous_word = -1
    times = []
    for words in line_words:
        expected = round(consumed_words / max(total_words, 1) * (len(recognized) - 1))
        radius = max(14, round(len(recognized) / max(len(lines), 1) * 2.3))
        low = max(previous_word + 1, expected - radius)
        high = min(len(recognized) - 1, expected + radius)
        best_index = max(low, min(expected, high))
        best_score = float("-inf")
        for candidate in range(low, high + 1):
            window = [item[0] for item in recognized[candidate:candidate + max(len(words) + 3, 6)]]
            hits = sum(max((token_similarity(word, heard_word) for heard_word in window), default=0.0) for word in words)
            score = hits / max(len(words), 1) - abs(candidate - expected) / max(radius, 1) * .22
            lead = max((
                token_similarity(words[word_index], window[heard_index]) - .10 * heard_index - .04 * word_index
                for word_index in range(min(3, len(words)))
                for heard_index in range(min(4, len(window)))
            ), default=0.0)
            score += max(0.0, lead) * .48
            if score > best_score:
                best_score = score
                best_index = candidate
        # The whole-line score can land on a well-recognized word near the end of a
        # sung phrase. Walk back to the earliest plausible leading word so the lyric
        # appears when the singer starts the sentence, not several seconds later.
        leading_candidates = []
        for candidate in range(max(previous_word + 1, best_index - 6), min(len(recognized), best_index + 4)):
            leading_score = max((token_similarity(word, recognized[candidate][0]) for word in words[:3]), default=0.0)
            if leading_score >= .72:
                leading_candidates.append((leading_score, candidate))
        if leading_candidates:
            strongest = max(score for score, _ in leading_candidates)
            best_index = min(candidate for score, candidate in leading_candidates if score >= strongest - .02)
        segment_starts = [
            candidate for candidate in range(max(previous_word + 1, best_index - 4), min(len(heard), best_index + 5))
            if heard[candidate].get("segment_start")
        ]
        if segment_starts:
            best_index = min(segment_starts, key=lambda candidate: abs(candidate - best_index))
        times.append(recognized[best_index][1])
        previous_word = best_index
        consumed_words += max(len(words), 1)
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
            for word_index, word in enumerate(segment.words or []):
                heard.append({"word": word.word.strip(), "start": float(word.start), "end": float(word.end), "segment_start": word_index == 0})
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
    try:
        beat, separation_engine = separate_instrumental(source, work)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, RuntimeError) as error:
        shutil.rmtree(work, ignore_errors=True)
        raise HTTPException(500, f"UVR and Demucs separation failed: {error}") from error
    background_tasks.add_task(shutil.rmtree, work, True)
    return FileResponse(
        beat,
        media_type="audio/wav",
        filename=f"{source.stem}_instrumental.wav",
        headers={"X-Pulse-Separation-Engine": separation_engine},
    )


@app.post("/render-mv")
async def render_mv(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    images: list[UploadFile] = File(...),
    motion_clips: list[UploadFile] | None = File(None),
    thumbnail: UploadFile | None = File(None),
    rows_json: str = Form(...),
    styles_json: str = Form("{}"),
    positions_json: str = Form("{}"),
    mode: str = Form("music"),
    video_format: str = Form("landscape"),
    clip_start: float = Form(0.0),
    clip_end: float = Form(0.0),
    intro_duration: float = Form(0.0),
    timeline_space: str = Form("source"),
):
    """Render a finished MP4 locally. This never records the browser or waits for real-time playback."""
    if not images:
        raise HTTPException(400, "At least one artwork image is required")
    try:
        rows = json.loads(rows_json)
        styles = json.loads(styles_json)
        positions = json.loads(positions_json)
        if not isinstance(rows, list) or not isinstance(styles, dict) or not isinstance(positions, dict):
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
        image_scale = max(1.0, min(1.8, float(positions.get("imageScale", 100)) / 100.0))
        scaled_width = int(math.ceil(width * image_scale / 2.0) * 2)
        scaled_height = int(math.ceil(height * image_scale / 2.0) * 2)
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
                "-vf", f"scale={scaled_width}:{scaled_height}:force_original_aspect_ratio=increase,crop={width}:{height},setsar=1,format=yuv420p",
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
        write_ass_subtitles(subtitle_path, rows, styles, positions, mode, width, height, clip_start, clip_end, intro_duration, timeline_space)
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
