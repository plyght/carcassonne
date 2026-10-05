"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Castle, Church, GraduationCap, Route as RoadIcon, Wheat } from "lucide-react";

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
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center gap-3">
        <FigureIcon fill={blue.fill} ink={blue.ink} marker={blue.marker} size={44} />
        <div>
          <h1 className="font-display text-4xl tracking-tight">Tutorial</h1>
          <p className="text-muted-foreground">The rules in two minutes, then a gentle seeded game against an Easy bot.</p>
        </div>
      </div>
      <ol className="mt-6 grid gap-3">
        {LESSONS.map((l, i) => (
          <li key={l.title} className="flex gap-4 rounded-2xl border border-border/80 bg-card/80 p-4 shadow-sm">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <l.icon className="size-5" />
            </span>
            <div>
              <div className="font-display text-lg">
                {i + 1}. {l.title}
              </div>
              <p className="text-sm text-muted-foreground">{l.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        The scripted, step-by-step tutorial with on-board callouts arrives with the full engine; this practice game uses a fixed seed.
      </p>
      <button type="button" onClick={start} className="mt-5 rounded-2xl bg-primary px-6 py-3 font-semibold text-primary-foreground">
        Start the practice game
      </button>
    </div>
  );
}
