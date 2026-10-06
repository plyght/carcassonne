"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { Bot, Film, GraduationCap, Play, Settings, Swords, Trophy, Users } from "lucide-react";

import { getStyle } from "@carcassonne/render-classic";

import { StylePreview } from "@/components/style/style-preview";
import { listGames, type LocalGameRecord } from "@/lib/local-games";

const MODES: { href: string; title: string; blurb: string; icon: typeof Bot; accent?: boolean }[] = [
  { href: "/play/new?mode=ai", title: "Play vs AI", blurb: "Bots from Easy to Expert, running in your browser.", icon: Bot, accent: true },
  { href: "/play/new?mode=hotseat", title: "Hot-seat", blurb: "Pass one device around the table.", icon: Users },
  { href: "/online", title: "Online room", blurb: "Invite friends with a link. Mix in bots.", icon: Swords },
  { href: "/ranked", title: "Ranked", blurb: "3- and 4-player free-for-all, Glicko‑2 rated.", icon: Trophy },
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
    <div className="carc-menu">
      <section className="flex min-w-0 flex-col justify-center">
        <p className="carc-eyebrow" data-tone="accent">
          A tile-laying classic
        </p>
        <h1 className="carc-hero-title">
          Build the countryside, <em>one tile at a time.</em>
        </h1>
        <p className="carc-hero-lead">
          Draw a tile, fit it to the land, and send a meeple to claim a road, a city, a cloister or a field. The base game, The River and The
          Abbot, with every rule edition.
        </p>
        <div className="mt-[var(--sp-6)] flex flex-wrap gap-[var(--sp-3)]">
          <Link href={"/play/new?mode=ai" as Route} className="carc-btn" data-variant="primary" data-size="large">
            <Play className="fill-current" /> Quick game vs AI
          </Link>
          {resume ? (
            <Link href={`/play/local/${resume.id}` as Route} className="carc-btn" data-size="large">
              Continue game <span className="carc-num text-[var(--text-2)]">· turn {resume.moves.length + 1}</span>
            </Link>
          ) : null}
        </div>

        <nav aria-label="Game modes" className="carc-modes">
          {MODES.map(({ href, title, blurb, icon: Icon, accent }) => (
            <Link key={href} href={href as Route} className="carc-card-link" data-wide={accent || undefined}>
              <span className="carc-well">
                <Icon />
              </span>
              <span className="min-w-0">
                <span className="carc-mode-title">{title}</span>
                <span className="carc-mode-blurb">{blurb}</span>
              </span>
            </Link>
          ))}
        </nav>
      </section>

      <section aria-hidden className="relative hidden min-w-0 lg:block">
        <div className="carc-tray">
          <StylePreview style={getStyle("classic")} className="h-full min-h-[560px]" />
        </div>
      </section>
    </div>
  );
}
