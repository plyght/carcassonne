"use client";

// In-game "Table" panel: a compact DialKit popover for board style, camera, view
// nudging, 3D quality, motion and sound. Sections are DialKit Folders (collapsible);
// the panel springs open from the HUD button and closes on Escape or a click outside.

import { useEffect, useRef, type RefObject } from "react";

import { Folder } from "dialkit";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

import type { BoardCommands, CameraMode } from "@carcassonne/render-classic";

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
  const panel = useRef<HTMLDivElement>(null);

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
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } }}
          transition={{ type: "spring", visualDuration: 0.26, bounce: 0.18 }}
        >
          <DialSurface>
            <div className="carc-dial-panel">
              <div className="carc-dial-header">
                <div>
                  <div className="carc-dial-title">Table</div>
                  <div className="carc-dial-sub">Only you see your style. Switches live.</div>
                </div>
                <DialIconButton label="Close" variant="ghost" onClick={onClose}>
                  <X className="size-[18px]" />
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
