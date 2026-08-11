import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Audio Lab — Pulse Charts",
  description: "Đổi tốc độ và cao độ audio độc lập, xử lý riêng tư ngay trên thiết bị.",
  openGraph: {
    title: "Pulse Charts — Audio Lab",
    description: "Shape the sound. Keep it local.",
    images: [{ url: "/og-audio-lab.png", width: 1536, height: 1024, alt: "Pulse Charts Audio Lab" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Pulse Charts — Audio Lab",
    description: "Shape the sound. Keep it local.",
    images: ["/og-audio-lab.png"],
  },
};

export default function AudioLabLayout({ children }: { children: React.ReactNode }) {
  return children;
}
