import type { Route } from "next";
import Link from "next/link";

import { FooterRoad } from "./road";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Play",
    links: [
      { href: "/play/new?mode=ai", label: "Against bots" },
      { href: "/play/new?mode=hotseat", label: "Hot-seat" },
      { href: "/online", label: "Online rooms" },
      { href: "/ranked", label: "Ranked" },
    ],
  },
  {
    title: "More",
    links: [
      { href: "/tutorial", label: "Tutorial" },
      { href: "/replays", label: "Replays" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function LandingFooter() {
  return (
    <footer className="lp-footer reveal">
      <FooterRoad />

      <div className="lp-footer-top">
        <p className="lp-footer-note" data-reveal>
          The road is open and there is always a free seat, so pull up a chair whenever you like.
        </p>
        <nav className="lp-footer-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title} className="lp-footer-col" data-reveal>
              <h2 className="lp-footer-h">{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href as Route} className="lp-footer-link">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <p className="lp-wordmark" aria-hidden="true" data-reveal>
        Carcassonne
      </p>
      <p className="lp-credit" data-reveal>
        Carcassonne is a board game by Klaus-Jürgen Wrede. This is an unofficial, personal project made for playing with friends.
      </p>
    </footer>
  );
}
