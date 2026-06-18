import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import {
  clearNotifications,
  loadNotifications,
  markNotificationsRead,
  subscribeBroadcastNotifications,
  subscribeNotificationInbox,
} from "../../lib/notifications";
import type {
  WestoryNotification,
  WestoryNotificationInbox,
} from "../../types";
import { useAppDialog } from "./AppDialogProvider";
import { useAppToast } from "./AppToastProvider";
import { InlineLoading } from "./LoadingState";

interface NotificationBellProps {
  className?: string;
  buttonClassName?: string;
  onUnreadCountChange?: (count: number) => void;
}

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

const timestampMs = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const seconds = Number((value as { seconds?: number }).seconds || 0);
  return seconds > 0 ? seconds * 1000 : 0;
};

const getNotificationIconClassName = (type: WestoryNotification["type"]) => {
  if (type.startsWith("history_classroom")) return "fas fa-landmark";
  if (type.startsWith("history_dictionary")) return "fas fa-book-open";
  if (type.startsWith("performance_score")) return "fas fa-clipboard-check";
  if (type.startsWith("point_order")) return "fas fa-store";
  if (type.startsWith("lesson")) return "fas fa-file-lines";
  if (type.startsWith("privacy_policy")) return "fas fa-user-shield";
  if (type.startsWith("question")) return "fas fa-circle-question";
  return "fas fa-circle-info";
};

const getNotificationBodyText = (notification: WestoryNotification) => {
  const body = String(notification.body || "").trim();
  if (notification.type === "history_dictionary_requested") {
    return body.replace(
      /학생이\s+"([^"]+)"\s+뜻풀이를 요청했습니다\./g,
      "학생이 $1 뜻풀이를 요청했습니다.",
    );
  }
  return body;
};

const getNotificationTargetUrl = (notification: WestoryNotification) => {
  const targetUrl = String(notification.targetUrl || "").trim();
  if (
    notification.type === "history_classroom_submitted" ||
    notification.type === "history_classroom_passed"
  ) {
    if (!targetUrl || targetUrl === "/teacher/quiz?menu=history2") {
      return "/teacher/quiz/history-classroom";
    }
    return targetUrl;
  }
  if (notification.type === "point_order_requested") {
    if (!targetUrl || targetUrl === "/teacher/points") {
      return "/teacher/points?tab=requests";
    }
    return targetUrl;
  }
  if (notification.type === "performance_score_objection_requested") {
    if (
      !targetUrl ||
      targetUrl === "/teacher/exam" ||
      targetUrl === "/teacher/exam?tab=performance"
    ) {
      return "/teacher/exam?tab=performance&panel=objections";
    }
    if (
      targetUrl.startsWith("/teacher/exam?") &&
      !targetUrl.includes("panel=")
    ) {
      return `${targetUrl}&panel=objections`;
    }
    return targetUrl;
  }
  if (
    notification.type === "performance_score_objection_reviewed" ||
    notification.type === "performance_score_signature_rejected"
  ) {
    if (!targetUrl || targetUrl === "/student/score") {
      return "/student/score/performance";
    }
    return targetUrl;
  }
  if (notification.type === "point_order_reviewed") {
    if (!targetUrl || targetUrl === "/student/points") {
      return "/student/points?tab=orders";
    }
    return targetUrl;
  }
  if (notification.type === "history_dictionary_resolved") {
    if (!targetUrl || targetUrl === "/student/dashboard") {
      return "/student/lesson/history-dictionary";
    }
    return targetUrl;
  }
  if (notification.type === "history_dictionary_requested") {
    const requestId = String(notification.entityId || "").trim();
    const requestsUrl =
      !targetUrl || targetUrl === "/teacher/lesson/history-dictionary"
        ? "/teacher/lesson/history-dictionary?panel=requests"
        : targetUrl;
    if (!requestId || requestsUrl.includes("requestId=")) return requestsUrl;
    return `${requestsUrl}${requestsUrl.includes("?") ? "&" : "?"}requestId=${encodeURIComponent(requestId)}`;
  }
  return targetUrl;
};

const getRealtimeToastKey = (notification: WestoryNotification) =>
  `${notification.broadcast ? "broadcast" : "personal"}:${notification.id}`;

const shownRealtimeToastKeys = new Set<string>();

