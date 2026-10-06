"use client";

// Small building blocks that put the game's controls on DialKit's primitives and
// styling (see dial-theme.css). DialKit's exported controls (Slider, Toggle,
// SelectControl, TextControl, DialPad, Folder…) render inside a `.dialkit-root`; these
// helpers add the few shapes the game needs that DialKit doesn't export: a segmented
// control with icons and disabled options, a listbox select with swatches/icons and
// one-line hints, and hint text under a control.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { AnimatePresence, motion } from "motion/react";
import { Check } from "reicon-react";
import { useTheme } from "next-themes";

import { cn } from "@carcassonne/ui/lib/utils";

import { popMotion } from "@/lib/motion";
import { useReducedMotion } from "@/lib/settings";

/** DialKit theme matching next-themes ("system" until hydrated). */
export function useDialTheme(): "light" | "dark" | "system" {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return "system";
  return resolvedTheme === "dark" ? "dark" : "light";
}

/** A `.dialkit-root` host for DialKit controls in a custom layout. */
export function DialSurface({ className, children, ...rest }: ComponentProps<"div">) {
  const theme = useDialTheme();
  return (
    <div className={cn("dialkit-root carc-dial", className)} data-theme={theme} data-mode="inline" {...rest}>
      {children}
    </div>
  );
}

/** A control plus its one-line explanation. */
export function DialField({ hint, children, className, ...rest }: { hint?: ReactNode; children: ReactNode } & ComponentProps<"div">) {
  return (
    <div className={cn("carc-dial-field", className)} {...rest}>
      {children}
      {hint ? <p className="carc-dial-hint">{hint}</p> : null}
    </div>
  );
}

export function DialButton({ variant, className, ...rest }: { variant?: "primary" | "ghost" } & ComponentProps<"button">) {
  return <button type="button" className={cn("carc-dial-button", className)} data-variant={variant} {...rest} />;
}

export function DialIconButton({ label, variant, className, ...rest }: { label: string; variant?: "ghost" } & ComponentProps<"button">) {
  return <button type="button" aria-label={label} title={label} className={cn("carc-icon-button", className)} data-variant={variant} {...rest} />;
}

// ── segmented ─────────────────────────────────────────────────────────────

export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  /** Icon-only button when set (label becomes the accessible name + tooltip). */
  icon?: ReactNode;
  showLabel?: boolean;
  disabled?: boolean;
  title?: string;
  /** Extra attributes for tests / styling, e.g. data-camera. */
  data?: Record<string, string>;
}

/**
 * DialKit's segmented control (its classes and sliding pill), with icons and disabled
 * options. Arrow keys move and select (wrapping), Home/End jump; one tab stop.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
  ...rest
}: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange(v: T): void;
  className?: string;
} & Omit<ComponentProps<"div">, "onChange">) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const animate = useRef(false);

  const measure = useCallback(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-active="true"]');
    setPill(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  }, []);
  useLayoutEffect(measure, [value, options.length, measure]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const t = setTimeout(() => (animate.current = true), 50);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [measure]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    let next: SegOption<T> | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(i + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[data-active="true"]')?.focus());
  };

  return (
    <div
      ref={ref}
      className={cn("dialkit-segmented carc-seg", className)}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      {...rest}
    >
      {pill ? (
        <div
          className="dialkit-segmented-pill"
          style={{
            left: pill.left,
            width: pill.width,
            transition: animate.current ? "left 0.22s cubic-bezier(0.25, 1, 0.5, 1), width 0.22s cubic-bezier(0.25, 1, 0.5, 1)" : "none",
          }}
        />
      ) : null}
      {options.map((o) => {
        const active = o.value === value;
        const iconOnly = !!o.icon && !o.showLabel;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? o.label : undefined}
            title={o.title ?? (iconOnly ? o.label : undefined)}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            data-active={String(active)}
            className="dialkit-segmented-button"
            onClick={() => onChange(o.value)}
            {...Object.fromEntries(Object.entries(o.data ?? {}).map(([k, v]) => [`data-${k}`, v]))}
          >
            {o.icon}
            {iconOnly ? null : <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Label on the left, segmented on the right (DialKit's labeled-control row). */
export function SegmentedRow<T extends string | number>({
  label,
  stacked,
  testId,
  ...seg
}: {
  label: string;
  stacked?: boolean;
  testId?: string;
  value: T;
  options: SegOption<T>[];
  onChange(v: T): void;
}) {
  return (
    <div className="dialkit-labeled-control carc-seg-row" data-stacked={stacked ? "true" : undefined}>
      <span className="dialkit-labeled-control-label">{label}</span>
      <Segmented label={label} data-testid={testId} {...seg} />
    </div>
  );
}

// ── listbox select ────────────────────────────────────────────────────────

export interface SelectItem {
  value: string;
  label: string;
  hint?: string;
  /** CSS background for a swatch chip (e.g. a gradient of the style's colours). */
  swatch?: string;
  icon?: ReactNode;
  disabled?: boolean;
  badge?: string;
}

