"use client";

import { useQuery } from "@tanstack/react-query";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function Dashboard({ session }: { session: typeof authClient.$Infer.Session }) {
  const privateData = useQuery(trpc.privateData.queryOptions());

  return (
    <p className="carc-hint mt-[var(--sp-6)]">Server: {privateData.data?.message ?? "connecting…"}</p>
  );
}
