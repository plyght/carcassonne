import type { Route } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { PlayNowButton } from "./play-now";

const ROWS = [
  {
    id: "ai",
    title: "Against the bots",
    body: "There are four levels, from Easy up to an Expert that searches six turns ahead, and they think right in your browser so you never wait in a queue.",
    chips: ["Easy", "Medium", "Hard", "Expert"],
  },
  {
    id: "hotseat",
    title: "Around one screen",
    body: "Two to five players share a single device and pass it along whenever a turn is done.",
    href: "/play/new?mode=hotseat",
    action: "Set up hot-seat",
  },
  {
    id: "online",
    title: "With friends, online",
    body: "Open a room, send the invite link and fill any empty seats with bots, while friends can watch and everyone can react.",
    href: "/online",
    action: "Open a room",
  },
  {
    id: "ranked",
    title: "Ranked",
    body: "Ranked games are three- and four-player free-for-alls with Glicko-2 ratings.",
    href: "/ranked",
    action: "Find a match",
  },
] as const;

export function Ways() {
  return (
    <section className="lp-section lp-ways" aria-labelledby="ways-h">
      <div className="lp-section-head">
        <h2 id="ways-h" className="lp-h2">
          Play the way your table plays.
        </h2>
        <p className="lp-section-lead">
          Every game is the full base game with The River and The Abbot, and you choose the field-scoring edition. Finished games keep a replay you
          can scrub turn by turn.
        </p>
      </div>

      <ul className="lp-ways-list">
        {ROWS.map((r) => (
          <li key={r.id} className="lp-way" data-way={r.id}>
            <h3 className="lp-way-title">{r.title}</h3>
            <div className="lp-way-body">
              <p>{r.body}</p>
              {"chips" in r ? (
                <p className="lp-way-chips">
                  {r.chips.map((c) => (
                    <span key={c} className="lp-chip">
                      {c}
                    </span>
                  ))}
                </p>
              ) : null}
            </div>
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

      <aside className="lp-desktop" aria-label="Desktop app">
        <span className="lp-chip" data-tone="gold">
          Coming soon
        </span>
        <p>
          A native desktop app for <strong>macOS</strong> and <strong>Linux</strong> is on its way, with the same game in its own window.
        </p>
        <Link href={"/replays" as Route} className="lp-link">
          In the meantime, you can watch some replays <ArrowRight aria-hidden="true" />
        </Link>
      </aside>
    </section>
  );
}
