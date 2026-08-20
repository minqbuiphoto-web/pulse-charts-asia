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
const durationSeconds=(value)=>{
  const parts=String(value??"").trim().split(":").map(Number);
  if(!parts.length||parts.some((part)=>!Number.isFinite(part)||part<0))return null;
  return parts.reduce((total,part)=>total*60+part,0);
};
const normalize=(value)=>String(value??"").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const LIVE_SOURCE_PATTERN=/(^|\s)(live|concert|fancam|fan cam|stage|festival|showcase|acoustic live|radio live)(\s|$)|직캠|라이브|무대|콘서트|현장|现场|現場|演唱会|演唱會|舞台|直播|音樂節|音乐节/u;
const WRONG_SOURCE_PATTERN=/(^|\s)(cover|karaoke|reaction|teaser|trailer|shorts?|dance practice)(\s|$)|커버|노래방|翻唱|伴奏/u;
const STUDIO_SOURCE_PATTERN=/(official\s*(music\s*)?video|official\s*mv|official\s*audio|audio\s*only|provided\s*to\s*youtube|studio\s*version|studio\s*audio)/;

function videoCandidate(video){
  const videoId=video?.videoId;
  if(!VIDEO_ID_PATTERN.test(videoId))return null;
  return {
    videoId,
    title:runsText(video.title?.runs)||video.title?.simpleText||"",
    channel:runsText(video.ownerText?.runs)||runsText(video.longBylineText?.runs)||"",
    viewCount:numericViews(video.viewCountText?.simpleText||runsText(video.viewCountText?.runs)),
    durationSeconds:durationSeconds(video.lengthText?.simpleText||runsText(video.lengthText?.runs))
  };
}

function isStudioCandidate(candidate){
  const label=normalize(`${candidate.title} ${candidate.channel}`);
  return !LIVE_SOURCE_PATTERN.test(label)&&!WRONG_SOURCE_PATTERN.test(label);
}

function studioScore(candidate,query){
  const title=normalize(candidate.title),channel=normalize(candidate.channel);
  const queryTokens=normalize(query)
    .split(" ")
    .filter((token)=>token.length>1&&!['official','music','video','audio','mv'].includes(token));
  const overlap=[...new Set(queryTokens)].filter((token)=>title.includes(token)||channel.includes(token)).length;
  let score=overlap*16+Math.log10(Math.max(1,candidate.viewCount))*2;
  if(STUDIO_SOURCE_PATTERN.test(title))score+=120;
  if(/official/.test(title))score+=45;
  if(/(^|\s)(mv|m v)(\s|$)/.test(title))score+=35;
  if(/(^|\s)audio(\s|$)/.test(title))score+=30;
  if(/(^|\s)topic(\s|$)/.test(channel))score+=90;
  if(/official/.test(channel))score+=35;
  if(/lyrics?|lyric video/.test(title))score+=8;
  if(/performance|special clip|visualizer/.test(title))score-=25;
  return score;
}

function rankedStudioCandidates(initialData,query){
  const seen=new Set();
  return collectVideos(initialData)
    .map(videoCandidate)
    .filter(Boolean)
    .filter((candidate)=>{if(seen.has(candidate.videoId))return false;seen.add(candidate.videoId);return true;})
    .filter(isStudioCandidate)
    .map((candidate)=>({...candidate,sourceType:STUDIO_SOURCE_PATTERN.test(normalize(candidate.title))||/(^|\s)topic(\s|$)/.test(normalize(candidate.channel))?"studio":"standard",score:studioScore(candidate,query)}))
    .sort((left,right)=>right.score-left.score);
}

export {isStudioCandidate,rankedStudioCandidates};


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
    const initialData=extractInitialData(html);
    const rankedCandidates=rankedStudioCandidates(initialData,query);
    if(mode==="candidates"){
      const candidates=rankedCandidates.slice(0,20).map(({score,...candidate})=>candidate);
      response.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
      if(!candidates.length)return response.status(404).json({error:"No studio video candidates found"});
      return response.status(200).json({query,candidates});
    }
    const selected=rankedCandidates[0];
    const videoId=selected?.videoId;
    if(!videoId){console.warn("[youtube-search] no-studio-result",{query});return response.status(404).json({error:"No studio video found"});}
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
    console.log("[youtube-search] success",{query,videoId,viewCount,durationSeconds:selected.durationSeconds,title:selected.title,channel:selected.channel,sourceType:selected.sourceType});
    return response.status(200).json({videoId,viewCount,durationSeconds:selected.durationSeconds,title:selected.title,channel:selected.channel,sourceType:selected.sourceType});
  }catch(error){
    console.error("[youtube-search] failed",{query,error:String(error)});
    return response.status(502).json({error:"Video lookup failed"});
  }
}
