"use client";

// The interactive tutorial: six short lessons played on the real engine (crafted
// boards rebuilt with game_from_view, see @carcassonne/game-client's tutorial.ts).
// Each lesson says what to do in one or two sentences, allows only that move, and
// celebrates with the engine's own scoring, explained.

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateLeft } from "reicon-react";

import { DEFAULT_RULESET } from "@carcassonne/protocol";
import { explainScore, randomSeedString, TutorialClient, type PlayerMeta, type TutorialProgress } from "@carcassonne/game-client";

import { GameScreen } from "@/components/game/game-screen";
import { Kbd, Panel } from "@/components/game/hud-parts";
import { loadCoreAssets } from "@/lib/core";
import { createLocalGame } from "@/lib/local-games";

const PLAYERS: PlayerMeta[] = [
  { name: "You", color: "blue", kind: "human" },
  { name: "Brother Odo", color: "red", kind: "bot", tier: "easy" },
];

interface Copy {
  title: string;
  /** What to do: place the tile. */
  place: ReactNode;
  /** What to do once the tile is down (claim, or skip). */
  claim: ReactNode;
}

const LESSONS: { title: string; steps: Record<string, Copy>; done: ReactNode }[] = [
  {
    title: "Place a tile",
    steps: {
      place: {
        title: "Place a tile",
        place: (
          <>
            This is the start of the map, and your tile is a straight road. Click a <strong>glowing spot</strong> beside the start tile: the road on your tile has to line up with the road on the map.
          </>
        ),
        claim: (
          <>
            Each turn you may also claim what you just placed with a meeple. Not this time: choose <strong>Skip</strong>.
          </>
        ),
      },
    },
    done: <>Every edge matches, with road meeting road and grass meeting grass. Brother Odo then took his turn, because players take turns placing one tile each.</>,
  },
  {
    title: "Turn the tile",
    steps: {
      rotate: {
        title: "Turn the tile",
        place: (
          <>
            This tile has a bend, and it’s facing the wrong way: its road would run into grass.{" "}
            <span className="carc-keys">
              Press <Kbd>R</Kbd> (or click the dial)
            </span>
            <span className="carc-touch">Tap the dial</span> to turn it until the road lines up, then put it on the glowing spot.
          </>
        ),
        claim: (
          <>
            No meeple this time: choose <strong>Skip</strong>.
          </>
        ),
      },
    },
    done: <>You’ll turn most tiles before you place them, and a red edge around the preview means the tile doesn’t fit that way round yet.</>,
  },
  {
    title: "Thieves on roads",
    steps: {
      "road-claim": {
        title: "Claim a road",
        place: <>The road on the map ends at a cloister on the right. Place this road tile on the glowing spot to make it longer.</>,
        claim: (
          <>
            Now claim the road: tap the meeple on the road, or choose <strong>Thief on the road</strong>. A meeple on a road is called a thief.
          </>
        ),
      },
      "road-finish": {
        title: "Finish the road",
        place: <>A road is finished when both of its ends stop at a cloister, a city, a village or a crossroads, so close the open end with this crossroads.</>,
        claim: (
          <>
            Nothing to claim: choose <strong>Skip</strong>, and watch your road score.
          </>
        ),
      },
    },
    done: <>A finished road scores 1 point per tile, and your thief comes back to use again.</>,
  },
  {
    title: "Knights in cities",
    steps: {
      city: {
        title: "Claim and finish a city",
        place: <>Cities are the walled, brown areas. Place this corner piece to join the two bits of city and close the walls all the way round.</>,
        claim: (
          <>
            Put a <strong>knight</strong> in the city. You can claim a city in the same move that finishes it, and score it straight away.
          </>
        ),
      },
    },
    done: <>A finished city scores 2 points per tile, plus 2 for every blue shield.</>,
  },
  {
    title: "Monks in cloisters",
    steps: {
      "cloister-claim": {
        title: "Claim a cloister",
        place: <>A cloister is a small church in a field, so place it in the middle of the villages.</>,
        claim: (
          <>
            Claim it with a <strong>monk</strong>; a cloister is finished when all 8 spaces around it hold tiles.
          </>
        ),
      },
      "cloister-finish": {
        title: "Fill the last space",
        place: <>Seven of the eight spaces around your cloister are filled, so fill the last one.</>,
        claim: (
          <>
            Choose <strong>Skip</strong> and your cloister scores.
          </>
        ),
      },
    },
    done: <>A surrounded cloister scores 9 points: 1 for itself and 1 for each neighbour.</>,
  },
  {
    title: "Farmers and the end",
    steps: {
      farmer: {
        title: "The last tile",
        place: <>The draw pile is empty, so this is the last tile of the game. Place it at the end of the road.</>,
        claim: (
          <>
            Put a <strong>farmer</strong> in the field above the road. Farmers lie down and stay until the game ends. Then each field scores 3 points for every finished city it touches.
          </>
        ),
      },
    },
    done: <>The game is over. At the end, unfinished roads, cities and cloisters still score, farmers score their fields, and whoever has the most points wins.</>,
  },
];

function useProgress(client: TutorialClient | null): TutorialProgress | null {
  return useSyncExternalStore(
    (fn) => client?.subscribe(fn) ?? (() => {}),
    () => client?.progress ?? null,
    () => null,
  );
}

