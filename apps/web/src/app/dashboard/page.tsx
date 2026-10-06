import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authClient } from "@/lib/auth-client";

import Dashboard from "./dashboard";

export default async function DashboardPage() {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: await headers(),
      throw: true,
    },
  });

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="carc-page">
      <h1 className="carc-page-title">Welcome, {session.user.name}</h1>
      <p className="carc-page-lead">You’re signed in. Host a room, queue for ranked, or pick up where you left off.</p>
      <div className="mt-[var(--sp-6)] flex flex-wrap gap-[var(--sp-3)]">
        <Link href="/online" className="carc-btn" data-variant="primary" data-size="large">
          Host or join a room
        </Link>
        <Link href="/ranked" className="carc-btn" data-size="large">
          Ranked
        </Link>
        <Link href="/profile" className="carc-btn" data-variant="ghost" data-size="large">
          Profile
        </Link>
      </div>
      <Dashboard session={session} />
    </div>
  );
}
