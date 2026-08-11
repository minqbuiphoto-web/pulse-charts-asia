"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type BeatMode = "ai" | "quick";
type AudioResult = { url: string; name: string; details: string };
type ArrangementClip = { id: string; file: File };

const LOCAL_ENGINE = "http://127.0.0.1:8765";
const AUDIO_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

export default function AudioProTools() {
  return <section className="audio-pro-suite" aria-label="Tách beat và nối nhạc">
    <BeatExtractor/>
    <ArrangementBuilder/>
  </section>;
}

function BeatExtractor() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<BeatMode>("ai");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Chưa chọn bản nhạc.");
  const [result, setResult] = useState<AudioResult | null>(null);
  const resultUrl = useRef("");

  useEffect(() => () => { if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);

  const choose = (next?: File) => {
    clearResult(resultUrl, setResult);
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
      let blob: Blob;
      let source: string;
      if (mode === "ai") {
        setStatus("Đang kết nối Demucs AI trên máy…");
        try {
          blob = await separateWithLocalAI(file);
          source = "DEMUCS AI · 2-STEM VOCALS";
        } catch {
          setStatus("AI local chưa chạy — đang tự chuyển sang Beat Draft trên thiết bị…");
          blob = await createQuickBeat(file);
          source = "BEAT DRAFT · CENTER VOCAL REDUCTION";
        }
      } else {
        setStatus("Đang giảm vocal và giữ lại phần beat…");
        blob = await createQuickBeat(file);
        source = "BEAT DRAFT · CENTER VOCAL REDUCTION";
      }
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
    <header><span>03</span><div><small>BEAT EXTRACTOR</small><h2>Tách giọng, lấy beat</h2><p>AI stem cho chất lượng cao; Beat Draft là phương án miễn phí chạy ngay trong trình duyệt.</p></div><b>FREE-FIRST</b></header>
    <div className="audio-mode-tabs" role="group" aria-label="Chọn chất lượng tách beat">
      <button className={mode === "ai" ? "active" : ""} onClick={() => setMode("ai")}><b>AI STUDIO</b><small>Demucs local · tốt nhất</small></button>
      <button className={mode === "quick" ? "active" : ""} onClick={() => setMode("quick")}><b>BEAT DRAFT</b><small>Chạy ngay · không cài đặt</small></button>
    </div>
    <label className="pro-upload">NHẠC CÓ GIỌNG HÁT<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])}/><b>{file?.name ?? "Chọn WAV / MP3 / M4A"}</b><span>{file ? formatBytes(file.size) : "Audio không được tải lên máy chủ"}</span></label>
    {mode === "ai" ? <div className="ai-local-box"><div><i/> <b>AI LOCAL ENGINE</b><span>Nếu chưa kết nối, hệ thống tự dùng Beat Draft.</span></div><details><summary>CÀI DEMUCS MIỄN PHÍ</summary><p>Tải hai file dưới đây vào cùng một thư mục, rồi chạy file cài đặt một lần. Model AI chạy trên máy và không gửi bài hát lên mạng.</p><div><a href="/install-pulse-audio-ai.cmd" download>CÀI AI LOCAL .CMD</a><a href="/pulse-audio-ai-server.py" download>ENGINE .PY</a></div></details></div> : <p className="quality-note">Beat Draft giảm âm thanh nằm giữa stereo và giữ lại bass trung tâm. Vocal có reverb hoặc lệch kênh có thể vẫn còn.</p>}
    <button className="pro-run" disabled={!file || busy} onClick={run}>{busy ? "ĐANG TÁCH BEAT…" : "TÁCH GIỌNG & XUẤT BEAT"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result ? <div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI FILE BEAT WAV ↓</a></div> : null}
  </article>;
}

