"use client";

// Staggered blur-in, the entrance used on all of the owner's sites: each item fades
// from opacity 0 + blur(6px) to sharp, with no movement, once it scrolls into view.
//
//   <section className="reveal">            a region
//     <h2 data-reveal>…</h2>                 its items (or, with none marked, its
//     <p data-reveal>…</p>                   direct children), staggered by order
//   </section>
//
// Items are hidden only after JS has marked them pending, so nothing is invisible
// without JS. `data-reveal-delay="300"` on an item (ms) overrides its stagger slot;
// `data-reveal-base="200"` on a region shifts the whole group. Focus inside an item
// shows it at once; reduced motion (system or the app setting) shows everything.
// CSS lives in tokens.css (`[data-reveal-state]`).

import { useEffect, type RefObject } from "react";

import { usePathname } from "next/navigation";

const STEP_MS = 90;
const CAP_MS = 440;

function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reducedMotion === "true";
}

let observer: IntersectionObserver | null = null;
function io(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const item = e.target as HTMLElement;
        if (!e.isIntersecting || item.dataset.revealState !== "pending") continue;
        item.dataset.revealState = "revealing";
        observer?.unobserve(item);
      }
    },
    { threshold: 0.01, rootMargin: "0px 0px -16px 0px" },
  );
  return observer;
}

/** React has hydrated this element (marking it before then would be a hydration mismatch). */
function hydrated(el: Element): boolean {
  return Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
}

/**
 * Mark a region's items pending and start watching them (once per region). Returns
 * false, changing nothing, while React has yet to hydrate the region or its items.
 */
export function revealRegion(region: HTMLElement): boolean {
  if (region.dataset.revealReady !== undefined || typeof IntersectionObserver === "undefined") return true;
  const marked = Array.from(region.querySelectorAll<HTMLElement>("[data-reveal]")).filter((el) => el.closest(".reveal") === region);
  const items = marked.length ? marked : (Array.from(region.children) as HTMLElement[]);
  if (!hydrated(region) || !items.every(hydrated)) return false;
  region.dataset.revealReady = "";
  const base = Number(region.dataset.revealBase ?? 0);
  const still = reducedMotion();
  items.forEach((item, i) => {
    const own = item.dataset.revealDelay;
    const delay = own !== undefined ? Number(own) : base + Math.min(i * STEP_MS, CAP_MS);
    item.dataset.revealItem = "";
    item.style.setProperty("--reveal-delay", `${delay}ms`);
    item.style.setProperty("--i", String(i));
    if (still || item.matches(":focus-within")) item.dataset.revealState = "revealed";
    else {
      item.dataset.revealState = "pending";
      io().observe(item);
    }
  });
  return true;
}

/** Prepare every region on the page; true when some are still waiting for hydration. */
function scan(root: ParentNode = document): boolean {
  let waiting = false;
  for (const region of root.querySelectorAll<HTMLElement>(".reveal:not([data-reveal-ready])")) {
    if (!revealRegion(region)) waiting = true;
  }
  return waiting;
}

function finish(item: HTMLElement) {
  item.dataset.revealState = "revealed";
  observer?.unobserve(item);
}

/** Mounted once in the root layout: picks up `.reveal` regions as pages render. */
export function ProgressiveReveal() {
  const path = usePathname();
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // regions that have not hydrated yet are retried each frame (for a few seconds);
    // content that renders later (client data, dialogs) is picked up on the next frame
    let raf = 0;
    let tries = 0;
    const tick = () => {
      raf = 0;
      if (scan() && ++tries < 300) raf = requestAnimationFrame(tick);
    };
    tick();
    const mo = new MutationObserver(() => {
      if (raf) return;
      tries = 0;
      raf = requestAnimationFrame(tick);
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [path]);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const item = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-reveal-item]") : null;
      if (item) finish(item);
    };
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === "reveal" && e.target instanceof HTMLElement && e.target.hasAttribute("data-reveal-item")) finish(e.target);
    };
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotion = () => {
      if (motion.matches) document.querySelectorAll<HTMLElement>("[data-reveal-item]").forEach(finish);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("animationend", onEnd);
    motion.addEventListener("change", onMotion);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("animationend", onEnd);
      motion.removeEventListener("change", onMotion);
    };
  }, []);
  return null;
}

/** For a region that mounts after the page (a dialog, a summary): reveal it now. */
export function useReveal(ref: RefObject<HTMLElement | null>, ready = true) {
  useEffect(() => {
    if (ready && ref.current) revealRegion(ref.current);
  }, [ref, ready]);
}
