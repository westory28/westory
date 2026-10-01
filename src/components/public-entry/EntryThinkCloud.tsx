import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { entryMaterial } from "./entryMaterial";
import { useEntryMotionEnabled } from "./EntryMotionContext";
import "./entry-think-cloud.css";

type CloudWord = {
  key: string;
  text: string;
  count: number;
  revision: number;
};
const normalizeWord = (text: string) =>
  text.trim().normalize("NFC").toLowerCase();
const initialWords = (): CloudWord[] =>
  entryMaterial.words.map((word) => ({
    ...word,
    key: normalizeWord(word.text),
    revision: 0,
  }));
const fontSize = (count: number, mobile = false) =>
  Math.min(
    mobile ? 48 : 80,
    (mobile ? 16 : 18) + Math.sqrt(count - 1) * (mobile ? 12 : 24),
  );

type WordPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
};
type CloudLayout = {
  width: number;
  height: number;
  words: Map<string, WordPosition>;
  top: number;
};
const originalWeight = new Map(
  entryMaterial.words.map((word) => [normalizeWord(word.text), word.count]),
);

function arrangeWords(
  words: CloudWord[],
  width: number,
  family: string,
  mobile: boolean,
  previous: CloudLayout | null,
): CloudLayout {
  const placed = new Map<string, WordPosition>();
  const minimumHeight = mobile ? 360 : 440;
  if (!width) return { width, height: minimumHeight, words: placed, top: 0 };
  const context = document.createElement("canvas").getContext("2d");
  const edge = 16;
  // Opposing float phases can close horizontal gaps by 6px and vertical gaps by 10px.
  const gap = mobile ? 14 : 18;
  const boxes: WordPosition[] = [];
  const candidates = [...words].sort(
    (a, b) =>
      (originalWeight.get(b.key) || 0) - (originalWeight.get(a.key) || 0),
  );
  for (const word of candidates) {
    let size = fontSize(word.count, mobile);
    if (context)
      context.font = `${word.count > 3 ? 800 : 500} ${size}px ${family}`;
    const measured =
      context?.measureText(word.text).width ||
      Array.from(word.text).length * size;
    size *= Math.min(1, (width - edge * 2) / Math.max(1, measured));
    const wordWidth = Math.min(
      width - edge * 2,
      Math.ceil(measured * (size / fontSize(word.count, mobile))),
    );
    const wordHeight = Math.ceil(size * 1.2);
    const old =
      previous?.width === width ? previous.words.get(word.key) : undefined;
    const anchorX = old ? old.x + old.width / 2 : 0;
    const anchorY = old ? old.y + old.height / 2 : 0;
    let position: WordPosition | undefined;
    // Fixed attempt budget; an exhausted search falls back below the cluster.
    for (let attempt = 0; attempt < 4000; attempt += 1) {
      const angle = attempt * 2.39996;
      const radius = Math.sqrt(attempt) * 5;
      const x = anchorX + Math.cos(angle) * radius * 1.3 - wordWidth / 2;
      const y = anchorY + Math.sin(angle) * radius * 0.8 - wordHeight / 2;
      if (x < -width / 2 + edge || x + wordWidth > width / 2 - edge) continue;
      const collision = boxes.some(
        (box) =>
          x < box.x + box.width + gap &&
          x + wordWidth + gap > box.x &&
          y < box.y + box.height + gap &&
          y + wordHeight + gap > box.y,
      );
      if (!collision) {
        position = { x, y, width: wordWidth, height: wordHeight, size };
        break;
      }
    }
    if (!position) {
      const bottom = Math.max(0, ...boxes.map((box) => box.y + box.height));
      position = {
        x: -wordWidth / 2,
        y: bottom + gap,
        width: wordWidth,
        height: wordHeight,
        size,
      };
    }
    placed.set(word.key, position);
    boxes.push(position);
  }
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const height = Math.max(minimumHeight, bottom - top + 48);
  return {
    width,
    height,
    words: placed,
    top: (height - (bottom - top)) / 2 - top,
  };
}

