"use client";

// The site header: the wordmark on the left, quiet text links and one Play button on
// the right, the account as text. It floats transparently over the landing hero and
// becomes a paper bar once the page scrolls; phones get a menu sheet. Game screens
// (local, online, tutorial, replays) hide it: their HUD has its own way back.

import { useEffect, useRef, useState } from "react";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useApplyGlobalSettings } from "@/lib/settings";

import { ThemeSwitch } from "./mode-toggle";
import UserMenu from "./user-menu";

const LINKS: { to: Route; label: string }[] = [
  { to: "/tutorial", label: "Learn" },
  { to: "/online", label: "Online" },
  { to: "/replays", label: "Replays" },
  { to: "/settings", label: "Settings" },
];

/** Routes that are a game screen with their own HUD (no site header). */
export function isGameScreen(path: string): boolean {
  return path.startsWith("/play/local/") || path.startsWith("/play/online/") || path.startsWith("/replays/") || path === "/tutorial";
}

/** A small solid meeple, the wordmark's mark (no box around it). */
function Mark() {
  return (
    <svg className="carc-brand-mark" viewBox="0 0 24 24" width={22} height={22} aria-hidden>
      <path
        fill="currentColor"
        d="M12 1.5C14.6 1.5 16.3 3.4 16.3 5.8C16.3 7.2 15.7 8.3 14.8 9.1L21.2 10.6C22.8 11 23.3 12.4 22.5 13.7C21.9 14.6 20.8 14.9 19.6 14.6L16.6 13.9L19.9 21.2C20.3 22.1 19.7 22.9 18.7 22.9L14.6 22.9L12 18.2L9.4 22.9L5.3 22.9C4.3 22.9 3.7 22.1 4.1 21.2L7.4 13.9L4.4 14.6C3.2 14.9 2.1 14.6 1.5 13.7C0.7 12.4 1.2 11 2.8 10.6L9.2 9.1C8.3 8.3 7.7 7.2 7.7 5.8C7.7 3.4 9.4 1.5 12 1.5Z"
      />
    </svg>
  );
}

export default function Header() {
  useApplyGlobalSettings();
  const path = usePathname();
  const overlay = path === "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  // The page scrolls inside <main>, not the window.
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const on = () => setScrolled(main.scrollTop > 8);
    on();
    main.addEventListener("scroll", on, { passive: true });
    return () => main.removeEventListener("scroll", on);
  }, [path]);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        menuButton.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (isGameScreen(path)) return null;
  const current = (to: string) => (path === to || path.startsWith(`${to}/`) ? "page" : undefined);

  return (
    <header className="carc-header" data-overlay={overlay || undefined} data-scrolled={scrolled || open || undefined} data-open={open || undefined}>
      <div className="carc-header-inner">
        <Link href="/" className="carc-brand" aria-label="Carcassonne, home">
          <Mark />
          <span className="carc-brand-name">Carcassonne</span>
        </Link>
        <nav className="carc-nav" aria-label="Main">
          {LINKS.map(({ to, label }) => (
            <Link key={to} href={to} className="carc-nav-link" aria-current={current(to)}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="carc-header-end">
          <ThemeSwitch className="carc-header-desktop" />
          <UserMenu className="carc-header-desktop" />
          <Link href="/play/new" className="carc-btn carc-header-play" data-variant="primary" aria-current={current("/play/new")}>
            Play
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="carc-menu-button"
            aria-expanded={open}
            aria-controls="site-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open ? (
        <div id="site-menu" className="carc-menu-sheet">
          <nav aria-label="Main" className="carc-menu-links">
            <Link href="/play/new" className="carc-menu-link" aria-current={current("/play/new")}>
              Play
            </Link>
            {LINKS.map(({ to, label }) => (
              <Link key={to} href={to} className="carc-menu-link" aria-current={current(to)}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="carc-menu-foot">
            <UserMenu />
            <ThemeSwitch withLabel />
          </div>
        </div>
      ) : null}
    </header>
  );
}
