import { readFile, writeFile } from "node:fs/promises";

const outputUrl=new URL("../public/charts.json",import.meta.url);
const storefronts=[
  {code:"kr",market:"KR",label:"Apple Music South Korea",shortLabel:"KR TOP"},
  {code:"jp",market:"JP",label:"Apple Music Japan",shortLabel:"JP TOP"},
  {code:"cn",market:"CN",label:"Apple Music China",shortLabel:"CN TOP"},
];

async function requestJson(url,attempts=3){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt+=1){
    try{
      const response=await fetch(url,{headers:{"user-agent":"PulseCharts/1.2"}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      return await response.json();
    }catch(error){
      lastError=error;
      if(attempt<attempts)await new Promise((resolve)=>setTimeout(resolve,attempt*750));
    }
  }
  throw lastError;
}

function artwork(url){return url.replace(//d+xd+bb./,"/600x600bb.")}
function primaryGenre(genres=[]){
  const generic=/^(Music|음악|ミュージック|音乐)$/i;
  return genres.find((genre)=>!generic.test(genre.name))?.name??genres[0]?.name??"Music";
}
function normalize(song,index){
  return{rank:index+1,id:song.id,title:song.name,artist:song.artistName,releaseDate:song.releaseDate,genre:primaryGenre(song.genres),artworkUrl:artwork(song.artworkUrl100),url:song.url,artistUrl:song.artistUrl};
}
function rerank(songs){return songs.slice(0,10).map((song,index)=>({...song,rank:index+1}))}
function makeChart({id,label,shortLabel,market,source="Apple Music",sourceUrl,updatedAt,songs,syncWarning}){
  return{id,label,shortLabel,market,source,sourceUrl,updatedAt,songs:rerank(songs),...(syncWarning?{syncWarning}:{})};
}
function genreText(song){return song.genre??""}
function chinaLocal(song){
  const text=`${song.title} ${song.artist}`;
  const hasHan=/[㐀-鿿]/u.test(text);
  const hasKanaOrHangul=/[぀-ヿ가-힯]/u.test(text);
  return hasHan&&!hasKanaOrHangul;
}
function asiaPulse(datasets){
  const merged=new Map();
  for(const dataset of datasets){
    dataset.songs.forEach((song,index)=>{
      const current=merged.get(song.id)??{song,score:0,bestRank:101};
      current.score+=100-index;
      current.bestRank=Math.min(current.bestRank,index+1);
      merged.set(song.id,current);
    });
  }
  return [...merged.values()].sort((a,b)=>b.score-a.score||a.bestRank-b.bestRank).map((item)=>item.song);
}

let previous={charts:[]};
try{previous=JSON.parse(await readFile(outputUrl,"utf8"))}catch{}

const settled=await Promise.allSettled(storefronts.map(async(storefront)=>{
  const endpoint=`https://rss.marketingtools.apple.com/api/v2/${storefront.code}/music/most-played/100/songs.json`;
  const data=await requestJson(endpoint);
  return{...storefront,endpoint,updatedAt:data.feed.updated,songs:data.feed.results.map(normalize)};
}));

const datasets=settled.map((result,index)=>{
  const storefront=storefronts[index];
  if(result.status==="fulfilled")return result.value;
  const fallback=previous.charts?.find((chart)=>chart.id===`${storefront.code}-apple-music`);
  if(!fallback)throw result.reason;
  return{...storefront,endpoint:fallback.sourceUrl,updatedAt:fallback.updatedAt,songs:fallback.songs,syncWarning:"The source is temporarily unavailable; showing the most recent successful sync."};
});

const kr=datasets.find((item)=>item.market==="KR");
const jp=datasets.find((item)=>item.market==="JP");
const cn=datasets.find((item)=>item.market==="CN");
const charts=[
  makeChart({id:"kr-apple-music",label:"Apple Music South Korea",shortLabel:"KR TOP",market:"KR",sourceUrl:kr.endpoint,updatedAt:kr.updatedAt,songs:kr.songs,syncWarning:kr.syncWarning}),
  makeChart({id:"kr-pop",label:"Korea Pop",shortLabel:"KR POP",market:"KR",sourceUrl:kr.endpoint,updatedAt:kr.updatedAt,songs:kr.songs.filter((song)=>/K-Pop|Pop|팝/i.test(genreText(song))),syncWarning:kr.syncWarning}),
  makeChart({id:"jp-apple-music",label:"Apple Music Japan",shortLabel:"JP TOP",market:"JP",sourceUrl:jp.endpoint,updatedAt:jp.updatedAt,songs:jp.songs,syncWarning:jp.syncWarning}),
  makeChart({id:"jp-pop",label:"Japan Pop",shortLabel:"JP POP",market:"JP",sourceUrl:jp.endpoint,updatedAt:jp.updatedAt,songs:jp.songs.filter((song)=>/J-Pop|Pop|ポップ/i.test(genreText(song))),syncWarning:jp.syncWarning}),
  makeChart({id:"cn-apple-music",label:"Apple Music China",shortLabel:"CN TOP",market:"CN",sourceUrl:cn.endpoint,updatedAt:cn.updatedAt,songs:cn.songs,syncWarning:cn.syncWarning}),
  makeChart({id:"cn-local",label:"China Local Hits",shortLabel:"CN LOCAL",market:"CN",sourceUrl:cn.endpoint,updatedAt:cn.updatedAt,songs:cn.songs.filter(chinaLocal),syncWarning:cn.syncWarning}),
  makeChart({id:"asia-pulse",label:"Asia Cross-Market Pulse",shortLabel:"ASIA",market:"ASIA",source:"Apple Music · Derived",sourceUrl:"https://www.apple.com/apple-music/",updatedAt:new Date().toISOString(),songs:asiaPulse(datasets)}),
];

for(const chart of charts){
  if(chart.songs.length<10){
    const fallback=previous.charts?.find((item)=>item.id===chart.id);
    if(fallback?.songs?.length>=chart.songs.length)chart.songs=rerank(fallback.songs);
  }
}

await writeFile(outputUrl,`${JSON.stringify({generatedAt:new Date().toISOString(),charts},null,2)}
`,"utf8");
console.log(`Synced ${charts.length} charts / ${charts.reduce((sum,chart)=>sum+chart.songs.length,0)} songs.`);