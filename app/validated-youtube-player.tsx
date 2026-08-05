"use client";

import { useEffect, useRef, useState } from "react";

type Player={destroy:()=>void;getDuration:()=>number;pauseVideo:()=>void;playVideo:()=>void};
type PlayerNamespace={Player:new(element:HTMLElement,options:{videoId:string;playerVars:Record<string,number>;events:{onReady:(event:{target:Player})=>void;onStateChange:(event:{target:Player;data:number})=>void;onError:()=>void}})=>Player};
type YouTubeWindow={YT?:PlayerNamespace;onYouTubeIframeAPIReady?:()=>void};

export default function ValidatedYouTubePlayer({videoId,title,onRejected}:{videoId:string;title:string;onRejected:(reason:string)=>void}){
  const mountRef=useRef<HTMLDivElement|null>(null);
  const rejectedRef=useRef(onRejected);
  const [ready,setReady]=useState(false);

  useEffect(()=>{rejectedRef.current=onRejected;},[onRejected]);

  useEffect(()=>{
    const target=window as unknown as YouTubeWindow;
    if(target.YT?.Player){const timer=window.setTimeout(()=>setReady(true),0);return()=>window.clearTimeout(timer);}
    const previous=target.onYouTubeIframeAPIReady;
    target.onYouTubeIframeAPIReady=()=>{previous?.();setReady(true);};
    if(!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')){
      const script=document.createElement("script");
      script.src="https://www.youtube.com/iframe_api";
      script.async=true;
      document.head.appendChild(script);
    }
  },[]);

  useEffect(()=>{
    const target=window as unknown as YouTubeWindow;
    if(!ready||!target.YT?.Player||!mountRef.current)return;
    mountRef.current.innerHTML="";
    let rejected=false;
    const validate=(player:Player)=>{
      const duration=Math.round(player.getDuration()||0);
      if(duration>0&&(duration<120||duration>900)){
        rejected=true;
        player.pauseVideo();
        rejectedRef.current(duration<120?`Video chỉ dài ${duration} giây nên đã bị loại.`:`Video dài ${Math.round(duration/60)} phút, không giống một OST đơn lẻ nên đã bị loại.`);
        return false;
      }
      return true;
    };
    const player=new target.YT.Player(mountRef.current,{
      videoId,
      playerVars:{autoplay:1,playsinline:1,rel:0,modestbranding:1},
      events:{
        onReady:({target:instance})=>{if(validate(instance))instance.playVideo();},
        onStateChange:({target:instance,data})=>{if(data===1&&!rejected)validate(instance);},
        onError:()=>rejectedRef.current("Video này không còn phát được hoặc không cho phép nhúng."),
      },
    });
    return()=>player.destroy();
  },[ready,videoId]);

  return <div ref={mountRef} className="youtube-player" aria-label={`YouTube player: ${title}`}/>;
}

