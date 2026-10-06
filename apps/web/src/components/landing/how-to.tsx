"use client";

// "How to play in 30 seconds": one little board, three moments. The same six painted
// Classic tiles carry the story from step to step: a tile turned until it fits, a
// meeple choosing what to claim, and the finished city paying out.

import { useRef, type CSSProperties, type ReactNode } from "react";

import type { Route } from "next";
import Link from "next/link";
import { ArrowRight } from "reicon-react";

import { FigureIcon } from "@carcassonne/render-classic";

import { useInView } from "./use-in-view";

const RED = { fill: "#d4483b", ink: "#fff7ec", marker: "circle" as const };

/** A painted tile at board cell (x, y). */
function Tile({ src, x, y, rot = 0 }: { src: string; x: number; y: number; rot?: number }) {
  return (
    <img
      className="lp-tile"
      src={`/landing/tiles/${src}.webp`}
      alt=""
      width={384}
      height={384}
      loading="lazy"
      decoding="async"
      style={{ "--x": x, "--y": y, "--rot": `${rot}deg` } as CSSProperties}
    />
  );
}

/** A meeple centred on board point (x, y), in cells. */
function Meeple({ x, y, className, style }: { x: number; y: number; className?: string; style?: CSSProperties }) {
  return (
    <span className={`lp-meeple ${className ?? ""}`} style={{ "--x": x, "--y": y, ...style } as CSSProperties}>
      <FigureIcon {...RED} size={30} outline="rgba(40,10,0,0.55)" />
    </span>
  );
}

/** The board every step shares: a road through the start tile, a cloister. */
function BaseTiles() {
  return (
    <>
      <Tile src="U1" x={0} y={1} />
      <Tile src="D0" x={1} y={1} />
      <Tile src="V0" x={2} y={1} />
      <Tile src="B0" x={2} y={0} />
    </>
  );
}

function Board({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="lp-mini" role="img" aria-label={label}>
      <div className="lp-mini-board">{children}</div>
    </div>
  );
}

const FEATURES = [
  { name: "city", who: "a knight", x: 1.5, y: 0.9 },
  { name: "road", who: "a thief", x: 0.5, y: 1.5 },
  { name: "cloister", who: "a monk", x: 2.5, y: 0.42 },
  { name: "field", who: "a farmer", x: 2.68, y: 1.32 },
];

export function HowTo() {
  const ref = useRef<HTMLOListElement>(null);
  const inView = useInView(ref, { rootMargin: "0px 0px -10% 0px" });
  return (
    <section className="lp-section lp-how reveal" aria-labelledby="how-h">
      <div className="lp-section-head">
        <h2 id="how-h" className="lp-h2" data-reveal>
          How to play
        </h2>
        <p className="lp-section-lead" data-reveal>Every turn is the same three moves, repeated until the tiles run out.</p>
      </div>

      <ol ref={ref} className="lp-steps" data-play={inView ? "true" : undefined}>
        <li className="lp-step" data-reveal data-step="1">
          <Board label="A city tile is turned around until its city edge meets the city on the tile below, then dropped into place.">
            <BaseTiles />
            <span className="lp-slot" style={{ "--x": 1, "--y": 0 } as CSSProperties} />
            <span className="lp-seam" style={{ "--x": 1, "--y": 1 } as CSSProperties} />
            <span className="lp-chip lp-fit-chip" aria-hidden="true">
              city meets city <span className="lp-chip-dim">· it fits</span>
            </span>
            <img className="lp-tile lp-drawn" src="/landing/tiles/E0.webp" alt="" width={384} height={384} loading="lazy" decoding="async" />
          </Board>
          <div className="lp-step-text">
            <span className="lp-step-n" aria-hidden="true">
              1
            </span>
            <h3 className="lp-step-title">Place a tile</h3>
            <p className="lp-step-body">Its edges have to match the tiles around it.</p>
          </div>
        </li>

        <li className="lp-step" data-reveal data-step="2">
          <Board label="A meeple tries each spot on the board in turn: the city, the road, the cloister and the field.">
            <BaseTiles />
            <Tile src="E0" x={1} y={0} rot={180} />
            {FEATURES.map((f, i) => (
              <Meeple key={f.name} x={f.x} y={f.y} className="lp-claim" style={{ "--i": i } as CSSProperties} />
            ))}
            <span className="lp-claim-chips" aria-hidden="true">
              {FEATURES.map((f, i) => (
                <span key={f.name} className="lp-chip lp-claim-chip" style={{ "--i": i } as CSSProperties}>
                  {f.name} <span className="lp-chip-dim">· {f.who}</span>
                </span>
              ))}
            </span>
          </Board>
          <div className="lp-step-text">
            <span className="lp-step-n" aria-hidden="true">
              2
            </span>
            <h3 className="lp-step-title">Claim something</h3>
            <p className="lp-step-body">Put a meeple on a road, city, cloister or field.</p>
          </div>
        </li>

        <li className="lp-step" data-reveal data-step="3">
          <Board label="The two-tile city is complete: it scores four points and the meeple returns to its owner.">
            <BaseTiles />
            <Tile src="E0" x={1} y={0} rot={180} />
            <span className="lp-city-glow" aria-hidden="true" />
            <Meeple x={1.5} y={0.9} className="lp-scorer" />
            <span className="lp-plus" aria-hidden="true">
              +4
            </span>
            <span className="lp-score" aria-hidden="true">
              <FigureIcon {...RED} size={18} outline="rgba(40,10,0,0.55)" />
              You
              <span className="lp-score-num carc-num">
                <span className="lp-score-a">0</span>
                <span className="lp-score-b">4</span>
              </span>
            </span>
          </Board>
          <div className="lp-step-text">
            <span className="lp-step-n" aria-hidden="true">
              3
            </span>
            <h3 className="lp-step-title">Score it</h3>
            <p className="lp-step-body">Finished features pay out and your meeple comes home.</p>
          </div>
        </li>
      </ol>

      <p className="lp-how-foot" data-reveal>
        <Link href={"/tutorial" as Route} className="lp-link">
          Learn by playing in the tutorial <ArrowRight aria-hidden="true" />
        </Link>
      </p>
    </section>
  );
}
