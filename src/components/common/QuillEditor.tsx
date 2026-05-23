import React, { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    Quill?: any;
  }
}

interface QuillEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  toolbar?: any[];
}

const QUILL_SCRIPT_URL = "https://cdn.quilljs.com/1.3.6/quill.js";
const QUILL_STYLE_URL = "https://cdn.quilljs.com/1.3.6/quill.snow.css";
const QUILL_SCRIPT_ID = "westory-quill-script";
const QUILL_STYLE_ID = "westory-quill-style";
const QUILL_LOAD_TIMEOUT_MS = 6000;

const DEFAULT_TOOLBAR = [
  [{ size: ["small", false, "large", "huge"] }],
  ["bold", "italic", "underline"],
  [{ align: [] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["clean"],
];

const normalize = (html: string) => (html || "").replace(/\s+/g, " ").trim();

let quillLoadPromise: Promise<void> | null = null;

const loadQuillStyle = () =>
  new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      resolve();
      return;
    }

    const existing = document.getElementById(QUILL_STYLE_ID);
    if (existing) {
      resolve();
      return;
    }

    const link = document.createElement("link");
    link.id = QUILL_STYLE_ID;
    link.rel = "stylesheet";
    link.href = QUILL_STYLE_URL;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("Quill CSS load failed"));
    document.head.appendChild(link);
  });

const loadQuillScript = () =>
  new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve();
      return;
    }
    if (window.Quill) {
      resolve();
      return;
    }

    const existing = document.getElementById(
      QUILL_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const script = existing || document.createElement("script");
    let timeoutId: number | null = null;

    const cleanup = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      window.Quill
        ? resolve()
        : reject(new Error("Quill did not initialize after script load"));
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Quill script load failed"));
    };

    script.addEventListener("load", handleLoad);
    script.addEventListener("error", handleError);
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Quill CDN load timeout"));
    }, QUILL_LOAD_TIMEOUT_MS);

    if (!existing) {
      script.id = QUILL_SCRIPT_ID;
      script.src = QUILL_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });

const ensureQuillLoaded = () => {
  if (typeof window !== "undefined" && window.Quill) {
    return Promise.resolve();
  }
  if (!quillLoadPromise) {
    quillLoadPromise = Promise.all([loadQuillStyle(), loadQuillScript()])
      .then(() => undefined)
      .catch((error) => {
        quillLoadPromise = null;
        throw error;
      });
  }
  return quillLoadPromise;
};

