// Types for the core/anim timeline JSON (packages/core/src/anim/README.md).
import type { FeatureKind, FigureKind, PlayerIndex, TileId } from "@carcassonne/protocol";

export type AnimStyle = "realistic" | "cartoon" | "reduced";

export interface AnimOptions {
  /** realistic (default), cartoon (overshoot / squash), reduced (reduced motion: instant). */
  style?: AnimStyle;
  /** Playback speed multiplier (default 1). */
  speed?: number;
}

export type EasingId =
  | "linear"
  | "step"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "easeInCubic"
  | "easeOutBack"
  | "easeOutBounce"
  | "easeOutElastic";

export type ClipKind =
  | "cameraFocus"
  | "tileDrop"
  | "lifeRise"
  | "wallExtrude"
  | "tileDiscard"
  | "meepleHopIn"
  | "meepleHopOut"
  | "featurePulse"
  | "scorePopup"
  | "gameEnd";

export type AnimTarget =
  | { type: "tile"; x: number; y: number; tile: TileId; rot: 0 | 1 | 2 | 3 }
  | { type: "hand"; tile: TileId }
  | { type: "figure"; x: number; y: number; feature: number; player: PlayerIndex; figure: FigureKind }
  | { type: "feature"; kind: FeatureKind; cells: [number, number][] }
  /** World point in board units: cell (x, y) spans [x, x+1] x [y, y+1]. */
  | { type: "point"; x: number; y: number }
  | { type: "board" };

export interface ClipParams {
  /** tileDrop: drop height (tile units). */
  fromHeight?: number;
  /** cartoon: squash amount on landing / overshoot factor. */
  squash?: number;
  overshoot?: number;
  /** meepleHop*: peak hop height. */
  hopHeight?: number;
  /** scorePopup */
  points?: number;
  winners?: PlayerIndex[];
  final?: boolean;
  /** cameraFocus: board-space centre and half extent to frame; priority 0..1. */
  cx?: number;
  cy?: number;
  extent?: number;
  priority?: number;
  /** gameEnd */
  scores?: number[];
}

export interface AnimClip {
  /** Stable unique key: `e<eventIndex>:<kind>[:<n>]`. */
  key: string;
  kind: ClipKind;
  /** Seconds from timeline start. */
  start: number;
  /** Seconds; 0 = apply the end state instantly. */
  duration: number;
  easing: EasingId;
  /** Index of the engine event that produced the clip. */
  event: number;
  target: AnimTarget;
  params?: ClipParams;
}

export interface AnimTimeline {
  version: 1;
  style: AnimStyle;
  /** End time of the last clip (seconds). */
  duration: number;
  clips: AnimClip[];
}

/** Reference easing implementations (t in 0..1) matching the ids above. */
export const EASINGS: Record<EasingId, (t: number) => number> = {
  linear: (t) => t,
  step: (t) => (t > 0 ? 1 : 0),
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInCubic: (t) => t * t * t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  easeOutElastic: (t) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
};

/** Progress (0..1, eased) of a clip at time `time`. */
export function clipProgress(clip: AnimClip, time: number): number {
  if (time < clip.start) return 0;
  if (clip.duration <= 0) return 1;
  const t = Math.min(1, (time - clip.start) / clip.duration);
  return EASINGS[clip.easing](t);
}
