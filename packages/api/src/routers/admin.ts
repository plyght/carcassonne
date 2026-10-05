import { adminProcedure, publicProcedure, router } from "../index";
import { computeUsage, effectiveFlags } from "../usage/service";

export const adminRouter = router({
  /** Free-tier counters (PRD §7.3 guard rails). */
  usage: adminProcedure.query(async ({ ctx }) => {
    const [usage, flags] = await Promise.all([computeUsage(ctx.deps), effectiveFlags(ctx.deps)]);
    return { ...usage, flags };
  }),
});

/** Public, cache-friendly transport hint used by clients before opening a socket. */
export const configRouter = router({
  transport: publicProcedure.query(async ({ ctx }) => {
    const f = await effectiveFlags(ctx.deps);
    return { transport: f.forcePolling ? ("polling" as const) : ("websocket" as const), onlinePaused: f.pauseOnline };
  }),
});
