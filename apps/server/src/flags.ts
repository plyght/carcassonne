// Kill switches (PRD §7.3): Edge Config when connected (no redeploy needed), env vars otherwise.
import { createClient } from "@vercel/edge-config";

import type { Flags } from "@carcassonne/api/deps";

export function createFlags(cfg: { forcePolling?: boolean; pauseOnline?: boolean; edgeConfig?: string }) {
  const envFlags: Flags = { forcePolling: !!cfg.forcePolling, pauseOnline: !!cfg.pauseOnline };
  if (!cfg.edgeConfig) return async () => envFlags;
  const client = createClient(cfg.edgeConfig);
  let cached: { at: number; flags: Flags } | null = null;
  return async (): Promise<Flags> => {
    if (cached && Date.now() - cached.at < 10_000) return cached.flags;
    try {
      const items = await client.getAll(["forcePolling", "pauseOnline"]);
      const flags = {
        forcePolling: envFlags.forcePolling || items?.forcePolling === true,
        pauseOnline: envFlags.pauseOnline || items?.pauseOnline === true,
      };
      cached = { at: Date.now(), flags };
      return flags;
    } catch (err) {
      console.error("[flags] edge config read failed", err);
      return envFlags;
    }
  };
}