function ArrangementBuilder() {
  const [clips, setClips] = useState<ArrangementClip[]>([]);
  const [crossfade, setCrossfade] = useState(.8);
  const [normalize, setNormalize] = useState(true);
  const [repair, setRepair] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Chọn một file đã ghép hoặc nhiều đoạn nhạc.");
  const [result, setResult] = useState<AudioResult | null>(null);
  const resultUrl = useRef("");

  useEffect(() => () => { if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = [...list].filter(isAudio);
    if (!accepted.length) { setStatus("Không tìm thấy file audio hợp lệ."); return; }
    clearResult(resultUrl, setResult);
    setClips(current => [...current, ...accepted.map(file => ({ id: crypto.randomUUID(), file }))]);
    setStatus(`Đã nhận ${accepted.length} đoạn. Bạn có thể đổi thứ tự trước khi phối.`);
  };

  const move = (index:number, step:number) => setClips(current => {
    const target = index + step;
    if (target < 0 || target >= current.length) return current;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });

  const remove = (id:string) => setClips(current => current.filter(clip => clip.id !== id));

  const run = async () => {
    if (!clips.length || busy) return;
    setBusy(true);
    clearResult(resultUrl, setResult);
    setStatus(clips.length === 1 ? "Đang rà điểm nối, cân âm lượng và chống tiếng tách…" : "Đang giải mã, crossfade và master các đoạn…");
    try {
      const blob = await assembleAudio(clips.map(clip => clip.file), crossfade, normalize, repair);
      const url = URL.createObjectURL(blob);
      resultUrl.current = url;
      const name = `${baseName(clips[0].file.name)}_${clips.length === 1 ? "repaired" : "arrangement_master"}.wav`;
      setResult({ url, name, details: `${clips.length} ĐOẠN · CROSSFADE ${tag(crossfade)}S · ${normalize ? "NORMALIZED −1 DB" : "GIỮ ÂM LƯỢNG"} · WAV` });
      setStatus("Bản phối đã hoàn thành. Hãy nghe toàn bộ các điểm nối trước khi tải.");
    } catch (error) {
      setStatus(error instanceof Error ? friendlyAudioError(error.message) : "Không thể hoàn thiện bản phối này.");
    } finally { setBusy(false); }
  };

  return <article className="audio-pro-card arrangement-card">
    <header><span>04</span><div><small>ARRANGEMENT BUILDER</small><h2>Nối đoạn thành bài hoàn chỉnh</h2><p>Làm mượt điểm nối, cân mức âm và xuất một file master liền mạch.</p></div><b>ON-DEVICE</b></header>
    <label className="pro-upload multi">FILE ĐÃ GHÉP HOẶC CÁC ĐOẠN NHẠC<input type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}/><b>Thêm một hoặc nhiều đoạn</b><span>Thứ tự có thể chỉnh sau khi chọn</span></label>
    {clips.length ? <div className="clip-list">{clips.map((clip,index) => <div key={clip.id}><i>{String(index+1).padStart(2,"0")}</i><p><b>{clip.file.name}</b><small>{formatBytes(clip.file.size)}</small></p><button disabled={index===0} onClick={() => move(index,-1)} aria-label={`Đưa ${clip.file.name} lên`}>↑</button><button disabled={index===clips.length-1} onClick={() => move(index,1)} aria-label={`Đưa ${clip.file.name} xuống`}>↓</button><button onClick={() => remove(clip.id)} aria-label={`Xóa ${clip.file.name}`}>×</button></div>)}</div> : null}
    <div className="arrangement-options">
      <label><span><b>CROSSFADE</b><small>0–5 giây giữa các đoạn</small></span><output>{tag(crossfade)}S</output><input type="range" min="0" max="5" step="0.1" value={crossfade} onChange={event => setCrossfade(Number(event.target.value))}/></label>
      <label className="option-check"><input type="checkbox" checked={normalize} onChange={event => setNormalize(event.target.checked)}/><span><b>CÂN ÂM LƯỢNG −1 DB</b><small>Giữ các đoạn đồng đều, tránh vỡ tiếng.</small></span></label>
      <label className="option-check"><input type="checkbox" checked={repair} onChange={event => setRepair(event.target.checked)}/><span><b>LÀM MƯỢT MỐI GHÉP</b><small>Khử click ở file đã ghép và mép đoạn.</small></span></label>
    </div>
    <button className="pro-run" disabled={!clips.length || busy} onClick={run}>{busy ? "ĐANG HOÀN THIỆN BẢN PHỐI…" : "PHỐI & XUẤT FILE HOÀN CHỈNH"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result ? <div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI ARRANGEMENT WAV ↓</a></div> : null}
  </article>;
}

async function separateWithLocalAI(file:File) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20 * 60 * 1000);
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const response = await fetch(`${LOCAL_ENGINE}/separate`, { method:"POST", body:form, signal:controller.signal });
    if (!response.ok) throw new Error("AI local chưa sẵn sàng.");
    return await response.blob();
  } finally { window.clearTimeout(timer); }
}

async function createQuickBeat(file:File) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (buffer.numberOfChannels < 2) throw new Error("Beat Draft cần file stereo. Hãy dùng AI Studio cho file mono.");
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    const outLeft = new Float32Array(buffer.length), outRight = new Float32Array(buffer.length);
    const alpha = 1 - Math.exp(-2 * Math.PI * 180 / buffer.sampleRate);
    let low = 0;
    for (let index=0; index<buffer.length; index++) {
      const mid = (left[index] + right[index]) * .5;
      const side = (left[index] - right[index]) * .5;
      low += alpha * (mid - low);
      outLeft[index] = clamp(side * 1.35 + low * .9);
      outRight[index] = clamp(-side * 1.35 + low * .9);
    }
    normalizeChannels([outLeft,outRight], .891);
    return encodeWav([outLeft,outRight],buffer.sampleRate);
  } finally { await context.close().catch(() => undefined); }
}

