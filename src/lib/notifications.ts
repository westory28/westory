import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import { getSemesterCollectionPath, getYearSemester } from "./semesterScope";
import type {
  SystemConfig,
  WestoryNotification,
  WestoryNotificationInbox,
  WestoryNotificationPriority,
  WestoryNotificationType,
} from "../types";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export interface ManagedNotificationInput {
  recipientUids?: string[];
  recipientMode?: "explicit" | "all_students";
  type: WestoryNotificationType;
  title: string;
  body?: string;
  targetUrl?: string;
  entityType?: string;
  entityId?: string;
  priority?: WestoryNotificationPriority;
  dedupeKey?: string;
}

const NOTIFICATION_LIMIT = 10;

const getNotificationInboxPath = (config: ConfigLike, uid: string) =>
  `${getSemesterCollectionPath(config, "notification_inboxes")}/${uid}`;

const getNotificationItemCollectionPath = (config: ConfigLike, uid: string) =>
  `${getNotificationInboxPath(config, uid)}/items`;

const getBroadcastNotificationCollectionPath = (config: ConfigLike) =>
  getSemesterCollectionPath(config, "broadcast_notifications");

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

const normalizeNotification = (
  id: string,
  raw: Partial<WestoryNotification>,
): WestoryNotification => ({
  id,
  type: raw.type || "system_notice",
  title: String(raw.title || "알림").trim() || "알림",
  body: String(raw.body || "").trim(),
  targetUrl: String(raw.targetUrl || "").trim(),
  entityType: String(raw.entityType || "").trim(),
  entityId: String(raw.entityId || "").trim(),
  actorUid: String(raw.actorUid || "").trim(),
  recipientUid: String(raw.recipientUid || "").trim(),
  priority: raw.priority === "high" ? "high" : "normal",
  dedupeKey: String(raw.dedupeKey || "").trim(),
  broadcast: raw.broadcast === true,
  readAt: raw.readAt || null,
  createdAt: raw.createdAt || null,
  expiresAt: raw.expiresAt || null,
});

export const subscribeNotificationInbox = (
  config: ConfigLike,
  uid: string,
  onChange: (inbox: WestoryNotificationInbox) => void,
): Unsubscribe => {
  const inboxRef = doc(db, getNotificationInboxPath(config, uid));
  return onSnapshot(inboxRef, (snapshot) => {
    const data = snapshot.data() as
      | Partial<WestoryNotificationInbox>
      | undefined;
    onChange({
      uid,
      unreadCount: Math.max(0, Number(data?.unreadCount || 0)),
      updatedAt: data?.updatedAt || null,
      lastReadAt: data?.lastReadAt || null,
      lastBroadcastReadAt: data?.lastBroadcastReadAt || null,
      broadcastClearedAt: data?.broadcastClearedAt || null,
    });
  });
};

export const loadNotifications = async (
  config: ConfigLike,
  uid: string,
  options?: {
    includeBroadcasts?: boolean;
    lastBroadcastReadAt?: unknown;
    broadcastClearedAt?: unknown;
  },
): Promise<WestoryNotification[]> => {
  const itemsQuery = query(
    collection(db, getNotificationItemCollectionPath(config, uid)),
    orderBy("createdAt", "desc"),
    limit(NOTIFICATION_LIMIT),
  );
  const broadcastQuery = query(
    collection(db, getBroadcastNotificationCollectionPath(config)),
    orderBy("createdAt", "desc"),
    limit(NOTIFICATION_LIMIT),
  );
  const [snapshot, broadcastSnapshot] = await Promise.all([
    getDocs(itemsQuery),
    options?.includeBroadcasts ? getDocs(broadcastQuery) : null,
  ]);

  const personalItems = snapshot.docs.map((item) =>
    normalizeNotification(
      item.id,
      item.data() as Partial<WestoryNotification>,
    ),
  );
  const lastBroadcastReadMs = timestampMs(options?.lastBroadcastReadAt);
  const broadcastClearedMs = timestampMs(options?.broadcastClearedAt);
  const broadcastItems = (broadcastSnapshot?.docs || [])
    .map((item) => {
      const notification = normalizeNotification(item.id, {
        ...(item.data() as Partial<WestoryNotification>),
        broadcast: true,
      });
      const createdMs = timestampMs(notification.createdAt);
      return {
        ...notification,
        recipientUid: uid,
        readAt:
          createdMs > 0 && createdMs <= lastBroadcastReadMs
            ? options?.lastBroadcastReadAt
            : null,
      };
    })
    .filter((item) => {
      const createdMs = timestampMs(item.createdAt);
      return !broadcastClearedMs || !createdMs || createdMs > broadcastClearedMs;
    });

  return [...personalItems, ...broadcastItems]
    .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt))
    .slice(0, NOTIFICATION_LIMIT);
};

export const markNotificationsRead = async (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, "markNotificationsRead");
  await callable({ year, semester });
};

export const clearNotifications = async (config: ConfigLike) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, "clearNotifications");
  await callable({ year, semester });
};

export const createManagedNotifications = async (
  config: ConfigLike,
  input: ManagedNotificationInput,
) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, "createManagedNotifications");
  await callable({
    year,
    semester,
    ...input,
    recipientUids: Array.from(new Set(input.recipientUids || [])),
  });
};

export const notifyHistoryClassroomSubmitted = async (
  config: ConfigLike,
  input: {
    assignmentId: string;
    assignmentTitle: string;
    resultId: string;
    percent: number;
  },
) => {
  const { year, semester } = getYearSemester(config);
  const callable = httpsCallable(functions, "notifyHistoryClassroomSubmitted");
  await callable({
    year,
    semester,
    assignmentId: input.assignmentId,
    assignmentTitle: input.assignmentTitle,
    resultId: input.resultId,
    percent: input.percent,
  });
};
