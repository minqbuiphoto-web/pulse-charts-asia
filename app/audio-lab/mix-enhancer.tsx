"use client";
import {useEffect,useRef,useState} from "react";
import {remasterFile} from "./remaster/engine";
const presets:Record<string,number[]>={"AI Fix":[0,-2,0,-1,-1],"Vocal":[0,-2,1.5,1,0.5],"Bright":[0,-1,0,1,2],"Warm":[1,0.5,0,-1,-1],"Flat":[0,0,0,0,0]};
const bands=["Bass · 80 Hz","Giảm đục · 250 Hz","Giọng · 1 kHz","Độ rõ · 4 kHz","Air · 12 kHz"];
export default function MixEnhancer(){
 const[mode,setMode]=useState<"auto"|"match"|"manual">("auto"),[reference,setReference]=useState<File|null>(null),[needsEngine,setNeedsEngine]=useState(false);
 const[file,setFile]=useState<File|null>(null),[original,setOriginal]=useState(""),[result,setResult]=useState(""),[status,setStatus]=useState("Chọn bài hát hoặc beat để bắt đầu."),[busy,setBusy]=useState(false);
 const[preset,setPreset]=useState("AI Fix"),[eq,setEq]=useState(presets["AI Fix"]),[width,setWidth]=useState(100),[target,setTarget]=useState(-14);
 const[mud,setMud]=useState(true),[harsh,setHarsh]=useState(true),[air,setAir]=useState(false),[glue,setGlue]=useState(false),[dirty,setDirty]=useState(false);
 const urls=useRef<string[]>([]),beforePlayer=useRef<HTMLAudioElement|null>(null),afterPlayer=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>()=>urls.current.forEach(URL.revokeObjectURL),[]);
 const makeUrl=(blob:Blob)=>{const url=URL.createObjectURL(blob);urls.current.push(url);return url};
 const choose=(next?:File)=>{
  if(!next)return;
  if(next.size>200*1024*1024){setStatus("Hãy chọn file tối đa 200 MB.");return}
  beforePlayer.current?.pause();afterPlayer.current?.pause();
  urls.current.forEach(URL.revokeObjectURL);urls.current=[];
  setFile(next);setOriginal(makeUrl(next));setResult("");setDirty(false);setStatus("Đã nạp "+next.name);
 };
 const run=async()=>{
  if(!file||busy||(mode==="match"&&!reference))return;
  setNeedsEngine(false);
  setBusy(true);beforePlayer.current?.pause();afterPlayer.current?.pause();setStatus("Đang làm sạch, chỉnh chất âm và xuất WAV 24-bit trên máy…");
  await new Promise(resolve=>setTimeout(resolve,50));
  try{
   const output=mode==="match"?await matchFile(file,reference!):await remasterFile(file,{auto:mode==="auto",eqLow:eq[0],eqLowMid:eq[1],eqMid:eq[2],eqHighMid:eq[3],eqHigh:eq[4],cutMud:mud,tameHarsh:harsh,addAir:air,glueCompression:glue,cleanLowEnd:true,stereoWidth:width,targetLufs:target});
   if(result)URL.revokeObjectURL(result);
   setResult(makeUrl(output.blob));setDirty(false);
   const show=(n:number)=>Number.isFinite(n)?n.toFixed(1):"—";
   setStatus(mode==="match"?"Đã master theo bài mẫu · WAV 24-bit. Nghe so sánh trước khi tải.":"Hoàn tất · Loudness gốc "+show(output.before)+" → bản mới "+show(output.after)+" LUFS · WAV 24-bit / 44,1 kHz. Nghe so sánh trước khi tải.");
  }catch(error){if(mode==="match")setNeedsEngine(true);setStatus(error instanceof Error?error.message:"Không xử lý được file. Hãy thử WAV hoặc MP3.")}finally{setBusy(false)}
 };
 const mark=()=>{if(result)setDirty(true)};
 return <article className="audio-pro-card mix-card">
  <header><span>04</span><div><small>MIX ENHANCE</small><h2>Remaster tự động · rõ và nổi hơn</h2><p>Nạp bài → tạo bản mới → nghe và tải WAV 24-bit</p></div><b>FREE · LOCAL</b></header>
  <details className="quality-note"><summary>Bước tùy chọn: làm sạch bằng Shimmer</summary><p>Nếu cymbal bị xì hoặc giọng sạn, dùng Shimmer trên máy để Analyze → Clean &amp; Master, rồi nạp file WAV vào đây. Nên xử lý nhẹ, tránh làm mất độ sáng tự nhiên.</p><a href="https://treqmusic.com/tools/shimmer/" target="_blank" rel="noreferrer">Tải và xem hướng dẫn Shimmer ↗</a><p>Shimmer chạy riêng; công cụ bên dưới dùng Suno Song Remaster.</p></details>
  <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
  <label className="pro-upload">BÀI HÁT HOẶC BEAT<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" onChange={e=>{choose(e.target.files?.[0]);e.currentTarget.value=""}}/><b>{file?.name||"Chọn file WAV / MP3 / FLAC"}</b><span>Ưu tiên WAV gốc từ Suno · tối đa 200 MB / 15 phút</span></label>
  <div className="audio-mode-tabs" role="group" aria-label="Chế độ remaster">{([["auto","AUTO CẢI THIỆN"],["match","THEO BÀI MẪU"],["manual","TÙY CHỈNH"]] as const).map(([key,label])=><button type="button" key={key} className={mode===key?"active":""} onClick={()=>{setMode(key);setNeedsEngine(false);mark()}}><b>{label}</b></button>)}</div>
  {mode==="auto"&&<p className="quality-note">Tự phân tích chất âm, giảm đục hoặc làm sáng nhẹ khi cần; mở stereo vừa phải nếu phù hợp. Chỉ cần nạp bài và bấm tạo bản mới.</p>}
  {mode==="match"&&<label className="pro-upload">BÀI MẪU CÓ CHẤT ÂM BẠN THÍCH<input type="file" accept="audio/*" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size<=200*1024*1024){setReference(f);mark()}else if(f)setStatus("Bài mẫu tối đa 200 MB.");e.currentTarget.value=""}}/><b>{reference?.name||"Chọn bài mẫu cùng thể loại"}</b><span>Matchering chạy trên máy · cần cài/cập nhật bộ xử lý một lần</span></label>}
  {mode==="manual"&&<>
  <div className="audio-mode-tabs" style={{flexWrap:"wrap",display:"flex"}} role="group" aria-label="Preset remaster">{Object.keys(presets).map(name=><button type="button" key={name} className={preset===name?"active":""} onClick={()=>{setPreset(name);setEq([...presets[name]]);setHarsh(name==="AI Fix");setMud(name==="AI Fix"||name==="Vocal");setAir(false);mark()}}><b>{name}</b></button>)}</div>
  <div className="mix-controls">{bands.map((label,i)=><label key={label}><span><b>{label}</b></span><output>{eq[i].toFixed(1)} dB</output><input aria-label={label} type="range" min="-6" max="6" step="0.5" value={eq[i]} onChange={e=>{setEq(eq.map((v,k)=>k===i?Number(e.target.value):v));setPreset("");mark()}}/></label>)}
  <label><span><b>ĐỘ RỘNG STEREO</b><small>100% là độ rộng gốc</small></span><output>{width}%</output><input type="range" min="0" max="200" step="5" value={width} onChange={e=>{setWidth(Number(e.target.value));mark()}}/></label>
  <label><span><b>LOUDNESS MỤC TIÊU</b></span><output>{target} LUFS</output><input type="range" min="-20" max="-9" step="1" value={target} onChange={e=>{setTarget(Number(e.target.value));mark()}}/></label></div>
  <div className="remaster-options">{([[mud,setMud,"Giảm đục"],[harsh,setHarsh,"Giảm chói / gắt"],[air,setAir,"Thêm độ thoáng"],[glue,setGlue,"Nén động nhẹ"]] as const).map(([value,setter,label])=><label key={label}><input type="checkbox" checked={value} onChange={e=>{setter(e.target.checked);mark()}}/> {label}</label>)}</div>
  </>}
  </fieldset>
  <p className="quality-note">Auto là điểm bắt đầu nhẹ nhàng. Nếu bản gốc đã tốt, thay đổi có thể nhỏ; hãy nghe so sánh và giữ bản bạn thích.</p>
  <button type="button" className="pro-run" disabled={!file||busy||(mode==="match"&&!reference)} onClick={()=>void run()}>{busy?"ĐANG REMASTER…":mode==="match"?"MASTER THEO BÀI MẪU":"TẠO BẢN REMASTER WAV 24-BIT"}</button>
  {needsEngine&&<div className="quality-note"><p>Matchering cần bộ xử lý trên máy. Cài/cập nhật một lần rồi mở lại bộ xử lý và thử lại.</p><a href="/install-pulse-audio-ai.cmd" download>Cài lần đầu</a>{" · "}<a href="/update-pulse-audio-engine.cmd" download>Cập nhật Matchering</a></div>}
  <p className="pro-status" aria-live="polite">{status}</p>
  {original&&<div className="pro-result"><b>BẢN GỐC</b><audio ref={beforePlayer} controls src={original} onPlay={()=>afterPlayer.current?.pause()}/></div>}
  {result&&<div className="pro-result"><b>BẢN ĐÃ XỬ LÝ{dirty?" · cài đặt vừa đổi, bấm tạo lại để áp dụng":""}</b><audio ref={afterPlayer} controls src={result} onPlay={()=>beforePlayer.current?.pause()}/><a href={result} download={(file?.name.replace(/\.[^.]+$/,"")||"audio")+"_remastered_24bit.wav"}>TẢI WAV 24-BIT ↓</a></div>}
  <p className="quality-note">Auto: <a href="https://github.com/SUP3RMASS1VE/Suno-Song-Remaster" target="_blank" rel="noreferrer">Suno Song Remaster · ISC</a> với phân tích chất âm tự động. Theo bài mẫu: <a href="https://github.com/sergree/matchering" target="_blank" rel="noreferrer">Matchering · GPLv3</a>. Cả hai xử lý trên thiết bị của bạn.</p>
 </article>;
}


async function matchFile(file:File,reference:File){
 const form=new FormData();form.append("file",file);form.append("reference",reference);
 let response:Response;
 try{response=await fetch("http://127.0.0.1:8765/matchering",{method:"POST",body:form,signal:AbortSignal.timeout(20*60*1000)})}
 catch{throw new Error("Chưa kết nối được Matchering trên máy. Hãy cài/cập nhật bộ xử lý rồi thử lại.")}
 if(!response.ok){const data=await response.json().catch(()=>null);throw new Error(data?.detail||"Bộ xử lý chưa hỗ trợ Matchering. Hãy cập nhật.")}
 return {blob:await response.blob(),before:NaN,after:NaN};
}

