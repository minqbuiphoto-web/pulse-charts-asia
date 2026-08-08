"use client";

// OST chart dataset build: 2026-08-04

import Link from "next/link";
import { useEffect, useState } from "react";
import mainSnapshot from "./charts-main.json";
import ostSnapshot from "./charts-ost.json";
import classicsSnapshot from "./charts-classics.json";
import rnbSnapshot from "./charts-rnb.json";
import videoLinks from "./video-links.json";
import ValidatedYouTubePlayer,{ type YouTubeFailure } from "./validated-youtube-player";

type Market="KR"|"JP"|"CN";
type Song={ rank:number; id:string; title:string; artist:string; releaseDate:string; genre:string; artworkUrl:string; url:string; artistUrl:string; videoId?:string; viewCount?:number; durationSeconds?:number; filmTitle?:string; album?:string; albumTrackCount?:number; albumTracks?:Song[] };
type Chart={ id:string; label:string; shortLabel:string; market:Market; source:string; sourceUrl:string; updatedAt:string; syncWarning?:string; songs:Song[] };
type ChartData={ generatedAt:string; charts:Chart[] };
const initialData={ generatedAt:mainSnapshot.generatedAt, charts:[...mainSnapshot.charts,...ostSnapshot.charts,...classicsSnapshot.charts,...rnbSnapshot.charts] } as ChartData;

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
const youtubeTracks=videoLinks as Record<string,string>;

function albumKey(song:Song){
  return (song.album??song.filmTitle??`${song.title}::${song.artist}`).normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g," ").trim();
}

function trackKey(song:Pick<Song,"title"|"artist">){
  return `${song.title}::${song.artist}`.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g," ").trim();
}

function videoIdFromResult(item:unknown){
  const result=item as { id?:unknown; url?:unknown; videoId?:unknown }|null;
  const candidate=String(result?.id??result?.url??result?.videoId??"");
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

function formatViewCount(value:number){
  return new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1}).format(value)+" views";
}

