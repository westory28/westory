import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import { STUDENT_AVATAR_SHOP_URL } from "../../lib/avatarRoutes";
import type { StudentLearningShortcutId } from "../../lib/studentLearningShortcuts";
import InfoHelp from "./InfoHelp";

export const STUDENT_LEARNING_SHORTCUTS: {
  id: StudentLearningShortcutId;
  label: string;
  url: string;
  icon: string;
}[] = [
  {
    id: "lesson",
    label: "학습 자료",
    url: "/student/lesson/note",
    icon: "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm9 3a3 3 0 0 1 3-3h4v14h-3a4 4 0 0 0-4 3",
  },
  {
    id: "maps",
    label: "역사 지도",
    url: "/student/lesson/maps",
    icon: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16",
  },
  {
    id: "wispi",
    label: "위스피",
    url: "/student/wispi",
    icon: "M4 4v16h16M7 14l4-4 4 3 5-7",
  },
  {
    id: "avatar-shop",
    label: "아바타 상점",
    url: STUDENT_AVATAR_SHOP_URL,
    icon: "M5 8h14l1 13H4L5 8Zm3 0V6a4 4 0 0 1 8 0v2",
  },
  {
    id: "weplay",
    label: "위플레이",
    url: "/student/weplay",
    icon: "M7 6h10a4 4 0 0 1 4 4v8a2 2 0 0 1-3 1l-3-3H9l-3 3a2 2 0 0 1-3-1v-8a4 4 0 0 1 4-4ZM8 9v5m-2.5-2.5h5M16 10h.01M18 13h.01",
  },
  {
    id: "calendar",
    label: "캘린더",
    url: "/student/calendar",
    icon: "M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2-2v5m10-5v5M3 10h18",
  },
];

