import type { Metadata } from "next";
import "./globals.css";

const siteUrl=process.env.NEXT_PUBLIC_SITE_URL??"https://pulse-charts-asia.minqbuiphoto.chatgpt.site";
export const metadata:Metadata={
  metadataBase:new URL(siteUrl),
  title:"Pulse Charts — Asian Music Charts",
  description:"Apple Music Top 10 charts for South Korea, Japan and China, synced from Apple's public data feeds.",
  openGraph:{ title:"Pulse Charts — See What Asia Is Listening To",description:"Live Apple Music chart data across three Asian markets.",images:[{url:"/og.png",width:1536,height:1024,alt:"Pulse Charts — Asian Music Charts"}],type:"website" },
  twitter:{ card:"summary_large_image",images:["/og.png"] },
};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}