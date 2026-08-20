"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type BeatMode = "ai" | "quick";
type MixMode = "finished" | "stems";
type AudioResult = { url: string; name: string; details: string };

const LOCAL_ENGINE = "http://127.0.0.1:8765";
const AUDIO_PATTERN = /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i;

export default function AudioProTools() {
  return <section className="audio-pro-suite" aria-label="Tách giọng, lấy beat và mix audio">
    <BeatExtractor/>
    <MixEnhancer/>
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

function MixEnhancer() {
  const [mode,setMode]=useState<MixMode>("stems");
  const [mixFile,setMixFile]=useState<File|null>(null);
  const [vocalFile,setVocalFile]=useState<File|null>(null);
  const [beatFile,setBeatFile]=useState<File|null>(null);
  const [brightness,setBrightness]=useState(1.5);
  const [space,setSpace]=useState(12);
  const [glue,setGlue]=useState(55);
  const [vocalGain,setVocalGain]=useState(0);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("Ưu tiên Vocal + Beat để độ vang chỉ tác động lên giọng hát.");
  const [needsEngineUpdate,setNeedsEngineUpdate]=useState(false);
  const [result,setResult]=useState<AudioResult|null>(null);
  const resultUrl=useRef("");

  useEffect(()=>()=>{if(resultUrl.current)URL.revokeObjectURL(resultUrl.current);},[]);

  const choose=(kind:"mix"|"vocal"|"beat",next?:File)=>{
    clearResult(resultUrl,setResult);
    if(!next)return;
    if(!isAudio(next)){setStatus("Định dạng này chưa được nhận diện là audio.");return;}
    if(next.size>500*1024*1024){setStatus("File vượt 500 MB. Hãy dùng WAV/MP3 ngắn hơn.");return;}
    if(kind==="mix")setMixFile(next);
    if(kind==="vocal")setVocalFile(next);
    if(kind==="beat")setBeatFile(next);
    setStatus(`${next.name} · ${formatBytes(next.size)} · sẵn sàng`);
  };

  const ready=mode==="finished"?Boolean(mixFile):Boolean(vocalFile&&beatFile);

  const run=async()=>{
    if(!ready||busy)return;
    setBusy(true);setNeedsEngineUpdate(false);clearResult(resultUrl,setResult);
    setStatus(mode==="stems"?"Đang mix vocal với beat, tạo không gian cho riêng giọng hát…":"Đang làm sáng, glue và chuẩn hóa bản mix đã ghép…");
    const controller=new AbortController();
    const timer=window.setTimeout(()=>controller.abort(),30*60*1000);
    try{
      const form=new FormData();
      let endpoint:string,name:string;
      if(mode==="stems"){
        form.append("vocal",vocalFile!,vocalFile!.name);form.append("beat",beatFile!,beatFile!.name);
        form.append("vocal_gain",String(vocalGain));form.append("brightness",String(brightness));form.append("reverb",String(space));
        endpoint="mix-stems";name=`${baseName(vocalFile!.name)}_mix_vocal_beat_24bit.wav`;
      }else{
        form.append("file",mixFile!,mixFile!.name);form.append("brightness",String(brightness));form.append("glue",String(glue));form.append("space",String(Math.min(space,8)));
        endpoint="enhance-mix";name=`${baseName(mixFile!.name)}_mix_enhanced_24bit.wav`;
      }
      const response=await fetch(`${LOCAL_ENGINE}/${endpoint}`,{method:"POST",body:form,signal:controller.signal});
      if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error(detail||"Bộ mix trên máy chưa sẵn sàng.");}
      const blob=await response.blob(),url=URL.createObjectURL(blob);resultUrl.current=url;
      const engine=response.headers.get("X-Pulse-Mix-Engine")||"PULSE MIX ENGINE · -14 LUFS · -1 dBTP";
      setResult({url,name,details:`${engine.toUpperCase()} · ${formatBytes(blob.size)} · WAV 24-BIT`});
      setStatus("Mix mới đã sẵn sàng. Hãy nghe thử trước khi thay file gốc.");
    }catch(error){
      const message=error instanceof Error?error.message:"Không thể tạo bản mix.";
      const blocked=/failed to fetch|networkerror|load failed/i.test(message);
      setNeedsEngineUpdate(blocked);
      setStatus(error instanceof Error&&error.name==="AbortError"?"Mix quá 30 phút nên đã dừng.":blocked?"Engine Mix trên máy đang dùng kết nối cũ. Hãy cập nhật nhanh engine rồi chạy lại file này.":friendlyAudioError(message));
    }finally{window.clearTimeout(timer);setBusy(false);}
  };

  return <article className="audio-pro-card mix-card">
    <header><span>04</span><div><small>MIX ENHANCE</small><h2>Làm giọng vang, sáng và liền hơn</h2><p>Mix local miễn phí · không mở rộng stereo thêm · xuất WAV 24-bit chuẩn −14 LUFS.</p></div><b>LOCAL DSP</b></header>
    <div className="audio-mode-tabs" role="group" aria-label="Chọn cách mix">
      <button className={mode==="stems"?"active":""} onClick={()=>{setMode("stems");clearResult(resultUrl,setResult);setStatus("Chất lượng tốt nhất: xử lý không gian trên riêng vocal.");}}><b>VOCAL + BEAT</b><small>Khuyên dùng · vang đúng phần giọng</small></button>
      <button className={mode==="finished"?"active":""} onClick={()=>{setMode("finished");clearResult(resultUrl,setResult);setStatus("Xử lý nhẹ toàn bài; không thay thế mix từ stem.");}}><b>BẢN ĐÃ GHÉP</b><small>Nhanh · cải thiện vừa phải</small></button>
    </div>
    {mode==="stems"?<div className="mix-upload-grid">
      <label className="pro-upload multi">FILE VOCAL RIÊNG<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>)=>choose("vocal",event.target.files?.[0])}/><b>{vocalFile?.name??"Chọn vocal WAV"}</b><span>{vocalFile?formatBytes(vocalFile.size):"Giọng hát chưa có reverb càng tốt"}</span></label>
      <label className="pro-upload multi">FILE BEAT RIÊNG<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>)=>choose("beat",event.target.files?.[0])}/><b>{beatFile?.name??"Chọn beat WAV"}</b><span>{beatFile?formatBytes(beatFile.size):"Beat không lời cùng thời điểm bắt đầu"}</span></label>
    </div>:<label className="pro-upload">FILE NHẠC ĐÃ GHÉP<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm" onChange={(event:ChangeEvent<HTMLInputElement>)=>choose("mix",event.target.files?.[0])}/><b>{mixFile?.name??"Chọn bản mix WAV / MP3"}</b><span>{mixFile?formatBytes(mixFile.size):"Hệ thống xử lý bảo thủ để tránh vang đục"}</span></label>}
    <div className="mix-controls">
      {mode==="stems"&&<label><span><b>ÂM LƯỢNG VOCAL</b><small>So với beat</small></span><output>{vocalGain>0?"+":""}{vocalGain.toFixed(1)} dB</output><input type="range" min="-6" max="6" step="0.5" value={vocalGain} onChange={event=>setVocalGain(Number(event.target.value))}/></label>}
      <label><span><b>ĐỘ SÁNG</b><small>Air và độ rõ</small></span><output>{brightness.toFixed(1)} dB</output><input type="range" min="0" max="3" step="0.1" value={brightness} onChange={event=>setBrightness(Number(event.target.value))}/></label>
      <label><span><b>{mode==="stems"?"KHÔNG GIAN VOCAL":"KHÔNG GIAN TOÀN BÀI"}</b><small>{mode==="stems"?"Reverb + delay nhẹ":"Giữ thấp để tránh đục"}</small></span><output>{mode==="stems"?space:Math.min(space,8)}%</output><input type="range" min="0" max={mode==="stems"?25:8} step="1" value={mode==="stems"?space:Math.min(space,8)} onChange={event=>setSpace(Number(event.target.value))}/></label>
      {mode==="finished"&&<label><span><b>GLUE</b><small>Độ liền của bản mix</small></span><output>{glue}%</output><input type="range" min="0" max="100" step="5" value={glue} onChange={event=>setGlue(Number(event.target.value))}/></label>}
    </div>
    <p className="quality-note">Preset cân bằng theo MV mẫu: giảm low-mid, thêm độ sáng, compression nhẹ và true peak −1 dBTP. Không ghi đè file gốc.</p>
    <button className="pro-run" disabled={!ready||busy} onClick={run}>{busy?"ĐANG MIX TRÊN MÁY…":"TẠO BẢN MIX ENHANCED"}<span>↗</span></button>
    <p className="pro-status" aria-live="polite">{status}</p>
    {needsEngineUpdate?<div className="mix-engine-repair"><b>ENGINE MIX CẦN CẬP NHẬT</b><span>Bản 6.2 cho phép trang HTTPS gửi file an toàn tới bộ xử lý trên máy. File nhạc không rời khỏi máy.</span><a href="/update-pulse-audio-engine.cmd" download>CẬP NHẬT NHANH ENGINE MIX .CMD ↓</a></div>:null}
    {result?<div className="pro-result"><audio controls preload="metadata" src={result.url}/><small>{result.details}</small><a href={result.url} download={result.name}>TẢI BẢN MIX WAV 24-BIT ↓</a></div>:null}
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

