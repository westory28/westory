import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";

type NotificationPriority = "normal" | "high";
type NotificationAudience = "students" | "teachers";
type NotificationEventStatus = "connected" | "needs-hook";
type NotificationTab = "overview" | "students" | "teachers" | "pending";

type NotificationTemplateToken = {
  key: string;
  label: string;
};

type NotificationEventDefinition = {
  key: string;
  label: string;
  audience: NotificationAudience;
  description: string;
  triggerLabel: string;
  recipientLabel: string;
  status: NotificationEventStatus;
  defaultEnabled: boolean;
  defaultPriority: NotificationPriority;
  titleTemplate: string;
  bodyTemplate: string;
  targetUrl: string;
  targetLabel: string;
  tokens?: NotificationTemplateToken[];
};

type NotificationEventPolicy = {
  enabled: boolean;
  priority: NotificationPriority;
  titleTemplate: string;
  bodyTemplate: string;
  targetUrl: string;
};

type NotificationConfigState = {
  enabled: boolean;
  studentNotificationsEnabled: boolean;
  teacherNotificationsEnabled: boolean;
  eventPolicies: Record<string, NotificationEventPolicy>;
};

const NOTIFICATION_EVENTS: NotificationEventDefinition[] = [
  {
    key: "lesson_worksheet_published",
    label: "수업자료·학습지 공개",
    audience: "students",
    description: "교사가 수업자료를 학생에게 공개했을 때 학생에게 안내합니다.",
    triggerLabel: "수업자료를 학생에게 공개했을 때",
    recipientLabel: "전체 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "새 학습지가 업데이트되었습니다",
    bodyTemplate: "{lessonTitle} 자료를 확인해 보세요.",
    targetUrl: "/student/lesson/note",
    targetLabel: "학생 수업자료 화면",
    tokens: [{ key: "lessonTitle", label: "수업자료 이름" }],
  },
  {
    key: "history_classroom_assigned",
    label: "역사교실 과제 배정",
    audience: "students",
    description:
      "역사교실 과제가 공개되거나 새로 배정되었을 때 대상 학생에게 안내합니다.",
    triggerLabel: "역사교실 과제를 학생에게 배정했을 때",
    recipientLabel: "배정 대상 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사교실이 배정되었습니다",
    bodyTemplate: "{assignmentTitle} 과제가 새로 열렸습니다.",
    targetUrl: "/student/history-classroom",
    targetLabel: "학생 역사교실 화면",
    tokens: [{ key: "assignmentTitle", label: "과제 이름" }],
  },
  {
    key: "point_order_reviewed",
    label: "위스 상점 신청 결과",
    audience: "students",
    description:
      "교사가 위스 상점 구매 요청을 승인하거나 반려했을 때 학생에게 처리 결과를 안내합니다.",
    triggerLabel: "위스 상점 신청을 처리했을 때",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "상점 구매 처리",
    bodyTemplate: "{productName} 구매 요청이 {statusLabel} 처리되었습니다.",
    targetUrl: "/student/points?tab=orders",
    targetLabel: "학생 위스 상점 화면",
    tokens: [
      { key: "productName", label: "상품 이름" },
      { key: "statusLabel", label: "처리 결과" },
    ],
  },
  {
    key: "history_dictionary_resolved",
    label: "역사 사전 요청 처리 완료",
    audience: "students",
    description:
      "학생이 요청한 역사 사전 뜻풀이가 등록되거나 승인되었을 때 안내합니다.",
    triggerLabel: "요청한 뜻풀이를 등록하거나 승인했을 때",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 등록 완료",
    bodyTemplate: '요청한 "{word}" 뜻풀이가 등록되었습니다.',
    targetUrl: "/student/lesson/history-dictionary",
    targetLabel: "학생 첫 화면",
    tokens: [{ key: "word", label: "요청한 단어" }],
  },
  {
    key: "history_dictionary_rejected",
    label: "역사 사전 요청 반려",
    audience: "students",
    description:
      "요청한 역사 사전 단어가 교사 확인 후 삭제되거나 반려되었을 때 학생에게 안내합니다.",
    triggerLabel: "요청한 단어를 삭제하거나 반려했을 때",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 단어 삭제",
    bodyTemplate: '"{word}" 항목이 선생님 확인 후 삭제되었습니다.',
    targetUrl: "/student/lesson/history-dictionary",
    targetLabel: "학생 역사 사전 화면",
    tokens: [{ key: "word", label: "요청한 단어" }],
  },
  {
    key: "question_replied",
    label: "질문 답변 등록",
    audience: "students",
    description:
      "교사가 학생 질문에 답변했을 때 학생에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "학생 질문에 답변을 저장했을 때",
    recipientLabel: "질문 작성 학생",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "질문에 답변이 등록되었습니다",
    bodyTemplate: "{questionTitle} 답변을 확인해 보세요.",
    targetUrl: "/student/dashboard",
    targetLabel: "학생 첫 화면",
    tokens: [{ key: "questionTitle", label: "질문 제목" }],
  },
  {
    key: "system_notice",
    label: "전체 학생 공지",
    audience: "students",
    description:
      "교사가 전체 학생에게 직접 안내를 보낼 때 사용할 기본 설정입니다.",
    triggerLabel: "교사가 전체 학생에게 직접 보낼 때",
    recipientLabel: "전체 학생",
    status: "needs-hook",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "알림",
    bodyTemplate: "확인할 안내가 있습니다.",
    targetUrl: "/student/dashboard",
    targetLabel: "학생 첫 화면",
  },
  {
    key: "history_classroom_passed",
    label: "역사교실 통과",
    audience: "teachers",
    description:
      "학생이 역사교실 과제를 제출한 뒤 통과했을 때 교사에게 통과 사실과 정답률을 안내합니다.",
    triggerLabel: "학생이 역사교실 과제를 통과했을 때",
    recipientLabel: "교사·평가 권한자",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사교실 통과 알림",
    bodyTemplate:
      "{studentName} 학생이 {assignmentTitle}을(를) {percent}%로 통과했습니다.",
    targetUrl: "/teacher/quiz/history-classroom",
    targetLabel: "교사 역사교실 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "assignmentTitle", label: "과제 이름" },
      { key: "percent", label: "정답률" },
    ],
  },
  {
    key: "history_classroom_submitted",
    label: "역사교실 제출 완료",
    audience: "teachers",
    description:
      "학생이 역사교실 과제를 제출했을 때 교사에게 제출 사실과 정답률을 안내합니다.",
    triggerLabel: "학생이 역사교실 과제를 제출했을 때",
    recipientLabel: "교사·평가 권한자",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사교실 제출 알림",
    bodyTemplate: "{studentName} 학생이 {assignmentTitle}을(를) 제출했습니다.",
    targetUrl: "/teacher/quiz/history-classroom",
    targetLabel: "교사 역사교실 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "assignmentTitle", label: "과제 이름" },
      { key: "percent", label: "정답률" },
    ],
  },
  {
    key: "point_order_requested",
    label: "위스 상점 신청",
    audience: "teachers",
    description:
      "학생이 위스 상점 구매를 요청했을 때 포인트 관리 담당자에게 안내합니다.",
    triggerLabel: "학생이 위스 상점 상품을 신청했을 때",
    recipientLabel: "위스 담당 교사",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "상점 구매 요청",
    bodyTemplate: "{studentName} 학생이 {productName} 구매를 요청했습니다.",
    targetUrl: "/teacher/points?tab=requests",
    targetLabel: "교사 위스 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "productName", label: "상품 이름" },
    ],
  },
  {
    key: "history_dictionary_requested",
    label: "역사 사전 뜻풀이 요청",
    audience: "teachers",
    description:
      "학생이 역사 사전 뜻풀이를 요청했을 때 수업자료 담당자에게 안내합니다.",
    triggerLabel: "학생이 역사 사전 뜻풀이를 요청했을 때",
    recipientLabel: "수업자료 담당 교사",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 요청",
    bodyTemplate: "{studentName} 학생이 {word} 뜻풀이를 요청했습니다.",
    targetUrl: "/teacher/lesson/history-dictionary?panel=requests",
    targetLabel: "교사 역사 사전 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "word", label: "요청한 단어" },
    ],
  },
  {
    key: "quiz_submitted",
    label: "퀴즈 제출 완료",
    audience: "teachers",
    description:
      "학생이 퀴즈를 제출했을 때 교사에게 제출 완료를 안내하도록 준비하는 항목입니다.",
    triggerLabel: "학생이 퀴즈를 제출했을 때",
    recipientLabel: "교사·평가 권한자",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "퀴즈 제출 알림",
    bodyTemplate: "{studentName} 학생이 {quizTitle}을(를) 제출했습니다.",
    targetUrl: "/teacher/quiz?tab=log",
    targetLabel: "교사 퀴즈 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "quizTitle", label: "퀴즈 이름" },
    ],
  },
  {
    key: "lesson_unit_completed",
    label: "수업자료 학습 완료",
    audience: "teachers",
    description:
      "학생이 수업자료 빈칸 학습을 완료했을 때 교사에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "학생이 수업자료 학습을 완료했을 때",
    recipientLabel: "수업자료 담당 교사",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "수업자료 학습 완료",
    bodyTemplate: "{studentName} 학생이 {lessonTitle} 학습을 완료했습니다.",
    targetUrl: "/teacher/lesson",
    targetLabel: "교사 수업자료 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "lessonTitle", label: "수업자료 이름" },
    ],
  },
  {
    key: "think_cloud_submitted",
    label: "생각모아 제출",
    audience: "teachers",
    description:
      "학생이 생각모아 활동에 참여했을 때 교사에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "학생이 생각모아 활동에 참여했을 때",
    recipientLabel: "수업자료 담당 교사",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "생각모아 참여 알림",
    bodyTemplate: "{studentName} 학생이 {topic}에 응답했습니다.",
    targetUrl: "/teacher/lesson/think-cloud",
    targetLabel: "교사 생각모아 관리 화면",
    tokens: [
      { key: "studentName", label: "학생 이름" },
      { key: "topic", label: "활동 주제" },
    ],
  },
];

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toFriendlyNotificationText = (
  event: NotificationEventDefinition,
  value: string,
) =>
  (event.tokens || []).reduce(
    (text, token) =>
      text.replace(
        new RegExp(`\\{${escapeRegExp(token.key)}\\}`, "g"),
        `[${token.label}]`,
      ),
    value,
  );

