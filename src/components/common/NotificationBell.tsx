import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import {
  W8DomainError,
  acknowledgeAllNotices,
  acknowledgeNotice,
  formatW8DateTime,
  getW8DomainState,
  type W8DomainState,
  type W8Notice,
} from "../../lib/w8Domains";
import { useAppToast } from "./AppToastProvider";

interface NotificationBellProps {
  className?: string;
  buttonClassName?: string;
  onUnreadCountChange?: (count: number) => void;
}

const formatNotificationTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatW8DateTime(value);

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(date);
};

const getNotificationIconClassName = (notice: W8Notice) =>
  notice.priority === "HIGH" ? "fas fa-bullhorn" : "fas fa-circle-info";

const NotificationBell: React.FC<NotificationBellProps> = ({
  className = "",
  buttonClassName = "",
  onUnreadCountChange,
}) => {
  const navigate = useNavigate();
  const { currentUser, config, configReady, userData } = useAuth();
  const { showToast } = useAppToast();
  const audience = userData?.role === "student" ? "student" : "teacher";
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<W8DomainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const load = useCallback(async () => {
    if (!configReady || !currentUser?.uid) return;
    setLoading(true);
    setError("");
    try {
      setState(
        await getW8DomainState({
          config,
          domain: "COMMUNICATION",
          audience,
          studentUid: audience === "student" ? currentUser.uid : undefined,
          source: "CURRENT",
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught.message
          : "알림을 불러오지 못했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, [audience, config, configReady, currentUser?.uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const deliveryNoticeIds = useMemo(
    () => new Set((state?.deliveries || []).map((item) => item.noticeId)),
    [state?.deliveries],
  );
  const notices = useMemo(
    () =>
      (state?.notices || []).filter(
        (notice) =>
          audience === "student" || deliveryNoticeIds.has(notice.noticeId),
      ),
    [audience, deliveryNoticeIds, state?.notices],
  );
  const unread =
    audience === "student"
      ? notices.filter((notice) => !notice.acknowledged)
      : [];
  const unreadCount = unread.length;
  const displayUnreadCount = unreadCount > 99 ? "99+" : String(unreadCount);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  const targetByNoticeId = useMemo(
    () =>
      new Map(
        (state?.deliveries || []).map((item) => [
          item.noticeId,
          item.targetUrl,
        ]),
      ),
    [state?.deliveries],
  );

  const perform = async (key: string, operation: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(key);
    setError("");
    try {
      await operation();
      await load();
      return true;
    } catch (caught) {
      const message =
        caught instanceof W8DomainError
          ? caught.message
          : "알림 상태를 변경하지 못했습니다.";
      setError(message);
      showToast({ tone: "error", title: "알림 처리 실패", message });
      return false;
    } finally {
      setBusy("");
    }
  };

  const acknowledgeOne = (notice: W8Notice) => {
    if (!state || notice.acknowledged || state.readOnly) {
      return Promise.resolve(false);
    }
    return perform(`notice:${notice.noticeId}`, () =>
      acknowledgeNotice({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        noticeId: notice.noticeId,
        expectedNoticeRevision: notice.revision,
      }),
    );
  };

  const acknowledgeAll = () => {
    if (!state || unread.length === 0 || state.readOnly) {
      return Promise.resolve(false);
    }
    return perform("notice:all", () =>
      acknowledgeAllNotices({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        notices: unread.map((notice) => ({
          noticeId: notice.noticeId,
          expectedNoticeRevision: notice.revision,
        })),
      }),
    );
  };

  const panelTitle = useMemo(
    () => (unreadCount > 0 ? `새 알림 ${displayUnreadCount}개` : "알림"),
    [displayUnreadCount, unreadCount],
  );
  const hasNotifications = notices.length > 0;

  if (!currentUser) return null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-session-action="true"
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 ${buttonClassName}`}
        aria-label={panelTitle}
        aria-expanded={open}
      >
        <i className="fas fa-bell text-sm" aria-hidden="true"></i>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-extrabold leading-5 text-white shadow-sm">
            {displayUnreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[4.25rem] z-[130] overflow-hidden rounded-lg border border-stone-200 bg-white shadow-2xl sm:left-auto sm:right-4 sm:w-[360px] lg:absolute lg:right-0 lg:top-11">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <div>
              <div className="text-sm font-extrabold text-stone-900">
                {panelTitle}
              </div>
              <div className="mt-0.5 text-xs font-medium text-stone-500">
                최근 알림을 확인할 수 있습니다.
              </div>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              data-session-action="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
              aria-label="알림 닫기"
            >
              <i className="fas fa-times text-xs" aria-hidden="true"></i>
            </button>
          </div>

          {error && (
            <p className="ws-notification__error" role="alert">
              {error}
            </p>
          )}
          {state?.readOnly && state.reason && !error && (
            <p className="ws-notification__error" role="status">
              {state.reason}
            </p>
          )}

          <div className="max-h-[min(70vh,420px)] overflow-y-auto">
            {loading && (
              <p className="ws-notification__empty" role="status">
                알림을 불러오고 있습니다.
              </p>
            )}
            {!loading && !error && !hasNotifications && (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-400">
                  <i className="fas fa-bell-slash" aria-hidden="true"></i>
                </div>
                <div className="mt-3 text-sm font-bold text-stone-700">
                  받은 알림이 없습니다.
                </div>
              </div>
            )}

            {notices.map((notice) => {
              const noticeUnread =
                audience === "student" && !notice.acknowledged;
              const savedTarget = targetByNoticeId.get(notice.noticeId) || "";
              const retiredTarget =
                /^\/(?:teacher|student)\/(?:learning|schedule|attendance|communication)(?:[/?#]|$)/u.test(
                  savedTarget.replace(/^#/u, ""),
                );
              const targetUrl = retiredTarget ? "" : savedTarget;
              const canAcknowledge =
                noticeUnread && Boolean(state) && !state?.readOnly;
              const actionable = Boolean(targetUrl) || canAcknowledge;
              const rowClassName = `flex w-full items-start gap-3 px-4 py-3 text-left ${
                actionable
                  ? "transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  : ""
              }`;
              const rowContent = (
                <>
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                    <i
                      className={`${getNotificationIconClassName(notice)} text-xs`}
                      aria-hidden="true"
                    ></i>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-extrabold text-stone-900">
                        {notice.title}
                      </span>
                      {noticeUnread && (
                        <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
                      )}
                    </span>
                    {notice.content && (
                      <span className="mt-1 block truncate text-xs font-medium leading-5 text-stone-600">
                        {notice.content}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] font-bold text-stone-400">
                      {formatNotificationTime(notice.publishAt)}
                    </span>
                  </span>
                </>
              );
              return (
                <div
                  key={notice.noticeId}
                  className={`border-b border-stone-100 ${
                    noticeUnread ? "bg-blue-50/60" : "bg-white"
                  }`}
                >
                  {actionable ? (
                    <button
                      type="button"
                      className={rowClassName}
                      disabled={busy === `notice:${notice.noticeId}`}
                      onClick={() => {
                        if (canAcknowledge) void acknowledgeOne(notice);
                        setOpen(false);
                        if (targetUrl) navigate(targetUrl);
                      }}
                      data-session-action="true"
                    >
                      {rowContent}
                    </button>
                  ) : (
                    <div className={rowClassName}>{rowContent}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end border-t border-stone-100 bg-stone-50 px-4 py-3">
            <button
              type="button"
              onClick={() => void acknowledgeAll()}
              data-session-action="true"
              disabled={
                !hasNotifications ||
                unreadCount === 0 ||
                audience !== "student" ||
                state?.readOnly ||
                busy === "notice:all"
              }
              className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-extrabold text-stone-600 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="fas fa-trash-can" aria-hidden="true"></i>
              {busy === "notice:all" ? "삭제 중..." : "알림 목록 삭제"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