function normalizeChannels(channels:Float32Array[],target:number){let peak=0;for(const channel of channels)for(let index=0;index<channel.length;index++)peak=Math.max(peak,Math.abs(channel[index]));if(peak<1e-7)return;const gain=Math.min(8,target/peak);for(const channel of channels)for(let index=0;index<channel.length;index++)channel[index]=clamp(channel[index]*gain);}
function encodeWav(channels:Float32Array[],sampleRate:number){const frames=channels[0].length,count=channels.length,align=count*2,buffer=new ArrayBuffer(44+frames*align),view=new DataView(buffer),write=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};write(0,"RIFF");view.setUint32(4,36+frames*align,true);write(8,"WAVE");write(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*align,true);view.setUint16(32,align,true);view.setUint16(34,16,true);write(36,"data");view.setUint32(40,frames*align,true);let offset=44;for(let frame=0;frame<frames;frame++)for(let channel=0;channel<count;channel++){const sample=clamp(channels[channel][frame]||0);view.setInt16(offset,sample<0?sample*32768:sample*32767,true);offset+=2;}return new Blob([buffer],{type:"audio/wav"});}
function isAudio(file:File){return file.type.startsWith("audio/")||AUDIO_PATTERN.test(file.name);}
function clearResult(ref:React.MutableRefObject<string>,setResult:React.Dispatch<React.SetStateAction<AudioResult|null>>){if(ref.current)URL.revokeObjectURL(ref.current);ref.current="";setResult(null);}
function friendlyAudioError(message:string){return /decode|encoding/i.test(message)?"Không giải mã được codec này. Hãy thử WAV hoặc MP3.":message;}
function baseName(name:string){return name.replace(/\.[^.]+$/,"").replace(/[\\/:*?"<>|]+/g,"-").trim()||"pulse-audio";}
function formatBytes(value:number){const units=["B","KB","MB","GB"];let unit=0;while(value>=1024&&unit<units.length-1){value/=1024;unit++;}return `${value.toLocaleString("vi-VN",{maximumFractionDigits:2})} ${units[unit]}`;}
function clamp(value:number){return Math.max(-1,Math.min(1,value));}
