// Click-vs-drag for a single pointer press, shared by the 2D board (pan) and the 3D board (orbit).
//
// A press only turns into a drag once it travels past a slop radius; anything less is a tap,
// however long it was held. Hands jitter more right as the button goes down (and fingers much
// more than a mouse), so the radius depends on the pointer type and is wider for the first few
// milliseconds of the press. Pure and DOM-free so it can be unit tested.

/** Movement (CSS px) a press may wander and still count as a tap. */
export const DRAG_SLOP_PX = { mouse: 6, pen: 6, touch: 10 } as const;
/** Right after the press, the slop is this many times wider (absorbs the press "jolt"). */
export const PRESS_SETTLE_FACTOR = 2;
/** How long (ms) the wider settle slop applies. */
export const PRESS_SETTLE_MS = 120;

export function dragSlop(pointerType: string): number {
  return pointerType === "touch" ? DRAG_SLOP_PX.touch : DRAG_SLOP_PX.mouse;
}

/** Has a press that moved (dx, dy) after `elapsedMs` become a drag? */
export function exceedsSlop(dx: number, dy: number, pointerType: string, elapsedMs: number): boolean {
  const slop = dragSlop(pointerType) * (elapsedMs < PRESS_SETTLE_MS ? PRESS_SETTLE_FACTOR : 1);
  return Math.hypot(dx, dy) > slop;
}

/** The subset of a DOM PointerEvent the tracker needs. */
export interface PointerSample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  /** Pressed buttons; a mouse move with `buttons === 0` means the release was missed. */
  buttons?: number;
}

/**
 * - `press`: still within the slop (a tap so far)
 * - `drag-start`: this move crossed the slop; start panning / capture the pointer
 * - `drag`: already dragging
 * - `null`: not tracking this pointer (or the press went stale and was dropped)
 */
export type PressMove = "press" | "drag-start" | "drag" | null;

/** How a press ended: a `tap` (click), the end of a `drag`, or `null` for an untracked pointer. */
export type PressEnd = "tap" | "drag" | null;

/** Tracks one primary press from down to up. */
export class PressGesture {
  private p: { id: number; type: string; x0: number; y0: number; t0: number; dragging: boolean } | null = null;

  get active(): boolean {
    return this.p !== null;
  }

  get dragging(): boolean {
    return this.p?.dragging ?? false;
  }

  get pointerId(): number | null {
    return this.p?.id ?? null;
  }

  /** Start tracking a press. `dragging` resumes an in-progress drag (e.g. after a pinch). */
  begin(e: PointerSample, now: number, dragging = false): void {
    this.p = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, t0: now, dragging };
  }

  move(e: PointerSample, now: number): PressMove {
    const p = this.p;
    if (!p || p.id !== e.pointerId) return null;
    if (e.pointerType === "mouse" && e.buttons === 0) {
      // The button came up somewhere we never heard about: never pan a hovering mouse.
      this.p = null;
      return null;
    }
    if (p.dragging) return "drag";
    if (!exceedsSlop(e.clientX - p.x0, e.clientY - p.y0, p.type, now - p.t0)) return "press";
    p.dragging = true;
    return "drag-start";
  }

  end(e: Pick<PointerSample, "pointerId">): PressEnd {
    const p = this.p;
    if (!p || p.id !== e.pointerId) return null;
    this.p = null;
    return p.dragging ? "drag" : "tap";
  }

  cancel(): void {
    this.p = null;
  }
}
