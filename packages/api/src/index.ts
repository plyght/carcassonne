import { initTRPC, TRPCError } from "@trpc/server";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

/** Requires an account (better-auth session). */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session || ctx.identity?.kind !== "user") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      identity: ctx.identity,
    },
  });
});

/** Account user or guest (invite rooms). */
export const identityProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.identity) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in or join as a guest" });
  }
  return next({ ctx: { ...ctx, identity: ctx.identity } });
});

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) throw new TRPCError({ code: "FORBIDDEN", message: "Admins only" });
  return next();
});
