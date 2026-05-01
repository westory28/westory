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
    triggerLabel: "수업자료 공개 저장",
    recipientLabel: "전체 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "새 학습지가 업데이트되었습니다",
    bodyTemplate: "{lessonTitle} 자료를 확인해 보세요.",
    targetUrl: "/student/lesson/note",
  },
  {
    key: "history_classroom_assigned",
    label: "역사교실 과제 배정",
    audience: "students",
    description:
      "역사교실 과제가 공개되거나 새로 배정되었을 때 대상 학생에게 안내합니다.",
    triggerLabel: "역사교실 배정 공개",
    recipientLabel: "배정 대상 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사교실이 배정되었습니다",
    bodyTemplate: "{assignmentTitle} 과제가 새로 열렸습니다.",
    targetUrl: "/student/history-classroom",
  },
  {
    key: "point_order_reviewed",
    label: "상점 구매 처리 결과",
    audience: "students",
    description:
      "교사가 위스 상점 구매 요청을 승인하거나 반려했을 때 학생에게 처리 결과를 안내합니다.",
    triggerLabel: "구매 요청 처리",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "상점 구매 처리",
    bodyTemplate: "{productName} 구매 요청이 {statusLabel} 처리되었습니다.",
    targetUrl: "/student/points",
  },
  {
    key: "history_dictionary_resolved",
    label: "역사 사전 요청 해결",
    audience: "students",
    description:
      "학생이 요청한 역사 사전 뜻풀이가 등록되거나 승인되었을 때 안내합니다.",
    triggerLabel: "뜻풀이 등록·승인",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 등록 완료",
    bodyTemplate: '요청한 "{word}" 뜻풀이가 등록되었습니다.',
    targetUrl: "/student/dashboard",
  },
  {
    key: "history_dictionary_rejected",
    label: "역사 사전 요청 반려",
    audience: "students",
    description:
      "요청한 역사 사전 단어가 교사 확인 후 삭제되거나 반려되었을 때 학생에게 안내합니다.",
    triggerLabel: "뜻풀이 요청 삭제·반려",
    recipientLabel: "요청 학생",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 단어 삭제",
    bodyTemplate: '"{word}" 항목이 선생님 확인 후 삭제되었습니다.',
    targetUrl: "/student/lesson/history-dictionary",
  },
  {
    key: "question_replied",
    label: "질문 답변 등록",
    audience: "students",
    description:
      "교사가 학생 질문에 답변했을 때 학생에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "질문 답변 저장",
    recipientLabel: "질문 작성 학생",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "질문에 답변이 등록되었습니다",
    bodyTemplate: "{questionTitle} 답변을 확인해 보세요.",
    targetUrl: "/student/dashboard",
  },
  {
    key: "system_notice",
    label: "전체 학생 공지",
    audience: "students",
    description:
      "관리자가 전체 학생에게 직접 공지성 알림을 보낼 때 사용할 기본 정책입니다.",
    triggerLabel: "관리자 직접 발송",
    recipientLabel: "전체 학생",
    status: "needs-hook",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "알림",
    bodyTemplate: "확인할 안내가 있습니다.",
    targetUrl: "/student/dashboard",
  },
  {
    key: "history_classroom_submitted",
    label: "역사교실 제출 완료",
    audience: "teachers",
    description:
      "학생이 역사교실 과제를 제출했을 때 교사에게 제출 사실과 정답률을 안내합니다.",
    triggerLabel: "학생 제출 완료",
    recipientLabel: "교사·평가 권한자",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사교실 제출 알림",
    bodyTemplate: "{studentName} 학생이 {assignmentTitle}을(를) 제출했습니다.",
    targetUrl: "/teacher/quiz?menu=history2",
  },
  {
    key: "point_order_requested",
    label: "상점 구매 요청",
    audience: "teachers",
    description:
      "학생이 위스 상점 구매를 요청했을 때 포인트 관리 담당자에게 안내합니다.",
    triggerLabel: "구매 요청 확정",
    recipientLabel: "관리자·위스 관리자",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "상점 구매 요청",
    bodyTemplate: "{studentName} 학생이 {productName} 구매를 요청했습니다.",
    targetUrl: "/teacher/points",
  },
  {
    key: "history_dictionary_requested",
    label: "역사 사전 뜻풀이 요청",
    audience: "teachers",
    description:
      "학생이 역사 사전 뜻풀이를 요청했을 때 수업자료 담당자에게 안내합니다.",
    triggerLabel: "뜻풀이 요청 제출",
    recipientLabel: "관리자·수업자료 담당자",
    status: "connected",
    defaultEnabled: true,
    defaultPriority: "normal",
    titleTemplate: "역사 사전 요청",
    bodyTemplate: '{studentName} 학생이 "{word}" 뜻풀이를 요청했습니다.',
    targetUrl: "/teacher/lesson/history-dictionary",
  },
  {
    key: "quiz_submitted",
    label: "퀴즈 제출 완료",
    audience: "teachers",
    description:
      "학생이 퀴즈를 제출했을 때 교사에게 제출 완료를 안내하도록 준비하는 항목입니다.",
    triggerLabel: "퀴즈 제출",
    recipientLabel: "교사·평가 권한자",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "퀴즈 제출 알림",
    bodyTemplate: "{studentName} 학생이 {quizTitle}을(를) 제출했습니다.",
    targetUrl: "/teacher/quiz?tab=log",
  },
  {
    key: "lesson_unit_completed",
    label: "수업자료 학습 완료",
    audience: "teachers",
    description:
      "학생이 수업자료 빈칸 학습을 완료했을 때 교사에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "모든 빈칸 저장 완료",
    recipientLabel: "교사·수업자료 담당자",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "수업자료 학습 완료",
    bodyTemplate: "{studentName} 학생이 {lessonTitle} 학습을 완료했습니다.",
    targetUrl: "/teacher/lesson",
  },
  {
    key: "think_cloud_submitted",
    label: "생각모아 제출",
    audience: "teachers",
    description:
      "학생이 생각모아 활동에 참여했을 때 교사에게 안내하도록 준비하는 항목입니다.",
    triggerLabel: "생각모아 응답 제출",
    recipientLabel: "교사·수업자료 담당자",
    status: "needs-hook",
    defaultEnabled: false,
    defaultPriority: "normal",
    titleTemplate: "생각모아 참여 알림",
    bodyTemplate: "{studentName} 학생이 {topic}에 응답했습니다.",
    targetUrl: "/teacher/lesson/think-cloud",
  },
];

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
    label: "연동됨",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  "needs-hook": {
    label: "연동 준비",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
};

