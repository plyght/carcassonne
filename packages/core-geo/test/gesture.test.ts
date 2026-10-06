import { describe, expect, test } from "bun:test";
import { DRAG_SLOP_PX, PRESS_SETTLE_MS, PressGesture, dragSlop, exceedsSlop, type PointerSample } from "../src/gesture";

const at = (x: number, y: number, pointerType = "mouse", extra: Partial<PointerSample> = {}): PointerSample => ({
  pointerId: pointerType === "touch" ? 7 : 1,
  pointerType,
  clientX: x,
  clientY: y,
  buttons: 1,
  ...extra,
});

/** Press at (100, 100), wander through `path` (each step 16 ms apart), release at the last point. */
function gesture(path: [number, number][], pointerType = "mouse") {
  const t0 = 0;
  const g = new PressGesture();
  g.begin(at(100, 100, pointerType), t0);
  const phases = path.map(([dx, dy], i) => g.move(at(100 + dx, 100 + dy, pointerType), t0 + (i + 1) * 16));
  const [lx, ly] = path.at(-1) ?? [0, 0];
  return { phases, end: g.end(at(100 + lx, 100 + ly, pointerType)), g };
}

describe("drag slop", () => {
  test("is ~6px for mouse and pen, ~10px for touch", () => {
    expect(dragSlop("mouse")).toBe(DRAG_SLOP_PX.mouse);
    expect(dragSlop("pen")).toBe(DRAG_SLOP_PX.pen);
    expect(dragSlop("touch")).toBe(DRAG_SLOP_PX.touch);
    expect(DRAG_SLOP_PX.mouse).toBe(6);
    expect(DRAG_SLOP_PX.touch).toBe(10);
  });

  test("is wider right after the press, then settles", () => {
    expect(exceedsSlop(9, 0, "mouse", 10)).toBe(false);
    expect(exceedsSlop(9, 0, "mouse", PRESS_SETTLE_MS + 1)).toBe(true);
    expect(exceedsSlop(6, 0, "mouse", 1000)).toBe(false);
    expect(exceedsSlop(9, 0, "touch", 1000)).toBe(false);
    expect(exceedsSlop(11, 0, "touch", 1000)).toBe(true);
  });
});

describe("PressGesture", () => {
  test("a press with 2-4px of jitter is a tap, never a drag", () => {
    for (const path of [
      [[2, 1], [3, 2]],
      [[-2, 3], [-4, 1]],
      [[4, 0], [1, -3], [4, 4]],
    ] as [number, number][][]) {
      const { phases, end } = gesture(path);
      expect(phases.every((p) => p === "press")).toBe(true);
      expect(end).toBe("tap");
    }
  });

  test("a slow press that wobbles within the slop is still a tap", () => {
    const g = new PressGesture();
    g.begin(at(100, 100), 0);
    expect(g.move(at(105, 103), 2000)).toBe("press");
    expect(g.end(at(105, 103))).toBe("tap");
  });

  test("a finger can wobble ~8px and still tap", () => {
    const { phases, end } = gesture([[5, 4], [7, 5], [6, -5]], "touch");
    expect(phases.every((p) => p === "press")).toBe(true);
    expect(end).toBe("tap");
  });

  test("moving past the slop starts a drag once, and the release is not a tap", () => {
    const g = new PressGesture();
    g.begin(at(100, 100), 0);
    const t = PRESS_SETTLE_MS;
    expect(g.move(at(103, 100), t + 10)).toBe("press");
    expect(g.move(at(110, 100), t + 20)).toBe("drag-start");
    expect(g.move(at(130, 100), t + 30)).toBe("drag");
    expect(g.move(at(103, 101), t + 40)).toBe("drag"); // coming back near the start stays a drag
    expect(g.end(at(103, 101))).toBe("drag");
  });

  test("a fast big flick drags even inside the settle window", () => {
    const g = new PressGesture();
    g.begin(at(100, 100), 0);
    expect(g.move(at(130, 100), 8)).toBe("drag-start");
  });

  test("a hovering mouse (no buttons) drops a press whose release was missed", () => {
    const g = new PressGesture();
    g.begin(at(100, 100), 0);
    // The release landed off the board; the next thing we hear is a plain hover move.
    expect(g.move(at(160, 140, "mouse", { buttons: 0 }), 500)).toBeNull();
    expect(g.active).toBe(false);
    expect(g.move(at(220, 180), 520)).toBeNull();
  });

  test("ignores other pointers and resets on cancel", () => {
    const g = new PressGesture();
    g.begin(at(100, 100), 0);
    expect(g.move({ ...at(200, 200), pointerId: 99 }, 400)).toBeNull();
    expect(g.end({ pointerId: 99 })).toBeNull();
    g.cancel();
    expect(g.end(at(100, 100))).toBeNull();
  });

  test("a resumed drag (finger left after a pinch) never taps", () => {
    const g = new PressGesture();
    g.begin(at(100, 100, "touch"), 0, true);
    expect(g.move(at(101, 100, "touch"), 10)).toBe("drag");
    expect(g.end(at(101, 100, "touch"))).toBe("drag");
  });
});
