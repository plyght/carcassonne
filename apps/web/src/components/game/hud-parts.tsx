"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { cn } from "@carcassonne/ui/lib/utils";
import { ChevronDown, Maximize, Minus, Plus, SmilePlus, Timer } from "lucide-react";

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

import { DialSurface } from "../dial/primitives";
import { RotationDial } from "../dial/rotation-dial";
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
    <span className="carc-swatch" style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink, width: size, height: size }} title={title}>
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
    <span className="carc-supply" data-kind={kind} data-away={away || undefined} title={title} style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink }}>
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
    <span key={c.key} className="carc-score-part">
      {i ? " · " : ""}
      {c.label} <span className="carc-num">{b[c.key]}</span>
    </span>
  ));
}

export function ScorePanel({
  view,
  players,
  localSeats,
  reactions,
  hideReactions,
  thinking,
  footer,
  idle,
}: {
  view: GameView;
  players: PlayerMeta[];
  localSeats: number[];
  reactions: Reaction[];
  hideReactions: boolean;
  thinking: boolean;
  palette?: BoardPalette;
  /** A quiet last line (e.g. the seed). */
  footer?: ReactNode;
  /** Nobody is to move (a finished lesson). */
  idle?: boolean;
}) {
  const playing = view.status === "playing" && !idle;
  const leader = Math.max(...view.players.map((p) => p.score));
  const single = localSeats.length === 1;
  return (
    <>
      {/* compact strip for phones */}
      <Panel className="carc-score-strip" aria-label="Scores">
        {view.players.map((p, i) => {
          const color = players[i]?.color ?? "red";
          const active = playing && view.currentPlayer === i;
          return (
            <div key={i} className="carc-score-chip" data-active={active || undefined} aria-current={active ? "true" : undefined}>
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
      <Panel className="carc-score-panel" aria-label="Scores" data-coach="scores">
        <ol className="carc-score-list">
          {view.players.map((p, i) => {
            const meta = players[i];
            const color = meta?.color ?? "red";
            const app = PLAYER_COLORS[color];
            const active = playing && view.currentPlayer === i;
            const mine = reactions.filter((r) => r.player === i);
            const local = localSeats.includes(i);
            const name = playerName(players, i);
            const you = local && single && name !== "You";
            const status = active ? (local ? (single ? "Your turn" : "Playing") : thinking ? "Thinking…" : "Playing") : null;
            return (
              <li key={i} className="carc-score-row" data-active={active || undefined} data-local={local || undefined} aria-current={active ? "true" : undefined}>
                <SeatSwatch color={color} title={`${app.label} player`} />
                <div className="carc-score-who">
                  <div className="carc-score-name-line">
                    <span className="carc-score-name">{name}</span>
                    {you ? <Tag tone="accent">You</Tag> : null}
                    {meta?.kind === "bot" ? <Tag>{TIER_LABEL[meta.tier ?? ""] ?? meta.tier} bot</Tag> : null}
                    {meta?.connected === false ? <Tag tone="danger">Offline</Tag> : null}
                  </div>
                  <div className="carc-score-supply">
                    <SupplyChip color={color} label={`${p.meeples} ${p.meeples === 1 ? "meeple" : "meeples"}`} title={`${p.meeples} meeples left to place`} />
                    {view.ruleset.abbot ? (
                      <SupplyChip
                        color={color}
                        kind="abbot"
                        label={p.abbotAvailable ? "Abbot" : "Abbot out"}
                        title={p.abbotAvailable ? "The abbot is ready to place" : "The abbot is on the board"}
                        away={!p.abbotAvailable}
                      />
                    ) : null}
                    {status ? (
                      <span className="carc-score-status" data-tone={local ? "you" : "other"} data-thinking={status === "Thinking…" || undefined}>
                        {status}
                      </span>
                    ) : null}
                  </div>
                  <div className="carc-score-breakdown">{breakdownText(p.breakdown, view.ruleset.abbot)}</div>
                </div>
                <div className="carc-score-side">
                  <div className="carc-score-total carc-num" data-leader={p.score === leader && leader > 0 ? "true" : undefined} aria-label={`${p.score} points`}>
                    {p.score}
                  </div>
                </div>
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
        {footer ? <div className="carc-score-footer">{footer}</div> : null}
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
  onHoverChoice,
  waitingFor,
  thinking,
  discardsNote,
  legalRots,
  allowSkip = true,
  dialSize = 112,
  color,
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
  onHoverChoice?(c: FigureChoice | null): void;
  waitingFor: string | null;
  /** The player we wait for is a bot working out its move. */
  thinking?: boolean;
  discardsNote?: string | null;
  /** Rotations legal at the hovered spot (marked on the dial). */
  legalRots?: number[];
  allowSkip?: boolean;
  dialSize?: number;
  /** Colour of the player choosing (meeples in the list). */
  color?: PlayerMeta["color"];
}) {
  const def = tile ? catalog.get(tile) : undefined;
  const interactive = canAct && !pending && !hidden && !!def;
  const tileSize = Math.round(dialSize * 0.6);
  const shown = choices.filter((c) => allowSkip || c.option !== null);
  const app = color ? PLAYER_COLORS[color] : null;
  return (
    <Panel className="carc-hand" aria-label="Tile in hand" data-pending={pending || undefined} data-coach="hand">
      <div className="carc-hand-top">
        <DialSurface className="carc-hand-dial" style={{ ["--dial" as string]: `${dialSize}px` }}>
          <RotationDial
            rot={rot}
            onRotate={onRotate}
            legal={interactive ? legalRots : undefined}
            disabled={!interactive}
            size={dialSize}
            tileSize={tileSize}
            label="Rotate the tile in hand"
          >
            {def && !hidden ? (
              // Rotation is painted into the art (not CSS-rotated), so the cloister, houses and lighting stay upright.
              <TileThumb def={def} art={art} palette={palette} rot={rot} size={tileSize} title={`Tile ${def.id}, rotated ${rot * 90}°`} />
            ) : (
              <div className="carc-hand-hidden" style={{ background: palette.table }}>
                ?
              </div>
            )}
          </RotationDial>
        </DialSurface>
        <div className="carc-hand-text">
          <div className="carc-eyebrow">{canAct || !waitingFor ? "Your tile" : `${waitingFor}’s tile`}</div>
          {canAct && !pending ? (
            <>
              <p className="carc-hand-status">Place it on a glowing spot.</p>
              <p className="carc-hand-hint">
                Rotate with <Kbd>R</Kbd> or the dial.
              </p>
            </>
          ) : null}
          {pending ? (
            <>
              <p className="carc-hand-status">{allowSkip ? "Claim something? (optional)" : "Claim it with a meeple."}</p>
              <p className="carc-hand-hint">Tap a meeple on the tile, or pick one below.</p>
            </>
          ) : null}
          {!canAct ? (
            <p className="carc-hand-status" data-quiet="true">
              {waitingFor ? (thinking ? `${waitingFor} is thinking…` : `${waitingFor}’s turn`) : "Game over"}
            </p>
          ) : null}
          {discardsNote ? (
            <p className="carc-hand-hint" data-tone="warn">
              {discardsNote}
            </p>
          ) : null}
        </div>
      </div>
      {pending ? (
        <div className="carc-figures" role="group" aria-label="Figure choice" data-coach="figures">
          <div className="carc-figure-list">
            {shown.map((c, i) => (
              <button
                key={c.key}
                type="button"
                onClick={() => onChoose(c)}
                onPointerEnter={() => onHoverChoice?.(c)}
                onPointerLeave={() => onHoverChoice?.(null)}
                onFocus={() => onHoverChoice?.(c)}
                onBlur={() => onHoverChoice?.(null)}
                className="carc-figure"
                data-skip={c.option === null || undefined}
              >
                <Kbd>{c.option === null ? "S" : c.key === "recall" ? "A" : i + 1}</Kbd>
                <span className="carc-figure-text">
                <span className="carc-figure-label">
                  {app && c.option && c.key !== "recall" ? (
                    <span className="carc-figure-token" style={{ ["--seat" as string]: app.fill, ["--seat-ink" as string]: app.ink }} aria-hidden>
                      <FigureIcon
                        kind={c.option.type === "abbot" ? "abbot" : "meeple"}
                        fill="currentColor"
                        ink={app.fill}
                        outline="none"
                        marker={app.marker}
                        size={18}
                      />
                    </span>
                  ) : null}
                  {c.label}
                </span>
                {c.detail ? <span className="carc-figure-detail carc-num">{c.detail}</span> : null}
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={onBack} className="carc-btn carc-figure-back" data-variant="ghost" data-size="compact">
            Put the tile somewhere else <Kbd>Esc</Kbd>
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
          {total === 0 ? "This is the last tile: the game ends when it is placed." : "Still to come, with how many of each. The game ends when the last tile is placed."}
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

export function ReactionBar({ onReact, disabled }: { onReact(e: string): void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const quick = REACTIONS.slice(0, 6);
  const shown = open ? REACTIONS : quick;
  return (
    <Panel className="carc-reactions" data-open={open || undefined} aria-label="Emoji reactions">
      <div className="carc-reaction-grid">
        {shown.map((e, i) => (
          <button
            key={e}
            type="button"
            disabled={disabled}
            onClick={() => onReact(e)}
            className="carc-emoji"
            data-extra={i >= 4 && !open ? "true" : undefined}
            aria-label={`React ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="carc-icon-btn carc-reaction-more"
        aria-expanded={open}
        aria-label={open ? "Fewer reactions" : `${REACTIONS.length - quick.length} more reactions`}
        title={open ? "Fewer reactions" : "More reactions"}
      >
        {open ? <ChevronDown /> : <SmilePlus />}
      </button>
    </Panel>
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

/** Keyboard and pointer help, on wide screens. */
export function BoardHelp({ is3d }: { is3d: boolean }) {
  return (
    <Panel className="carc-hud-help" aria-label="Board controls">
      <div className="carc-board-help">
        {is3d ? (
          <>
            <span>
              <Kbd>R</Kbd> or scroll to rotate
            </span>
            <span>Drag to orbit</span>
            <span>
              <Kbd>F</Kbd> reframe
            </span>
          </>
        ) : (
          <>
            <span>
              <Kbd>R</Kbd> rotate
            </span>
            <span>
              <Kbd>←</Kbd>
              <Kbd>→</Kbd> choose a spot
            </span>
            <span>
              <Kbd>F</Kbd> fit
            </span>
            <span>Drag to pan</span>
          </>
        )}
      </div>
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
          {p.kind === "cloister" || p.kind === "garden" ? "" : `${p.tiles} tile${p.tiles === 1 ? "" : "s"}${p.pennants ? `, ${p.pennants} shield${p.pennants === 1 ? "" : "s"}` : ""}. `}
          {p.complete
            ? p.ifCompleted !== null
              ? `Finished: ${p.ifCompleted} points.`
              : "Finished."
            : p.ifCompleted !== null
              ? `Worth ${p.ifCompleted} if finished, ${p.atEnd} if not.`
              : `Worth ${p.atEnd} at the end, as it stands.`}
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
