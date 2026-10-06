"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";

import { createQuickGame } from "./quick-start";

/** One click into a running game vs two Medium bots. */
export function PlayNowButton({ size = "large", children, className }: { size?: "large" | "default"; children?: ReactNode; className?: string }) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    // warm the game route so the click lands straight in a game
    router.prefetch("/play/local/quick" as Route);
  }, [router]);
  return (
    <button
      type="button"
      className={`carc-btn lp-play ${className ?? ""}`}
      data-variant="primary"
      data-size={size === "large" ? "large" : undefined}
      data-testid="play-now"
      aria-busy={starting || undefined}
      onClick={() => {
        if (starting) return;
        setStarting(true);
        router.push(createQuickGame() as Route);
      }}
    >
      <Play className="fill-current" aria-hidden="true" />
      {children ?? "Play now"}
    </button>
  );
}