export function StudentShortcutIcon({ path }: { path: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function StudentLearningShortcutsEditor({
  items,
  availableIds,
  loading,
  loaded,
  error,
  onReload,
  onSave,
  onClose,
}: {
  items: StudentLearningShortcutId[];
  availableIds: StudentLearningShortcutId[];
  loading: boolean;
  loaded: boolean;
  error: string;
  onReload: () => Promise<void>;
  onSave: (items: StudentLearningShortcutId[]) => Promise<void>;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [draft, setDraft] = useState(items);
  const [initialized, setInitialized] = useState(loaded);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dragging, setDragging] = useState<StudentLearningShortcutId | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{
    id: StudentLearningShortcutId;
    pointerId: number;
  } | null>(null);
  const mounted = useRef(true);
  const saveFlight = useRef(false);
  const keyboardFocus = useRef<StudentLearningShortcutId | null>(null);
  useLayoutEffect(() => {
    if (!keyboardFocus.current) return;
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-shortcut-id="${keyboardFocus.current}"] .student-shortcuts-handle`,
      )
      ?.focus({ preventScroll: true });
    keyboardFocus.current = null;
  }, [draft]);
  useEffect(() => {
    mounted.current = true;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    const release = acquirePageScrollLock();
    return () => {
      mounted.current = false;
      release();
    };
  }, []);
  useEffect(() => {
    if (!initialized && loaded) {
      setDraft(items);
      setInitialized(true);
    }
  }, [initialized, loaded, items]);
  const move = (id: StudentLearningShortcutId, destination: number) => {
    const position = Math.max(0, Math.min(draft.length - 1, destination));
    if (draft.indexOf(id) === position) return;
    setDraft((previous) => {
      const from = previous.indexOf(id);
      const to = position;
      if (from < 0 || from === to) return previous;
      const next = [...previous];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
    setAnnouncement(
      `${STUDENT_LEARNING_SHORTCUTS.find((item) => item.id === id)?.label}, ${position + 1}번째`,
    );
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(items);
  const close = () => {
    if (!saveFlight.current) onClose();
  };
  return (
    <dialog
      ref={dialogRef}
      className="student-shortcuts-dialog"
      aria-labelledby="student-shortcuts-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="ws-page-header student-shortcuts-heading">
        <div>
          <h2 id="student-shortcuts-title">바로가기 편집</h2>
          <InfoHelp label="바로가기 편집 도움말">
            왼쪽 손잡이를 누른 채 위아래로 끌어 순서를 바꿉니다. 키보드에서는
            손잡이에 초점을 두고 위·아래 방향키를 누릅니다. 사전과 공부의
            신문고는 기본 메뉴입니다.
          </InfoHelp>
        </div>
        <button
          ref={closeButtonRef}
          autoFocus
          type="button"
          aria-label="바로가기 편집 닫기"
          disabled={busy}
          onClick={close}
        >
          <StudentShortcutIcon path="m6 6 12 12M18 6 6 18" />
        </button>
      </header>
      {(error || saveError) && (
        <div className="student-shortcuts-error" role="alert">
          {saveError || error}
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => {
              setSaveError("");
              setInitialized(false);
              void onReload().catch(() => undefined);
            }}
          >
            다시 불러오기
          </button>
        </div>
      )}
      {!initialized ? (
        <p role="status">
          {loading ? "불러오는 중…" : "바로가기를 불러오지 못했습니다."}
        </p>
      ) : (
        <>
          <ol
            ref={listRef}
            className="student-shortcuts-selected"
            aria-label="등록한 바로가기"
            onPointerMove={(event) => {
              const gesture = drag.current;
              if (!gesture || gesture.pointerId !== event.pointerId) return;
              const dialog = dialogRef.current;
              if (dialog) {
                const bounds = dialog.getBoundingClientRect();
                if (event.clientY < bounds.top + 48) dialog.scrollBy(0, -16);
                else if (event.clientY > bounds.bottom - 48)
                  dialog.scrollBy(0, 16);
              }
              let target = draft.indexOf(gesture.id);
              let distance = Infinity;
              Array.from(event.currentTarget.children).forEach(
                (row, rowIndex) => {
                  const box = row.getBoundingClientRect();
                  const next = Math.abs(
                    event.clientY - (box.top + box.height / 2),
                  );
                  if (next < distance) {
                    distance = next;
                    target = rowIndex;
                  }
                },
              );
              move(gesture.id, target);
            }}
            onPointerUp={() => {
              drag.current = null;
              setDragging(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(null);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setDragging(null);
            }}
          >
            {draft.map((id, index) => {
              const item = STUDENT_LEARNING_SHORTCUTS.find(
                (candidate) => candidate.id === id,
              )!;
              return (
                <li
                  key={id}
                  data-shortcut-id={id}
                  className={dragging === id ? "is-dragging" : ""}
                >
                  <button
                    type="button"
                    className="student-shortcuts-handle"
                    aria-label={`${item.label} 순서 이동`}
                    disabled={busy}
                    onPointerDown={(event) => {
                      if (event.button !== 0 || busy) return;
                      event.preventDefault();
                      event.currentTarget.focus();
                      // Capture on the stable list, since reordering moves the handle's DOM node.
                      listRef.current?.setPointerCapture(event.pointerId);
                      drag.current = { id, pointerId: event.pointerId };
                      setDragging(id);
                    }}
                    onKeyDown={(event) => {
                      if (
                        !["ArrowUp", "ArrowDown", "Home", "End"].includes(
                          event.key,
                        )
                      )
                        return;
                      event.preventDefault();
                      keyboardFocus.current = id;
                      move(
                        id,
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? draft.length - 1
                            : index + (event.key === "ArrowUp" ? -1 : 1),
                      );
                    }}
                  >
                    <StudentShortcutIcon path="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" />
                  </button>
                  <span className="student-shortcuts-name">
                    {item.label}
                    {!availableIds.includes(id) && (
                      <small>현재 이용 불가</small>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`${item.label} 삭제`}
                    disabled={busy}
                    onClick={() =>
                      setDraft((previous) =>
                        previous.filter((value) => value !== id),
                      )
                    }
                  >
                    <StudentShortcutIcon path="m6 6 12 12M18 6 6 18" />
                  </button>
                </li>
              );
            })}
          </ol>
          <div
            className="student-shortcuts-available"
            aria-label="추가할 수 있는 메뉴"
          >
            {STUDENT_LEARNING_SHORTCUTS.filter(
              (item) => !draft.includes(item.id),
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={busy || !availableIds.includes(item.id)}
                onClick={() =>
                  setDraft((previous) =>
                    previous.includes(item.id)
                      ? previous
                      : [...previous, item.id],
                  )
                }
                aria-label={`${item.label} 추가`}
              >
                <StudentShortcutIcon path={item.icon} />
                <span>{item.label}</span>
                <span aria-hidden="true">+</span>
              </button>
            ))}
          </div>
        </>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      <footer className="student-shortcuts-actions">
        <button type="button" disabled={busy} onClick={close}>
          취소
        </button>
        <button
          type="button"
          className="student-shortcuts-save"
          disabled={busy || loading || !initialized || !changed}
          onClick={async () => {
            if (saveFlight.current || !changed) return;
            saveFlight.current = true;
            setBusy(true);
            setSaveError("");
            try {
              await onSave(draft);
              if (mounted.current) onClose();
            } catch (cause) {
              if (mounted.current)
                setSaveError(
                  cause instanceof Error
                    ? cause.message
                    : "저장하지 못했습니다. 다시 시도해 주세요.",
                );
            } finally {
              saveFlight.current = false;
              if (mounted.current) setBusy(false);
            }
          }}
        >
          {busy ? "저장 중…" : "저장"}
        </button>
      </footer>
    </dialog>
  );
}
