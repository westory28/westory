import {
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type React from "react";

export interface MatchingConnection {
  id: string;
  leftKey: string;
  rightKey: string;
  active?: boolean;
}

interface MatchingConnectionLine extends MatchingConnection {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface MatchingConnectionLinesProps {
  containerRef: RefObject<HTMLElement>;
  leftRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  rightRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  connections: MatchingConnection[];
}

const getConnectionLine = (
  containerRect: DOMRect,
  leftRect: DOMRect,
  rightRect: DOMRect,
) => {
  const isSideBySide = rightRect.left >= leftRect.right - 8;
  if (isSideBySide) {
    return {
      x1: leftRect.right - containerRect.left,
      y1: leftRect.top + leftRect.height / 2 - containerRect.top,
      x2: rightRect.left - containerRect.left,
      y2: rightRect.top + rightRect.height / 2 - containerRect.top,
    };
  }

  return {
    x1: leftRect.left + leftRect.width / 2 - containerRect.left,
    y1: leftRect.bottom - containerRect.top,
    x2: rightRect.left + rightRect.width / 2 - containerRect.left,
    y2: rightRect.top - containerRect.top,
  };
};

const getMatchingElement = (
  container: HTMLElement,
  refs: MutableRefObject<Record<string, HTMLElement | null>>,
  side: "left" | "right",
  key: string,
) =>
  refs.current[key] ||
  Array.from(
    container.querySelectorAll<HTMLElement>(`[data-matching-${side}-key]`),
  ).find(
    (element) => element.getAttribute(`data-matching-${side}-key`) === key,
  ) ||
  null;

const MatchingConnectionLines: React.FC<MatchingConnectionLinesProps> = ({
  containerRef,
  leftRefs,
  rightRefs,
  connections,
}) => {
  const [lines, setLines] = useState<MatchingConnectionLine[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current || svgRef.current?.parentElement;
    if (!container || connections.length === 0) {
      setLines([]);
      return;
    }

    let frame = 0;
    const timers: number[] = [];
    const updateLines = () => {
      const containerRect = container.getBoundingClientRect();
      const nextLines = connections.flatMap((connection) => {
        const left = getMatchingElement(
          container,
          leftRefs,
          "left",
          connection.leftKey,
        );
        const right = getMatchingElement(
          container,
          rightRefs,
          "right",
          connection.rightKey,
        );
        if (!left || !right) return [];
        return [
          {
            ...connection,
            ...getConnectionLine(
              containerRect,
              left.getBoundingClientRect(),
              right.getBoundingClientRect(),
            ),
          },
        ];
      });
      setLines(nextLines);
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateLines);
    };

    const observer = new ResizeObserver(scheduleUpdate);
    const observed = new Set<HTMLElement>([container]);
    connections.forEach((connection) => {
      const left = getMatchingElement(
        container,
        leftRefs,
        "left",
        connection.leftKey,
      );
      const right = getMatchingElement(
        container,
        rightRefs,
        "right",
        connection.rightKey,
      );
      if (left) observed.add(left);
      if (right) observed.add(right);
    });
    observed.forEach((element) => observer.observe(element));
    window.addEventListener("resize", scheduleUpdate);
    scheduleUpdate();
    timers.push(window.setTimeout(updateLines, 0));
    timers.push(window.setTimeout(updateLines, 120));

    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [connections, containerRef, leftRefs, rightRefs]);

  if (connections.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
    >
      {lines.map((line) => (
        <g key={line.id}>
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke={line.active ? "#2563eb" : "#60a5fa"}
            strokeDasharray="6 5"
            strokeLinecap="round"
            strokeWidth={line.active ? 3 : 2.5}
          />
          <circle
            cx={line.x1}
            cy={line.y1}
            r="3.5"
            fill={line.active ? "#2563eb" : "#60a5fa"}
          />
          <circle
            cx={line.x2}
            cy={line.y2}
            r="3.5"
            fill={line.active ? "#2563eb" : "#60a5fa"}
          />
        </g>
      ))}
    </svg>
  );
};

export default MatchingConnectionLines;
