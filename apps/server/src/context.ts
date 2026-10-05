import type { Context as ApiContext } from "@carcassonne/api/context";
import type { Context as ElysiaContext } from "elysia";

import { db } from "./services";
import { auth } from "./services";

export type CreateContextOptions = {
  context: ElysiaContext;
};

export async function createContext({ context }: CreateContextOptions): Promise<ApiContext> {
  const session = await auth.api.getSession({
    headers: context.request.headers,
  });
  return {
    db,
    session,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