const AUDIENCE_META: Record<
  NotificationAudience,
  { title: string; description: string; icon: string }
> = {
  students: {
    title: "학생이 받는 알림",
    description: "학생 화면의 알림 버튼에서 확인하는 인앱 알림입니다.",
    icon: "fas fa-user-graduate",
  },
  teachers: {
    title: "교사가 받는 알림",
    description: "교사와 담당 권한자가 학생 행동을 확인하는 운영 알림입니다.",
    icon: "fas fa-chalkboard-teacher",
  },
};

const SettingsNotifications: React.FC = () => {
  const { currentUser, config: semesterConfig } = useAuth();
  const { showToast } = useAppToast();
  const [config, setConfig] = useState<NotificationConfigState>(() =>
    createDefaultConfig(),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

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
        message: "후속 발송 제어 연결 기준으로 사용할 수 있습니다.",
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

  const renderEventRows = (events: NotificationEventDefinition[]) => (
    <div className="divide-y divide-gray-100">
      {events.map((event) => {
        const policy =
          config.eventPolicies[event.key] || buildDefaultPolicy(event);
        const statusMeta = STATUS_META[event.status];
        const audienceDisabled =
          event.audience === "students"
            ? !config.studentNotificationsEnabled
            : !config.teacherNotificationsEnabled;
        const disabled = !config.enabled || audienceDisabled;

        return (
          <div key={event.key} className="p-4 lg:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-extrabold text-gray-900">
                    {event.label}
                  </h4>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusMeta.className}`}
                  >
                    {statusMeta.label}
                  </span>
                  <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600">
                    {event.recipientLabel}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  {event.description}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
                  <span>트리거: {event.triggerLabel}</span>
                  <span className="text-gray-300">/</span>
                  <span>키: {event.key}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${
                    disabled
                      ? "border-gray-200 bg-gray-50 text-gray-400"
                      : "border-gray-200 bg-white text-gray-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={policy.enabled}
                    disabled={disabled}
                    onChange={(eventTarget) =>
                      updatePolicy(event.key, {
                        enabled: eventTarget.target.checked,
                      })
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  발송
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
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                  aria-label={`${event.label} 중요도`}
                >
                  <option value="normal">일반</option>
                  <option value="high">중요</option>
                </select>
                <button
                  type="button"
                  onClick={() => resetPolicy(event)}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-500 transition hover:border-blue-200 hover:text-blue-600"
                >
                  기본값
                </button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-500">
                  제목 템플릿
                </label>
                <input
                  type="text"
                  value={policy.titleTemplate}
                  disabled={disabled}
                  onChange={(eventTarget) =>
                    updatePolicy(event.key, {
                      titleTemplate: eventTarget.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-gray-500">
                  바로가기
                </label>
                <input
                  type="text"
                  value={policy.targetUrl}
                  disabled={disabled}
                  onChange={(eventTarget) =>
                    updatePolicy(event.key, {
                      targetUrl: eventTarget.target.value,
                    })
                  }
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
              <div className="xl:col-span-2">
                <label className="mb-1 block text-xs font-bold text-gray-500">
                  본문 템플릿
                </label>
                <textarea
                  value={policy.bodyTemplate}
                  disabled={disabled}
                  rows={2}
                  onChange={(eventTarget) =>
                    updatePolicy(event.key, {
                      bodyTemplate: eventTarget.target.value,
                    })
                  }
                  className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  if (loading)
    return (
      <InlineLoading message="알림 설정을 불러오는 중입니다." showWarning />
    );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="border-b border-gray-100 pb-4">
          <h3 className="text-lg font-bold text-gray-900">
            <i
              className="fas fa-bell text-blue-500 mr-2"
              aria-hidden="true"
            ></i>
            알림 관리
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            교사와 학생에게 전달할 인앱 알림 정책을 현재 운영 흐름에 맞게
            관리합니다.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="text-xs font-bold text-blue-700">
              현재 운영 학기
            </div>
            <div className="mt-1 text-lg font-extrabold text-blue-900">
              {semesterConfig?.year || "2026"}학년도{" "}
              {semesterConfig?.semester || "1"}학기
            </div>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-xs font-bold text-emerald-700">
              현재 연동된 알림
            </div>
            <div className="mt-1 text-lg font-extrabold text-emerald-900">
              {connectedCount}개
            </div>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-4">
            <div className="text-xs font-bold text-amber-700">
              후속 연결 준비 항목
            </div>
            <div className="mt-1 text-lg font-extrabold text-amber-900">
              {preparedCount}개
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h4 className="text-base font-extrabold text-gray-900">
              기본 발송 범위
            </h4>
            <p className="mt-1 text-sm text-gray-500">
              전체 알림을 끄면 학생·교사 알림 정책이 모두 비활성 상태로
              저장됩니다.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="text-sm font-bold text-gray-700">전체 알림</span>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(event) =>
                  updateRootField("enabled", event.target.checked)
                }
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="text-sm font-bold text-gray-700">학생 알림</span>
              <input
                type="checkbox"
                checked={config.studentNotificationsEnabled}
                disabled={!config.enabled}
                onChange={(event) =>
                  updateRootField(
                    "studentNotificationsEnabled",
                    event.target.checked,
                  )
                }
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
            </label>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
              <span className="text-sm font-bold text-gray-700">교사 알림</span>
              <input
                type="checkbox"
                checked={config.teacherNotificationsEnabled}
                disabled={!config.enabled}
                onChange={(event) =>
                  updateRootField(
                    "teacherNotificationsEnabled",
                    event.target.checked,
                  )
                }
                className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
            </label>
          </div>
        </div>
      </div>

      {[
        { audience: "students" as const, events: studentEvents },
        { audience: "teachers" as const, events: teacherEvents },
      ].map(({ audience, events }) => {
        const meta = AUDIENCE_META[audience];
        return (
          <section
            key={audience}
            className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
          >
            <div className="border-b border-gray-100 p-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <i className={meta.icon} aria-hidden="true"></i>
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-gray-900">
                    {meta.title}
                  </h4>
                  <p className="mt-1 text-sm text-gray-500">
                    {meta.description}
                  </p>
                </div>
              </div>
            </div>
            {renderEventRows(events)}
          </section>
        );
      })}

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
        <i className="fas fa-exclamation-triangle mr-2" aria-hidden="true"></i>
        연동 준비 항목은 정책을 미리 저장할 수 있지만, 실제 발송은 해당 학생
        행동 지점과 Functions 발송부 연결 후 적용됩니다.
      </div>

      <div className="pb-8 text-right">
        <button
          type="button"
          onClick={() => void saveConfig()}
          disabled={saving}
          className="rounded-xl bg-blue-600 px-8 py-3 font-bold text-white shadow-lg transition hover:bg-blue-700 disabled:bg-blue-300"
        >
          <i className="fas fa-save mr-2" aria-hidden="true"></i>
          {saving ? "저장 중..." : "알림 설정 저장"}
        </button>
      </div>
    </div>
  );
};

export default SettingsNotifications;
