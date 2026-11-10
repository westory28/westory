import { DRAFT_SOURCES, type DraftSourceId } from "./gongsinmoongoDraftData";

/** Administrator preview settings only; these values never enable live access. */
export interface GongsinmoongoSettings {
  acceptingQuestions: boolean;
  storiesVisible: boolean;
  teacherQuestionNotifications: boolean;
  studentReplyNotifications: boolean;
  warning: {
    enabled: boolean;
    title: string;
    body: string;
    revision: number;
  };
  allowedSources: DraftSourceId[];
  defaultRestrictionMs: number;
}

export const GONGSIN_RESTRICTION_DURATIONS = [
  [3600000, "1시간"],
  [10800000, "3시간"],
  [86400000, "1일"],
  [259200000, "3일"],
  [604800000, "7일"],
] as const;

export const createDefaultGongsinmoongoSettings =
  (): GongsinmoongoSettings => ({
    acceptingQuestions: true,
    storiesVisible: true,
    teacherQuestionNotifications: true,
    studentReplyNotifications: true,
    warning: {
      enabled: true,
      title: "질문하기 전에 확인해 주세요",
      body: [
        "학습과 관련된 질문만 보내 주세요.",
        "사담·욕설·같은 질문의 반복 전송은 하지 않아요.",
        "반복하면 정해진 시간이나 기간 동안 질문이 제한될 수 있어요.",
      ].join("\n"),
      revision: 1,
    },
    allowedSources: DRAFT_SOURCES.map((source) => source.id),
    defaultRestrictionMs: 3600000,
  });

export const normalizeGongsinmoongoSettings = (
  settings: GongsinmoongoSettings,
): GongsinmoongoSettings => ({
  acceptingQuestions: settings.acceptingQuestions,
  storiesVisible: settings.storiesVisible,
  teacherQuestionNotifications: settings.teacherQuestionNotifications,
  studentReplyNotifications: settings.studentReplyNotifications,
  warning: {
    enabled: settings.warning.enabled,
    title: settings.warning.title.trim(),
    body: settings.warning.body.trim(),
    revision: settings.warning.revision,
  },
  allowedSources: DRAFT_SOURCES.filter((source) =>
    settings.allowedSources.includes(source.id),
  ).map((source) => source.id),
  defaultRestrictionMs: GONGSIN_RESTRICTION_DURATIONS.some(
    ([value]) => value === settings.defaultRestrictionMs,
  )
    ? settings.defaultRestrictionMs
    : 3600000,
});

export const sameGongsinmoongoSettings = (
  left: GongsinmoongoSettings,
  right: GongsinmoongoSettings,
) =>
  JSON.stringify(normalizeGongsinmoongoSettings(left)) ===
  JSON.stringify(normalizeGongsinmoongoSettings(right));

export const formatGongsinRestrictionTime = (until: number) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(until);
