import type { Metadata } from "next";
import "./globals.css";

const siteUrl=process.env.NEXT_PUBLIC_SITE_URL??"https://pulse-charts-asia.minqbuiphoto.chatgpt.site";
export const metadata:Metadata={
  metadataBase:new URL(siteUrl),
  title:"Pulse Charts — Bảng xếp hạng âm nhạc châu Á",
  description:"Top 10 Apple Music tại Hàn Quốc, Nhật Bản và Trung Quốc, đồng bộ tự động từ nguồn dữ liệu công khai của Apple.",
  openGraph:{ title:"Pulse Charts — Bắt nhịp âm nhạc châu Á",description:"Dữ liệu thật từ Apple Music cho ba thị trường châu Á.",images:[{url:"/og.png",width:1536,height:1024,alt:"Pulse Charts — Bắt nhịp âm nhạc châu Á"}],type:"website" },
  twitter:{ card:"summary_large_image",images:["/og.png"] },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="vi"><body>{children}</body></html>}