/**
 * A DialKit select row (`.dialkit-select-trigger`) whose options carry swatches or
 * icons and a hint line. Keyboard: Enter/Space/↓ opens, arrows/Home/End move, typing
 * jumps, Enter/Space picks, Escape closes; focus returns to the trigger.
 */
export function DialSelect({
  label,
  value,
  items,
  onChange,
  compact,
  testId,
  className,
}: {
  label: string;
  value: string;
  items: SelectItem[];
  onChange(v: string): void;
  /** No visible label (the label is still the accessible name). */
  compact?: boolean;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pop = popMotion(useReducedMotion());
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; above: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const theme = useDialTheme();
  const selected = items.find((i) => i.value === value);
  const typed = useRef({ text: "", at: 0 });
  // the dropdown portal exists only on the client (after hydration)
  const [portal, setPortal] = useState(false);
  useEffect(() => setPortal(true), []);

  const place = useCallback(() => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(380, window.innerHeight * 0.7, items.length * 46 + 12);
    const above = r.bottom + h + 8 > window.innerHeight && r.top > h + 8;
    const width = Math.max(r.width, compact ? 220 : r.width);
    const left = Math.min(Math.max(8, r.right - width), window.innerWidth - width - 8);
    setPos({ left, top: above ? r.top - h - 6 : r.bottom + 6, width, above });
  }, [items.length, compact]);

  const openList = useCallback(() => {
    place();
    setActive(Math.max(0, items.findIndex((i) => i.value === value)));
    setOpen(true);
  }, [place, items, value]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => list.current?.focus({ preventScroll: true }));
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) close(false);
    };
    const onMove = () => place();
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (i: number) => {
    const it = items[i];
    if (!it || it.disabled) return;
    onChange(it.value);
    close();
  };

  const move = (from: number, d: number) => {
    for (let k = 1; k <= items.length; k++) {
      const i = (from + d * k + items.length * 4) % items.length;
      if (!items[i]!.disabled) return i;
    }
    return from;
  };

  const onListKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      close(e.key === "Escape");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => move(a, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => move(a, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(move(items.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key.length === 1) {
      const now = performance.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = items.findIndex((it) => !it.disabled && it.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className={cn("dialkit-select-row", className)}>
      <button
        ref={trigger}
        type="button"
        className="dialkit-select-trigger carc-select-trigger"
        data-open={String(open)}
        data-compact={compact ? "true" : undefined}
        data-testid={testId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={compact ? `${label}: ${selected?.label ?? value}` : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            openList();
          }
        }}
      >
        {compact ? null : <span className="dialkit-select-label">{label}</span>}
        <span className="dialkit-select-right" style={compact ? { flex: 1, justifyContent: "space-between", minWidth: 0 } : undefined}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {selected?.swatch ? <span className="carc-select-swatch" style={{ background: selected.swatch }} /> : null}
            {selected?.icon ? <span style={{ display: "inline-grid", opacity: 0.75 }}>{selected.icon}</span> : null}
            <span className="dialkit-select-value">{selected?.label ?? value}</span>
          </span>
          <motion.svg
            className="dialkit-select-chevron"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: "spring", visualDuration: 0.2, bounce: 0.15 }}
            aria-hidden
          >
            <path d="M6 9.5L12 15.5L18 9.5" />
          </motion.svg>
        </span>
      </button>
      {portal
        ? createPortal(
            <div className="dialkit-root carc-dial" data-theme={theme} style={{ position: "static" }}>
              <AnimatePresence>
                {open && pos ? (
                  <motion.div
                    ref={list}
                    id={id}
                    role="listbox"
                    tabIndex={-1}
                    aria-label={label}
                    aria-activedescendant={`${id}-${active}`}
                    className="carc-select-dropdown"
                    style={{ left: pos.left, top: pos.top, width: pos.width, outline: "none", transformOrigin: pos.above ? "50% 100%" : "50% 0%" }}
                    initial={pop.initial}
                    animate={pop.animate}
                    exit={pop.exit}
                    onKeyDown={onListKey}
                  >
                    {items.map((it, i) => (
                      <div
                        key={it.value}
                        id={`${id}-${i}`}
                        role="option"
                        aria-selected={it.value === value}
                        aria-disabled={it.disabled || undefined}
                        data-index={i}
                        data-active={String(i === active)}
                        data-value={it.value}
                        className="carc-select-option"
                        onPointerEnter={() => !it.disabled && setActive(i)}
                        onClick={() => pick(i)}
                      >
                        {it.swatch ? <span className="carc-select-swatch" style={{ background: it.swatch }} /> : null}
                        {it.icon ? <span className="carc-select-icon">{it.icon}</span> : null}
                        <span className="carc-select-option-text">
                          <span className="carc-select-option-label">
                            {it.label}
                            {it.badge ? <span className="carc-tag">{it.badge}</span> : null}
                          </span>
                          {it.hint ? <span className="carc-select-option-hint">{it.hint}</span> : null}
                        </span>
                        {it.value === value ? <Check className="carc-select-check" aria-hidden /> : null}
                      </div>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
