import React, { useEffect, useId, useRef, useState } from "react";
import NoticeModal from "./NoticeModal";
import NoticeOrderModal from "./NoticeOrderModal";

export interface ManagedNotice {
  id: string;
  category: string;
  targetType: string;
  targetClass?: string;
  content?: string;
  imageUrl?: string;
  publishAt?: unknown;
  expiresAt?: unknown;
}

interface Props {
  notices: ManagedNotice[];
  initialNotice?: ManagedNotice;
  initialOrder?: boolean;
  recommendedImageSize?: { width: number; height: number };
  onClose: () => void;
}

const categoryLabel = (category: string) =>
  ({
    event: "학교 행사",
    exam: "정기 시험",
    performance: "수행평가",
    prep: "준비",
    dday: "D-Day",
  })[category] || "공지";
const period = (value: unknown, fallback: string) => {
  if (!value) return fallback;
  const date =
    typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString("ko-KR", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const buttonClass =
  "min-h-11 rounded-lg border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50";

const NoticeManagerModal: React.FC<Props> = ({
  notices,
  initialNotice,
  initialOrder = false,
  recommendedImageSize,
  onClose,
}) => {
  const titleId = useId();
  const [selected, setSelected] = useState(initialNotice);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ordering, setOrdering] = useState(initialOrder);
  const [preview, setPreview] = useState("");
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previewBack = useRef<HTMLButtonElement>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  const pageCount = Math.max(1, Math.ceil(notices.length / 3));
  const visiblePage = Math.min(page, pageCount - 1);
  const mayLeave = () =>
    !busy &&
    (!dirty ||
      window.confirm(
        "저장하지 않은 변경 사항이 있습니다. 변경 내용을 버리시겠습니까?",
      ));
  const close = () => {
    if (mayLeave()) onClose();
  };
  const reset = () => {
    setSelected(undefined);
    setEditorKey((key) => key + 1);
    setDirty(false);
  };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      opener?.focus();
    };
  }, []);
  useEffect(() => {
    if (preview) previewBack.current?.focus();
  }, [preview]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const target = closeRef.current?.disabled
        ? dialogRef.current
        : closeRef.current;
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editorKey, ordering]);
  useEffect(() => {
    if (busy) dialogRef.current?.focus();
    else if (document.activeElement === dialogRef.current)
      closeRef.current?.focus();
  }, [busy]);
  const showPreview = (url: string) => {
    previewOpener.current = document.activeElement as HTMLElement;
    setPreview(url);
  };
  const hidePreview = () => {
    setPreview("");
    requestAnimationFrame(() => previewOpener.current?.focus());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={close}
    >
      <div
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="notice-image-manager rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (preview) hidePreview();
            else close();
          }
          if (event.key !== "Tab") return;
          const controls = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ) || [],
          ).filter((element) => element.getClientRects().length > 0);
          if (!controls.length) {
            event.preventDefault();
            dialogRef.current?.focus();
            return;
          }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <h2 id={titleId} className="text-xl font-extrabold text-gray-900">
            알림장 이미지 관리
          </h2>
          <button
            ref={closeRef}
            type="button"
            className={buttonClass}
            aria-label="알림장 관리 닫기"
            disabled={busy}
            onClick={close}
          >
            닫기
          </button>
        </div>
        <div className="notice-image-manager__body">
          {preview && (
            <div>
              <button
                ref={previewBack}
                type="button"
                className={`${buttonClass} mb-3`}
                onClick={hidePreview}
              >
                편집으로 돌아가기
              </button>
              <img
                src={preview}
                alt="알림장 크게 미리보기"
                className="max-h-[70vh] w-full object-contain"
              />
            </div>
          )}
          <div
            className="notice-image-manager__columns"
            hidden={Boolean(preview)}
          >
            <div className="notice-image-manager__editor">
              {ordering ? (
                <NoticeOrderModal
                  isOpen
                  embedded
                  notices={notices}
                  onBusyChange={setBusy}
                  onDirtyChange={setDirty}
                  onClose={() => {
                    setOrdering(false);
                    reset();
                  }}
                />
              ) : (
                <NoticeModal
                  key={editorKey}
                  isOpen
                  embedded
                  noticeData={selected}
                  recommendedImageSize={recommendedImageSize}
                  onClose={reset}
                  onSave={() => {
                    setDirty(false);
                  }}
                  onBusyChange={setBusy}
                  onDirtyChange={setDirty}
                  onPreview={showPreview}
                />
              )}
            </div>
            <section
              className="notice-image-manager__list"
              aria-label="등록된 알림장"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-bold text-gray-900">
                  등록된 이미지 {notices.length}개
                </h3>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    if (mayLeave()) {
                      setOrdering(false);
                      reset();
                    }
                  }}
                >
                  새 등록
                </button>
              </div>
              {!notices.length && (
                <p className="py-4 text-sm text-gray-500">
                  등록된 이미지가 없습니다.
                </p>
              )}
              <ol
                className="divide-y divide-gray-200"
                start={visiblePage * 3 + 1}
              >
                {notices
                  .slice(visiblePage * 3, visiblePage * 3 + 3)
                  .map((notice, offset) => (
                    <li
                      key={notice.id}
                      className="py-3"
                      aria-current={
                        selected?.id === notice.id ? "true" : undefined
                      }
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          className="w-16 shrink-0 overflow-hidden rounded border border-gray-200 text-xs font-bold text-blue-700"
                          disabled={busy || !notice.imageUrl}
                          aria-label={`${visiblePage * 3 + offset + 1}번째 알림장 미리보기`}
                          onClick={() => showPreview(notice.imageUrl!)}
                        >
                          <img
                            src={notice.imageUrl}
                            alt=""
                            className="aspect-video w-full object-contain"
                          />
                          <span className="block py-2">미리보기</span>
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-gray-900">
                            {visiblePage * 3 + offset + 1}.{" "}
                            {notice.content || categoryLabel(notice.category)}
                          </p>
                          <p className="text-xs leading-5 text-gray-600">
                            {notice.targetType === "class"
                              ? `${notice.targetClass}반`
                              : "전체 공통"}
                          </p>
                          <p className="text-xs leading-5 text-gray-500">
                            {period(notice.publishAt, "바로 게시")} ~<br />
                            {period(notice.expiresAt, "종료 제한 없음")}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={`${buttonClass} mt-2 w-full`}
                        disabled={busy}
                        onClick={() => {
                          if (mayLeave()) {
                            setOrdering(false);
                            setSelected(notice);
                            setEditorKey((key) => key + 1);
                            setDirty(false);
                          }
                        }}
                      >
                        수정 · 삭제
                      </button>
                    </li>
                  ))}
              </ol>
              {pageCount > 1 && (
                <nav
                  aria-label="알림장 목록 페이지"
                  className="mt-2 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || visiblePage === 0}
                    onClick={() => setPage(visiblePage - 1)}
                  >
                    이전
                  </button>
                  <span className="text-sm text-gray-600">
                    {visiblePage + 1} / {pageCount}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy || visiblePage === pageCount - 1}
                    onClick={() => setPage(visiblePage + 1)}
                  >
                    다음
                  </button>
                </nav>
              )}
              <button
                type="button"
                className={`${buttonClass} mt-3 w-full`}
                disabled={busy || ordering || notices.length < 2}
                onClick={() => {
                  if (mayLeave()) {
                    setDirty(false);
                    setOrdering(true);
                  }
                }}
              >
                순서 편집
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoticeManagerModal;
