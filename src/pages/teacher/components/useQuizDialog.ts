import { useEffect, useRef, type RefObject } from "react";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";

export const useQuizDialog = (
  open: boolean,
  container: RefObject<HTMLElement>,
  onClose: () => void,
) => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const release = acquirePageScrollLock();
    container.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, a[href], summary, [tabindex="0"]',
        ) || [],
      ).filter(
        (element) =>
          !element.hasAttribute("disabled") &&
          element.getClientRects().length > 0,
      );
      const first = stops[0],
        last = stops[stops.length - 1];
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === container.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === container.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      release();
      if (previous?.isConnected) previous.focus();
    };
  }, [open, container]);
};
