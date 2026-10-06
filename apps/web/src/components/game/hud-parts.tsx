"use client";

import { Fragment, useEffect, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@carcassonne/ui/lib/utils";
import { ChevronDown, Maximize, Minus, Plus, Timer } from "reicon-react";

import { REACTIONS, type FeatureKind, type FigureOption, type GameView, type TileId } from "@carcassonne/protocol";
import { featureRule, type PlayerMeta, type Reaction, type TileCatalog } from "@carcassonne/game-client";
import {
  FigureIcon,
  PLAYER_COLORS,
  TileThumb,
  type BoardCommands,
  type BoardPalette,
  type TileArtSource,
} from "@carcassonne/render-classic";

import { FEATURE_LABEL, FIGURE_ROLE, formatClock, playerName, type Projection } from "./helpers";

/** A floating cardstock panel over the board. */
export function Panel({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("carc-hud-sheet pointer-events-auto", className)} {...rest}>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="carc-kbd">{children}</kbd>;
}

export function Tag({ tone, children, className }: { tone?: "accent" | "gold" | "danger"; children: ReactNode; className?: string }) {
  return (
    <span className={cn("carc-tag", className)} data-tone={tone}>
      {children}
    </span>
  );
}

// ── score panel ─────────────────────────────────────────────────────────────

const CATS = [
  { key: "road", label: "Roads" },
  { key: "city", label: "Cities" },
  { key: "cloister", label: "Cloisters" },
  { key: "garden", label: "Gardens" },
  { key: "field", label: "Fields" },
] as const;

const TIER_LABEL: Record<string, string> = { easy: "Easy", medium: "Medium", hard: "Hard", expert: "Expert" };

/** A player's colour as a solid swatch with their meeple on it (no outlines). */
export function SeatSwatch({ color, size = 40, title }: { color: PlayerMeta["color"]; size?: number; title?: string }) {
  const app = PLAYER_COLORS[color];
  return (
    <span className="carc-swatch" data-color={color} style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink, width: size, height: size }} title={title}>
      <FigureIcon fill={app.ink} ink={app.fill} outline="none" marker={app.marker} size={Math.round(size * 0.66)} />
    </span>
  );
}

/** Solid chip: the player's meeple and how many are left ("×5"), or the abbot. */
export function SupplyChip({
  color,
  kind = "meeple",
  count,
  label,
  away,
  title,
}: {
  color: PlayerMeta["color"];
  kind?: "meeple" | "abbot";
  count?: number;
  label: string;
  away?: boolean;
  title?: string;
}) {
  const app = PLAYER_COLORS[color];
  return (
    <span className="carc-supply" data-color={color} data-kind={kind} data-away={away || undefined} title={title} style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink }}>
      <FigureIcon kind={kind} fill="currentColor" ink={away ? "transparent" : app.fill} outline="none" marker={app.marker} size={18} />
      {count !== undefined ? <span className="carc-supply-count carc-num">×{count}</span> : null}
      <span className="carc-supply-label">{label}</span>
    </span>
  );
}

/** "Roads 4 · Cities 8": only what has scored, each item kept on one line. */
function breakdownText(b: GameView["players"][number]["breakdown"], abbot: boolean): ReactNode {
  const parts = CATS.filter((c) => (c.key !== "garden" || abbot) && b[c.key] > 0);
  if (!parts.length) return "No points yet";
  return parts.map((c, i) => (
    <Fragment key={c.key}>
      {i ? " · " : ""}
      <span className="carc-score-part">
        {c.label} <span className="carc-num">{b[c.key]}</span>
      </span>
    </Fragment>
  ));
}

