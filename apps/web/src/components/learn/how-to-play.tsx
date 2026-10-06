"use client";

// "How to play": the whole game on one calm sheet. Five sections (your turn, the four
// features, meeples, the end, the River and the Abbot) in short sentences, each next to
// a small real board drawn with the game's own tiles on the game table. Opened from the
// HUD (and so from the tutorial). It blurs in and out without moving, traps focus while
// open, closes on Esc or a click outside, and scrolls on its own on phones.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import Link from "next/link";
import { X } from "reicon-react";

import { SupplyChip } from "../game/hud-parts";
import { MiniBoard, type MiniTile } from "./mini-board";

const ROAD: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "A", x: 1, y: 0, rot: 1 },
  { tile: "U", x: -1, y: 0, rot: 1, figure: { feature: 0, color: "blue" } },
  { tile: "W", x: -2, y: 0 },
];
const CITY: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "U", x: -1, y: 0, rot: 1 },
  { tile: "E", x: -1, y: -1, rot: 1 },
  { tile: "M", x: 0, y: -1, figure: { feature: 0, color: "blue" } },
];
const CLOISTER: MiniTile[] = [
  { tile: "B", x: 0, y: 0, figure: { feature: 0, color: "blue" } },
  { tile: "E", x: 0, y: -1, rot: 0 },
  { tile: "E", x: -1, y: -1, rot: 0 },
  { tile: "E", x: 1, y: -1, rot: 0 },
  { tile: "E", x: -1, y: 0, rot: 3 },
  { tile: "E", x: 1, y: 0, rot: 1 },
  { tile: "E", x: -1, y: 1, rot: 2 },
  { tile: "E", x: 1, y: 1, rot: 2 },
  { tile: "E", x: 0, y: 1, rot: 2 },
];
const FIELD: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "E", x: 0, y: -1, rot: 2 },
  { tile: "U", x: 1, y: 0, rot: 1, figure: { feature: 1, color: "blue" } },
];
const MATCH: MiniTile[] = [
  { tile: "D", x: 0, y: 0, rot: 0 },
  { tile: "V", x: 1, y: 0, focus: true },
];
const RIVER: MiniTile[] = [
  { tile: "R1", x: 0, y: 0, prefer: 0 },
  { tile: "R4", x: 1, y: 0 },
  { tile: "R11", x: 2, y: 0 },
  { tile: "R12", x: 3, y: 0 },
];
const ABBOT: MiniTile[] = [
  { tile: "Eg", x: 0, y: 0, rot: 0, figure: { feature: 2, color: "blue", kind: "abbot" } },
  { tile: "B", x: 1, y: 0, figure: { feature: 0, color: "red", kind: "abbot" } },
];

const SECTIONS = [
  { id: "turn", title: "Your turn" },
  { id: "features", title: "The four features" },
  { id: "meeples", title: "Meeples" },
  { id: "end", title: "End of the game" },
  { id: "extras", title: "River and Abbot" },
] as const;

/** A small real board on a piece of the game table. */
function Plate({ tiles, label, cell, wide }: { tiles: MiniTile[]; label: string; cell?: number; wide?: boolean }) {
  return (
    <figure className="carc-plate" data-wide={wide || undefined}>
      <MiniBoard tiles={tiles} label={label} cell={cell} />
    </figure>
  );
}

