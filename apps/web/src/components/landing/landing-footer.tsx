import type { Route } from "next";
import Link from "next/link";

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
    <footer className="lp-footer">
      <div className="lp-footer-top">
        <span className="lp-signature" role="img" aria-label="A dithered tile with a meeple standing on its city" />
        <nav className="lp-footer-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title} className="lp-footer-col">
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
      <p className="lp-wordmark" aria-hidden="true">
        Carcassonne
      </p>
      <p className="lp-credit">
        Carcassonne is a board game by Klaus-Jürgen Wrede. This is an unofficial, personal project made for playing with friends.
      </p>
    </footer>
  );
}
