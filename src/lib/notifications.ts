import type { SystemConfig, WestoryNotification } from "../types";
import { getW8DomainState } from "./w8Domains";

type ConfigLike = Pick<SystemConfig, "year" | "semester"> | null | undefined;

export interface ManagedNotificationInput {
  recipientUids?: string[];
  recipientMode?: "explicit" | "all_students";
  type: string;
  title: string;
  body?: string;
  targetUrl?: string;
  entityType?: string;
  entityId?: string;
  priority?: "normal" | "high";
  dedupeKey?: string;
  templateValues?: Record<string, string | number | boolean | null | undefined>;
}

export interface ManagedNotificationResult {
  createdCount: number;
  recipientCount: number;
  broadcast?: boolean;
}

export const loadNotifications = async (
  config: ConfigLike,
  uid: string,
): Promise<WestoryNotification[]> => {
  const state = await getW8DomainState({
    config,
    domain: "COMMUNICATION",
    audience: "teacher",
    studentUid: uid,
    source: "CURRENT",
  });
  const deliveryByNoticeId = new Map(
    state.deliveries.map((item) => [item.noticeId, item]),
  );
  return state.notices
    .filter((notice) => deliveryByNoticeId.has(notice.noticeId))
    .map((notice) => {
      const delivery = deliveryByNoticeId.get(notice.noticeId);
      return {
        id: notice.noticeId,
        type: "system_notice",
        title: notice.title,
        body: notice.content,
        targetUrl: delivery?.targetUrl || "",
        entityType: "notice",
        entityId: notice.noticeId,
        actorUid: "",
        recipientUid: uid,
        priority: notice.priority === "HIGH" ? "high" : "normal",
        dedupeKey: `notice:${notice.noticeId}`,
        broadcast: false,
        readAt: notice.acknowledgedAt || null,
        createdAt: notice.publishAt || null,
        expiresAt: notice.expireAt || null,
      } as WestoryNotification;
    });
};

export const createManagedNotifications = async (
  config: ConfigLike,
  input: ManagedNotificationInput,
): Promise<ManagedNotificationResult> => {
  void config;
  console.warn(
    "W8_NOTIFICATION_EVENT_PENDING: legacy notification dispatch was skipped",
    { type: input.type, dedupeKey: input.dedupeKey || "" },
  );
  return {
    createdCount: 0,
    recipientCount: new Set(input.recipientUids || []).size,
    broadcast: input.recipientMode === "all_students",
  };
};

export const notifyPerformanceScoreObjectionRequested = async (
  config: ConfigLike,
  input: {
    scoreIds: string[];
    reason: string;
    scoreKind?: string;
    targetDetails?: string;
  },
): Promise<{
  objectionIds: string[];
  objectionSavedCount: number;
  objectionSkippedProcessedCount: number;
  createdCount: number;
  recipientCount: number;
  skippedCount?: number;
}> => {
  void config;
  void input;
  throw new Error("CLIENT_UPDATE_REQUIRED");
};

export const notifyPerformanceScoreAnswerSheetRequested = async (
  config: ConfigLike,
  input: {
    scoreIds: string[];
    reason: string;
    scoreKind?: string;
    targetDetails?: string;
  },
): Promise<{
  requestIds: string[];
  requestSavedCount: number;
  requestSkippedPendingCount?: number;
  createdCount: number;
  recipientCount: number;
  skippedCount?: number;
}> => {
  void config;
  void input;
  throw new Error("CLIENT_UPDATE_REQUIRED");
};

export const reviewPerformanceScoreObjection = async (
  config: ConfigLike,
  input: {
    objectionId: string;
    status: "accepted" | "rejected";
    changedTotalScore?: number | null;
    reviewMemo?: string;
  },
): Promise<{
  status: "accepted" | "rejected";
  notificationCreated: boolean;
  recipientUid: string;
}> => {
  void config;
  void input;
  throw new Error("CLIENT_UPDATE_REQUIRED");
};
