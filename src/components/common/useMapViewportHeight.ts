import { useLayoutEffect, useState, type RefObject } from "react";

/** Fit desktop maps below the real heading/filters without moving the account row. */
export function useMapViewportHeight(
  rootRef: RefObject<HTMLElement>,
  mapRef: RefObject<HTMLElement>,
  fallbackHeight: number,
) {
  const [height, setHeight] = useState(fallbackHeight);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const map = mapRef.current;
    if (!root || !map) return;
    const measure = () => {
      if (map.getBoundingClientRect().width <= 0) return;
      // Document position stays stable while the user scrolls. Measuring only
      // viewport top would grow the map and move the footer on every scroll.
      const documentTop = map.getBoundingClientRect().top + window.scrollY;
      const next = window.matchMedia("(min-width: 1024px)").matches
        ? Math.max(320, Math.floor(window.innerHeight - documentTop - 16))
        : fallbackHeight;
      setHeight((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(map);
    // Account/archive rows can change the map's position without changing its width.
    const layout = root.closest(".teacher-layout, .student-layout");
    if (layout) observer.observe(layout);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fallbackHeight, mapRef, rootRef]);

  return height;
}
