# core/anim: presentation timeline

`anim_timeline(events, options)` turns engine events into keyed animation clips. The events are the `EngineEvent[]` from `packages/protocol/src/engine.ts`, or a whole `ApplyResult {ok, events}`. Every renderer plays the same timeline: web, desktop, 2D and 3D. Styles only choose the easing and intensity preset.

The timeline is pure data and deterministic: the same input gives the same bytes. Times are printed with exactly 3 decimals. TS types are in `packages/core-geo/src/anim.ts` (`AnimTimeline`, `AnimClip`, `EASINGS`, `clipProgress`).

## Options

```jsonc
{ "style": "realistic" | "cartoon" | "reduced",   // default realistic
  "speed": 1.0 }                                  // playback multiplier, 0.05..20
```

| Style | Behaviour |
|---|---|
| `realistic` | Ease-out cubic motion, modest drop height |
| `cartoon` | Overshoot and bounce easings (`easeOutBack`, `easeOutBounce`, `easeOutElastic`), squash on landing (`params.squash`, `params.overshoot`), higher hops |
| `reduced` | Reduced motion. Every motion clip has `duration: 0` and `easing: "step"`, and the cursor never advances, so state changes apply instantly. `scorePopup` (1 s) and `gameEnd` (2 s) keep a hold time with `step` easing, so they stay readable without moving |

## Output

```jsonc
{
  "version": 1,
  "style": "realistic",
  "duration": 2.35,               // end of the last clip, seconds
  "clips": [                      // in event order (not sorted by start)
    {
      "key": "e1:tileDrop",       // unique: e<eventIndex>:<kind>[:<n>]
      "kind": "tileDrop",
      "event": 1,                 // index of the source event
      "start": 0.000,             // seconds
      "duration": 0.350,          // 0 = apply end state instantly
      "easing": "easeOutCubic",   // linear|step|easeOutCubic|easeInOutCubic|easeInCubic|easeOutBack|easeOutBounce|easeOutElastic
      "target": { "type": "tile", "x": 1, "y": 0, "rot": 2, "tile": "D" },
      "params": { "fromHeight": 0.6 }
    }
  ]
}
```

### Targets

| `type` | Fields | Meaning |
|---|---|---|
| `tile` | `x, y, rot, tile` | A placed tile (board cell) |
| `hand` | `tile` | The tile in the current player's hand (discard) |
| `figure` | `x, y, feature, player, figure` | A meeple or abbot. Resolve its position from the tile's geo anchor (`ANC3`/`FEAT`). `feature: -1` for an abbot recall |
| `feature` | `kind, cells: [[x,y]...]` | A scored feature (outline pulse) |
| `point` | `x, y` | Board-space point; cell `(x, y)` spans `[x, x+1] × [y, y+1]` |
| `board` | | The whole board |

### Clips per event

| Event | Clips |
|---|---|
| `tilePlaced` | `cameraFocus` (priority 0.3), `tileDrop` (`fromHeight`, cartoon `squash`), `lifeRise` after the drop, `wallExtrude` 0.1 s later (only if the tile has a city; unknown ids always get one) |
| `figurePlaced` | `meepleHopIn` (`hopHeight`) |
| `featureScored` | `cameraFocus` (frames the cells' bounding box: `cx, cy, extent`; priority 0.4 + points/20; skipped for final scoring), `featurePulse`, `scorePopup` at the cells' centroid (`points, winners, final`), and one staggered `meepleHopOut` per returned figure (`:<n>` suffix). Final scoring runs at 0.6× pace |
| `abbotRecalled` | `meepleHopOut` (abbot), `scorePopup` |
| `tileDiscarded` | `tileDiscard` |
| `gameEnded` | `cameraFocus` (board, priority 1), `gameEnd` (`scores`) |
| `turnStarted` | None |

`cameraFocus` clips are **hints**. The Cinematic camera follows them (prefer higher `priority`), and the other cameras may ignore them.

Base durations (realistic, seconds):

| Clip | Duration |
|---|---|
| focus | 0.6 |
| drop | 0.35 |
| rise | 0.5 |
| walls | 0.45 |
| hop in | 0.4 |
| hop out | 0.45 |
| pulse | 0.8 |
| popup | 1.2 |
| discard | 0.4 |
| game end | 2.0 |

A sequencing cursor advances after each event, so consecutive events overlap slightly. Everything is divided by `speed`.
