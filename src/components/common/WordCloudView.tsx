import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { placeCloudWords, wordHash, type PlacedWord } from "./wordCloudLayout";
import "./wordCloudView.css";

interface WordCloudEntry {
  text: string;
  count: number;
  submitters?: string[];
}

interface WordCloudViewProps {
  entries: WordCloudEntry[];
  className?: string;
  showSubmitters?: boolean;
  variant?: "default" | "modal";
  motionEnabled?: boolean;
  batchStart?: number;
  totalEntries?: number;
}

interface WordFrame {
  x: number;
  y: number;
  count: number;
  fontSize: number;
  order: number;
}

// An absolute count scale keeps a word's size independent of other responses.
const wordSize = (count: number, length: number) => {
  const ceiling = length > 24 ? 40 : length > 12 ? 56 : 80;
  // Preserve growth across the complete server-supported 1–200 response range.
  // A hard clamp after 35 responses would make frequent words stop growing.
  return (
    22 +
    (ceiling - 22) *
      (Math.log(Math.min(200, Math.max(1, count))) / Math.log(200))
  );
};

// Blue → violet → rose → orange, all readable on the pale board.
const wordColors = [
  "#2452d6",
  "#1268b2",
  "#6654bf",
  "#8d43a7",
  "#aa3b80",
  "#bf3c5d",
  "#c44931",
  "#ba510f",
  "#a86508",
];
const wordTone = (text: string) =>
  wordColors[wordHash(text) % wordColors.length];

