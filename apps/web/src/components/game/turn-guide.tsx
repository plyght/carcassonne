"use client";

// The turn guide: three numbered steps over the board that always say what to do now
// and why. The current step is filled in; after a feature scores, step 3 says what
// scored, why and for whom. Dismissible once learned (Settings brings it back).

import type { ReactNode } from "react";

import { X } from "reicon-react";

import { Kbd, Panel } from "./hud-parts";

export type GuidePhase = "place" | "claim" | "waiting" | "ended";

export interface GuideScore {
  key: string;
  text: string;
  color: string | null;
}

const STEPS = ["Place your tile", "Claim something", "Scoring"] as const;

export function TurnGuide({
  phase,
  waitingFor,
  thinking,
  scores,
  lastMove,
  onHide,
  onRules,
  allowSkip = true,
}: {
  phase: GuidePhase;
  waitingFor: string | null;
  thinking: boolean;
  /** What scored since your last move, explained. */
  scores: GuideScore[];
  /** The other player's last move, in a sentence. */
  lastMove: string | null;
  onHide?(): void;
  onRules?(): void;
  allowSkip?: boolean;
}) {
  const current = phase === "place" ? 0 : phase === "claim" ? 1 : scores.length ? 2 : -1;
  let body: ReactNode;
  if (phase === "place")
    body = (
      <>
        It must touch the map, and every edge must match: road to road, city to city, field to field. <strong>Glowing spots</strong> show where it fits;{" "}
        <span className="carc-keys">
          rotate with <Kbd>R</Kbd> or the dial.
        </span>
        <span className="carc-touch">tap the dial to turn it.</span>
      </>
    );
  else if (phase === "claim")
    body = (
      <>
        Put a meeple on the road, city, cloister or field you just placed. Claimed features score for you when they’re finished.
        {allowSkip ? " Claiming is optional: you can skip." : ""}
      </>
    );
  else if (phase === "ended") body = <>The game is over, and every unfinished road, city, cloister and field has been scored.</>;
  else body = waitingFor ? <>{thinking ? `${waitingFor} is thinking…` : `${waitingFor}’s turn.`}</> : null;

  return (
    <Panel className="carc-guide" aria-label="Turn guide" data-phase={phase} data-testid="turn-guide">
      <div className="carc-guide-head">
        <ol className="carc-guide-steps">
          {STEPS.map((label, i) => (
            <li key={label} className="carc-guide-step" data-state={i === current ? "current" : i < current ? "done" : undefined}>
              <span className="carc-guide-num carc-num" aria-hidden>
                {i + 1}
              </span>
              <span className="carc-guide-label">
                {label}
                {i === 1 ? <span className="carc-guide-optional"> (optional)</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <div className="carc-guide-actions">
          {onRules ? (
            <button type="button" className="carc-guide-link" onClick={onRules}>
              Rules
            </button>
          ) : null}
          {onHide ? (
            <button type="button" className="carc-icon-btn carc-guide-close" onClick={onHide} aria-label="Hide the turn guide" title="Hide the turn guide (bring it back in Settings)">
              <X />
            </button>
          ) : null}
        </div>
      </div>
      {body ? (
        <p className="carc-guide-body" aria-live="polite">
          {body}
        </p>
      ) : null}
      {lastMove && phase !== "place" && phase !== "claim" ? <p className="carc-guide-last">{lastMove}</p> : null}
      {scores.length ? (
        <ul className="carc-guide-scores" aria-live="polite">
          {scores.map((s) => (
            <li key={s.key} className="carc-guide-score">
              <span className="carc-guide-dot" style={{ background: s.color ?? "var(--gold)" }} aria-hidden />
              {s.text}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}
