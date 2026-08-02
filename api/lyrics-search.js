function stripTimedLyrics(value){
  return String(value??"").replace(/^\[[0-9:.]+\]\s*/gm,"").replace(/\n{3,}/g,"\n\n").trim();
}

function normalize(value){
  return String(value??"").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}

function scoreResult(item,title,artist){
  const wantedTitle=normalize(title);
  const wantedArtist=normalize(artist);
  const foundTitle=normalize(item.trackName);
  const foundArtist=normalize(item.artistName);
  let score=0;
  if(foundTitle===wantedTitle)score+=6;else if(foundTitle.includes(wantedTitle)||wantedTitle.includes(foundTitle))score+=3;
  if(foundArtist===wantedArtist)score+=4;else if(foundArtist.includes(wantedArtist)||wantedArtist.includes(foundArtist))score+=2;
  if(item.plainLyrics||item.syncedLyrics)score+=1;
  return score;
}

export default async function handler(request,response){
  const title=String(Array.isArray(request.query?.title)?request.query.title[0]:request.query?.title??"").trim().slice(0,140);
  const artist=String(Array.isArray(request.query?.artist)?request.query.artist[0]:request.query?.artist??"").trim().slice(0,140);
  if(!title)return response.status(400).json({error:"Missing title"});
  console.log("[lyrics-search] lookup",{title,artist});
  const exact=new URLSearchParams({track_name:title,artist_name:artist});
  const broad=new URLSearchParams({q:(title+" "+artist).trim()});
  const attempts=["https://lrclib.net/api/search?"+exact,"https://lrclib.net/api/search?"+broad];
  const batches=await Promise.all(attempts.map(async(url)=>{
    try{
      const upstream=await fetch(url,{headers:{"user-agent":"PulseCharts/1.0 (https://pulse-charts-asia.vercel.app)"},signal:AbortSignal.timeout(6500)});
      if(!upstream.ok)return [];
      const payload=await upstream.json();
      return Array.isArray(payload)?payload:[];
    }catch(error){
      console.warn("[lyrics-search] attempt-failed",{title,error:String(error)});
      return [];
    }
  }));
  const results=batches.flat();
  const unique=[...new Map(results.map((item)=>[item.id??(item.trackName+"::"+item.artistName),item])).values()];
  const best=unique.filter((item)=>item.plainLyrics||item.syncedLyrics).sort((a,b)=>scoreResult(b,title,artist)-scoreResult(a,title,artist))[0];
  if(!best||scoreResult(best,title,artist)<3){console.warn("[lyrics-search] no-result",{title,artist});return response.status(404).json({error:"Lyrics not found"});}
  const lyrics=String(best.plainLyrics??"").trim()||stripTimedLyrics(best.syncedLyrics);
  if(!lyrics)return response.status(404).json({error:"Lyrics not found"});
  response.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
  console.log("[lyrics-search] success",{title,artist,id:best.id});
  return response.status(200).json({lyrics,source:"LRCLIB",matchedTrack:best.trackName,matchedArtist:best.artistName});
}