const WordCloudView: React.FC<WordCloudViewProps> = ({
  entries,
  className = "",
  showSubmitters = false,
  variant = "default",
  motionEnabled = true,
}) => {
  const detailId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const nodesRef = useRef(new Map<string, HTMLLIElement>());
  const framesRef = useRef(new Map<string, WordFrame>());
  const animationsRef = useRef(new Set<Animation>());
  const inViewRef = useRef(true);
  const placementRef = useRef({
    width: 0,
    words: new Map<string, PlacedWord>(),
  });
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [hoveredText, setHoveredText] = useState("");
  const [focusedText, setFocusedText] = useState("");
  const [pinnedText, setPinnedText] = useState("");
  const [dismissedText, setDismissedText] = useState("");

  const words = useMemo(() => {
    const combined = new Map<string, WordCloudEntry>();
    for (const entry of entries) {
      const text = String(entry.text || "").trim();
      const count = Math.floor(Number(entry.count));
      if (!text || !Number.isFinite(count) || count < 1) continue;
      const previous = combined.get(text);
      combined.set(text, {
        text,
        count: (previous?.count || 0) + count,
        submitters: showSubmitters
          ? Array.from(
              new Set(
                [...(previous?.submitters || []), ...(entry.submitters || [])]
                  .map((name) => name.trim())
                  .filter(Boolean),
              ),
            )
          : undefined,
      });
    }
    return Array.from(combined.values()).sort((left, right) => {
      const leftOrder = framesRef.current.get(left.text)?.order ?? Infinity;
      const rightOrder = framesRef.current.get(right.text)?.order ?? Infinity;
      return (
        leftOrder - rightOrder ||
        right.count - left.count ||
        left.text.localeCompare(right.text, "ko")
      );
    });
  }, [entries, showSubmitters]);

  // A refreshed response object with unchanged content never replays effects.
  const animationSignature = JSON.stringify(
    words.map(({ text, count }) => [text, count]),
  );
  const activeText = hoveredText || focusedText || pinnedText;
  const selectedText = activeText === dismissedText ? "" : activeText;
  const selectedWord = words.find((word) => word.text === selectedText);

  const stopAnimations = () => {
    for (const animation of animationsRef.current) animation.cancel();
    animationsRef.current.clear();
  };

  useEffect(() => {
    const root = rootRef.current;
    let active = true;
    let measuredWidth = listRef.current?.clientWidth || 0;
    let measuredMinHeight = listRef.current
      ? getComputedStyle(listRef.current).minHeight
      : "";
    const refreshLayout = () => {
      if (active) setLayoutVersion((version) => version + 1);
    };
    const refreshDimensions = () => {
      const list = listRef.current;
      if (!list) return;
      const width = list.clientWidth;
      const minHeight = getComputedStyle(list).minHeight;
      if (
        Math.abs(width - measuredWidth) < 1 &&
        minHeight === measuredMinHeight
      )
        return;
      measuredWidth = width;
      measuredMinHeight = minHeight;
      refreshLayout();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopAnimations();
    };
    const onOutsidePointer = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) {
        setPinnedText("");
        setFocusedText("");
        setHoveredText("");
      }
    };
    const observer =
      root && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => {
            inViewRef.current = entry.isIntersecting;
            if (!entry.isIntersecting) stopAnimations();
          })
        : null;
    if (root) observer?.observe(root);
    const resizeObserver =
      root && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(refreshDimensions)
        : null;
    if (root) resizeObserver?.observe(root);
    if (document.fonts?.status === "loading")
      void document.fonts.ready.then(refreshLayout);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", onOutsidePointer);
    window.addEventListener("resize", refreshDimensions);
    return () => {
      active = false;
      stopAnimations();
      framesRef.current.clear();
      placementRef.current.words.clear();
      observer?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onOutsidePointer);
      window.removeEventListener("resize", refreshDimensions);
    };
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    stopAnimations();
    if (!words.length) {
      framesRef.current.clear();
      placementRef.current.words.clear();
      list.style.height = "";
      return;
    }
    const width = list.clientWidth;
    if (!width) return;
    const minHeight =
      Number.parseFloat(getComputedStyle(list).minHeight) || 360;
    // Read all sizes before positioning any node. Font and viewport changes
    // trigger this same local pass; response listeners are never touched.
    const measurements = words.flatMap((word) => {
      const node = nodesRef.current.get(word.text);
      const textNode = node?.querySelector<HTMLElement>(".think-word__text");
      if (!node || !textNode) return [];
      const bounds = node.getBoundingClientRect();
      return [
        {
          word,
          node,
          textNode,
          width: bounds.width,
          height: bounds.height,
          fontSize: Number.parseFloat(getComputedStyle(textNode).fontSize),
        },
      ];
    });
    const layout = placeCloudWords(
      measurements.map(({ word, width, height }) => ({
        text: word.text,
        width,
        height,
      })),
      width,
      minHeight,
      placementRef.current.width === width
        ? placementRef.current.words
        : undefined,
    );
    placementRef.current = {
      width,
      words: new Map(layout.words.map((box) => [box.text, box])),
    };
    const origin = list.getBoundingClientRect();
    const nextFrames = new Map<string, WordFrame>();
    const changes = measurements.map(
      ({ word, node, textNode, fontSize }, index) => {
        const box = layout.words[index];
        const next = {
          x: width / 2 + box.x - box.width / 2,
          y: layout.height / 2 + box.y - box.height / 2,
          count: word.count,
          fontSize,
          order: index,
        };
        nextFrames.set(word.text, next);
        return {
          node,
          textNode,
          next,
          previous: framesRef.current.get(word.text),
          box,
        };
      },
    );
    list.style.height = `${layout.height}px`;
    list.dataset.layout = "radial";
    for (const { node, next } of changes) {
      node.style.left = `${next.x}px`;
      node.style.top = `${next.y}px`;
    }
    framesRef.current = nextFrames;
    if (
      !motionEnabled ||
      !inViewRef.current ||
      document.visibilityState === "hidden" ||
      origin.bottom <= 0 ||
      origin.top >= window.innerHeight
    )
      return;

    const play = (element: HTMLElement, keyframes: Keyframe[], delay = 0) => {
      if (typeof element.animate !== "function") return;
      const animation = element.animate(keyframes, {
        duration: 300,
        easing: "ease-out",
        delay,
        fill: "backwards",
      });
      animationsRef.current.add(animation);
      const release = () => animationsRef.current.delete(animation);
      animation.onfinish = release;
      animation.oncancel = release;
    };

    let entering = 0;
    for (const { node, textNode, previous, next, box } of changes) {
      if (!previous) {
        play(
          node,
          [
            {
              opacity: 0,
              transform: `translate(${-box.x}px, ${-box.y}px) scale(0.55)`,
            },
            { opacity: 1, transform: "translate(0, 0) scale(1)" },
          ],
          Math.min(entering++, 8) * 24,
        );
        continue;
      }
      const x = previous.x - next.x;
      const y = previous.y - next.y;
      if (Math.abs(x) + Math.abs(y) > 1) {
        // A straight path can cross unrelated words in a dense board.
        // Settle the reserved boxes immediately and reveal the moved word.
        play(node, [{ opacity: 0.35 }, { opacity: 1 }]);
      }
      if (next.count > previous.count) {
        const scale = Math.min(0.96, previous.fontSize / next.fontSize);
        play(textNode, [
          { transform: `scale(${scale})`, opacity: 0.65 },
          { transform: "scale(1.035)", opacity: 1, offset: 0.7 },
          { transform: "scale(1)", opacity: 1 },
        ]);
        const counter = node.querySelector<HTMLElement>(".think-word__count");
        if (counter)
          play(counter, [
            { transform: "translateY(6px) scale(0.8)", opacity: 0 },
            { transform: "translateY(0) scale(1)", opacity: 1 },
          ]);
      }
    }
    // `words` is represented by the content signature. Reduced motion stays
    // enabled for this learning interaction by the user's 2026-11-14 request.
  }, [animationSignature, motionEnabled, layoutVersion]);

  useEffect(() => {
    if (pinnedText && !words.some((word) => word.text === pinnedText))
      setPinnedText("");
  }, [animationSignature, pinnedText, words]);

  return (
    <div
      ref={rootRef}
      className={`think-word-board think-word-board--${variant} ${className}`}
      data-motion={motionEnabled ? "on" : "off"}
      data-testid="think-word-board"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDismissedText(activeText);
          setPinnedText("");
          setFocusedText("");
          setHoveredText("");
        }
      }}
    >
      <ul
        ref={listRef}
        className="think-word-board__words"
        aria-label="모인 생각"
      >
        {words.map((word) => (
          <li
            key={word.text}
            ref={(node) => {
              if (node) nodesRef.current.set(word.text, node);
              else nodesRef.current.delete(word.text);
            }}
            className="think-word"
            data-word={word.text}
            data-count={word.count}
            data-tone={wordTone(word.text)}
            data-weight={word.count > 1 ? "strong" : "soft"}
            style={
              {
                "--think-word-color": wordTone(word.text),
                "--think-word-size": wordSize(
                  word.count,
                  [...word.text].length,
                ),
              } as React.CSSProperties
            }
          >
            <button
              type="button"
              className="think-word__button"
              aria-label={`${word.text}, 응답 ${word.count}개`}
              aria-expanded={selectedText === word.text}
              aria-controls={selectedText === word.text ? detailId : undefined}
              onMouseEnter={() => {
                setDismissedText("");
                setHoveredText(word.text);
              }}
              onMouseLeave={() => setHoveredText("")}
              onFocus={() => {
                setDismissedText("");
                setFocusedText(word.text);
              }}
              onBlur={() => setFocusedText("")}
              onClick={() => {
                const closing = pinnedText === word.text;
                setPinnedText(closing ? "" : word.text);
                setDismissedText(closing ? word.text : "");
              }}
            >
              <span className="think-word__text">{word.text}</span>
              {word.count > 1 && (
                <span className="think-word__count" aria-hidden="true">
                  {word.count}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {words.length === 0 && (
        <div className="think-word-board__empty">
          <span className="think-word-board__empty-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <path d="M12 10h24a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H23l-9 6v-6h-2a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z" />
              <path d="M16 21h16M16 27h10" />
            </svg>
          </span>
          <p>첫 번째 생각을 기다리고 있어요</p>
        </div>
      )}
      {selectedWord && (
        <div id={detailId} className="think-word-board__detail" role="status">
          <strong>{selectedWord.text}</strong>
          <span>응답 {selectedWord.count}개</span>
          {showSubmitters && !!selectedWord.submitters?.length && (
            <span className="think-word-board__names">
              {selectedWord.submitters.join(" · ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default WordCloudView;