const toStoredNotificationText = (
  event: NotificationEventDefinition,
  value: string,
) =>
  (event.tokens || []).reduce(
    (text, token) =>
      text.replace(
        new RegExp(`\\[${escapeRegExp(token.label)}\\]`, "g"),
        `{${token.key}}`,
      ),
    value,
  );

const getTargetDisplayLabel = (
  event: NotificationEventDefinition,
  targetUrl: string,
) =>
  targetUrl && targetUrl !== event.targetUrl
    ? `${event.targetLabel} 외 별도 지정 화면`
    : event.targetLabel;

const buildDefaultPolicy = (
  event: NotificationEventDefinition,
): NotificationEventPolicy => ({
  enabled: event.defaultEnabled,
  priority: event.defaultPriority,
  titleTemplate: event.titleTemplate,
  bodyTemplate: event.bodyTemplate,
  targetUrl: event.targetUrl,
});

const buildDefaultEventPolicies = () =>
  NOTIFICATION_EVENTS.reduce<Record<string, NotificationEventPolicy>>(
    (acc, event) => {
      acc[event.key] = buildDefaultPolicy(event);
      return acc;
    },
    {},
  );

const createDefaultConfig = (): NotificationConfigState => ({
  enabled: true,
  studentNotificationsEnabled: true,
  teacherNotificationsEnabled: true,
  eventPolicies: buildDefaultEventPolicies(),
});

