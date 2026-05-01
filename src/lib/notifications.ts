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
  readAt: raw.readAt || null,
  createdAt: raw.createdAt || null,
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
    });
  });
};

export const loadNotifications = async (
  config: ConfigLike,
  uid: string,
): Promise<WestoryNotification[]> => {
  const itemsQuery = query(
    collection(db, getNotificationItemCollectionPath(config, uid)),
    orderBy("createdAt", "desc"),
    limit(NOTIFICATION_LIMIT),
  );
  const snapshot = await getDocs(itemsQuery);

  return snapshot.docs.map((item) =>
    normalizeNotification(
      item.id,
      item.data() as Partial<WestoryNotification>,
    ),
  );
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
