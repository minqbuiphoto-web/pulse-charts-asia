"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const modules = [
  { id: "charts", href: "/", label: "BXH NHẠC", sub: "Khám phá", external: false },
  { id: "lyric", href: "/studio/", label: "LYRIC STUDIO", sub: "Viết lời", external: false },
  { id: "cover", href: "https://pulse-vietnamese-cover-studio.vercel.app/", label: "COVER STUDIO", sub: "Tạo giọng", external: true },
  { id: "mv", href: "/mv-studio/", label: "MV STUDIO", sub: "Làm video", external: false },
  { id: "audio", href: "/audio-lab/", label: "AUDIO LAB", sub: "Đổi audio", external: false },
];

export default function ModuleSwitcher() {
  const path = usePathname();
  const active = path.startsWith("/audio-lab") ? "audio" : path.startsWith("/studio") ? "lyric" : path.startsWith("/mv-studio") ? "mv" : path.startsWith("/cover-studio") ? "cover" : "charts";

  return <nav className="global-modules" aria-label="Chuyển chức năng">
    {modules.map((item, index) => {
      const content = <><i>{String(index + 1).padStart(2, "0")}</i><b>{item.label}</b><span>{item.sub}</span></>;
      return item.external
        ? <a className={active === item.id ? "active" : ""} href={item.href} key={item.id}>{content}</a>
        : <Link className={active === item.id ? "active" : ""} href={item.href} key={item.id}>{content}</Link>;
    })}
  </nav>;
}
