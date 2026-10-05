"use client";

import { inlineEngine, loadEngine, workerEngine, type AsyncEngine } from "@carcassonne/game-client";

/** Start the engine in a Web Worker, falling back to the main thread. */
export async function createEngine(): Promise<AsyncEngine> {
  if (typeof Worker !== "undefined") {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" });
      const w = worker;
      const crashed = new Promise<never>((_, reject) =>
        w.addEventListener("error", (e) => reject(new Error(e.message || "worker failed to start")), { once: true }),
      );
      const engine = workerEngine(w, "worker");
      // Probe: a healthy engine answers "unknown game handle" for handle -1.
      await Promise.race([
        engine.view(-1).then(
          () => undefined,
          (e: Error) => {
            if (!/unknown game handle/.test(e.message)) throw e;
          },
        ),
        crashed,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("worker timeout")), 5000)),
      ]);
      console.info("[engine] running in a Web Worker");
      return engine;
    } catch (e) {
      worker?.terminate();
      console.warn("engine worker unavailable, running inline:", (e as Error).message);
    }
  }
  return inlineEngine(await loadEngine());
}
