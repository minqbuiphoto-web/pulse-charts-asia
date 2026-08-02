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

function storageKey(song:Pick<StudioSong,"title"|"artist">){
  return "pulse-studio::"+(song.title+"::"+song.artist).normalize("NFKC").toLocaleLowerCase("en");
}

function safeFileName(value:string){
  return value.normalize("NFKC").replace(/[\\/:*?"<>|]+/g,"-").trim().slice(0,120)||"lyric-translation";
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
  const [lookupNote,setLookupNote]=useState("Search by song title, with or without the artist.");
  const [result,setResult]=useState<SearchResult|null>(null);
  const [song,setSong]=useState<StudioSong|null>(null);
  const [manualLyrics,setManualLyrics]=useState("");
  const [translations,setTranslations]=useState<Record<number,string>>({});
  const [ytReady,setYtReady]=useState(()=>typeof window!=="undefined"&&Boolean(window.YT?.Player));
  const [currentTime,setCurrentTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const [playerState,setPlayerState]=useState("WAITING");
  const [followPlayback,setFollowPlayback]=useState(true);
  const [editingLine,setEditingLine]=useState<number|null>(null);
  const [question,setQuestion]=useState("");
  const [replyDraft,setReplyDraft]=useState("");
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>([
    {role:"assistant",text:"I can help you discuss meaning, imagery, cultural context and Vietnamese wording. Write a question, then use Ask ChatGPT Free."}
  ]);
  const [copied,setCopied]=useState(false);
  const playerMountRef=useRef<HTMLDivElement|null>(null);
  const playerRef=useRef<YTPlayer|null>(null);
  const timerRef=useRef<number|undefined>(undefined);
  const lineRefs=useRef<Array<HTMLDivElement|null>>([]);

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

  useEffect(()=>{
    if(currentLineIndex>=0&&followPlayback&&editingLine===null)lineRefs.current[currentLineIndex]?.scrollIntoView({behavior:"smooth",block:"center"});
  },[currentLineIndex,followPlayback,editingLine]);

  const searchSong=async()=>{
    const term=query.trim();
    if(!term)return;
    setLookupState("searching");setLookupNote("Searching YouTube and the free lyrics library…");setResult(null);
    try{
      const encoded=encodeURIComponent(term);
      const [videoResponse,lyricsResponse]=await Promise.all([
        fetch("/api/youtube-search?q="+encoded+"%20official%20music%20video",{signal:AbortSignal.timeout(12000)}),
        fetch("/api/lyrics-search?title="+encoded+"&artist=",{signal:AbortSignal.timeout(12000)})
      ]);
      if(!videoResponse.ok)throw new Error("No playable YouTube result was found.");
      const video=await videoResponse.json() as {videoId?:string};
      if(!video.videoId)throw new Error("The video result was incomplete.");
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
      setLookupNote(nextResult.lyrics?(nextResult.syncedLyrics?"Synced lyrics found — ready for line highlighting.":"Plain lyrics found — studio will create approximate line timing."):"Video found, but lyrics are missing. You can paste the original lyrics after applying.");
    }catch(error){
      setLookupState("error");setLookupNote(error instanceof Error?error.message:"Search failed. Try a more specific title and artist.");
    }
  };

  const applySong=()=>{
    if(!result)return;
    setSong(result);setCurrentTime(0);setDuration(0);setPlayerState("LOADING");setManualLyrics("");setFollowPlayback(true);setEditingLine(null);
    try{
      const saved=JSON.parse(localStorage.getItem(storageKey(result))??"{}") as Record<number,string>;
      setTranslations(saved);
    }catch{setTranslations({});}
  };

  const applyManualLyrics=()=>{
    if(!song||!manualLyrics.trim())return;
    const next={...song,lyrics:manualLyrics.trim(),syncedLyrics:""};
    setSong(next);setManualLyrics("");
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

  const replayWorkingLine=()=>{
    const index=editingLine??currentLineIndex;
    const player=playerRef.current;
    if(!player||index<0||!timeline[index])return;
    player.seekTo(timeline[index].time,true);
    player.playVideo();
  };

  const downloadTranslation=()=>{
    if(!song||!timeline.length)return;
    const content=timeline.map((line,index)=>line.text+"\n"+(translations[index]??"")).join("\n\n");
    const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
    const url=URL.createObjectURL(blob);
    const anchor=document.createElement("a");
    anchor.href=url;anchor.download=safeFileName(song.artist+" - "+song.title+" - Vietnamese")+".txt";
    document.body.appendChild(anchor);anchor.click();anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  const translationContext=()=>{
    if(!song)return "";
    const lines=timeline.map((line,index)=>{
      const translated=translations[index]?.trim();
      return (index+1)+". ORIGINAL: "+line.text+(translated?"\n   VIETNAMESE DRAFT: "+translated:"");
    }).join("\n");
    const focus=currentLineIndex>=0?timeline[currentLineIndex]?.text:"";
    return [
      "You are helping me translate song lyrics into natural Vietnamese.",
      "Song: "+song.title+" — "+song.artist,
      focus?"Current line being reviewed: "+focus:"",
      "Please explain meaning, imagery, pronouns, tone and cultural nuance. Do not invent missing context.",
      "",
      lines
    ].filter(Boolean).join("\n");
  };

  const askChatGPT=async()=>{
    if(!song||!question.trim())return;
    const prompt=translationContext()+"\n\nMY QUESTION:\n"+question.trim();
    await copyText(prompt);
    setChatMessages((current)=>[...current,{role:"user",text:question.trim()},{role:"assistant",text:"Context copied. ChatGPT Free is opening in a new tab — paste the prompt there, then bring any useful answer back as a note if you want it beside the translation."}]);
    setQuestion("");setCopied(true);
    window.setTimeout(()=>setCopied(false),2500);
    window.open("https://chatgpt.com/","_blank","noopener,noreferrer");
  };

  const addReplyNote=()=>{
    if(!replyDraft.trim())return;
    setChatMessages((current)=>[...current,{role:"assistant",text:replyDraft.trim()}]);
    setReplyDraft("");
  };

  return <main className="studio-shell">
    <header className="studio-header">
      <Link className="studio-brand" href="/">PULSE <b>LYRIC STUDIO</b></Link>
      <nav><Link href="/">MUSIC CHARTS</Link><span>FREE WORKSPACE</span></nav>
    </header>

    <section className="studio-hero">
      <div><p>LYRIC TRANSLATION WORKSPACE</p><h1>Hear the line.<br/><em>Write the meaning.</em></h1><span>Search, sync, translate and discuss one lyric line at a time.</span></div>
      <div className="studio-stats"><b>01</b><span>SEARCH & APPLY</span><b>02</b><span>LISTEN & TRANSLATE</span><b>03</b><span>DISCUSS WITH CHATGPT</span></div>
    </section>

    <section className="studio-search">
      <label><span>SONG TITLE / ARTIST</span><div><input value={query} onChange={(event)=>setQuery(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter")void searchSong();}} placeholder="e.g. 光年之外 G.E.M. or Through the Night IU"/><button onClick={searchSong} disabled={lookupState==="searching"||!query.trim()}>{lookupState==="searching"?"SEARCHING…":"SEARCH SONG"}</button></div></label>
      <p className={"lookup-note "+lookupState}>{lookupNote}</p>
      {result&&<article className="search-result">
        <div className="result-disc"><i/><b>BEST<br/>MATCH</b></div>
        <div><small>TRACK FOUND</small><h2>{result.title}</h2><p>{result.artist}</p><span>{result.syncedLyrics?"SYNCED LYRICS":result.lyrics?"PLAIN LYRICS · AUTO TIMING":"VIDEO ONLY · ADD LYRICS MANUALLY"}</span></div>
        <a href={"https://www.youtube.com/watch?v="+result.videoId} target="_blank" rel="noreferrer">VERIFY ↗</a>
        <button onClick={applySong}>APPLY TO STUDIO</button>
      </article>}
    </section>

    {!song?<section className="studio-empty"><div>♪</div><h2>Your translation desk is ready.</h2><p>Search for a song above, verify the result, then apply it to begin.</p></section>:
    <section className="studio-workspace">
      <div className="translation-column">
        <div className="workspace-title"><div><small>NOW TRANSLATING</small><h2>{song.title}</h2><p>{song.artist}</p></div><div><span>{song.syncedLyrics?"LRC SYNC":"AUTO LINE TIMING"}</span><button onClick={downloadTranslation} disabled={!timeline.length}>EXPORT BILINGUAL .TXT</button></div></div>

        <div className="player-card">
          <div ref={playerMountRef} className="youtube-mount"/>
          <div className="player-meta"><span className={playerState==="PLAYING"?"live":""}>{playerState}</span><b>{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")} / {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,"0")}</b><p>{currentLineIndex>=0?"LINE "+String(currentLineIndex+1).padStart(2,"0")+" OF "+String(timeline.length).padStart(2,"0"):"PRESS PLAY TO FOLLOW THE LYRIC"}</p></div>
        </div>

        <div className="sticky-player">
          <div className="sticky-track"><span className={playerState==="PLAYING"?"pulse":""}>♪</span><div><b>{song.title}</b><small>{currentLineIndex>=0?(timeline[currentLineIndex]?.text??""):"Ready to follow the lyric"}</small></div></div>
          <div className="sticky-progress"><i style={{width:(duration>0?Math.min(100,currentTime/duration*100):0)+"%"}}/></div>
          <div className="sticky-time">{Math.floor(currentTime/60)}:{String(Math.floor(currentTime%60)).padStart(2,"0")}</div>
          <div className="sticky-controls">
            <button onClick={()=>seekBy(-5)}>−5s</button>
            <button className="main-control" onClick={togglePlayback}>{playerState==="PLAYING"?"PAUSE":"PLAY"}</button>
            <button onClick={replayWorkingLine} disabled={currentLineIndex<0&&editingLine===null}>REPLAY LINE</button>
            <button className={followPlayback?"follow-on":""} onClick={()=>setFollowPlayback((value)=>!value)}>{followPlayback?"FOLLOW ON":"FOLLOW OFF"}</button>
          </div>
        </div>

        {!timeline.length&&<div className="manual-lyrics"><h3>Original lyrics were not found</h3><p>Paste the original lyrics below. Each non-empty line becomes one translation row with approximate timing.</p><textarea value={manualLyrics} onChange={(event)=>setManualLyrics(event.target.value)} placeholder="Paste one lyric sentence per line…"/><button onClick={applyManualLyrics} disabled={!manualLyrics.trim()}>USE THESE LYRICS</button></div>}

        {timeline.length>0&&<div className="line-editor">
          <div className="line-editor-head"><span>#</span><span>ORIGINAL LYRIC + YOUR VIETNAMESE TRANSLATION</span><span>{song.syncedLyrics?"SYNCED":"APPROX."}</span></div>
          {timeline.map((line,index)=><div ref={(element)=>{lineRefs.current[index]=element;}} className={"lyric-row "+(index===currentLineIndex?"active ":"")+(index===editingLine?"editing":"")} key={index}>
            <span className="line-number">{String(index+1).padStart(2,"0")}<i>{Math.floor(line.time/60)}:{String(Math.floor(line.time%60)).padStart(2,"0")}</i></span>
            <div><p>{line.text}</p><textarea value={translations[index]??""} onFocus={()=>{setEditingLine(index);setFollowPlayback(false);}} onBlur={()=>setEditingLine((current)=>current===index?null:current)} onChange={(event)=>updateTranslation(index,event.target.value)} placeholder="Viết lyric dịch tiếng Việt cho câu này…"/></div>
            <button onClick={()=>{setQuestion("Hãy giải thích chính xác ý nghĩa và sắc thái của câu: “"+line.text+"”");document.querySelector<HTMLTextAreaElement>(".chat-compose textarea")?.focus();}}>ASK</button>
          </div>)}
        </div>}
      </div>

      <aside className="chat-column">
        <div className="chat-head"><div className="chat-orb">✦</div><div><small>FREE COMPANION</small><h2>Discuss with ChatGPT</h2><p>Meaning · nuance · natural Vietnamese</p></div></div>
        <div className="free-explainer"><b>WHY COPY & OPEN?</b><p>ChatGPT cannot be embedded free inside an external website. This panel prepares the full song context, your draft and your question, then opens ChatGPT Free.</p></div>
        <div className="chat-log">{chatMessages.map((message,index)=><div className={"chat-message "+message.role} key={index}><span>{message.role==="user"?"YOU":"GPT"}</span><p>{message.text}</p></div>)}</div>
        <div className="chat-compose"><label>YOUR QUESTION</label><textarea value={question} onChange={(event)=>setQuestion(event.target.value)} placeholder="Câu này dùng đại từ nào? Hình ảnh này hàm ý gì? Bản dịch của tôi có tự nhiên không?"/><button onClick={askChatGPT} disabled={!question.trim()||!song}>{copied?"COPIED — OPENING CHATGPT…":"ASK CHATGPT FREE ↗"}</button><small>Your current line, original lyric and Vietnamese drafts are included automatically.</small></div>
        <details className="reply-note"><summary>PASTE A USEFUL CHATGPT REPLY HERE</summary><textarea value={replyDraft} onChange={(event)=>setReplyDraft(event.target.value)} placeholder="Paste the explanation you want to keep beside your translation…"/><button onClick={addReplyNote} disabled={!replyDraft.trim()}>ADD TO DISCUSSION NOTES</button></details>
        <button className="copy-context" onClick={async()=>{await copyText(translationContext());setCopied(true);window.setTimeout(()=>setCopied(false),2000);}}>COPY FULL TRANSLATION CONTEXT</button>
      </aside>
    </section>}

    <footer className="studio-footer"><span>PULSE LYRIC STUDIO</span><p>Translations are saved locally on this browser. YouTube playback and LRCLIB lookup remain free.</p><Link href="/">BACK TO MUSIC CHARTS →</Link></footer>
  </main>;
}
