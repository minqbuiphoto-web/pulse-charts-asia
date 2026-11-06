import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer(async(req,res)=>{try{const name=req.url.slice(1);if(!/^[\w]+\.js$/.test(name)){res.end('<html></html>');return}res.setHeader('Content-Type','text/javascript');res.end(await readFile(new URL('../app/audio-lab/remaster/'+name,import.meta.url)))}catch{res.statusCode=404;res.end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
try{
 const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async()=>{
  const {remasterFile}=await import('/engine.js');const {encodeWAV}=await import('/wavEncoder.js');
  const reports=[];
  for(const channels of [1,2]){
   const input=new AudioBuffer({numberOfChannels:channels,length:44100*4,sampleRate:44100});
   for(let c=0;c<channels;c++){const d=input.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=0.2*Math.sin(2*Math.PI*(440+c*120)*i/44100)+0.03*Math.sin(2*Math.PI*6000*i/44100)}
   const file=new File([encodeWAV(input,{bitDepth:24})],'signal.wav',{type:'audio/wav'});
   const out=await remasterFile(file,{eqLow:0,eqLowMid:-2,eqMid:1,eqHighMid:-1,eqHigh:0,cutMud:true,tameHarsh:true,stereoWidth:100,targetLufs:-14});
   const bytes=await out.blob.arrayBuffer(),view=new DataView(bytes);
   const ctx=new AudioContext();const decoded=await ctx.decodeAudioData(bytes.slice(0));await ctx.close();
   let max=0;for(let ch=0;ch<decoded.numberOfChannels;ch++)for(const n of decoded.getChannelData(ch)){if(!Number.isFinite(n))throw Error('nonfinite sample');max=Math.max(max,Math.abs(n))}
   reports.push({channels,depth:view.getUint16(34,true),duration:decoded.duration,after:out.after,max});
  }
  return reports;
 });
 for(const r of result){assert.equal(r.depth,24);assert.ok(Math.abs(r.duration-4)<0.01);assert.ok(Number.isFinite(r.after));assert.ok(r.max>0&&r.max<=0.892)}
 console.log('PASS mono/stereo real browser DSP, finite samples, duration, peak ceiling and 24-bit WAV',result);
}finally{await browser.close();server.close()}
