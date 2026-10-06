"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Castle, Church, GraduationCap, Play, Route as RoadIcon, Wheat } from "lucide-react";

import { DEFAULT_RULESET } from "@carcassonne/protocol";
import { FigureIcon, PLAYER_COLORS } from "@carcassonne/render-classic";

import { createLocalGame } from "@/lib/local-games";

const LESSONS = [
  { icon: GraduationCap, title: "Place a tile", text: "Every edge must match its neighbours: road to road, city to city, field to field. Rotate with R or the scroll wheel." },
  { icon: RoadIcon, title: "Thieves on roads", text: "A finished road scores 1 per tile. Unfinished roads score the same at the end." },
  { icon: Castle, title: "Knights in cities", text: "A finished city scores 2 per tile and 2 per pennant; unfinished, half that." },
  { icon: Church, title: "Monks in cloisters", text: "A cloister surrounded by 8 tiles scores 9. The abbot can also sit here, and be recalled early." },
  { icon: Wheat, title: "Farmers in fields", text: "Farmers lie down and stay until the end: 3 points per finished city their field touches." },
];

export default function TutorialPage() {
  const router = useRouter();
  const start = () => {
    const rec = createLocalGame({
      mode: "tutorial",
      ruleset: { ...DEFAULT_RULESET, river: false },
      seed: "tutorial-1",
      players: [
        { name: "You", color: "blue", kind: "human" },
        { name: "Brother Odo", color: "red", kind: "bot", tier: "easy" },
      ],
      engine: "core-wasm",
    });
    router.push(`/play/local/${rec.id}` as Route);
  };
  const blue = PLAYER_COLORS.blue;
  return (
    <div className="carc-page">
      <div className="flex items-center gap-[var(--sp-4)]">
        <span className="carc-pass-avatar mb-0!" style={{ ["--seat" as string]: blue.fill, width: 72, height: 72 }}>
          <FigureIcon fill={blue.fill} ink={blue.ink} marker={blue.marker} size={44} />
        </span>
        <div className="min-w-0">
          <h1 className="carc-page-title">Tutorial</h1>
          <p className="carc-page-lead mt-[var(--sp-1)]!">The rules in two minutes, then a gentle seeded game against an Easy bot.</p>
        </div>
      </div>
      <ol className="carc-sheet carc-lessons mt-[var(--sp-6)]">
        {LESSONS.map((l, i) => (
          <li key={l.title} className="carc-lesson">
            <span className="carc-well">
              <l.icon />
            </span>
            <div className="min-w-0">
              <div className="carc-lesson-title">
                <span className="carc-num text-[var(--text-2)]">{i + 1}.</span> {l.title}
              </div>
              <p className="carc-sub">{l.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-[var(--sp-6)] flex flex-wrap items-center justify-between gap-[var(--sp-4)]">
        <p className="carc-hint max-w-[44ch]">
          The scripted, step-by-step tutorial with on-board callouts arrives with the full engine; this practice game uses a fixed seed.
        </p>
        <button type="button" onClick={start} className="carc-btn" data-variant="primary" data-size="large">
          <Play className="fill-current" /> Start the practice game
        </button>
      </div>
    </div>
  );
}
