import React, { useId, useLayoutEffect, useRef, useState } from "react";
import InfoHelp from "../../../components/common/InfoHelp";
import {
  createQuizVisualFragment,
  formatQuizVisualDocument,
  getQuizVisualSelection,
  importQuizVisualHtml,
  normalizeBlankWidth,
  parseQuizVisualDocument,
  quizVisualClipboard,
  quizVisualText,
  readQuizVisualDom,
  replaceQuizVisualSelection,
  serializeQuizVisualDocument,
  setQuizVisualSelection,
  sliceQuizVisualDocument,
  type QuizVisualDocument,
  type QuizVisualMark,
} from "./quizVisualDocument";
import "./QuizVisualEditor.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  allowBlank?: boolean;
  onImagePaste?: (file: File) => void | Promise<void>;
  tools?: React.ReactNode;
  attachment?: React.ReactNode;
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
  onImagePaste,
  tools,
  attachment,
}) => {
  const blankSettingsId = useId();
  const editorRef = useRef<HTMLDivElement>(null);
  const lastValue = useRef<string | null>(null);
  const composing = useRef(false);
  const selectionRef = useRef({ start: 0, end: 0 });
  const history = useRef<Snapshot[]>([]);
  const historyIndex = useRef(0);
  const [historyState, setHistoryState] = useState({ index: 0, length: 1 });
  const [selectionLength, setSelectionLength] = useState(0);
  const [message, setMessage] = useState("");
  const [blankSettings, setBlankSettings] = useState<{
    label: string;
    reference: string;
    widthEm: number;
    start: number;
    end: number;
  } | null>(null);
  const [clipboardBusy, setClipboardBusy] = useState(false);
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
    setBlankSettings(null);
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
  const snapshotSelection = (selection = selectionRef.current) => {
    history.current[historyIndex.current] = {
      value: lastValue.current || "",
      ...selection,
    };
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
    if (!root || composing.current) return;
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    if (mark !== "bullet" && selection.start === selection.end) {
      setMessage("서식을 적용할 글자를 먼저 선택해 주세요.");
      root.focus();
      return;
    }
    snapshotSelection(selection);
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
  const openBlankSettings = () => {
    const root = editorRef.current;
    if (!root || composing.current) return;
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    selectionRef.current = selection;
    const selected = sliceQuizVisualDocument(
      readQuizVisualDom(root),
      selection.start,
      selection.end,
    );
    const selectedText = quizVisualText(selected).trim();
    const existing = selected[0]?.runs.find((run) => run.mark === "blankBox");
    const isLabel = /^\([가-힣ㄱ-ㅎA-Za-z0-9]{1,3}\)$/u.test(selectedText);
    setBlankSettings({
      label: existing?.text || (isLabel ? selectedText : "(가)"),
      reference: existing || isLabel ? "" : selectedText.replace(/\n/g, " "),
      widthEm: existing?.widthEm || 2,
      ...selection,
    });
    setMessage("");
  };
  const insertBlank = () => {
    const root = editorRef.current;
    if (!root || !blankSettings || composing.current) return;
    const text = blankSettings.label.trim();
    if (!text || text.length > 20 || /[{}|\r\n]/.test(text)) {
      setMessage("빈칸 기호는 1~20자의 한 줄로 입력해 주세요.");
      return;
    }
    let widthEm = blankSettings.widthEm;
    if (blankSettings.reference.trim()) {
      const style = window.getComputedStyle(root);
      const size = Number.parseFloat(style.fontSize) || 16;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const reference = blankSettings.reference.trim();
        const tracking = Number.parseFloat(style.letterSpacing) || 0;
        widthEm =
          (context.measureText(reference).width +
            Math.max(0, Array.from(reference).length - 1) * tracking) /
          size;
      }
    }
    const inserted: QuizVisualDocument = [
      {
        bullet: false,
        runs: [
          {
            text,
            mark: "blankBox",
            widthEm: normalizeBlankWidth(widthEm),
            group: Date.now(),
          },
        ],
      },
    ];
    snapshotSelection(blankSettings);
    const next = replaceQuizVisualSelection(
      readQuizVisualDom(root),
      blankSettings.start,
      blankSettings.end,
      inserted,
    );
    const end = blankSettings.start + text.length;
    setBlankSettings(null);
    commit(next, { start: end, end });
  };
  const closeBlankSettings = () => {
    const root = editorRef.current;
    const selection = blankSettings || selectionRef.current;
    setBlankSettings(null);
    if (root) {
      root.focus();
      setQuizVisualSelection(root, selection.start, selection.end);
    }
  };
  const insertClipboard = async (
    html: string,
    text: string,
    file?: File | null,
  ) => {
    const root = editorRef.current;
    if (!root || composing.current) return;
    if (file && onImagePaste) {
      try {
        setClipboardBusy(true);
        await onImagePaste(file);
        setMessage("");
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "이미지를 붙여넣지 못했습니다.",
        );
      } finally {
        setClipboardBusy(false);
      }
      return;
    }
    if (!html && !text) {
      if (file) setMessage("이 입력란에는 글자만 붙여넣을 수 있습니다.");
      return;
    }
    const inserted = html
      ? importQuizVisualHtml(html)
      : parseQuizVisualDocument(text);
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    snapshotSelection(selection);
    const next = replaceQuizVisualSelection(
      readQuizVisualDom(root),
      selection.start,
      selection.end,
      inserted,
    );
    const end = selection.start + quizVisualText(inserted).length;
    commit(next, { start: end, end });
  };
  const paste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = Array.from(event.clipboardData.files).find((item) =>
      item.type.startsWith("image/"),
    );
    void insertClipboard(
      event.clipboardData.getData("text/html"),
      event.clipboardData.getData("text/plain"),
      file,
    );
  };
  const pasteFromClipboard = async () => {
    if (composing.current) return;
    const revision = lastValue.current;
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        if (revision !== lastValue.current) return;
        const imageItem = items.find((item) =>
          item.types.some((type) => type.startsWith("image/")),
        );
        const imageType = imageItem?.types.find((type) =>
          type.startsWith("image/"),
        );
        if (imageItem && imageType && onImagePaste) {
          const blob = await imageItem.getType(imageType);
          await insertClipboard(
            "",
            "",
            new File([blob], "clipboard-image", { type: imageType }),
          );
          return;
        }
        const htmlItem = items.find((item) => item.types.includes("text/html"));
        const textItem = items.find((item) =>
          item.types.includes("text/plain"),
        );
        const html = htmlItem
          ? await (await htmlItem.getType("text/html")).text()
          : "";
        const text = textItem
          ? await (await textItem.getType("text/plain")).text()
          : "";
        if (revision === lastValue.current) await insertClipboard(html, text);
      } else if (navigator.clipboard?.readText)
        await insertClipboard("", await navigator.clipboard.readText());
      else throw new Error("clipboard unavailable");
    } catch {
      setMessage("브라우저에서 붙여넣기를 허용하거나 Ctrl+V를 사용해 주세요.");
    }
  };
  const selectedClipboard = () => {
    const root = editorRef.current;
    if (!root || composing.current) return null;
    const selection = getQuizVisualSelection(root) || selectionRef.current;
    if (selection.start === selection.end) return null;
    const doc = readQuizVisualDom(root);
    return {
      ...quizVisualClipboard(
        sliceQuizVisualDocument(doc, selection.start, selection.end),
      ),
      selection,
      doc,
    };
  };
  const deleteSelection = (
    data: NonNullable<ReturnType<typeof selectedClipboard>>,
  ) => {
    snapshotSelection(data.selection);
    commit(
      replaceQuizVisualSelection(
        data.doc,
        data.selection.start,
        data.selection.end,
        [],
      ),
      { start: data.selection.start, end: data.selection.start },
    );
  };
  const copy = (event: React.ClipboardEvent<HTMLDivElement>, cut = false) => {
    const data = selectedClipboard();
    if (!data) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", data.text);
    event.clipboardData.setData("text/html", data.html);
    if (cut) deleteSelection(data);
  };
  const copyToClipboard = async (cut = false) => {
    const data = selectedClipboard();
    if (!data) return;
    const revision = lastValue.current;
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined")
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([data.text], { type: "text/plain" }),
            "text/html": new Blob([data.html], { type: "text/html" }),
          }),
        ]);
      else if (navigator.clipboard?.writeText)
        await navigator.clipboard.writeText(data.text);
      else throw new Error("clipboard unavailable");
      if (cut && revision === lastValue.current) deleteSelection(data);
      setMessage("");
    } catch {
      setMessage(
        cut
          ? "Ctrl+X로 선택한 내용을 잘라내 주세요."
          : "Ctrl+C로 선택한 내용을 복사해 주세요.",
      );
    }
  };
  return (
    <div className="quiz-visual-editor">
      <div className="quiz-visual-editor-label">
        <span>{label}</span>
        <InfoHelp label="지문 서식 도움말">
          글자를 선택한 뒤 밑줄·네모를 적용합니다. 빈칸은 표시할 기호와 너비를
          정해 넣습니다. 너비 기준 글자는 저장되지 않습니다. 붙여넣기는 본문과
          지원하는 서식만 가져옵니다. Ctrl+Z로 실행을 취소할 수 있습니다.
        </InfoHelp>
      </div>
      <div className={tools || attachment ? "quiz-visual-frame" : undefined}>
        <div
          className="quiz-visual-toolbar"
          role="toolbar"
          aria-label={`${label} 서식`}
        >
          {(
            [
              ["underline", "밑줄"],
              ["box", "네모"],
              ...(allowBlank ? [["blank", "답안 빈칸"]] : []),
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
          <button
            type="button"
            aria-label={`${label} 빈칸 네모`}
            aria-expanded={!!blankSettings}
            aria-controls={blankSettingsId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openBlankSettings}
          >
            빈칸 네모
          </button>
          <button
            type="button"
            aria-label={`${label} 복사`}
            disabled={!selectionLength || clipboardBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void copyToClipboard()}
          >
            복사
          </button>
          <button
            type="button"
            aria-label={`${label} 잘라내기`}
            disabled={!selectionLength || clipboardBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void copyToClipboard(true)}
          >
            잘라내기
          </button>
          <button
            type="button"
            aria-label={`${label} 붙여넣기`}
            disabled={clipboardBusy}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void pasteFromClipboard()}
          >
            붙여넣기
          </button>
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
          {tools}
        </div>
        {blankSettings && (
          <div
            id={blankSettingsId}
            className="quiz-visual-blank-settings"
            role="group"
            aria-label={`${label} 빈칸 설정`}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                closeBlankSettings();
              } else if (event.key === "Enter") {
                event.preventDefault();
                insertBlank();
              }
            }}
          >
            <label>
              표시 기호
              <input
                aria-label={`${label} 빈칸 기호`}
                autoFocus
                value={blankSettings.label}
                maxLength={20}
                onChange={(event) =>
                  setBlankSettings({
                    ...blankSettings,
                    label: event.target.value,
                  })
                }
              />
            </label>
            <label>
              너비 기준 글자 (선택)
              <input
                aria-label={`${label} 빈칸 너비 기준 글자`}
                autoComplete="off"
                value={blankSettings.reference}
                maxLength={120}
                onChange={(event) =>
                  setBlankSettings({
                    ...blankSettings,
                    reference: event.target.value,
                  })
                }
              />
            </label>
            <button type="button" onClick={insertBlank}>
              빈칸 넣기
            </button>
            <button type="button" onClick={closeBlankSettings}>
              취소
            </button>
          </div>
        )}
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
          onCopy={(event) => copy(event)}
          onCut={(event) => copy(event, true)}
          onDrop={(event) => event.preventDefault()}
          onDragStart={(event) => event.preventDefault()}
          onCompositionStart={() => {
            rememberSelection();
            snapshotSelection();
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
            if (!composing.current) {
              rememberSelection();
              snapshotSelection();
            }
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
        {attachment && (
          <div className="quiz-visual-attachment">{attachment}</div>
        )}
      </div>
      <div className="quiz-visual-status" aria-live="polite">
        {message || (selectionLength ? `${selectionLength}자 선택됨` : "")}
      </div>
    </div>
  );
};
export default QuizVisualPassageEditor;