export default function Home(){
  const data=initialData;
  const [activeId,setActiveId]=useState(initialData.charts[0]?.id??"");
  const [market,setMarket]=useState<Market|"ALL">("ALL");
  const [query,setQuery]=useState("");
  const [ostView,setOstView]=useState<"albums"|"tracks">("albums");
  const [selected,setSelected]=useState<Song|null>(initialData.charts[0]?.songs[0]??null);
  const [playingId,setPlayingId]=useState("");
  const [rejectedVideos,setRejectedVideos]=useState<string[]>([]);
  const [videoIssue,setVideoIssue]=useState("");
  const [resolvedVideos,setResolvedVideos]=useState<Record<string,string>>({});
  const [customVideos,setCustomVideos]=useState<Record<string,string>>({});
  const [videoLink,setVideoLink]=useState("");
  const [videoStatus,setVideoStatus]=useState<LookupStatus>("idle");
  const [lyrics,setLyrics]=useState("");
  const [syncedLyrics,setSyncedLyrics]=useState("");
  const [lyricsSource,setLyricsSource]=useState("");
  const [customLyrics,setCustomLyrics]=useState<Record<string,string>>({});
  const [lyricsCache,setLyricsCache]=useState<Record<string,{lyrics:string;syncedLyrics?:string;source:string}>>({});
  const [lyricsDraft,setLyricsDraft]=useState("");
  const [lyricsStatus,setLyricsStatus]=useState<LookupStatus>("idle");

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      try{
        setCustomVideos(JSON.parse(localStorage.getItem("pulse-custom-videos")??"{}"));
        setResolvedVideos(JSON.parse(localStorage.getItem("pulse-resolved-videos")??"{}"));
        setCustomLyrics(JSON.parse(localStorage.getItem("pulse-custom-lyrics")??"{}"));
        setLyricsCache(JSON.parse(localStorage.getItem("pulse-lyrics-cache")??"{}"));
        const rejected=JSON.parse(localStorage.getItem("pulse-rejected-youtube-videos")??"[]");
        if(Array.isArray(rejected))setRejectedVideos(rejected.filter((id):id is string=>typeof id==="string").slice(-100));
      }catch{}
    },0);
    return()=>window.clearTimeout(timer);
  },[]);
  const charts=data.charts.filter((chart)=>market==="ALL"||chart.market===market);
  const active=charts.find((chart)=>chart.id===activeId)??charts[0];
  const needle=query.trim().toLocaleLowerCase("en");
  const isOstChart=Boolean(active?.id.includes("ost-trending"));
  const filteredTracks=!active?[]:!needle?active.songs:active.songs.filter((song)=>`${song.title} ${song.artist} ${song.genre} ${song.filmTitle??""} ${song.album??""} ${(song.albumTracks??[]).map((track)=>`${track.title} ${track.artist}`).join(" ")}`.toLocaleLowerCase("en").includes(needle));
  const albumGroups=filteredTracks.reduce<Map<string,Song[]>>((groups,song)=>{const key=albumKey(song);groups.set(key,[...(groups.get(key)??[]),song]);return groups;},new Map());
  const playableAlbumCount=(tracks:Song[])=>new Set([...tracks,...(tracks[0]?.albumTracks??[])].filter((song)=>song.videoId&&Number(song.durationSeconds)>=120&&Number(song.durationSeconds)<=900).map((song)=>song.videoId)).size;
  const playableAlbumGroups=[...albumGroups.values()].map((tracks)=>({tracks,count:playableAlbumCount(tracks)})).filter((group)=>group.count>0);
  const songs=isOstChart&&ostView==="albums"?playableAlbumGroups.map(({tracks,count})=>({...tracks[0],albumTrackCount:count})):filteredTracks;
  const ostTrackTotal=isOstChart?playableAlbumGroups.reduce((total,group)=>total+group.count,0):0;
  const resetTrackTools=()=>{ setPlayingId("");setVideoIssue("");setVideoStatus("idle");setVideoLink("");setLyrics("");setSyncedLyrics("");setLyricsSource("");setLyricsDraft("");setLyricsStatus("idle"); };
  const chooseChart=(chart:Chart)=>{ setActiveId(chart.id);setQuery("");setOstView("albums");setSelected(chart.songs[0]??null);resetTrackTools(); };
  const chooseMarket=(nextMarket:Market|"ALL")=>{
    setMarket(nextMarket);setQuery("");
    const visible=data.charts.filter((chart)=>nextMarket==="ALL"||chart.market===nextMarket);
    if(!visible.some((chart)=>chart.id===activeId)&&visible[0])chooseChart(visible[0]);
  };
  const displaySong=selected??active?.songs[0]??null;
  const selectedAlbumRoot=isOstChart&&displaySong&&active?active.songs.find((song)=>albumKey(song)===albumKey(displaySong)):undefined;
  const selectedAlbumTracks=isOstChart&&displaySong&&active?[...new Map([...active.songs.filter((song)=>albumKey(song)===albumKey(displaySong)),...(selectedAlbumRoot?.albumTracks??[])].map((song)=>[trackKey(song),song])).values()].filter((song)=>song.videoId&&Number(song.durationSeconds)>=120&&Number(song.durationSeconds)<=900).sort((a,b)=>(b.viewCount??0)-(a.viewCount??0)).slice(0,5):[];
  const trackSequence=isOstChart&&ostView==="albums"?songs:(active?.songs??[]);
  const playbackSequence=isOstChart&&ostView==="albums"&&selectedAlbumTracks.length>0?selectedAlbumTracks:trackSequence;
  const trackPosition=displaySong?playbackSequence.findIndex((song)=>song.id===displaySong.id):-1;
  const currentTrackKey=displaySong?trackKey(displaySong):"";
  const knownVideoIds=displaySong?[customVideos[currentTrackKey],resolvedVideos[currentTrackKey],displaySong.videoId,youtubeTracks[currentTrackKey],youtubeVideos[displaySong.id]].filter((id):id is string=>Boolean(id)):[];
  const rawVideoId=knownVideoIds.find((id)=>!rejectedVideos.includes(id));
  const videoId=rawVideoId;
  const youtubeUrl=videoId?`https://www.youtube.com/watch?v=${videoId}`:displaySong?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${displaySong.title} ${displaySong.artist} official music video`)}`:"#";
  const lyricsSearchUrl=displaySong?`https://genius.com/search?q=${encodeURIComponent(`${displaySong.title} ${displaySong.artist}`)}`:"#";
  const musixmatchSearchUrl=displaySong?`https://www.musixmatch.com/search/${encodeURIComponent(`${displaySong.title} ${displaySong.artist}`)}`:"#";
  const fullOstUrl=displaySong?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${displaySong.filmTitle??displaySong.album??displaySong.title} full OST album playlist`)}`:"#";
  const selectSong=(song:Song)=>{ setSelected(song); resetTrackTools(); };

  const cacheResolvedVideo=(key:string,id:string)=>{
    setResolvedVideos((current)=>{
      const next={...current,[key]:id};
      try{localStorage.setItem("pulse-resolved-videos",JSON.stringify(next));}catch{}
      return next;
    });
  };

  const rememberRejectedVideo=(id:string)=>{
    setRejectedVideos((current)=>{
      const next=current.includes(id)?current:[...current,id].slice(-100);
      try{localStorage.setItem("pulse-rejected-youtube-videos",JSON.stringify(next));}catch{}
      return next;
    });
  };

  const resolveVideo=async(song:Song,excludedIds=rejectedVideos)=>{
    const key=trackKey(song);
    const known=[customVideos[key],resolvedVideos[key],song.videoId,youtubeTracks[key],youtubeVideos[song.id]].filter((id):id is string=>Boolean(id));
    const cached=known.find((id)=>!excludedIds.includes(id));
    if(cached)return cached;
    setVideoStatus("loading");
    const query=encodeURIComponent(`${song.title} ${song.artist} official music video`);
    try{
      const response=await fetch(`/api/youtube-search?q=${query}&mode=candidates`,{signal:AbortSignal.timeout(10000)});
      if(response.ok){
        const payload=await response.json() as {candidates?:unknown[]};
        const id=(payload.candidates??[]).map(videoIdFromResult).find((candidate)=>candidate&&!excludedIds.includes(candidate));
        if(id){cacheResolvedVideo(key,id);setVideoStatus("ready");return id;}
      }
    }catch{}
    setVideoStatus("missing");
    return "";
  };

  const playTrack=async()=>{
    if(!displaySong)return;
    if(lyricsStatus==="idle")void loadLyrics();
    const id=videoId??await resolveVideo(displaySong);
    if(id)setPlayingId(displaySong.id);
  };

  const playSong=async(song:Song)=>{
    setSelected(song);
    resetTrackTools();
    const id=await resolveVideo(song);
    if(id)setPlayingId(song.id);
  };

  const playNextTrack=()=>{
    if(trackPosition<0)return;
    const next=playbackSequence[trackPosition+1];
    if(next){void playSong(next);return;}
    setPlayingId("");
    setVideoStatus("idle");
  };

  const rejectVideo=async(failure:YouTubeFailure)=>{
    const failedVideoId=rawVideoId;
    const failedSong=displaySong;
    if(!failedVideoId||!failedSong){setPlayingId("");setVideoStatus("error");setVideoIssue(failure.reason);return;}
    setPlayingId("");
    if(![-2,5,100,101,150].includes(failure.code)){
      setVideoStatus("error");setVideoIssue(failure.reason);return;
    }
    const excluded=[...new Set([...rejectedVideos,failedVideoId])];
    rememberRejectedVideo(failedVideoId);
    setVideoStatus("loading");
    setVideoIssue(`${failure.reason} Hệ thống đang thử một video khác…`);
    const alternative=await resolveVideo(failedSong,excluded);
    if(alternative){
      setVideoIssue("");setVideoStatus("ready");setPlayingId(failedSong.id);return;
    }
    if(isOstChart){
      const currentIndex=selectedAlbumTracks.findIndex((song)=>song.id===failedSong.id);
      const ordered=[...selectedAlbumTracks.slice(currentIndex+1),...selectedAlbumTracks.slice(0,Math.max(currentIndex,0))];
      const nextSong=ordered.find((song)=>song.videoId&&!excluded.includes(song.videoId));
      if(nextSong){
        setSelected(nextSong);setVideoIssue("");setVideoStatus("ready");setPlayingId(nextSong.id);return;
      }
    }
    setVideoStatus("error");
    setVideoIssue(`${failure.reason} Không còn bản phát dự phòng hợp lệ; bạn có thể mở tìm kiếm YouTube bên dưới.`);
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
    const key=trackKey(displaySong);
    const saved=customLyrics[key];
    if(saved){setLyrics(saved);setSyncedLyrics("");setLyricsSource("CUSTOM");setLyricsStatus("ready");return;}
    const cached=lyricsCache[key];
    if(cached){setLyrics(cached.lyrics);setSyncedLyrics(cached.syncedLyrics??"");setLyricsSource(cached.source);setLyricsStatus("ready");return;}
    setLyricsStatus("loading");setLyrics("");setSyncedLyrics("");setLyricsSource("");
    try{
      const params=new URLSearchParams({title:displaySong.title,artist:displaySong.artist});
      const response=await fetch(`/api/lyrics-search?${params}`,{signal:AbortSignal.timeout(10000)});
      if(!response.ok){setLyricsStatus("missing");return;}
      const payload=await response.json();
      if(payload.lyrics){
        const source=payload.source??"LRCLIB";
        const synced=String(payload.syncedLyrics??"").trim();
        setLyrics(payload.lyrics);setSyncedLyrics(synced);setLyricsSource(source);setLyricsStatus("ready");
        setLyricsCache((current)=>{const next={...current,[key]:{lyrics:payload.lyrics,syncedLyrics:synced,source}};try{localStorage.setItem("pulse-lyrics-cache",JSON.stringify(next));}catch{}return next;});
      }
      else setLyricsStatus("missing");
    }catch{setLyricsStatus("error");}
  };

  const saveCustomLyrics=()=>{
    if(!displaySong||!lyricsDraft.trim())return;
    const key=trackKey(displaySong);
    const value=lyricsDraft.trim();
    const next={...customLyrics,[key]:value};
    setCustomLyrics(next);localStorage.setItem("pulse-custom-lyrics",JSON.stringify(next));
    setLyrics(value);setSyncedLyrics("");setLyricsSource("CUSTOM");setLyricsStatus("ready");setLyricsDraft("");
  };

  const downloadLyrics=()=>{
    if(!displaySong||!lyrics)return;
    const timed=Boolean(syncedLyrics);
    const content=timed?syncedLyrics:lyrics;
    const safeName=(displaySong.artist+" - "+displaySong.title).normalize("NFKC").replace(/[\/:*?"<>|]+/g,"-").trim().slice(0,120)||"lyrics";
    const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
    const objectUrl=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=objectUrl;anchor.download=safeName+(timed?".lrc":".txt");
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
  };

  const moveTrack=(step:number)=>{ if(!displaySong)return; const next=playbackSequence[trackPosition+step]; if(next)selectSong(next); };
  const heroCovers=active?.songs.slice(0,3)??[];

  return <main>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Pulse Charts — back to top"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></a>
      <nav><a href="#charts">Charts</a><Link href="/studio/">Lyric Studio</Link><a href="#about">About</a></nav>
      <div className="live-pill"><span/> {data.charts.length} CHARTS · 3 MARKETS</div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy">
        <p className="kicker"><span>01</span> THE SOUND OF RIGHT NOW</p>
        <h1>Turn up<br/><em>what’s next.</em></h1>
        <p>Official national rankings, current OST and ballad discovery, plus evergreen ballad listening charts across South Korea, Japan and Mainland China.</p>
        <a href="#charts" className="hero-cta"><span>▶</span> EXPLORE ALL {data.charts.length} CHARTS</a>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orb"/>
        <div className="vinyl"><i/><b>PULSE<br/>CHARTS</b></div>
        <div className="cover-stack">
          {heroCovers.map((song,index)=><span className="cover-card" key={song.id} style={{"--i":index} as React.CSSProperties}><b>{String(song.rank).padStart(2,"0")}</b><i>{song.title.slice(0,2)}</i></span>)}
          {!heroCovers.length&&<div className="cover-placeholder">LIVE<br/>TOP 50</div>}
        </div>
        <div className="waveform">{Array.from({length:18},(_,index)=><i key={index}/>)}</div>
      </div>
      <div className="hero-index">KOREA / JAPAN / CHINA</div>
    </section>

    <section className="chart-bar" id="charts">
      <div className="market-filters" aria-label="Filter by market">{marketLabels.map((item)=><button type="button" key={item.id} className={market===item.id?"active":""} aria-pressed={market===item.id} onClick={()=>chooseMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div>
      <label className="search-box"><span>⌕</span><input aria-label="Search this chart" value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search tracks, artists, chart entries"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</label>
    </section>

    <section className="chart-tabs" aria-label="Choose a chart">
      <p>ALL {data.charts.length} MUSIC CHARTS</p>
      <div>{charts.map((chart)=><button type="button" key={chart.id} className={active?.id===chart.id?"active":""} aria-pressed={active?.id===chart.id} onClick={()=>chooseChart(chart)}><span>{chart.shortLabel}</span>{chart.label}</button>)}</div>
    </section>

    <section className="workspace">
      <div className="chart-panel">
        <div className="panel-heading">
          <div><p className="kicker"><span>02</span> {isOstChart&&ostView==="albums"?`${songs.length} FILMS / ${ostTrackTotal} OST TRACKS`:"CURRENT TOP 50"}</p><h2>{active?.label??"Loading chart"}</h2>{isOstChart&&<div className="ost-view-toggle" role="group" aria-label="OST display mode"><button className={ostView==="albums"?"active":""} onClick={()=>setOstView("albums")}>OST ALBUMS</button><button className={ostView==="tracks"?"active":""} onClick={()=>setOstView("tracks")}>ALL TRACKS</button></div>}</div>
          {active&&<div className="sync-time"><span className="status-dot"/>CHART PERIOD<br/><b>{formatDate(active.updatedAt)}</b></div>}
        </div>
        <div className="column-head"><span>#</span><span>{isOstChart&&ostView==="albums"?"FILM / OST ALBUM":"TRACK"}</span><span>{isOstChart&&ostView==="albums"?"TRACKS":active?.id.includes("evergreen")?"YOUTUBE VIEWS":active?.id.includes("trending")?"LISTENING SIGNAL":"SCORE"}</span><span>{active?.id.includes("trending")||active?.id.includes("evergreen")?"RELEASED":"MARKET"}</span><span/></div>
        {active?.syncWarning&&<div className="sync-warning">{active.syncWarning}</div>}
        {songs.length===0&&<div className="empty-state">No matching tracks found.</div>}
        <div className="song-list" aria-live="polite">{songs.map((song)=><button key={song.id} className={`song-row ${displaySong?.id===song.id?"selected":""}`} onClick={()=>selectSong(song)}>
          <span className="rank">{String(song.rank).padStart(2,"0")}</span>
          <span className="track"><span className="art cover-art"><b>{String(song.rank).padStart(2,"0")}</b><i>▶</i></span><span className="song-main"><b>{isOstChart&&ostView==="albums"?(song.filmTitle??song.album):song.title}</b><small>{isOstChart&&ostView==="albums"?`${song.title} · ${song.artist}`:isOstChart?`${song.artist} · ${song.filmTitle??song.album??"OST"}`:song.artist}</small></span></span>
          <span className="genre">{isOstChart&&ostView==="albums"?`${song.albumTrackCount??1} TRACK${(song.albumTrackCount??1)>1?"S":""}`:active?.id.includes("evergreen")&&song.viewCount!==undefined?formatViewCount(song.viewCount):song.genre}</span><span className="released">{song.releaseDate}</span><span className="row-action">•••</span>
        </button>)}</div>
      </div>

      <aside className={`player-panel ${displaySong?"has-song":""}`}>
        {displaySong?<><div className="player-glow token-glow"/>
          <div className="player-head"><span>YOUTUBE PLAYER / FREE</span><span>#{displaySong.rank}</span></div>
          {videoIssue?<div className="video-quality-warning" aria-live="polite"><b>{videoStatus==="loading"?"TRYING ANOTHER VIDEO":"VIDEO UNAVAILABLE"}</b><p>{videoIssue}</p>{videoStatus!=="loading"&&<button onClick={()=>{setVideoIssue("");setVideoStatus("idle");}}>CHOOSE ANOTHER SONG</button>}</div>:videoId&&playingId===displaySong.id?<ValidatedYouTubePlayer videoId={videoId} title={`${displaySong.title} by ${displaySong.artist}`} onRejected={rejectVideo} onEnded={playNextTrack}/>:<button className="player-cover cover-art player-token" onClick={playTrack} disabled={videoStatus==="loading"}><strong>{String(displaySong.rank).padStart(2,"0")}</strong><em>{videoStatus==="loading"?"FINDING VIDEO...":videoId?"PLAY HERE / YOUTUBE":videoStatus==="missing"?"OPEN SEARCH BELOW":"FIND & PLAY HERE"}</em><span className="playing-badge"><i/><i/><i/><i/></span></button>}
          <div className="player-info"><p>{isOstChart?(displaySong.filmTitle??displaySong.album):active?.source}</p><h3>{displaySong.title}</h3><span>{displaySong.artist}</span>{isOstChart&&<small>{displaySong.album}</small>}</div>
          <div className="progress"><span/><i>{active?.id.includes("evergreen")?"MEASURED VIEWS":"CHART SCORE"}</i><b>{active?.id.includes("evergreen")&&displaySong.viewCount!==undefined?displaySong.viewCount.toLocaleString("en-US")+" VIEWS":displaySong.genre}</b></div>
          <div className="transport"><button onClick={()=>moveTrack(-1)} disabled={trackPosition<=0}>PREV</button><button onClick={playTrack} disabled={videoStatus==="loading"}>{videoStatus==="loading"?"SEARCHING...":"PLAY HERE"}</button><button onClick={()=>moveTrack(1)} disabled={trackPosition<0||trackPosition===playbackSequence.length-1}>NEXT</button></div>
          <p className="auto-next-status"><span/>AUTO NEXT ON {trackPosition>=0&&trackPosition<playbackSequence.length-1?`· ${playbackSequence.length-trackPosition-1} TRACKS QUEUED`:"· END OF QUEUE"}</p>
          {videoStatus==="missing"&&<p className="media-note">No embeddable result was found automatically. Use YouTube search and choose the official upload.</p>}
          {videoStatus==="error"&&!videoIssue&&<p className="media-note">That link is not a valid YouTube video URL or 11-character video ID.</p>}
          <details className="video-link-editor"><summary>UPDATE YOUTUBE LINK</summary><div><input value={videoLink} onChange={(event)=>setVideoLink(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")saveVideoLink();}} placeholder="Paste YouTube URL or video ID"/><button onClick={saveVideoLink} disabled={!videoLink.trim()}>USE VIDEO</button></div><small>Saved free on this browser for the same track and artist.</small></details>
          <div className="player-actions"><a className="primary" href={displaySong.url} target="_blank" rel="noreferrer">CHART SOURCE</a><a href={youtubeUrl} target="_blank" rel="noreferrer">{videoId?"OPEN YOUTUBE":"SEARCH YOUTUBE"}</a>{isOstChart&&<a className="ost-album-link" href={fullOstUrl} target="_blank" rel="noreferrer">OPEN FULL OST</a>}</div>{isOstChart&&<section className="ost-album-tracks"><div><b>UP TO 5 HOT PUBLISHED OST TRACKS</b><span>FULL SONGS ONLY</span></div>{selectedAlbumTracks.length===0?<p className="ost-empty">No published full-length YouTube track has been verified for this film yet.</p>:selectedAlbumTracks.map((song,index)=><button key={song.id} className={song.id===displaySong.id?"active":""} onClick={()=>selectSong(song)}><span>{String(index+1).padStart(2,"0")}</span><b>{song.title}</b><small>{song.artist}{song.durationSeconds?` · ${Math.floor(song.durationSeconds/60)}:${String(song.durationSeconds%60).padStart(2,"0")}`:""}</small></button>)}</section>}
          <div className="lyrics-tools"><button onClick={loadLyrics} disabled={lyricsStatus==="loading"}>{lyricsStatus==="loading"?"LOADING LYRICS...":lyricsStatus==="ready"?"REFRESH LYRICS":"SHOW LYRICS"}</button><button onClick={downloadLyrics} disabled={lyricsStatus!=="ready"||!lyrics}>{syncedLyrics?"DOWNLOAD .LRC":"DOWNLOAD .TXT"}</button><a href={lyricsSearchUrl} target="_blank" rel="noreferrer">GENIUS</a><a href={musixmatchSearchUrl} target="_blank" rel="noreferrer">MUSIXMATCH</a></div>
          <details className="lyrics-editor"><summary>ADD OR REPLACE LYRICS</summary><textarea value={lyricsDraft} onChange={(event)=>setLyricsDraft(event.target.value)} placeholder="Paste lyrics for this track"/><button onClick={saveCustomLyrics} disabled={!lyricsDraft.trim()}>SAVE LYRICS</button><small>Saved free on this browser for the same track and artist.</small></details>
          {lyricsStatus==="ready"&&<section className="lyrics-panel" aria-live="polite"><div><b>LYRICS</b>{lyricsSource==="LRCLIB"?<a href="https://lrclib.net" target="_blank" rel="noreferrer">via LRCLIB</a>:<span>{lyricsSource}</span>}</div><pre>{lyrics}</pre></section>}
          {(lyricsStatus==="missing"||lyricsStatus==="error")&&<p className="media-note">No lyrics were found in the free library. Open Genius or Musixmatch, or paste lyrics above.</p>}
          <dl><div><dt>MARKET</dt><dd>{active?.label}</dd></div><div><dt>{active?.id.includes("trending")||active?.id.includes("evergreen")?"RELEASED":"MARKET CODE"}</dt><dd>{displaySong.releaseDate}</dd></div></dl>
        </>:<div className="player-empty"><div className="vinyl mini"><i/></div><p>SELECT A TRACK</p></div>}
      </aside>
    </section>

    <footer id="about"><div className="brand footer-brand"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></div><p>Top 50 rankings across current, trending, evergreen ballad and vocal R&B charts across 0–10, 10–20 and 20–30 year eras.<br/>Free YouTube playback and lyrics lookup — no account required.</p><div>{active?<><a href={active.sourceUrl} target="_blank" rel="noreferrer">SOURCE: {active.source} ↗</a><span>PERIOD {formatDate(active.updatedAt)}</span></>:"CONNECTING TO DATA"}</div></footer>
  </main>;
}
