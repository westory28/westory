import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { getStudentMenuLabel } from "../../constants/menus";
import { acquirePageScrollLock } from "../../lib/pageScrollLock";
import StudentHistoryDictionaryWorkspace from "./StudentHistoryDictionaryWorkspace";
import { useFloatingLauncherVisibility } from "./useFloatingLauncherVisibility";
import "./studentLearningTools.css";

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
  const { currentUser, menuConfig } = useAuth();
  const title = getStudentMenuLabel(
    menuConfig,
    "/student/lesson/history-dictionary",
    "역사 사전",
  );
  const location = useLocation();
  const [saveAnchor, setSaveAnchor] = useState<{
    bottom: number;
    right: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState({ bottom: 0, right: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isStudentRoute =
    location.pathname.startsWith("/student") &&
    !location.pathname.startsWith("/student/lesson/history-dictionary");

  const focusLauncherWhenVisible = useFloatingLauncherVisibility(
    buttonRef,
    Boolean(currentUser && isStudentRoute),
    open,
  );

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
    setMenuOpen(false);
    if (!isStudentRoute || !currentUser) setVisited(false);
  }, [location.pathname, location.search, currentUser?.uid, isStudentRoute]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const launcher = buttonRef.current;
    const menu = menuRef.current;
    if (!launcher || !menu) return;
    const placeMenu = () => {
      const rect = launcher.getBoundingClientRect();
      setMenuAnchor({
        bottom: document.documentElement.clientHeight - rect.top + 12,
        right: document.documentElement.clientWidth - rect.right + 4,
      });
    };
    const dismissOutside = (event: Event) => {
      const target = event.target as Node;
      if (!launcher.contains(target) && !menu.contains(target))
        setMenuOpen(false);
    };
    const visibilityObserver = new MutationObserver(() => {
      if (launcher.hasAttribute("data-launcher-obscured")) setMenuOpen(false);
    });
    visibilityObserver.observe(launcher, {
      attributes: true,
      attributeFilter: ["data-launcher-obscured"],
    });
    placeMenu();
    menu.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("focusin", dismissOutside);
    return () => {
      visibilityObserver.disconnect();
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("focusin", dismissOutside);
    };
  }, [menuOpen, saveAnchor]);

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
    focusLauncherWhenVisible();
    setOpen(false);
  };
  if (!currentUser || !isStudentRoute) return null;

  return (
    <>
      {menuOpen && (
        <div className="student-learning-tools-scrim" aria-hidden="true" />
      )}
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
          setMenuOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            setMenuOpen(true);
            menuRef.current
              ?.querySelector<HTMLButtonElement>("button")
              ?.focus();
          }
          if (event.key === "Escape") setMenuOpen(false);
        }}
        className={`fixed z-[80] inline-flex h-14 w-14 items-center justify-center rounded-full border border-blue-100 bg-white text-blue-700 shadow-[0_18px_42px_rgba(37,99,235,0.22)] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${getFloatingOffsetClassName(location.pathname, location.search)}`}
        aria-label={menuOpen ? "학습 도구 닫기" : "학습 도구 열기"}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        aria-controls={menuOpen ? "student-learning-tools-menu" : undefined}
        title="학습 도구"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          {menuOpen ? (
            <path d="m6 6 12 12M18 6 6 18" />
          ) : (
            <>
              <path d="M12 20V6m0 0C9 3 5 3 3 4v14c3-1 6 0 9 2 3-2 6-3 9-2V4c-2-1-6-1-9 2Z" />
              <path d="m9 10 3-3 3 3" />
            </>
          )}
        </svg>
      </button>
      {menuOpen && (
        <div
          ref={menuRef}
          id="student-learning-tools-menu"
          className="student-learning-tools-menu"
          style={menuAnchor}
          role="menu"
          aria-label="학습 도구"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
              buttonRef.current?.focus();
            }
            if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ) ?? [],
              );
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : (index +
                        (event.key === "ArrowUp" ? -1 : 1) +
                        items.length) %
                      items.length;
              items[next]?.focus();
            }
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setVisited(true);
              setOpen(true);
            }}
          >
            <span className="student-learning-tools-label">{title}</span>
            <span className="student-learning-tools-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M12 20V6m0 0C9 3 5 3 3 4v14c3-1 6 0 9 2 3-2 6-3 9-2V4c-2-1-6-1-9 2Z" />
              </svg>
            </span>
          </button>
        </div>
      )}
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
          <h2 id="floating-history-dictionary-title">{title}</h2>
          <button
            className="history-dictionary-dialog-close"
            type="button"
            aria-label={`${title} 닫기`}
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
