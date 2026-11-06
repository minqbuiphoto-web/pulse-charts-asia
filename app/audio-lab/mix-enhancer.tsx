"use client";
import {useEffect,useRef,useState} from "react";
import {remasterFile} from "./remaster/engine";
const presets:Record<string,number[]>={"AI Fix":[0,-2,0,-1,-1],"Vocal":[0,-2,1.5,1,0.5],"Bright":[0,-1,0,1,2],"Warm":[1,0.5,0,-1,-1],"Flat":[0,0,0,0,0]};
const bands=["Bass · 80 Hz","Giảm đục · 250 Hz","Giọng · 1 kHz","Độ rõ · 4 kHz","Air · 12 kHz"];
export default function MixEnhancer(){
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
  if(!file||busy)return;
  setBusy(true);beforePlayer.current?.pause();afterPlayer.current?.pause();setStatus("Đang làm sạch, chỉnh chất âm và xuất WAV 24-bit trên máy…");
  await new Promise(resolve=>setTimeout(resolve,50));
  try{
   const output=await remasterFile(file,{eqLow:eq[0],eqLowMid:eq[1],eqMid:eq[2],eqHighMid:eq[3],eqHigh:eq[4],cutMud:mud,tameHarsh:harsh,addAir:air,glueCompression:glue,cleanLowEnd:true,stereoWidth:width,targetLufs:target});
   if(result)URL.revokeObjectURL(result);
   setResult(makeUrl(output.blob));setDirty(false);
   const show=(n:number)=>Number.isFinite(n)?n.toFixed(1):"—";
   setStatus("Hoàn tất · Loudness gốc "+show(output.before)+" → bản mới "+show(output.after)+" LUFS · WAV 24-bit / 44,1 kHz. Nghe so sánh trước khi tải.");
  }catch(error){setStatus(error instanceof Error?error.message:"Không xử lý được file. Hãy thử WAV hoặc MP3.")}finally{setBusy(false)}
 };
 const mark=()=>{if(result)setDirty(true)};
 return <article className="audio-pro-card mix-card">
  <header><span>04</span><div><small>MIX ENHANCE</small><h2>Làm sạch và remaster nhạc AI</h2><p>Cho bài hát và beat · xử lý trên trình duyệt · WAV 24-bit</p></div><b>FREE · LOCAL</b></header>
  <details className="quality-note"><summary>Bước tùy chọn: làm sạch bằng Shimmer</summary><p>Nếu cymbal bị xì hoặc giọng sạn, dùng Shimmer trên máy để Analyze → Clean &amp; Master, rồi nạp file WAV vào đây. Nên xử lý nhẹ, tránh làm mất độ sáng tự nhiên.</p><a href="https://treqmusic.com/tools/shimmer/" target="_blank" rel="noreferrer">Tải và xem hướng dẫn Shimmer ↗</a><p>Shimmer chạy riêng; công cụ bên dưới dùng Suno Song Remaster.</p></details>
  <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}>
  <label className="pro-upload">BÀI HÁT HOẶC BEAT<input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" onChange={e=>{choose(e.target.files?.[0]);e.currentTarget.value=""}}/><b>{file?.name||"Chọn file WAV / MP3 / FLAC"}</b><span>Ưu tiên WAV gốc từ Suno · tối đa 200 MB / 15 phút</span></label>
  <div className="audio-mode-tabs" style={{flexWrap:"wrap",display:"flex"}} role="group" aria-label="Preset remaster">{Object.keys(presets).map(name=><button type="button" key={name} className={preset===name?"active":""} onClick={()=>{setPreset(name);setEq([...presets[name]]);setHarsh(name==="AI Fix");setMud(name==="AI Fix"||name==="Vocal");setAir(false);mark()}}><b>{name}</b></button>)}</div>
  <div className="mix-controls">{bands.map((label,i)=><label key={label}><span><b>{label}</b></span><output>{eq[i].toFixed(1)} dB</output><input aria-label={label} type="range" min="-6" max="6" step="0.5" value={eq[i]} onChange={e=>{setEq(eq.map((v,k)=>k===i?Number(e.target.value):v));setPreset("");mark()}}/></label>)}
  <label><span><b>ĐỘ RỘNG STEREO</b><small>100% là độ rộng gốc</small></span><output>{width}%</output><input type="range" min="0" max="200" step="5" value={width} onChange={e=>{setWidth(Number(e.target.value));mark()}}/></label>
  <label><span><b>LOUDNESS MỤC TIÊU</b></span><output>{target} LUFS</output><input type="range" min="-20" max="-9" step="1" value={target} onChange={e=>{setTarget(Number(e.target.value));mark()}}/></label></div>
  <div className="remaster-options">{([[mud,setMud,"Giảm đục"],[harsh,setHarsh,"Giảm chói / gắt"],[air,setAir,"Thêm độ thoáng"],[glue,setGlue,"Nén động nhẹ"]] as const).map(([value,setter,label])=><label key={label}><input type="checkbox" checked={value} onChange={e=>{setter(e.target.checked);mark()}}/> {label}</label>)}</div>
  </fieldset>
  <p className="quality-note">Bắt đầu với AI Fix, stereo 100% và −14 LUFS. Điều chỉnh theo tai nghe: tăng sáng quá nhiều có thể làm tiếng xì rõ hơn. Công cụ chỉnh chất âm, không tái tạo chi tiết đã mất.</p>
  <button type="button" className="pro-run" disabled={!file||busy} onClick={()=>void run()}>{busy?"ĐANG REMASTER…":"TẠO BẢN REMASTER WAV 24-BIT"}</button>
  <p className="pro-status" aria-live="polite">{status}</p>
  {original&&<div className="pro-result"><b>BẢN GỐC</b><audio ref={beforePlayer} controls src={original} onPlay={()=>afterPlayer.current?.pause()}/></div>}
  {result&&<div className="pro-result"><b>BẢN ĐÃ XỬ LÝ{dirty?" · cài đặt vừa đổi, bấm tạo lại để áp dụng":""}</b><audio ref={afterPlayer} controls src={result} onPlay={()=>beforePlayer.current?.pause()}/><a href={result} download={(file?.name.replace(/\.[^.]+$/,"")||"audio")+"_remastered_24bit.wav"}>TẢI WAV 24-BIT ↓</a></div>}
  <p className="quality-note">Dựa trên <a href="https://github.com/SUP3RMASS1VE/Suno-Song-Remaster" target="_blank" rel="noreferrer">Suno Song Remaster · ISC</a>. Xử lý ngay trên thiết bị sau khi trang đã tải.</p>
 </article>;
}

