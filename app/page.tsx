"use client";

import { useEffect, useMemo, useState } from "react";
import mainSnapshot from "./charts-main.json";
import ostSnapshot from "./charts-ost.json";
import videoLinks from "./video-links.json";

type Market="KR"|"JP"|"CN";
type Song={ rank:number; id:string; title:string; artist:string; releaseDate:string; genre:string; artworkUrl:string; url:string; artistUrl:string };
type Chart={ id:string; label:string; shortLabel:string; market:Market; source:string; sourceUrl:string; updatedAt:string; syncWarning?:string; songs:Song[] };
type ChartData={ generatedAt:string; charts:Chart[] };
const initialData={ generatedAt:mainSnapshot.generatedAt, charts:[...mainSnapshot.charts,...ostSnapshot.charts] } as ChartData;

const youtubeVideos:Record<string,string>={
  "kr-pop-1":"phuiiNCxRMg","kr-pop-2":"Q3K0TOvTOno","kr-pop-3":"Vk5-c_v4gMU","kr-pop-4":"xfqBQ2XhBCgy",
  "kr-pop-6":"nFYwcndNuOY","kr-pop-7":"ft70sAYrFyY","kr-pop-8":"hVAc1Vf2ITU","kr-pop-9":"07EzMbVH3QE","kr-pop-10":"rTKqSmX9XhQ",
  "kr-ballad-1":"5_n6t9G2TUQ","kr-ballad-2":"JleoAppaxi0","kr-ballad-6":"EIz09kLzN9k","kr-ballad-7":"hLvWy2b857I",
  "kr-ballad-9":"QU9c0053UAU","kr-ballad-10":"eQNHDV7lKgE","jp-billboard-1":"mLW35YMzELE","jp-billboard-2":"ZRtdQ81jPUQ",
  "jp-billboard-4":"5yb2N3pnztU","jp-billboard-7":"oZpYEEcvu5I","jp-billboard-8":"kzZ6KXDM1RI","jp-billboard-9":"UM9XNpgrqVk",
  "jp-billboard-10":"hN5MBlGv2Ac","kr-ost-6":"pcKR0LPwoYs","kr-ost-7":"lj8TV9q59P4","jp-ost-2":"a2GujJZfXpg",
  "jp-ost-3":"n89SKAymNfA","jp-ost-5":"4DxL6IKmXx4","jp-ost-6":"O1bhZgkC4Gw","jp-ost-7":"Xs0Lxif1u9E",
  "jp-ost-9":"zuoVd2QNxJo","cn-qq-2":"XKuL5xaKZHM","cn-ost-1":"pb-kc6DWIDI","cn-ost-8":"Hlp8XD0R5qo","cn-ost-10":"-aMdBA00Ijc",
};

type LookupStatus="idle"|"loading"|"ready"|"missing"|"error";
type LyricsResult={ plainLyrics?:string|null; syncedLyrics?:string|null; trackName?:string; artistName?:string };
const pipedInstances=["https://pipedapi.kavin.rocks","https://pipedapi.adminforge.de","https://pipedapi.reallyaweso.me"];
const invidiousInstances=["https://inv.nadeko.net","https://invidious.nerdvpn.de"];
const youtubeTracks=videoLinks as Record<string,string>;

function trackKey(song:Pick<Song,"title"|"artist">){
  return `${song.title}::${song.artist}`.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g," ").trim();
}

function cleanSyncedLyrics(value:string){
  return value.replace(/^\[[0-9:.]+\]\s*/gm,"").replace(/\n{3,}/g,"\n\n").trim();
}

function videoIdFromResult(item:any){
  const candidate=String(item?.id??item?.url??item?.videoId??"");
  const match=candidate.match(/(?:v=|youtu\.be\/|embed\/)?([\w-]{11})(?:\b|$)/);
  return match?.[1]??"";
};

const marketLabels:{ id:Market|"ALL"; label:string; code:string }[]=[
  { id:"ALL",label:"All markets",code:"ALL" },{ id:"KR",label:"South Korea",code:"KR" },
  { id:"JP",label:"Japan",code:"JP" },{ id:"CN",label:"Mainland China",code:"CN" },
];

function formatDate(value:string,includeTime=false) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US",{ day:"2-digit",month:"short",year:"numeric",...(includeTime?{hour:"2-digit",minute:"2-digit"}:{}) }).format(date);
}

