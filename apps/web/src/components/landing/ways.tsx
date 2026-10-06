import type { Route } from "next";
import Link from "next/link";
import { ArrowRight } from "reicon-react";

import { PlayNowButton } from "./play-now";

const ROWS = [
  { id: "ai", title: "Against the bots", body: "Pick one of four levels, from Easy up to Expert." },
  { id: "hotseat", title: "Around one screen", body: "Two to five players pass one device around.", href: "/play/new?mode=hotseat", action: "Set up hot-seat" },
  { id: "online", title: "With friends, online", body: "Open a room and send your friends the link.", href: "/online", action: "Open a room" },
  { id: "ranked", title: "Ranked", body: "Earn a rating in three- and four-player games.", href: "/ranked", action: "Find a match" },
] as const;

export function Ways() {
  return (
    <section className="lp-section lp-ways reveal" aria-labelledby="ways-h">
      <div className="lp-section-head">
        <h2 id="ways-h" className="lp-h2" data-reveal>
          Play the way your table plays
        </h2>
        <p className="lp-section-lead" data-reveal>
          Every game is the full base game with The River and The Abbot.
        </p>
      </div>

      <ul className="lp-ways-list">
        {ROWS.map((r) => (
          <li key={r.id} className="lp-way" data-way={r.id} data-reveal>
            <h3 className="lp-way-title">{r.title}</h3>
            <p className="lp-way-body">{r.body}</p>
            <div className="lp-way-action">
              {"href" in r ? (
                <Link href={r.href as Route} className="carc-btn lp-way-btn">
                  {r.action} <ArrowRight aria-hidden="true" />
                </Link>
              ) : (
                <PlayNowButton size="default" className="lp-way-btn" />
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="lp-desktop" data-reveal>
        <span className="lp-chip" data-tone="gold">
          Coming soon
        </span>
        A desktop app for macOS and Linux is on its way.
      </p>
    </section>
  );
}
