import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { joinQueue, leaveQueue, queueStatus } from "../matchmaking/service";
import { effectiveFlags } from "../usage/service";
import { queueSchema } from "./schemas";

/** Ranked queues need an account (PRD §6.1). */
export const matchmakingRouter = router({
  joinQueue: protectedProcedure.input(z.object({ queue: queueSchema })).mutation(async ({ ctx, input }) => {
    if ((await effectiveFlags(ctx.deps)).pauseOnline) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Online play is paused for this month" });
    }
    return joinQueue(ctx.deps, ctx.identity.userId, input.queue);
  }),
  leaveQueue: protectedProcedure.mutation(async ({ ctx }) => {
    await leaveQueue(ctx.deps, ctx.identity.userId);
    return queueStatus(ctx.deps, ctx.identity.userId);
  }),
  status: protectedProcedure.query(({ ctx }) => queueStatus(ctx.deps, ctx.identity.userId)),
});
