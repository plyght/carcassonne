"use client";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { FigureIcon } from "@carcassonne/render-classic";

import { useApplyGlobalSettings } from "@/lib/settings";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

const links: { to: Route; label: string }[] = [
  { to: "/play/new", label: "Play" },
  { to: "/online", label: "Online" },
  { to: "/replays", label: "Replays" },
  { to: "/tutorial", label: "Learn" },
  { to: "/settings", label: "Settings" },
];

export default function Header() {
  useApplyGlobalSettings();
  const path = usePathname();
  const inGame = path.startsWith("/play/local/") || path.startsWith("/play/online/") || path.startsWith("/replays/");
  return (
    <header className="carc-header" data-in-game={inGame ? "true" : undefined}>
      <div className="carc-header-inner">
        <Link href="/" className="carc-brand" aria-label="Carcassonne home">
          <span className="carc-brand-mark" aria-hidden>
            <FigureIcon fill="var(--primary)" ink="var(--primary-foreground)" marker="circle" size={22} outline="transparent" />
          </span>
          <span className="carc-brand-name">Carcassonne</span>
        </Link>
        <nav className="carc-nav" aria-label="Main">
          {links.map(({ to, label }) => (
            <Link key={to} href={to} className="carc-nav-link" aria-current={path.startsWith(to) ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="carc-header-end">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
