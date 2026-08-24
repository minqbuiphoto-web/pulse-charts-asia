function stripTimedLyrics(value){
  return String(value??"").replace(/^\[[0-9:.]+\]\s*/gm,"").replace(/\n{3,}/g,"\n\n").trim();
}

function normalize(value){
  return String(value??"").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}]+/gu," ").trim();
}

function uniqueTerms(values){
  return [...new Set(values.map((value)=>String(value??"").replace(/\s+/g," ").trim()).filter(Boolean))];
}

function searchTerms(value){
  const original=String(value??"").normalize("NFKC").trim();
  const cjk=original.replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s·&]/gu," ").replace(/\s+/g," ").trim();
  const latin=original.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu," ").replace(/[·|/()[\]{}]+/g," ").replace(/\s+/g," ").trim();
  return uniqueTerms([original,cjk,latin]);
}

function durationScore(itemDuration,targetDuration){
  const found=Number(itemDuration),wanted=Number(targetDuration);
  if(!Number.isFinite(found)||found<=0||!Number.isFinite(wanted)||wanted<=0)return 0;
  const difference=Math.abs(found-wanted);
  if(difference<=3)return 16;
  if(difference<=8)return 12;
  if(difference<=15)return 7;
  if(difference<=30)return 2;
  if(difference<=45)return -6;
  return -16;
}

function scriptLanguage(value){
  const text=String(value??"").replace(/^\[[0-9:.]+\]\s*/gm,"");
  const hangul=(text.match(/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g)??[]).length;
  const kana=(text.match(/[\u3040-\u30ff\u31f0-\u31ff]/g)??[]).length;
  const han=(text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g)??[]).length;
  if(hangul>=4&&hangul>kana*2)return "ko";
  if(kana>=2)return "ja";
  if(han>=4)return "zh";
  return "unknown";
}

function requestedLanguage(value){
  const explicit=String(value??"").toLocaleLowerCase("en");
  return ["ko","zh","ja"].includes(explicit)?explicit:"auto";
}

function languageScore(item,language){
  if(language==="auto")return 0;
  const lyrics=String(item.plainLyrics??"").trim()||String(item.syncedLyrics??"");
  const detected=scriptLanguage(lyrics);
  if(detected===language)return 30;
  if(detected==="unknown")return 0;
  if(language==="ko"&&detected==="ja")return -80;
  if(language==="ko")return -35;
  if(language==="zh"&&detected==="ja")return -60;
  if(language==="zh")return -35;
  if(language==="ja"&&detected==="zh")return -8;
  return -40;
}

function isLanguageCompatible(item,language){
  if(language==="auto")return true;
  const lyrics=String(item.plainLyrics??"").trim()||String(item.syncedLyrics??"");
  const detected=scriptLanguage(lyrics);
  if(language==="ko")return detected!=="ja"&&detected!=="zh";
  if(language==="zh")return detected!=="ja"&&detected!=="ko";
  if(language==="ja")return detected!=="ko";
  return true;
}

function scoreResult(item,title,artist,targetDuration,language="auto"){
  const wantedTitle=normalize(title);
  const wantedArtist=normalize(artist);
  const foundTitle=normalize(item.trackName);
  const foundArtist=normalize(item.artistName);
  let score=0;
  if(foundTitle===wantedTitle)score+=6;else if(foundTitle.includes(wantedTitle)||wantedTitle.includes(foundTitle))score+=3;
  if(wantedArtist&&foundArtist===wantedArtist)score+=4;else if(wantedArtist&&(foundArtist.includes(wantedArtist)||wantedArtist.includes(foundArtist)))score+=2;
  if(item.plainLyrics||item.syncedLyrics)score+=1;
  if(item.syncedLyrics)score+=10;
  score+=durationScore(item.duration,targetDuration);
  score+=languageScore(item,language);
  const edition=normalize(`${item.trackName??""} ${item.albumName??""}`);
  if(language!=="ja"&&/(japanese|japan ver|jp ver|日本語|日本版)/u.test(edition))score-=70;
  return score;
}

function selectBestLyrics(items,title,artist,targetDuration,language="auto"){
  return items
    .filter((item)=>item.plainLyrics||item.syncedLyrics)
    .filter((item)=>isLanguageCompatible(item,language))
    .sort((a,b)=>scoreResult(b,title,artist,targetDuration,language)-scoreResult(a,title,artist,targetDuration,language))[0];
}

export default async function handler(request,response){
  const title=String(Array.isArray(request.query?.title)?request.query.title[0]:request.query?.title??"").trim().slice(0,140);
  const artist=String(Array.isArray(request.query?.artist)?request.query.artist[0]:request.query?.artist??"").trim().slice(0,140);
  const targetDuration=Number(Array.isArray(request.query?.duration)?request.query.duration[0]:request.query?.duration??0);
  const language=requestedLanguage(Array.isArray(request.query?.language)?request.query.language[0]:request.query?.language);
  if(!title)return response.status(400).json({error:"Missing title"});
  console.log("[lyrics-search] lookup",{title,artist,language,targetDuration:Number.isFinite(targetDuration)&&targetDuration>0?targetDuration:null});
  const titleTerms=searchTerms(title);
  const artistTerms=searchTerms(artist);
  const pairs=[
    [titleTerms[0],artistTerms[0]],
    [titleTerms[1],artistTerms[1]??artistTerms[0]],
    [titleTerms[1],artistTerms[0]],
    [titleTerms[0],artistTerms[1]],
  ].filter(([track])=>track);
  const exactAttempts=pairs.map(([track,performer])=>"https://lrclib.net/api/search?"+new URLSearchParams({track_name:track,artist_name:performer??""}));
  const broadAttempts=titleTerms.slice(0,2).map((track,index)=>"https://lrclib.net/api/search?"+new URLSearchParams({q:(track+" "+(artistTerms[index]??artistTerms[0]??"")).trim()}));
  const attempts=[...new Set([...exactAttempts,...broadAttempts])].slice(0,6);
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
  const best=selectBestLyrics(unique,title,artist,targetDuration,language);
  if(!best||scoreResult(best,title,artist,targetDuration,language)<3){console.warn("[lyrics-search] no-result",{title,artist,language,targetDuration});return response.status(404).json({error:language==="ko"?"Không tìm thấy lyric tiếng Hàn phù hợp; hệ thống đã loại bản tiếng Nhật.":"Lyrics not found",requestedLanguage:language});}
  const lyrics=String(best.plainLyrics??"").trim()||stripTimedLyrics(best.syncedLyrics);
  if(!lyrics)return response.status(404).json({error:"Lyrics not found"});
  response.setHeader("Cache-Control","s-maxage=86400, stale-while-revalidate=604800");
  const detectedLanguage=scriptLanguage(lyrics);
  console.log("[lyrics-search] success",{title,artist,language,detectedLanguage,id:best.id,matchedDuration:best.duration,hasSyncedLyrics:Boolean(best.syncedLyrics)});
  return response.status(200).json({lyrics,syncedLyrics:String(best.syncedLyrics??"").trim(),source:"LRCLIB",matchedTrack:best.trackName,matchedArtist:best.artistName,matchedDuration:Number(best.duration)||null,detectedLanguage,requestedLanguage:language});
}

export {durationScore,scriptLanguage,selectBestLyrics};
