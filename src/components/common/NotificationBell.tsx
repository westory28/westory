import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import {
  clearNotifications,
  loadNotifications,
  markNotificationsRead,
  subscribeNotificationInbox,
} from "../../lib/notifications";
import type {
  WestoryNotification,
  WestoryNotificationInbox,
} from "../../types";
import { useAppToast } from "./AppToastProvider";

const formatNotificationTime = (value: unknown) => {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : null;
  if (!date) return "";

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

const getNotificationIconClassName = (type: WestoryNotification["type"]) => {
  if (type.startsWith("history_classroom")) return "fas fa-landmark";
  if (type.startsWith("history_dictionary")) return "fas fa-book-open";
  if (type.startsWith("point_order")) return "fas fa-store";
  if (type.startsWith("lesson")) return "fas fa-file-lines";
  if (type.startsWith("question")) return "fas fa-circle-question";
  return "fas fa-circle-info";
};

const NotificationBell: React.FC = () => {
  const { currentUser, config, userData } = useAuth();
  const { showToast } = useAppToast();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<WestoryNotification[]>([]);
  const [inbox, setInbox] = useState<WestoryNotificationInbox | null>(null);
  const [clearing, setClearing] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const displayUnreadCount = unreadCount > 99 ? "99+" : String(unreadCount);
  const hasNotifications = notifications.length > 0;
  const includeBroadcasts = String(userData?.role || "").trim() === "student";

  useEffect(() => {
    if (!currentUser?.uid || !config) {
      setUnreadCount(0);
      setNotifications([]);
      setInbox(null);
      return undefined;
    }

    return subscribeNotificationInbox(config, currentUser.uid, (nextInbox) => {
      setInbox(nextInbox);
      setUnreadCount(nextInbox.unreadCount);
    });
  }, [config?.semester, config?.year, currentUser?.uid]);

  useEffect(() => {
    if (!open || !currentUser?.uid || !config) return undefined;
    let cancelled = false;

    const loadItems = async () => {
      try {
        const nextNotifications = await loadNotifications(
          config,
          currentUser.uid,
          {
            includeBroadcasts,
            lastBroadcastReadAt: inbox?.lastBroadcastReadAt,
            broadcastClearedAt: inbox?.broadcastClearedAt,
          },
        );
        if (!cancelled) setNotifications(nextNotifications);
      } catch (error) {
        console.error("Failed to load notifications:", error);
      }
    };

    void loadItems();
    return () => {
      cancelled = true;
    };
  }, [
    config?.semester,
    config?.year,
    currentUser?.uid,
    includeBroadcasts,
    inbox?.broadcastClearedAt,
    inbox?.lastBroadcastReadAt,
    open,
  ]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || !config) return;
    const hasUnreadBroadcast = notifications.some(
      (notification) => notification.broadcast && !notification.readAt,
    );
    if (unreadCount <= 0 && !hasUnreadBroadcast) return;
    void markNotificationsRead(config)
      .then(() => setUnreadCount(0))
      .catch((error) => {
        console.error("Failed to mark notifications as read:", error);
      });
  }, [config?.semester, config?.year, notifications, open, unreadCount]);

  const panelTitle = useMemo(
    () => (unreadCount > 0 ? `새 알림 ${displayUnreadCount}개` : "알림"),
    [displayUnreadCount, unreadCount],
  );

  const handleClear = async () => {
    if (!config || clearing || !hasNotifications) return;
    if (!window.confirm("알림 목록을 모두 삭제할까요?")) return;

    setClearing(true);
    try {
      await clearNotifications(config);
      setNotifications([]);
      setUnreadCount(0);
      setExpandedId(null);
    } catch (error) {
      console.error("Failed to clear notifications:", error);
      showToast({
        tone: "error",
        title: "알림 삭제 실패",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setClearing(false);
    }
  };

  if (!currentUser) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-session-action="true"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100"
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
              type="button"
              onClick={() => setOpen(false)}
              data-session-action="true"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
              aria-label="알림 닫기"
            >
              <i className="fas fa-times text-xs" aria-hidden="true"></i>
            </button>
          </div>

          <div className="max-h-[min(70vh,420px)] overflow-y-auto">
            {!hasNotifications && (
              <div className="px-4 py-10 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-400">
                  <i className="fas fa-bell-slash" aria-hidden="true"></i>
                </div>
                <div className="mt-3 text-sm font-bold text-stone-700">
                  받은 알림이 없습니다.
                </div>
              </div>
            )}

            {notifications.map((notification) => {
              const unread = !notification.readAt;
              return (
                <div
                  key={notification.id}
                  className={`border-b border-stone-100 ${
                    unread ? "bg-blue-50/60" : "bg-white"
                  }`}
                >
                  <div className="flex w-full items-start gap-3 px-4 py-3 text-left">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500">
                      <i
                        className={`${getNotificationIconClassName(notification.type)} text-xs`}
                        aria-hidden="true"
                      ></i>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-extrabold text-stone-900">
                          {notification.title}
                        </span>
                        {unread && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500"></span>
                        )}
                      </span>
                      {notification.body && (
                        <span className="mt-1 block truncate text-xs font-medium leading-5 text-stone-600">
                          {notification.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[11px] font-bold text-stone-400">
                        {formatNotificationTime(notification.createdAt)}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-end border-t border-stone-100 bg-stone-50 px-4 py-3">
            <button
              type="button"
              onClick={handleClear}
              data-session-action="true"
              disabled={!hasNotifications || clearing}
              className="inline-flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-extrabold text-stone-600 transition hover:border-rose-200 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <i className="fas fa-trash-can" aria-hidden="true"></i>
              {clearing ? "삭제 중..." : "알림 목록 삭제"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
