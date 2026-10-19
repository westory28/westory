import { useEffect, useRef, type RefObject } from "react";

const controls =
  'button, a[href], input, select, textarea, [role="button"], [role="switch"], [contenteditable="true"]';
const overlays =
  'dialog[open], [aria-modal="true"], [data-floating-launcher-obstacle="true"], .fixed.inset-0';

/** Auxiliary launchers yield to dialogs and the page controls underneath them. */
export function useFloatingLauncherVisibility(
  ref: RefObject<HTMLButtonElement>,
  enabled: boolean,
  panelOpen = false,
) {
  const pendingFocus = useRef(false);
  const remeasure = useRef<(() => void) | null>(null);
  useEffect(() => {
    const launcher = ref.current;
    if (!enabled || !launcher) {
      pendingFocus.current = false;
      return;
    }
    let frame = 0;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        element.getClientRects().length > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        style.pointerEvents !== "none"
      );
    };
    const measure = () => {
      frame = 0;
      const rect = launcher.getBoundingClientRect();
      const pageLocked = [document.body, document.documentElement].some(
        (element) => getComputedStyle(element).overflowY === "hidden",
      );
      const blocked =
        panelOpen ||
        Boolean(document.fullscreenElement) ||
        pageLocked ||
        Array.from(document.querySelectorAll(overlays)).some(
          (element) =>
            !element.contains(launcher) &&
            !element.closest("[data-patch-memo-root]") &&
            visible(element),
        );
      const overlaps =
        !blocked &&
        Array.from(document.querySelectorAll<HTMLElement>(controls)).some(
          (control) => {
            if (
              control === launcher ||
              launcher.contains(control) ||
              control.contains(launcher)
            )
              return false;
            const other = control.getBoundingClientRect();
            const left = Math.max(rect.left, other.left);
            const right = Math.min(rect.right, other.right);
            const top = Math.max(rect.top, other.top);
            const bottom = Math.min(rect.bottom, other.bottom);
            if (left >= right || top >= bottom) return false;
            if (!visible(control)) return false;
            // Ignore controls covered by another surface behind the launcher.
            const hit = document
              .elementsFromPoint((left + right) / 2, (top + bottom) / 2)
              .find((element) => !launcher.contains(element));
            return Boolean(hit && control.contains(hit));
          },
        );
      const obscured = blocked || overlaps;
      if (launcher.hasAttribute("data-launcher-obscured") !== obscured) {
        if (obscured) launcher.setAttribute("data-launcher-obscured", "");
        else launcher.removeAttribute("data-launcher-obscured");
      }
      if (!obscured && pendingFocus.current) {
        pendingFocus.current = false;
        launcher.focus({ preventScroll: true });
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    remeasure.current = schedule;
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "class",
        "style",
        "open",
        "hidden",
        "aria-modal",
        "data-floating-launcher-obstacle",
      ],
    });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("fullscreenchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
      remeasure.current = null;
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("fullscreenchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      launcher.removeAttribute("data-launcher-obscured");
    };
  }, [ref, enabled, panelOpen]);

  // Dialogs close after the React state update. Restore focus only once their
  // scroll lock and modal layer have released the launcher.
  return () => {
    pendingFocus.current = true;
    remeasure.current?.();
  };
}
