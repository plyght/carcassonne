"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { Bot, Film, GraduationCap, Play, Settings, Swords, Trophy, Users } from "lucide-react";

import { getStyle } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { StylePreview } from "@/components/style/style-preview";
import { listGames, type LocalGameRecord } from "@/lib/local-games";

const MODES: { href: string; title: string; blurb: string; icon: typeof Bot; accent?: boolean }[] = [
  { href: "/play/new?mode=ai", title: "Play vs AI", blurb: "Bots from Easy to Expert, running in your browser.", icon: Bot, accent: true },
  { href: "/play/new?mode=hotseat", title: "Hot-seat", blurb: "Pass one device around the table.", icon: Users },
  { href: "/online", title: "Online room", blurb: "Invite friends with a link. Mix in bots.", icon: Swords },
  { href: "/ranked", title: "Ranked", blurb: "3- and 4-player free-for-all, Glicko-2 rated.", icon: Trophy },
  { href: "/tutorial", title: "Tutorial", blurb: "Relearn the rules in a guided game.", icon: GraduationCap },
  { href: "/replays", title: "Replays", blurb: "Scrub through finished games turn by turn.", icon: Film },
  { href: "/settings", title: "Settings", blurb: "Board style, camera, motion and more.", icon: Settings },
];

export default function Home() {
  const [resume, setResume] = useState<LocalGameRecord | null>(null);
  useEffect(() => {
    setResume(listGames().find((g) => g.status === "playing" && g.moves.length > 0) ?? null);
  }, []);

  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-8 lg:grid-cols-[1.05fr_1fr] lg:py-14">
      <section className="flex min-w-0 flex-col justify-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary">A tile-laying classic</p>
        <h1 className="mt-3 font-display text-5xl leading-[1.02] tracking-tight sm:text-6xl">
          Build the countryside,
          <br />
          <span className="italic text-primary">one tile at a time.</span>
        </h1>
        <p className="mt-4 max-w-lg text-base text-muted-foreground">
          Draw a tile, fit it to the land, and send a meeple to claim a road, a city, a cloister or a field. The base game, The River and The
          Abbot, with every rule edition.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={"/play/new?mode=ai" as Route}
            className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5"
          >
            <Play className="size-4 fill-current" /> Quick game vs AI
          </Link>
          {resume ? (
            <Link
              href={`/play/local/${resume.id}` as Route}
              className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-5 py-3 font-semibold transition-colors hover:bg-muted"
            >
              Continue game · turn {resume.moves.length + 1}
            </Link>
          ) : null}
        </div>

        <nav aria-label="Game modes" className="mt-10 grid gap-3 sm:grid-cols-2">
          {MODES.map(({ href, title, blurb, icon: Icon, accent }) => (
            <Link
              key={href}
              href={href as Route}
              className={cn(
                "group flex items-start gap-3 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                accent && "sm:col-span-2 bg-[linear-gradient(120deg,color-mix(in_oklch,var(--felt)_16%,var(--card)),var(--card))]",
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="size-5" />
              </span>
              <span>
                <span className="block font-display text-lg leading-tight">{title}</span>
                <span className="block text-sm text-muted-foreground">{blurb}</span>
              </span>
            </Link>
          ))}
        </nav>
      </section>

      <section aria-hidden className="relative hidden min-w-0 lg:block">
        <div className="absolute -inset-4 rotate-2 rounded-[2.5rem] bg-wood/30 blur-2xl" />
        <div className="relative h-full min-h-[560px] overflow-hidden rounded-[2rem] border-8 border-[color-mix(in_oklch,var(--wood)_80%,black)] shadow-2xl">
          <StylePreview style={getStyle("classic")} className="h-full min-h-[560px]" />
        </div>
      </section>
    </div>
  );
}
