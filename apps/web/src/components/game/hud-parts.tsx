"use client";

import { useEffect, useState, type ReactNode } from "react";

import { cn } from "@carcassonne/ui/lib/utils";
import { Castle, Church, Flower2, Route, Timer, Wheat } from "lucide-react";

import { REACTIONS, type FigureOption, type GameView, type TileId } from "@carcassonne/protocol";
import type { PlayerMeta, Reaction, TileCatalog } from "@carcassonne/game-client";
import {
  FigureIcon,
  PLAYER_COLORS,
  playerFill,
  TileThumb,
  type BoardPalette,
  type TileArtSource,
} from "@carcassonne/render-classic";

import { FEATURE_LABEL, FIGURE_ROLE, formatClock, playerName, type Projection } from "./helpers";

export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-2xl border border-border/70 bg-card/92 text-card-foreground shadow-[0_10px_30px_-12px_rgba(40,25,10,0.45)] backdrop-blur-md",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-[10px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  );
}

// ── score panel ─────────────────────────────────────────────────────────────

const CATS = [
  { key: "road", icon: Route, label: "Roads" },
  { key: "city", icon: Castle, label: "Cities" },
  { key: "cloister", icon: Church, label: "Cloisters" },
  { key: "garden", icon: Flower2, label: "Gardens" },
  { key: "field", icon: Wheat, label: "Fields" },
] as const;

