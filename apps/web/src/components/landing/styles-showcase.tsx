"use client";

// One board, four looks. High-quality renders of the same position (offline, one frame
// each) crossfade under a segmented switcher; it advances on its own while on screen
// until someone picks a style.

import { useEffect, useRef, useState } from "react";

import { useInView } from "./use-in-view";

const STYLES = [
  { id: "classic", name: "Classic", kind: "2D", line: "The painted tiles run on any phone." },
  { id: "tabletop", name: "Tabletop", kind: "3D", line: "Wooden meeples stand on a miniature board." },
  { id: "cartoon", name: "Cartoon", kind: "3D", line: "Everything is cel-shaded with ink outlines." },
  { id: "diorama", name: "Diorama", kind: "3D", line: "Soft light falls on a pastel tilt-shift world." },
] as const;

type StyleId = (typeof STYLES)[number]["id"];
const CYCLE_MS = 4200;

export function StylesShowcase() {
  const [active, setActive] = useState<StyleId>("tabletop");
  const [auto, setAuto] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { threshold: 0.35 });

  useEffect(() => {
    if (!auto || !inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setActive((cur) => STYLES[(STYLES.findIndex((s) => s.id === cur) + 1) % STYLES.length]!.id);
    }, CYCLE_MS);
    return () => window.clearInterval(id);
  }, [auto, inView]);

  const current = STYLES.find((s) => s.id === active)!;

  return (
    <section className="lp-section lp-styles reveal" aria-labelledby="styles-h">
      <div className="lp-section-head">
        <h2 id="styles-h" className="lp-h2" data-reveal>
          One board, four looks
        </h2>
        <p className="lp-section-lead" data-reveal>
          You can switch at any time, even halfway through a game.
        </p>
      </div>

      <div ref={ref} className="lp-showcase" data-active={active} data-reveal>
        {STYLES.map((s, i) => (
          <img
            key={s.id}
            className="lp-showcase-img"
            data-on={s.id === active ? "true" : undefined}
            src={`/landing/styles/${s.id}-960.webp`}
            srcSet={`/landing/styles/${s.id}-960.webp 960w, /landing/styles/${s.id}-1920.webp 1920w`}
            sizes="(min-width: 1280px) 1248px, 100vw"
            alt={s.id === active ? `The same game drawn in the ${s.name} style.` : ""}
            aria-hidden={s.id === active ? undefined : true}
            width={1920}
            height={1080}
            loading={i === 0 || s.id === "tabletop" ? "eager" : "lazy"}
            decoding="async"
          />
        ))}
        <div className="lp-showcase-bar">
          <div className="lp-seg" role="radiogroup" aria-label="Board style">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={s.id === active}
                className="lp-seg-btn"
                data-reveal
                onClick={() => {
                  setAuto(false);
                  setActive(s.id);
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          <p className="lp-showcase-caption" aria-live="polite">
            <span className="lp-chip">{current.kind}</span> {current.line}
          </p>
        </div>
      </div>
    </section>
  );
}