async function assembleAudio(files:File[], crossfade:number, normalize:boolean, repair:boolean) {
  const decoder = new AudioContext();
  try {
    const buffers:AudioBuffer[] = [];
    for (const file of files) buffers.push(await decoder.decodeAudioData(await file.arrayBuffer()));
    const sampleRate = Math.max(...buffers.map(buffer => buffer.sampleRate));
    const safeFade = Math.max(0, Math.min(crossfade, ...buffers.map(buffer => Math.max(0,buffer.duration/3))));
    const totalDuration = buffers.reduce((total,buffer) => total + buffer.duration,0) - safeFade * Math.max(0,buffers.length-1);
    if (totalDuration <= 0 || totalDuration > 4 * 60 * 60) throw new Error("Bản phối phải ngắn hơn 4 giờ.");
    const offline = new OfflineAudioContext(2,Math.ceil(totalDuration*sampleRate),sampleRate);
    const compressor = offline.createDynamicsCompressor();
    compressor.threshold.value=-8; compressor.knee.value=6; compressor.ratio.value=2; compressor.attack.value=.004; compressor.release.value=.16;
    compressor.connect(offline.destination);
    let cursor=0;
    buffers.forEach((buffer,index) => {
      const source=offline.createBufferSource(), gain=offline.createGain();
      source.buffer=buffer; source.connect(gain).connect(compressor);
      if(index>0&&safeFade>0){gain.gain.setValueAtTime(0,cursor);gain.gain.linearRampToValueAtTime(1,cursor+safeFade);}
      else gain.gain.setValueAtTime(1,cursor);
      const end=cursor+buffer.duration;
      if(index<buffers.length-1&&safeFade>0){gain.gain.setValueAtTime(1,Math.max(cursor,end-safeFade));gain.gain.linearRampToValueAtTime(0,end);}
      source.start(cursor);
      cursor += buffer.duration-safeFade;
    });
    const rendered=await offline.startRendering();
    const channels=Array.from({length:Math.min(2,rendered.numberOfChannels)},(_,index)=>rendered.getChannelData(index).slice());
    if(repair)channels.forEach(channel=>repairClicks(channel,rendered.sampleRate));
    if(normalize)normalizeChannels(channels,.891);
    return encodeWav(channels,rendered.sampleRate);
  } finally { await decoder.close().catch(()=>undefined); }
}

function repairClicks(channel:Float32Array,sampleRate:number) {
  const radius=Math.max(12,Math.round(sampleRate*.0025));
  for(let index=radius;index<channel.length-radius;index++){
    if(Math.abs(channel[index]-channel[index-1])<.72)continue;
    const start=index-radius,end=index+radius,left=channel[start],right=channel[end];
    for(let point=start+1;point<end;point++)channel[point]=left+(right-left)*(point-start)/(end-start);
    index=end;
  }
}

function normalizeChannels(channels:Float32Array[],target:number){let peak=0;for(const channel of channels)for(let index=0;index<channel.length;index++)peak=Math.max(peak,Math.abs(channel[index]));if(peak<1e-7)return;const gain=Math.min(8,target/peak);for(const channel of channels)for(let index=0;index<channel.length;index++)channel[index]=clamp(channel[index]*gain);}
function encodeWav(channels:Float32Array[],sampleRate:number){const frames=channels[0].length,count=channels.length,align=count*2,buffer=new ArrayBuffer(44+frames*align),view=new DataView(buffer),write=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};write(0,"RIFF");view.setUint32(4,36+frames*align,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*align,true);view.setUint16(32,align,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,frames*align,true);let offset=44;for(let frame=0;frame<frames;frame++)for(let channel=0;channel<count;channel++){const sample=clamp(channels[channel][frame]||0);view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;}return new Blob([buffer],{type:"audio/wav"});}
function isAudio(file:File){return file.type.startsWith("audio/")||AUDIO_PATTERN.test(file.name);}
function clearResult(ref:React.MutableRefObject<string>,setResult:React.Dispatch<React.SetStateAction<AudioResult|null>>){if(ref.current)URL.revokeObjectURL(ref.current);ref.current="";setResult(null);}
function friendlyAudioError(message:string){return /decode|encoding/i.test(message)?"Không giải mã được codec này. Hãy thử WAV hoặc MP3.":message;}
function baseName(name:string){return name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-").trim()||"pulse-audio";}
function formatBytes(value:number){const units=["B","KB","MB","GB"];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${value.toLocaleString("vi-VN",{maximumFractionDigits:2})} ${units[unit]}`;}
function tag(value:number){return String(Math.round(value*10)/10).replace(".",",");}
function clamp(value:number){return Math.max(-1,Math.min(1,value));}
