import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audio Lab — Pulse Charts",
  description: "Tách giọng lấy beat, nối và làm mượt các đoạn nhạc, đổi tốc độ và cao độ ngay trên thiết bị.",
  openGraph: {
    title: "Pulse Charts — Audio Lab",
    description: "Extract the beat. Remaster the track. Keep it local.",
    images: [{ url: "/og-audio-lab.png", width: 1536, height: 1024, alt: "Pulse Charts Audio Lab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse Charts — Audio Lab",
    description: "Extract the beat. Remaster the track. Keep it local.",
    images: ["/og-audio-lab.png"],
  },
};

export default function AudioLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
