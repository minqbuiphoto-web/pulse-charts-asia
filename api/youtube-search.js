const VIDEO_ID_PATTERN=/^[A-Za-z0-9_-]{11}$/;

function extractInitialData(html){
  const markers=["var ytInitialData = ","ytInitialData = "];
  for(const marker of markers){
    const markerIndex=html.indexOf(marker); if(markerIndex<0)continue;
    const start=html.indexOf("{",markerIndex+marker.length); if(start<0)continue;
    let depth=0,inString=false,escaped=false;
    for(let index=start;index<html.length;index+=1){
      const char=html[index];
      if(inString){if(escaped)escaped=false;else if(char==="\\")escaped=true;else if(char==='"')inString=false;continue;}
      if(char==='"'){inString=true;continue;}
      if(char==="{")depth+=1;else if(char==="}"&&--depth===0){try{return JSON.parse(html.slice(start,index+1));}catch{return null;}}
    }
  }
  return null;
}
function collectVideos(value,output=[]){if(!value||typeof value!=="object")return output;if(value.videoRenderer)output.push(value.videoRenderer);for(const child of Object.values(value))collectVideos(child,output);return output;}
const runsText=(runs)=>runs?.map((item)=>item.text).join("")??"";
const numericViews=(value)=>Number(String(value??"").replaceAll(",","").match(/([0-9]+)/)?.[1]??0);


export default async function handler(request,response){
  const rawQuery=Array.isArray(request.query?.q)?request.query.q[0]:request.query?.q;
  const query=String(rawQuery??"").trim().slice(0,180);
  const mode=Array.isArray(request.query?.mode)?request.query.mode[0]:request.query?.mode;
  if(!query){return response.status(400).json({error:"Missing q"});}
  console.log("[youtube-search] lookup",{query});
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),8500);
    const target="https://www.youtube.com/results?search_query="+encodeURIComponent(query);
    const upstream=await fetch(target,{headers:{"user-agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36","accept-language":"en-US,en;q=0.9"},signal:controller.signal});
    clearTimeout(timer);
    if(!upstream.ok){console.error("[youtube-search] upstream",{status:upstream.status});return response.status(502).json({error:"YouTube search unavailable"});}
    const html=await upstream.text();
    if(mode==="candidates"){
      const initialData=extractInitialData(html); const seen=new Set();
      const candidates=collectVideos(initialData).flatMap((video)=>{if(!VIDEO_ID_PATTERN.test(video.videoId)||seen.has(video.videoId))return [];seen.add(video.videoId);return [{videoId:video.videoId,title:runsText(video.title?.runs),channel:runsText(video.ownerText?.runs),viewCount:numericViews(video.viewCountText?.simpleText)}];}).slice(0,20);
      response.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
      if(!candidates.length)return response.status(404).json({error:"No video candidates found"});
      return response.status(200).json({query,candidates});
    }
    const ids=[...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map((match)=>match[1]);
    const videoId=ids.find((id,index)=>VIDEO_ID_PATTERN.test(id)&&ids.indexOf(id)===index);
    if(!videoId){console.warn("[youtube-search] no-result",{query});return response.status(404).json({error:"No video found"});}
    let viewCount=null;
    try{
      const statsResponse=await fetch("https://returnyoutubedislikeapi.com/votes?videoId="+encodeURIComponent(videoId),{headers:{accept:"application/json"},signal:AbortSignal.timeout(5000)});
      if(statsResponse.ok){
        const stats=await statsResponse.json();
        const numericViews=Number(stats?.viewCount);
        if(Number.isFinite(numericViews)&&numericViews>=0)viewCount=numericViews;
      }
    }catch(error){console.warn("[youtube-search] stats-unavailable",{videoId,error:String(error)});}
    response.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
    console.log("[youtube-search] success",{query,videoId,viewCount});
    return response.status(200).json({videoId,viewCount});
  }catch(error){
    console.error("[youtube-search] failed",{query,error:String(error)});
    return response.status(502).json({error:"Video lookup failed"});
  }
}
