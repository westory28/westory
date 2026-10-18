import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import StudentHistoryDictionaryWorkspace from "./StudentHistoryDictionaryWorkspace";

const getFloatingOffsetClassName = (pathname: string, search: string) => {
  if (pathname.startsWith("/student/lesson/history-dictionary"))
    return "hidden";
  if (pathname.startsWith("/student/lesson/note")) {
    const hasSelectedUnit = Boolean(new URLSearchParams(search).get("id"));
    return hasSelectedUnit
      ? "bottom-[calc(env(safe-area-inset-bottom,0px)+18rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] lg:bottom-[calc(env(safe-area-inset-bottom,0px)+16rem)] lg:right-[calc(env(safe-area-inset-right,0px)+1.5rem)]"
      : "bottom-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] lg:bottom-[calc(env(safe-area-inset-bottom,0px)+12.25rem)] lg:right-[calc(env(safe-area-inset-right,0px)+1.5rem)]";
  }
  return "bottom-[calc(env(safe-area-inset-bottom,0px)+5.25rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] lg:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] lg:right-[calc(env(safe-area-inset-right,0px)+1.5rem)]";
};

export default function StudentHistoryDictionaryController() {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [saveAnchor, setSaveAnchor] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isStudentRoute =
    location.pathname.startsWith("/student") &&
    !location.pathname.startsWith("/student/lesson/history-dictionary");

  useEffect(() => {
    setSaveAnchor(null);
    if (!location.pathname.startsWith("/student/lesson/note")) return;
    let target: HTMLElement | null = null;
    const measure = () => {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const next = {
        bottom: document.documentElement.clientHeight - rect.top + 12,
        right: document.documentElement.clientWidth - rect.right,
      };
      setSaveAnchor((previous) =>
        previous?.bottom === next.bottom && previous?.right === next.right
          ? previous
          : next,
      );
    };
    const resizeObserver = new ResizeObserver(measure);
    const findControls = () => {
      const next =
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-lesson-save-controls]"),
        )
          .filter((element) => element.getClientRects().length > 0)
          .at(-1) ?? null;
      if (next === target) return;
      resizeObserver.disconnect();
      target = next;
      if (target) {
        resizeObserver.observe(target);
        measure();
      } else setSaveAnchor(null);
    };
    const mutationObserver = new MutationObserver(findControls);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    findControls();
    window.addEventListener("resize", measure);
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [location.pathname, location.search]);

  useEffect(() => {
    setOpen(false);
    if (!isStudentRoute || !currentUser) setVisited(false);
  }, [location.pathname, currentUser?.uid, isStudentRoute]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    } else if (!open && dialog.open) dialog.close();
    if (!open) return;
    return acquirePageScrollLock();
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  if (!currentUser || !isStudentRoute) return null;

  return (
    <>
      <button
        ref={buttonRef}
        data-history-dictionary-launcher="true"
        type="button"
        style={
          location.pathname.startsWith("/student/lesson/note") && saveAnchor
            ? saveAnchor
            : undefined
        }
        onClick={() => {
          setVisited(true);
          setOpen(true);
        }}
        className={`fixed z-[80] inline-flex h-14 w-14 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-700 shadow-[0_18px_42px_rgba(37,99,235,0.22)] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${getFloatingOffsetClassName(location.pathname, location.search)}`}
        aria-label="위스토리 사전 열기"
        title="위스토리 사전"
      >
        <i className="fas fa-book-open text-lg" aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className="history-dictionary-dialog"
        aria-labelledby="floating-history-dictionary-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
      >
        <header className="history-dictionary-dialog-header history-dictionary-row">
          <h2 id="floating-history-dictionary-title">위스토리 사전</h2>
          <button
            className="history-dictionary-dialog-close"
            type="button"
            aria-label="위스토리 사전 닫기"
            onClick={close}
          >
            <i className="fas fa-times" aria-hidden="true" />
          </button>
        </header>
        <div className="history-dictionary-dialog-body">
          {visited && <StudentHistoryDictionaryWorkspace />}
        </div>
      </dialog>
    </>
  );
}