const toPriority = (
  value: unknown,
  fallback: NotificationPriority,
): NotificationPriority =>
  value === "high" || value === "normal" ? value : fallback;

const normalizePolicy = (
  event: NotificationEventDefinition,
  raw: unknown,
): NotificationEventPolicy => {
  const defaults = buildDefaultPolicy(event);
  if (!raw || typeof raw !== "object") return defaults;

  const source = raw as Partial<NotificationEventPolicy>;
  return {
    enabled:
      typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
    priority: toPriority(source.priority, defaults.priority),
    titleTemplate: String(
      source.titleTemplate ?? defaults.titleTemplate,
    ).trim(),
    bodyTemplate: String(source.bodyTemplate ?? defaults.bodyTemplate).trim(),
    targetUrl: String(source.targetUrl ?? defaults.targetUrl).trim(),
  };
};

const normalizeConfig = (raw: unknown): NotificationConfigState => {
  const defaults = createDefaultConfig();
  if (!raw || typeof raw !== "object") return defaults;

  const source = raw as Partial<NotificationConfigState>;
  const rawPolicies =
    source.eventPolicies && typeof source.eventPolicies === "object"
      ? source.eventPolicies
      : {};

  return {
    enabled:
      typeof source.enabled === "boolean" ? source.enabled : defaults.enabled,
    studentNotificationsEnabled:
      typeof source.studentNotificationsEnabled === "boolean"
        ? source.studentNotificationsEnabled
        : defaults.studentNotificationsEnabled,
    teacherNotificationsEnabled:
      typeof source.teacherNotificationsEnabled === "boolean"
        ? source.teacherNotificationsEnabled
        : defaults.teacherNotificationsEnabled,
    eventPolicies: NOTIFICATION_EVENTS.reduce<
      Record<string, NotificationEventPolicy>
    >((acc, event) => {
      acc[event.key] = normalizePolicy(
        event,
        (rawPolicies as Record<string, unknown>)[event.key],
      );
      return acc;
    }, {}),
  };
};

