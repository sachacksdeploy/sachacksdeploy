import { useEffect, useMemo, useRef } from "react";
import type { FocusEvent, MouseEvent, TouchEvent } from "react";
import { triggerPageGlitch } from "@/utils/effects";

/**
 * Shared activation props for every register-style button.
 *
 * The glitch used to be mouse-only. This makes it input-agnostic:
 *  - mouse: enter / leave
 *  - keyboard: focus-visible (Tab / Shift+Tab) / blur
 *  - touch: touchstart activates, touchend/cancel releases after a short hold
 *    so tapping still shows the effect (there is no "leave" on touch).
 *
 * An internal `active` latch dedupes the synthetic mouse events browsers emit
 * after a tap, so a single interaction never fires the burst twice.
 */
export function useGlitchTriggers(onToggle?: (on: boolean) => void) {
  const activeRef = useRef(false);
  const releaseRef = useRef<number | undefined>(undefined);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  useEffect(
    () => () => {
      window.clearTimeout(releaseRef.current);
      if (activeRef.current) {
        activeRef.current = false;
        toggleRef.current?.(false);
      }
    },
    [],
  );

  return useMemo(() => {
    const activate = () => {
      window.clearTimeout(releaseRef.current);
      if (activeRef.current) return;
      activeRef.current = true;
      toggleRef.current?.(true);
      triggerPageGlitch();
    };
    const release = () => {
      window.clearTimeout(releaseRef.current);
      if (!activeRef.current) return;
      activeRef.current = false;
      toggleRef.current?.(false);
    };

    return {
      onMouseEnter: () => activate(),
      onMouseLeave: (_e?: MouseEvent) => release(),
      onFocus: (e: FocusEvent<HTMLElement>) => {
        // Only keyboard focus — a click already focuses the element and the
        // mouse path handled it.
        const el = e.currentTarget;
        if (typeof el.matches === "function" && !el.matches(":focus-visible")) return;
        activate();
      },
      onBlur: () => release(),
      onTouchStart: (_e?: TouchEvent) => activate(),
      onTouchEnd: () => {
        window.clearTimeout(releaseRef.current);
        releaseRef.current = window.setTimeout(release, 900);
      },
      onTouchCancel: () => release(),
    };
  }, []);
}
