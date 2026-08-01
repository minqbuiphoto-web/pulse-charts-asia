import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulse-charts-asia.minqbuiphoto.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Pulse Charts — Bảng xếp hạng âm nhạc châu Á",
  description: "Theo dõi bảng xếp hạng bài hát và nhạc phim nổi bật tại Hàn Quốc, Nhật Bản và Trung Quốc.",
  openGraph: {
    title: "Pulse Charts — Bắt nhịp âm nhạc châu Á",
    description: "7 bảng xếp hạng bài hát và nhạc phim trong một giao diện gọn, nhanh.",
    images: [{ url:"/og.png", width:1536, height:1024, alt:"Pulse Charts — Bắt nhịp âm nhạc châu Á" }],
    type:"website",
  },
  twitter: { card:"summary_large_image", images:["/og.png"] },
};

export default function RootLayout({ children }:{ children:React.ReactNode }) { return <html lang="vi"><body>{children}</body></html>; }
