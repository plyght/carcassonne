"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { Slider } from "dialkit";
import { Bot, Copy, Play, Users } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_RULESET, type Ruleset } from "@carcassonne/protocol";
import { randomSeedString, type PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLOR_ORDER } from "@carcassonne/render-classic";

import { DialButton, DialField, DialSurface, Segmented } from "@/components/dial/primitives";
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

/** Seats for a new count: keep the existing ones, add defaults with unused colours. */
function resize(prev: PlayerMeta[], mode: Mode, n: number): PlayerMeta[] {
  const base = defaultSeats(mode, n);
  const out = base.map((b, i) => prev[i] ?? b);
  const used = new Set<string>();
  return out.map((s) => {
    if (!used.has(s.color)) {
      used.add(s.color);
      return s;
    }
    const free = PLAYER_COLOR_ORDER.find((c) => !used.has(c) && !out.some((o) => o !== s && o.color === c))!;
    used.add(free);
    return { ...s, color: free };
  });
}

export function NewGameSetup() {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "hotseat" ? "hotseat" : "ai");
  const [count, setCount] = useState(() => Math.min(5, Math.max(2, Number(params.get("players")) || (mode === "ai" ? 3 : 2))));
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
    const k = Math.min(5, Math.max(2, Math.round(n)));
    if (k === count) return;
    setCount(k);
    setSeats((prev) => resize(prev, mode, k));
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
  const bots = seats.length - humans;

  return (
    <div className="carc-page">
      <h1 className="carc-page-title">New game</h1>
      <p className="carc-page-lead">Set the table: who’s playing, and which rules.</p>

      <DialSurface className="mt-[var(--sp-6)] flex">
        <Segmented
          label="Mode"
          value={mode}
          onChange={changeMode}
          className="carc-seg-tabs"
          options={[
            { value: "ai", label: "vs AI", icon: <Bot />, showLabel: true },
            { value: "hotseat", label: "Hot-seat", icon: <Users />, showLabel: true },
          ]}
        />
      </DialSurface>

      <section className="carc-sheet mt-[var(--sp-6)]" aria-labelledby="players-h">
        <div className="flex flex-wrap items-baseline justify-between gap-[var(--sp-2)]">
          <h2 id="players-h" className="carc-heading">Players</h2>
          <span className="text-[length:var(--fs-body)] text-[var(--text-2)]" data-testid="seat-summary">
            {humans} {humans === 1 ? "human" : "humans"}
            {bots ? ` · ${bots} ${bots === 1 ? "bot" : "bots"}` : ""}
          </span>
        </div>
        <DialSurface className="carc-dial-stack mt-[var(--sp-4)] gap-[var(--sp-4)]!">
          <DialField hint={humans === 0 ? "All bots: sit back and watch them play." : "Up to five at the table. Drag, scroll or use the arrow keys."}>
            <Slider label="Players" value={count} min={2} max={5} step={1} onChange={changeCount} />
          </DialField>
          <SeatEditor seats={seats} onChange={setSeats} />
        </DialSurface>
      </section>

      <section className="carc-sheet mt-[var(--sp-6)]" aria-labelledby="rules-h">
        <h2 id="rules-h" className="carc-heading">House rules</h2>
        <p className="carc-sub">Defaults match the current box: 3rd edition with The River and The Abbot.</p>
        <DialSurface className="mt-[var(--sp-4)]">
          <RulesForm ruleset={ruleset} onRuleset={setRuleset} seed={seed} onSeed={setSeed} />
        </DialSurface>
      </section>

      <DialSurface className="mt-[var(--sp-6)] flex flex-wrap-reverse items-center justify-between gap-[var(--sp-3)]">
        <DialButton
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareUrl());
              toast.success("Setup link copied");
            } catch {
              toast.error("Couldn’t copy the link");
            }
          }}
        >
          <Copy /> Copy setup link
        </DialButton>
        <DialButton variant="primary" data-size="large" onClick={start} disabled={starting} data-testid="start-game">
          <Play className="fill-current" /> Start game
        </DialButton>
      </DialSurface>
    </div>
  );
}
