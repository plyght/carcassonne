"use client";

import { useEffect, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Slider } from "dialkit";
import { Bot, ChevronDown, Copy, Play, Users } from "lucide-react";
import { toast } from "sonner";

import { DEFAULT_RULESET, type Ruleset } from "@carcassonne/protocol";
import { randomSeedString, type PlayerMeta } from "@carcassonne/game-client";
import { PLAYER_COLOR_ORDER } from "@carcassonne/render-classic";

import { DialButton, DialField, DialSurface, Segmented } from "@/components/dial/primitives";
import { TIER_INFO } from "@/components/dial/seat-row";
import { MiniBoard, type MiniTile } from "@/components/learn/mini-board";
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
  // Customize opens by itself when the link carries a setup (shared setup links).
  const [custom, setCustom] = useState(() => params.has("mode") || params.has("players") || params.has("seed"));

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

  const quickStart = () => {
    setStarting(true);
    const rec = createLocalGame({
      mode: "ai",
      ruleset: { ...DEFAULT_RULESET },
      seed: randomSeedString(),
      players: defaultSeats("ai", 3),
      engine: "core-wasm",
    });
    router.push(`/play/local/${rec.id}` as Route);
  };

  const humans = seats.filter((s) => s.kind === "human").length;
  const bots = seats.length - humans;

  return (
    <div className="carc-page">
      <h1 className="carc-page-title">New game</h1>
      <p className="carc-page-lead">If you have never played Carcassonne, use Quick start, and the game will tell you what to do on every turn.</p>

      <section className="carc-sheet carc-quick mt-[var(--sp-6)]" aria-labelledby="quick-h">
        <div className="carc-quick-text">
          <h2 id="quick-h" className="carc-heading">
            Quick start
          </h2>
          <p className="carc-quick-lead">
            You play against two Medium bots with the standard rules, which are the base game plus The River and The Abbot, and a game takes about half an hour.
          </p>
          <div className="carc-quick-actions">
            <DialButton variant="primary" data-size="large" onClick={quickStart} disabled={starting} data-testid="quick-start">
              <Play className="fill-current" /> Quick start
            </DialButton>
            <Link href={"/tutorial" as Route} className="carc-quick-link">
              Or learn first: the 3-minute tutorial
            </Link>
          </div>
        </div>
        <figure className="carc-quick-figure" aria-hidden>
          <MiniBoard tiles={QUICK_BOARD} cell={52} label="A small map: a city with a knight, a road with a thief, and a cloister." />
        </figure>
      </section>

      <section className="carc-customize mt-[var(--sp-6)]">
        <button
          type="button"
          className="carc-disclosure carc-disclosure-large"
          aria-expanded={custom}
          aria-controls="customize-body"
          onClick={() => setCustom((o) => !o)}
          data-testid="customize-toggle"
        >
          <span>Customize</span>
          <span className="carc-disclosure-hint">Choose the players, bot levels and rules, or play hot-seat with friends.</span>
          <ChevronDown className="carc-disclosure-chevron" aria-hidden />
        </button>
        {custom ? (
          <div id="customize-body">
            <DialSurface className="mt-[var(--sp-4)] flex flex-col gap-[var(--sp-2)]">
              <Segmented
                label="Mode"
                value={mode}
                onChange={changeMode}
                className="carc-seg-tabs"
                options={[
                  { value: "ai", label: "vs bots", icon: <Bot />, showLabel: true },
                  { value: "hotseat", label: "Hot-seat", icon: <Users />, showLabel: true },
                ]}
              />
              <p className="carc-dial-hint">
                {mode === "ai"
                  ? "You play against computer players (bots) on this device."
                  : "Friends take turns on this one device. Each player’s tile stays hidden until they’re ready."}
              </p>
            </DialSurface>

            <section className="carc-sheet mt-[var(--sp-6)]" aria-labelledby="players-h">
              <div className="flex flex-wrap items-baseline justify-between gap-[var(--sp-2)]">
                <h2 id="players-h" className="carc-heading">
                  Players
                </h2>
                <span className="text-[length:var(--fs-body)] text-[var(--text-2)]" data-testid="seat-summary">
                  {humans} {humans === 1 ? "human" : "humans"}
                  {bots ? ` · ${bots} ${bots === 1 ? "bot" : "bots"}` : ""}
                </span>
              </div>
              <DialSurface className="carc-dial-stack mt-[var(--sp-4)] gap-[var(--sp-4)]!">
                <DialField hint={humans === 0 ? "With only bots at the table, you can sit back and watch them play." : "You can play with two to five people, and three makes a good first game."}>
                  <Slider label="Players" value={count} min={2} max={5} step={1} onChange={changeCount} />
                </DialField>
                <SeatEditor seats={seats} onChange={setSeats} />
              </DialSurface>
              <div className="carc-explain mt-[var(--sp-4)]">
                <h3 className="carc-explain-title">What’s a bot level?</h3>
                <p className="carc-explain-text">Bots are computer players, and you can choose how strongly each one plays from its seat’s menu.</p>
                <dl className="carc-explain-list">
                  {TIER_INFO.map((t) => (
                    <div key={t.id}>
                      <dt>
                        {t.label}
                        {t.recommended ? <span className="carc-recommended" data-on="true">Recommended</span> : null}
                      </dt>
                      <dd>{t.hint}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>

            <section className="carc-sheet mt-[var(--sp-6)]" aria-labelledby="rules-h">
              <h2 id="rules-h" className="carc-heading">
                Rules
              </h2>
              <p className="carc-sub">The recommended settings match the current box, so if you are new to the game you can leave them as they are.</p>
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
        ) : null}
      </section>
    </div>
  );
}

const QUICK_BOARD: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "E", x: 0, y: -1, rot: 2, figure: { feature: 0, color: "red" } },
  { tile: "U", x: 1, y: 0, rot: 1, figure: { feature: 0, color: "blue" } },
  { tile: "A", x: 2, y: 0, rot: 1 },
  { tile: "V", x: -1, y: 0 },
];
