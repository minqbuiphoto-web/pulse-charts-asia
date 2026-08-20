"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import "./studio.css";

type LookupState="idle"|"searching"|"ready"|"error";
type LyricsPayload={lyrics?:string;syncedLyrics?:string;matchedTrack?:string;matchedArtist?:string;matchedDuration?:number|null};
type SearchResult={videoId:string;title:string;artist:string;lyrics:string;syncedLyrics:string};
type StudioSong=SearchResult;
type TimedLine={time:number;text:string};
type ChatMessage={role:"assistant"|"user";text:string};
type SavedProject={
  version:1;
  key:string;
  song:StudioSong;
  videoTimeOffset?:number;
  autoVideoTimes?:number[];
  autoLineConfidences?:number[];
  manualLineTimes?:Record<number,number>;
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
    onError?:(event:{data:number})=>void;
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

function pastedToneValues(value:string){
  const upper=value.toLocaleUpperCase("en");
  if(upper.includes(","))return upper.split(",").map((tone)=>/^[NHS]$/.test(tone.trim())?tone.trim():"");
  return upper.match(/[NHS]/g)??[];
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
function youtubeVideoId(value:string){
  const raw=value.trim();
  if(/^[A-Za-z0-9_-]{11}$/.test(raw))return raw;
  try{
    const candidate=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
    const url=new URL(candidate);
    const host=url.hostname.replace(/^www\./,"").toLocaleLowerCase("en");
    let id="";
    if(host==="youtu.be")id=url.pathname.split("/").filter(Boolean)[0]??"";
    else if(host==="youtube.com"||host==="m.youtube.com"||host==="music.youtube.com"){
      if(url.pathname==="/watch")id=url.searchParams.get("v")??"";
      else{
        const parts=url.pathname.split("/").filter(Boolean);
        if(["shorts","embed","live"].includes(parts[0]??""))id=parts[1]??"";
      }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id)?id:"";
  }catch{return"";}
}
function safeAutoTimes(value:unknown){
  if(!Array.isArray(value)||!value.length)return[] as number[];
  const times=value.map(Number);
  return times.every((time,index)=>Number.isFinite(time)&&time>=0&&(index===0||time>=times[index-1]))?times:[];
}
function safeConfidences(value:unknown,count=Infinity){
  if(!Array.isArray(value))return[] as number[];
  const scores=value.slice(0,count).map(Number);
  return scores.every((score)=>Number.isFinite(score)&&score>=0&&score<=1)?scores:[];
}
function safeManualTimes(value:unknown,count=Infinity){
  if(!value||typeof value!=="object"||Array.isArray(value))return{} as Record<number,number>;
  const output:Record<number,number>={};
  Object.entries(value as Record<string,unknown>).forEach(([key,raw])=>{
    const index=Number(key),time=Number(raw);
    if(Number.isInteger(index)&&index>=0&&index<count&&Number.isFinite(time)&&time>=0)output[index]=time;
  });
  return output;
}
function clockTime(seconds:number){
  const value=Math.max(0,Number(seconds)||0);
  return `${Math.floor(value/60)}:${(value%60).toFixed(2).padStart(5,"0")}`;
}
function lrcTime(seconds:number){
  const value=Math.max(0,seconds);
  const minutes=Math.floor(value/60);
  return `[${String(minutes).padStart(2,"0")}:${(value%60).toFixed(2).padStart(5,"0")}]`;
}
function lyricLanguage(lines:string[]){
  const joined=lines.join("");
  if(/\p{Script=Hangul}/u.test(joined))return"ko";
  if(/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(joined))return"ja";
  if(/\p{Script=Han}/u.test(joined))return"zh";
  if(/[À-ỹĐđ]/u.test(joined))return"vi";
  return"auto";
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
  const [directVideoUrl,setDirectVideoUrl]=useState("");
  const [directVideoNote,setDirectVideoNote]=useState("Dán link video studio hoặc video chính thức để thay video đang lỗi; lyric và phần đang viết được giữ nguyên.");
  const [videoTimeOffset,setVideoTimeOffset]=useState(0);
  const [syncAnchorLine,setSyncAnchorLine]=useState(0);
  const [autoVideoTimes,setAutoVideoTimes]=useState<number[]>([]);
  const [autoLineConfidences,setAutoLineConfidences]=useState<number[]>([]);
  const [manualLineTimes,setManualLineTimes]=useState<Record<number,number>>({});
  const [manualCursor,setManualCursor]=useState(0);
  const [manualAudioUrl,setManualAudioUrl]=useState("");
  const [manualAudioTime,setManualAudioTime]=useState(0);
  const [manualAudioDuration,setManualAudioDuration]=useState(0);
  const [manualAlignStatus,setManualAlignStatus]=useState("Nạp file âm thanh, phát bài và bấm GÁN khi câu đang chọn bắt đầu được hát.");
  const [alignmentFile,setAlignmentFile]=useState<File|null>(null);
  const [autoAlignBusy,setAutoAlignBusy]=useState(false);
  const [autoAlignStatus,setAutoAlignStatus]=useState("Nạp đúng file âm thanh của video để bộ nghe tự tạo mốc cho toàn bộ lyric.");
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
  const [copiedToneLine,setCopiedToneLine]=useState<number|null>(null);
  const playerMountRef=useRef<HTMLDivElement|null>(null);
  const playerRef=useRef<YTPlayer|null>(null);
  const timerRef=useRef<number|undefined>(undefined);
  const lineRefs=useRef<Array<HTMLDivElement|null>>([]);
  const manualAudioRef=useRef<HTMLAudioElement|null>(null);

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
    if(!alignmentFile){setManualAudioUrl("");setManualAudioTime(0);setManualAudioDuration(0);return;}
    const url=URL.createObjectURL(alignmentFile);
    setManualAudioUrl(url);setManualAudioTime(0);setManualAudioDuration(0);
    return()=>URL.revokeObjectURL(url);
  },[alignmentFile]);

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
    try{playerRef.current?.destroy();}catch{}
    playerRef.current=null;
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
        },
        onError:()=>{setPlayerState("VIDEO_ERROR");setDirectVideoNote("Video này không cho phát nhúng. Hãy dán một link YouTube khác bên dưới.")}
      }
    });
    return()=>{
      if(timerRef.current)window.clearInterval(timerRef.current);
      timerRef.current=undefined;
      if(playerRef.current===player)playerRef.current=null;
      try{player.destroy();}catch{}
    };
  },[song,ytReady]);

  useEffect(()=>{
    if(!song)return;
    const timer=window.setTimeout(()=>{
      const project:SavedProject={version:1,key:storageKey(song),song,videoTimeOffset,autoVideoTimes,autoLineConfidences,manualLineTimes,translations,literalMeanings,tonePatterns,updatedAt:new Date().toISOString()};
      setSavedProjects((current)=>{
        const next=[project,...current.filter((item)=>item.key!==project.key)].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20);
        try{localStorage.setItem(PROJECT_LIBRARY_KEY,JSON.stringify(next));}catch{}
        return next;
      });
      setSaveNote("Đã tự lưu lúc "+new Date().toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"}));
    },350);
    return()=>window.clearTimeout(timer);
  },[song,videoTimeOffset,autoVideoTimes,autoLineConfidences,manualLineTimes,translations,literalMeanings,tonePatterns]);

  const syncedTimeline=useMemo(()=>parseTimedLyrics(song?.syncedLyrics??""),[song?.syncedLyrics]);
  const baseTimeline=useMemo(()=>{
    if(syncedTimeline.length)return syncedTimeline;
    const lines=plainLines(song?.lyrics??"");
    const usableDuration=duration>0?duration:Math.max(lines.length*4,1);
    return lines.map((text,index)=>({time:index*(usableDuration/Math.max(lines.length,1)),text}));
  },[song?.lyrics,syncedTimeline,duration]);
  const hasAutoTimeline=baseTimeline.length>0&&autoVideoTimes.length===baseTimeline.length;
  const hasAlignmentConfidence=hasAutoTimeline&&autoLineConfidences.length===baseTimeline.length;
  const manualAssignedCount=useMemo(()=>baseTimeline.filter((_,index)=>Number.isFinite(manualLineTimes[index])).length,[baseTimeline,manualLineTimes]);
  const manualCursorAssignedTime=manualLineTimes[manualCursor];
  const hasCompleteManualTimeline=baseTimeline.length>0&&manualAssignedCount===baseTimeline.length;
  const hasUsableTimeline=hasCompleteManualTimeline||hasAutoTimeline||syncedTimeline.length===baseTimeline.length;
  const timeline=useMemo(()=>baseTimeline.map((line,index)=>{
    const manual=manualLineTimes[index];
    const source=Number.isFinite(manual)?manual:hasAutoTimeline?autoVideoTimes[index]:line.time;
    return {...line,time:Math.max(0,source+videoTimeOffset)};
  }),[baseTimeline,manualLineTimes,autoVideoTimes,videoTimeOffset,hasAutoTimeline]);
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
      const videoResponse=await fetch("/api/youtube-search?q="+encoded+"%20official%20music%20video",{signal:AbortSignal.timeout(12000)});
      if(!videoResponse.ok)throw new Error("Không tìm thấy video YouTube có thể phát.");
      const video=await videoResponse.json() as {videoId?:string;durationSeconds?:number|null;channel?:string};
      if(!video.videoId)throw new Error("Kết quả video chưa đầy đủ.");
      const videoArtist=String(video.channel??"").replace(/\s*-\s*Topic\s*$/i,"").trim();
      const lyricsParams=new URLSearchParams({title:term,artist:videoArtist});
      if(Number.isFinite(video.durationSeconds)&&Number(video.durationSeconds)>0)lyricsParams.set("duration",String(Math.round(Number(video.durationSeconds))));
      const lyricsResponse=await fetch("/api/lyrics-search?"+lyricsParams.toString(),{signal:AbortSignal.timeout(12000)});
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
      const videoSeconds=Number(video.durationSeconds)||0;
      const lyricSeconds=Number(lyricsPayload.matchedDuration)||0;
      const durationMatch=videoSeconds>0&&lyricSeconds>0&&Math.abs(videoSeconds-lyricSeconds)<=8;
      setLookupNote(nextResult.lyrics?(nextResult.syncedLyrics?"Đã tìm thấy lyric đồng bộ đúng bản — sẵn sàng chạy sáng từng câu.":durationMatch?`Đã chọn lyric đúng bản (${Math.round(lyricSeconds)}s) gần video (${Math.round(videoSeconds)}s). Bản này chưa có mốc từng câu; nạp file âm thanh để bộ nghe tự gắn chính xác.`:"Đã tìm thấy lyric thường nhưng chưa có mốc từng câu — nạp file âm thanh để bộ nghe tự gắn chính xác."):"Đã tìm thấy video nhưng chưa có lyric. Bạn có thể dán lyric gốc sau khi đưa bài vào studio.");
    }catch(error){
      setLookupState("error");setLookupNote(error instanceof Error?error.message:"Tìm kiếm thất bại. Hãy nhập rõ hơn tên bài hát và ca sĩ.");
    }
  };

  const applySong=()=>{
    if(!result)return;
    setSong(result);setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setManualLyrics("");setFollowPlayback(true);setEditingLine(null);setVideoTimeOffset(0);setAutoVideoTimes([]);setAutoLineConfidences([]);setManualLineTimes({});setManualCursor(0);setAlignmentFile(null);setSyncAnchorLine(0);
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
    setVideoTimeOffset(Number.isFinite(project.videoTimeOffset)?Number(project.videoTimeOffset):0);
    setAutoVideoTimes(safeAutoTimes(project.autoVideoTimes));setAutoLineConfidences(safeConfidences(project.autoLineConfidences));setManualLineTimes(safeManualTimes(project.manualLineTimes));setManualCursor(0);setAlignmentFile(null);
    setSyncAnchorLine(0);
    setTranslations(project.translations??{});
    setLiteralMeanings(project.literalMeanings??{});
    setTonePatterns(project.tonePatterns??{});
    setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setFollowPlayback(true);setEditingLine(null);
    setSaveNote("Đã mở bản lưu gần nhất.");
    window.setTimeout(()=>document.querySelector(".studio-workspace")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
  };

  const exportProject=(project?:SavedProject)=>{
    const selected=project??(song?{version:1 as const,key:storageKey(song),song,videoTimeOffset,autoVideoTimes,autoLineConfidences,manualLineTimes,translations,literalMeanings,tonePatterns,updatedAt:new Date().toISOString()}:null);
    if(!selected)return;
    const blob=new Blob([JSON.stringify(selected,null,2)],{type:"application/json;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(selected.song.artist+" - "+selected.song.title+" - Pulse Studio")+".json";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const removeProject=(project:SavedProject)=>{
    if(!window.confirm(`Xóa bản tạm “${project.song.title}” khỏi thiết bị này?\n\nHành động này sẽ xóa cả lời Việt, nghĩa sát, thanh âm và timeline AI của bài.`))return;
    setSavedProjects((current)=>{
      const next=current.filter((item)=>item.key!==project.key);
      try{localStorage.setItem(PROJECT_LIBRARY_KEY,JSON.stringify(next));}catch{}
      return next;
    });
    try{
      localStorage.removeItem(project.key);
      localStorage.removeItem(literalStorageKey(project.song));
      localStorage.removeItem(toneStorageKey(project.song));
    }catch{}
    if(song&&storageKey(song)===project.key){
      setSong(null);setTranslations({});setLiteralMeanings({});setTonePatterns({});setAutoVideoTimes([]);setAutoLineConfidences([]);setManualLineTimes({});setAlignmentFile(null);setVideoTimeOffset(0);setCurrentTime(0);setDuration(0);setPlayerState("WAITING");
    }
    setSaveNote(`Đã xóa bản tạm “${project.song.title}”.`);
  };

  const importProject=async(file:File|null)=>{
    if(!file)return;
    try{
      const candidate=JSON.parse(await file.text()) as SavedProject;
      if(candidate.version!==1||!candidate.song?.videoId||!candidate.song?.title||!candidate.song?.artist)throw new Error("invalid");
      const project:SavedProject={...candidate,key:storageKey(candidate.song),videoTimeOffset:Number.isFinite(candidate.videoTimeOffset)?Number(candidate.videoTimeOffset):0,autoVideoTimes:safeAutoTimes(candidate.autoVideoTimes),autoLineConfidences:safeConfidences(candidate.autoLineConfidences),manualLineTimes:safeManualTimes(candidate.manualLineTimes),translations:candidate.translations??{},literalMeanings:candidate.literalMeanings??{},tonePatterns:candidate.tonePatterns??{},updatedAt:new Date().toISOString()};
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

  const pasteToneSlots=(lineIndex:number,slotIndex:number,value:string)=>{
    const pasted=pastedToneValues(value);
    if(!pasted.length)return;
    const count=lyricToneUnits(timeline[lineIndex]?.text??"").length;
    const slots=toneSlotValues(tonePatterns[lineIndex]??"",count);
    pasted.slice(0,count-slotIndex).forEach((tone,index)=>{slots[slotIndex+index]=tone;});
    updateTonePattern(lineIndex,slots.join(","));
  };

  const copyToneSlots=async(lineIndex:number)=>{
    const count=lyricToneUnits(timeline[lineIndex]?.text??"").length;
    await copyText(toneSlotValues(tonePatterns[lineIndex]??"",count).join(","));
    setCopiedToneLine(lineIndex);
    window.setTimeout(()=>setCopiedToneLine((current)=>current===lineIndex?null:current),1600);
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
    const videoTime=Math.max(0,line.time);
    player.seekTo(videoTime,true);
    setCurrentTime(videoTime);
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

  const downloadLrc=()=>{
    if(!song||!baseTimeline.length)return;
    const generated=hasCompleteManualTimeline?baseTimeline.map((line,index)=>lrcTime(manualLineTimes[index])+line.text).join("\n"):hasAutoTimeline?baseTimeline.map((line,index)=>lrcTime(autoVideoTimes[index])+line.text).join("\n"):"";
    const content=generated||song.syncedLyrics.trim();
    if(!content)return;
    const blob=new Blob(["\ufeff",content],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(song.artist+" - "+song.title)+".lrc";
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

  const applyDirectVideo=()=>{
    const videoId=youtubeVideoId(directVideoUrl);
    if(!videoId){setDirectVideoNote("Link chưa hợp lệ. Hãy dán link YouTube dạng watch, youtu.be, Shorts, Live hoặc Embed.");return;}
    if(song){
      setSong((current)=>current?{...current,videoId}:current);
      setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setVideoTimeOffset(0);setAutoVideoTimes([]);setAutoLineConfidences([]);setManualLineTimes({});setManualCursor(0);setAlignmentFile(null);setSyncAnchorLine(0);setFollowPlayback(true);setEditingLine(null);
      setDirectVideoNote("Đã thay video và giữ nguyên toàn bộ lyric. Hãy nạp đúng file âm thanh của video để hệ thống tự nghe và gắn lại.");
      setAutoAlignStatus("Video đã thay đổi; cần nghe file âm thanh đúng bản một lần để tạo timeline mới.");
    }else if(result){
      setResult({...result,videoId});
      setLookupState("ready");
      setDirectVideoNote("Đã gắn link vào kết quả. Bấm ĐƯA VÀO STUDIO để bắt đầu.");
    }else{
      const title=query.trim()||"Video YouTube";
      setResult({videoId,title,artist:"Chưa xác định",lyrics:"",syncedLyrics:""});
      setLookupState("ready");
      setLookupNote("Đã nhận link trực tiếp. Bạn có thể đưa video vào Studio rồi dán lyric gốc.");
      setDirectVideoNote("Đã nhận link trực tiếp.");
    }
  };

  const alignVideoToLyric=()=>{
    const player=playerRef.current,line=baseTimeline[syncAnchorLine];
    if(!player||!line){setDirectVideoNote("Hãy phát video và chọn một câu lyric hợp lệ để canh.");return;}
    const videoTime=player.getCurrentTime();
    if(!Number.isFinite(videoTime)){setDirectVideoNote("Chưa đọc được thời gian video. Hãy bấm phát rồi thử lại.");return;}
    const sourceTime=hasAutoTimeline?autoVideoTimes[syncAnchorLine]:line.time;
    const next=Math.max(-180,Math.min(180,videoTime-sourceTime));
    setVideoTimeOffset(next);setCurrentTime(videoTime);setFollowPlayback(true);setEditingLine(null);
    setDirectVideoNote(`Đã canh câu ${String(syncAnchorLine+1).padStart(2,"0")} tại ${Math.floor(videoTime/60)}:${String(Math.floor(videoTime%60)).padStart(2,"0")}. Toàn bộ lyric và nút phát lại câu đã dùng mốc mới.`);
  };

  const ensureAlignmentEngine=async()=>{
    const probe=async()=>{try{const response=await fetch("http://127.0.0.1:8765/health",{signal:AbortSignal.timeout(3500)});if(!response.ok)return false;const health=await response.json() as {alignment?:boolean;forcedAlignmentV2?:boolean;alignmentConfidence?:boolean;lyricPromptRecognition?:boolean;whisperTurbo?:boolean};return Boolean(health.alignment&&health.forcedAlignmentV2&&health.alignmentConfidence&&health.lyricPromptRecognition&&health.whisperTurbo)}catch{return false}};
    if(await probe())return true;
    const launcher=document.createElement("iframe");launcher.hidden=true;launcher.src="pulsecharts-audio://start";document.body.appendChild(launcher);window.setTimeout(()=>launcher.remove(),3500);
    for(let attempt=0;attempt<8;attempt+=1){await new Promise((resolve)=>window.setTimeout(resolve,1200));if(await probe())return true;}
    return false;
  };

  const autoAlignVideoLyrics=async()=>{
    if(!alignmentFile||!baseTimeline.length){setAutoAlignStatus("Hãy nạp file âm thanh và bảo đảm bài đã có lyric gốc.");return;}
    setAutoAlignBusy(true);setAutoAlignStatus("Đang mở bộ nghe trên máy…");
    try{
      if(!await ensureAlignmentEngine())throw new Error("Bộ nghe cũ chưa hỗ trợ căn chỉnh mới. Hãy chạy CÀI / CẬP NHẬT TỰ ĐỘNG một lần rồi thử lại.");
      setAutoAlignStatus("Bộ nghe mới đang đối chiếu lyric với giọng hát. Nếu lượt đầu chưa đủ tin cậy, hệ thống sẽ tự tách giọng và nghe lại…");
      const sourceLines=baseTimeline.map((line)=>line.text);
      const form=new FormData();form.append("file",alignmentFile,alignmentFile.name||"song.wav");form.append("lyrics",sourceLines.join("\n"));form.append("language",lyricLanguage(sourceLines));
      if(syncedTimeline.length===sourceLines.length)form.append("reference_times",JSON.stringify(syncedTimeline.map((line)=>line.time)));
      const response=await fetch("http://127.0.0.1:8765/align-lyrics",{method:"POST",body:form});
      if(!response.ok){let detail="";try{detail=((await response.json()) as {detail?:string}).detail||""}catch{}throw new Error(detail||`Bộ nghe báo lỗi ${response.status}`);}
      const payload=await response.json() as {times?:unknown;confidences?:unknown;needsReview?:unknown;quality?:number;lineCount?:number;recognizedWords?:number;recognizedPhrases?:number;method?:string};
      const times=safeAutoTimes(payload.times);
      if(times.length!==baseTimeline.length)throw new Error(`Bộ nghe trả về ${times.length}/${baseTimeline.length} câu, chưa thể áp dụng an toàn.`);
      const confidences=safeConfidences(payload.confidences,times.length);
      const reviewCount=confidences.filter((score)=>score<.5).length;
      setAutoVideoTimes(times);setAutoLineConfidences(confidences);setManualLineTimes({});setManualCursor(0);setVideoTimeOffset(0);setSyncAnchorLine(0);setFollowPlayback(true);setEditingLine(null);
      setAutoAlignStatus(`Đã căn ${times.length} câu · độ tin cậy ${Math.round((Number(payload.quality)||0)*100)}% · ${reviewCount} câu cần kiểm tra. Timeline và độ tin cậy đã được tự lưu.`);
      setDirectVideoNote("Timeline tự động đã sẵn sàng. Hãy phát video để kiểm tra; nếu video có thêm intro, canh một câu bên dưới để bù đúng phần intro.");
    }catch(error){setAutoAlignStatus(error instanceof Error?error.message:"Không tự gắn được lyric.");}
    finally{setAutoAlignBusy(false);}
  };

  const assignManualLine=(index=manualCursor,time?:number)=>{
    const audio=manualAudioRef.current;
    const nextTime=Number.isFinite(time)?Number(time):audio?.currentTime;
    if(!alignmentFile||!audio||!Number.isFinite(nextTime)){setManualAlignStatus("Hãy nạp file âm thanh trước khi gán câu.");return;}
    const value=Math.max(0,Number(nextTime));
    const previous=Array.from({length:index},(_,offset)=>index-offset-1).find((line)=>Number.isFinite(manualLineTimes[line]));
    const following=Array.from({length:Math.max(0,baseTimeline.length-index-1)},(_,offset)=>index+offset+1).find((line)=>Number.isFinite(manualLineTimes[line]));
    if(previous!==undefined&&value<=manualLineTimes[previous]){setManualAlignStatus(`Mốc câu ${index+1} phải nằm sau câu ${previous+1}. Hãy phát tới đúng vị trí rồi gán lại.`);return;}
    if(following!==undefined&&value>=manualLineTimes[following]){setManualAlignStatus(`Mốc câu ${index+1} phải nằm trước câu ${following+1}. Hãy sửa hoặc xóa mốc sau trước.`);return;}
    setManualLineTimes((current)=>({...current,[index]:Number(value.toFixed(3))}));
    const nextIndex=Math.min(baseTimeline.length-1,index+1);
    setManualCursor(nextIndex);
    setManualAlignStatus(`Đã gán câu ${String(index+1).padStart(2,"0")} tại ${clockTime(value)}${index+1<baseTimeline.length?` · đang chờ câu ${String(index+2).padStart(2,"0")}`:" · đã đến câu cuối"}.`);
  };

  const removeManualLine=(index:number)=>{
    setManualLineTimes((current)=>{const next={...current};delete next[index];return next;});
    setManualCursor(index);setManualAlignStatus(`Đã xóa mốc câu ${String(index+1).padStart(2,"0")}. Phát tới đúng chỗ và gán lại.`);
  };

  const seekManualAudio=(seconds:number)=>{
    const audio=manualAudioRef.current;if(!audio)return;
    audio.currentTime=Math.max(0,Math.min(audio.duration||Infinity,audio.currentTime+seconds));setManualAudioTime(audio.currentTime);
  };

  const followManualTimeline=(time:number)=>{
    const assigned=Object.entries(manualLineTimes)
      .map(([index,value])=>({index:Number(index),time:Number(value)}))
      .filter((item)=>Number.isInteger(item.index)&&Number.isFinite(item.time))
      .sort((a,b)=>a.time-b.time);
    if(!assigned.length)return;
    let active=assigned[0].index;
    for(const item of assigned){if(time+.05>=item.time)active=item.index;else break;}
    setManualCursor((current)=>{
      if(!Number.isFinite(manualLineTimes[current])){
        const previous=[...assigned].reverse().find((item)=>item.index<current);
        if(previous&&time+.05>=previous.time)return current;
      }
      return active;
    });
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
      {!song&&<div className="direct-video-lookup"><span>HOẶC DÁN LINK YOUTUBE TRỰC TIẾP</span><div><input value={directVideoUrl} onChange={(event)=>setDirectVideoUrl(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")applyDirectVideo();}} placeholder="youtube.com/watch…, youtu.be…, Shorts hoặc Live…"/><button type="button" onClick={applyDirectVideo} disabled={!directVideoUrl.trim()}>NHẬN LINK</button></div><small>{directVideoNote}</small></div>}
      {result&&<article className="search-result">
        <div className="result-disc"><i/><b>BEST<br/>MATCH</b></div>
        <div><small>ĐÃ TÌM THẤY BÀI</small><h2>{result.title}</h2><p>{result.artist}</p><span>{result.syncedLyrics?"LYRIC ĐỒNG BỘ":result.lyrics?"LYRIC THƯỜNG · TỰ CANH GIỜ":"CHỈ CÓ VIDEO · TỰ DÁN LYRIC"}</span></div>
        <a href={"https://www.youtube.com/watch?v="+result.videoId} target="_blank" rel="noreferrer">KIỂM TRA ↗</a>
        <button onClick={applySong}>ĐƯA VÀO STUDIO</button>
      </article>}
    </section>

    <section className="project-library">
      <div className="project-library-head"><div><small>LƯU CÔNG VIỆC MIỄN PHÍ</small><h2>Bản đang làm</h2><p>Không tự xóa · giữ tối đa 20 bản gần nhất · có thể tải backup trước khi xóa.</p></div><label className="import-project">NHẬP FILE DỰ PHÒNG<input type="file" accept="application/json,.json" onChange={(event)=>{void importProject(event.target.files?.[0]??null);event.currentTarget.value="";}}/></label></div>
      {savedProjects.length?<div className="project-list">{savedProjects.slice(0,20).map((project)=><article key={project.key}><div><b>{project.song.title}</b><span>{project.song.artist}</span><small>{new Date(project.updatedAt).toLocaleString("vi-VN",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</small></div><div><button onClick={()=>resumeProject(project)}>MỞ LẠI</button><button onClick={()=>exportProject(project)}>TẢI BACKUP</button><button className="project-delete" style={{borderColor:"#64303b",background:"#211217",color:"#ff8299"}} onClick={()=>removeProject(project)}>XÓA</button></div></article>)}</div>:<p className="project-empty">Chưa có bản lưu. Khi bạn đưa một bài vào Studio và bắt đầu viết, hệ thống sẽ tự tạo bản lưu đầu tiên.</p>}
    </section>

    {!song?<section className="studio-empty"><div>♪</div><h2>Bàn dịch lyric đã sẵn sàng.</h2><p>Hãy tìm một bài hát, kiểm tra kết quả rồi đưa bài vào studio để bắt đầu.</p></section>:
    <section className="studio-workspace">
      <div className="translation-column">
        <div className="workspace-title"><div><small>ĐANG DỊCH</small><h2>{song.title}</h2><p>{song.artist}</p></div><div><span>{hasCompleteManualTimeline?"LRC ĐÃ GÁN TỪNG CÂU":song.syncedLyrics?"LRC ĐỒNG BỘ":"CANH GIỜ"}</span><button onClick={downloadTranslation} disabled={!timeline.length}>XUẤT BẢN SONG NGỮ .TXT</button><button onClick={downloadVietnameseWord} disabled={!Object.values(translations).some((value)=>value.trim())}>XUẤT LỜI VIỆT .DOC</button><button onClick={downloadLrc} disabled={!hasUsableTimeline}>TẢI FILE .LRC</button><button onClick={()=>exportProject()} disabled={!song}>TẢI DỰ PHÒNG .JSON</button><small className="save-note">{saveNote}</small></div></div>

        <section className={"direct-video-panel "+(playerState==="VIDEO_ERROR"?"has-error":"")}>
          <div><small>VIDEO YOUTUBE TRỰC TIẾP</small><b>{playerState==="VIDEO_ERROR"?"VIDEO HIỆN TẠI KHÔNG PHÁT ĐƯỢC":"THAY VIDEO MÀ KHÔNG MẤT LYRIC"}</b></div>
          <div className="direct-video-form"><input value={directVideoUrl} onChange={(event)=>setDirectVideoUrl(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")applyDirectVideo();}} placeholder="Dán link youtube.com/watch…, youtu.be…, Shorts hoặc Live…"/><button type="button" onClick={applyDirectVideo} disabled={!directVideoUrl.trim()}>DÙNG VIDEO NÀY</button></div>
          <p>{directVideoNote}</p>
          <div className="auto-video-align"><div><small>TỰ ĐỘNG NGHE & TẠO LRC · BỘ CĂN CHỈNH V6.1 TURBO</small><b>{hasAutoTimeline?hasAlignmentConfidence?`ĐÃ CĂN ${autoVideoTimes.length} CÂU · ${autoLineConfidences.filter((score)=>score<.5).length} CÂU CẦN KIỂM TRA`:`TIMELINE CŨ · HÃY CHẠY LẠI BỘ V6.1`:"NẠP ĐÚNG FILE ÂM THANH CỦA VIDEO"}</b><span>Nghe bằng mô hình Large V3 Turbo, đối chiếu lyric và tự tách giọng khi cần · miễn phí trên máy.</span></div><label className="auto-audio-picker">{alignmentFile?`✓ ${alignmentFile.name}`:"+ CHỌN FILE ÂM THANH"}<input type="file" accept="audio/*,.wav,.mp3,.m4a,.flac,.aac,.ogg" onChange={(event)=>{const file=event.target.files?.[0]??null;setAlignmentFile(file);setAutoAlignStatus(file?`Đã nạp ${file.name}. Sẵn sàng căn ${baseTimeline.length} câu và tạo LRC.`:"Chưa nạp file âm thanh.");}}/></label><button type="button" onClick={()=>void autoAlignVideoLyrics()} disabled={autoAlignBusy||!alignmentFile||!baseTimeline.length}>{autoAlignBusy?"ĐANG NGHE · CÓ THỂ TỰ TÁCH GIỌNG…":"TỰ ĐỘNG NGHE & TẠO LRC"}</button>{hasAutoTimeline&&<button type="button" className="clear-auto-timeline" onClick={()=>{setAutoVideoTimes([]);setAutoLineConfidences([]);setVideoTimeOffset(0);setAutoAlignStatus("Đã bỏ timeline tự động; hệ thống quay về lyric ban đầu.");}}>BỎ TIMELINE</button>}<p>{autoAlignStatus}</p></div>
          <section className="manual-timeline-panel">
            <div className="manual-timeline-head"><div><small>GÁN TIMELINE TỪNG CÂU · CHÍNH XÁC THỦ CÔNG</small><b>{manualAssignedCount}/{baseTimeline.length} CÂU ĐÃ GÁN</b><span>Phát file âm thanh. Khi câu đang chọn bắt đầu được hát, bấm GÁN; hệ thống tự chuyển sang câu kế tiếp.</span></div><button type="button" onClick={()=>{setManualLineTimes({});setManualCursor(0);setManualAlignStatus("Đã xóa toàn bộ mốc thủ công. Bắt đầu lại từ câu 01.");}} disabled={!manualAssignedCount}>XÓA TẤT CẢ</button></div>
            {manualAudioUrl?<><audio ref={manualAudioRef} src={manualAudioUrl} controls preload="metadata" onLoadedMetadata={(event)=>setManualAudioDuration(event.currentTarget.duration||0)} onTimeUpdate={(event)=>{const time=event.currentTarget.currentTime||0;setManualAudioTime(time);followManualTimeline(time);}} onSeeked={(event)=>followManualTimeline(event.currentTarget.currentTime||0)}/><div className="manual-now"><span>CÂU {String(manualCursor+1).padStart(2,"0")} / {String(baseTimeline.length).padStart(2,"0")}{Number.isFinite(manualCursorAssignedTime)?" · ✓ ĐÃ GÁN":""}</span><b>{baseTimeline[manualCursor]?.text??"Chưa có lyric"}</b><output>{Number.isFinite(manualCursorAssignedTime)?`MỐC ${clockTime(manualCursorAssignedTime)} · PHÁT ${clockTime(manualAudioTime)}`:`${clockTime(manualAudioTime)} / ${clockTime(manualAudioDuration)}`}</output></div><div className="manual-timeline-controls"><button type="button" onClick={()=>seekManualAudio(-1)}>−1 GIÂY</button><button type="button" onClick={()=>setManualCursor((value)=>Math.max(0,value-1))}>← CÂU TRƯỚC</button><button type="button" className="manual-assign-main" onClick={()=>assignManualLine()} disabled={!baseTimeline.length}>{Number.isFinite(manualCursorAssignedTime)?`✓ ĐÃ GÁN ${clockTime(manualCursorAssignedTime)} · GÁN LẠI TẠI ${clockTime(manualAudioTime)}`:`✓ GÁN CÂU NÀY TẠI ${clockTime(manualAudioTime)}`}</button><button type="button" onClick={()=>setManualCursor((value)=>Math.min(baseTimeline.length-1,value+1))}>CÂU SAU →</button><button type="button" onClick={()=>removeManualLine(manualCursor)} disabled={!Number.isFinite(manualLineTimes[manualCursor])}>XÓA MỐC CÂU</button></div></>:<p className="manual-no-audio">Chọn file âm thanh ở ô phía trên để mở bộ phát và bắt đầu gán từng câu.</p>}
            <p className="manual-align-status">{manualAlignStatus}</p>
          </section>
          <div className="video-sync-tools"><div><small>BÙ TOÀN BỘ TIMELINE THEO INTRO VIDEO</small><span>Công cụ này chỉ dịch chuyển đồng đều cả bài. Muốn sửa riêng từng câu, dùng bảng GÁN TIMELINE TỪNG CÂU phía trên.</span></div><label>CÂU MỐC<input type="number" min="1" max={Math.max(1,timeline.length)} value={Math.min(syncAnchorLine+1,Math.max(1,timeline.length))} onChange={(event)=>setSyncAnchorLine(Math.max(0,Math.min(timeline.length-1,Number(event.target.value)-1||0)))}/></label><button type="button" onClick={alignVideoToLyric} disabled={!timeline.length||playerState==="LOADING"||playerState==="VIDEO_ERROR"}>BÙ TOÀN BỘ THEO CÂU MỐC</button><button type="button" className="sync-reset" onClick={()=>{setVideoTimeOffset(0);setDirectVideoNote("Đã bỏ phần bù intro; timeline từng câu vẫn được giữ nguyên.");}}>BỎ BÙ INTRO</button><output>{hasCompleteManualTimeline?`ĐÃ GÁN ${manualAssignedCount}/${baseTimeline.length}`:hasAutoTimeline?`AI ${autoVideoTimes.length}/${baseTimeline.length}`:Math.abs(videoTimeOffset)<.01?"TIMELINE GỐC":`VIDEO ${videoTimeOffset>0?"+":""}${videoTimeOffset.toFixed(2)} GIÂY`}</output></div>
        </section>

        <div className="player-card">
          <div ref={playerMountRef} className="youtube-mount"/>
          <div className="player-meta"><span className={playerState==="PLAYING"?"live":""}>{playerState==="PLAYING"?"ĐANG PHÁT":playerState==="PAUSED"?"TẠM DỪNG":playerState==="ENDED"?"ĐÃ PHÁT XONG":playerState==="READY"?"SẴN SÀNG":playerState==="VIDEO_ERROR"?"VIDEO LỖI":"ĐANG TẢI"}</span><b>{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")} / {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,"0")}</b><p>{playerState==="VIDEO_ERROR"?"DÁN LINK KHÁC Ở Ô PHÍA TRÊN":currentLineIndex>=0?"CÂU "+String(currentLineIndex+1).padStart(2,"0")+" / "+String(timeline.length).padStart(2,"0"):"NHẤN PHÁT ĐỂ CHẠY THEO LYRIC"}</p></div>
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
          <div className="line-editor-head"><span>#</span><span>LỜI GỐC · NGHĨA SÁT · LỜI VIỆT</span><span>{hasCompleteManualTimeline?"ĐÃ GÁN TỪNG CÂU":manualAssignedCount?`ĐÃ GÁN ${manualAssignedCount}/${timeline.length}`:song.syncedLyrics?"ĐỒNG BỘ":hasAutoTimeline?"ĐÃ CĂN TỰ ĐỘNG":"CHƯA CÓ MỐC"}</span></div>
          {timeline.map((line,index)=><div ref={(element)=>{lineRefs.current[index]=element;}} className={"lyric-row "+(index===currentLineIndex?"active ":"")+(index===editingLine?"editing ":"")+(index===manualCursor?"manual-selected ":"")+(Number.isFinite(manualLineTimes[index])?"manual-assigned ":hasAlignmentConfidence?(autoLineConfidences[index]>=.7?"align-good":autoLineConfidences[index]>=.5?"align-medium":"align-review"):"")} key={index}>
            <span className="line-number">{String(index+1).padStart(2,"0")}<i>{clockTime(line.time)}</i>{Number.isFinite(manualLineTimes[index])?<em>✓ ĐÃ GÁN</em>:hasAlignmentConfidence&&<em>{autoLineConfidences[index]>=.7?"✓ TỐT":autoLineConfidences[index]>=.5?"~ KIỂM TRA":"! CẦN SỬA"}</em>}</span>
            <div className="lyric-writing"><div className="original-line-tools"><button className="line-seek" onClick={()=>playLine(index)} title="Phát lại từ câu này"><span>{line.text}</span><small>▶ BẤM ĐỂ NGHE LẠI TỪ CÂU NÀY</small></button><div className="tone-slot-panel"><div><span>THANH ÂM</span><small>{lyricToneUnits(line.text).length} Ô · N NGANG · H HUYỀN · S SẮC</small><button className="copy-tone-slots" type="button" onClick={()=>copyToneSlots(index)} aria-label={"Sao chép thanh âm câu "+(index+1)}>{copiedToneLine===index?"ĐÃ COPY":"COPY"}</button></div><div className="tone-slots">{lyricToneUnits(line.text).map((unit,toneIndex)=><input key={toneIndex} maxLength={1} value={toneSlotValues(tonePatterns[index]??"",lyricToneUnits(line.text).length)[toneIndex]} onChange={(event)=>{const value=event.currentTarget.value.toLocaleUpperCase("en").replace(/[^NHS]/g,"").slice(-1);updateToneSlot(index,toneIndex,value);if(value)(event.currentTarget.nextElementSibling as HTMLInputElement|null)?.focus();}} onPaste={(event)=>{const pasted=event.clipboardData.getData("text");if(!pastedToneValues(pasted).length)return;event.preventDefault();pasteToneSlots(index,toneIndex,pasted);}} onKeyDown={(event)=>{if(event.key==="Backspace"&&!event.currentTarget.value)(event.currentTarget.previousElementSibling as HTMLInputElement|null)?.focus();}} aria-label={"Thanh âm "+(toneIndex+1)+" cho "+unit} title={unit+" · nhập N, H hoặc S; có thể dán cả hàng"}/>)}</div></div></div><label className="literal-field"><span>NGHĨA SÁT</span><textarea value={literalMeanings[index]??""} onFocus={()=>{setEditingLine(index);setFollowPlayback(false);}} onBlur={()=>setEditingLine((current)=>current===index?null:current)} onChange={(event)=>updateLiteralMeaning(index,event.target.value)} placeholder="Nghĩa tiếng Việt sát với câu gốc…"/></label><label className="adaptation-field"><span>LỜI VIỆT</span><textarea value={translations[index]??""} onFocus={()=>{setEditingLine(index);setFollowPlayback(false);}} onBlur={()=>setEditingLine((current)=>current===index?null:current)} onChange={(event)=>updateTranslation(index,event.target.value)} placeholder="Viết lyric tiếng Việt có thể hát cho câu này…"/></label></div>
            <div className="line-side-actions"><button type="button" className="select-manual-line" onClick={()=>setManualCursor(index)}>CHỌN CÂU</button><label>MỐC GIÂY<input type="number" min="0" step="0.01" value={Number.isFinite(manualLineTimes[index])?manualLineTimes[index]:""} placeholder={hasAutoTimeline?String(autoVideoTimes[index]?.toFixed(2)??""):""} onChange={(event)=>{const raw=event.currentTarget.value;setManualLineTimes((current)=>{const next={...current};if(raw==="")delete next[index];else{const value=Number(raw);if(Number.isFinite(value)&&value>=0)next[index]=value;}return next;});}}/></label><button type="button" className="assign-at-playing" onClick={()=>assignManualLine(index)} disabled={!manualAudioUrl}>GÁN TẠI {clockTime(manualAudioTime)}</button><button type="button" className="delete-line-mark" onClick={()=>removeManualLine(index)} disabled={!Number.isFinite(manualLineTimes[index])}>XÓA MỐC</button><button onClick={()=>{setQuestion("Dịch sát nghĩa câu \""+line.text+"\"");document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus();}}>HỎI</button></div>
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
