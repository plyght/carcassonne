"use client";

// First-game coach marks: a short sequence of notes pointing at the tile in hand, the
// glowing spots, the meeple choice, the scores and the draw pile. Each appears when
// it is relevant (the meeple note when you first place a tile), never blocks the
// board, can be skipped, and is never shown again (localStorage, failure-safe).

import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { readJSON, writeJSON } from "@/lib/storage";

const KEY = "carc.coach.v1";

interface Saved {
  done: boolean;
  seen: string[];
}

export interface CoachContext {
  myTurn: boolean;
  pending: boolean;
  ply: number;
  /** Screen rect of a glowing spot, if any. */
  spot: () => DOMRect | null;
}

interface Mark {
  id: string;
  title: string;
  text: string;
  when(c: CoachContext): boolean;
  anchor(c: CoachContext): DOMRect | null;
}

const bySelector = (sel: string) => () => document.querySelector(sel)?.getBoundingClientRect() ?? null;

const MARKS: Mark[] = [
  {
    id: "hand",
    title: "This is your tile",
    text: "Every turn you get one tile and add it to the map, and this is the one you’re holding.",
    when: (c) => c.myTurn && !c.pending,
    anchor: bySelector('[data-coach="hand"]'),
  },
  {
    id: "spots",
    title: "Glowing spots",
    text: "These are the places where your tile fits, so click one to put it down, or press R first to turn it.",
    when: (c) => c.myTurn && !c.pending,
    anchor: (c) => c.spot(),
  },
  {
    id: "figures",
    title: "Claim it with a meeple",
    text: "You can put a meeple on part of the tile you just placed. When that road, city or cloister is finished, it scores for you and the meeple comes back, but you can also skip.",
    when: (c) => c.pending,
    anchor: bySelector('[data-coach="figures"]'),
  },
  {
    id: "scores",
    title: "Scores and meeples",
    text: "This panel shows everyone’s points and how many meeples each player has left, and the highlighted row is whoever is playing now.",
    when: (c) => c.ply >= 1 && !c.pending,
    anchor: bySelector('[data-coach="scores"]'),
  },
  {
    id: "pile",
    title: "The draw pile",
    text: "These are the tiles still to come and how many of each are left, and the game ends when the last one is placed.",
    when: (c) => c.ply >= 1 && !c.pending,
    anchor: bySelector('[data-coach="pile"]'),
  },
];

export function coachDone(): boolean {
  return readJSON<Saved>(KEY, { done: false, seen: [] }).done;
}

export function CoachMarks({ ctx }: { ctx: CoachContext }) {
  const [saved, setSaved] = useState<Saved>({ done: true, seen: [] });
  useEffect(() => setSaved(readJSON<Saved>(KEY, { done: false, seen: [] })), []);
  const save = useCallback((s: Saved) => {
    setSaved(s);
    writeJSON(KEY, s);
  }, []);

  const mark = saved.done ? null : (MARKS.find((m) => !saved.seen.includes(m.id) && m.when(ctx)) ?? null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (!mark) return setRect(null);
    let raf = 0;
    let last = "";
    const tick = () => {
      const r = mark.anchor(ctx);
      const k = r ? `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : "";
      if (k !== last) {
        last = k;
        setRect(r && r.width > 0 ? r : null);
      }
      raf = window.setTimeout(tick, 250) as unknown as number;
    };
    tick();
    return () => clearTimeout(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark?.id, ctx.pending, ctx.myTurn]);

  if (!mark || !rect) return null;
  const idx = MARKS.indexOf(mark);
  const next = () => {
    const seen = [...saved.seen, mark.id];
    save({ seen, done: MARKS.every((m) => seen.includes(m.id)) });
  };
  const skip = () => save({ seen: MARKS.map((m) => m.id), done: true });

  // Card beside the anchor, on the side with the most room.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const W = Math.min(300, vw - 24);
  const pad = 14;
  const room = { right: vw - rect.right, left: rect.left, below: vh - rect.bottom, above: rect.top };
  let side: "left" | "right" | "below" | "above" = "right";
  if (room.right >= W + pad + 12) side = "right";
  else if (room.left >= W + pad + 12) side = "left";
  else if (room.below >= 180) side = "below";
  else side = "above";
  const clampX = (x: number) => Math.max(12, Math.min(vw - W - 12, x));
  const clampY = (y: number) => Math.max(12, Math.min(vh - 200, y));
  const pos: { left: number; top: number } =
    side === "right"
      ? { left: rect.right + pad, top: clampY(rect.top + rect.height / 2 - 70) }
      : side === "left"
        ? { left: rect.left - pad - W, top: clampY(rect.top + rect.height / 2 - 70) }
        : side === "below"
          ? { left: clampX(rect.left + rect.width / 2 - W / 2), top: rect.bottom + pad }
          : { left: clampX(rect.left + rect.width / 2 - W / 2), top: Math.max(12, rect.top - pad - 180) };

  // Never cover the turn guide: slide the card below it if they would overlap.
  const g = document.querySelector('[data-testid="turn-guide"]')?.getBoundingClientRect();
  if (g && pos.left < g.right && pos.left + W > g.left && pos.top < g.bottom && pos.top + 170 > g.top) pos.top = Math.max(pos.top, g.bottom + 12);

  return (
    <>
      <div
        className="carc-coach-ring"
        aria-hidden
        style={{ left: rect.left - 6, top: rect.top - 6, width: rect.width + 12, height: rect.height + 12 }}
      />
      <div className="carc-coach" role="dialog" aria-label={mark.title} data-side={side} style={{ ...pos, width: W }} data-testid="coach-mark">
        <div className="carc-coach-count carc-num">
          Tip {idx + 1} of {MARKS.length}
        </div>
        <h3 className="carc-coach-title">{mark.title}</h3>
        <p className="carc-coach-text">{mark.text}</p>
        <div className="carc-coach-actions">
          <button type="button" className="carc-btn" data-variant="ghost" data-size="compact" onClick={skip}>
            Skip tips
          </button>
          <button type="button" className="carc-btn" data-variant="primary" data-size="compact" onClick={next} autoFocus={false}>
            Got it
          </button>
        </div>
      </div>
    </>
  );
}
