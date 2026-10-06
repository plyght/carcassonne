"use client";

// In-game "Table" panel: a compact DialKit popover for board style, camera, view
// nudging, 3D quality, motion and sound. Sections are DialKit Folders (collapsible);
// the panel springs open from the HUD button and closes on Escape or a click outside.

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Folder } from "dialkit";
import { AnimatePresence, motion } from "motion/react";
import { X } from "reicon-react";

import type { BoardCommands, CameraMode } from "@carcassonne/render-classic";

import { popMotion } from "@/lib/motion";
import { useReducedMotion } from "@/lib/settings";

import { CameraNudgePad } from "./camera-pad";
import { DialIconButton, DialSurface } from "./primitives";
import { CameraControl, MotionControl, QualityControl, SoundControls, StyleSelect } from "./table-controls";

export function TablePanel({
  open,
  onClose,
  camera,
  onCamera,
  is3d,
  commands,
  anchorRef,
}: {
  open: boolean;
  onClose(): void;
  camera: CameraMode;
  onCamera(c: CameraMode): void;
  is3d: boolean;
  commands: RefObject<BoardCommands | null>;
  /** The HUD button that toggles the panel (clicks on it don't count as "outside"). */
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const reduced = useReducedMotion();
  const pop = popMotion(reduced);
  const panel = useRef<HTMLDivElement>(null);
  // grow from the button: the origin is the anchor's centre, in the panel's own box
  const [origin, setOrigin] = useState("calc(100% - 48px) top");
  useLayoutEffect(() => {
    if (!open) return;
    const a = anchorRef.current?.getBoundingClientRect();
    const box = panel.current?.offsetParent?.getBoundingClientRect();
    if (!a || !box) return;
    setOrigin(`calc(100% - ${Math.round(box.right - (a.left + a.width / 2))}px) top`);
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (panel.current?.contains(t) || anchorRef.current?.contains(t)) return;
      // dropdowns / colour pickers portal out of the panel
      if (t.closest?.(".carc-select-dropdown, .dialkit-select-dropdown")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector(".carc-select-dropdown, .dialkit-select-dropdown")) return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => panel.current?.querySelector<HTMLElement>("button, [tabindex='0']")?.focus({ preventScroll: true }), 60);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [open, onClose, anchorRef]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={panel}
          key="table-panel"
          className="carc-hud-popover pointer-events-auto absolute top-[calc(100%+8px)] right-0 z-40"
          role="dialog"
          aria-label="Table settings"
          data-testid="table-panel"
          style={{ transformOrigin: origin }}
          initial={pop.initial}
          animate={pop.animate}
          exit={pop.exit}
        >
          <DialSurface>
            <div className="carc-dial-panel">
              <div className="carc-dial-header">
                <div>
                  <div className="carc-dial-title">Table</div>
                  <div className="carc-dial-sub">Only you see your style, and it switches live.</div>
                </div>
                <DialIconButton label="Close" variant="ghost" onClick={onClose}>
                  <X />
                </DialIconButton>
              </div>
              <Folder title="Board" defaultOpen>
                <StyleSelect />
                <CameraControl value={is3d ? camera : "top-down"} onChange={onCamera} />
              </Folder>
              {is3d ? (
                <Folder title="View" defaultOpen={false}>
                  <CameraNudgePad commands={commands} />
                </Folder>
              ) : null}
              <Folder title="Display" defaultOpen>
                <QualityControl hint={false} />
                <MotionControl />
              </Folder>
              <Folder title="Sound" defaultOpen={false}>
                <SoundControls />
              </Folder>
            </div>
          </DialSurface>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
