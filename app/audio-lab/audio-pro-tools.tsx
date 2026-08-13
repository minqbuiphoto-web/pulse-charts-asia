"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type BeatMode = "ai" | "quick";
type MasterPreset = "balanced" | "warm" | "clear" | "loud";
type AudioResult = { url: string; name: string; details: string };
type ArrangementClip = { id: string; file: File };
type AudioMetrics = { peakDb: number; rmsDb: number };

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
        setStatus("Đang chạy Ultimate Vocal Remover · Inst HQ 3 trên máy…");
        try {
          const separated = await separateWithLocalAI(file);
          blob = separated.blob;
          source = separated.engine.toUpperCase();
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
      <button className={mode === "ai" ? "active" : ""} onClick={() => setMode("ai")}><b>AI STUDIO</b><small>UVR Inst HQ 3 · chất lượng cao</small></button>
      <button className={mode === "quick" ? "active" : ""} onClick={() => setMode("quick")}><b>BEAT DRAFT</b><small>Chạy ngay · không cài đặt</small></button>
    </div>
    <label className="pro-upload">NHẠC CÓ GIỌNG HÁT<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => choose(event.target.files?.[0])}/><b>{file?.name ?? "Chọn WAV / MP3 / M4A"}</b><span>{file ? formatBytes(file.size) : "Audio không được tải lên máy chủ"}</span></label>
    {mode === "ai" ? <div className="ai-local-box"><div><i/> <b>AI LOCAL ENGINE</b><span>Ưu tiên UVR Inst HQ 3; nếu UVR lỗi, hệ thống tự chuyển sang Demucs.</span></div><details><summary>CÀI ULTIMATE VOCAL REMOVER MIỄN PHÍ</summary><p>Tải hai file dưới đây vào cùng một thư mục, rồi chạy file cài đặt một lần. Model AI chạy trên máy và không gửi bài hát lên mạng.</p><div><a href="/install-pulse-audio-ai.cmd" download>CÀI AI LOCAL .CMD</a><a href="/pulse-audio-ai-server.py" download>ENGINE .PY</a></div></details></div> : <p className="quality-note">Beat Draft giảm âm thanh nằm giữa stereo và giữ lại bass trung tâm. Vocal có reverb hoặc lệch kênh có thể vẫn còn.</p>}
    <button className="pro-run" disabled={!file || busy} onClick={run}>{busy ? "ĐANG TÁCH BEAT…" : "TÁCH GIỌNG & XUẤT BEAT"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result ? <div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI FILE BEAT WAV ↓</a></div> : null}
  </article>;
}