export function ScorePanel({
  view,
  players,
  localSeats,
  reactions,
  hideReactions,
  thinking,
  palette,
}: {
  view: GameView;
  players: PlayerMeta[];
  localSeats: number[];
  reactions: Reaction[];
  hideReactions: boolean;
  thinking: boolean;
  palette: BoardPalette;
}) {
  const leader = Math.max(...view.players.map((p) => p.score));
  return (
    <>
    {/* compact strip for phones */}
    <Panel className="flex w-full gap-1 overflow-x-auto p-1.5 md:hidden" aria-label="Scores">
      {view.players.map((p, i) => {
        const color = players[i]?.color ?? "red";
        const app = PLAYER_COLORS[color];
        const active = view.status === "playing" && view.currentPlayer === i;
        return (
          <div key={i} className={cn("relative flex items-center gap-1.5 rounded-lg px-2 py-1", active && "bg-accent/70 ring-1 ring-gold/60")}>
            <FigureIcon fill={playerFill(palette, color)} ink={app.ink} marker={app.marker} size={18} />
            <span className="max-w-16 truncate text-xs font-medium">{playerName(players, i)}</span>
            <span className="font-display text-base tabular-nums">{p.score}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">×{p.meeples}</span>
            {!hideReactions
              ? reactions
                  .filter((r) => r.player === i)
                  .map((r) => (
                    <span key={r.id} className="reaction-float pointer-events-none absolute -top-3 right-1 text-xl" aria-hidden>
                      {r.emoji}
                    </span>
                  ))
              : null}
          </div>
        );
      })}
    </Panel>
    <Panel className="hidden w-full p-2 md:block" aria-label="Scores">
      <ol className="flex flex-col gap-1">
        {view.players.map((p, i) => {
          const meta = players[i];
          const color = meta?.color ?? "red";
          const app = PLAYER_COLORS[color];
          const active = view.status === "playing" && view.currentPlayer === i;
          const mine = reactions.filter((r) => r.player === i);
          return (
            <li
              key={i}
              className={cn(
                "relative rounded-xl border border-transparent px-2.5 py-2 transition-colors",
                active && "turn-glow border-gold/60 bg-accent/60",
              )}
              aria-current={active ? "true" : undefined}
            >
              <div className="flex items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `${app.fill}22` }}>
                  <FigureIcon fill={playerFill(palette, color)} ink={app.ink} marker={app.marker} size={24} title={`${app.label} meeple`} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{playerName(players, i)}</span>
                    {meta?.kind === "bot" ? (
                      <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground">
                        bot · {meta.tier}
                      </span>
                    ) : null}
                    {localSeats.includes(i) && localSeats.length === 1 ? (
                      <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">you</span>
                    ) : null}
                    {meta?.connected === false ? <span className="text-[10px] text-destructive">offline</span> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-0.5" aria-label={`${p.meeples} meeples in supply`}>
                    {Array.from({ length: 7 }, (_, k) => (
                      <FigureIcon
                        key={k}
                        fill={k < p.meeples ? playerFill(palette, color) : "transparent"}
                        outline={k < p.meeples ? "rgba(0,0,0,0.45)" : "color-mix(in oklch, currentColor 35%, transparent)"}
                        ink={k < p.meeples ? app.ink : "transparent"}
                        marker={app.marker}
                        size={13}
                      />
                    ))}
                    {view.ruleset.abbot ? (
                      <span className="ml-1" title={p.abbotAvailable ? "Abbot in supply" : "Abbot on the board"}>
                        <FigureIcon
                          kind="abbot"
                          fill={p.abbotAvailable ? playerFill(palette, color) : "transparent"}
                          outline={p.abbotAvailable ? "rgba(0,0,0,0.45)" : "color-mix(in oklch, currentColor 35%, transparent)"}
                          ink={p.abbotAvailable ? app.ink : "transparent"}
                          marker={app.marker}
                          size={14}
                        />
                      </span>
                    ) : null}
                    {active && thinking ? <span className="ml-1 animate-pulse text-[11px] text-muted-foreground">thinking…</span> : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className={cn("font-display text-2xl leading-none tabular-nums", p.score === leader && leader > 0 && "text-primary")}>
                    {p.score}
                  </div>
                </div>
              </div>
              <div className="mt-1.5 flex gap-2.5 pl-10 text-[11px] text-muted-foreground">
                {CATS.filter((c) => c.key !== "garden" || view.ruleset.abbot).map(({ key, icon: Icon, label }) => (
                  <span key={key} className="inline-flex items-center gap-0.5 tabular-nums" title={label}>
                    <Icon className="size-3" aria-hidden />
                    <span className="sr-only">{label}</span>
                    {p.breakdown[key]}
                  </span>
                ))}
              </div>
              {!hideReactions
                ? mine.map((r) => (
                    <span key={r.id} className="reaction-float pointer-events-none absolute -top-2 right-10 text-2xl" aria-hidden>
                      {r.emoji}
                    </span>
                  ))
                : null}
            </li>
          );
        })}
      </ol>
    </Panel>
    </>
  );
}

// ── tile in hand + figure choice ────────────────────────────────────────────

export interface FigureChoice {
  key: string;
  label: string;
  detail: string;
  option: FigureOption | { type: "recallAbbot" } | null;
}

export function figureChoices(
  options: FigureOption[],
  tile: TileId,
  catalog: TileCatalog,
  recall: { points: number } | null,
): FigureChoice[] {
  const def = catalog.get(tile);
  const out: FigureChoice[] = options.map((o, i) => {
    const kind = def?.features[o.feature]?.kind ?? "field";
    const same = options.filter((x) => (def?.features[x.feature]?.kind ?? "") === kind && x.type === o.type);
    const nth = same.length > 1 ? ` ${same.indexOf(o) + 1}` : "";
    return {
      key: `${o.type}-${o.feature}-${i}`,
      label: o.type === "abbot" ? `Abbot on ${FEATURE_LABEL[kind]}` : `Meeple on ${FEATURE_LABEL[kind]}${nth}`,
      detail: o.type === "abbot" ? "abbot" : FIGURE_ROLE[kind],
      option: o,
    };
  });
  if (recall) out.push({ key: "recall", label: "Recall abbot", detail: `+${recall.points} now`, option: { type: "recallAbbot" } });
  out.push({ key: "skip", label: "No figure", detail: "skip", option: null });
  return out;
}

export function TileInHand({
  tile,
  rot,
  catalog,
  art,
  palette,
  hidden,
  canAct,
  pending,
  choices,
  onRotate,
  onChoose,
  onBack,
  waitingFor,
  discardsNote,
}: {
  tile: TileId | null;
  rot: number;
  catalog: TileCatalog;
  art: TileArtSource;
  palette: BoardPalette;
  hidden: boolean;
  canAct: boolean;
  pending: boolean;
  choices: FigureChoice[];
  onRotate(dir: 1 | -1): void;
  onChoose(c: FigureChoice): void;
  onBack(): void;
  waitingFor: string | null;
  discardsNote?: string | null;
}) {
  const def = tile ? catalog.get(tile) : undefined;
  return (
    <Panel className="w-full p-3" aria-label="Tile in hand">
      <div className="flex items-start gap-3">
        <div
          className="relative grid size-[104px] shrink-0 place-items-center rounded-xl p-1 shadow-inner"
          style={{ background: palette.table }}
        >
          {def && !hidden ? (
            <div className="transition-transform duration-200 ease-out" style={{ transform: `rotate(${rot * 90}deg)` }}>
              <TileThumb def={def} art={art} palette={palette} size={92} title={`Tile ${def.id}`} />
            </div>
          ) : (
            <div className="grid size-[92px] place-items-center rounded-md bg-black/20 font-display text-3xl text-white/80">?</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tile in hand</div>
          {canAct && !pending ? (
            <>
              <p className="mt-1 text-sm leading-snug">Click a glowing spot to place it.</p>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onRotate(-1)}
                  className="rounded-lg border bg-background px-2 py-1 text-sm hover:bg-muted"
                  aria-label="Rotate counter-clockwise"
                >
                  ↺
                </button>
                <button
                  type="button"
                  onClick={() => onRotate(1)}
                  className="rounded-lg border bg-background px-2 py-1 text-sm hover:bg-muted"
                  aria-label="Rotate clockwise"
                >
                  ↻
                </button>
              </div>
              <p className="mt-2 hidden text-[11px] md:block leading-relaxed text-muted-foreground">
                <Kbd>R</Kbd> / scroll rotate · <Kbd>←↑→↓</Kbd> pick spot · <Kbd>Enter</Kbd> place
              </p>
            </>
          ) : null}
          {pending ? <p className="mt-1 text-sm font-medium">Place a figure?</p> : null}
          {!canAct ? (
            <p className="mt-1 text-sm text-muted-foreground">{waitingFor ? `Waiting for ${waitingFor}…` : "Game over"}</p>
          ) : null}
          {discardsNote ? <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{discardsNote}</p> : null}
        </div>
      </div>
      {pending ? (
        <div className="mt-3 grid gap-1.5" role="group" aria-label="Figure choice">
          {choices.map((c, i) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChoose(c)}
              className={cn(
                "flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:border-primary/60 hover:bg-accent",
                c.option === null && "border-dashed",
              )}
            >
              <span className="flex items-center gap-2">
                <Kbd>{c.option === null ? "S" : i + 1}</Kbd>
                <span className="font-medium">{c.label}</span>
              </span>
              <span className="text-xs text-muted-foreground">{c.detail}</span>
            </button>
          ))}
          <button type="button" onClick={onBack} className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
            ← Pick another spot <Kbd>Esc</Kbd>
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

// ── remaining tiles ─────────────────────────────────────────────────────────

export function RemainingTiles({
  remaining,
  catalog,
  art,
  palette,
}: {
  remaining: Record<string, number>;
  catalog: TileCatalog;
  art: TileArtSource;
  palette: BoardPalette;
}) {
  const ids = catalog.all().map((d) => d.id);
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  return (
    <Panel className="w-full p-3" aria-label="Remaining tiles">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Draw pile</span>
        <span className="font-display text-lg tabular-nums">{total}</span>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {ids.map((id) => {
          const def = catalog.get(id)!;
          const n = remaining[id] ?? 0;
          return (
            <div key={id} className={cn("relative", n === 0 && "opacity-25 grayscale")} title={`${id}: ${n} left`}>
              <TileThumb def={def} art={art} palette={palette} size={36} title={`Tile ${id}, ${n} left`} />
              <span className="absolute -right-1 -bottom-1 grid min-w-4 place-items-center rounded-full bg-foreground px-1 text-[10px] font-bold text-background tabular-nums">
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ── reactions ───────────────────────────────────────────────────────────────

export function ReactionBar({ onReact, disabled }: { onReact(e: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const quick = REACTIONS.slice(0, 6);
  const shown = open ? REACTIONS : quick;
  return (
    <Panel className="flex max-w-[min(92vw,640px)] flex-wrap items-center justify-center gap-0.5 px-2 py-1.5" aria-label="Emoji reactions">
      {shown.map((e) => (
        <button
          key={e}
          type="button"
          disabled={disabled}
          onClick={() => onReact(e)}
          className="grid size-9 place-items-center rounded-lg text-xl transition-transform hover:scale-125 hover:bg-muted active:scale-95 disabled:opacity-40"
          aria-label={`React ${e}`}
        >
          {e}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ml-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        aria-expanded={open}
      >
        {open ? "less" : `+${REACTIONS.length - quick.length}`}
      </button>
    </Panel>
  );
}

// ── clock ───────────────────────────────────────────────────────────────────

export function TurnClock({ startedAt, deadline }: { startedAt: number; deadline: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = deadline ? formatClock(deadline - now) : formatClock(now - startedAt);
  const urgent = deadline !== null && deadline - now < 10_000;
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-mono text-sm tabular-nums", urgent ? "text-destructive" : "text-muted-foreground")}
      title={deadline ? "Time left this turn" : "Time this turn"}
      suppressHydrationWarning
    >
      <Timer className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

// ── feature hover info ──────────────────────────────────────────────────────

export function FeatureInfo({ p, players }: { p: Projection; players: PlayerMeta[] }) {
  return (
    <Panel className="px-3 py-2 text-sm" aria-live="polite">
      <div className="flex items-center gap-2">
        <span className="font-semibold capitalize">{FEATURE_LABEL[p.kind]}</span>
        <span className="text-xs text-muted-foreground">
          {p.tiles} tile{p.tiles === 1 ? "" : "s"}
          {p.pennants ? ` · ${p.pennants} pennant${p.pennants === 1 ? "" : "s"}` : ""}
          {p.complete ? " · complete" : ""}
        </span>
      </div>
      <div className="mt-0.5 text-xs">
        {p.holders.length ? (
          <span>
            Held by{" "}
            {p.holders.map((h, i) => (
              <span key={h} className="font-semibold" style={{ color: PLAYER_COLORS[players[h]?.color ?? "red"].fill }}>
                {i ? " & " : ""}
                {playerName(players, h)}
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">Unclaimed</span>
        )}
        <span className="text-muted-foreground">
          {" · "}
          {p.ifCompleted !== null && !p.complete ? `${p.ifCompleted} if completed · ` : ""}
          {p.atEnd} at game end
        </span>
      </div>
    </Panel>
  );
}