const STATUS_META: Record<
  NotificationEventStatus,
  { label: string; className: string }
> = {
  connected: {
    label: "바로 사용 중",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  "needs-hook": {
    label: "준비 중",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
};

const AUDIENCE_META: Record<
  NotificationAudience,
  { title: string; description: string; icon: string }
> = {
  students: {
    title: "학생이 받는 알림",
    description: "학생 화면의 알림 버튼에서 확인하는 안내입니다.",
    icon: "fas fa-user-graduate",
  },
  teachers: {
    title: "교사가 받는 알림",
    description: "교사와 담당자가 학생 활동을 확인하는 안내입니다.",
    icon: "fas fa-chalkboard-teacher",
  },
};

const TAB_ITEMS: Array<{ key: NotificationTab; label: string }> = [
  { key: "overview", label: "개요" },
  { key: "students", label: "학생 알림" },
  { key: "teachers", label: "교사 알림" },
  { key: "pending", label: "미연동 항목" },
];

const SettingsNotifications: React.FC = () => {
  const { currentUser, config: semesterConfig } = useAuth();
  const { showToast } = useAppToast();
  const [config, setConfig] = useState<NotificationConfigState>(() =>
    createDefaultConfig(),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<NotificationTab>("overview");
  const [openEventKey, setOpenEventKey] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      setLoading(true);
      try {
        const snapshot = await getDoc(
          doc(db, "site_settings", "notification_config"),
        );
        setConfig(normalizeConfig(snapshot.exists() ? snapshot.data() : null));
      } catch (error) {
        console.error("Failed to load notification config:", error);
        showToast({
          tone: "error",
          title: "알림 설정을 불러오지 못했습니다.",
          message: "잠시 후 다시 시도해 주세요.",
        });
        setConfig(createDefaultConfig());
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, [showToast]);

  const connectedCount = useMemo(
    () =>
      NOTIFICATION_EVENTS.filter((event) => event.status === "connected")
        .length,
    [],
  );
  const preparedCount = NOTIFICATION_EVENTS.length - connectedCount;
  const studentEvents = NOTIFICATION_EVENTS.filter(
    (event) => event.audience === "students",
  );
  const teacherEvents = NOTIFICATION_EVENTS.filter(
    (event) => event.audience === "teachers",
  );
  const pendingEvents = NOTIFICATION_EVENTS.filter(
    (event) => event.status === "needs-hook",
  );

  const updateRootField = (
    field: keyof Omit<NotificationConfigState, "eventPolicies">,
    value: boolean,
  ) => {
    setConfig((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updatePolicy = (
    key: string,
    patch: Partial<NotificationEventPolicy>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      eventPolicies: {
        ...prev.eventPolicies,
        [key]: {
          ...prev.eventPolicies[key],
          ...patch,
        },
      },
    }));
  };

  const resetPolicy = (event: NotificationEventDefinition) => {
    updatePolicy(event.key, buildDefaultPolicy(event));
  };

  const getPolicy = (event: NotificationEventDefinition) =>
    config.eventPolicies[event.key] || buildDefaultPolicy(event);

  const getAudienceDisabled = (event: NotificationEventDefinition) =>
    event.audience === "students"
      ? !config.studentNotificationsEnabled
      : !config.teacherNotificationsEnabled;

  const getEventDisabled = (event: NotificationEventDefinition) =>
    !config.enabled || getAudienceDisabled(event);

  const enabledCount = NOTIFICATION_EVENTS.filter(
    (event) => !getEventDisabled(event) && getPolicy(event).enabled,
  ).length;

  const saveConfig = async () => {
    setSaving(true);
    try {
      await setDoc(
        doc(db, "site_settings", "notification_config"),
        {
          enabled: config.enabled,
          studentNotificationsEnabled: config.studentNotificationsEnabled,
          teacherNotificationsEnabled: config.teacherNotificationsEnabled,
          eventPolicies: config.eventPolicies,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser?.email || currentUser?.uid || "",
        },
        { merge: true },
      );
      invalidateSiteSettingDocCache("notification_config");
      showToast({
        tone: "success",
        title: "알림 관리 설정이 저장되었습니다.",
        message: "다음 알림부터 저장한 기준이 적용됩니다.",
      });
    } catch (error: any) {
      console.error("Failed to save notification config:", error);
      showToast({
        tone: "error",
        title: "알림 설정 저장에 실패했습니다.",
        message: error.message || "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderSwitch = (
    checked: boolean,
    disabled: boolean,
    onChange: (checked: boolean) => void,
    label: string,
  ) => (
    <label
      className={`relative inline-flex items-center ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      aria-label={label}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={`inline-flex h-6 w-11 items-center rounded-full p-0.5 transition ${
          checked ? "bg-blue-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </label>
  );

  const renderStatusBadge = (event: NotificationEventDefinition) => {
    const statusMeta = STATUS_META[event.status];
    return (
      <span
        className={`inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-extrabold ${statusMeta.className}`}
      >
        {statusMeta.label}
      </span>
    );
  };

  const renderEventEditor = (event: NotificationEventDefinition) => {
    const policy = getPolicy(event);
    const disabled = getEventDisabled(event);
    return (
      <div className="border-t border-gray-100 bg-gray-50/80 p-4">
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="mb-1 block text-xs font-extrabold text-gray-500">
                  알림 제목
                </label>
                <input
                  type="text"
                  value={toFriendlyNotificationText(
                    event,
                    policy.titleTemplate,
                  )}
                  disabled={disabled}
                  onChange={(eventTarget) =>
                    updatePolicy(event.key, {
                      titleTemplate: toStoredNotificationText(
                        event,
                        eventTarget.target.value,
                      ),
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-extrabold text-gray-500">
                  알림을 누르면 열리는 화면
                </label>
                <div
                  className={`w-full rounded-lg border px-3 py-2 text-sm font-bold ${
                    disabled
                      ? "border-gray-200 bg-gray-100 text-gray-400"
                      : "border-gray-300 bg-white text-gray-700"
                  }`}
                >
                  {getTargetDisplayLabel(event, policy.targetUrl)}
                </div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-extrabold text-gray-500">
                알림 내용
              </label>
              <textarea
                value={toFriendlyNotificationText(event, policy.bodyTemplate)}
                disabled={disabled}
                rows={2}
                onChange={(eventTarget) =>
                  updatePolicy(event.key, {
                    bodyTemplate: toStoredNotificationText(
                      event,
                      eventTarget.target.value,
                    ),
                  })
                }
                className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
              />
              {event.tokens && event.tokens.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                  <span className="font-bold">자동으로 채워지는 말</span>
                  {event.tokens.map((token) => (
                    <span
                      key={token.key}
                      className="rounded-full bg-white px-2 py-0.5 font-bold text-gray-600 ring-1 ring-gray-200"
                    >
                      [{token.label}]
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-blue-100 bg-white p-4">
            <div className="text-xs font-extrabold text-blue-700">
              알림 예시
            </div>
            <div className="mt-3 max-w-full rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-blue-700">
                  W
                </span>
                Westory
                <span className="ml-auto">지금</span>
              </div>
              <div className="mt-3 text-sm font-extrabold text-gray-900">
                {toFriendlyNotificationText(event, policy.titleTemplate)}
              </div>
              <div className="mt-2 text-xs leading-5 text-gray-600">
                {toFriendlyNotificationText(event, policy.bodyTemplate)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderEventRow = (event: NotificationEventDefinition) => {
    const policy = getPolicy(event);
    const disabled = getEventDisabled(event);
    const isOpen = openEventKey === event.key;
    return (
      <div
        key={event.key}
        className={`overflow-hidden rounded-lg border bg-white transition ${
          isOpen ? "border-blue-300 shadow-sm" : "border-gray-200"
        }`}
      >
        <div className="p-3">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => setOpenEventKey(isOpen ? null : event.key)}
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                event.audience === "students"
                  ? "bg-blue-50 text-blue-600"
                  : "bg-indigo-50 text-indigo-600"
              }`}
              aria-label={`${event.label} 상세 설정`}
            >
              <i
                className={
                  event.audience === "students"
                    ? "fas fa-user-graduate"
                    : "fas fa-chalkboard-teacher"
                }
                aria-hidden="true"
              ></i>
            </button>

            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setOpenEventKey(isOpen ? null : event.key)}
                className="block w-full min-w-0 text-left"
              >
                <span className="block truncate text-sm font-extrabold text-gray-900">
                  {event.label}
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {renderStatusBadge(event)}
                  <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-extrabold text-gray-600">
                    {event.recipientLabel}
                  </span>
                </span>
                <span className="mt-2 block truncate text-xs font-bold text-gray-500">
                  {event.triggerLabel}
                </span>
              </button>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-extrabold text-gray-700">
                  {renderSwitch(
                    policy.enabled,
                    disabled,
                    (checked) => updatePolicy(event.key, { enabled: checked }),
                    `${event.label} 보내기`,
                  )}
                  보내기
                </label>
                <select
                  value={policy.priority}
                  disabled={disabled || !policy.enabled}
                  onChange={(eventTarget) =>
                    updatePolicy(event.key, {
                      priority: eventTarget.target
                        .value as NotificationPriority,
                    })
                  }
                  className="min-w-[84px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  aria-label={`${event.label} 중요도`}
                >
                  <option value="normal">일반</option>
                  <option value="high">중요</option>
                </select>
                <button
                  type="button"
                  onClick={() => resetPolicy(event)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-extrabold text-gray-500 transition hover:border-blue-200 hover:text-blue-600"
                >
                  기본값
                </button>
                <button
                  type="button"
                  onClick={() => setOpenEventKey(isOpen ? null : event.key)}
                  className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-blue-600"
                  aria-label={`${event.label} 상세 설정`}
                >
                  <i
                    className={`fas fa-chevron-down text-xs transition ${
                      isOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  ></i>
                </button>
              </div>
            </div>
          </div>
        </div>
        {isOpen && renderEventEditor(event)}
      </div>
    );
  };

  const renderOverviewEventRow = (event: NotificationEventDefinition) => {
    const policy = getPolicy(event);
    const disabled = getEventDisabled(event);
    return (
      <div
        key={event.key}
        className="rounded-lg border border-gray-200 bg-white p-3"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                event.audience === "students"
                  ? "bg-blue-50 text-blue-600"
                  : "bg-indigo-50 text-indigo-600"
              }`}
            >
              <i
                className={
                  event.audience === "students"
                    ? "fas fa-user-graduate"
                    : "fas fa-chalkboard-teacher"
                }
                aria-hidden="true"
              ></i>
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold text-gray-900">
                {event.label}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {renderStatusBadge(event)}
                <span className="shrink-0 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-extrabold text-gray-600">
                  {event.recipientLabel}
                </span>
              </div>
              <div className="mt-2 truncate text-xs font-bold text-gray-500">
                {event.triggerLabel}
              </div>
            </div>
          </div>
          <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-extrabold text-gray-700 sm:ml-4">
            {renderSwitch(
              policy.enabled,
              disabled,
              (checked) => updatePolicy(event.key, { enabled: checked }),
              `${event.label} 보내기`,
            )}
            보내기
          </label>
        </div>
      </div>
    );
  };

  const renderOverviewEventGroup = (
    title: string,
    description: string,
    icon: string,
    events: NotificationEventDefinition[],
  ) => (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <i className={icon} aria-hidden="true"></i>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-extrabold text-gray-900">{title}</h4>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-extrabold text-emerald-700">
              {events.length}개
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
      </div>
      <div className="space-y-2">{events.map(renderOverviewEventRow)}</div>
    </section>
  );

  const renderAllEvents = (events: NotificationEventDefinition[]) => (
    <div className="space-y-2">{events.map(renderEventRow)}</div>
  );

  if (loading)
    return (
      <InlineLoading message="알림 설정을 불러오는 중입니다." showWarning />
    );

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-white px-5 shadow-sm">
        <div className="py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <h3 className="flex items-center text-2xl font-extrabold text-gray-900">
              <span className="mr-3 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                <i className="fas fa-bell" aria-hidden="true"></i>
              </span>
              <span>
                알림 관리
                <span className="mt-2 block text-sm font-medium text-gray-500">
                  학생과 교사에게 전달되는 알림을 상황별로 관리합니다.
                </span>
              </span>
            </h3>
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={saving}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-blue-600 px-6 font-extrabold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-blue-300"
            >
              <i className="fas fa-save mr-2" aria-hidden="true"></i>
              {saving ? "저장 중..." : "알림 설정 저장"}
            </button>
          </div>
        </div>
        <div className="border-t border-gray-100 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h4 className="text-base font-extrabold text-gray-900">
                알림 설정
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                전체 및 대상별 알림 사용 여부를 설정합니다.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:min-w-[660px]">
              {[
                {
                  title: "전체 알림",
                  subtitle: "모든 알림 사용",
                  checked: config.enabled,
                  disabled: false,
                  onChange: (checked: boolean) =>
                    updateRootField("enabled", checked),
                },
                {
                  title: "학생 알림",
                  subtitle: "학생 대상 알림 사용",
                  checked: config.studentNotificationsEnabled,
                  disabled: !config.enabled,
                  onChange: (checked: boolean) =>
                    updateRootField("studentNotificationsEnabled", checked),
                },
                {
                  title: "교사 알림",
                  subtitle: "교사 대상 알림 사용",
                  checked: config.teacherNotificationsEnabled,
                  disabled: !config.enabled,
                  onChange: (checked: boolean) =>
                    updateRootField("teacherNotificationsEnabled", checked),
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <div>
                    <div className="text-sm font-extrabold text-gray-900">
                      {item.title}
                    </div>
                    <div className="mt-0.5 text-xs font-bold text-gray-500">
                      {item.subtitle}
                    </div>
                  </div>
                  {renderSwitch(
                    item.checked,
                    item.disabled,
                    item.onChange,
                    item.title,
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white px-5 pt-4 shadow-sm">
        <div className="flex gap-6 overflow-x-auto">
          {TAB_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveTab(item.key)}
              className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-extrabold transition ${
                activeTab === item.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-900"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {renderOverviewEventGroup(
            AUDIENCE_META.students.title,
            "학생에게 보내는 알림의 사용 여부만 빠르게 조정합니다.",
            AUDIENCE_META.students.icon,
            studentEvents,
          )}
          {renderOverviewEventGroup(
            AUDIENCE_META.teachers.title,
            "교사에게 보내는 알림의 사용 여부만 빠르게 조정합니다.",
            AUDIENCE_META.teachers.icon,
            teacherEvents,
          )}
        </div>
      )}

      {activeTab !== "overview" && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-base font-extrabold text-gray-900">
                {activeTab === "students" && "학생 알림"}
                {activeTab === "teachers" && "교사 알림"}
                {activeTab === "pending" && "미연동 항목"}
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                {activeTab === "students" &&
                  "학생에게 전달되는 알림을 한 번에 관리합니다."}
                {activeTab === "teachers" &&
                  "교사와 담당자에게 전달되는 알림을 한 번에 관리합니다."}
                {activeTab === "pending" &&
                  "자동 발송 연결을 앞두고 미리 정해 둘 알림입니다."}
              </p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-extrabold text-blue-700">
              {activeTab === "students" && `${studentEvents.length}개`}
              {activeTab === "teachers" && `${teacherEvents.length}개`}
              {activeTab === "pending" && `${pendingEvents.length}개`}
            </span>
          </div>
          {renderAllEvents(
            activeTab === "students"
              ? studentEvents
              : activeTab === "teachers"
                ? teacherEvents
                : pendingEvents,
          )}
        </section>
      )}

      <div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
          <i
            className="fas fa-exclamation-triangle mr-2"
            aria-hidden="true"
          ></i>
          준비 중인 알림은 문구와 발송 여부를 미리 정해 둘 수 있습니다. 실제
          발송은 해당 활동의 자동 알림 연결이 완료된 뒤 적용됩니다.
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        현재 사용 중인 알림 {enabledCount}개
      </div>
    </div>
  );
};

export default SettingsNotifications;
