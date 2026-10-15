import React, { useLayoutEffect, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  createQuizVisualFragment,
  formatQuizVisualDocument,
  getQuizVisualSelection,
  importQuizVisualHtml,
  parseQuizVisualDocument,
  quizVisualText,
  readQuizVisualDom,
  replaceQuizVisualSelection,
  serializeQuizVisualDocument,
  setQuizVisualSelection,
  type QuizVisualDocument,
  type QuizVisualMark,
} from "./quizVisualDocument";
import "./QuizVisualEditor.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allowBlank?: boolean;
}
interface Snapshot {
  value: string;
  start: number;
  end: number;
}

const QuizVisualPassageEditor: React.FC<Props> = ({
  value,
  onChange,
  label = "지문",
  allowBlank = false,
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef<string | null>(null);
  const composing = useRef(false);
  const selectionRef = useRef({ start: 0, end: 0 });
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(0);
  const [historyState, setHistoryState] = useState({ index: 0, length: 1 });
  const [selectionLength, setSelectionLength] = useState(0);
  const [message, setMessage] = useState("");
  const rememberSelection = () => {
    const root = editorRef.current;
    const selection = root && getQuizVisualSelection(root);
    if (selection) {
      selectionRef.current = selection;
      setSelectionLength(selection.end - selection.start);
    }
  };
  const draw = (
    doc: QuizVisualDocument,
    selection?: { start: number; end: number },
  ) => {
    const root = editorRef.current;
    if (!root) return;
    root.replaceChildren(createQuizVisualFragment(doc));
    if (selection) {
      root.focus();
      setQuizVisualSelection(root, selection.start, selection.end);
      selectionRef.current = selection;
      setSelectionLength(selection.end - selection.start);
    }
  };
  const syncHistory = () =>
    setHistoryState({
      index: historyIndex.current,
      length: history.current.length,
    });
  useLayoutEffect(() => {
    if (value === lastValue.current) return;
    const doc = parseQuizVisualDocument(value);
    draw(doc);
    lastValue.current = value;
    history.current = [{ value, start: 0, end: 0 }];
    historyIndex.current = 0;
    syncHistory();
    selectionRef.current = { start: 0, end: 0 };
    setSelectionLength(0);
    setMessage("");
  }, [value]);
  const commit = (
    doc: QuizVisualDocument,
    selection: { start: number; end: number },
    redraw = true,
  ) => {
    const next = serializeQuizVisualDocument(doc);
    if (redraw) draw(doc, selection);
    selectionRef.current = selection;
    if (next === lastValue.current) return;
    history.current = history.current.slice(0, historyIndex.current + 1);
    history.current.push({ value: next, ...selection });
    if (history.current.length > 100) history.current.shift();
    historyIndex.current = history.current.length - 1;
    syncHistory();
    lastValue.current = next;
    onChange(next);
    setMessage("");
  };
  const captureInput = () => {
    const root = editorRef.current;
    if (!root || composing.current) return;
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    commit(readQuizVisualDom(root), selection, false);
  };
  const moveHistory = (direction: -1 | 1) => {
    const nextIndex = historyIndex.current + direction;
    const snapshot = history.current[nextIndex];
    if (!snapshot) return;
    historyIndex.current = nextIndex;
    syncHistory();
    lastValue.current = snapshot.value;
    draw(parseQuizVisualDocument(snapshot.value), snapshot);
    onChange(snapshot.value);
    setMessage("");
  };
  const apply = (mark: QuizVisualMark | "bullet") => {
    const root = editorRef.current;
    if (!root) return;
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    if (mark !== "bullet" && selection.start === selection.end) {
      setMessage("서식을 적용할 글자를 먼저 선택해 주세요.");
      root.focus();
      return;
    }
    history.current[historyIndex.current] = {
      value: lastValue.current || "",
      ...selection,
    };
    commit(
      formatQuizVisualDocument(
        readQuizVisualDom(root),
        selection.start,
        selection.end,
        mark,
      ),
      selection,
    );
  };
  const paste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const root = editorRef.current;
    if (!root) return;
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const inserted = html
      ? importQuizVisualHtml(html)
      : parseQuizVisualDocument(text);
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    history.current[historyIndex.current] = {
      value: lastValue.current || "",
      ...selection,
    };
    const next = replaceQuizVisualSelection(
      readQuizVisualDom(root),
      selection.start,
      selection.end,
      inserted,
    );
    const end = selection.start + quizVisualText(inserted).length;
    commit(next, { start: end, end });
  };
  return (
    <div className="quiz-visual-editor">
      <div className="quiz-visual-editor-label">
        <span>{label}</span>
        <InfoHelp label="지문 서식 도움말">
          글자를 선택한 뒤 밑줄·네모·빈칸을 적용합니다. 글머리표는 커서가 있는
          줄 또는 선택한 줄에 적용합니다. 붙여넣기는 본문과 지원하는 서식만
          가져옵니다. Ctrl+Z로 실행을 취소할 수 있습니다.
        </InfoHelp>
      </div>
      <div
        className="quiz-visual-toolbar"
        role="toolbar"
        aria-label={`${label} 서식`}
      >
        {(
          [
            ["underline", "밑줄"],
            ["box", "네모"],
            ...(allowBlank ? [["blank", "빈칸"]] : []),
            ["bullet", "글머리표"],
            ["text", "서식 지우기"],
          ] as [QuizVisualMark | "bullet", string][]
        ).map(([mark, title]) => (
          <button
            key={mark}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply(mark)}
            aria-label={`${label} ${title}`}
            title={
              mark === "bullet"
                ? "선택한 줄의 글머리표 전환"
                : "선택한 글자에 적용"
            }
            className={
              mark === "underline" ? "quiz-visual-underline-button" : ""
            }
          >
            {title}
          </button>
        ))}
        <span className="quiz-visual-toolbar-spacer" />
        <button
          type="button"
          aria-label={`${label} 실행 취소`}
          disabled={historyState.index === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => moveHistory(-1)}
        >
          실행 취소
        </button>
        <button
          type="button"
          aria-label={`${label} 다시 실행`}
          disabled={historyState.index >= historyState.length - 1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => moveHistory(1)}
        >
          다시 실행
        </button>
      </div>
      <div
        ref={editorRef}
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        tabIndex={0}
        contentEditable
        suppressContentEditableWarning
        lang="ko"
        inputMode="text"
        className="quiz-visual-content quiz-compose-field"
        onInput={captureInput}
        onPaste={paste}
        onDrop={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          captureInput();
        }}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onBlur={rememberSelection}
        onBeforeInput={(event) => {
          const input = event.nativeEvent as InputEvent;
          if (
            input.inputType === "historyUndo" ||
            input.inputType === "historyRedo"
          ) {
            event.preventDefault();
            moveHistory(input.inputType === "historyUndo" ? -1 : 1);
          }
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && !composing.current) {
            const key = event.key.toLowerCase();
            if (key === "z" || key === "y") {
              event.preventDefault();
              moveHistory(key === "y" || event.shiftKey ? 1 : -1);
            } else if (key === "u") {
              event.preventDefault();
              apply("underline");
            } else if (key === "b" || key === "i") event.preventDefault();
          }
        }}
      />
      <div className="quiz-visual-status" aria-live="polite">
        {message || (selectionLength ? `${selectionLength}자 선택됨` : "")}
      </div>
    </div>
  );
};
export default QuizVisualPassageEditor;
