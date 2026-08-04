import type { Metadata } from "next";
import "./globals.css";
import "./panels.css";
import ModuleSwitcher from "./module-switcher";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulse-charts-asia.vercel.app";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Pulse Charts — Asian Music Discovery",
  description: "Asian music charts including vocal R&B and ballad classics, plus a free line-by-line lyric translation workspace with YouTube playback and lyrics lookup.",
  openGraph: {
    title: "Pulse Charts — Hear Each Market Move",
    description: "Music discovery across Asia with a dedicated lyric translation studio.",
    type: "website",
  },
  twitter: { card: "summary" },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><ModuleSwitcher/>{children}</body></html>;
}