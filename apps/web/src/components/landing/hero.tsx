import type { Route } from "next";
import Link from "next/link";
import { Users } from "reicon-react";

import { HeroBoard } from "./hero-board";
import { PlayNowButton } from "./play-now";
import { HeroMeta } from "./resume-link";

const HEADLINE: { text: string; accent?: boolean }[] = [
  { text: "Carcassonne is a game of " },
  { text: "tiles", accent: true },
  { text: ", " },
  { text: "castles", accent: true },
  { text: " and " },
  { text: "meeples", accent: true },
  { text: "." },
];

/**
 * The headline, one span per character so it can blur in letter by letter. Words are
 * wrapped so a line never breaks mid-word; the real text sits on the h1's aria-label.
 */
function SplitHeadline() {
  let i = 0;
  const words: React.ReactNode[] = [];
  HEADLINE.forEach((run, r) => {
    run.text.split(/(\s+)/).forEach((word, w) => {
      if (!word) return;
      if (/^\s+$/.test(word)) {
        words.push(" ");
        return;
      }
      words.push(
        <span key={`${r}-${w}`} className="lp-word" data-accent={run.accent || undefined}>
          {Array.from(word).map((ch, c) => (
            <span key={c} className="lp-char" style={{ "--c": i++ } as React.CSSProperties}>
              {ch}
            </span>
          ))}
        </span>,
      );
    });
  });
  return <>{words}</>;
}

export function Hero() {
  return (
    <section className="lp-hero reveal" aria-labelledby="hero-h">
      <div className="lp-hero-copy">
        <h1 id="hero-h" className="lp-h1" aria-label={HEADLINE.map((r) => r.text).join("")}>
          <span aria-hidden="true">
            <SplitHeadline />
          </span>
        </h1>
        <p className="lp-hero-lead" data-reveal data-reveal-delay="560">
          Draw a tile, grow the countryside and claim its cities, roads and fields before your friends do.
        </p>
        <div className="lp-hero-actions" data-reveal data-reveal-delay="660">
          <PlayNowButton />
          <Link href={"/online" as Route} className="carc-btn lp-btn-quiet" data-size="large">
            <Users aria-hidden="true" /> Play with friends
          </Link>
        </div>
        <HeroMeta />
      </div>
      <HeroBoard />
    </section>
  );
}
