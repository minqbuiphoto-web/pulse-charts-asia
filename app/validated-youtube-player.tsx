"use client";

import { useEffect, useRef, useState } from "react";

export type YouTubeFailure={ code:number; reason:string };

type Player={destroy:()=>void;getDuration:()=>number;pauseVideo:()=>void;playVideo:()=>void};
type PlayerEvent={target:Player;data:number};
type PlayerNamespace={Player:new(element:HTMLElement,options:{videoId:string;playerVars:Record<string,string|number>;events:{onReady:(event:PlayerEvent)=>void;onStateChange:(event:PlayerEvent)=>void;onError:(event:PlayerEvent)=>void;onAutoplayBlocked?:()=>void}})=>Player};
type YouTubeWindow={YT?:PlayerNamespace;onYouTubeIframeAPIReady?:()=>void};

const failureReason=(code:number)=>{
  if(code===100)return "Video đã bị xóa hoặc chuyển sang chế độ riêng tư.";
  if(code===101||code===150)return "Chủ sở hữu video không cho phép phát trên website khác.";
  if(code===153)return "YouTube không nhận diện được tên miền phát video.";
  if(code===5)return "Video này không phát được bằng trình phát HTML5 hiện tại.";
  return "YouTube không tải được video này.";
};

export default function ValidatedYouTubePlayer({videoId,title,onRejected}:{videoId:string;title:string;onRejected:(failure:YouTubeFailure)=>void}){
  const mountRef=useRef<HTMLDivElement|null>(null);
  const rejectedRef=useRef(onRejected);
  const [ready,setReady]=useState(false);

  useEffect(()=>{rejectedRef.current=onRejected;},[onRejected]);

  useEffect(()=>{
    const target=window as unknown as YouTubeWindow;
    if(target.YT?.Player){const timer=window.setTimeout(()=>setReady(true),0);return()=>window.clearTimeout(timer);}
    const previous=target.onYouTubeIframeAPIReady;
    const apiTimer=window.setTimeout(()=>rejectedRef.current({code:0,reason:"Không thể kết nối tới trình phát YouTube."}),12000);
    const handleReady=()=>{window.clearTimeout(apiTimer);previous?.();setReady(true);};
    target.onYouTubeIframeAPIReady=handleReady;
    if(!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')){
      const script=document.createElement("script");
      script.src="https://www.youtube.com/iframe_api";
      script.async=true;
      script.onerror=()=>{window.clearTimeout(apiTimer);rejectedRef.current({code:0,reason:"Không thể tải thư viện trình phát YouTube."});};
      document.head.appendChild(script);
    }
    return()=>{window.clearTimeout(apiTimer);if(target.onYouTubeIframeAPIReady===handleReady)target.onYouTubeIframeAPIReady=previous;};
  },[]);

  useEffect(()=>{
    const target=window as unknown as YouTubeWindow;
    if(!ready||!target.YT?.Player||!mountRef.current)return;
    mountRef.current.innerHTML="";
    let rejected=false;
    let started=false;
    let loadTimer=0;
    const fail=(failure:YouTubeFailure)=>{
      if(rejected)return;
      rejected=true;
      window.clearTimeout(loadTimer);
      rejectedRef.current(failure);
    };
    const validate=(player:Player)=>{
      const duration=Math.round(player.getDuration()||0);
      if(duration>0&&(duration<120||duration>900)){
        player.pauseVideo();
        fail({code:-2,reason:duration<120?`Video chỉ dài ${duration} giây nên đã bị loại.`:`Video dài ${Math.round(duration/60)} phút, không giống một OST đơn lẻ nên đã bị loại.`});
        return false;
      }
      return true;
    };
    loadTimer=window.setTimeout(()=>{if(!started)fail({code:0,reason:"YouTube mất quá nhiều thời gian để tải video."});},15000);
    const player=new target.YT.Player(mountRef.current,{
      videoId,
      playerVars:{autoplay:1,playsinline:1,rel:0,origin:window.location.origin},
      events:{
        onReady:({target:instance})=>{started=true;window.clearTimeout(loadTimer);if(validate(instance))instance.playVideo();},
        onStateChange:({target:instance,data})=>{if(data===1&&!rejected){started=true;window.clearTimeout(loadTimer);validate(instance);}},
        onError:({data})=>fail({code:data,reason:failureReason(data)}),
        onAutoplayBlocked:()=>{started=true;window.clearTimeout(loadTimer);},
      },
    });
    return()=>{window.clearTimeout(loadTimer);player.destroy();};
  },[ready,videoId]);

  return <div ref={mountRef} className="youtube-player" aria-label={`YouTube player: ${title}`}/>;
}
