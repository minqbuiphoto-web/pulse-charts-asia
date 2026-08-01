"use client";

import { useEffect, useMemo, useState } from "react";

type ChartType = "songs" | "ost";
type Market = "KR" | "JP" | "CN";
type Song = { rank:number; title:string; artist:string; movement:number; weeks:number; movie?:string; youtubeId?:string; lyric?:string };
type Chart = { id:string; label:string; shortLabel:string; market:Market; type:ChartType; source:string; updatedAt:string; songs:Song[] };

const markets: Array<{ id:Market|"ALL"; label:string; code:string }> = [
  { id:"ALL", label:"Tất cả", code:"ALL" }, { id:"KR", label:"Hàn Quốc", code:"KR" },
  { id:"JP", label:"Nhật Bản", code:"JP" }, { id:"CN", label:"Trung Quốc", code:"CN" },
];

function Arrow({ movement }:{ movement:number }) {
  if (movement === 0) return <span className="movement steady">—</span>;
  return <span className={`movement ${movement > 0 ? "up" : "down"}`}>{movement > 0 ? "↑" : "↓"} {Math.abs(movement)}</span>;
}

export default function Home() {
  const [charts,setCharts] = useState<Chart[]>([]);
  const [activeChartId,setActiveChartId] = useState("");
  const [selectedSong,setSelectedSong] = useState<Song|null>(null);
  const [query,setQuery] = useState("");
  const [market,setMarket] = useState<Market|"ALL">("ALL");
  const [type,setType] = useState<ChartType>("songs");
  const [status,setStatus] = useState<"loading"|"ready"|"error">("loading");

  useEffect(() => { fetch("charts.json").then((response) => { if(!response.ok) throw new Error(); return response.json(); })
    .then((data:{ charts:Chart[] }) => { setCharts(data.charts); setActiveChartId(data.charts[0]?.id ?? ""); setStatus("ready"); })
    .catch(() => setStatus("error")); }, []);

  const availableCharts = useMemo(() => charts.filter((chart) => chart.type===type && (market==="ALL" || chart.market===market)),[charts,market,type]);
  useEffect(() => { if(!availableCharts.some((chart) => chart.id===activeChartId)){ setActiveChartId(availableCharts[0]?.id ?? ""); setSelectedSong(null); } },[activeChartId,availableCharts]);
  const activeChart = charts.find((chart) => chart.id===activeChartId) ?? availableCharts[0];
  const results = useMemo(() => { if(!activeChart) return []; const normalized=query.trim().toLocaleLowerCase("vi"); if(!normalized) return activeChart.songs; return activeChart.songs.filter((song) => [song.title,song.artist,song.movie].filter(Boolean).join(" ").toLocaleLowerCase("vi").includes(normalized)); },[activeChart,query]);
  const selectChart=(id:string) => { setActiveChartId(id); setSelectedSong(null); };
  const youtubeSearch=selectedSong ? `https://www.youtube.com/results?search_query=${encodeURIComponent(`${selectedSong.title} ${selectedSong.artist}`)}` : "#";

  return <main>
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Pulse Charts — về đầu trang"><span className="brand-mark"><i/><i/><i/></span><span>PULSE<span>CHARTS</span></span></a>
      <div className="topbar-meta"><span className="live-dot"/> DỮ LIỆU MẪU · CẬP NHẬT HÀNG TUẦN</div>
    </header>
    <section className="hero" id="top"><div><p className="eyebrow">ÂM NHẠC ĐANG CHUYỂN ĐỘNG</p><h1>Bắt nhịp những ca khúc<br/>đang được <em>nghe nhiều.</em></h1><p className="hero-copy">Khám phá bảng xếp hạng châu Á và nhạc phim nổi bật trong một giao diện gọn, nhanh và không cần đăng nhập.</p></div><div className="hero-stat" aria-label="Tổng quan dữ liệu"><strong>07</strong><span>BẢNG XẾP HẠNG<br/>TRONG MỘT NƠI</span></div></section>
    <section className="controls" aria-label="Tìm kiếm và bộ lọc">
      <label className="search-box"><span>⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Tìm bài hát, nghệ sĩ hoặc phim..."/>{query && <button onClick={()=>setQuery("")} aria-label="Xóa tìm kiếm">×</button>}</label>
      <div className="filter-group" aria-label="Lọc theo quốc gia">{markets.map((item)=><button key={item.id} className={market===item.id?"active":""} onClick={()=>setMarket(item.id)}><small>{item.code}</small>{item.label}</button>)}</div>
    </section>
    <section className="workspace">
      <aside className="sidebar"><p className="section-label">LOẠI BẢNG</p>
        <button className={`type-button ${type==="songs"?"active":""}`} onClick={()=>setType("songs")}><span>01</span><b>Bài hát thịnh hành</b><i>→</i></button>
        <button className={`type-button ${type==="ost"?"active":""}`} onClick={()=>setType("ost")}><span>02</span><b>Nhạc phim nổi bật</b><i>→</i></button>
        <p className="section-label chart-label">BẢNG ĐANG XEM</p><div className="chart-menu">{availableCharts.map((chart)=><button key={chart.id} className={activeChart?.id===chart.id?"active":""} onClick={()=>selectChart(chart.id)}><span>{chart.shortLabel}</span><b>{chart.label}</b></button>)}</div>
      </aside>
      <div className="chart-panel"><div className="panel-heading"><div><p className="eyebrow">{activeChart?.shortLabel ?? "—"} · TOP 10</p><h2>{activeChart?.label ?? "Đang tải dữ liệu"}</h2></div>{activeChart && <div className="updated">CẬP NHẬT<br/><b>{activeChart.updatedAt}</b></div>}</div>
        {status==="loading" && <div className="empty-state">Đang mở bảng xếp hạng…</div>}{status==="error" && <div className="empty-state error">Không tải được dữ liệu. Hãy kiểm tra lại tệp charts.json.</div>}{status==="ready" && results.length===0 && <div className="empty-state">Không tìm thấy kết quả phù hợp.</div>}
        <div className="song-list" aria-live="polite">{results.map((song)=><button key={`${activeChart?.id}-${song.rank}`} className={`song-row ${selectedSong?.rank===song.rank?"selected":""}`} onClick={()=>setSelectedSong(song)}><span className="rank">{String(song.rank).padStart(2,"0")}</span><span className="song-main"><b>{song.title}</b><small>{song.artist}{song.movie?` · ${song.movie}`:""}</small></span><Arrow movement={song.movement}/><span className="weeks">{song.weeks}<small>TUẦN</small></span><span className="open-song">↗</span></button>)}</div>
      </div>
      <aside className={`detail-panel ${selectedSong?"has-song":""}`}>{!selectedSong?<div className="detail-empty"><span className="disc"><i/></span><p>CHỌN MỘT CA KHÚC</p><h3>Thông tin bài hát sẽ xuất hiện tại đây.</h3></div>:<><div className="detail-art"><span className="detail-rank">#{selectedSong.rank}</span><span className="disc large"><i/></span></div><p className="eyebrow">ĐANG CHỌN</p><h3>{selectedSong.title}</h3><p className="detail-artist">{selectedSong.artist}</p>{selectedSong.movie&&<span className="movie-tag">OST · {selectedSong.movie}</span>}<div className="lyric-box"><span>LỜI / GHI CHÚ</span><p>{selectedSong.lyric||"Chưa có nội dung lời được cấp phép. Bạn có thể bổ sung phần mô tả hợp pháp trong charts.json."}</p></div>{selectedSong.youtubeId?<iframe title={`Nghe ${selectedSong.title} trên YouTube`} src={`https://www.youtube-nocookie.com/embed/${selectedSong.youtubeId}?rel=0`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/>:<a className="youtube-link" href={youtubeSearch} target="_blank" rel="noreferrer">TÌM TRÊN YOUTUBE <span>↗</span></a>}</>}</aside>
    </section>
    <footer><span>PULSECHARTS / MVP</span><p>Dữ liệu minh họa · Sẵn sàng cho GitHub Pages</p></footer>
  </main>;
}
