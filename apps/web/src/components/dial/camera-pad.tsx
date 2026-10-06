"use client";

// Camera XY pad: DialKit's DialPad nudging the tabletop camera. The pad holds an
// offset from the framed view; each change pans the board by the delta, so a
// double-click (or Home) on the pad, which restores 0,0, pans back to where it was.

import { useRef, useState } from "react";

import { DialPad, type DialPadValue } from "dialkit";

import type { BoardCommands } from "@carcassonne/render-classic";

/** Screen pixels the board moves for the full pad range. */
const RANGE_PX = 360;

export function CameraNudgePad({ commands }: { commands: React.RefObject<BoardCommands | null> }) {
  const [value, setValue] = useState<DialPadValue>({ x: 0, y: 0 });
  const last = useRef<DialPadValue>({ x: 0, y: 0 });
  return (
    <div data-testid="camera-pad">
      <DialPad
        label="Nudge"
        value={value}
        x={[0, -1, 1, 0.01]}
        y={[0, -1, 1, 0.01]}
        labels={{ x: "X", y: "Y" }}
        onChange={(v) => {
          const dx = v.x - last.current.x;
          const dy = v.y - last.current.y;
          last.current = v;
          setValue(v);
          // pad +x → look further right (board moves left); +y → look further away
          commands.current?.pan(-dx * RANGE_PX, dy * RANGE_PX);
        }}
      />
    </div>
  );
}
