import type { Route } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

import { HeroBoard } from "./hero-board";
import { PlayNowButton } from "./play-now";
import { HeroMeta } from "./resume-link";

export function Hero() {
  return (
    <section className="lp-hero" aria-labelledby="hero-h">
      <div className="lp-hero-copy">
        <h1 id="hero-h" className="lp-h1">
          Carcassonne is a game of <em>tiles</em>, <em>castles</em> and <em>meeples</em>.
        </h1>
        <p className="lp-hero-lead">
          Draw a tile, grow the countryside, and drop a meeple on the city your friends were counting on. Whoever claims it best, wins.
        </p>
        <div className="lp-hero-actions">
          <PlayNowButton />
          <Link href={"/online" as Route} className="carc-btn lp-btn-ghost" data-size="large">
            <Users aria-hidden="true" /> Play with friends
          </Link>
        </div>
        <HeroMeta />
      </div>
      <HeroBoard />
    </section>
  );
}
