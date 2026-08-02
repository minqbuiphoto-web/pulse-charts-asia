"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "./studio.css";

type LookupState="idle"|"searching"|"ready"|"error";
type LyricsPayload={lyrics?:string;syncedLyrics?:string;matchedTrack?:string;matchedArtist?:string};
type SearchResult={videoId:string;title:string;artist:string;lyrics:string;syncedLyrics:string};
type StudioSong=SearchResult;
type TimedLine={time:number;text:string};
type ChatMessage={role:"assistant"|"user";text:string};
type SavedProject={
  version:1;
  key:string;
  song:StudioSong;
  translations:Record<number,string>;
  literalMeanings:Record<number,string>;
  tonePatterns:Record<number,string>;
  updatedAt:string;
};

type YTPlayer={
  destroy:()=>void;
  getCurrentTime:()=>number;
  getDuration:()=>number;
  playVideo:()=>void;
  pauseVideo:()=>void;
  seekTo:(seconds:number,allowSeekAhead:boolean)=>void;
};
type YTPlayerOptions={
  videoId:string;
  playerVars:Record<string,number>;
  events:{
    onReady:(event:{target:YTPlayer})=>void;
    onStateChange:(event:{data:number})=>void;
  };
};
type YTNamespace={Player:new(element:HTMLElement,options:YTPlayerOptions)=>YTPlayer};

declare global{
  interface Window{
    YT?:YTNamespace;
    onYouTubeIframeAPIReady?:()=>void;
  }
}

function parseTimedLyrics(value:string){
  const lines:TimedLine[]=[];
  value.split(/\r?\n/).forEach((raw)=>{
    const matches=[...raw.matchAll(/\[(\d{1,3}):(\d{1,2}(?:\.\d+)?)\]/g)];
    const text=raw.replace(/\[[^\]]+\]/g,"").trim();
    if(!text)return;
    matches.forEach((match)=>{
      const minutes=Number(match[1]);
      const seconds=Number(match[2]);
      if(Number.isFinite(minutes)&&Number.isFinite(seconds))lines.push({time:minutes*60+seconds,text});
    });
  });
  return lines.sort((a,b)=>a.time-b.time);
}

function plainLines(value:string){
  return value.split(/\r?\n+/).map((line)=>line.trim()).filter(Boolean);
}

const PROJECT_LIBRARY_KEY="pulse-studio::project-library-v1";

function storageKey(song:Pick<StudioSong,"title"|"artist">){
  return "pulse-studio::"+(song.title+"::"+song.artist).normalize("NFKC").toLocaleLowerCase("en");
}

function literalStorageKey(song:Pick<StudioSong,"title"|"artist">){
  return storageKey(song)+"::literal-meaning";
}

function toneStorageKey(song:Pick<StudioSong,"title"|"artist">){
  return storageKey(song)+"::tone-pattern";
}

function cleanTonePattern(value:string){
  return value.toLocaleUpperCase("en").replace(/[^NHS\s,]/g,"").replace(/\s+/g," ").trimStart();
}

function lyricToneUnits(value:string){
  const clean=value.replace(/[?!！？]/g," ");
  const mixed=clean.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu)??[];
  return mixed.filter((unit)=>/[\p{L}\p{N}]/u.test(unit));
}

function toneSlotValues(value:string,count:number){
  const raw=value.includes(",")?value.split(","):value.trim().split(/\s+/);
  return Array.from({length:count},(_,index)=>/^[NHS]$/.test(raw[index]??"")?raw[index]:"");
}

function normalizedLine(value:string){
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/^\s*(?:[-–—•*]|\d+[.)])\s*/,"").replace(/\s+/g," ").trim();
}

function literalLines(value:string,originals:string[]){
  const originalSet=new Set(originals.map(normalizedLine));
  return value.split(/\r?\n/)
    .map((line)=>line.replace(/^\s*(?:[-–—•*]|\d+[.)])\s*/,"").trim())
    .filter(Boolean)
    .filter((line)=>!originalSet.has(normalizedLine(line)))
    .filter((line)=>!/^(?:bản dịch|dịch sát nghĩa|nghĩa tiếng việt)\s*:?$/i.test(line));
}

