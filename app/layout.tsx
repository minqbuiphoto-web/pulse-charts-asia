import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pulse-charts-asia.vercel.app";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Pulse Charts — Official Asian Music Charts",
  description: "Domestic Top 10 chart snapshots from Circle Chart, Billboard Japan and Tencent Music.",
  openGraph: {
    title: "Pulse Charts — Hear Each Market Move",
    description: "Official domestic chart signals from South Korea, Japan and Mainland China.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Pulse Charts — Official Asian Music Charts" }],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}