const QuillEditor: React.FC<QuillEditorProps> = ({
  value,
  onChange,
  placeholder,
  minHeight = 240,
  toolbar = DEFAULT_TOOLBAR,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<any>(null);
  const syncingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const toolbarRef = useRef(toolbar);
  const placeholderRef = useRef(placeholder || "");
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const applyOrderedListStart = () => {
    const quill = quillRef.current;
    if (!quill) return;

    const range = quill.getSelection(true);
    if (!range) {
      alert("번호를 시작할 줄에 커서를 먼저 두세요.");
      return;
    }

    const [line] = quill.getLine(range.index);
    const lineNode = (line?.domNode || null) as HTMLElement | null;
    const itemNode = lineNode?.closest(
      'li[data-list="ordered"]',
    ) as HTMLElement | null;
    if (!itemNode) {
      alert("번호 목록 항목에서만 사용할 수 있습니다.");
      return;
    }

    const raw = window.prompt(
      "이 항목의 시작 번호를 입력하세요 (1 이상)",
      itemNode.dataset.start || "1",
    );
    if (raw === null) return;
    const start = Number(raw);
    if (!Number.isFinite(start) || start < 1) {
      alert("1 이상의 숫자를 입력하세요.");
      return;
    }

    const className = itemNode.className || "";
    const indentMatch = className.match(/ql-indent-(\d+)/);
    const indentLevel = indentMatch ? Number(indentMatch[1]) : 0;
    const safeLevel =
      Number.isFinite(indentLevel) && indentLevel >= 0
        ? Math.min(indentLevel, 9)
        : 0;

    const counterPairs: string[] = [
      `list-${safeLevel} ${Math.floor(start) - 1}`,
    ];
    for (let i = safeLevel + 1; i <= 9; i += 1) {
      counterPairs.push(`list-${i} 0`);
    }

    itemNode.dataset.start = String(Math.floor(start));
    itemNode.style.setProperty("counter-reset", counterPairs.join(" "));
    onChangeRef.current(quill.root.innerHTML);
  };

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    toolbarRef.current = toolbar;
  }, [toolbar]);

  useEffect(() => {
    placeholderRef.current = placeholder || "";
  }, [placeholder]);

  useEffect(() => {
    if (!hostRef.current) return;
    let canceled = false;
    let changeHandler: (() => void) | null = null;
    let startButton: HTMLButtonElement | null = null;
    let startClickHandler: ((event: MouseEvent) => void) | null = null;
    setLoadFailed(false);

    ensureQuillLoaded()
      .then(() => {
        if (canceled || !hostRef.current || quillRef.current) return;

        const quill = new window.Quill(hostRef.current, {
          theme: "snow",
          modules: { toolbar: toolbarRef.current },
          placeholder: placeholderRef.current,
        });

        quillRef.current = quill;
        syncingRef.current = true;
        quill.clipboard.dangerouslyPasteHTML(value || "");
        syncingRef.current = false;

        changeHandler = () => {
          if (!quillRef.current || syncingRef.current) return;
          onChangeRef.current(quillRef.current.root.innerHTML);
        };
        quill.on("text-change", changeHandler);

        const toolbarEl = hostRef.current.querySelector(
          ".ql-toolbar",
        ) as HTMLElement | null;
        if (toolbarEl) {
          const group = document.createElement("span");
          group.className = "ql-formats";

          startButton = document.createElement("button");
          startButton.type = "button";
          startButton.className = "ql-start-number";
          startButton.title = "번호 목록 시작값 설정";
          startButton.textContent = "번호 시작값";
          startClickHandler = (event: MouseEvent) => {
            event.preventDefault();
            applyOrderedListStart();
          };
          startButton.addEventListener("click", startClickHandler);
          group.appendChild(startButton);
          toolbarEl.appendChild(group);
        }

        setReady(true);
      })
      .catch((error) => {
        console.error("Failed to initialize Quill editor", error);
        setReady(false);
        setLoadFailed(true);
      });

    return () => {
      canceled = true;
      if (quillRef.current && changeHandler) {
        quillRef.current.off("text-change", changeHandler);
      }
      if (startButton && startClickHandler) {
        startButton.removeEventListener("click", startClickHandler);
      }
      quillRef.current = null;
      if (hostRef.current) {
        hostRef.current.innerHTML = "";
      }
    };
  }, []);

  useEffect(() => {
    if (!quillRef.current) return;
    const currentHtml = quillRef.current.root.innerHTML || "";
    if (normalize(currentHtml) === normalize(value || "")) return;

    syncingRef.current = true;
    quillRef.current.clipboard.dangerouslyPasteHTML(value || "");
    syncingRef.current = false;
  }, [value]);

  if (loadFailed) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
        style={{ minHeight }}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="westory-quill bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div ref={hostRef} style={{ minHeight }} />
      {!ready && (
        <div className="px-4 py-3 text-sm font-semibold text-gray-500">
          편집기를 준비하는 중입니다.
        </div>
      )}
      <style>{`
                .westory-quill .ql-toolbar .ql-start-number {
                    width: auto;
                    min-width: 76px;
                    padding: 0 8px;
                    font-size: 12px;
                    font-weight: 700;
                    color: #4b5563;
                    line-height: 24px;
                }
                .westory-quill .ql-toolbar .ql-start-number:hover {
                    color: #1d4ed8;
                }
                .westory-quill .ql-editor {
                    counter-reset: list-0 list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li[data-list='bullet'] > .ql-ui:before {
                    content: '\\2022';
                }
                .westory-quill .ql-editor li[data-list='ordered'] {
                    counter-increment: list-0;
                    counter-reset: list-1 list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-0, decimal) '. ';
                    font-variant-numeric: tabular-nums;
                }
                .westory-quill .ql-editor li.ql-indent-1[data-list='ordered'] {
                    counter-increment: list-1;
                    counter-reset: list-2 list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li.ql-indent-1[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-1, lower-alpha) '. ';
                }
                .westory-quill .ql-editor li.ql-indent-2[data-list='ordered'] {
                    counter-increment: list-2;
                    counter-reset: list-3 list-4 list-5 list-6 list-7 list-8 list-9;
                }
                .westory-quill .ql-editor li.ql-indent-2[data-list='ordered'] > .ql-ui:before {
                    content: counter(list-2, lower-roman) '. ';
                }
            `}</style>
    </div>
  );
};

export default QuillEditor;
