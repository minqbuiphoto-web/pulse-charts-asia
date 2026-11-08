import {type KaraokeAppearance} from './karaoke-layout';
export default function KaraokeControls({value,fonts,onChange}:{value:KaraokeAppearance;fonts:string[];onChange:(value:KaraokeAppearance)=>void}){
 const set=(patch:Partial<KaraokeAppearance>)=>onChange({...value,...patch});
 return <section className="karaoke-appearance"><h3>KIỂU CHỮ KARAOKE 2 DÒNG</h3><label>FONT CHỮ<select aria-label="Font Karaoke" value={value.fontFamily} onChange={e=>set({fontFamily:e.target.value})}>{fonts.map(font=><option key={font}>{font}</option>)}</select></label>
 <div className="karaoke-settings-grid">{([["fontSize","Cỡ chữ",12,80,.5],["gap","Khoảng cách hai dòng",20,240,1],["outlineWidth","Độ dày viền",0,6,.5],["shadowSize","Độ đổ bóng",0,10,.5]] as const).map(([key,label,min,max,step])=><label key={key}>{label}<output>{value[key]} px</output><input aria-label={label} type="range" min={min} max={max} step={step} value={value[key]} onChange={e=>set({[key]:Number(e.target.value)})}/></label>)}
 {([["waitingColor","Màu chữ chờ"],["highlightColor","Màu chữ đang hát"],["outlineColor","Màu viền chữ chờ"],["highlightOutlineColor","Màu viền chữ hát"],["shadowColor","Màu bóng"]] as const).map(([key,label])=><label key={key}>{label}<input aria-label={label} type="color" value={value[key]} onChange={e=>set({[key]:e.target.value})}/></label>)}</div>
 <p>Câu vừa hát xong sẽ giữ lại đến khi dòng kia hát khoảng 0,2 giây, rồi mờ dần và đổi câu. Khoảng cách tính từ đầu dòng trên đến đầu dòng dưới; tăng khoảng cách nếu câu dài xuống hàng.</p></section>;
}
