"use client";

import { useEffect, useState, type RefObject } from "react";

/** Whether `ref` is on screen (re-reported as it enters and leaves). */
export function useInView(ref: RefObject<Element | null>, opts: { threshold?: number; rootMargin?: string } = {}): boolean {
  const [inView, setInView] = useState(false);
  const { threshold = 0, rootMargin = "0px" } = opts;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { threshold, rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, rootMargin]);
  return inView;
}
