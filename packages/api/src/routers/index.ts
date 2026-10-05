import { protectedProcedure, publicProcedure, router } from "../index";
import { adminRouter, configRouter } from "./admin";
import { gameRouter } from "./game";
import { matchmakingRouter } from "./matchmaking";
import { profileRouter, ratingsRouter } from "./profile";
import { roomRouter } from "./room";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
  room: roomRouter,
  game: gameRouter,
  matchmaking: matchmakingRouter,
  profile: profileRouter,
  ratings: ratingsRouter,
  admin: adminRouter,
  config: configRouter,
});
export type AppRouter = typeof appRouter;
