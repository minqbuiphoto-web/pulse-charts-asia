export type KaraokeAppearance={fontFamily:string;fontSize:number;gap:number;waitingColor:string;highlightColor:string;outlineColor:string;highlightOutlineColor:string;shadowColor:string;outlineWidth:number;shadowSize:number};
export const defaultKaraoke:KaraokeAppearance={fontFamily:"Arial Narrow",fontSize:48,gap:64,waitingColor:"#ffffff",highlightColor:"#ff1616",outlineColor:"#11116b",highlightOutlineColor:"#ffffff",shadowColor:"#000000",outlineWidth:2.5,shadowSize:3};
export function sanitizeKaraoke(value?:Partial<KaraokeAppearance>):KaraokeAppearance{
 const result={...defaultKaraoke,...value};
 for(const key of ["waitingColor","highlightColor","outlineColor","highlightOutlineColor","shadowColor"] as const)if(!/^#[0-9a-f]{6}$/i.test(result[key]))result[key]=defaultKaraoke[key];
 for(const [key,min,max] of [["fontSize",12,80],["gap",20,240],["outlineWidth",0,6],["shadowSize",0,10]] as const){const v=Number(result[key]);result[key]=Number.isFinite(v)?Math.max(min,Math.min(max,v)):defaultKaraoke[key]}
 return result;
}
// Pure time-based transitions: seeking and paused preview match exported frames.
export function karaokeSchedule<T extends {time:number;end:number}>(rows:T[],outputEnd=Infinity){
 const slots=rows.map((row,index)=>{
  const other=rows[index+1],replacement=rows[index+2];
  const trigger=other?other.time+Math.min(.2,Math.max(0,other.end-other.time)*.1):row.end+.2;
  const fadeStart=Math.max(row.end,trigger);
  const showEnd=Math.min(fadeStart+.35,replacement?.time??Infinity,outputEnd);
  return {...row,index,fadeStart:Math.min(fadeStart,showEnd),showEnd};
 });
 return slots.map((row,index)=>{const showStart=index<2?(rows[0]?.time??0):Math.min(row.time,slots[index-2].showEnd);return {...row,showStart,fadeIn:Math.min(.2,Math.max(0,row.time-showStart))}});
}
export function karaokeOpacity(row:{showStart:number;showEnd:number;fadeStart:number;fadeIn:number},time:number){
 const enter=row.fadeIn>0?Math.min(1,(time-row.showStart)/row.fadeIn):1;
 const leave=row.showEnd>row.fadeStart?Math.min(1,(row.showEnd-time)/(row.showEnd-row.fadeStart)):1;
 return Math.max(0,Math.min(enter,leave));
}
