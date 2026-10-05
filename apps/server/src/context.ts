import type { Context as ApiContext } from "@carcassonne/api/context";
import { GUEST_HEADER, verifyGuestToken, type Identity } from "@carcassonne/api/identity";

import type { Services } from "./services";

/** Resolve the caller: better-auth session cookie/bearer first, then a signed guest token. */
export async function resolveIdentity(services: Services, headers: Headers, guestToken?: string | null) {
  const session = await services.auth.api.getSession({ headers }).catch(() => null);
  if (session) {
    const identity: Identity = { kind: "user", userId: session.user.id, name: session.user.name };
    return { session, identity };
  }
  const guest = verifyGuestToken(services.deps.guestSecret, guestToken ?? headers.get(GUEST_HEADER));
  return { session: null, identity: guest as Identity | null };
}

export async function createContext(services: Services, request: Request): Promise<ApiContext> {
  const { session, identity } = await resolveIdentity(services, request.headers);
  return {
    db: services.db,
    deps: services.deps,
    session,
    identity,
    isAdmin: !!session && services.adminEmails.has(session.user.email.toLowerCase()),
  };
}

export type Context = ApiContext;
