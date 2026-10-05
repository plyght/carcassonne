// RPC bridge that runs an EnginePort inside a Web Worker.
//
// Worker side (the app owns the worker entry so its bundler can see it):
//   import { serveEngine } from "@carcassonne/game-client/worker";
//   import { loadEngine } from "@carcassonne/game-client";
//   serveEngine(loadEngine());
//
// Main thread:
//   const engine = workerEngine(new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" }));

import type { AsyncEngine, EnginePort } from "../engine-port";

type Method = Exclude<keyof EnginePort, "name">;

interface Request {
  id: number;
  method: Method;
  args: unknown[];
}

type Response = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (ev: MessageEvent) => void): void;
  addEventListener(type: "error", fn: (ev: ErrorEvent) => void): void;
  terminate?(): void;
}

interface ScopeLike {
  postMessage(msg: unknown): void;
  addEventListener(type: "message", fn: (ev: MessageEvent) => void): void;
}

/** Call inside the worker. */
export function serveEngine(engine: EnginePort | Promise<EnginePort>, scope: ScopeLike = globalThis as unknown as ScopeLike) {
  const ready = Promise.resolve(engine);
  scope.addEventListener("message", async (ev: MessageEvent) => {
    const req = ev.data as Request;
    if (!req || typeof req.id !== "number") return;
    let res: Response;
    try {
      const port = await ready;
      const fn = port[req.method] as (...a: unknown[]) => unknown;
      res = { id: req.id, ok: true, value: fn.apply(port, req.args) };
    } catch (e) {
      res = { id: req.id, ok: false, error: String((e as Error)?.message ?? e) };
    }
    scope.postMessage(res);
  });
}

/** Main-thread proxy for an engine living in `worker`. */
export function workerEngine(worker: WorkerLike, name = "worker"): AsyncEngine {
  let next = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  worker.addEventListener("message", (ev: MessageEvent) => {
    const res = ev.data as Response;
    const p = pending.get(res?.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error));
  });
  worker.addEventListener("error", (ev: ErrorEvent) => {
    for (const p of pending.values()) p.reject(new Error(ev.message || "engine worker crashed"));
    pending.clear();
  });
  const call =
    (method: Method) =>
    (...args: unknown[]) =>
      new Promise<unknown>((resolve, reject) => {
        const id = next++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, args } satisfies Request);
      });
  return {
    name,
    createGame: call("createGame"),
    freeGame: call("freeGame"),
    apply: call("apply"),
    view: call("view"),
    legalPlacements: call("legalPlacements"),
    legalFigures: call("legalFigures"),
    aiChoose: call("aiChoose"),
    dispose: () => worker.terminate?.(),
  } as AsyncEngine;
}
