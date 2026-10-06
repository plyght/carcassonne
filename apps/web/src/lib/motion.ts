// One open/close motion for every HUD popover and menu: it grows from its trigger
// (the caller sets transform-origin there) from 0.96 with an opacity and blur fade,
// and leaves faster than it came. No bounce and no slide; Motion animates from the
// current value, so a quick re-click reverses smoothly. Reduced motion: a plain fade.

import type { TargetAndTransition, Transition } from "motion/react";

const EASE: Transition["ease"] = [0.22, 1, 0.36, 1];

export interface PopMotion {
  initial: TargetAndTransition;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
}

export function popMotion(reduced: boolean): PopMotion {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0.16, ease: "easeOut" } },
      exit: { opacity: 0, transition: { duration: 0.1, ease: "easeOut" } },
    };
  }
  return {
    initial: { opacity: 0, scale: 0.96, filter: "blur(4px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)", transition: { duration: 0.2, ease: EASE } },
    exit: { opacity: 0, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.12, ease: "easeOut" } },
  };
}
