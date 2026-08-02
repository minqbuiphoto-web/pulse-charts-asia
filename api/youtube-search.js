const VIDEO_ID_PATTERN=/^[A-Za-z0-9_-]{11}$/;

export default async function handler(request,response){
  const rawQuery=Array.isArray(request.query?.q)?request.query.q[0]:request.query?.q;
  const query=String(rawQuery??"").trim().slice(0,180);
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