export default function EntryThinkCloud() {
  const motionEnabled = useEntryMotionEnabled();
  const [words, setWords] = useState(initialWords);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [entered, setEntered] = useState(false);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(
    () => !document.hidden,
  );
  const [width, setWidth] = useState(0);
  const [font, setFont] = useState({
    family: "sans-serif",
    ready: 0,
    mobile: false,
  });
  const [reset, setReset] = useState(0);
  const cloud = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const wordNodes = useRef(new Map<string, HTMLSpanElement>());
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const previousLayout = useRef<CloudLayout | null>(null);
  const inputId = useId();
  const errorId = useId();
  const layout = useMemo(
    () =>
      arrangeWords(
        words,
        width,
        font.family,
        font.mobile,
        previousLayout.current,
      ),
    [words, width, font],
  );

  useEffect(() => {
    const node = cloud.current;
    if (!node) return;
    const visibility = () => setDocumentVisible(!document.hidden);
    const measure = () => {
      setWidth(node.clientWidth);
      const family = getComputedStyle(node).fontFamily;
      const mobile = window.innerWidth < 768;
      setFont((current) =>
        current.family === family && current.mobile === mobile
          ? current
          : { ...current, family, mobile },
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    window.addEventListener("resize", measure, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) {
        measure();
        setFont((current) => ({ ...current, ready: current.ready + 1 }));
      }
    });
    if (typeof IntersectionObserver === "undefined") {
      const inspect = () => {
        const rect = node.getBoundingClientRect();
        const visible =
          rect.bottom > 80 && rect.top < window.innerHeight * 0.92;
        setInView(visible);
        if (visible) setEntered(true);
      };
      inspect();
      window.addEventListener("scroll", inspect, { passive: true });
      window.addEventListener("resize", inspect, { passive: true });
      return () => {
        active = false;
        resize.disconnect();
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", inspect);
        window.removeEventListener("resize", inspect);
        document.removeEventListener("visibilitychange", visibility);
      };
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setEntered(true);
      },
      { threshold: 0, rootMargin: "-80px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => {
      active = false;
      resize.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", visibility);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    previousLayout.current = layout;
    const reduce = window.innerHeight < 600 || !motionEnabled;
    const next = new Map<string, { x: number; y: number }>();
    wordNodes.current.forEach((node, key) => {
      if (reduce)
        node.getAnimations().forEach((animation) => animation.cancel());
      const position = { x: node.offsetLeft, y: node.offsetTop };
      const previous = positions.current.get(key);
      next.set(key, position);
      if (!entered || reduce || !previous || typeof node.animate !== "function")
        return;
      const x = previous.x - position.x;
      const y = previous.y - position.y;
      if (Math.abs(x) + Math.abs(y) < 1) return;
      node.getAnimations().forEach((animation) => animation.cancel());
      node.animate(
        [
          { transform: `translate(${x}px, ${y}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: 600, easing: "cubic-bezier(.16,1,.3,1)" },
      );
    });
    positions.current = next;
  }, [layout, entered, motionEnabled]);

  const addWord = (raw: string) => {
    const text = raw.trim().normalize("NFC");
    if (!text) return false;
    if (Array.from(text).length > 12) {
      setError("단어는 12자 이내로 입력해 주세요.");
      return false;
    }
    const key = normalizeWord(text);
    const existing = words.find((word) => word.key === key);
    if (!existing && words.length >= 30) {
      setError(
        "새 단어는 30개까지 담을 수 있습니다. 이미 있는 단어는 더할 수 있어요.",
      );
      return false;
    }
    const count = (existing?.count ?? 0) + 1;
    setWords((current) =>
      existing
        ? current.map((word) =>
            word.key === key
              ? { ...word, count: word.count + 1, revision: word.revision + 1 }
              : word,
          )
        : [...current, { key, text, count: 1, revision: 1 }],
    );
    setError("");
    setStatus(`${existing?.text || text}, ${count}개의 생각`);
    return true;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composing.current) return;
    if (addWord(draft)) {
      setDraft("");
      input.current?.focus({ preventScroll: true });
    }
  };

  return (
    <div className="entry-cloud-panel entry-think-panel">
      <div className="entry-panel-label">
        <span>실제 수업의 익명 응답</span>
        <span className="entry-live-dot" aria-hidden="true" />
      </div>
      <h3>{entryMaterial.cloudTitle}</h3>
      <div
        ref={cloud}
        className="entry-think-cloud"
        style={{ height: layout.height }}
        data-entered={entered}
        data-floating={motionEnabled && inView && documentVisible}
        role="img"
        aria-label={`익명 생각모아: ${words.map((word) => `${word.text} ${word.count}회`).join(", ")}`}
      >
        {words.map((word, index) => {
          const position = layout.words.get(word.key);
          if (!position) return null;
          const angle = index * 2.4;
          const distance = 80 + (index % 4) * 24;
          return (
            <span
              className="entry-think-word"
              key={word.key}
              ref={(node) => {
                if (node) wordNodes.current.set(word.key, node);
                else wordNodes.current.delete(word.key);
              }}
              aria-hidden="true"
              data-weight={word.count > 3 ? "strong" : "soft"}
              style={
                {
                  left: position.x + width / 2,
                  top: position.y + layout.top,
                  fontSize: position.size,
                  "--word-delay": `${(index % 8) * 40}ms`,
                  "--word-from-x": `${Math.cos(angle) * distance}px`,
                  "--word-from-y": `${Math.sin(angle) * distance}px`,
                  "--word-float-duration": `${6 + (index % 4)}s`,
                  "--word-float-delay": `${-index * 0.65}s`,
                } as CSSProperties
              }
            >
              <span
                key={`${reset}-${word.revision}`}
                className="entry-think-word-ink"
                data-revised={word.revision > 0}
              >
                <span className="entry-think-word-float">{word.text}</span>
              </span>
              {word.revision > 0 && (
                <span
                  className="entry-think-word-arrival"
                  key={`arrival-${reset}-${word.revision}`}
                >
                  {word.text}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <form className="entry-think-form" onSubmit={submit}>
        <div className="entry-think-input-label">
          <label htmlFor={inputId}>내 생각 한 단어</label>
          <span>12자 이내</span>
        </div>
        <div className="entry-think-input-row">
          <input
            ref={input}
            id={inputId}
            value={draft}
            maxLength={12}
            placeholder="예: 한글"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
            }}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (composing.current ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === 229)
              )
                event.preventDefault();
            }}
          />
          <button type="submit" disabled={!draft.trim()}>
            더하기
            <span aria-hidden="true">＋</span>
          </button>
        </div>
        {error && (
          <p className="entry-think-error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </form>
      <div className="entry-cloud-choices" aria-label="단어 더해 보기">
        {["한글", "조선", "고구려"].map((word) => (
          <button type="button" key={word} onClick={() => addWord(word)}>
            {word}
            <span>+1</span>
          </button>
        ))}
      </div>
      <div className="entry-demo-bottom">
        <p aria-live="polite" role="status">
          {status || "단어를 더해 보는 체험 · 저장되지 않습니다"}
        </p>
        {status && (
          <button
            type="button"
            onClick={() => {
              setWords(initialWords());
              setDraft("");
              setStatus("");
              setError("");
              setReset((current) => current + 1);
            }}
          >
            처음으로
          </button>
        )}
      </div>
    </div>
  );
}
