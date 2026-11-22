import { useLayoutEffect, useState, type RefObject } from "react";

/** Fit whole natural-height rows. Remember the tallest seen at this size so pages stay stable. */
export function useWisStockDisplayRows(
  panel: RefObject<HTMLDivElement | null>,
) {
  const [rows, setRows] = useState({ quotes: 1, trades: 1 });
  useLayoutEffect(() => {
    const board = panel.current!;
    const quotes = board.querySelector<HTMLElement>(
      ".wis-exchange__quote-window",
    )!;
    const trades = board.querySelector<HTMLElement>(
      ".wis-exchange__trade-window",
    )!;
    const dimensions = new Map<
      HTMLElement,
      { width: number; viewportHeight: number; row: number }
    >();
    function capacity(area: HTMLElement) {
      const list = area.querySelector<HTMLElement>(":scope > ul, :scope > ol");
      if (!list || !area.clientWidth || !area.clientHeight) return 1;
      const stored = dimensions.get(area);
      const previousMax =
        stored?.width === area.clientWidth &&
        stored.viewportHeight === board.clientHeight
          ? stored.row
          : 0;
      const tallest = Array.from(list.children).reduce(
        (height, item) => Math.max(height, item.getBoundingClientRect().height),
        previousMax,
      );
      if (!tallest) return 1;
      dimensions.set(area, {
        width: area.clientWidth,
        viewportHeight: board.clientHeight,
        row: tallest,
      });
      const frame = list.offsetHeight - list.clientHeight;
      return Math.max(1, Math.floor((area.clientHeight - frame) / tallest));
    }
    function measure() {
      const next = { quotes: capacity(quotes), trades: capacity(trades) };
      setRows((old) =>
        old.quotes === next.quotes && old.trades === next.trades ? old : next,
      );
    }
    measure();
    const observer = new ResizeObserver(measure);
    for (const area of [quotes, trades]) {
      observer.observe(area);
      const list = area.querySelector("ul, ol");
      if (list) observer.observe(list);
    }
    return () => observer.disconnect();
  }, [panel]);
  return rows;
}