export default function Home(){
  const [data]=useState<ChartData>(initialData);
  const [activeId,setActiveId]=useState(initialData.charts[0]?.id??"");
  const [market,setMarket]=useState<Market|"ALL">("ALL");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<Song|null>(initialData.charts[0]?.songs[0]??null);
  const [playingId,setPlayingId]=useState("");
  const [resolvedVideos,setResolvedVideos]=useState<Record<string,string>>({});
  const [customVideos,setCustomVideos]=useState<Record<string,string>>({});
  const [videoLink,setVideoLink]=useState("");
  const [videoStatus,setVideoStatus]=useState<LookupStatus>("idle");
  const [lyrics,setLyrics]=useState("");
  const [lyricsStatus,setLyricsStatus]=useState<LookupStatus>("idle");

  useEffect(()=>{ try{setCustomVideos(JSON.parse(localStorage.getItem("pulse-custom-videos")??"{}"));}catch{} },[]);
  const charts=useMemo(()=>data?.charts.filter((chart)=>market==="ALL"||chart.market===market)??[],[data,market]);
  useEffect(()=>{ if(!charts.some((chart)=>chart.id===activeId)){ const next=charts[0];setActiveId(next?.id??"");setSelected(next?.songs[0]??null); } },[charts,activeId]);
  const active=data?.charts.find((chart)=>chart.id===activeId)??charts[0];
  const songs=useMemo(()=>{ const needle=query.trim().toLocaleLowerCase("en"); if(!active) return []; if(!needle) return active.songs; return active.songs.filter((song)=>`${song.title} ${song.artist} ${song.genre}`.toLocaleLowerCase("en").includes(needle)); },[active,query]);
  const resetTrackTools=()=>{ setPlayingId("");setVideoStatus("idle");setVideoLink("");setLyrics("");setLyricsStatus("idle"); };
  const chooseChart=(chart:Chart)=>{ setActiveId(chart.id); setSelected(chart.songs[0]??null); resetTrackTools(); };
  const displaySong=selected??active?.songs[0]??null;
  const currentTrackKey=displaySong?trackKey(displaySong):"";
  const videoId=displaySong?(youtubeTracks[currentTrackKey]??customVideos[currentTrackKey]??youtubeVideos[displaySong.id]??resolvedVideos[currentTrackKey]):undefined;
  const youtubeUrl=videoId?`https://www.youtube.com/watch?v=${videoId}`:displaySong?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${displaySong.title} ${displaySong.artist} official music video`)}`:"#";
  const lyricsSearchUrl=displaySong?`https://genius.com/search?q=${encodeURIComponent(`${displaySong.title} ${displaySong.artist}`)}`:"#";
  const selectSong=(song:Song)=>{ setSelected(song); resetTrackTools(); };

  const resolveVideo=async(song:Song)=>{
    const key=trackKey(song);
    const cached=youtubeTracks[key]??customVideos[key]??youtubeVideos[song.id]??resolvedVideos[key];
    if(cached)return cached;
    setVideoStatus("loading");
    const query=encodeURIComponent(`${song.title} ${song.artist} official music video`);
    try{
      const response=await fetch(`/api/youtube-search?q=${query}`,{signal:AbortSignal.timeout(10000)});
      if(response.ok){
        const payload=await response.json();
        const id=videoIdFromResult(payload);
        if(id){setResolvedVideos((current)=>({...current,[key]:id}));setVideoStatus("ready");return id;}
      }
    }catch{}
    for(const instance of pipedInstances){
      try{
        const response=await fetch(`${instance}/search?q=${query}&filter=videos`,{signal:AbortSignal.timeout(7000)});
        if(!response.ok)continue;
        const payload=await response.json();
        const items=Array.isArray(payload)?payload:(payload?.items??[]);
        const id=items.map(videoIdFromResult).find(Boolean);
        if(id){setResolvedVideos((current)=>({...current,[key]:id}));setVideoStatus("ready");return id;}
      }catch{}
    }
    for(const instance of invidiousInstances){
      try{
        const response=await fetch(`${instance}/api/v1/search?q=${query}&type=video`,{signal:AbortSignal.timeout(7000)});
        if(!response.ok)continue;
        const items=await response.json();
        const id=Array.isArray(items)?items.map(videoIdFromResult).find(Boolean):"";
        if(id){setResolvedVideos((current)=>({...current,[key]:id}));setVideoStatus("ready");return id;}
      }catch{}
    }
    setVideoStatus("missing");
    return "";
  };

  const playTrack=async()=>{
    if(!displaySong)return;
    const id=videoId??await resolveVideo(displaySong);
    if(id)setPlayingId(displaySong.id);
  };

  const saveVideoLink=()=>{
    if(!displaySong)return;
    const id=videoIdFromResult({url:videoLink.trim()});
    if(!id){setVideoStatus("error");return;}
    const key=trackKey(displaySong);
    const next={...customVideos,[key]:id};
    setCustomVideos(next);setResolvedVideos((current)=>({...current,[key]:id}));
    localStorage.setItem("pulse-custom-videos",JSON.stringify(next));
    setVideoStatus("ready");setPlayingId(displaySong.id);setVideoLink("");
  };

  const loadLyrics=async()=>{
    if(!displaySong)return;
    setLyricsStatus("loading");setLyrics("");
    try{
      const params=new URLSearchParams({track_name:displaySong.title,artist_name:displaySong.artist});
      const response=await fetch(`https://lrclib.net/api/search?${params}`,{signal:AbortSignal.timeout(9000)});
      if(!response.ok)throw new Error("Lyrics lookup failed");
      const results=await response.json() as LyricsResult[];
      const match=results.find((item)=>item.plainLyrics||item.syncedLyrics);
      const lyricText=match?.plainLyrics?.trim()||(match?.syncedLyrics?cleanSyncedLyrics(match.syncedLyrics):"");
      if(lyricText){setLyrics(lyricText);setLyricsStatus("ready");}else setLyricsStatus("missing");
    }catch{setLyricsStatus("error");}
  };

  const moveTrack=(step:number)=>{ if(!active||!displaySong)return; const index=active.songs.findIndex((song)=>song.id===displaySong.id); const next=active.songs[index+step]; if(next)selectSong(next); };
  const heroCovers=active?.songs.slice(0,3)??[];

  return <main>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Pulse Charts — back to top"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></a>
      <nav><a href="#charts">Charts</a><a href="#about">About</a></nav>
      <div className="live-pill"><span/> {data.charts.length} CHARTS · 3 MARKETS</div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy">
        <p className="kicker"><span>01</span> THE SOUND OF RIGHT NOW</p>
        <h1>Turn up<br/><em>what’s next.</em></h1>
        <p>Official national rankings plus current OST and ballad discovery across South Korea, Japan and Mainland China.</p>
        <a href="#charts" className="hero-cta"><span>▶</span> EXPLORE ALL {data.charts.length} CHARTS</a>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orb"/>
        <div className="vinyl"><i/><b>PULSE<br/>CHARTS</b></div>
        <div className="cover-stack">
          {heroCovers.map((song,index)=><span className="cover-card" key={song.id} style={{"--i":index} as React.CSSProperties}><b>{String(song.rank).padStart(2,"0")}</b><i>{song.title.slice(0,2)}</i></span>)}
          {!heroCovers.length&&<div className="cover-placeholder">LIVE<br/>TOP 10</div>}
        </div>
        <div className="waveform">{Array.from({length:18},(_,index)=><i key={index}/>)}</div>
      </div>
      <div className="hero-index">KOREA / JAPAN / CHINA</div>
    </section>

    <section className="chart-bar" id="charts">
      <div className="market-filters" aria-label="Filter by market">{marketLabels.map((item)=><button key={item.id} className={market===item.id?"active":""} onClick={()=>setMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div>
      <label className="search-box"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search tracks, artists, chart entries"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</label>
    </section>

    <section className="chart-tabs" aria-label="Choose a chart">
      <p>ALL {data.charts.length} MUSIC CHARTS</p>
      <div>{charts.map((chart)=><button key={chart.id} className={active?.id===chart.id?"active":""} onClick={()=>chooseChart(chart)}><span>{chart.shortLabel}</span>{chart.label}</button>)}</div>
    </section>

    <section className="workspace">
      <div className="chart-panel">
        <div className="panel-heading">
          <div><p className="kicker"><span>02</span> CURRENT TOP 10</p><h2>{active?.label??"Loading chart"}</h2></div>
          {active&&<div className="sync-time"><span className="status-dot"/>CHART PERIOD<br/><b>{formatDate(active.updatedAt)}</b></div>}
        </div>
        <div className="column-head"><span>#</span><span>TRACK</span><span>{active?.id.includes("trending")?"LISTENING SIGNAL":"SCORE"}</span><span>{active?.id.includes("trending")?"RELEASED":"MARKET"}</span><span/></div>
        {active?.syncWarning&&<div className="sync-warning">{active.syncWarning}</div>}
        {songs.length===0&&<div className="empty-state">No matching tracks found.</div>}
        <div className="song-list" aria-live="polite">{songs.map((song)=><button key={song.id} className={`song-row ${displaySong?.id===song.id?"selected":""}`} onClick={()=>selectSong(song)}>
          <span className="rank">{String(song.rank).padStart(2,"0")}</span>
          <span className="track"><span className="art cover-art"><b>{String(song.rank).padStart(2,"0")}</b><i>▶</i></span><span className="song-main"><b>{song.title}</b><small>{song.artist}</small></span></span>
          <span className="genre">{song.genre}</span><span className="released">{song.releaseDate}</span><span className="row-action">•••</span>
        </button>)}</div>
      </div>

      <aside className={`player-panel ${displaySong?"has-song":""}`}>
        {displaySong?<><div className="player-glow token-glow"/>
          <div className="player-head"><span>YOUTUBE PLAYER / FREE</span><span>#{displaySong.rank}</span></div>
          {videoId&&playingId===displaySong.id?<div className="youtube-player"><iframe src={`https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`} title={`${displaySong.title} by ${displaySong.artist}`} allow="autoplay; encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/></div>:<button className="player-cover cover-art player-token" onClick={playTrack} disabled={videoStatus==="loading"}><strong>{String(displaySong.rank).padStart(2,"0")}</strong><em>{videoStatus==="loading"?"FINDING VIDEO...":videoId?"PLAY HERE / YOUTUBE":videoStatus==="missing"?"OPEN SEARCH BELOW":"FIND & PLAY HERE"}</em><span className="playing-badge"><i/><i/><i/><i/></span></button>}
          <div className="player-info"><p>{active?.source}</p><h3>{displaySong.title}</h3><span>{displaySong.artist}</span></div>
          <div className="progress"><span/><i>CHART SCORE</i><b>{displaySong.genre}</b></div>
          <div className="transport"><button onClick={()=>moveTrack(-1)} disabled={displaySong.rank===1}>PREV</button><button onClick={playTrack} disabled={videoStatus==="loading"}>{videoStatus==="loading"?"SEARCHING...":"PLAY HERE"}</button><button onClick={()=>moveTrack(1)} disabled={displaySong.rank===active?.songs.length}>NEXT</button></div>
          {videoStatus==="missing"&&<p className="media-note">No embeddable result was found automatically. Use YouTube search and choose the official upload.</p>}
          {videoStatus==="error"&&<p className="media-note">That link is not a valid YouTube video URL or 11-character video ID.</p>}
          <details className="video-link-editor"><summary>UPDATE YOUTUBE LINK</summary><div><input value={videoLink} onChange={(event)=>setVideoLink(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")saveVideoLink();}} placeholder="Paste YouTube URL or video ID"/><button onClick={saveVideoLink} disabled={!videoLink.trim()}>USE VIDEO</button></div><small>Saved free on this browser for the same track and artist.</small></details>
          <div className="player-actions"><a className="primary" href={displaySong.url} target="_blank" rel="noreferrer">CHART SOURCE</a><a href={youtubeUrl} target="_blank" rel="noreferrer">{videoId?"OPEN YOUTUBE":"SEARCH YOUTUBE"}</a></div>
          <div className="lyrics-tools"><button onClick={loadLyrics} disabled={lyricsStatus==="loading"}>{lyricsStatus==="loading"?"LOADING LYRICS...":lyricsStatus==="ready"?"REFRESH LYRICS":"SHOW LYRICS"}</button><a href={lyricsSearchUrl} target="_blank" rel="noreferrer">LYRICS SEARCH</a></div>
          {lyricsStatus==="ready"&&<section className="lyrics-panel" aria-live="polite"><div><b>LYRICS</b><a href="https://lrclib.net" target="_blank" rel="noreferrer">via LRCLIB</a></div><pre>{lyrics}</pre></section>}
          {(lyricsStatus==="missing"||lyricsStatus==="error")&&<p className="media-note">Lyrics are not available from the free library for this track. Try Lyrics Search.</p>}
          <dl><div><dt>MARKET</dt><dd>{active?.label}</dd></div><div><dt>{active?.id.includes("trending")?"RELEASED":"MARKET CODE"}</dt><dd>{displaySong.releaseDate}</dd></div></dl>
        </>:<div className="player-empty"><div className="vinyl mini"><i/></div><p>SELECT A TRACK</p></div>}
      </aside>
    </section>

    <footer id="about"><div className="brand footer-brand"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></div><p>Official rankings + 3–6 month trending windows.<br/>Built for current music discovery across Asia.</p><div>{active?<><a href={active.sourceUrl} target="_blank" rel="noreferrer">SOURCE: {active.source} ↗</a><span>PERIOD {formatDate(active.updatedAt)}</span></>:"CONNECTING TO DATA"}</div></footer>
  </main>;
}

