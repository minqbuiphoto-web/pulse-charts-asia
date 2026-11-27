"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";


import MixEnhancer from "./mix-enhancer";
type AudioResult = { url: string; name: string; details: string };

const LOCAL_ENGINE = "http://127.0.0.1:8765";
const AUDIO_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

export default function AudioProTools() {
  return <section className="audio-pro-suite" aria-label="Tách giọng, lấy beat và remaster audio">
    <BeatExtractor/>
    <MixEnhancer/>
  </section>;
}

function BeatExtractor() {
  const [file, setFile] = useState<File | null>(null);

  const [guide, setGuide] = useState(false);
  const [start, setStart] = useState("0");
  const [strength, setStrength] = useState(55);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Chưa chọn bản nhạc.");
  const [result, setResult] = useState<AudioResult | null>(null);
  const resultUrl = useRef("");

  useEffect(() => () => { if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);

  const choose = (next?: File) => {
    clearResult(resultUrl, setResult);
    setFile(null);
    if (!next) return;
    if (!isAudio(next)) { setStatus("Định dạng này chưa được nhận diện là audio."); return; }
    if (next.size > 500 * 1024 * 1024) { setStatus("File vượt 500 MB. Hãy dùng WAV/MP3 ngắn hơn."); return; }
    setFile(next);
    setStatus(`${formatBytes(next.size)} · Sẵn sàng tách beat`);
  };

  const run = async (preview = false) => {
    if (!file || busy) return;
    if (guide && (!start.trim() || !Number.isFinite(Number(start)) || Number(start) < 0 || Number(start) > 86400)) {
      setStatus("Hãy nhập mốc bắt đầu hợp lệ bằng giây."); return;
    }
    setBusy(true);
    clearResult(resultUrl, setResult);
    try {
      setStatus(guide ? "Đang dò giai điệu và giảm nhạc cụ dẫn…" : "Đang tách nhạc nền, kiểm tra phần còn giọng và cân mức xuất WAV…");
      const { blob, engine: source } = await separateWithLocalAI(file, guide ? { start, strength, preview } : undefined);
      const url = URL.createObjectURL(blob);
      resultUrl.current = url;
      const name = `${baseName(file.name)}_${guide ? (preview ? "nghe_thu" : "giam_nhac_cu_dan") : "instrumental_beat"}.wav`;
      setResult({ url, name, details: `${source} · ${formatBytes(blob.size)} · WAV` });
      setStatus(preview ? "Đã tạo đoạn nghe thử. Bạn có thể chỉnh mức giảm hoặc tạo beat toàn bài." : "Beat đã sẵn sàng. Hãy nghe kiểm tra trước khi tải.");
    } catch (error) {
      setStatus(error instanceof Error ? friendlyAudioError(error.message) : "Không thể tách beat từ file này.");
    } finally { setBusy(false); }
  };

  return <article className="audio-pro-card beat-card">
    <header><span>03</span><div><small>BEAT EXTRACTOR</small><h2>Tạo beat karaoke</h2><p>{guide ? "Giảm tiếng nhạc cụ đánh theo giai điệu lời hát và xuất WAV stereo 24-bit." : "Tách giọng, giữ nhạc nền và xuất WAV stereo 24-bit."}</p></div></header>
    <div className="audio-mode-tabs" aria-label="Loại bản thu">{[false, true].map(mode => <button key={String(mode)} type="button" disabled={busy} aria-pressed={guide === mode} className={guide === mode ? "active" : ""} onClick={() => {
      if (guide === mode) return;
      setGuide(mode); clearResult(resultUrl, setResult); setStatus(file ? "Đã chọn bản nhạc." : "Chưa chọn bản nhạc.");
    }}>{mode ? "Beat có nhạc cụ dẫn" : "Bài có giọng hát"}</button>)}</div>
    <label className="pro-upload">{guide ? "BEAT CÓ NHẠC CỤ ĐÁNH THAY LỜI" : "NHẠC CÓ GIỌNG HÁT"}<input disabled={busy} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])}/><b>{file?.name ?? "Chọn WAV / MP3 / M4A"}</b><span>{file ? formatBytes(file.size) : "Audio không được tải lên máy chủ"}</span></label>
    {guide && <fieldset className="guide-settings" disabled={busy}>
      <label>Giảm từ giây<input type="number" min="0" max="86400" step="0.1" value={start} onChange={e => { setStart(e.target.value); clearResult(resultUrl, setResult); }}/></label>
      <label>Mức giảm · {strength}%<input type="range" min="0" max="100" value={strength} onChange={e => { setStrength(Number(e.target.value)); clearResult(resultUrl, setResult); }}/></label>
      <small>Nếu phần đệm bị mỏng, hãy hạ mức giảm.</small>
      <button type="button" disabled={!file || busy} onClick={() => void run(true)}>Nghe thử 12 giây</button>
    </fieldset>}
    <details className="ai-local-box"><summary>Bộ xử lý trên máy</summary><p>Với bài có giọng hát, hãy cập nhật Pulse Audio AI để dùng HyperACE v2 Inst. Lần đầu bộ xử lý sẽ tải mô hình về máy.</p><a href="/update-pulse-audio-ai.cmd" download>Cập nhật bộ xử lý</a> · <a href="/install-pulse-audio-ai.cmd" download>Cài lần đầu</a> · <a href="/pulse-audio-ai-server.py" download>Tải tệp engine cho bộ cài</a></details>
    <button className="pro-run" disabled={!file || busy} onClick={() => void run()}>{busy ? "ĐANG XỬ LÝ…" : guide ? "TẠO BEAT GIẢM NHẠC CỤ DẪN" : "TẠO BEAT KARAOKE"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result ? <div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI FILE BEAT WAV ↓</a></div> : null}
  </article>;
}

async function separateWithLocalAI(file:File, guide?: { start: string; strength: number; preview: boolean }) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (guide) {
    form.append("start", guide.start);
    form.append("strength", String(guide.strength));
    form.append("preview", String(guide.preview));
  }
  const response = await fetch(LOCAL_ENGINE + (guide ? "/audio-lab/guide-beat" : "/audio-lab/karaoke-beat"), { method:"POST", body:form })
    .catch(() => { throw new Error("Chưa kết nối được bộ xử lý. Hãy mở Pulse Audio AI trên máy."); });
  if (response.status === 404) throw new Error("Hãy cập nhật bộ xử lý để tạo beat karaoke.");
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Bộ xử lý chưa tạo được beat.");
  return { blob:await response.blob(), engine:response.headers.get("X-Pulse-Separation-Engine") || (guide ? (guide.preview ? "Bản nghe thử" : "Giảm nhạc cụ dẫn") : "Karaoke AI") };
}

function isAudio(file:File){return file.type.startsWith("audio/")||AUDIO_PATTERN.test(file.name);}
function clearResult(ref:React.MutableRefObject<string>,setResult:React.Dispatch<React.SetStateAction<AudioResult|null>>){if(ref.current)URL.revokeObjectURL(ref.current);ref.current="";setResult(null);}
function friendlyAudioError(message:string){return /decode|encoding/i.test(message)?"Không giải mã được codec này. Hãy thử WAV hoặc MP3.":message;}
function baseName(name:string){return name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-").trim()||"pulse-audio";}
function formatBytes(value:number){const units=["B","KB","MB","GB"];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${value.toLocaleString("vi-VN",{maximumFractionDigits:2})} ${units[unit]}`;}
