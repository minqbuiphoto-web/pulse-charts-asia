"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import "./audio-lab.css";

type ProgressState = { percent: number; title: string; detail: string };
type WorkerReply =
  | { type: "progress"; value: number; detail: string }
  | { type: "done"; channels: Float32Array[] }
  | { type: "cancelled" }
  | { type: "error"; message: string };

const presets = [
  { label: "MẶC ĐỊNH", speed: 1, pitch: 0 },
  { label: "5× / −24ST", speed: 5, pitch: -24 },
  { label: "GIỌNG TRẦM", speed: 1, pitch: -12 },
  { label: "NHANH 2×", speed: 2, pitch: 0 },
  { label: "CHẬM 0,75×", speed: .75, pitch: 0 },
];

export default function AudioLabPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const objectUrlRef = useRef("");
  const [file, setFile] = useState<File | null>(null);
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileDetails, setFileDetails] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; details: string } | null>(null);

  useEffect(() => () => {
    workerRef.current?.terminate();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  const chooseFile = (next?: File) => {
    setError("");
    setResult(null);
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = ""; }
    if (!next) return;
    if (next.size > 500 * 1024 * 1024) { setError("FILE VƯỢT 500 MB — HÃY CẮT NHỎ ĐỂ TRÁNH HẾT BỘ NHỚ."); return; }
    if (!(next.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(next.name))) { setError("ĐỊNH DẠNG NÀY KHÔNG ĐƯỢC NHẬN DIỆN LÀ AUDIO."); return; }
    setFile(next);
    setFileDetails(`${formatBytes(next.size)} · SẴN SÀNG GIẢI MÃ`);
  };

  const removeFile = () => {
    setFile(null);
    setResult(null);
    setError("");
    setFileDetails("");
    if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = ""; }
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  };

  const cancel = () => {
    workerRef.current?.postMessage({ type: "cancel" });
    setProgress({ percent: 0, title: "ĐANG HỦY…", detail: "Hoàn tất khung hiện tại trước khi dừng" });
  };

  const processAudio = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setProgress({ percent: 1, title: "ĐANG GIẢI MÃ…", detail: "Đọc audio trực tiếp trên thiết bị" });
    let context: AudioContext | null = null;
    try {
      context = new AudioContext();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      if (buffer.numberOfChannels > 8) throw new Error("CHỈ HỖ TRỢ TỐI ĐA 8 KÊNH AUDIO.");
      const targetFrames = Math.ceil(buffer.length / speed);
      const pitchRatio = Math.pow(2, pitch / 12);
      const stretchedFrames = Math.ceil(buffer.length / (speed / pitchRatio));
      const estimatedBytes = buffer.length * buffer.numberOfChannels * 8 + stretchedFrames * (buffer.numberOfChannels + 1) * 4 + targetFrames * buffer.numberOfChannels * 8 + 64 * 1024 ** 2;
      if (estimatedBytes > 1.2 * 1024 ** 3) throw new Error("TÁC VỤ CÓ THỂ CẦN HƠN 1,2 GB RAM — HÃY DÙNG FILE NGẮN HƠN HOẶC TĂNG TỐC ĐỘ.");
      if (44 + targetFrames * buffer.numberOfChannels * 2 > 0xffffffff) throw new Error("WAV KẾT QUẢ SẼ VƯỢT GIỚI HẠN 4 GB.");
      setFileDetails(`${formatBytes(file.size)} · ${formatTime(buffer.duration)} · ${buffer.sampleRate.toLocaleString("en-US")} HZ · ${buffer.numberOfChannels} KÊNH`);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice());
      setProgress({ percent: 5, title: "ĐANG BIẾN ĐỔI…", detail: "Tách tốc độ và cao độ trong luồng nền" });
      const output = await runWorker(channels, buffer.sampleRate, speed, pitch, workerRef, setProgress);
      setProgress({ percent: 92, title: "ĐANG ĐÓNG GÓI WAV…", detail: "Mã hóa PCM 16-bit" });
      const blob = encodeWav(output, buffer.sampleRate);
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const base = file.name.replace(/\.[^.]+$/, "");
      const name = `${base}_x${tag(speed)}_${pitch >= 0 ? "+" : ""}${tag(pitch)}st.wav`;
      setResult({ url, name, details: `${formatTime(output[0].length / buffer.sampleRate)} · ${formatBytes(blob.size)} · WAV 16-BIT` });
      setProgress({ percent: 100, title: "HOÀN TẤT", detail: "Nghe thử hoặc tải kết quả bên dưới" });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "ĐÃ CÓ LỖI XẢY RA.";
      setProgress(null);
      setError(message === "CANCELLED" ? "ĐÃ HỦY XỬ LÝ — FILE GỐC KHÔNG THAY ĐỔI." : friendlyError(message));
    } finally {
      await context?.close().catch(() => undefined);
      workerRef.current?.terminate();
      workerRef.current = null;
      setBusy(false);
    }
  };

  return <main className="audio-lab-page">
    <header className="audio-hero">
      <div>
        <p className="audio-kicker"><span>05</span> PULSE AUDIO TOOLKIT</p>
        <h1>Shape the sound.<br/><em>Keep it local.</em></h1>
        <p>Đổi tốc độ và cao độ độc lập ngay trong trình duyệt. Không upload, không tài khoản, không phí dịch vụ.</p>
      </div>
      <div className="audio-signal" aria-hidden="true"><span className="signal-orbit"/><span className="signal-core">PULSE<br/><b>LAB</b></span><div>{Array.from({ length: 28 }, (_, index) => <i key={index}/>)}</div></div>
      <div className="local-badge"><i/> PRIVATE MODE <span>100% ON-DEVICE</span></div>
    </header>

    <section className="audio-tool" aria-label="Biến đổi audio">
      <div className="audio-step-heading"><span>01</span><div><small>INPUT</small><h2>Chọn file audio</h2><p>MP3, WAV, M4A, OGG, FLAC… tùy codec trình duyệt.</p></div></div>
      <div className={`audio-drop ${dragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
        <input ref={inputRef} type="file" hidden accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event: ChangeEvent<HTMLInputElement>) => chooseFile(event.target.files?.[0])}/>
        {file ? <div className="selected-audio"><span>♫</span><div><b>{file.name}</b><small>{fileDetails}</small></div><button type="button" aria-label="Bỏ file đã chọn" onClick={removeFile}>×</button></div> : <button className="audio-picker" type="button" onClick={() => inputRef.current?.click()}><span className="drop-arrow">↑</span><b>THẢ FILE VÀO ĐÂY</b><small>HOẶC BẤM ĐỂ CHỌN TỪ MÁY</small></button>}
      </div>

      <div className="audio-divider"/>
      <div className="audio-step-heading"><span>02</span><div><small>TRANSFORM</small><h2>Tinh chỉnh tín hiệu</h2><p>Tốc độ và cao độ hoạt động độc lập.</p></div></div>
      <div className="audio-controls">
        <label className="audio-control"><span><b>TỐC ĐỘ</b><small>0,25× — 8×</small></span><output>{tag(speed)}×</output><input type="range" min="0.25" max="8" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}/><span className="range-copy"><i>CHẬM</i><i>GỐC</i><i>NHANH</i></span></label>
        <label className="audio-control"><span><b>CAO ĐỘ</b><small>−24 — +24 NỬA CUNG</small></span><output>{pitch > 0 ? "+" : ""}{pitch} ST</output><input type="range" min="-24" max="24" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))}/><span className="range-copy"><i>TRẦM</i><i>GỐC</i><i>CAO</i></span></label>
      </div>
      <div className="audio-presets"><span>QUICK SET</span>{presets.map((preset) => <button type="button" key={preset.label} className={speed === preset.speed && pitch === preset.pitch ? "active" : ""} onClick={() => { setSpeed(preset.speed); setPitch(preset.pitch); }}>{preset.label}</button>)}</div>
      {file ? <p className="audio-estimate">KẾT QUẢ DỰ KIẾN DÀI {formatRatio(1 / speed)} LẦN BẢN GỐC · FILE CHỈ ĐƯỢC XỬ LÝ TRÊN THIẾT BỊ NÀY</p> : null}
      {error ? <div className="audio-error" role="alert">{error}</div> : null}
      <div className="audio-actions"><button className="audio-run" type="button" disabled={!file || busy} onClick={processAudio}>{busy ? "ĐANG XỬ LÝ…" : "BIẾN ĐỔI AUDIO"}<span>↗</span></button>{busy ? <button className="audio-cancel" type="button" onClick={cancel}>HỦY</button> : null}</div>
      {progress ? <div className="audio-progress" aria-live="polite"><div><b>{progress.title}</b><span>{progress.percent}%</span></div><i><span style={{ width: `${progress.percent}%` }}/></i><small>{progress.detail}</small></div> : null}
      {result ? <section className="audio-result" aria-live="polite"><header><span>✓</span><div><b>AUDIO ĐÃ SẴN SÀNG</b><small>{result.details}</small></div></header><audio controls preload="metadata" src={result.url}/><a href={result.url} download={result.name}>TẢI FILE WAV <span>↓</span></a></section> : null}
    </section>

    <section className="audio-facts"><article><span>01</span><b>NO UPLOAD</b><p>Audio không rời khỏi máy bạn.</p></article><article><span>02</span><b>STEREO SAFE</b><p>Các kênh dùng chung mốc ghép.</p></article><article><span>03</span><b>BACKGROUND DSP</b><p>Web Worker giữ giao diện phản hồi.</p></article><article><span>04</span><b>WAV OUTPUT</b><p>PCM 16-bit, giữ sample rate.</p></article></section>
    <footer className="audio-footer"><b>PULSE CHARTS / AUDIO LAB</b><span>WSOLA TIME-STRETCH + CUBIC RESAMPLE</span></footer>
  </main>;
}

function runWorker(channels: Float32Array[], sampleRate: number, speed: number, semitones: number, workerRef: React.MutableRefObject<Worker | null>, setProgress: React.Dispatch<React.SetStateAction<ProgressState | null>>) {
  return new Promise<Float32Array[]>((resolve, reject) => {
    const worker = new Worker("/pulse-audio-worker.js");
    workerRef.current = worker;
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (data.type === "progress") setProgress({ percent: Math.round(data.value * 100), title: "ĐANG BIẾN ĐỔI…", detail: data.detail });
      if (data.type === "done") resolve(data.channels);
      if (data.type === "cancelled") reject(new Error("CANCELLED"));
      if (data.type === "error") reject(new Error(data.message || "LUỒNG XỬ LÝ GẶP LỖI."));
    };
    worker.onerror = () => reject(new Error("KHÔNG KHỞI ĐỘNG ĐƯỢC LUỒNG XỬ LÝ AUDIO."));
    worker.postMessage({ type: "process", channels, sampleRate, speed, semitones }, channels.map((channel) => channel.buffer));
  });
}

function encodeWav(channels: Float32Array[], sampleRate: number) {
  const frames = channels[0].length, channelCount = channels.length, blockAlign = channelCount * 2;
  const buffer = new ArrayBuffer(44 + frames * blockAlign), view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, "RIFF"); view.setUint32(4, 36 + frames * blockAlign, true); write(8, "WAVE"); write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, frames * blockAlign, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channelCount; channel++) { const sample = Math.max(-1, Math.min(1, channels[channel][frame] || 0)); view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2; }
  return new Blob([buffer], { type: "audio/wav" });
}

function friendlyError(message: string) { return /decode|encoding/i.test(message) ? "KHÔNG GIẢI MÃ ĐƯỢC CODEC NÀY — HÃY THỬ WAV HOẶC MP3." : message; }
function formatBytes(value: number) { const units = ["B", "KB", "MB", "GB"]; let unit = 0; while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; } return `${value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })} ${units[unit]}`; }
function formatTime(value: number) { const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), seconds = Math.floor(value % 60); return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`; }
function tag(value: number) { return String(Math.round(value * 100) / 100).replace(".", ","); }
function formatRatio(value: number) { return value.toLocaleString("vi-VN", { maximumFractionDigits: 2 }); }