const NotificationBell: React.FC<NotificationBellProps> = ({
  className = "",
  buttonClassName = "",
  onUnreadCountChange,
}) => {
  const navigate = useNavigate();
  const { currentUser, config, userData } = useAuth();
  const { showToast } = useAppToast();
  const { confirm } = useAppDialog();
  const [open, setOpen] = useState(false);
  const [personalUnreadCount, setPersonalUnreadCount] = useState(0);
  const [broadcastNotifications, setBroadcastNotifications] = useState<
    WestoryNotification[]
  >([]);
  const [notifications, setNotifications] = useState<WestoryNotification[]>([]);
  const [inbox, setInbox] = useState<WestoryNotificationInbox | null>(null);
  const [inboxReady, setInboxReady] = useState(false);
  const [broadcastReady, setBroadcastReady] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [privacyPolicyLoading, setPrivacyPolicyLoading] = useState(false);
  const [privacyPolicyHtml, setPrivacyPolicyHtml] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const realtimeToastStateRef = useRef({
    initialized: false,
    scopeKey: "",
    unreadCount: 0,
  });

  const includeBroadcasts = String(userData?.role || "").trim() === "student";
  const notificationSourcesReady =
    inboxReady && (!includeBroadcasts || broadcastReady);

  const visibleBroadcastNotifications = useMemo(() => {
    if (!includeBroadcasts) return [];
    const lastBroadcastReadMs = timestampMs(inbox?.lastBroadcastReadAt);
    const broadcastClearedMs = timestampMs(inbox?.broadcastClearedAt);
    return broadcastNotifications
      .map((notification) => {
        const createdMs = timestampMs(notification.createdAt);
        return {
          ...notification,
          recipientUid: currentUser?.uid || notification.recipientUid,
          readAt:
            createdMs > 0 && createdMs <= lastBroadcastReadMs
              ? inbox?.lastBroadcastReadAt
              : null,
        };
      })
      .filter((notification) => {
        const createdMs = timestampMs(notification.createdAt);
        return (
          !broadcastClearedMs || !createdMs || createdMs > broadcastClearedMs
        );
      });
  }, [
    broadcastNotifications,
    currentUser?.uid,
    includeBroadcasts,
    inbox?.broadcastClearedAt,
    inbox?.lastBroadcastReadAt,
  ]);

  const broadcastUnreadCount = visibleBroadcastNotifications.filter(
    (notification) => !notification.readAt,
  ).length;
  const unreadCount = personalUnreadCount + broadcastUnreadCount;
  const displayUnreadCount = unreadCount > 99 ? "99+" : String(unreadCount);
  const hasNotifications = notifications.length > 0;

  useEffect(() => {
    if (!currentUser?.uid || !config) {
      setPersonalUnreadCount(0);
      setBroadcastNotifications([]);
      setNotifications([]);
      setInbox(null);
      setInboxReady(false);
      return undefined;
    }

    setInboxReady(false);
    return subscribeNotificationInbox(config, currentUser.uid, (nextInbox) => {
      setInbox(nextInbox);
      setPersonalUnreadCount(nextInbox.unreadCount);
      setInboxReady(true);
    });
  }, [config?.semester, config?.year, currentUser?.uid]);

  useEffect(() => {
    if (!includeBroadcasts || !currentUser?.uid || !config) {
      setBroadcastNotifications([]);
      setBroadcastReady(false);
      return undefined;
    }

    setBroadcastReady(false);
    return subscribeBroadcastNotifications(config, (nextNotifications) => {
      setBroadcastNotifications(nextNotifications);
      setBroadcastReady(true);
    });
  }, [config?.semester, config?.year, currentUser?.uid, includeBroadcasts]);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  useEffect(() => {
    if (!currentUser?.uid || !config) {
      realtimeToastStateRef.current = {
        initialized: false,
        scopeKey: "",
        unreadCount: 0,
      };
      return undefined;
    }

    if (!notificationSourcesReady) return undefined;

    const previousState = realtimeToastStateRef.current;
    const scopeKey = [
      currentUser.uid,
      config.year,
      config.semester,
      includeBroadcasts ? "student-broadcasts" : "personal",
    ].join(":");
    if (!previousState.initialized || previousState.scopeKey !== scopeKey) {
      realtimeToastStateRef.current = {
        initialized: true,
        scopeKey,
        unreadCount,
      };
      return undefined;
    }

    realtimeToastStateRef.current = {
      initialized: true,
      scopeKey,
      unreadCount,
    };

    if (unreadCount <= previousState.unreadCount) return undefined;

    let cancelled = false;

    const showLatestRealtimeNotification = async () => {
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
        if (cancelled) return;

        const notification =
          nextNotifications.find((item) => !item.readAt) ||
          nextNotifications[0];
        if (!notification) return;

        const toastKey = `${scopeKey}:${getRealtimeToastKey(notification)}`;
        if (shownRealtimeToastKeys.has(toastKey)) return;
        shownRealtimeToastKeys.add(toastKey);

        showToast({
          tone: notification.priority === "high" ? "warning" : "info",
          title: notification.title || "새 알림",
          message: getNotificationBodyText(notification),
          durationMs: includeBroadcasts
            ? notification.priority === "high"
              ? 5600
              : 4200
            : undefined,
          persistent: includeBroadcasts ? false : true,
        });
      } catch (error) {
        console.error("Failed to show realtime notification toast:", error);
      }
    };

    void showLatestRealtimeNotification();

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
    showToast,
    notificationSourcesReady,
    unreadCount,
  ]);

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
      .then(() => setPersonalUnreadCount(0))
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
    const confirmed = await confirm({
      tone: "danger",
      title: "알림 목록을 모두 삭제할까요?",
      message: "삭제 후에는 현재 알림 목록에서 다시 볼 수 없습니다.",
      confirmLabel: "모두 삭제",
    });
    if (!confirmed) return;

    setClearing(true);
    try {
      await clearNotifications(config);
      setNotifications([]);
      setPersonalUnreadCount(0);
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

  const openPrivacyPolicyModal = async () => {
    setOpen(false);
    setPrivacyPolicyOpen(true);
    setPrivacyPolicyLoading(true);
    setPrivacyPolicyHtml("");

    try {
      const snap = await getDoc(doc(db, "site_settings", "privacy"));
      const text = snap.exists()
        ? String((snap.data() as { text?: unknown }).text || "").trim()
        : "";
      setPrivacyPolicyHtml(
        text ||
          '<p class="text-center text-gray-400 py-8">등록된 내용이 없습니다.</p>',
      );
    } catch (error) {
      console.error("Privacy policy load error:", error);
      setPrivacyPolicyHtml(
        '<p class="text-center text-red-400 py-8">내용을 불러오지 못했습니다.</p>',
      );
    } finally {
      setPrivacyPolicyLoading(false);
    }
  };

  if (!currentUser) return null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
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
              const bodyText = getNotificationBodyText(notification);
              const targetUrl = getNotificationTargetUrl(notification);
              const opensPrivacyPolicy =
                notification.type === "privacy_policy_updated";
              const rowClassName = `flex w-full items-start gap-3 px-4 py-3 text-left ${
                targetUrl || opensPrivacyPolicy
                  ? "transition hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  : ""
              }`;
              const rowContent = (
                <>
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
                    {bodyText && (
                      <span className="mt-1 block truncate text-xs font-medium leading-5 text-stone-600">
                        {bodyText}
                      </span>
                    )}
                    <span className="mt-1 block text-[11px] font-bold text-stone-400">
                      {formatNotificationTime(notification.createdAt)}
                    </span>
                  </span>
                </>
              );
              return (
                <div
                  key={notification.id}
                  className={`border-b border-stone-100 ${
                    unread ? "bg-blue-50/60" : "bg-white"
                  }`}
                >
                  {targetUrl || opensPrivacyPolicy ? (
                    <button
                      type="button"
                      className={rowClassName}
                      onClick={() => {
                        if (opensPrivacyPolicy) {
                          void openPrivacyPolicyModal();
                          return;
                        }
                        setOpen(false);
                        navigate(targetUrl);
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

      {privacyPolicyOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm"
          onClick={() => setPrivacyPolicyOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-privacy-policy-title"
            className="mx-4 flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <h2
                id="notification-privacy-policy-title"
                className="text-lg font-bold text-gray-900"
              >
                개인정보 처리 방침
              </h2>
              <button
                type="button"
                onClick={() => setPrivacyPolicyOpen(false)}
                className="text-xl text-gray-400 transition hover:text-gray-700"
                aria-label="개인정보 처리 방침 닫기"
              >
                <i className="fas fa-times" aria-hidden="true"></i>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 text-sm leading-relaxed text-gray-700">
              {privacyPolicyLoading ? (
                <InlineLoading
                  message="개인정보 처리 방침을 불러오는 중입니다."
                  showWarning
                />
              ) : (
                <div
                  className="policy-rich-text"
                  dangerouslySetInnerHTML={{ __html: privacyPolicyHtml }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
