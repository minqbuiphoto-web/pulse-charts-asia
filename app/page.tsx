"use client";

import { useEffect, useMemo, useState } from "react";

type Market="KR"|"JP"|"CN";
type Song={ rank:number; id:string; title:string; artist:string; releaseDate:string; genre:string; artworkUrl:string; url:string; artistUrl:string };
type Chart={ id:string; label:string; shortLabel:string; market:Market; source:string; sourceUrl:string; updatedAt:string; syncWarning?:string; songs:Song[] };
type ChartData={ generatedAt:string; charts:Chart[] };

const marketLabels:{ id:Market|"ALL"; label:string; code:string }[]=[
  { id:"ALL",label:"Tất cả",code:"ALL" },{ id:"KR",label:"Hàn Quốc",code:"KR" },
  { id:"JP",label:"Nhật Bản",code:"JP" },{ id:"CN",label:"Trung Quốc",code:"CN" },
];

function formatDate(value:string,includeTime=false) {
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN",{ day:"2-digit",month:"2-digit",year:"numeric",...(includeTime?{hour:"2-digit",minute:"2-digit"}:{}) }).format(date);
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
  const songs=useMemo(()=>{ const needle=query.trim().toLocaleLowerCase("vi"); if(!active) return []; if(!needle) return active.songs; return active.songs.filter((song)=>`${song.title} ${song.artist} ${song.genre}`.toLocaleLowerCase("vi").includes(needle)); },[active,query]);
  const chooseChart=(id:string)=>{ setActiveId(id); setSelected(null); };
  const youtubeUrl=selected?`https://www.youtube.com/results?search_query=${encodeURIComponent(`${selected.title} ${selected.artist}`)}`:"#";

  return <main>
    <header className="topbar"><a className="brand" href="#top" aria-label="Pulse Charts — về đầu trang"><span className="brand-mark"><i/><i/><i/></span><span>PULSE<span>CHARTS</span></span></a><div className="topbar-meta"><span className="live-dot"/> DỮ LIỆU THẬT · ĐỒNG BỘ TỪ APPLE MUSIC</div></header>
    <section className="hero" id="top"><div><p className="eyebrow">BẢNG XẾP HẠNG ÂM NHẠC CHÂU Á</p><h1>Biết bài nào đang<br/>được <em>nghe nhiều.</em></h1><p className="hero-copy">Theo dõi Top 10 Apple Music tại Hàn Quốc, Nhật Bản và Trung Quốc — đồng bộ từ nguồn công khai, không cần đăng nhập.</p></div><div className="hero-stat"><strong>03</strong><span>THỊ TRƯỜNG<br/>DỮ LIỆU TRỰC TIẾP</span></div></section>
    <section className="controls" aria-label="Tìm kiếm và bộ lọc"><label className="search-box"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Tìm bài hát, nghệ sĩ hoặc thể loại..."/>{query&&<button onClick={()=>setQuery("")} aria-label="Xóa tìm kiếm">×</button>}</label><div className="filter-group" aria-label="Lọc theo quốc gia">{marketLabels.map((item)=><button key={item.id} className={market===item.id?"active":""} onClick={()=>setMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div></section>
    <section className="workspace">
      <aside className="sidebar"><p className="section-label">BẢNG XẾP HẠNG</p><div className="chart-menu">{charts.map((chart)=><button key={chart.id} className={active?.id===chart.id?"active":""} onClick={()=>chooseChart(chart.id)}><span>{chart.shortLabel}</span><b>{chart.label}</b></button>)}</div><div className="source-note"><span className="verified">✓</span><p><b>Nguồn đã xác minh</b>Dữ liệu được lấy từ RSS công khai do Apple phát hành.</p></div></aside>
      <div className="chart-panel"><div className="panel-heading"><div><p className="eyebrow">{active?.shortLabel??"—"} · MOST PLAYED</p><h2>{active?.label??"Đang tải dữ liệu"}</h2></div>{data&&<div className="updated">ĐỒNG BỘ<br/><b>{formatDate(data.generatedAt,true)}</b></div>}</div>
        {active?.syncWarning&&<div className="sync-warning">{active.syncWarning}</div>}{status==="loading"&&<div className="empty-state">Đang lấy bảng xếp hạng mới nhất…</div>}{status==="error"&&<div className="empty-state error">Chưa tải được dữ liệu. Vui lòng thử lại sau.</div>}{status==="ready"&&songs.length===0&&<div className="empty-state">Không tìm thấy kết quả phù hợp.</div>}
        <div className="song-list" aria-live="polite">{songs.map((song)=><button key={song.id} className={`song-row ${selected?.id===song.id?"selected":""}`} onClick={()=>setSelected(song)}><span className="rank">{String(song.rank).padStart(2,"0")}</span><img src={song.artworkUrl} alt="" loading="lazy"/><span className="song-main"><b>{song.title}</b><small>{song.artist}</small></span><span className="genre">{song.genre}</span><span className="released">{formatDate(song.releaseDate)}</span><span className="open-song">↗</span></button>)}</div>
      </div>
      <aside className={`detail-panel ${selected?"has-song":""}`}>{!selected?<div className="detail-empty"><span className="disc"><i/></span><p>CHỌN MỘT CA KHÚC</p><h3>Ảnh bìa và liên kết nghe sẽ xuất hiện tại đây.</h3></div>:<><div className="cover-wrap"><img src={selected.artworkUrl} alt={`Ảnh bìa ${selected.title}`}/><span>#{selected.rank}</span></div><p className="eyebrow">{selected.genre}</p><h3>{selected.title}</h3><a className="artist-link" href={selected.artistUrl} target="_blank" rel="noreferrer">{selected.artist} ↗</a><dl><div><dt>PHÁT HÀNH</dt><dd>{formatDate(selected.releaseDate)}</dd></div><div><dt>THỊ TRƯỜNG</dt><dd>{active?.label}</dd></div></dl><a className="apple-link" href={selected.url} target="_blank" rel="noreferrer">NGHE TRÊN APPLE MUSIC <span>↗</span></a><a className="youtube-link secondary" href={youtubeUrl} target="_blank" rel="noreferrer">TÌM TRÊN YOUTUBE <span>↗</span></a></>}</aside>
    </section>
    <footer><span>PULSECHARTS / LIVE V1</span><p>{active?<><a href={active.sourceUrl} target="_blank" rel="noreferrer">Nguồn: {active.source} ↗</a> · Cập nhật {formatDate(active.updatedAt,true)}</>:"Đang kết nối nguồn dữ liệu"}</p></footer>
  </main>;
}
