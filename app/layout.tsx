import type { Metadata } from "next";
import "./globals.css";
import "./panels.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulse-charts-asia.vercel.app";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Pulse Charts — Asian Music Discovery",
  description: "Nine current Top 20 music charts across Korea, Japan and China, with free YouTube playback and lyrics lookup.",
  openGraph: {
    title: "Pulse Charts — Hear Each Market Move",
    description: "Nine Top 20 charts spanning official rankings, ballad and OST discovery across Asia.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Pulse Charts — Asian Music Discovery" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}