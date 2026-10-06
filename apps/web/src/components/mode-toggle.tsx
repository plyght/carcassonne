"use client";

// The theme switch: a small two-tone disc (paper and ink) that turns over when you
// switch between light and dark. Settings keeps the "follow the system" choice.

import { useEffect, useState } from "react";

import { useTheme } from "next-themes";

import { cn } from "@carcassonne/ui/lib/utils";

export function ThemeSwitch({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Switch to light" : "Switch to dark";
  return (
    <button
      type="button"
      className={cn("carc-theme-switch", className)}
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      data-dark={dark || undefined}
    >
      <span className="carc-theme-disc" aria-hidden />
      {withLabel ? <span>{dark ? "Light mode" : "Dark mode"}</span> : null}
    </button>
  );
}

/** Kept for existing imports. */
export const ModeToggle = ThemeSwitch;
