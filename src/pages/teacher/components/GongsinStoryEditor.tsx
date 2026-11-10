import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DRAFT_SOURCES, type DraftQuestion } from "./gongsinmoongoDraftData";
import "./gongsinStoryEditor.css";

type StoryDraft = Pick<
  DraftQuestion,
  "publicQuestion" | "publicReply" | "related"
>;

interface GongsinStoryEditorProps {
  question: DraftQuestion;
  draft: StoryDraft;
  onDraft: (update: Partial<StoryDraft>) => void;
  selected: boolean;
  onUpdate: (update: Partial<DraftQuestion>) => void;
  onSelect: (question: DraftQuestion) => void;
  onUnselect: () => void;
  onClose: () => void;
}

export default function GongsinStoryEditor({
  question,
  draft,
  onDraft,
  selected,
  onUpdate,
  onSelect,
  onUnselect,
  onClose,
}: GongsinStoryEditorProps) {
  const { publicQuestion, publicReply, related } = draft;
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const reviewSignature = JSON.stringify([
    question.id,
    publicQuestion,
    publicReply,
    related,
  ]);

  useEffect(() => setPrivacyChecked(false), [reviewSignature]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The native modal supplies background inertness and the keyboard focus trap.
    dialog.showModal();
    questionRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (
        opener?.isConnected &&
        opener.getClientRects().length &&
        !opener.matches(":disabled")
      )
        opener.focus({ preventScroll: true });
    };
  }, []);

  const select = () => {
    if (!privacyChecked || !publicQuestion.trim() || !publicReply.trim())
      return;
    const update = {
      publicQuestion: publicQuestion.trim(),
      publicReply: publicReply.trim(),
    };
    onUpdate(update);
    onSelect({ ...question, ...update, related: [...related] });
    setPrivacyChecked(false);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="gongsin-workspace gongsin-draft gongsin-story-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="gongsin-story-dialog-heading">
        <h2 id={titleId}>공개용 문구 편집</h2>
        <button
          className="gongsin-icon-button"
          type="button"
          aria-label="공개용 문구 편집 닫기"
          onClick={onClose}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="gongsin-story-dialog-body">
        <div className="gongsin-public-fields">
          <label className="gongsin-field">
            공개 질문
            <textarea
              ref={questionRef}
              rows={2}
              maxLength={240}
              value={publicQuestion}
              onChange={(event) => {
                onDraft({ publicQuestion: event.target.value });
                setPrivacyChecked(false);
              }}
            />
          </label>
          <label className="gongsin-field">
            공개 답변
            <textarea
              rows={3}
              maxLength={1000}
              value={publicReply}
              onChange={(event) => {
                onDraft({ publicReply: event.target.value });
                setPrivacyChecked(false);
              }}
            />
          </label>
        </div>
        <fieldset className="gongsin-related-picker">
          <legend>이어서 공부할 자료</legend>
          {DRAFT_SOURCES.map((source) => (
            <label key={source.id}>
              <input
                type="checkbox"
                checked={related.includes(source.id)}
                onChange={(event) => {
                  onDraft({
                    related: event.target.checked
                      ? [...related, source.id]
                      : related.filter((id) => id !== source.id),
                  });
                  setPrivacyChecked(false);
                }}
              />
              {source.label}
            </label>
          ))}
        </fieldset>
        <label className="gongsin-privacy-check">
          <input
            type="checkbox"
            checked={privacyChecked}
            onChange={(event) => setPrivacyChecked(event.target.checked)}
          />
          공개 문구와 연결 자료에 개인정보·비공개 내용이 없는지 확인했습니다.
        </label>
      </div>
      <footer className="gongsin-story-dialog-actions gongsin-editor-actions">
        <button
          className="gongsin-button gongsin-primary"
          type="button"
          disabled={
            !privacyChecked || !publicQuestion.trim() || !publicReply.trim()
          }
          onClick={select}
        >
          {selected ? "선정 스토리 갱신 (미리보기)" : "스토리 선정 (미리보기)"}
        </button>
        {selected && (
          <button className="gongsin-button" type="button" onClick={onUnselect}>
            선정 해제
          </button>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
