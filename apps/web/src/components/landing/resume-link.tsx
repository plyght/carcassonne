"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";

import { listGames, type LocalGameRecord } from "@/lib/local-games";

/** "Continue your game" when a local game is unfinished; otherwise what Play now does. */
export function HeroMeta() {
  const [resume, setResume] = useState<LocalGameRecord | null>(null);
  useEffect(() => {
    setResume(listGames().find((g) => g.status === "playing" && g.moves.length > 0 && g.mode !== "tutorial") ?? null);
  }, []);
  if (!resume) return <p className="lp-hero-meta">You’ll play two Medium bots with the standard rules, and you don’t need an account.</p>;
  return (
    <p className="lp-hero-meta">
      Or{" "}
      <Link href={`/play/local/${resume.id}` as Route} className="lp-link lp-link-light">
        continue your game, turn <span className="carc-num">{resume.moves.length + 1}</span>
      </Link>
      .
    </p>
  );
}
