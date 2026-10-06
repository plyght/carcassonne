"use client";

// The theme switch: a square icon button with Reicon's sun and moon. The icon for the
// mode you would switch to is shown; the two cross-fade with a small turn and blur.
// Settings keeps the "follow the system" choice.

import { useEffect, useState } from "react";

import { useTheme } from "next-themes";
import { Moon, Sun } from "reicon-react";

import { cn } from "@carcassonne/ui/lib/utils";

export function ThemeSwitch({ className, withLabel }: { className?: string; withLabel?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      className={cn("carc-theme-switch", className)}
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={withLabel ? undefined : label}
      title={label}
      data-dark={dark || undefined}
      data-labelled={withLabel || undefined}
    >
      <span className="carc-theme-icons" aria-hidden>
        <Moon className="carc-theme-moon" size={20} />
        <Sun className="carc-theme-sun" size={20} />
      </span>
      {withLabel ? <span>{dark ? "Light mode" : "Dark mode"}</span> : null}
    </button>
  );
}

/** Kept for existing imports. */
export const ModeToggle = ThemeSwitch;