function safeFileName(value:string){
  return value.normalize("NFKC").replace(/[\\/:*?"<>|]+/g,"-").trim().slice(0,120)||"lyric-translation";
}
function escapeWordHtml(value:string){
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}

async function copyText(value:string){
  try{
    await navigator.clipboard.writeText(value);
  }catch{
    const area=document.createElement("textarea");
    area.value=value;area.style.position="fixed";area.style.opacity="0";
    document.body.appendChild(area);area.select();document.execCommand("copy");area.remove();
  }
}

export default function LyricStudio(){
  const [query,setQuery]=useState("");
  const [lookupState,setLookupState]=useState<LookupState>("idle");
  const [lookupNote,setLookupNote]=useState("Tìm bằng tên bài hát, có thể kèm hoặc không kèm tên ca sĩ.");
  const [result,setResult]=useState<SearchResult|null>(null);
  const [song,setSong]=useState<StudioSong|null>(null);
  const [manualLyrics,setManualLyrics]=useState("");
  const [translations,setTranslations]=useState<Record<number,string>>({});
  const [literalMeanings,setLiteralMeanings]=useState<Record<number,string>>({});
  const [tonePatterns,setTonePatterns]=useState<Record<number,string>>({});
  const [savedProjects,setSavedProjects]=useState<SavedProject[]>([]);
  const [saveNote,setSaveNote]=useState("Chưa có thay đổi để lưu.");
  const [literalDraft,setLiteralDraft]=useState("");
  const [literalNote,setLiteralNote]=useState("Dán bản dịch sát nghĩa; hệ thống sẽ ghép lần lượt với từng câu gốc.");
  const [ytReady,setYtReady]=useState(()=>typeof window!=="undefined"&&Boolean(window.YT?.Player));
  const [currentTime,setCurrentTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const [playerState,setPlayerState]=useState("WAITING");
  const [followPlayback,setFollowPlayback]=useState(true);
  const [editingLine,setEditingLine]=useState<number|null>(null);
  const [question,setQuestion]=useState("");
  const [replyDraft,setReplyDraft]=useState("");
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>([
    {role:"assistant",text:"Chọn Hỏi tại một câu để tạo yêu cầu dịch sát nghĩa, hoặc sao chép yêu cầu dịch toàn bài ở nút phía dưới."}
  ]);
  const [copied,setCopied]=useState(false);
  const playerMountRef=useRef<HTMLDivElement|null>(null);
  const playerRef=useRef<YTPlayer|null>(null);
  const timerRef=useRef<number|undefined>(undefined);
  const lineRefs=useRef<Array<HTMLDivElement|null>>([]);

  useEffect(()=>{
    const timer=window.setTimeout(()=>{
      try{
        const saved=JSON.parse(localStorage.getItem(PROJECT_LIBRARY_KEY)??"[]") as SavedProject[];
        setSavedProjects(Array.isArray(saved)?saved.filter((project)=>project?.version===1&&project.song?.videoId):[]);
      }catch{setSavedProjects([]);}
    },0);
    return()=>window.clearTimeout(timer);
  },[]);

  useEffect(()=>{
    if(window.YT?.Player){window.setTimeout(()=>setYtReady(true),0);return;}
    const existing=document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    window.onYouTubeIframeAPIReady=()=>setYtReady(true);
    if(!existing){
      const script=document.createElement("script");
      script.src="https://www.youtube.com/iframe_api";
      script.async=true;document.head.appendChild(script);
    }
  },[]);

  useEffect(()=>{
    if(!song||!ytReady||!window.YT?.Player||!playerMountRef.current)return;
    if(timerRef.current)window.clearInterval(timerRef.current);
    playerRef.current?.destroy();
    playerMountRef.current.innerHTML="";
    const player=new window.YT.Player(playerMountRef.current,{
      videoId:song.videoId,
      playerVars:{playsinline:1,rel:0,modestbranding:1},
      events:{
        onReady:({target})=>{
          playerRef.current=target;
          setDuration(target.getDuration()||0);
          setPlayerState("READY");
        },
        onStateChange:({data})=>{
          setPlayerState(data===1?"PLAYING":data===2?"PAUSED":data===0?"ENDED":"READY");
          if(data===1){
            if(timerRef.current)window.clearInterval(timerRef.current);
            timerRef.current=window.setInterval(()=>{
              const active=playerRef.current;
              if(active){
                setCurrentTime(active.getCurrentTime()||0);
                setDuration(active.getDuration()||0);
              }
            },250);
          }else if(timerRef.current){
            window.clearInterval(timerRef.current);timerRef.current=undefined;
          }
        }
      }
    });
    return()=>{
      if(timerRef.current)window.clearInterval(timerRef.current);
      timerRef.current=undefined;
      player.destroy();
    };
  },[song,ytReady]);

  useEffect(()=>{
    if(!song)return;
    const timer=window.setTimeout(()=>{
      const project:SavedProject={version:1,key:storageKey(song),song,translations,literalMeanings,tonePatterns,updatedAt:new Date().toISOString()};
      setSavedProjects((current)=>{
        const next=[project,...current.filter((item)=>item.key!==project.key)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20);
        try{localStorage.setItem(PROJECT_LIBRARY_KEY,JSON.stringify(next));}catch{}
        return next;
      });
      setSaveNote("Đã tự lưu lúc "+new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}));
    },350);
    return()=>window.clearTimeout(timer);
  },[song,translations,literalMeanings,tonePatterns]);

  const syncedTimeline=useMemo(()=>parseTimedLyrics(song?.syncedLyrics??""),[song?.syncedLyrics]);
  const timeline=useMemo(()=>{
    if(syncedTimeline.length)return syncedTimeline;
    const lines=plainLines(song?.lyrics??"");
    const usableDuration=duration>0?duration:Math.max(lines.length*4,1);
    return lines.map((text,index)=>({time:index*(usableDuration/Math.max(lines.length,1)),text}));
  },[song?.lyrics,syncedTimeline,duration]);
  const currentLineIndex=useMemo(()=>{
    let active=-1;
    for(let index=0;index<timeline.length;index+=1){
      if(currentTime+0.15>=timeline[index].time)active=index;else break;
    }
    return active;
  },[currentTime,timeline]);
  const currentVietnameseDraft=useMemo(()=>timeline
    .map((_,index)=>(translations[index]??"").trim())
    .filter(Boolean)
    .join("\n"),[timeline,translations]);
  const completedVietnameseLines=useMemo(()=>timeline
    .filter((_,index)=>(translations[index]??"").trim())
    .length,[timeline,translations]);

  useEffect(()=>{
    if(currentLineIndex>=0&&followPlayback&&editingLine===null)lineRefs.current[currentLineIndex]?.scrollIntoView({behavior:"smooth",block:"center"});
  },[currentLineIndex,followPlayback,editingLine]);

  const searchSong=async()=>{
    const term=query.trim();
    if(!term)return;
    setLookupState("searching");setLookupNote("Đang tìm trên YouTube và thư viện lyric miễn phí…");setResult(null);
    try{
      const encoded=encodeURIComponent(term);
      const [videoResponse,lyricsResponse]=await Promise.all([
        fetch("/api/youtube-search?q="+encoded+"%20official%20music%20video",{signal:AbortSignal.timeout(12000)}),
        fetch("/api/lyrics-search?title="+encoded+"&artist=",{signal:AbortSignal.timeout(12000)})
      ]);
      if(!videoResponse.ok)throw new Error("Không tìm thấy video YouTube có thể phát.");
      const video=await videoResponse.json() as {videoId?:string};
      if(!video.videoId)throw new Error("Kết quả video chưa đầy đủ.");
      let lyricsPayload:LyricsPayload={};
      if(lyricsResponse.ok)lyricsPayload=await lyricsResponse.json() as LyricsPayload;
      const nextResult:SearchResult={
        videoId:video.videoId,
        title:lyricsPayload.matchedTrack?.trim()||term,
        artist:lyricsPayload.matchedArtist?.trim()||"Artist from YouTube result",
        lyrics:String(lyricsPayload.lyrics??"").trim(),
        syncedLyrics:String(lyricsPayload.syncedLyrics??"").trim()
      };
      setResult(nextResult);setLookupState("ready");
      setLookupNote(nextResult.lyrics?(nextResult.syncedLyrics?"Đã tìm thấy lyric đồng bộ — sẵn sàng chạy sáng từng câu.":"Đã tìm thấy lyric thường — hệ thống sẽ tự canh thời gian gần đúng."):"Đã tìm thấy video nhưng chưa có lyric. Bạn có thể dán lyric gốc sau khi đưa bài vào studio.");
    }catch(error){
      setLookupState("error");setLookupNote(error instanceof Error?error.message:"Tìm kiếm thất bại. Hãy nhập rõ hơn tên bài hát và ca sĩ.");
    }
  };

  const applySong=()=>{
    if(!result)return;
    setSong(result);setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setManualLyrics("");setFollowPlayback(true);setEditingLine(null);
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey(result))??"{}") as Record<number,string>;
      setTranslations(saved);
    }catch{setTranslations({});}
    try{
      const savedLiteral=JSON.parse(localStorage.getItem(literalStorageKey(result))??"{}") as Record<number,string>;
      setLiteralMeanings(savedLiteral);
    }catch{setLiteralMeanings({});}
    try{
      const savedTones=JSON.parse(localStorage.getItem(toneStorageKey(result))??"{}") as Record<number,string>;
      setTonePatterns(savedTones);
    }catch{setTonePatterns({});}
    setLiteralDraft("");
    setLiteralNote("Dán bản dịch sát nghĩa; hệ thống sẽ ghép lần lượt với từng câu gốc.");
  };

  const resumeProject=(project:SavedProject)=>{
    setSong(project.song);
    setTranslations(project.translations??{});
    setLiteralMeanings(project.literalMeanings??{});
    setTonePatterns(project.tonePatterns??{});
    setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setFollowPlayback(true);setEditingLine(null);
    setSaveNote("Đã mở bản lưu gần nhất.");
    window.setTimeout(()=>document.querySelector(".studio-workspace")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  };

  const exportProject=(project?:SavedProject)=>{
    const selected=project??(song?{version:1 as const,key:storageKey(song),song,translations,literalMeanings,tonePatterns,updatedAt:new Date().toISOString()}:null);
    if(!selected)return;
    const blob=new Blob([JSON.stringify(selected,null,2)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(selected.song.artist+" - "+selected.song.title+" - Pulse Studio")+".json";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const importProject=async(file:File|null)=>{
    if(!file)return;
    try{
      const candidate=JSON.parse(await file.text()) as SavedProject;
      if(candidate.version!==1||!candidate.song?.videoId||!candidate.song?.title||!candidate.song?.artist)throw new Error("invalid");
      const project:SavedProject={...candidate,key:storageKey(candidate.song),translations:candidate.translations??{},literalMeanings:candidate.literalMeanings??{},tonePatterns:candidate.tonePatterns??{},updatedAt:new Date().toISOString()};
      setSavedProjects((current)=>{
        const next=[project,...current.filter((item)=>item.key!==project.key)].slice(0,20);
        try{localStorage.setItem(PROJECT_LIBRARY_KEY,JSON.stringify(next));}catch{}
        return next;
      });
      resumeProject(project);
      setSaveNote("Đã nhập và khôi phục bản dự phòng.");
    }catch{setSaveNote("File dự phòng không hợp lệ hoặc đã bị hỏng.");}
  };

  const applyManualLyrics=()=>{
    if(!song||!manualLyrics.trim())return;
    const next={...song,lyrics:manualLyrics.trim(),syncedLyrics:""};
    setSong(next);setManualLyrics("");
  };

  const applyLiteralDraft=()=>{
    if(!song||!timeline.length||!literalDraft.trim())return;
    const parsed=literalLines(literalDraft,timeline.map((line)=>line.text));
    const next:Record<number,string>={...literalMeanings};
    parsed.slice(0,timeline.length).forEach((line,index)=>{next[index]=line;});
    setLiteralMeanings(next);
    try{localStorage.setItem(literalStorageKey(song),JSON.stringify(next));}catch{}
    setLiteralNote(parsed.length===timeline.length
      ?"Đã ghép đủ "+parsed.length+" câu dịch sát nghĩa với lời gốc."
      :"Đã ghép "+Math.min(parsed.length,timeline.length)+"/"+timeline.length+" câu. Bạn có thể sửa trực tiếp từng dòng còn thiếu.");
  };

  const updateLiteralMeaning=(index:number,value:string)=>{
    setLiteralMeanings((current)=>{
      const next={...current,[index]:value};
      if(song)try{localStorage.setItem(literalStorageKey(song),JSON.stringify(next));}catch{}
      return next;
    });
  };

  const updateTonePattern=(index:number,value:string)=>{
    setTonePatterns((current)=>{
      const next={...current,[index]:cleanTonePattern(value)};
      if(song)try{localStorage.setItem(toneStorageKey(song),JSON.stringify(next));}catch{}
      return next;
    });
  };

  const updateToneSlot=(lineIndex:number,slotIndex:number,value:string)=>{
    const count=lyricToneUnits(timeline[lineIndex]?.text??"").length;
    const slots=toneSlotValues(tonePatterns[lineIndex]??"",count);
    slots[slotIndex]=value.toLocaleUpperCase("en").replace(/[^NHS]/g,"").slice(-1);
    updateTonePattern(lineIndex,slots.join(","));
  };

  const updateTranslation=(index:number,value:string)=>{
    setTranslations((current)=>{
      const next={...current,[index]:value};
      if(song)try{localStorage.setItem(storageKey(song),JSON.stringify(next));}catch{}
      return next;
    });
  };

  const togglePlayback=()=>{
    const player=playerRef.current;
    if(!player)return;
    if(playerState==="PLAYING")player.pauseVideo();else player.playVideo();
  };

  const seekBy=(seconds:number)=>{
    const player=playerRef.current;
    if(!player)return;
    player.seekTo(Math.max(0,Math.min(duration||Infinity,currentTime+seconds)),true);
  };

  const playLine=(index:number)=>{
    const player=playerRef.current;
    const line=timeline[index];
    if(!player||!line)return;
    player.seekTo(line.time,true);
    setCurrentTime(line.time);
    setFollowPlayback(true);
    player.playVideo();
  };

  const restartSong=()=>{
    const player=playerRef.current;
    if(!player)return;
    player.seekTo(0,true);
    setCurrentTime(0);
    setFollowPlayback(true);
    player.playVideo();
  };

  const replayWorkingLine=()=>{
    const index=editingLine??currentLineIndex;
    if(index>=0)playLine(index);
  };

  const downloadTranslation=()=>{
    if(!song||!timeline.length)return;
    const content=timeline.map((line,index)=>[line.text,literalMeanings[index]??"",translations[index]??""].filter(Boolean).join("\n")).join("\n\n");
    const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(song.artist+" - "+song.title+" - Vietnamese")+".txt";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const downloadVietnameseWord=()=>{
    if(!song)return;
    const vietnameseLines=timeline.map((_,index)=>(translations[index]??"").trim()).filter(Boolean);
    if(!vietnameseLines.length)return;
    const title=escapeWordHtml(song.title);
    const artist=escapeWordHtml(song.artist);
    const body=vietnameseLines.map((line)=>"<p>"+escapeWordHtml(line)+"</p>").join("");
    const documentHtml='<!doctype html><html><head><meta charset="utf-8"><style>@page{margin:2.2cm}body{font-family:Arial,\"Times New Roman\",sans-serif;color:#111;line-height:1.55}h1{font-size:20pt;margin:0 0 6pt}h2{font-size:11pt;font-weight:normal;color:#555;margin:0 0 24pt}.lyrics p{font-size:12pt;margin:0 0 5pt}</style></head><body><h1>'+title+'</h1><h2>'+artist+'</h2><div class="lyrics">'+body+'</div></body></html>';
    const blob=new Blob(["\ufeff",documentHtml],{type:"application/msword;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(song.artist+" - "+song.title+" - Lời Việt")+".doc";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const fullSongTranslationRequest=()=>{
    if(!song||!timeline.length)return "";
    return "Dịch sát nghĩa lời bài hát \""+song.title+"\" của "+song.artist+":\n\n"+timeline.map((line)=>line.text).join("\n");
  };

  const askChatGPT=async()=>{
    if(!song||!question.trim())return;
    const prompt=question.trim();
    await copyText(prompt);
    setChatMessages((current)=>[...current,{role:"user",text:question.trim()},{role:"assistant",text:"Đã sao chép yêu cầu ngắn gọn. ChatGPT Free đang mở ở tab mới — hãy dán yêu cầu vào đó."}]);
    setQuestion("");setCopied(true);
    window.setTimeout(()=>setCopied(false),2500);
    window.open("https://chatgpt.com/","_blank","noopener,noreferrer");
  };

  const addReplyNote=()=>{
    if(!replyDraft.trim())return;
    setChatMessages((current)=>[...current,{role:"assistant",text:replyDraft.trim()}]);
    setReplyDraft("");
  };

  const useDraftInChat=()=>{
    if(!song||!currentVietnameseDraft)return;
    setQuestion("Góp ý bản lời Việt hiện tại của bài \""+song.title+"\" - "+song.artist+":\n\n"+currentVietnameseDraft);
    window.setTimeout(()=>document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus(),0);
  };

  return <main className="studio-shell">
    <header className="studio-header">
      <Link className="studio-brand" href="/">PULSE <b>STUDIO DỊCH LỜI</b></Link>
      <nav><Link href="/">BẢNG XẾP HẠNG</Link><Link href="/mv-studio/">MV STUDIO</Link><span>KHÔNG GIAN MIỄN PHÍ</span></nav>
    </header>

    <section className="studio-hero">
      <div><p>KHÔNG GIAN DỊCH LỜI BÀI HÁT</p><h1>Nghe từng câu.<br/><em>Viết đúng nghĩa.</em></h1><span>Tìm bài, đồng bộ, dịch và trao đổi từng câu lyric.</span></div>
      <div className="studio-stats"><b>01</b><span>TÌM & ĐƯA BÀI VÀO</span><b>02</b><span>NGHE & VIẾT BẢN DỊCH</span><b>03</b><span>TRAO ĐỔI VỚI CHATGPT</span></div>
    </section>

    <section className="studio-search">
      <label><span>TÊN BÀI HÁT / CA SĨ</span><div><input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void searchSong();}} placeholder="Ví dụ: 光年之外 G.E.M. hoặc Through the Night IU"/><button onClick={searchSong} disabled={lookupState==="searching"||!query.trim()}>{lookupState==="searching"?"ĐANG TÌM…":"TÌM BÀI HÁT"}</button></div></label>
      <p className={"lookup-note "+lookupState}>{lookupNote}</p>
      {result&&<article className="search-result">
        <div className="result-disc"><i/><b>BEST<br/>MATCH</b></div>
        <div><small>ĐÃ TÌM THẤY BÀI</small><h2>{result.title}</h2><p>{result.artist}</p><span>{result.syncedLyrics?"LYRIC ĐỒNG BỘ":result.lyrics?"LYRIC THƯỜNG · TỰ CANH GIỜ":"CHỈ CÓ VIDEO · TỰ DÁN LYRIC"}</span></div>
        <a href={"https://www.youtube.com/watch?v="+result.videoId} target="_blank" rel="noreferrer">KIỂM TRA ↗</a>
        <button onClick={applySong}>ĐƯA VÀO STUDIO</button>
      </article>}
    </section>

    <section className="project-library">
      <div className="project-library-head"><div><small>LƯU CÔNG VIỆC MIỄN PHÍ</small><h2>Bản đang làm</h2><p>Tự lưu trên thiết bị này · xuất file dự phòng để chuyển máy hoặc khôi phục.</p></div><label className="import-project">NHẬP FILE DỰ PHÒNG<input type="file" accept="application/json,.json" onChange={(event)=>{void importProject(event.target.files?.[0]??null);event.currentTarget.value="";}}/></label></div>
      {savedProjects.length?<div className="project-list">{savedProjects.slice(0,8).map((project)=><article key={project.key}><div><b>{project.song.title}</b><span>{project.song.artist}</span><small>{new Date(project.updatedAt).toLocaleString("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</small></div><div><button onClick={()=>resumeProject(project)}>MỞ LẠI</button><button onClick={()=>exportProject(project)}>TẢI BACKUP</button></div></article>)}</div>:<p className="project-empty">Chưa có bản lưu. Khi bạn đưa một bài vào Studio và bắt đầu viết, hệ thống sẽ tự tạo bản lưu đầu tiên.</p>}
    </section>

    {!song?<section className="studio-empty"><div>♪</div><h2>Bàn dịch lyric đã sẵn sàng.</h2><p>Hãy tìm một bài hát, kiểm tra kết quả rồi đưa bài vào studio để bắt đầu.</p></section>:
    <section className="studio-workspace">
      <div className="translation-column">
        <div className="workspace-title"><div><small>ĐANG DỊCH</small><h2>{song.title}</h2><p>{song.artist}</p></div><div><span>{song.syncedLyrics?"LRC ĐỒNG BỘ":"CANH GIỜ TỰ ĐỘNG"}</span><button onClick={downloadTranslation} disabled={!timeline.length}>XUẤT BẢN SONG NGỮ .TXT</button><button onClick={downloadVietnameseWord} disabled={!Object.values(translations).some((value)=>value.trim())}>XUẤT LỜI VIỆT .DOC</button><button onClick={()=>exportProject()} disabled={!song}>TẢI DỰ PHÒNG .JSON</button><small className="save-note">{saveNote}</small></div></div>

        <div className="player-card">
          <div ref={playerMountRef} className="youtube-mount"/>
          <div className="player-meta"><span className={playerState==="PLAYING"?"live":""}>{playerState==="PLAYING"?"ĐANG PHÁT":playerState==="PAUSED"?"TẠM DỪNG":playerState==="ENDED"?"ĐÃ PHÁT XONG":playerState==="READY"?"SẴN SÀNG":"ĐANG TẢI"}</span><b>{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")} / {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,"0")}</b><p>{currentLineIndex>=0?"CÂU "+String(currentLineIndex+1).padStart(2,"0")+" / "+String(timeline.length).padStart(2,"0"):"NHẤN PHÁT ĐỂ CHẠY THEO LYRIC"}</p></div>
        </div>

        <div className="sticky-player">
          <div className="sticky-track"><span className={playerState==="PLAYING"?"pulse":""}>♪</span><div><b>{song.title}</b><small>{currentLineIndex>=0?(timeline[currentLineIndex]?.text??""):"Sẵn sàng chạy theo lyric"}</small></div></div>
          <div className="sticky-progress"><i style={{width:(duration>0?Math.min(100,currentTime/duration*100):0)+"%"}}/></div>
          <div className="sticky-time">{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")}</div>
          <div className="sticky-controls">
            <button onClick={restartSong}>VỀ ĐẦU</button>
            <button onClick={()=>seekBy(-5)}>−5s</button>
            <button className="main-control" onClick={togglePlayback}>{playerState==="PLAYING"?"TẠM DỪNG":"PHÁT"}</button>
            <button onClick={replayWorkingLine} disabled={currentLineIndex<0&&editingLine===null}>PHÁT LẠI CÂU</button>
            <button className={followPlayback?"follow-on":""} onClick={()=>setFollowPlayback((value)=>!value)}>{followPlayback?"ĐANG BÁM THEO":"ĐANG KHÓA VỊ TRÍ"}</button>
          </div>
        </div>

        {!timeline.length&&<div className="manual-lyrics"><h3>Không tìm thấy lyric gốc</h3><p>Dán lyric gốc vào dưới đây. Mỗi dòng không trống sẽ trở thành một câu dịch và được canh giờ gần đúng.</p><textarea value={manualLyrics} onChange={(event)=>setManualLyrics(event.target.value)} placeholder="Dán mỗi câu lyric trên một dòng…"/><button onClick={applyManualLyrics} disabled={!manualLyrics.trim()}>DÙNG LYRIC NÀY</button></div>}

        {timeline.length>0&&<section className="literal-import">
          <div className="literal-import-head"><div><small>BƯỚC ĐỆM · DỊCH SÁT NGHĨA</small><h3>Áp nghĩa tiếng Việt theo từng câu</h3><p>Bản dịch này dùng để hiểu đúng nội dung; ô “Lời Việt” bên dưới vẫn dành cho câu hát bạn sáng tác.</p></div><span>{Object.values(literalMeanings).filter((value)=>value.trim()).length}/{timeline.length} CÂU</span></div>
          <textarea value={literalDraft} onChange={(event)=>setLiteralDraft(event.target.value)} placeholder={"Dán toàn bộ bản dịch sát nghĩa vào đây. Có thể dán dạng:\nLời gốc câu 1\nNghĩa tiếng Việt câu 1\nLời gốc câu 2\nNghĩa tiếng Việt câu 2"} />
          <div className="literal-import-actions"><button onClick={applyLiteralDraft} disabled={!literalDraft.trim()}>ÁP VÀO TỪNG CÂU</button><button onClick={async()=>{await copyText(fullSongTranslationRequest());setCopied(true);window.setTimeout(()=>setCopied(false),2000);}}>{copied?"ĐÃ SAO CHÉP":"SAO CHÉP YÊU CẦU DỊCH TOÀN BÀI"}</button></div>
          <p className="literal-note">{literalNote}</p>
        </section>}

        {timeline.length>0&&<div className="line-editor">
          <div className="line-editor-head"><span>#</span><span>LỜI GỐC · NGHĨA SÁT · LỜI VIỆT</span><span>{song.syncedLyrics?"ĐỒNG BỘ":"GẦN ĐÚNG"}</span></div>
          {timeline.map((line,index)=><div ref={(element)=>{lineRefs.current[index]=element;}} className={"lyric-row "+(index===currentLineIndex?"active ":"")+(index===editingLine?"editing":"")} key={index}>
            <span className="line-number">{String(index+1).padStart(2,"0")}<i>{Math.floor(line.time/60)}:{String(Math.floor(line.time%60)).padStart(2,"0")}</i></span>
            <div className="lyric-writing"><div className="original-line-tools"><button className="line-seek" onClick={()=>playLine(index)} title="Phát lại từ câu này"><span>{line.text}</span><small>▶ BẤM ĐỂ NGHE LẠI TỪ CÂU NÀY</small></button><div className="tone-slot-panel"><div><span>THANH ÂM</span><small>{lyricToneUnits(line.text).length} Ô · N NGANG · H HUYỀN · S SẮC</small></div><div className="tone-slots">{lyricToneUnits(line.text).map((unit,toneIndex)=><input key={toneIndex} maxLength={1} value={toneSlotValues(tonePatterns[index]??"",lyricToneUnits(line.text).length)[toneIndex]} onChange={(event)=>{const value=event.currentTarget.value.toLocaleUpperCase("en").replace(/[^NHS]/g,"").slice(-1);updateToneSlot(index,toneIndex,value);if(value)(event.currentTarget.nextElementSibling as HTMLInputElement|null)?.focus();}} onKeyDown={(event)=>{if(event.key==="Backspace"&&!event.currentTarget.value)(event.currentTarget.previousElementSibling as HTMLInputElement|null)?.focus();}} aria-label={"Thanh âm "+(toneIndex+1)+" cho "+unit} title={unit+" · nhập N, H hoặc S"}/>)}</div></div></div><label className="literal-field"><span>NGHĨA SÁT</span><textarea value={literalMeanings[index]??""} onFocus={()=>{setEditingLine(index);setFollowPlayback(false);}} onBlur={()=>setEditingLine((current)=>current===index?null:current)} onChange={(event)=>updateLiteralMeaning(index,event.target.value)} placeholder="Nghĩa tiếng Việt sát với câu gốc…"/></label><label className="adaptation-field"><span>LỜI VIỆT</span><textarea value={translations[index]??""} onFocus={()=>{setEditingLine(index);setFollowPlayback(false);}} onBlur={()=>setEditingLine((current)=>current===index?null:current)} onChange={(event)=>updateTranslation(index,event.target.value)} placeholder="Viết lyric tiếng Việt có thể hát cho câu này…"/></label></div>
            <button onClick={()=>{setQuestion("Dịch sát nghĩa câu \""+line.text+"\"");document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus();}}>HỎI</button>
          </div>)}
        </div>}
      </div>

      <aside className="chat-column">
        <div className="chat-head"><div className="chat-orb">✦</div><div><small>TRỢ LÝ MIỄN PHÍ</small><h2>Trao đổi với ChatGPT</h2><p>Ý nghĩa · sắc thái · cách diễn đạt tiếng Việt</p></div></div>
        <div className="free-explainer"><b>VÌ SAO PHẢI SAO CHÉP VÀ MỞ TAB?</b><p>ChatGPT không cho phép nhúng miễn phí vào website bên ngoài. Khung này chỉ chuẩn bị một yêu cầu dịch sát nghĩa ngắn gọn, sau đó mở ChatGPT Free để bạn dán yêu cầu mà không phát sinh phí API.</p></div>
        <div className="chat-log">{chatMessages.map((message,index)=><div className={"chat-message "+message.role} key={index}><span>{message.role==="user"?"BẠN":"GPT"}</span><p>{message.text}</p></div>)}</div>
        <section className="current-vietnamese-draft">
          <div className="current-draft-head"><div><small>BẢN NHÁP TRỰC TIẾP</small><h3>Lời Việt hiện tại</h3></div><span>{completedVietnameseLines}/{timeline.length} CÂU</span></div>
          <textarea readOnly value={currentVietnameseDraft} placeholder="Các câu lời Việt bạn vừa viết sẽ tự xuất hiện tại đây theo đúng thứ tự…" aria-label="Bản lời Việt hiện tại"/>
          <div className="current-draft-actions"><button onClick={async()=>{await copyText(currentVietnameseDraft);setCopied(true);window.setTimeout(()=>setCopied(false),2000);}} disabled={!currentVietnameseDraft}>{copied?"ĐÃ SAO CHÉP":"SAO CHÉP BẢN NHÁP"}</button><button onClick={useDraftInChat} disabled={!currentVietnameseDraft}>ĐƯA VÀO Ô HỎI CHATGPT</button></div>
          <p>Ô này cập nhật ngay khi bạn sửa lời Việt; chỉ lấy những câu đã viết và không kèm lời gốc hay nhãn.</p>
        </section>
        <div className="chat-compose"><label>CÂU HỎI CỦA BẠN</label><textarea value={question} onChange={(event)=>setQuestion(event.target.value)} placeholder='Ví dụ: Dịch sát nghĩa câu "..."'/><button onClick={askChatGPT} disabled={!question.trim()||!song}>{copied?"ĐÃ SAO CHÉP — ĐANG MỞ CHATGPT…":"HỎI CHATGPT MIỄN PHÍ ↗"}</button><small>Yêu cầu bạn viết sẽ được sao chép nguyên văn, không chèn thêm ngữ cảnh dài.</small></div>
        <details className="reply-note"><summary>DÁN CÂU TRẢ LỜI HỮU ÍCH TỪ CHATGPT VÀO ĐÂY</summary><textarea value={replyDraft} onChange={(event)=>setReplyDraft(event.target.value)} placeholder="Dán phần giải thích bạn muốn lưu cạnh bản dịch…"/><button onClick={addReplyNote} disabled={!replyDraft.trim()}>THÊM VÀO GHI CHÚ TRAO ĐỔI</button></details>
        <button className="copy-context" onClick={async()=>{await copyText(fullSongTranslationRequest());setCopied(true);window.setTimeout(()=>setCopied(false),2000);}} disabled={!timeline.length}>SAO CHÉP YÊU CẦU DỊCH SÁT NGHĨA TOÀN BÀI</button>
      </aside>
    </section>}

    <footer className="studio-footer"><span>PULSE STUDIO DỊCH LỜI</span><p>Bản dịch được tự lưu trên trình duyệt này. Phát YouTube và tìm lyric qua LRCLIB vẫn hoàn toàn miễn phí.</p><Link href="/">VỀ BẢNG XẾP HẠNG →</Link></footer>
  </main>;
}