function Section({ id, n, title, children }: { id: string; n: number; title: string; children: ReactNode }) {
  return (
    <section className="carc-rs-section" id={`rules-${id}`} aria-labelledby={`rules-${id}-h`}>
      <p className="carc-rs-n carc-num" aria-hidden>
        {String(n).padStart(2, "0")}
      </p>
      <h3 id={`rules-${id}-h`} className="carc-rs-title">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Feature({ name, who, worth, tiles, label, cell, children }: { name: string; who: string; worth: string; tiles: MiniTile[]; label: string; cell?: number; children: ReactNode }) {
  return (
    <li className="carc-rs-feature">
      <Plate tiles={tiles} label={label} cell={cell} />
      <div className="carc-rs-feature-head">
        <h4 className="carc-rs-feature-name">
          {name} <span className="carc-rs-feature-who">· {who}</span>
        </h4>
        <span className="carc-rs-worth carc-num">{worth}</span>
      </div>
      <p className="carc-rs-text">{children}</p>
    </li>
  );
}

export function RulesSheet() {
  return (
    <div className="carc-rs-body">
      <Section id="turn" n={1} title="Your turn">
        <div className="carc-rs-split">
          <ol className="carc-rs-steps">
            <li>Draw a tile and add it to the map so that every edge it touches matches: road to road, city to city and field to field.</li>
            <li>If you like, put one meeple on a road, city, cloister or field of that tile, as long as nobody has claimed it yet.</li>
            <li>Anything you finished scores straight away, and its meeples come home.</li>
          </ol>
          <Plate tiles={MATCH} cell={64} label="A bend placed next to the start tile: road meets road and field meets field." />
        </div>
        <p className="carc-rs-hint">Glowing spots show where your tile fits, and R or the dial turns it.</p>
      </Section>

      <Section id="features" n={2} title="The four features">
        <ul className="carc-rs-features">
          <Feature name="Roads" who="thieves" worth="1 per tile" tiles={ROAD} cell={58} label="A road from a junction to a cloister, with a blue thief on it.">
            A road is finished when both ends stop, so this one is worth 4.
          </Feature>
          <Feature name="Cities" who="knights" worth="2 per tile" tiles={CITY} cell={62} label="A three-tile city closed by its walls, with a blue knight in it.">
            A city is finished when its walls close, and each shield adds 2 more.
          </Feature>
          <Feature name="Cloisters" who="monks" worth="9" tiles={CLOISTER} cell={44} label="A cloister with all eight neighbouring spaces filled, with a blue monk.">
            A cloister is finished once all eight spaces around it hold tiles.
          </Feature>
          <Feature name="Fields" who="farmers" worth="3 per city" tiles={FIELD} cell={62} label="A blue farmer lying in the field above the road, next to a finished city.">
            Farmers stay until the end, when each field pays for the finished cities it touches.
          </Feature>
        </ul>
      </Section>

      <Section id="meeples" n={3} title="Meeples">
        <div className="carc-rs-split">
          <p className="carc-rs-text">
            You have seven meeples, and each one comes home when its feature is finished, but farmers stay where they lie. When two features join, whoever has more meeples on them takes all the points, and a tie pays everyone tied.
          </p>
          <div className="carc-rs-chip">
            <SupplyChip color="blue" label="7 meeples" />
          </div>
        </div>
      </Section>

      <Section id="end" n={4} title="End of the game">
        <p className="carc-rs-text">
          The game ends when the last tile is placed. Unfinished roads, cities and cloisters then score what they have so far, at 1 point per tile and shield, the fields pay their farmers, and the most points wins.
        </p>
      </Section>

      <Section id="extras" n={5} title="River and Abbot">
        <div className="carc-rs-pair">
          <div>
            <Plate tiles={RIVER} cell={44} wide label="River tiles from the spring to the lake." />
            <h4 className="carc-rs-feature-name">The River</h4>
            <p className="carc-rs-text">The game opens with twelve river tiles, laid from the spring to the lake. Nobody claims the river, but the land beside it is fair game.</p>
          </div>
          <div>
            <Plate tiles={ABBOT} cell={56} wide label="An abbot in a garden and another in a cloister." />
            <h4 className="carc-rs-feature-name">The Abbot</h4>
            <p className="carc-rs-text">Your abbot only goes on a cloister or a garden, and on a later turn you can bring it home early to score what it has.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}

const EXIT_MS = 140;

/** The rules sheet as a dialog over the game. */
export function HowToPlay({ open, onClose }: { open: boolean; onClose(): void }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);

  // mount on open; on close, play the (faster) exit before unmounting
  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
      (returnTo.current as HTMLElement | null)?.focus?.();
    }, EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open || !mounted) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      // keep Tab inside the sheet
      if (e.key === "Tab" && sheetRef.current) {
        const items = sheetRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])");
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, mounted, close]);

  if (!mounted) return null;
  const jump = (id: string) => {
    const el = document.getElementById(`rules-${id}`);
    const box = scrollRef.current;
    if (el && box) box.scrollTo({ top: el.offsetTop - 24, behavior: "smooth" });
  };
  return (
    <div className="carc-modal carc-rs-modal" data-state={closing ? "closing" : "open"} role="presentation" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={sheetRef} className="carc-rs" role="dialog" aria-modal="true" aria-labelledby="how-to-play-title">
        <header className="carc-rs-head">
          <div>
            <h2 id="how-to-play-title" className="carc-rs-h">
              How to play
            </h2>
            <p className="carc-rs-lead">You build a map of southern France one tile at a time, and you score by claiming what you build.</p>
          </div>
          <button ref={closeRef} type="button" className="carc-icon-btn" onClick={close} aria-label="Close" title="Close (Esc)">
            <X />
          </button>
        </header>
        <div className="carc-rs-main">
          <nav className="carc-rs-toc" aria-label="Sections">
            {SECTIONS.map((s, i) => (
              <button key={s.id} type="button" className="carc-rs-toc-link" onClick={() => jump(s.id)}>
                <span className="carc-num">{String(i + 1).padStart(2, "0")}</span> {s.title}
              </button>
            ))}
          </nav>
          <div ref={scrollRef} className="carc-rs-scroll" data-testid="how-to-play" tabIndex={-1}>
            <RulesSheet />
            <footer className="carc-rs-foot">
              <Link href="/tutorial" className="carc-btn" data-variant="ghost">
                Play the tutorial
              </Link>
              <button type="button" className="carc-btn" data-variant="primary" onClick={close}>
                Back to the game
              </button>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
