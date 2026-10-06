"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Sections settle in once as they scroll into view (opacity + a short rise; CSS in
 * landing.css, none under reduced motion). Content is visible without JS.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"static" | "waiting" | "in">("static");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // already on screen at load: leave it alone (no flash)
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9) return;
    setState("waiting");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setState("in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="lp-reveal" data-reveal={state}>
      {children}
    </div>
  );
}
