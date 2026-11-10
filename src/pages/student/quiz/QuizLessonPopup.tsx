import { Suspense, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { lazyWithRetry } from "../../../lib/lazyWithRetry";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  readStudentVisibleCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../lib/studentLessonReadCache";
import "../../../components/layout/studentLayout.css";
import "./QuizLessonPopup.css";

const LessonContent = lazyWithRetry(
  () => import("../lesson/components/LessonContent"),
  "student-review-lesson-content",
);

type Props = {
  unitId: string;
  open: boolean;
  onClose: () => void;
  onDraftStateChange: (dirty: boolean, saving: boolean) => void;
};

function LessonPopupSession({
  unitId,
  open,
  onClose,
  onDraftStateChange,
  returnFocusTarget,
}: Props & { returnFocusTarget: HTMLElement | null }) {
  const { config } = useAuth();
  const { year, semester } = getYearSemester(config);
  const [tree, setTree] = useState<StudentCurriculumTreeItem[] | null>(null);
  const [treeError, setTreeError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(unitId);
  // Mount only visited lessons, then retain their inputs and page position for
  // this review session. Switching/closing never reloads the student's answers.
  const [visited, setVisited] = useState([unitId]);
  const draftStates = useRef(
    new Map<string, { dirty: boolean; saving: boolean }>(),
  );
  const draftCallbacks = useRef(
    new Map<string, (dirty: boolean, saving: boolean) => void>(),
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const outlineButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const outlineId = useId();
  const callbacks = useRef({ onClose, onDraftStateChange });
  callbacks.current = { onClose, onDraftStateChange };
  useEffect(() => () => callbacks.current.onDraftStateChange(false, false), []);

  const selectLesson = (id: string) => {
    setSelectedId(id);
    setVisited((previous) =>
      previous.includes(id) ? previous : [...previous, id],
    );
    setOutlineOpen(false);
    outlineButtonRef.current?.focus();
  };
  useEffect(() => {
    if (open) selectLesson(unitId);
  }, [unitId, open]);

  useEffect(() => {
    let active = true;
    setTreeError(false);
    readStudentVisibleCurriculumTree({ year, semester }).then(
      (items) => {
        if (active) setTree(items);
      },
      () => {
        if (active) setTreeError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [year, semester, retry]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTarget = previousFocus?.closest(".quiz-lesson-popup")
      ? returnFocusTarget
      : previousFocus;
    const release = acquirePageScrollLock();
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (outlineRef.current?.dataset.open === "true") {
          setOutlineOpen(false);
          outlineButtonRef.current?.focus();
        } else callbacks.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      release();
      document.removeEventListener("keydown", onKey);
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!outlineOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!outlineRef.current?.contains(event.target as Node))
        setOutlineOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [outlineOpen]);

  const renderTree = (items: StudentCurriculumTreeItem[]) => (
    <ul>
      {items.map((entry) => (
        <li key={entry.id}>
          {entry.children?.length ? (
            <>
              <span className="quiz-lesson-popup__group">{entry.title}</span>
              {renderTree(entry.children)}
            </>
          ) : (
            <button
              type="button"
              title={entry.title}
              aria-current={selectedId === entry.id ? "page" : undefined}
              onClick={() => selectLesson(entry.id)}
            >
              {entry.title}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
  return createPortal(
    <div
      className="student-layout quiz-lesson-popup"
      hidden={!open}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="quiz-lesson-popup__dialog"
      >
        <header className="quiz-lesson-popup__header">
          <div
            ref={outlineRef}
            data-open={outlineOpen}
            className="quiz-lesson-popup__outline"
          >
            <button
              ref={outlineButtonRef}
              type="button"
              aria-expanded={outlineOpen}
              aria-controls={outlineId}
              onClick={() => setOutlineOpen((value) => !value)}
            >
              목차
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d={outlineOpen ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"}
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
            {outlineOpen && (
              <nav
                id={outlineId}
                className="quiz-lesson-popup__menu"
                aria-label="학습지 목차"
              >
                {treeError ? (
                  <div role="alert">
                    목차를 불러오지 못했습니다.
                    <button
                      type="button"
                      onClick={() => setRetry((value) => value + 1)}
                    >
                      다시 불러오기
                    </button>
                  </div>
                ) : !tree ? (
                  <InlineLoading message="목차를 불러오는 중입니다." />
                ) : tree.length ? (
                  renderTree(tree)
                ) : (
                  <p>공개된 학습지가 없습니다.</p>
                )}
              </nav>
            )}
          </div>
          <h2 id={titleId}>학습지</h2>
          <button type="button" onClick={onClose} aria-label="학습지 닫기">
            닫기
          </button>
        </header>
        {visited.map((id) => {
          if (!draftCallbacks.current.has(id))
            draftCallbacks.current.set(id, (dirty, saving) => {
              draftStates.current.set(id, { dirty, saving });
              const states = [...draftStates.current.values()];
              callbacks.current.onDraftStateChange(
                states.some((state) => state.dirty),
                states.some((state) => state.saving),
              );
            });
          return (
            <div
              key={id}
              className="quiz-lesson-popup__body"
              hidden={selectedId !== id}
            >
              <Suspense
                fallback={
                  <InlineLoading message="학습지를 준비하는 중입니다." />
                }
              >
                <LessonContent
                  unitId={id}
                  reviewPopup
                  onDraftStateChange={draftCallbacks.current.get(id)}
                />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}

export default function QuizLessonPopup(props: Props) {
  const { currentUser, config } = useAuth();
  const returnFocusTarget = useRef(
    document.activeElement as HTMLElement | null,
  );
  const { year, semester } = getYearSemester(config);
  if (!currentUser) return null;
  return (
    <LessonPopupSession
      key={`${currentUser?.uid}:${year}:${semester}`}
      {...props}
      returnFocusTarget={returnFocusTarget.current}
    />
  );
}
