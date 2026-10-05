"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Copy, Play, Users } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_RULESET, type Ruleset } from "@carcassonne/protocol";
import { randomSeedString, type PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLOR_ORDER } from "@carcassonne/render-classic";
import { cn } from "@carcassonne/ui/lib/utils";

import { RulesForm } from "@/components/setup/rules-form";
import { botName, SeatEditor } from "@/components/setup/seat-editor";
import { createLocalGame } from "@/lib/local-games";

type Mode = "ai" | "hotseat";

function defaultSeats(mode: Mode, n: number): PlayerMeta[] {
  return Array.from({ length: n }, (_, i) => {
    const color = PLAYER_COLOR_ORDER[i]!;
    if (mode === "ai" && i > 0) return { name: botName(i), color, kind: "bot", tier: "medium" } as PlayerMeta;
    return { name: mode === "ai" ? "You" : `Player ${i + 1}`, color, kind: "human" } as PlayerMeta;
  });
}

export function NewGameSetup() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "hotseat" ? "hotseat" : "ai");
  const [count, setCount] = useState(Number(params.get("players")) || (mode === "ai" ? 3 : 2));
  const [seats, setSeats] = useState<PlayerMeta[]>(() => defaultSeats(mode, count));
  const [ruleset, setRuleset] = useState<Ruleset>({ ...DEFAULT_RULESET });
  const [seed, setSeed] = useState<string>(() => params.get("seed") ?? "");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!seed) setSeed(randomSeedString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeMode = (m: Mode) => {
    setMode(m);
    setSeats(defaultSeats(m, count));
  };
  const changeCount = (n: number) => {
    setCount(n);
    setSeats((prev) => {
      const base = defaultSeats(mode, n);
      return base.map((b, i) => prev[i] ?? b);
    });
  };

  const shareUrl = () => {
    const u = new URL(window.location.href);
    u.search = new URLSearchParams({ mode, players: String(count), seed }).toString();
    return u.toString();
  };

  const start = () => {
    setStarting(true);
    const rec = createLocalGame({
      mode,
      ruleset,
      seed: seed.trim() || randomSeedString(),
      players: seats.map((s, i) => ({ ...s, name: s.name.trim() || `Player ${i + 1}` })),
      engine: "core-wasm",
    });
    router.push(`/play/local/${rec.id}` as Route);
  };

  const humans = seats.filter((s) => s.kind === "human").length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl tracking-tight">New game</h1>
      <p className="mt-1 text-muted-foreground">Set the table: who’s playing, and which rules.</p>

      <div className="mt-6 inline-flex rounded-2xl bg-muted p-1" role="tablist" aria-label="Mode">
        {(
          [
            { id: "ai", label: "vs AI", icon: Bot },
            { id: "hotseat", label: "Hot-seat", icon: Users },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            type="button"
            onClick={() => changeMode(id)}
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
              mode === id ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>

      <section className="mt-6 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Players</h2>
          <div className="inline-flex rounded-xl bg-muted p-0.5" role="radiogroup" aria-label="Number of players">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={count === n}
                onClick={() => changeCount(n)}
                className={cn("rounded-lg px-3.5 py-1 text-sm font-semibold", count === n ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <SeatEditor seats={seats} onChange={setSeats} />
        {humans === 0 ? <p className="mt-2 text-xs text-muted-foreground">All bots: sit back and watch them play.</p> : null}
      </section>

      <section className="mt-5 rounded-3xl border border-border/80 bg-card/80 p-5 shadow-sm">
        <h2 className="font-display text-2xl">House rules</h2>
        <p className="mb-2 text-sm text-muted-foreground">Defaults match the current box (3rd edition with The River and The Abbot).</p>
        <RulesForm ruleset={ruleset} onRuleset={setRuleset} seed={seed} onSeed={setSeed} />
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareUrl());
              toast.success("Setup link copied");
            } catch {
              toast.error("Couldn’t copy the link");
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-4" /> Copy shareable setup (seed {seed || "…"})
        </button>
        <button
          type="button"
          onClick={start}
          disabled={starting}
          data-testid="start-game"
          className="inline-flex items-center gap-2 rounded-2xl bg-primary px-6 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-transform hover:-translate-y-0.5 disabled:opacity-60"
        >
          <Play className="size-4 fill-current" /> Start game
        </button>
      </div>
    </div>
  );
}
