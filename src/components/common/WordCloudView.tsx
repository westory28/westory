import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
}

// An absolute count scale keeps a word's size independent of other responses.
const wordSize = (count: number, length: number) => {
  const ceiling = length > 24 ? 40 : length > 12 ? 56 : 80;
  return Math.min(ceiling, 22 + Math.sqrt(Math.max(0, count - 1)) * 10);
};

const wordTone = (text: string) => {
  let hash = 0;
  for (const letter of text) hash = (hash * 31 + letter.codePointAt(0)!) | 0;
  return Math.abs(hash) % 5 === 0 ? "amber" : "blue";
};

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
    return Array.from(combined.values()).sort(
      (left, right) =>
        right.count - left.count || left.text.localeCompare(right.text, "ko"),
    );
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
    const captureCurrentLayout = () => {
      const list = listRef.current;
      if (!active || !list) return;
      stopAnimations();
      const origin = list.getBoundingClientRect();
      const next = new Map<string, WordFrame>();
      nodesRef.current.forEach((node, text) => {
        const label = node.querySelector<HTMLElement>(".think-word__text");
        if (!label) return;
        const bounds = node.getBoundingClientRect();
        next.set(text, {
          x: bounds.left - origin.left,
          y: bounds.top - origin.top,
          count: Number(node.dataset.count),
          fontSize: Number.parseFloat(getComputedStyle(label).fontSize),
        });
      });
      framesRef.current = next;
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
        ? new ResizeObserver(() => {
            const width = listRef.current?.clientWidth || 0;
            if (Math.abs(width - measuredWidth) < 1) return;
            measuredWidth = width;
            captureCurrentLayout();
          })
        : null;
    if (root) resizeObserver?.observe(root);
    if (document.fonts?.status === "loading")
      void document.fonts.ready.then(captureCurrentLayout);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("pointerdown", onOutsidePointer);
    return () => {
      active = false;
      stopAnimations();
      framesRef.current.clear();
      observer?.disconnect();
      resizeObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pointerdown", onOutsidePointer);
    };
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    stopAnimations();
    const origin = list.getBoundingClientRect();
    const nextFrames = new Map<string, WordFrame>();
    const changes: Array<{
      node: HTMLLIElement;
      textNode: HTMLElement;
      previous: WordFrame | undefined;
      next: WordFrame;
      index: number;
    }> = [];

    // Read all geometry before writing animations, avoiding layout thrashing.
    words.forEach((word, index) => {
      const node = nodesRef.current.get(word.text);
      const textNode = node?.querySelector<HTMLElement>(".think-word__text");
      if (!node || !textNode) return;
      const bounds = node.getBoundingClientRect();
      const next = {
        x: bounds.left - origin.left,
        y: bounds.top - origin.top,
        count: word.count,
        fontSize: Number.parseFloat(getComputedStyle(textNode).fontSize),
      };
      nextFrames.set(word.text, next);
      changes.push({
        node,
        textNode,
        next,
        previous: framesRef.current.get(word.text),
        index,
      });
    });
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

    for (const { node, textNode, previous, next, index } of changes) {
      if (!previous) {
        play(
          node,
          [
            { opacity: 0, transform: "translateY(12px) scale(0.9)" },
            { opacity: 1, transform: "translateY(0) scale(1)" },
          ],
          Math.min(index, 5) * 20,
        );
        continue;
      }
      const x = previous.x - next.x;
      const y = previous.y - next.y;
      if (Math.abs(x) + Math.abs(y) > 1) {
        play(node, [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ]);
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
  }, [animationSignature, motionEnabled]);

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
