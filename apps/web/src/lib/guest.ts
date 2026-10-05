"use client";

// Guest identity for invite rooms: `room.joinAsGuest` returns a signed token that the
// server reads from the `x-guest-token` header (tRPC) and `?guest=` (WebSocket).

import { readJSON, writeJSON } from "./storage";

export interface GuestIdentity {
  token: string;
  guestId: string;
  name: string;
}

const KEY = "carc.guest.v1";

export function getGuest(): GuestIdentity | null {
  if (typeof window === "undefined") return null;
  return readJSON<GuestIdentity | null>(KEY, null);
}

export function setGuest(g: GuestIdentity | null) {
  writeJSON(KEY, g);
}

export function guestHeaders(): Record<string, string> {
  const g = getGuest();
  return g ? { "x-guest-token": g.token } : {};
}