export default function TutorialPage() {
  const router = useRouter();
  const [client, setClient] = useState<TutorialClient | null>(null);
  const [misfit, setMisfit] = useState(0);
  const progress = useProgress(client);

  useEffect(() => {
    let c: TutorialClient | null = null;
    let disposed = false;
    void loadCoreAssets().then((core) => {
      if (disposed) return;
      c = new TutorialClient(core.kit, PLAYERS, { catalog: core.catalog, botDelayMs: 1100 });
      c.start();
      setClient(c);
    });
    return () => {
      disposed = true;
      c?.dispose();
    };
  }, []);

  const quickStart = useCallback(() => {
    const rec = createLocalGame({
      mode: "ai",
      ruleset: { ...DEFAULT_RULESET },
      seed: randomSeedString(),
      players: [
        { name: "You", color: "red", kind: "human" },
        { name: "Brother Odo", color: "blue", kind: "bot", tier: "medium" },
        { name: "Sir Gawain", color: "yellow", kind: "bot", tier: "medium" },
      ],
      engine: "core-wasm",
    });
    router.push(`/play/local/${rec.id}` as Route);
  }, [router]);

  // Clear the "doesn't fit" note when the step changes.
  const stepKey = progress ? `${progress.chapter}:${progress.step}:${progress.chapterDone}` : "";
  useEffect(() => setMisfit(0), [stepKey]);

  if (!client || !progress) return <div className="h-full bg-[#a4743f]" aria-busy="true" />;

  const lesson = LESSONS[progress.chapter]!;
  const step = client.step;
  const copy = step ? lesson.steps[step.id] : null;
  const last = progress.chapter === LESSONS.length - 1;
  const scored = progress.lastEvents.flatMap((e) => (e.type === "featureScored" ? [explainScore(e, PLAYERS, 3)] : [])).filter((t): t is string => !!t);
  const card = ({ pending, canAct }: { pending: boolean; canAct: boolean }) => (
    <Panel className="carc-lesson-card" data-testid="lesson-card" data-step={step?.id ?? "done"} data-done={progress.chapterDone || undefined}>
      <div className="carc-lesson-top">
        <span className="carc-lesson-count carc-num">
          Lesson {progress.chapter + 1} of {LESSONS.length}
        </span>
        <ol className="carc-lesson-dots" aria-hidden>
          {LESSONS.map((l, i) => (
            <li key={l.title} data-state={i < progress.chapter || (i === progress.chapter && progress.chapterDone) ? "done" : i === progress.chapter ? "current" : undefined} />
          ))}
        </ol>
        <div className="carc-lesson-tools">
          <button type="button" className="carc-guide-link" onClick={() => client.loadChapter(progress.chapter)} title="Start this lesson again">
            <RotateLeft aria-hidden className="size-3.5" /> Restart
          </button>
        </div>
      </div>
      {progress.chapterDone ? (
        <>
          <h2 className="carc-lesson-title">{last ? "You’ve learned the game" : "Well done"}</h2>
          {scored.length ? (
            <ul className="carc-guide-scores">
              {scored.map((t) => (
                <li key={t} className="carc-guide-score">
                  <span className="carc-guide-dot" style={{ background: "#2f6fc4" }} aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="carc-lesson-text">{lesson.done}</p>
          {last ? <p className="carc-lesson-text">You finished with {client.getState().view?.players[0]?.score ?? 0} points.</p> : null}
          <div className="carc-lesson-actions">
            {last ? (
              <>
                <Link href={"/" as Route} className="carc-btn" data-variant="ghost">
                  Back to the menu
                </Link>
                <button type="button" className="carc-btn" data-variant="primary" onClick={quickStart} data-testid="tutorial-play">
                  Play a real game <ArrowRight />
                </button>
              </>
            ) : (
              <button type="button" className="carc-btn" data-variant="primary" onClick={() => client.next()} data-testid="lesson-next" autoFocus>
                Next: {LESSONS[progress.chapter + 1]!.title} <ArrowRight />
              </button>
            )}
          </div>
        </>
      ) : copy ? (
        <>
          <h2 className="carc-lesson-title">{copy.title}</h2>
          <p className="carc-lesson-text">{!canAct ? "Brother Odo is taking his turn…" : pending ? copy.claim : copy.place}</p>
          {progress.refusal ? (
            <p className="carc-lesson-note" role="status">
              {progress.refusal}
            </p>
          ) : misfit && canAct && !pending ? (
            <p className="carc-lesson-note" role="status">
              Not like that: the edges don’t match yet.{" "}
              <span className="carc-keys">
                Press <Kbd>R</Kbd> to turn the tile.
              </span>
              <span className="carc-touch">Tap the dial to turn the tile.</span>
            </p>
          ) : null}
        </>
      ) : null}
    </Panel>
  );

  return (
    <GameScreen
      client={client}
      title="Tutorial"
      exitHref="/"
      lesson={{
        card,
        snap: step?.snap ?? true,
        allowSkip: client.skipAllowed,
        startRot: step?.startRot,
        stepKey,
        onMisfit: () => setMisfit((n) => n + 1),
        idle: progress.chapterDone,
      }}
    />
  );
}
