"use client";

import { useEffect, useMemo, useState } from "react";

type Market="KR"|"JP"|"CN";
type Song={ rank:number; id:string; title:string; artist:string; releaseDate:string; genre:string; artworkUrl:string; url:string; artistUrl:string };
type Chart={ id:string; label:string; shortLabel:string; market:Market; source:string; sourceUrl:string; updatedAt:string; syncWarning?:string; songs:Song[] };
type ChartData={ generatedAt:string; charts:Chart[] };

const marketLabels:{ id:Market|"ALL"; label:string; code:string }[]=[
  { id:"ALL",label:"All",code:"ALL" },{ id:"KR",label:"South Korea",code:"KR" },
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
    .then((next:ChartData)=>{ setData(next); setActiveId(next.charts[0]?.id??""); setStatus("ready"); })
    .catch(()=>setStatus("error")); },[]);
  const charts=useMemo(()=>data?.charts.filter((chart)=>market==="ALL"||chart.market===market)??[],[data,market]);
  useEffect(()=>{ if(!charts.some((chart)=>chart.id===activeId)){ setActiveId(charts[0]?.id??""); setSelected(null); } },[charts,activeId]);
  const active=data?.charts.find((chart)=>chart.id===activeId)??charts[0];
  const songs=useMemo(()=>{ const needle=query.trim().toLocaleLowerCase("en"); if(!active) return []; if(!needle) return active.songs; return active.songs.filter((song)=>`${song.title} ${song.artist} ${song.genre}`.toLocaleLowerCase("en").includes(needle)); },[active,query]);
  const chooseChart=(id:string)=>{ setActiveId(id); setSelected(null); };
  const youtubeUrl=selected?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${selected.title} ${selected.artist}`)}`:"#";

  return <main>
    <header className="topbar"><a className="brand" href="#top" aria-label="Pulse Charts — back to top"><span className="brand-mark"><i/><i/><i/></span><span>PULSE<span>CHARTS</span></span></a><div className="topbar-meta"><span className="live-dot"/> LIVE DATA · SYNCED FROM APPLE MUSIC</div></header>
    <section className="hero" id="top"><div><p className="eyebrow">ASIAN MUSIC CHARTS</p><h1>See what Asia is<br/><em>listening to.</em></h1><p className="hero-copy">Track the Apple Music Top 10 in South Korea, Japan and China — synced from public sources, with no sign-in required.</p></div><div className="hero-stat"><strong>03</strong><span>MARKETS<br/>LIVE DATA</span></div></section>
    <section className="controls" aria-label="Search and filters"><label className="search-box"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search songs, artists or genres..."/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search">×</button>}</label><div className="filter-group" aria-label="Filter by market">{marketLabels.map((item)=><button key={item.id} className={market===item.id?"active":""} onClick={()=>setMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div></section>
    <section className="workspace">
      <aside className="sidebar"><p className="section-label">CHARTS</p><div className="chart-menu">{charts.map((chart)=><button key={chart.id} className={active?.id===chart.id?"active":""} onClick={()=>chooseChart(chart.id)}><span>{chart.shortLabel}</span><b>{chart.label}</b></button>)}</div><div className="source-note"><span className="verified">✓</span><p><b>Verified source</b>Data comes from public RSS feeds published by Apple.</p></div></aside>
      <div className="chart-panel"><div className="panel-heading"><div><p className="eyebrow">{active?.shortLabel??"—"} · MOST PLAYED</p><h2>{active?.label??"Loading data"}</h2></div>{data&&<div className="updated">SYNCED<br/><b>{formatDate(data.generatedAt,true)}</b></div>}</div>
        {active?.syncWarning&&<div className="sync-warning">{active.syncWarning}</div>}{status==="loading"&&<div className="empty-state">Loading the latest charts…</div>}{status==="error"&&<div className="empty-state error">We could not load the data. Please try again later.</div>}{status==="ready"&&songs.length===0&&<div className="empty-state">No matching results found.</div>}
        <div className="song-list" aria-live="polite">{songs.map((song)=><button key={song.id} className={`song-row ${selected?.id===song.id?"selected":""}`} onClick={()=>setSelected(song)}><span className="rank">{String(song.rank).padStart(2,"0")}</span><img src={song.artworkUrl} alt="" loading="lazy"/><span className="song-main"><b>{song.title}</b><small>{song.artist}</small></span><span className="genre">{song.genre}</span><span className="released">{formatDate(song.releaseDate)}</span><span className="open-song">↗</span></button>)}</div>
      </div>
      <aside className={`detail-panel ${selected?"has-song":""}`}>{!selected?<div className="detail-empty"><span className="disc"><i/></span><p>SELECT A SONG</p><h3>Artwork and listening links will appear here.</h3></div>:<><div className="cover-wrap"><img src={selected.artworkUrl} alt={`${selected.title} artwork`}/><span>#{selected.rank}</span></div><p className="eyebrow">{selected.genre}</p><h3>{selected.title}</h3><a className="artist-link" href={selected.artistUrl} target="_blank" rel="noreferrer">{selected.artist} ↗</a><dl><div><dt>RELEASED</dt><dd>{formatDate(selected.releaseDate)}</dd></div><div><dt>MARKET</dt><dd>{active?.label}</dd></div></dl><a className="apple-link" href={selected.url} target="_blank" rel="noreferrer">LISTEN ON APPLE MUSIC <span>↗</span></a><a className="youtube-link secondary" href={youtubeUrl} target="_blank" rel="noreferrer">SEARCH ON YOUTUBE <span>↗</span></a></>}</aside>
    </section>
    <footer><span>PULSECHARTS / LIVE V1</span><p>{active?<><a href={active.sourceUrl} target="_blank" rel="noreferrer">Source: {active.source} ↗</a> · Updated {formatDate(active.updatedAt,true)}</>:"Connecting to the data source"}</p></footer>
  </main>;
}