function ArrangementBuilder() {
  const [clips, setClips] = useState<ArrangementClip[]>([]);
  const [crossfade, setCrossfade] = useState(.8);
  const [joinTime, setJoinTime] = useState("");
  const [seamFade, setSeamFade] = useState(.16);
  const [normalize, setNormalize] = useState(true);
  const [repair, setRepair] = useState(true);
  const [preset, setPreset] = useState<MasterPreset>("balanced");
  const [intensity, setIntensity] = useState(80);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Chọn một bản nhạc hoặc nhiều đoạn cần remaster.");
  const [result, setResult] = useState<AudioResult | null>(null);
  const [before, setBefore] = useState<AudioResult | null>(null);
  const resultUrl = useRef("");
  const beforeUrl = useRef("");

  useEffect(() => () => {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    if (beforeUrl.current) URL.revokeObjectURL(beforeUrl.current);
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted = [...list].filter(isAudio);
    if (!accepted.length) { setStatus("Không tìm thấy file audio hợp lệ."); return; }
    clearResult(resultUrl, setResult);
    clearResult(beforeUrl, setBefore);
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
    clearResult(beforeUrl, setBefore);
    setStatus("Đang chạy EQ, compressor, stereo polish và limiter…");
    try {
      const joinSeconds=joinTime.trim()?parseTimestamp(joinTime):null;
      if(joinTime.trim()&&joinSeconds===null)throw new Error("Mốc nối không hợp lệ. Hãy nhập dạng 01:31.33 hoặc số giây.");
      const output = await assembleAudio(clips.map(clip => clip.file), crossfade, normalize, repair, preset, intensity, joinSeconds, seamFade);
      const url = URL.createObjectURL(output.master);
      const dryUrl = URL.createObjectURL(output.before);
      resultUrl.current = url;
      beforeUrl.current = dryUrl;
      const name = `${baseName(clips[0].file.name)}_remastered.wav`;
      setBefore({ url:dryUrl, name:"", details:`TRƯỚC · RMS ${dbTag(output.beforeMetrics.rmsDb)} DB · PEAK ${dbTag(output.beforeMetrics.peakDb)} DB` });
      setResult({ url, name, details:`SAU · ${presetLabel(preset)} ${intensity}%${joinSeconds!==null?` · NỐI ${timeTag(joinSeconds)} / ${Math.round(seamFade*1000)} MS`:""} · RMS ${dbTag(output.afterMetrics.rmsDb)} DB · PEAK ${dbTag(output.afterMetrics.peakDb)} DB` });
      setStatus("Master đã hoàn thành. Hãy dùng phần A/B bên dưới để nghe sự khác biệt trước và sau.");
    } catch (error) {
      setStatus(error instanceof Error ? friendlyAudioError(error.message) : "Không thể hoàn thiện bản phối này.");
    } finally { setBusy(false); }
  };

  return <article className="audio-pro-card arrangement-card">
    <header><span>04</span><div><small>REMASTER STUDIO</small><h2>Remaster bản nhạc hoàn chỉnh</h2><p>Làm mượt mối nối, cân mức âm và hoàn thiện bản master liền mạch.</p></div><b>ON-DEVICE</b></header>
    <label className="pro-upload multi">FILE ĐÃ GHÉP HOẶC CÁC ĐOẠN NHẠC<input type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}/><b>Thêm một hoặc nhiều đoạn</b><span>Thứ tự có thể chỉnh sau khi chọn</span></label>
    {clips.length ? <div className="clip-list">{clips.map((clip,index) => <div key={clip.id}><i>{String(index+1).padStart(2,"0")}</i><p><b>{clip.file.name}</b><small>{formatBytes(clip.file.size)}</small></p><button disabled={index===0} onClick={() => move(index,-1)} aria-label={`Đưa ${clip.file.name} lên`}>↑</button><button disabled={index===clips.length-1} onClick={() => move(index,1)} aria-label={`Đưa ${clip.file.name} xuống`}>↓</button><button onClick={() => remove(clip.id)} aria-label={`Xóa ${clip.file.name}`}>×</button></div>)}</div> : null}
    <div className="audio-mode-tabs master-presets" role="group" aria-label="Chọn màu âm mastering">
      {(["balanced","warm","clear","loud"] as MasterPreset[]).map(value => <button key={value} className={preset===value?"active":""} onClick={() => setPreset(value)}><b>{presetLabel(value)}</b><small>{presetCopy(value)}</small></button>)}
    </div>
    <div className="arrangement-options">
      <label className="seam-time"><span><b>MỐC NỐI CẦN SỬA</b><small>Để trống nếu các đoạn được tải riêng; nhập dạng 01:31.33 cho file đã nối.</small></span><input type="text" value={joinTime} onChange={event=>setJoinTime(event.target.value)} placeholder="01:31.33"/></label>
      <label><span><b>CROSSFADE MỐI NỐI</b><small>Chồng hai phía của mốc cắt, phù hợp lỗi lệch màu âm hoặc nhịp.</small></span><output>{Math.round(seamFade*1000)}MS</output><input type="range" min="0.04" max="0.5" step="0.01" value={seamFade} onChange={event=>setSeamFade(Number(event.target.value))}/></label>
      <label><span><b>CƯỜNG ĐỘ MASTER</b><small>Mức tác động của EQ và compression</small></span><output>{intensity}%</output><input type="range" min="25" max="100" step="5" value={intensity} onChange={event => setIntensity(Number(event.target.value))}/></label>
      <label><span><b>CROSSFADE</b><small>0–5 giây giữa các đoạn</small></span><output>{tag(crossfade)}S</output><input type="range" min="0" max="5" step="0.1" value={crossfade} onChange={event => setCrossfade(Number(event.target.value))}/></label>
      <label className="option-check"><input type="checkbox" checked={normalize} onChange={event => setNormalize(event.target.checked)}/><span><b>LOUDNESS + LIMITER −1 DB</b><small>Tăng độ lớn cảm nhận và chặn peak gây vỡ tiếng.</small></span></label>
      <label className="option-check"><input type="checkbox" checked={repair} onChange={event => setRepair(event.target.checked)}/><span><b>SỬA MỐI NỐI & DROPOUT</b><small>Dò khoảng rỗng 8–250 ms, lấp bằng crossfade và khử click.</small></span></label>
    </div>
    <button className="pro-run" disabled={!clips.length || busy} onClick={run}>{busy ? "ĐANG REMASTER…" : "REMASTER & XUẤT FILE HOÀN CHỈNH"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {result && before ? <div className="pro-result ab-result"><div className="ab-compare"><label><b>A · TRƯỚC MASTER</b><audio controls preload="metadata" src={before.url}/><small>{before.details}</small></label><label><b>B · SAU MASTER</b><audio controls preload="metadata" src={result.url}/><small>{result.details}</small></label></div><a href={result.url} download={result.name}>TẢI BẢN REMASTER WAV ↓</a></div> : null}
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
    return {
      blob: await response.blob(),
      engine: response.headers.get("X-Pulse-Separation-Engine") || "Ultimate Vocal Remover · Inst HQ 3",
    };
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

async function assembleAudio(files:File[], crossfade:number, normalize:boolean, repair:boolean, preset:MasterPreset, intensity:number, joinSeconds:number|null, seamFade:number) {
  const decoder = new AudioContext();
  try {
    const buffers:AudioBuffer[] = [];
    for (const file of files) buffers.push(await decoder.decodeAudioData(await file.arrayBuffer()));
    const sampleRate = Math.max(...buffers.map(buffer => buffer.sampleRate));
    const safeFade = Math.max(0, Math.min(crossfade, ...buffers.map(buffer => Math.max(0,buffer.duration/3))));
    const totalDuration = buffers.reduce((total,buffer) => total + buffer.duration,0) - safeFade * Math.max(0,buffers.length-1);
    if (totalDuration <= 0 || totalDuration > 4 * 60 * 60) throw new Error("Bản phối phải ngắn hơn 4 giờ.");
    const offline = new OfflineAudioContext(2,Math.ceil(totalDuration*sampleRate),sampleRate);
    let cursor=0;
    buffers.forEach((buffer,index) => {
      const source=offline.createBufferSource(), gain=offline.createGain();
      source.buffer=buffer; source.connect(gain).connect(offline.destination);
      if(index>0&&safeFade>0){gain.gain.setValueAtTime(0,cursor);gain.gain.linearRampToValueAtTime(1,cursor+safeFade);}
      else gain.gain.setValueAtTime(1,cursor);
      const end=cursor+buffer.duration;
      if(index<buffers.length-1&&safeFade>0){gain.gain.setValueAtTime(1,Math.max(cursor,end-safeFade));gain.gain.linearRampToValueAtTime(0,end);}
      source.start(cursor);
      cursor += buffer.duration-safeFade;
    });
    const rendered=await offline.startRendering();
    const dryChannels=Array.from({length:Math.min(2,rendered.numberOfChannels)},(_,index)=>rendered.getChannelData(index).slice());
    const beforeMetrics=measureAudio(dryChannels);
    let workingChannels=dryChannels.map(channel=>channel.slice());
    if(joinSeconds!==null)workingChannels=crossfadeAtTime(workingChannels,rendered.sampleRate,joinSeconds,seamFade);
    if(repair){
      workingChannels.forEach(channel=>repairClicks(channel,rendered.sampleRate));
      repairDropouts(workingChannels,rendered.sampleRate);
    }
    const mastered=await masterChannels(workingChannels,rendered.sampleRate,preset,intensity,normalize);
    const afterMetrics=measureAudio(mastered);
    return { before:encodeWav(dryChannels,rendered.sampleRate), master:encodeWav(mastered,rendered.sampleRate), beforeMetrics, afterMetrics };
  } finally { await decoder.close().catch(()=>undefined); }
}

async function masterChannels(channels:Float32Array[],sampleRate:number,preset:MasterPreset,intensity:number,finalize:boolean) {
  const amount=Math.max(.25,Math.min(1,intensity/100));
  const profile={
    balanced:{low:.9,mud:-1.5,presence:1.3,air:.9,threshold:-20,ratio:2.2,makeup:2,target:-14},
    warm:{low:2.2,mud:-1.1,presence:.4,air:-.4,threshold:-22,ratio:2.7,makeup:2.6,target:-14.5},
    clear:{low:-.5,mud:-2.5,presence:2.2,air:1.8,threshold:-19,ratio:2.1,makeup:2,target:-14},
    loud:{low:1.2,mud:-2,presence:1.5,air:1,threshold:-25,ratio:3.8,makeup:4,target:-11.5},
  }[preset];
  const length=channels[0].length, offline=new OfflineAudioContext(Math.max(1,channels.length),length,sampleRate);
  const buffer=offline.createBuffer(channels.length,length,sampleRate);
  channels.forEach((channel,index)=>buffer.getChannelData(index).set(channel));
  const source=offline.createBufferSource(); source.buffer=buffer;
  const highpass=offline.createBiquadFilter(); highpass.type="highpass"; highpass.frequency.value=28; highpass.Q.value=.7;
  const low=offline.createBiquadFilter(); low.type="lowshelf"; low.frequency.value=125; low.gain.value=profile.low*amount;
  const mud=offline.createBiquadFilter(); mud.type="peaking"; mud.frequency.value=285; mud.Q.value=.8; mud.gain.value=profile.mud*amount;
  const presence=offline.createBiquadFilter(); presence.type="peaking"; presence.frequency.value=3200; presence.Q.value=.7; presence.gain.value=profile.presence*amount;
  const air=offline.createBiquadFilter(); air.type="highshelf"; air.frequency.value=9000; air.gain.value=profile.air*amount;
  const compressor=offline.createDynamicsCompressor(); compressor.threshold.value=profile.threshold*amount; compressor.knee.value=12; compressor.ratio.value=1+(profile.ratio-1)*amount; compressor.attack.value=.018; compressor.release.value=.22;
  const makeup=offline.createGain(); makeup.gain.value=Math.pow(10,profile.makeup*amount/20);
  const limiter=offline.createDynamicsCompressor(); limiter.threshold.value=-1.2; limiter.knee.value=0; limiter.ratio.value=20; limiter.attack.value=.0015; limiter.release.value=.075;
  source.connect(highpass).connect(low).connect(mud).connect(presence).connect(air).connect(compressor).connect(makeup).connect(limiter).connect(offline.destination);
  source.start();
  const rendered=await offline.startRendering();
  const output=Array.from({length:rendered.numberOfChannels},(_,index)=>rendered.getChannelData(index).slice());
  if(finalize)applyLoudnessAndLimit(output,profile.target,-1);
  return output;
}

function applyLoudnessAndLimit(channels:Float32Array[],targetRmsDb:number,targetPeakDb:number) {
  const metrics=measureAudio(channels), targetRms=Math.pow(10,targetRmsDb/20), targetPeak=Math.pow(10,targetPeakDb/20);
  const rms=Math.pow(10,metrics.rmsDb/20), peak=Math.pow(10,metrics.peakDb/20);
  const gain=Math.max(.35,Math.min(4,targetRms/Math.max(rms,1e-7),targetPeak/Math.max(peak,1e-7)*1.35));
  const drive=1.35;
  for(const channel of channels)for(let index=0;index<channel.length;index++){
    const sample=channel[index]*gain;
    channel[index]=Math.tanh(sample*drive)/Math.tanh(drive);
  }
  normalizeChannels(channels,targetPeak);
}

function measureAudio(channels:Float32Array[]):AudioMetrics {
  let peak=0,sum=0,count=0;
  for(const channel of channels)for(let index=0;index<channel.length;index++){
    const value=channel[index]; peak=Math.max(peak,Math.abs(value));
    if(Math.abs(value)>1e-4){sum+=value*value;count++;}
  }
  const rms=Math.sqrt(sum/Math.max(1,count));
  return {peakDb:20*Math.log10(Math.max(peak,1e-7)),rmsDb:20*Math.log10(Math.max(rms,1e-7))};
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

function repairDropouts(channels:Float32Array[],sampleRate:number) {
  const length=channels[0]?.length??0, threshold=4/32768, minRun=Math.round(sampleRate*.008), maxRun=Math.round(sampleRate*.25);
  const gaps:{start:number;end:number}[]=[];
  let start=-1;
  for(let index=0;index<length;index++){
    let quiet=true;
    for(const channel of channels)if(Math.abs(channel[index])>threshold){quiet=false;break;}
    if(quiet&&start<0)start=index;
    if((!quiet||index===length-1)&&start>=0){
      const end=quiet&&index===length-1?index+1:index, run=end-start;
      if(run>=minRun&&run<=maxRun&&start>Math.max(run,sampleRate*2)&&end+Math.max(run,sampleRate*2)<length)gaps.push({start,end});
      start=-1;
    }
  }
  for(const {start:gapStart,end:gapEnd} of gaps){
    const run=gapEnd-gapStart;
    for(const channel of channels)for(let offset=0;offset<run;offset++){
      const mix=(offset+1)/(run+1), left=channel[gapStart-run+offset], right=channel[gapEnd+offset];
      channel[gapStart+offset]=left*Math.cos(mix*Math.PI/2)+right*Math.sin(mix*Math.PI/2);
    }
  }
  return channels;
}

function crossfadeAtTime(channels:Float32Array[],sampleRate:number,seconds:number,duration:number) {
  const length=channels[0]?.length??0, boundary=Math.round(seconds*sampleRate), fade=Math.round(Math.max(.04,Math.min(.5,duration))*sampleRate);
  if(boundary<=fade||boundary+fade>=length)throw new Error("Mốc nối nằm quá gần đầu hoặc cuối bản nhạc.");
  let leftPower=0,rightPower=0;
  for(const channel of channels)for(let index=0;index<fade;index++){
    leftPower+=channel[boundary-fade+index]**2; rightPower+=channel[boundary+index]**2;
  }
  const match=Math.max(.8,Math.min(1.25,Math.sqrt(leftPower/Math.max(rightPower,1e-9))));
  return channels.map(channel=>{
    const output=new Float32Array(length-fade);
    output.set(channel.subarray(0,boundary-fade));
    for(let index=0;index<fade;index++){
      const mix=(index+.5)/fade;
      output[boundary-fade+index]=channel[boundary-fade+index]*Math.cos(mix*Math.PI/2)+channel[boundary+index]*match*Math.sin(mix*Math.PI/2);
    }
    output.set(channel.subarray(boundary+fade),boundary);
    const ramp=Math.min(sampleRate,output.length-boundary);
    for(let index=0;index<ramp;index++)output[boundary+index]*=match+(1-match)*index/Math.max(1,ramp-1);
    return output;
  });
}

function normalizeChannels(channels:Float32Array[],target:number){let peak=0;for(const channel of channels)for(let index=0;index<channel.length;index++)peak=Math.max(peak,Math.abs(channel[index]));if(peak<1e-7)return;const gain=Math.min(8,target/peak);for(const channel of channels)for(let index=0;index<channel.length;index++)channel[index]=clamp(channel[index]*gain);}
function encodeWav(channels:Float32Array[],sampleRate:number){const frames=channels[0].length,count=channels.length,align=count*2,buffer=new ArrayBuffer(44+frames*align),view=new DataView(buffer),write=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};write(0,"RIFF");view.setUint32(4,36+frames*align,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*align,true);view.setUint16(32,align,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,frames*align,true);let offset=44;for(let frame=0;frame<frames;frame++)for(let channel=0;channel<count;channel++){const sample=clamp(channels[channel][frame]||0);view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;}return new Blob([buffer],{type:"audio/wav"});}
function isAudio(file:File){return file.type.startsWith("audio/")||AUDIO_PATTERN.test(file.name);}
function clearResult(ref:React.MutableRefObject<string>,setResult:React.Dispatch<React.SetStateAction<AudioResult|null>>){if(ref.current)URL.revokeObjectURL(ref.current);ref.current="";setResult(null);}
function friendlyAudioError(message:string){return /decode|encoding/i.test(message)?"Không giải mã được codec này. Hãy thử WAV hoặc MP3.":message;}
function baseName(name:string){return name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-").trim()||"pulse-audio";}
function formatBytes(value:number){const units=["B","KB","MB","GB"];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${value.toLocaleString("vi-VN",{maximumFractionDigits:2})} ${units[unit]}`;}
function presetLabel(value:MasterPreset){return {balanced:"CÂN BẰNG",warm:"ẤM",clear:"RÕ NÉT",loud:"LOUD"}[value];}
function presetCopy(value:MasterPreset){return {balanced:"Đều, tự nhiên",warm:"Dày bass, mềm treble",clear:"Sáng và rõ giọng",loud:"Nén mạnh, âm lượng lớn"}[value];}
function dbTag(value:number){return Number.isFinite(value)?value.toFixed(1).replace(".",","):"−∞";}
function parseTimestamp(value:string){const clean=value.trim().replace(",",".");if(/^\d+(\.\d+)?$/.test(clean))return Number(clean);const match=clean.match(/^(\d+):([0-5]?\d(?:\.\d+)?)$/);if(!match)return null;return Number(match[1])*60+Number(match[2]);}
function timeTag(value:number){const minutes=Math.floor(value/60),seconds=value-minutes*60;return `${String(minutes).padStart(2,"0")}:${seconds.toFixed(2).padStart(5,"0")}`.replace(".",",");}
function tag(value:number){return String(Math.round(value*10)/10).replace(".",",");}
function clamp(value:number){return Math.max(-1,Math.min(1,value));}
