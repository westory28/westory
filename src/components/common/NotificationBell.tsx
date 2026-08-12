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
  const countLabel = unreadCount > 99 ? "99+" : String(unreadCount);

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
    setBusy(key);
    setError("");
    try {
      await operation();
      await load();
    } catch (caught) {
      const message =
        caught instanceof W8DomainError
          ? caught.message
          : "알림 상태를 변경하지 못했습니다.";
      setError(message);
      showToast({ tone: "error", title: "알림 처리 실패", message });
    } finally {
      setBusy("");
    }
  };

  const acknowledgeOne = (notice: W8Notice) => {
    if (!state || notice.acknowledged) return;
    void perform(`notice:${notice.noticeId}`, () =>
      acknowledgeNotice({
        semesterId: state.semesterId,
        expectedSemesterRevision: state.manifestRevision,
        noticeId: notice.noticeId,
        expectedNoticeRevision: notice.revision,
      }),
    );
  };

  const acknowledgeAll = () => {
    if (!state || unread.length === 0) return;
    void perform("notice:all", () =>
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

  if (!currentUser) return null;
  const panelTitle = unreadCount > 0 ? `확인할 알림 ${countLabel}개` : "알림";

  return (
    <div ref={rootRef} className={`ws-notification ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`ws-notification__trigger ${buttonClassName}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={panelTitle}
        aria-expanded={open}
        aria-controls="westory-notification-panel"
        data-session-action="true"
      >
        <i className="fas fa-bell" aria-hidden="true" />
        {unreadCount > 0 && <span>{countLabel}</span>}
      </button>
      {open && (
        <section
          id="westory-notification-panel"
          className="ws-notification__panel"
          role="dialog"
          aria-label={panelTitle}
        >
          <header>
            <div>
              <strong>{panelTitle}</strong>
              <p>목록을 여는 것만으로 읽음 처리되지 않습니다.</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={() => setOpen(false)}
              aria-label="알림 닫기"
            >
              <i className="fas fa-times" aria-hidden="true" />
            </button>
          </header>
          {error && (
            <p className="ws-notification__error" role="alert">
              {error}
            </p>
          )}
          <div className="ws-notification__list">
            {loading && (
              <p className="ws-notification__empty" role="status">
                알림을 불러오고 있습니다.
              </p>
            )}
            {!loading && notices.length === 0 && (
              <p className="ws-notification__empty">받은 알림이 없습니다.</p>
            )}
            {notices.map((notice) => {
              const targetUrl =
                targetByNoticeId.get(notice.noticeId) ||
                (audience === "teacher" ? "/teacher/communication" : "");
              return (
                <article
                  key={notice.noticeId}
                  className={
                    audience === "student" && !notice.acknowledged
                      ? "is-unread"
                      : ""
                  }
                >
                  <div>
                    <strong>{notice.title}</strong>
                    <p>{notice.content}</p>
                    <span>{formatW8DateTime(notice.publishAt)}</span>
                  </div>
                  <div className="ws-notification__actions">
                    {targetUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          navigate(targetUrl);
                        }}
                      >
                        내용 보기
                      </button>
                    )}
                    {audience === "student" &&
                      !notice.acknowledged &&
                      state &&
                      !state.readOnly && (
                        <button
                          type="button"
                          disabled={busy === `notice:${notice.noticeId}`}
                          onClick={() => acknowledgeOne(notice)}
                        >
                          {busy === `notice:${notice.noticeId}`
                            ? "처리 중"
                            : "확인"}
                        </button>
                      )}
                    {audience === "student" && notice.acknowledged && (
                      <span>확인함</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {audience === "student" &&
            unreadCount > 0 &&
            state &&
            !state.readOnly && (
              <footer>
                <button
                  type="button"
                  disabled={busy === "notice:all"}
                  onClick={acknowledgeAll}
                >
                  {busy === "notice:all" ? "처리 중" : "모두 확인"}
                </button>
              </footer>
            )}
        </section>
      )}
    </div>
  );
};

export default NotificationBell;
