import { useEffect, type RefObject } from "react";
import "./quizContentProtection.css";

const isAnswerInput = (target: EventTarget | null) =>
  target instanceof Element &&
  (target.closest('textarea, [contenteditable="true"]') ||
    (target instanceof HTMLInputElement &&
      ["text", "search", "email", "url", "tel", "password", "number"].includes(
        target.type,
      )));

/** Restrict native export gestures, without changing answers or touch scrolling. */
export function useQuizContentProtection(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const guard = (event: Event) => {
      const root = rootRef.current;
      if (!root || isAnswerInput(event.target)) return;
      const inside =
        event.target instanceof Node && root.contains(event.target);
      let includesContent = false;
      // A copy command can target the document after a selection starts outside
      // the question. Keep that route covered without blocking other page text.
      if (event.type === "copy" || event.type === "cut") {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          for (let index = 0; index < selection.rangeCount; index += 1) {
            if (selection.getRangeAt(index).intersectsNode(root)) {
              includesContent = true;
              break;
            }
          }
        }
      }
      if (inside || includesContent) event.preventDefault();
    };
    const events = ["copy", "cut", "dragstart", "selectstart", "contextmenu"];
    events.forEach((type) => document.addEventListener(type, guard, true));
    return () => {
      events.forEach((type) => document.removeEventListener(type, guard, true));
    };
  }, [rootRef]);
}
