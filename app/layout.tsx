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
    type: "website",
  },
  twitter: { card: "summary" },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}