export function ScorePanel({
  view,
  players,
  localSeats,
  reactions,
  hideReactions,
  thinking,
  head,
  idle,
}: {
  view: GameView;
  players: PlayerMeta[];
  localSeats: number[];
  reactions: Reaction[];
  hideReactions: boolean;
  thinking: boolean;
  palette?: BoardPalette;
  /** The title row drawn above the players (back, game name, whose turn). */
  head?: ReactNode;
  /** Nobody is to move (a finished lesson). */
  idle?: boolean;
}) {
  const playing = view.status === "playing" && !idle;
  const leader = Math.max(...view.players.map((p) => p.score));
  const single = localSeats.length === 1;
  return (
    <>
      {/* compact strip for phones */}
      <Panel className="carc-score-strip carc-glass" aria-label="Scores">
        {view.players.map((p, i) => {
          const color = players[i]?.color ?? "red";
          const active = playing && view.currentPlayer === i;
          return (
            <div
              key={i}
              className="carc-score-chip"
              data-active={active || undefined}
              aria-current={active ? "true" : undefined}
              style={{ ["--seat" as string]: PLAYER_COLORS[color].fill }}
            >
              <SeatSwatch color={color} size={24} />
              <span className="carc-score-chip-name">{playerName(players, i)}</span>
              <span className="carc-score-chip-score carc-num" data-leader={p.score === leader && leader > 0 ? "true" : undefined}>
                {p.score}
              </span>
              {!hideReactions
                ? reactions
                    .filter((r) => r.player === i)
                    .map((r) => (
                      <span key={r.id} className="reaction-float carc-reaction" aria-hidden>
                        {r.emoji}
                      </span>
                    ))
                : null}
            </div>
          );
        })}
      </Panel>
      <Panel className="carc-players carc-glass" aria-label="Scores" data-coach="scores">
        {head}
        <ol className="carc-player-list">
          {view.players.map((p, i) => {
            const meta = players[i];
            const color = meta?.color ?? "red";
            const app = PLAYER_COLORS[color];
            const active = playing && view.currentPlayer === i;
            const mine = reactions.filter((r) => r.player === i);
            const local = localSeats.includes(i);
            const name = playerName(players, i);
            const you = local && single && name !== "You";
            const note = active && !local && thinking ? "thinking…" : meta?.kind === "bot" ? `${TIER_LABEL[meta.tier ?? ""] ?? meta.tier} bot` : you ? "you" : meta?.connected === false ? "offline" : null;
            return (
              <li
                key={i}
                className="carc-player"
                tabIndex={0}
                data-active={active || undefined}
                data-local={local || undefined}
                aria-current={active ? "true" : undefined}
                aria-label={`${name}, ${p.score} points, ${p.meeples} meeples left`}
                style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink }}
              >
                <SeatSwatch color={color} size={24} title={`${app.label} player`} />
                <span className="carc-player-name">
                  <span className="carc-player-name-text">{name}</span>
                  {note ? <span className="carc-player-note">{note}</span> : null}
                </span>
                <span className="carc-player-meeples" title={`${p.meeples} meeples left`}>
                  <FigureIcon fill={app.fill} ink={app.ink} outline="rgba(0,0,0,0.35)" marker={app.marker} size={16} />
                  <span className="carc-num">{p.meeples}</span>
                </span>
                <span className="carc-player-score carc-num" data-leader={p.score === leader && leader > 0 ? "true" : undefined}>
                  {p.score}
                </span>
                {/* the details, on hover or focus */}
                <span className="carc-player-pop carc-hud-sheet" role="tooltip">
                  <span className="carc-player-pop-title">{name}</span>
                  <span className="carc-player-pop-line">{breakdownText(p.breakdown, view.ruleset.abbot)}</span>
                  <span className="carc-player-pop-line">
                    {p.meeples} {p.meeples === 1 ? "meeple" : "meeples"} left
                    {view.ruleset.abbot ? (p.abbotAvailable ? ", and the abbot is ready." : ", and the abbot is on the board.") : "."}
                  </span>
                </span>
                {!hideReactions
                  ? mine.map((r) => (
                      <span key={r.id} className="reaction-float carc-reaction" aria-hidden>
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
  /** Feature kind the figure would claim. */
  kind?: FeatureKind;
  /** What the claimed feature is worth, for the glossary card. */
  projection?: Projection | null;
}


/** Choices for the figure step, named the way the box names them: "Knight on the city". */
export function figureChoices(
  options: FigureOption[],
  tile: TileId,
  catalog: TileCatalog,
  recall: { points: number } | null,
  project?: (feature: number) => Projection | null,
): FigureChoice[] {
  const def = catalog.get(tile);
  const out: FigureChoice[] = options.map((o, i) => {
    const kind = def?.features[o.feature]?.kind ?? "field";
    const same = options.filter((x) => (def?.features[x.feature]?.kind ?? "") === kind && x.type === o.type);
    const nth = same.length > 1 ? ` ${same.indexOf(o) + 1}` : "";
    const role = o.type === "abbot" ? "Abbot" : capitalize(FIGURE_ROLE[kind] || "meeple");
    const pr = project?.(o.feature) ?? null;
    return {
      key: `${o.type}-${o.feature}-${i}`,
      label: `${role} on the ${FEATURE_LABEL[kind]}${nth}`,
      detail: pr ? projectionShort(pr) : "",
      option: o,
      kind,
      projection: pr,
    };
  });
  if (recall) out.push({ key: "recall", label: "Bring the abbot home", detail: `+${recall.points} now`, option: { type: "recallAbbot" } });
  out.push({ key: "skip", label: "Skip: claim nothing", detail: "", option: null });
  return out;
}

function capitalize(w: string) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "8 if finished", "scores 4 now", "3 at the end". */
export function projectionShort(p: Projection): string {
  if (p.complete && p.ifCompleted !== null) return `scores ${p.ifCompleted} now`;
  if (p.kind === "field") return `${p.atEnd} at the end`;
  if (p.ifCompleted !== null) return `${p.ifCompleted} if finished`;
  return `${p.atEnd} at the end`;
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
  const [open, setOpen] = useState(true);
  // Engine order; ids the ruleset never uses (River off, the spring) are not in `remaining`.
  // Tiles still to come (used-up kinds drop out rather than sitting there greyed).
  const ids = catalog.all().map((d) => d.id).filter((id) => (remaining[id] ?? 0) > 0);
  const total = Object.values(remaining).reduce((a, b) => a + b, 0);
  return (
    <Panel className="carc-pile" aria-label="Remaining tiles" data-coach="pile">
      <button type="button" className="carc-pile-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="carc-eyebrow">Draw pile</span>
        <span className="carc-pile-total carc-num">
          {total} <span className="carc-pile-unit">{total === 1 ? "tile" : "tiles"}</span>
        </span>
        <ChevronDown className="carc-pile-chevron" aria-hidden />
      </button>
      {open ? (
        <p className="carc-pile-note">
          {total === 0 ? "This is the last tile, and the game ends when it is placed." : "These tiles are still to come, with how many of each are left, and the game ends when the last one is placed."}
        </p>
      ) : null}
      {open && ids.length ? (
        <ul className="carc-pile-grid">
          {ids.map((id) => {
            const def = catalog.get(id)!;
            const n = remaining[id] ?? 0;
            return (
              <li key={id} className="carc-pile-cell" data-empty={n === 0 || undefined} title={`${id}: ${n} left`}>
                <TileThumb def={def} art={art} palette={palette} size={32} title={`Tile ${id}, ${n} left`} />
                <span className="carc-pile-count carc-num">{n}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Panel>
  );
}

// ── reactions ───────────────────────────────────────────────────────────────

/** Spam guard for the emoji bar: at most one every 250 ms and five in any three seconds. */
function useReactionLimit() {
  const [sent] = useState<number[]>(() => []);
  return () => {
    const now = performance.now();
    while (sent.length && now - sent[0]! > 3000) sent.shift();
    if (sent.length >= 5 || (sent.length && now - sent[sent.length - 1]! < 250)) return false;
    sent.push(now);
    return true;
  };
}

/** Every reaction as one row of emoji buttons (opened from the dock's reaction button). */
export function ReactionBar({ onReact, disabled }: { onReact(e: string): void; disabled?: boolean }) {
  const allow = useReactionLimit();
  return (
    <div className="carc-reaction-grid" aria-label="Emoji reactions">
      {REACTIONS.map((e) => (
        <button key={e} type="button" disabled={disabled} onClick={() => allow() && onReact(e)} className="carc-emoji" aria-label={`React ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

const MAX_BUBBLES = 6;

interface Bubble {
  id: number;
  emoji: string;
  name: string;
  fill: string;
  ink: string;
  /** Launch offset from the bar's centre, its sideways drift, and its wobble phase. */
  x: number;
  dx: number;
  wobble: number;
}

/**
 * Reactions launch out of the emoji bar like Kahoot: a big emoji with a name pill in
 * the player's colour, rising on a slightly random curve with a small wobble and a
 * scale pop, then fading after about 2.4 s (carc-bubble in hud.css). Transform and opacity only; at most six at
 * once (the oldest goes first); reduced motion gets a plain fade in place.
 */
export function ReactionBubbles({ reactions, players }: { reactions: Reaction[]; players: PlayerMeta[] }) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [seen] = useState(() => new Set<number>());
  useEffect(() => {
    const fresh = reactions.filter((r) => !seen.has(r.id));
    if (!fresh.length) return;
    for (const r of fresh) seen.add(r.id);
    setBubbles((cur) => {
      const add = fresh.map((r, k): Bubble => {
        const meta = r.player === null ? null : players[r.player];
        const app = PLAYER_COLORS[meta?.color ?? "red"];
        const side = (cur.length + k) % 2 === 0 ? 1 : -1;
        return {
          id: r.id,
          emoji: r.emoji,
          name: r.player === null ? "Someone" : playerName(players, r.player),
          fill: app.fill,
          ink: app.ink,
          x: side * (20 + Math.random() * 110),
          dx: (Math.random() - 0.5) * 90,
          wobble: Math.random() * -600,
        };
      });
      return [...cur, ...add].slice(-MAX_BUBBLES);
    });
  }, [reactions, players, seen]);
  return (
    <div className="carc-bubbles" aria-hidden>
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="carc-bubble"
          onAnimationEnd={(e) => e.target === e.currentTarget && setBubbles((cur) => cur.filter((x) => x.id !== b.id))}
          style={{ ["--x" as string]: `${b.x}px`, ["--dx" as string]: `${b.dx}px`, ["--wobble" as string]: `${b.wobble}ms`, ["--seat" as string]: b.fill, ["--seat-ink" as string]: b.ink }}
        >
          <span className="carc-bubble-rise">
            <span className="carc-bubble-wobble">
              <span className="carc-bubble-emoji">{b.emoji}</span>
              <span className="carc-bubble-name">{b.name}</span>
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

// ── board toolbar ───────────────────────────────────────────────────────────

/** Zoom in / out / fit for either board (the boards' own buttons are switched off). */
export function BoardToolbar({ commands, fitLabel = "Fit board", className }: { commands: RefObject<BoardCommands | null>; fitLabel?: string; className?: string }) {
  return (
    <Panel className={cn("carc-hud-toolbar", className)} role="toolbar" aria-label="Board view" data-board-controls data-orientation="horizontal">
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(0.8)} aria-label="Zoom out" title="Zoom out (−)">
        <Minus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in (+)">
        <Plus />
      </button>
      <button type="button" className="carc-icon-btn" onClick={() => commands.current?.fit()} aria-label={fitLabel} title={`${fitLabel} (F)`}>
        <Maximize />
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
    <span className="carc-clock carc-num" data-urgent={urgent || undefined} title={deadline ? "Time left this turn" : "Time this turn"} suppressHydrationWarning>
      <Timer aria-hidden />
      {label}
    </span>
  );
}

// ── feature glossary (hover a feature, or a figure choice) ──────────────────

/** What a feature is worth right now, as one sentence. */
function featureNow(p: Projection): string {
  const size =
    p.kind === "cloister" || p.kind === "garden"
      ? "It"
      : `It covers ${p.tiles} tile${p.tiles === 1 ? "" : "s"}${p.pennants ? ` and ${p.pennants} shield${p.pennants === 1 ? "" : "s"}`: ""}, and it`;
  if (p.complete) return p.ifCompleted !== null ? `${size} is finished and scored ${p.ifCompleted} points.` : `${size} is finished.`;
  if (p.ifCompleted !== null) return `${size} would score ${p.ifCompleted} if finished, or ${p.atEnd} if it is still open at the end.`;
  return `${size} would score ${p.atEnd} at the end as things stand.`;
}

export function FeatureInfo({ p, players, edition = 3, choosing }: { p: Projection; players: PlayerMeta[]; edition?: 1 | 2 | 3; choosing?: boolean }) {
  const role = FIGURE_ROLE[p.kind];
  const roleName = role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
  const holders = p.holders.map((h) => playerName(players, h));
  return (
    <Panel className="carc-feature" aria-live="polite" data-kind={p.kind}>
      <div className="carc-feature-head">
        <span className="carc-feature-kind">{FEATURE_LABEL[p.kind]}</span>
        {roleName ? (
          <span className="carc-feature-role">
            claimed by a <strong>{roleName.toLowerCase()}</strong>
          </span>
        ) : null}
      </div>
      <p className="carc-feature-rule">{featureRule(p.kind, edition)}</p>
      <p className="carc-feature-now carc-num">
        <span>
          {featureNow(p)}
        </span>{" "}
        <span className="carc-feature-holder">
          {holders.length
            ? `Claimed by ${holders.join(" & ")}.`
            : choosing
              ? `Your ${role || "meeple"} would claim it.`
              : role
                ? `Unclaimed: put a ${role} here to claim it.`
                : ""}
        </span>
      </p>
    </Panel>
  );
}
