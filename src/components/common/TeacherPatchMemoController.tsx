import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { isAdminUser } from "../../lib/permissions";
import {
  createTeacherPatchNote,
  deleteTeacherPatchNote,
  subscribeTeacherPatchNotes,
  updateTeacherPatchNote,
  updateTeacherPatchNoteStatus,
  type TeacherPatchNote,
  type TeacherPatchNotePriority,
  type TeacherPatchNoteStatus,
  type TeacherPatchNoteTargetRect,
  type TeacherPatchNoteType,
} from "../../lib/teacherPatchNotes";
import { useAppToast } from "./AppToastProvider";

const PATCH_MEMO_ROOT_SELECTOR = "[data-patch-memo-root]";
const PATCH_TARGET_SELECTOR = "[data-patch-target]";
const SELECTABLE_SELECTOR = [
  PATCH_TARGET_SELECTOR,
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[aria-label]",
  "section",
  "article",
  "[class*='teacher-dashboard']",
  "[class*='rounded-2xl']",
  "[class*='rounded-xl']",
].join(",");

const TYPE_LABELS: Record<TeacherPatchNoteType, string> = {
  bug: "버그",
  improvement: "개선",
  content: "콘텐츠",
  etc: "기타",
};

const TYPE_OPTIONS: Array<{
  value: TeacherPatchNoteType;
  icon: string;
  className: string;
}> = [
  {
    value: "bug",
    icon: "fa-bug",
    className: "border-rose-200 bg-rose-50 text-rose-700",
  },
  {
    value: "improvement",
    icon: "fa-wand-magic-sparkles",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  {
    value: "content",
    icon: "fa-cubes-stacked",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  },
  {
    value: "etc",
    icon: "fa-thumbtack",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
];

const PRIORITY_OPTIONS: Array<{
  value: TeacherPatchNotePriority;
  label: string;
  icon: string;
}> = [
  { value: "normal", label: "보통", icon: "fa-droplet" },
  { value: "high", label: "높음", icon: "fa-fire" },
];

const trimWhitespace = (value: unknown) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const truncate = (value: unknown, maxLength: number) =>
  trimWhitespace(value).slice(0, maxLength);

const getCurrentPath = (location: ReturnType<typeof useLocation>) =>
  `${location.pathname}${location.search || ""}` || "/teacher";

const getTimestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return Number((value as { seconds?: number }).seconds || 0) * 1000;
};

const formatNoteDate = (value: unknown) => {
  const timestamp = getTimestampMs(value);
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
};

const escapeAttrValue = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getElementText = (element: Element) => {
  if (element instanceof HTMLInputElement) {
    return element.value || element.placeholder || "";
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value || element.placeholder || "";
  }
  if (element instanceof HTMLSelectElement) {
    return element.selectedOptions[0]?.textContent || "";
  }
  return (element as HTMLElement).innerText || element.textContent || "";
};

const getElementLabel = (element: HTMLElement) => {
  const dataset = element.dataset || {};
  return (
    dataset.patchLabel ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    truncate(getElementText(element), 80) ||
    element.tagName.toLowerCase()
  );
};

const getNthOfType = (element: Element) => {
  let index = 1;
  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === element.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
};

const buildFallbackSelector = (element: HTMLElement) => {
  if (element.id) return `#${element.id}`;
  const dataTarget = element.dataset?.patchTarget;
  if (dataTarget) {
    return `[data-patch-target="${escapeAttrValue(dataTarget)}"]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current instanceof HTMLElement && parts.length < 4) {
    if (current.id) {
      parts.unshift(`#${current.id}`);
      break;
    }
    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}:nth-of-type(${getNthOfType(current)})`);
    current = current.parentElement;
    if (current === document.body) break;
  }
  return parts.join(" > ");
};

const findSelectableElement = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return null;
  if (target.closest(PATCH_MEMO_ROOT_SELECTOR)) return null;
  const candidate =
    target.closest<HTMLElement>(PATCH_TARGET_SELECTOR) ||
    target.closest<HTMLElement>(SELECTABLE_SELECTOR);
  if (
    !candidate ||
    candidate === document.body ||
    candidate === document.documentElement
  ) {
    return null;
  }
  return candidate;
};

const getElementRect = (element: HTMLElement): TeacherPatchNoteTargetRect => {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};

type FilterKey = "open" | "all" | "done";

const TeacherPatchMemoController: React.FC = () => {
  const { currentUser, userData } = useAuth();
  const { showToast } = useAppToast();
  const location = useLocation();
  const currentPath = useMemo(() => getCurrentPath(location), [location]);
  const isTeacherRoute = location.pathname.startsWith("/teacher");
  const canUsePatchMemo = isAdminUser(userData, currentUser?.email);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<TeacherPatchNote[]>([]);
  const [filter, setFilter] = useState<FilterKey>("open");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<TeacherPatchNoteType>("bug");
  const [priority, setPriority] = useState<TeacherPatchNotePriority>("normal");
  const [sourcePath, setSourcePath] = useState(currentPath);
  const [targetLabel, setTargetLabel] = useState("");
  const [targetText, setTargetText] = useState("");
  const [targetSelector, setTargetSelector] = useState("");
  const [targetRect, setTargetRect] =
    useState<TeacherPatchNoteTargetRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  const [hoverRect, setHoverRect] = useState<TeacherPatchNoteTargetRect | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const uid = currentUser?.uid || "";

  useEffect(() => {
    if (!uid || !isTeacherRoute || !canUsePatchMemo) {
      setNotes([]);
      return undefined;
    }
    return subscribeTeacherPatchNotes(uid, setNotes, () =>
      showToast({
        tone: "error",
        title: "패치 메모를 불러오지 못했습니다.",
        message: "권한이나 네트워크 상태를 확인해 주세요.",
      }),
    );
  }, [canUsePatchMemo, isTeacherRoute, showToast, uid]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => titleRef.current?.focus(), 80);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !selectingTarget) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, selectingTarget]);

  useEffect(() => {
    if (!selectingTarget) {
      setHoverRect(null);
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "crosshair";

    const handleMouseMove = (event: MouseEvent) => {
      const candidate = findSelectableElement(event.target);
      setHoverRect(candidate ? getElementRect(candidate) : null);
    };

    const handleClick = (event: MouseEvent) => {
      const candidate = findSelectableElement(event.target);
      if (!candidate) return;
      event.preventDefault();
      event.stopPropagation();
      const label = truncate(getElementLabel(candidate), 120);
      setSourcePath(currentPath);
      setTargetLabel(label);
      setTargetText(truncate(getElementText(candidate), 240));
      setTargetSelector(buildFallbackSelector(candidate));
      setTargetRect(getElementRect(candidate));
      setSelectingTarget(false);
      setOpen(true);
      showToast({
        tone: "success",
        title: "관련 위치를 기록했습니다.",
        message: label ? `${label} 영역을 메모에 연결했습니다.` : undefined,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSelectingTarget(false);
      setOpen(true);
    };

    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.body.style.cursor = previousCursor;
      document.removeEventListener("mousemove", handleMouseMove, true);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [currentPath, selectingTarget, showToast]);

  useEffect(() => {
    setSelectingTarget(false);
    setHoverRect(null);
  }, [location.pathname, location.search]);

  if (!currentUser || !isTeacherRoute || !canUsePatchMemo) return null;

  const resetForm = (nextPath = currentPath) => {
    setEditingNoteId(null);
    setTitle("");
    setBody("");
    setType("bug");
    setPriority("normal");
    setSourcePath(nextPath);
    setTargetLabel("");
    setTargetText("");
    setTargetSelector("");
    setTargetRect(null);
  };

  const openPanel = () => {
    if (selectingTarget) {
      setSelectingTarget(false);
      setOpen(true);
      return;
    }
    if (!open) {
      resetForm(currentPath);
      setOpen(true);
      return;
    }
    setOpen(false);
    setSelectingTarget(false);
  };

  const startEdit = (note: TeacherPatchNote) => {
    setEditingNoteId(note.id);
    setTitle(note.title);
    setBody(note.body);
    setType(note.type);
    setPriority(note.priority);
    setSourcePath(note.sourcePath || currentPath);
    setTargetLabel(note.targetLabel || "");
    setTargetText(note.targetText || "");
    setTargetSelector(note.targetSelector || "");
    setTargetRect(note.targetRect || null);
    setOpen(true);
  };

  const buildInput = () => {
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    return {
      title:
        trimmedTitle || truncate(trimmedBody.split("\n")[0] || "패치 메모", 80),
      body: trimmedBody,
      type,
      priority,
      sourcePath: sourcePath || currentPath,
      targetLabel,
      targetText,
      targetSelector,
      targetRect,
    };
  };

  const handleSubmit = async () => {
    if (saving) return;
    if (!title.trim() && !body.trim()) {
      showToast({
        tone: "warning",
        title: "메모 내용을 입력해 주세요.",
        message: "제목이나 상세 메모 중 하나는 필요합니다.",
      });
      return;
    }

    const input = buildInput();
    setSaving(true);
    try {
      if (editingNoteId) {
        const originalStatus =
          notes.find((note) => note.id === editingNoteId)?.status || "open";
        await updateTeacherPatchNote(uid, editingNoteId, {
          ...input,
          status: originalStatus,
        });
        showToast({ tone: "success", title: "패치 메모를 수정했습니다." });
      } else {
        await createTeacherPatchNote(uid, input);
        showToast({ tone: "success", title: "패치 메모를 추가했습니다." });
      }
      resetForm(currentPath);
    } catch (error) {
      console.error("Failed to save teacher patch note:", error);
      showToast({
        tone: "error",
        title: "패치 메모를 저장하지 못했습니다.",
        message: "내용을 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (
    note: TeacherPatchNote,
    status: TeacherPatchNoteStatus,
  ) => {
    try {
      await updateTeacherPatchNoteStatus(uid, note, status);
    } catch (error) {
      console.error("Failed to update teacher patch note status:", error);
      showToast({
        tone: "error",
        title: "처리 상태를 바꾸지 못했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  const handleDelete = async (note: TeacherPatchNote) => {
    const confirmed = window.confirm(
      `"${note.title || "패치 메모"}" 메모를 삭제할까요?`,
    );
    if (!confirmed) return;
    try {
      await deleteTeacherPatchNote(uid, note.id);
      if (editingNoteId === note.id) resetForm(currentPath);
      showToast({ tone: "success", title: "패치 메모를 삭제했습니다." });
    } catch (error) {
      console.error("Failed to delete teacher patch note:", error);
      showToast({
        tone: "error",
        title: "패치 메모를 삭제하지 못했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  const openCount = notes.filter((note) => note.status === "open").length;
  const doneCount = notes.filter((note) => note.status === "done").length;
  const filteredNotes = notes.filter((note) => {
    if (filter === "all") return true;
    return note.status === filter;
  });
  const hasLinkedTarget = Boolean(targetLabel || targetText || targetSelector);

  return (
    <>
      {selectingTarget && (
        <div
          className="pointer-events-none fixed inset-0 z-[118]"
          aria-hidden="true"
        >
          <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-full border border-blue-200 bg-white px-4 py-2 text-sm font-extrabold text-blue-700 shadow-lg">
            기록할 화면 영역을 선택하세요. 취소는 Esc
          </div>
          {hoverRect && (
            <div
              className="absolute rounded-xl border-2 border-blue-500 bg-blue-500/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.10)]"
              style={{
                left: hoverRect.x,
                top: hoverRect.y,
                width: hoverRect.width,
                height: hoverRect.height,
              }}
            />
          )}
        </div>
      )}

      {open && (
        <aside
          data-patch-memo-root="true"
          role="dialog"
          aria-modal="false"
          aria-labelledby="teacher-patch-memo-title"
          className="fixed bottom-0 right-0 z-[110] flex h-[min(84vh,720px)] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:bottom-[6.25rem] sm:right-6 sm:h-[min(76vh,720px)] sm:w-[390px] sm:rounded-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2
                id="teacher-patch-memo-title"
                className="text-base font-extrabold text-slate-950"
              >
                패치 메모
              </h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                교사 개인 메모
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSelectingTarget(false);
                buttonRef.current?.focus();
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
              aria-label="패치 메모 닫기"
            >
              <i className="fas fa-times text-sm" aria-hidden="true"></i>
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
              <label className="block">
                <span className="text-xs font-extrabold text-slate-700">
                  한 줄 메모
                </span>
                <input
                  ref={titleRef}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={80}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="예: 알림장 이미지 수정 필요"
                />
              </label>

              <label className="mt-3 block">
                <span className="text-xs font-extrabold text-slate-700">
                  상세 메모
                </span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  maxLength={2000}
                  className="mt-1 min-h-[5.5rem] w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-6 text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  placeholder="버그, 수정 요청, 개선 아이디어를 적어 주세요."
                />
              </label>

              <div className="mt-3">
                <div className="text-xs font-extrabold text-slate-700">
                  유형
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  {TYPE_OPTIONS.map((option) => {
                    const active = type === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setType(option.value)}
                        className={`inline-flex min-h-9 items-center justify-center gap-1 rounded-full border px-2 text-xs font-extrabold transition ${
                          active
                            ? option.className
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                        aria-pressed={active}
                      >
                        <i
                          className={`fas ${option.icon} text-[11px]`}
                          aria-hidden="true"
                        ></i>
                        {TYPE_LABELS[option.value]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs font-extrabold text-slate-700">
                  우선순위
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {PRIORITY_OPTIONS.map((option) => {
                    const active = priority === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setPriority(option.value)}
                        className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-full border px-3 text-xs font-extrabold transition ${
                          active
                            ? option.value === "high"
                              ? "border-rose-200 bg-rose-50 text-rose-700"
                              : "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                        }`}
                        aria-pressed={active}
                      >
                        <i
                          className={`fas ${option.icon} text-[11px]`}
                          aria-hidden="true"
                        ></i>
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-slate-500">
                      현재 위치
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-800">
                      {sourcePath || currentPath}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !selectingTarget;
                      setSelectingTarget(next);
                      if (next) {
                        setOpen(false);
                        showToast({
                          tone: "info",
                          title: "화면 위치를 선택합니다.",
                          message:
                            "기록할 카드나 버튼을 누르면 메모에 연결됩니다.",
                        });
                      }
                    }}
                    className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full border px-3 text-xs font-extrabold transition ${
                      selectingTarget
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    }`}
                  >
                    <i
                      className={`fas ${selectingTarget ? "fa-xmark" : "fa-location-crosshairs"} text-[11px]`}
                      aria-hidden="true"
                    ></i>
                    {selectingTarget ? "선택 취소" : "화면 위치 선택"}
                  </button>
                </div>

                {hasLinkedTarget && (
                  <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
                    <div className="font-extrabold">
                      관련 위치: {targetLabel || "선택한 화면 영역"}
                    </div>
                    {targetText && (
                      <div className="mt-0.5 line-clamp-2 text-blue-800/80">
                        {targetText}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                {editingNoteId && (
                  <button
                    type="button"
                    onClick={() => resetForm(currentPath)}
                    className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50"
                  >
                    새 메모
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={saving}
                  className="inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <i
                    className={`fas ${editingNoteId ? "fa-floppy-disk" : "fa-plus"} text-xs`}
                    aria-hidden="true"
                  ></i>
                  {saving ? "저장 중" : editingNoteId ? "수정 저장" : "추가"}
                </button>
              </div>
            </section>

            <section className="mt-4">
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "open" as const, label: "미처리", count: openCount },
                  { key: "all" as const, label: "전체", count: notes.length },
                  { key: "done" as const, label: "완료", count: doneCount },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`min-h-9 rounded-full border px-3 text-xs font-extrabold transition ${
                      filter === item.key
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {item.label} {item.count}
                  </button>
                ))}
              </div>

              {!filteredNotes.length && (
                <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-500">
                  표시할 패치 메모가 없습니다.
                </div>
              )}

              <div className="mt-3 space-y-2">
                {filteredNotes.map((note) => {
                  const completed = note.status === "done";
                  return (
                    <article
                      key={note.id}
                      className={`rounded-2xl border bg-white px-3 py-3 transition ${
                        editingNoteId === note.id
                          ? "border-blue-200 shadow-sm"
                          : "border-slate-200"
                      } ${completed ? "opacity-75" : ""}`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            void handleStatusChange(
                              note,
                              completed ? "open" : "done",
                            )
                          }
                          className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs transition ${
                            completed
                              ? "border-blue-500 bg-blue-600 text-white"
                              : "border-slate-300 bg-white text-transparent hover:border-blue-300 hover:text-blue-500"
                          }`}
                          aria-label={
                            completed
                              ? "패치 메모 미처리로 변경"
                              : "패치 메모 완료 처리"
                          }
                        >
                          <i className="fas fa-check" aria-hidden="true"></i>
                        </button>

                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                                note.type === "bug"
                                  ? "bg-rose-50 text-rose-700"
                                  : note.type === "improvement"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : note.type === "content"
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {TYPE_LABELS[note.type]}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                                note.priority === "high"
                                  ? "bg-rose-50 text-rose-700"
                                  : "bg-blue-50 text-blue-700"
                              }`}
                            >
                              {note.priority === "high" ? "높음" : "보통"}
                            </span>
                            {completed && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-extrabold text-slate-500">
                                완료됨
                              </span>
                            )}
                          </div>
                          <h3
                            className={`mt-2 line-clamp-2 text-sm font-extrabold leading-5 text-slate-900 ${
                              completed
                                ? "line-through decoration-slate-400"
                                : ""
                            }`}
                          >
                            {note.title || "패치 메모"}
                          </h3>
                          {note.body && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                              {note.body}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold text-slate-500">
                            <span className="truncate">{note.sourcePath}</span>
                            {note.targetLabel && (
                              <span className="truncate">
                                {note.targetLabel}
                              </span>
                            )}
                            {formatNoteDate(note.updatedAt) && (
                              <span>{formatNoteDate(note.updatedAt)}</span>
                            )}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleDelete(note)}
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-100"
                          aria-label="패치 메모 삭제"
                        >
                          <i
                            className="fas fa-trash-can text-xs"
                            aria-hidden="true"
                          ></i>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </div>
        </aside>
      )}

      <button
        ref={buttonRef}
        data-patch-memo-root="true"
        type="button"
        onClick={openPanel}
        className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] right-[calc(env(safe-area-inset-right,0px)+1rem)] z-[112] inline-flex h-14 w-14 items-center justify-center rounded-full border shadow-[0_18px_42px_rgba(37,99,235,0.30)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:right-[calc(env(safe-area-inset-right,0px)+1.5rem)] ${
          open
            ? "border-blue-500 bg-blue-600 text-white hover:bg-blue-700"
            : "border-blue-100 bg-white text-blue-700 hover:bg-blue-50"
        }`}
        aria-label={open ? "패치 메모 닫기" : "패치 메모 열기"}
        aria-expanded={open}
        title="패치 메모"
      >
        <i
          className={`fas ${open ? "fa-times" : "fa-pen"} text-lg`}
          aria-hidden="true"
        ></i>
        {openCount > 0 && !open && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-6 items-center justify-center rounded-full border-2 border-white bg-rose-500 px-1.5 py-0.5 text-[11px] font-extrabold text-white">
            {openCount > 99 ? "99+" : openCount}
          </span>
        )}
      </button>
    </>
  );
};

export default TeacherPatchMemoController;
