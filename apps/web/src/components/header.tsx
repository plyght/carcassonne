"use client";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@carcassonne/ui/lib/utils";
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
    <header className={cn("relative z-30 border-b border-border/70 bg-background/80 backdrop-blur", inGame && "bg-background/95")}>
      <div className="mx-auto flex h-13 max-w-7xl items-center justify-between gap-4 px-4">
        <Link href="/" className="flex items-center gap-2" aria-label="Carcassonne home">
          <span className="grid size-8 place-items-center rounded-xl bg-primary/12">
            <FigureIcon fill="var(--primary)" ink="var(--primary-foreground)" marker="circle" size={22} outline="transparent" />
          </span>
          <span className="font-display text-xl tracking-tight">Carcassonne</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm md:flex" aria-label="Main">
          {links.map(({ to, label }) => (
            <Link
              key={to}
              href={to}
              className={cn(
                "rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                path.startsWith(to) && "bg-muted text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ModeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
