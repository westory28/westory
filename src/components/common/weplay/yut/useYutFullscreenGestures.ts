import { useEffect, type RefObject } from "react";

/** Contain mobile page panning while keeping the game's menus scrollable. */
export default function useYutFullscreenGestures(
  shellRef: RefObject<HTMLElement>,
  fullscreen: boolean,
) {
  useEffect(() => {
    if (!fullscreen) return;
    const shell = shellRef.current;
    if (!shell) return;
    let touch: { x: number; y: number } | null = null;
    const canScroll = (target: EventTarget | null, x: number, y: number) => {
      let node = target instanceof Element ? target : null;
      if (!node || !shell.contains(node)) return false;
      while (node && node !== shell) {
        const style = getComputedStyle(node);
        if (
          /auto|scroll/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight + 1 &&
          ((y < 0 && node.scrollTop > 0) ||
            (y > 0 &&
              node.scrollTop + node.clientHeight < node.scrollHeight - 1))
        )
          return true;
        if (
          /auto|scroll/.test(style.overflowX) &&
          node.scrollWidth > node.clientWidth + 1 &&
          ((x < 0 && node.scrollLeft > 0) ||
            (x > 0 &&
              node.scrollLeft + node.clientWidth < node.scrollWidth - 1))
        )
          return true;
        node = node.parentElement;
      }
      return false;
    };
    const start = (event: TouchEvent) => {
      const point = event.touches.length === 1 ? event.touches[0] : null;
      touch = point ? { x: point.clientX, y: point.clientY } : null;
    };
    const move = (event: TouchEvent) => {
      if (!touch || event.touches.length !== 1) return;
      const point = event.touches[0];
      const x = touch.x - point.clientX;
      const y = touch.y - point.clientY;
      touch = { x: point.clientX, y: point.clientY };
      // A portrait phone rotates the whole game clockwise; menus use its axes.
      const rotated = shell.classList.contains("yut-game--rotated-fullscreen");
      if (!canScroll(event.target, rotated ? y : x, rotated ? -x : y))
        event.preventDefault();
    };
    const end = () => {
      touch = null;
    };
    const wheel = (event: WheelEvent) => {
      // Preserve browser zoom and scroll only where a game panel can consume it.
      if (
        !event.ctrlKey &&
        !canScroll(event.target, event.deltaX, event.deltaY)
      )
        event.preventDefault();
    };
    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: true });
    document.addEventListener("touchcancel", end, { passive: true });
    document.addEventListener("wheel", wheel, { passive: false });
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
      document.removeEventListener("wheel", wheel);
    };
  }, [shellRef, fullscreen]);
}
