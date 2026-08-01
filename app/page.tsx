"use client";

import { useEffect, useMemo, useState } from "react";

type Market="KR"|"JP"|"CN";
type Song={ rank:number; id:string; title:string; artist:string; releaseDate:string; genre:string; artworkUrl:string; url:string; artistUrl:string };
type Chart={ id:string; label:string; shortLabel:string; market:Market; source:string; sourceUrl:string; updatedAt:string; syncWarning?:string; songs:Song[] };
type ChartData={ generatedAt:string; charts:Chart[] };

const marketLabels:{ id:Market|"ALL"; label:string; code:string }[]=[
  { id:"ALL",label:"All markets",code:"ALL" },{ id:"KR",label:"South Korea",code:"KR" },
  { id:"JP",label:"Japan",code:"JP" },{ id:"CN",label:"China",code:"CN" },
];

function formatDate(value:string,includeTime=false) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US",{ day:"2-digit",month:"short",year:"numeric",...(includeTime?{hour:"2-digit",minute:"2-digit"}:{}) }).format(date);
}

export default function Home(){
  const [data,setData]=useState<ChartData|null>(null);
  const [status,setStatus]=useState<"loading"|"ready"|"error">("loading");
  const [activeId,setActiveId]=useState("");
  const [market,setMarket]=useState<Market|"ALL">("ALL");
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState<Song|null>(null);

  useEffect(()=>{ fetch(`charts.json?v=${Date.now()}`).then((response)=>{ if(!response.ok) throw new Error(); return response.json(); })
    .then((next:ChartData)=>{ setData(next); setActiveId(next.charts[0]?.id??""); setSelected(next.charts[0]?.songs[0]??null); setStatus("ready"); })
    .catch(()=>setStatus("error")); },[]);
  const charts=useMemo(()=>data?.charts.filter((chart)=>market==="ALL"||chart.market===market)??[],[data,market]);
  useEffect(()=>{ if(!charts.some((chart)=>chart.id===activeId)){ const next=charts[0];setActiveId(next?.id??"");setSelected(next?.songs[0]??null); } },[charts,activeId]);
  const active=data?.charts.find((chart)=>chart.id===activeId)??charts[0];
  const songs=useMemo(()=>{ const needle=query.trim().toLocaleLowerCase("en"); if(!active) return []; if(!needle) return active.songs; return active.songs.filter((song)=>`${song.title} ${song.artist} ${song.genre}`.toLocaleLowerCase("en").includes(needle)); },[active,query]);
  const chooseChart=(chart:Chart)=>{ setActiveId(chart.id); setSelected(chart.songs[0]??null); };
  const displaySong=selected??active?.songs[0]??null;
  const youtubeUrl=displaySong?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${displaySong.title} ${displaySong.artist}`)}`:"#";
  const heroCovers=active?.songs.slice(0,3)??[];

  return <main>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Pulse Charts — back to top"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></a>
      <nav><a href="#charts">Charts</a><a href="#about">About</a></nav>
      <div className="live-pill"><span/> LIVE · APPLE MUSIC DATA</div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy">
        <p className="kicker"><span>01</span> THE SOUND OF RIGHT NOW</p>
        <h1>Turn up<br/><em>what’s next.</em></h1>
        <p>One place for the tracks moving South Korea, Japan and China. Real Apple Music charts, refreshed without the noise.</p>
        <a href="#charts" className="hero-cta"><span>▶</span> EXPLORE THE CHARTS</a>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orb"/>
        <div className="vinyl"><i/><b>PULSE<br/>CHARTS</b></div>
        <div className="cover-stack">
          {heroCovers.map((song,index)=><img key={song.id} src={song.artworkUrl} alt="" style={{"--i":index} as React.CSSProperties}/>)}
          {!heroCovers.length&&<div className="cover-placeholder">LIVE<br/>TOP 10</div>}
        </div>
        <div className="waveform">{Array.from({length:18},(_,index)=><i key={index}/>)}</div>
      </div>
      <div className="hero-index">ASIA / 2026</div>
    </section>

    <section className="chart-bar" id="charts">
      <div className="market-filters" aria-label="Filter by market">{marketLabels.map((item)=><button key={item.id} className={market===item.id?"active":""} onClick={()=>setMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div>
      <label className="search-box"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search tracks, artists, genres"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</label>
    </section>

    <section className="chart-tabs" aria-label="Choose a chart">
      <p>SELECT CHART</p>
      <div>{charts.map((chart)=><button key={chart.id} className={active?.id===chart.id?"active":""} onClick={()=>chooseChart(chart)}><span>{chart.shortLabel}</span>{chart.label}</button>)}</div>
    </section>

    <section className="workspace">
      <div className="chart-panel">
        <div className="panel-heading">
          <div><p className="kicker"><span>02</span> MOST PLAYED</p><h2>{active?.label??"Loading chart"}</h2></div>
          {data&&<div className="sync-time"><span className="status-dot"/>UPDATED<br/><b>{formatDate(data.generatedAt,true)}</b></div>}
        </div>
        <div className="column-head"><span>#</span><span>TRACK</span><span>GENRE</span><span>RELEASED</span><span/></div>
        {active?.syncWarning&&<div className="sync-warning">{active.syncWarning}</div>}
        {status==="loading"&&<div className="empty-state">Tuning into the latest charts…</div>}
        {status==="error"&&<div className="empty-state error">We could not load the data. Please try again later.</div>}
        {status==="ready"&&songs.length===0&&<div className="empty-state">No matching tracks found.</div>}
        <div className="song-list" aria-live="polite">{songs.map((song)=><button key={song.id} className={`song-row ${displaySong?.id===song.id?"selected":""}`} onClick={()=>setSelected(song)}>
          <span className="rank">{String(song.rank).padStart(2,"0")}</span>
          <span className="track"><span className="art"><img src={song.artworkUrl} alt="" loading="lazy"/><i>▶</i></span><span className="song-main"><b>{song.title}</b><small>{song.artist}</small></span></span>
          <span className="genre">{song.genre}</span><span className="released">{formatDate(song.releaseDate)}</span><span className="row-action">•••</span>
        </button>)}</div>
      </div>

      <aside className={`player-panel ${displaySong?"has-song":""}`}>
        {displaySong?<><div className="player-glow" style={{backgroundImage:`url("${displaySong.artworkUrl}")`}}/>
          <div className="player-head"><span>NOW CHARTING</span><span>#{displaySong.rank}</span></div>
          <div className="player-cover"><img src={displaySong.artworkUrl} alt={`${displaySong.title} artwork`}/><span className="playing-badge"><i/><i/><i/><i/></span></div>
          <div className="player-info"><p>{displaySong.genre}</p><h3>{displaySong.title}</h3><a href={displaySong.artistUrl} target="_blank" rel="noreferrer">{displaySong.artist} ↗</a></div>
          <div className="progress"><span/><i>PREVIEW</i><b>TOP {displaySong.rank}</b></div>
          <div className="player-actions"><a className="primary" href={displaySong.url} target="_blank" rel="noreferrer"><span>▶</span> PLAY ON APPLE MUSIC</a><a href={youtubeUrl} target="_blank" rel="noreferrer">YOUTUBE ↗</a></div>
          <dl><div><dt>MARKET</dt><dd>{active?.label}</dd></div><div><dt>RELEASED</dt><dd>{formatDate(displaySong.releaseDate)}</dd></div></dl>
        </>:<div className="player-empty"><div className="vinyl mini"><i/></div><p>SELECT A TRACK</p></div>}
      </aside>
    </section>

    <footer id="about"><div className="brand footer-brand"><span className="brand-mark"><i/><i/><i/><i/></span><span>PULSE<b>CHARTS</b></span></div><p>Real charts. Zero noise.<br/>Built for music discovery across Asia.</p><div>{active?<><a href={active.sourceUrl} target="_blank" rel="noreferrer">SOURCE: {active.source} ↗</a><span>UPDATED {formatDate(active.updatedAt,true)}</span></>:"CONNECTING TO DATA"}</div></footer>
  </main>;
}