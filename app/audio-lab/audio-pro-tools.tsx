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

  const run = async () => {
    if (!file || busy) return;
    setBusy(true);
    clearResult(resultUrl, setResult);
    try {
      setStatus("Đang tách nhạc nền, kiểm tra phần còn giọng và cân mức xuất WAV…");
      const { blob, engine: source } = await separateWithLocalAI(file);
      const url = URL.createObjectURL(blob);
      resultUrl.current = url;
      const name = `${baseName(file.name)}_instrumental_beat.wav`;
      setResult({ url, name, details: `${source} · ${formatBytes(blob.size)} · WAV` });
      setStatus("Beat đã sẵn sàng. Hãy nghe kiểm tra trước khi tải.");
    } catch (error) {
      setStatus(error instanceof Error ? friendlyAudioError(error.message) : "Không thể tách beat từ file này.");
    } finally { setBusy(false); }
  };

  return <article className="audio-pro-card beat-card">
    <header><span>03</span><div><small>BEAT EXTRACTOR</small><h2>Tạo beat karaoke</h2><p>Tách giọng, giữ nhạc nền và xuất WAV stereo 24-bit.</p></div></header>
    <label className="pro-upload">NHẠC CÓ GIỌNG HÁT<input disabled={busy} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])}/><b>{file?.name ?? "Chọn WAV / MP3 / M4A"}</b><span>{file ? formatBytes(file.size) : "Audio không được tải lên máy chủ"}</span></label>
    <details className="ai-local-box"><summary>Bộ xử lý trên máy</summary><p>Lần đầu cần tải model. Nếu đã cài Pulse Audio AI, hãy cập nhật để dùng chức năng karaoke.</p><a href="/update-pulse-audio-ai.cmd" download>Cập nhật bộ xử lý</a> · <a href="/install-pulse-audio-ai.cmd" download>Cài lần đầu</a> · <a href="/pulse-audio-ai-server.py" download>Tải tệp engine cho bộ cài</a></details>
    <button className="pro-run" disabled={!file || busy} onClick={run}>{busy ? "ĐANG TÁCH BEAT…" : "TẠO BEAT KARAOKE"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result ? <div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI FILE BEAT WAV ↓</a></div> : null}
  </article>;
}

async function separateWithLocalAI(file:File) {
  const form = new FormData();
  form.append("file", file, file.name);
  const response = await fetch(LOCAL_ENGINE + "/audio-lab/karaoke-beat", { method:"POST", body:form })
    .catch(() => { throw new Error("Chưa kết nối được bộ xử lý. Hãy mở Pulse Audio AI trên máy."); });
  if (response.status === 404) throw new Error("Hãy cập nhật bộ xử lý để tạo beat karaoke.");
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Bộ xử lý chưa tạo được beat.");
  return { blob:await response.blob(), engine:response.headers.get("X-Pulse-Separation-Engine") || "Karaoke AI" };
}

function isAudio(file:File){return file.type.startsWith("audio/")||AUDIO_PATTERN.test(file.name);}
function clearResult(ref:React.MutableRefObject<string>,setResult:React.Dispatch<React.SetStateAction<AudioResult|null>>){if(ref.current)URL.revokeObjectURL(ref.current);ref.current="";setResult(null);}
function friendlyAudioError(message:string){return /decode|encoding/i.test(message)?"Không giải mã được codec này. Hãy thử WAV hoặc MP3.":message;}
function baseName(name:string){return name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-").trim()||"pulse-audio";}
function formatBytes(value:number){const units=["B","KB","MB","GB"];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${value.toLocaleString("vi-VN",{maximumFractionDigits:2})} ${units[unit]}`;}
