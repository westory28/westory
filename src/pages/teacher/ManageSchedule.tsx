import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import { useAuth } from "../../contexts/AuthContext";
import { useAppToast } from "../../components/common/AppToastProvider";
import { isAdminUser } from "../../lib/permissions";
import { executeWestoryCommand } from "../../lib/commandGateway";
import { getArchiveEnrollmentState } from "../../lib/archiveEnrollment";
import {
  buildScheduleClassOptions,
  projectScheduleTargets,
  resolveScheduleTargets,
  PRESERVE_SCHEDULE_TARGETS,
  type ScheduleClassOption,
  type ScheduleTargets,
} from "../../lib/scheduleClassTargets";
import {
  W8DomainError,
  createScheduleEvent,
  deleteScheduleEvent,
  getW8DomainState,
  toW8LocalDateTimeInput,
  toW8ServerDateTime,
  updateScheduleEvent,
  type W8DomainState,
  type W8ScheduleEvent,
} from "../../lib/w8Domains";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end?: string;
  eventType:
    | "exam"
    | "performance"
    | "event"
    | "diagnosis"
    | "formative"
    | "holiday";
  targetType: "common" | "class";
  targetClass?: string;
  targetClassIds?: string[];
  targetUserIds?: string[];
  targetClassLabel?: string;
  description?: string;
  revision?: number;
  sourceDomain?: string;
  sourceReference?: string;
  provenance?: string;
  readOnly?: boolean;
  originalSchedule?: Pick<
    W8ScheduleEvent,
    "startAt" | "endAt" | "allDay" | "period" | "eventType" | "description"
  >;
}

type ScheduleFormData = Omit<
  CalendarEvent,
  | "id"
  | "revision"
  | "sourceDomain"
  | "sourceReference"
  | "provenance"
  | "readOnly"
  | "targetClassIds"
  | "targetUserIds"
  | "targetClassLabel"
  | "originalSchedule"
>;

interface SelectedEventIdentity extends ScheduleTargets {
  revision: number;
  sourceDomain: string;
  sourceReference: string;
  readOnly: boolean;
  targetClassLabel: string;
  semesterId: string;
  originalSchedule: NonNullable<CalendarEvent["originalSchedule"]>;
  formSnapshot: {
    start: string;
    end: string;
    endEnabled: boolean;
    eventType: CalendarEvent["eventType"];
    description: string;
  };
}

const LEGACY_EVENT_TYPES = new Set<CalendarEvent["eventType"]>([
  "exam",
  "performance",
  "event",
  "diagnosis",
  "formative",
  "holiday",
]);

const legacyEventTypeFromW8 = (event: W8ScheduleEvent) => {
  const sourceMatch = event.sourceReference.match(
    /^legacy-calendar:(exam|performance|event|diagnosis|formative):/u,
  );
  if (
    sourceMatch &&
    LEGACY_EVENT_TYPES.has(sourceMatch[1] as CalendarEvent["eventType"])
  ) {
    return sourceMatch[1] as CalendarEvent["eventType"];
  }
  if (event.eventType === "HOLIDAY") return "holiday";
  if (event.eventType === "ASSESSMENT") return "performance";
  if (event.eventType === "LEARNING_DEADLINE") return "formative";
  return "event";
};

const w8EventTypeFromLegacy = (eventType: CalendarEvent["eventType"]) => {
  if (["exam", "performance", "diagnosis", "formative"].includes(eventType)) {
    return "ASSESSMENT";
  }
  return "SCHOOL";
};

const newScheduleSourceKey = () => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const sourceReferenceForEventType = (
  sourceReference: string,
  eventType: CalendarEvent["eventType"],
  sourceKey: string,
) => {
  const existing = sourceReference.match(
    /^legacy-calendar:(?:exam|performance|event|diagnosis|formative):(.+)$/u,
  );
  if (existing) return `legacy-calendar:${eventType}:${existing[1]}`;
  return sourceReference || `legacy-calendar:${eventType}:${sourceKey}`;
};

const ManageSchedule = () => {
  const { currentUser, userData, config, configReady } = useAuth();
  const { showToast } = useAppToast();
  const [events, setEvents] = useState<any[]>([]);
  const [domainState, setDomainState] = useState<W8DomainState | null>(null);
  const [scheduleClasses, setScheduleClasses] = useState<ScheduleClassOption[]>(
    [],
  );
  const [currentConfig, setCurrentConfig] = useState<{
    year: string;
    semester: string;
  } | null>(null);
  const [filter, setFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [currentViewType, setCurrentViewType] = useState("dayGridMonth");

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [formData, setFormData] = useState<ScheduleFormData>({
    title: "",
    start: "",
    end: "",
    eventType: "performance",
    targetType: "common",
    targetClass: "",
    description: "",
  });
  const [endEnabled, setEndEnabled] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedEventIdentity, setSelectedEventIdentity] =
    useState<SelectedEventIdentity | null>(null);
  const [targetSelectionChanged, setTargetSelectionChanged] = useState(false);
  const [dateSelectionChanged, setDateSelectionChanged] = useState(false);
  const [createSourceKey, setCreateSourceKey] = useState(newScheduleSourceKey);
  const [holidaySyncing, setHolidaySyncing] = useState(false);
  const calendarRef = useRef<FullCalendar>(null);
  const canSyncHolidays = isAdminUser(userData, currentUser?.email);
  const [searchParams] = useSearchParams();
  const showHolidaySync =
    canSyncHolidays && searchParams.get("adminTools") === "holidays";

  const colorMap: { [key: string]: string } = {
    exam: "#ef4444", // Red
    performance: "#f97316", // Orange
    event: "#10b981", // Green
    diagnosis: "#3b82f6", // Blue
    formative: "#3b82f6", // Blue
  };

  const toLocalYmd = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split("T")[0];
  };

  const toDateKey = (value?: string) =>
    String(value || "")
      .split("T")[0]
      .trim();

  const toExclusiveEnd = (start?: string, end?: string) => {
    const startDateKey = toDateKey(start);
    const endDateKey = toDateKey(end);
    if (!startDateKey || !endDateKey || endDateKey <= startDateKey)
      return undefined;
    const endDate = new Date(`${endDateKey}T00:00:00`);
    endDate.setDate(endDate.getDate() + 1);
    return toLocalYmd(endDate);
  };

  const holidayDateSet = useMemo(() => {
    const set = new Set<string>();
    events.forEach((eventItem: any) => {
      const date = String(eventItem.start || "").split("T")[0];
      const title = String(eventItem.title || "");
      const isHolidayEvent =
        eventItem.classNames?.includes("holiday-text-event") ||
        eventItem.extendedProps?.eventType === "holiday" ||
        /공휴일|대체공휴일/.test(title);

      if (date && isHolidayEvent) {
        set.add(date);
      }
    });
    return set;
  }, [events]);

  const fetchEvents = async () => {
    if (!configReady || !config) return;
    try {
      const [nextState, enrollmentState] = await Promise.all([
        getW8DomainState({
          config,
          domain: "SCHEDULE",
          audience: "teacher",
          source: "CURRENT",
        }),
        getArchiveEnrollmentState({
          source: "CURRENT",
          callSite: "ManageSchedule.scheduleClasses",
        }),
      ]);
      if (enrollmentState.semesterId !== nextState.semesterId)
        throw new Error("학기가 바뀌었습니다. 일정을 다시 불러와 주세요.");
      const classes = buildScheduleClassOptions(
        nextState.semesterId,
        enrollmentState.classes,
      );
      setScheduleClasses(classes);
      setDomainState(nextState);
      const [year, semester] = nextState.semesterId.split("-");
      const nextConfig = {
        year: year || config.year,
        semester: semester || config.semester,
      };
      setCurrentConfig(nextConfig);
      const loadedEvents: CalendarEvent[] = [];
      nextState.scheduleEvents
        .filter((scheduleEvent) => scheduleEvent.status === "ACTIVE")
        .forEach((scheduleEvent) => {
          const eventType = legacyEventTypeFromW8(scheduleEvent);
          const d: CalendarEvent = {
            id: scheduleEvent.eventId,
            title: scheduleEvent.title,
            start:
              toW8LocalDateTimeInput(scheduleEvent.startAt).split("T")[0] ||
              toDateKey(scheduleEvent.startAt),
            end:
              toW8LocalDateTimeInput(scheduleEvent.endAt).split("T")[0] ||
              toDateKey(scheduleEvent.endAt),
            eventType,
            ...projectScheduleTargets(
              scheduleEvent.classIds,
              scheduleEvent.targetUserIds,
              classes,
            ),
            description: scheduleEvent.description,
            revision: scheduleEvent.revision,
            sourceDomain: scheduleEvent.sourceDomain,
            sourceReference: scheduleEvent.sourceReference,
            provenance: scheduleEvent.provenance,
            readOnly: nextState.readOnly,
            originalSchedule: {
              startAt: scheduleEvent.startAt,
              endAt: scheduleEvent.endAt,
              allDay: scheduleEvent.allDay,
              period: scheduleEvent.period,
              eventType: scheduleEvent.eventType,
              description: scheduleEvent.description,
            },
          };

          let isVisible = true;
          if (filter !== "all") {
            if (filter === "common") {
              if (d.targetType !== "common") isVisible = false;
            } else {
              if (
                d.targetType === "class" &&
                !(d.targetClassIds || []).includes(filter)
              )
                isVisible = false;
            }
          }

          if (isVisible) {
            loadedEvents.push(d);
          }
        });
      const holidays = await getKoreanPublicHolidays(nextConfig.year);
      const mergedEvents = mergeEventsWithKoreanPublicHolidays(
        loadedEvents,
        holidays,
      );
      setEvents(
        mergedEvents.map((event) => {
          const isHoliday = event.eventType === "holiday";
          return {
            id: event.id,
            title: event.title,
            start: toDateKey(event.start) || event.start,
            end: toExclusiveEnd(event.start, event.end),
            allDay: true,
            backgroundColor: isHoliday
              ? "#ef4444"
              : colorMap[event.eventType] || "#6b7280",
            borderColor: isHoliday
              ? "#ef4444"
              : colorMap[event.eventType] || "#6b7280",
            textColor: isHoliday ? "#ffffff" : undefined,
            classNames: isHoliday ? ["holiday-text-event"] : [],
            extendedProps: event,
          };
        }),
      );
    } catch (e) {
      console.error("Error fetching events:", e);
      showToast({
        tone: "error",
        title: "학사 일정을 불러오지 못했습니다.",
        message: e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [config, configReady, filter]);

  const handleHolidaySync = async () => {
    if (!currentConfig || holidaySyncing) return;
    setHolidaySyncing(true);
    try {
      const holidays = await getKoreanPublicHolidays(currentConfig.year);
      const response = await executeWestoryCommand("syncKoreanPublicHolidays", {
        year: currentConfig.year,
        semester: currentConfig.semester,
        holidays: holidays.map((holiday) => ({
          ...holiday,
          eventType: "holiday",
        })),
      });
      await fetchEvents();
      showToast({
        tone: "success",
        title: "공휴일 일정을 동기화했습니다.",
        message: `${response.result.count}건을 현재 학기 일정에 반영했습니다.`,
      });
    } catch (error: any) {
      showToast({
        tone: "error",
        title: "공휴일 일정 동기화에 실패했습니다.",
        message: error?.message || "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setHolidaySyncing(false);
    }
  };

  const handleDateClick = (arg: any) => {
    if (domainState?.readOnly) {
      alert("현재 학기 일정은 읽기 전용입니다.");
      return;
    }
    setSelectedDate(arg.dateStr);
    openModal(null, arg.dateStr);
  };

  const handleEventClick = (info: any) => {
    if (info.event.classNames.includes("holiday-text-event")) return;
    const props = info.event.extendedProps;
    if (
      domainState?.readOnly ||
      props.readOnly ||
      props.sourceDomain !== "USER"
    ) {
      alert("이 일정은 이 화면에서 수정할 수 없습니다.");
      return;
    }
    openModal({ ...props, id: info.event.id });
  };

  const openModal = (eventData: any | null, dateStr?: string) => {
    if (!eventData && domainState?.readOnly) {
      alert("현재 학기 일정은 읽기 전용입니다.");
      return;
    }
    if (eventData) {
      if (!eventData.originalSchedule) {
        alert("일정의 원본 시각을 확인할 수 없습니다. 다시 불러와 주세요.");
        return;
      }
      setIsEditMode(true);
      setSelectedEventId(eventData.id);
      setSelectedEventIdentity({
        revision: Number(eventData.revision || 0),
        sourceDomain: String(eventData.sourceDomain || ""),
        sourceReference: String(eventData.sourceReference || ""),
        readOnly: Boolean(eventData.readOnly),
        semesterId: domainState?.semesterId || "",
        targetClassIds: [
          ...(eventData.targetClassIds ||
            (eventData.targetClass ? [eventData.targetClass] : [])),
        ],
        targetUserIds: [...(eventData.targetUserIds || [])],
        targetClassLabel: eventData.targetClassLabel || "기존 대상",
        originalSchedule: { ...eventData.originalSchedule },
        formSnapshot: {
          start: eventData.start,
          end: eventData.end || "",
          endEnabled: Boolean(
            eventData.end && eventData.end !== eventData.start,
          ),
          eventType: eventData.eventType || "performance",
          description: eventData.description || "",
        },
      });
      setFormData({
        title: eventData.title,
        start: eventData.start,
        end: eventData.end || "",
        eventType: eventData.eventType || "performance",
        targetType: eventData.targetType || "common",
        targetClass:
          eventData.targetType === "class"
            ? eventData.targetClassIds?.length === 1 &&
              !eventData.targetUserIds?.length
              ? eventData.targetClassIds[0]
              : PRESERVE_SCHEDULE_TARGETS
            : "",
        description: eventData.description || "",
      });
      setEndEnabled(
        Boolean(eventData.end && eventData.end !== eventData.start),
      );
    } else {
      setIsEditMode(false);
      setSelectedEventId(null);
      setSelectedEventIdentity(null);
      setCreateSourceKey(newScheduleSourceKey());
      setFormData({
        title: "",
        start: dateStr || new Date().toISOString().split("T")[0],
        end: "",
        eventType: "performance",
        targetType: "common",
        targetClass: "",
        description: "",
      });
      setEndEnabled(false);
    }
    setTargetSelectionChanged(false);
    setDateSelectionChanged(false);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedEventIdentity(null);
    setTargetSelectionChanged(false);
    setDateSelectionChanged(false);
  };

  useEffect(() => {
    if (!modalOpen || formData.eventType !== "exam" || endEnabled) return;
    if (selectedEventIdentity?.formSnapshot.eventType === formData.eventType)
      return;
    setEndEnabled(true);
    setFormData((prev) => ({
      ...prev,
      end: prev.end || prev.start || "",
    }));
  }, [modalOpen, formData.eventType, endEnabled, selectedEventIdentity]);

  const handleSave = async () => {
    if (!formData.title || !formData.start) {
      alert("제목과 시작 날짜는 필수입니다.");
      return;
    }
    if (!domainState || domainState.readOnly) {
      alert("현재 학기 일정은 읽기 전용입니다.");
      return;
    }
    if (
      isEditMode &&
      (!selectedEventId ||
        !selectedEventIdentity ||
        selectedEventIdentity.readOnly ||
        selectedEventIdentity.sourceDomain !== "USER")
    ) {
      alert("이 일정은 이 화면에서 수정할 수 없습니다.");
      return;
    }

    const finalEnd = endEnabled
      ? formData.end || formData.start
      : formData.start;
    const sourceReference = sourceReferenceForEventType(
      selectedEventIdentity?.sourceReference || "",
      formData.eventType,
      createSourceKey,
    );
    let targets: ScheduleTargets;
    try {
      if (
        selectedEventIdentity &&
        selectedEventIdentity.semesterId !== domainState.semesterId
      )
        throw new Error("학기가 바뀌었습니다. 일정을 다시 열어 주세요.");
      targets = resolveScheduleTargets({
        original: selectedEventIdentity,
        selectionChanged: targetSelectionChanged,
        targetType: formData.targetType,
        targetClass: formData.targetClass,
        classes: scheduleClasses,
      });
      if (
        selectedEventIdentity &&
        targetSelectionChanged &&
        formData.targetType === "common" &&
        (selectedEventIdentity.targetClassIds.length ||
          selectedEventIdentity.targetUserIds.length) &&
        !confirm(
          "기존 학급·개별 대상 제한을 해제하고 전체 공통 일정으로 변경하시겠습니까?",
        )
      )
        return;
    } catch (error) {
      alert(
        error instanceof Error ? error.message : "일정 대상을 확인해 주세요.",
      );
      return;
    }
    const original = selectedEventIdentity?.originalSchedule;
    const formSnapshot = selectedEventIdentity?.formSnapshot;
    const preserveTime =
      original &&
      formSnapshot &&
      !dateSelectionChanged &&
      formData.start === formSnapshot.start &&
      (formData.end || "") === formSnapshot.end &&
      endEnabled === formSnapshot.endEnabled;
    const commandPayload = {
      semesterId: domainState.semesterId,
      expectedSemesterRevision: domainState.manifestRevision,
      eventType:
        original && formData.eventType === formSnapshot?.eventType
          ? original.eventType
          : w8EventTypeFromLegacy(formData.eventType),
      title: formData.title,
      description:
        original && (formData.description || "") === formSnapshot?.description
          ? original.description
          : formData.description || "",
      startAt: preserveTime
        ? original.startAt
        : toW8ServerDateTime(`${formData.start}T00:00`),
      endAt: preserveTime
        ? original.endAt
        : toW8ServerDateTime(`${finalEnd}T00:00`),
      allDay: preserveTime ? original.allDay : true,
      period: original?.period || "",
      ...targets,
      sourceDomain: selectedEventIdentity?.sourceDomain || "USER",
      sourceReference,
    };

    try {
      if (isEditMode && selectedEventId && selectedEventIdentity) {
        await updateScheduleEvent({
          ...commandPayload,
          eventId: selectedEventId,
          expectedEventRevision: selectedEventIdentity.revision,
        });
      } else {
        await createScheduleEvent(commandPayload);
      }
      closeModal();
      await fetchEvents();
    } catch (e: any) {
      alert("저장 실패: " + e.message);
      if (e instanceof W8DomainError && e.kind === "CONFLICT") {
        await fetchEvents();
      }
    }
  };

  const handleDelete = async () => {
    if (
      !selectedEventId ||
      !selectedEventIdentity ||
      !domainState ||
      domainState.readOnly ||
      selectedEventIdentity.readOnly ||
      selectedEventIdentity.sourceDomain !== "USER"
    ) {
      alert("이 일정은 이 화면에서 삭제할 수 없습니다.");
      return;
    }
    if (!window.confirm("정말 삭제하시겠습니까?")) return;

    try {
      await deleteScheduleEvent({
        semesterId: domainState.semesterId,
        expectedSemesterRevision: domainState.manifestRevision,
        eventId: selectedEventId,
        expectedEventRevision: selectedEventIdentity.revision,
        reason: "교사가 기존 일정 관리 화면에서 삭제를 명시적으로 선택함",
      });
      closeModal();
      await fetchEvents();
    } catch (e: any) {
      alert("삭제 실패: " + e.message);
      if (e instanceof W8DomainError && e.kind === "CONFLICT") {
        await fetchEvents();
      }
    }
  };

  return (
    <div className="bg-gray-50 flex flex-col min-h-screen">
      <div className="flex-1 w-full max-w-7xl mx-auto px-6 py-6 h-full flex flex-col">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4 shrink-0">
          <div>
            <h2 className="text-xl md:text-2xl font-bold text-gray-800">
              <i className="fas fa-calendar-alt text-blue-500 mr-2"></i>학사
              일정 관리
            </h2>
            <p className="text-xs md:text-sm text-gray-500 mt-1">
              수행평가, 정기 시험 등 주요 학사 일정을 관리하세요.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <span className="text-sm font-bold text-gray-600">보기 필터:</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm font-bold focus:border-blue-500 outline-none"
            >
              <option value="all">전체 일정</option>
              <option value="common">공통 일정만</option>
              {scheduleClasses.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            {showHolidaySync && (
              <button
                type="button"
                onClick={() => void handleHolidaySync()}
                disabled={holidaySyncing || !currentConfig}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                <i className="fas fa-rotate mr-1" aria-hidden="true"></i>
                {holidaySyncing ? "동기화 중..." : "공휴일 동기화"}
              </button>
            )}
            <button
              onClick={() => openModal(null)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-blue-700 shadow-sm ml-2"
            >
              <i className="fas fa-plus mr-1"></i> 일정 추가
            </button>
          </div>
        </div>

        <div className="student-calendar-section student-calendar-shell flex-1 min-h-[600px] md:min-h-0">
          <div
            className="calendar-wrapper student-calendar-shell__body"
            data-calendar-view={currentViewType}
          >
            <FullCalendar
              ref={calendarRef}
              plugins={[dayGridPlugin, interactionPlugin, listPlugin]}
              initialView="dayGridMonth"
              locale="ko"
              allDayText=""
              displayEventTime={false}
              headerToolbar={{
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,listMonth",
              }}
              buttonText={{ dayGridMonth: "달력", listMonth: "목록" }}
              events={events}
              datesSet={(arg) => setCurrentViewType(arg.view.type)}
              dateClick={handleDateClick}
              eventClick={handleEventClick}
              eventContent={(arg) => {
                const isListMonth = arg.view.type === "listMonth";
                const isDayGridMonth = arg.view.type === "dayGridMonth";
                if (!isListMonth && !isDayGridMonth) return undefined;

                const isHoliday =
                  arg.event.classNames.includes("holiday-text-event");
                return (
                  <div
                    className={`fc-segment-title ${isHoliday ? "holiday-segment-title" : ""}`}
                    title={arg.event.title}
                  >
                    {arg.event.title}
                  </div>
                );
              }}
              height="100%"
              contentHeight="100%"
              expandRows
              eventDisplay="block"
              dayMaxEvents={2}
              fixedWeekCount={false}
              showNonCurrentDates={false}
              dayCellClassNames={(arg) => {
                const dateStr = toLocalYmd(arg.date);
                const classes: string[] = [];
                if (holidayDateSet.has(dateStr)) classes.push("fc-day-holiday");
                if (selectedDate === dateStr) classes.push("fc-day-selected");
                return classes;
              }}
            />
          </div>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 md:p-6 relative">
            <h3 className="text-xl font-bold text-gray-800 mb-4 border-b pb-2 flex items-center">
              <i className="fas fa-edit text-blue-500 mr-2"></i>
              {isEditMode ? "일정 수정" : "일정 등록"}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  일정 제목
                </label>
                <input
                  type="text"
                  className="w-full border rounded p-2 text-sm font-bold focus:border-blue-500 outline-none"
                  placeholder="예: 역사 수행평가"
                  value={formData.title}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                />
              </div>

              <div
                className={`grid ${endEnabled ? "grid-cols-[minmax(0,1fr)_minmax(92px,42%)]" : "grid-cols-[minmax(0,1fr)_64px]"} gap-1.5 items-end overflow-hidden`}
              >
                <div className="min-w-0 overflow-hidden">
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    시작 날짜
                  </label>
                  <input
                    type="date"
                    className="block w-full max-w-full min-w-0 border rounded p-1.5 text-[10px] md:text-sm"
                    value={formData.start}
                    onChange={(e) => {
                      setDateSelectionChanged(true);
                      const nextStart = e.target.value;
                      setFormData((prev) => ({
                        ...prev,
                        start: nextStart,
                        end: endEnabled && !prev.end ? nextStart : prev.end,
                      }));
                    }}
                  />
                </div>
                <div className="min-w-0 overflow-hidden">
                  <label className="block text-xs font-bold text-gray-500 mb-1">
                    {endEnabled ? "종료 날짜" : "종료"}
                  </label>
                  {endEnabled ? (
                    <input
                      type="date"
                      className="block w-full max-w-full min-w-0 border rounded p-1.5 text-[10px] md:text-sm"
                      value={formData.end}
                      onChange={(e) => {
                        setDateSelectionChanged(true);
                        setFormData({ ...formData, end: e.target.value });
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDateSelectionChanged(true);
                        setEndEnabled(true);
                        setFormData((prev) => ({
                          ...prev,
                          end: prev.end || prev.start,
                        }));
                      }}
                      className="h-[34px] w-full rounded border border-gray-300 text-[10px] font-semibold text-gray-700"
                    >
                      종료+
                    </button>
                  )}
                  {endEnabled && formData.eventType !== "exam" && (
                    <button
                      type="button"
                      onClick={() => {
                        setDateSelectionChanged(true);
                        setEndEnabled(false);
                        setFormData((prev) => ({ ...prev, end: "" }));
                      }}
                      className="mt-1 text-[10px] text-gray-500 hover:text-gray-700 underline"
                    >
                      종료 비활성화
                    </button>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  일정 종류
                </label>
                <select
                  className="w-full border rounded p-2 text-sm font-bold bg-white"
                  value={formData.eventType}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      eventType: e.target.value as any,
                    })
                  }
                >
                  <option value="exam">🔴 정기 시험</option>
                  <option value="performance">🟠 수행평가</option>
                  <option value="event">🟢 행사/기타</option>
                  <option value="diagnosis">🔵 진단평가</option>
                  <option value="formative">🔵 형성평가</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-2">
                  대상 선택
                </label>
                <div className="flex gap-4 mb-2">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      value="common"
                      checked={formData.targetType === "common"}
                      onChange={() => {
                        setTargetSelectionChanged(true);
                        setFormData({ ...formData, targetType: "common" });
                      }}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-2 text-sm font-bold">전체 공통</span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="targetType"
                      value="class"
                      checked={formData.targetType === "class"}
                      onChange={() => {
                        setTargetSelectionChanged(
                          formData.targetClass !== PRESERVE_SCHEDULE_TARGETS,
                        );
                        setFormData({ ...formData, targetType: "class" });
                      }}
                      className="w-4 h-4 text-blue-600"
                    />
                    <span className="ml-2 text-sm font-bold">반 선택</span>
                  </label>
                </div>
                <select
                  className="w-full border rounded p-2 text-sm bg-gray-50 disabled:opacity-50"
                  disabled={formData.targetType !== "class"}
                  value={formData.targetClass}
                  onChange={(e) => {
                    setTargetSelectionChanged(
                      e.target.value !== PRESERVE_SCHEDULE_TARGETS,
                    );
                    setFormData({ ...formData, targetClass: e.target.value });
                  }}
                >
                  <option value="" disabled>
                    학급 선택
                  </option>
                  {selectedEventIdentity &&
                    (selectedEventIdentity.targetClassIds.length > 0 ||
                      selectedEventIdentity.targetUserIds.length > 0) && (
                      <option value={PRESERVE_SCHEDULE_TARGETS}>
                        기존 대상 유지
                      </option>
                    )}
                  {scheduleClasses.map((item) => (
                    <option
                      key={item.value}
                      value={item.value}
                      disabled={!item.selectable}
                    >
                      {item.label}
                      {!item.selectable ? " (선택 불가)" : ""}
                    </option>
                  ))}
                </select>
                {selectedEventIdentity &&
                  (selectedEventIdentity.targetClassIds.length > 1 ||
                    selectedEventIdentity.targetUserIds.length > 0) && (
                    <p className="mt-2 text-xs text-gray-500">
                      기존 대상: {selectedEventIdentity.targetClassLabel}.
                      대상을 바꾸지 않으면 그대로 유지합니다.
                      {selectedEventIdentity.targetUserIds.length > 0 &&
                        " 학급만 변경해도 기존 개별 대상은 유지합니다."}
                    </p>
                  )}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">
                  상세 내용
                </label>
                <textarea
                  className="w-full border rounded p-2 text-sm h-20 resize-none"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                ></textarea>
              </div>
            </div>

            <div className="flex justify-between items-center mt-6 pt-4 border-t">
              {isEditMode ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="text-red-500 font-bold text-sm hover:text-red-700"
                >
                  <i className="fas fa-trash mr-1"></i>삭제
                </button>
              ) : (
                <div></div>
              )}

              <div className="flex gap-2 ml-auto">
                <button
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-100 text-gray-600 rounded font-bold text-sm hover:bg-gray-200"
                >
                  취소
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-blue-600 text-white rounded font-bold text-sm hover:bg-blue-700 shadow-md"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
                .fc-toolbar-title { font-size: 1.25em !important; font-weight: 700; color: #1f2937; }
                .fc-button { background-color: #2563eb !important; border-color: #2563eb !important; font-weight: 600 !important; }
                .fc-daygrid-event { cursor: pointer; border-radius: 4px; padding: 2px 4px; font-size: 0.85rem; font-weight: 600; border: none; }
                .fc-day-sun a { color: #ef4444 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-sat:not(.fc-day-holiday) a { color: #3b82f6 !important; text-decoration: none; font-weight: 700 !important; }
                .fc-day-holiday a { color: #ef4444 !important; font-weight: 700 !important; text-decoration: none; }
                .fc-day-selected { background-color: #eff6ff !important; outline: 2px solid #3b82f6 !important; outline-offset: -2px !important; }
                .fc-daygrid-event.holiday-text-event { background-color: #ef4444 !important; border-color: #ef4444 !important; }
                .fc-daygrid-event.holiday-text-event .fc-event-title { color: #ffffff !important; font-size: 0.75rem; font-weight: 800; }
                .fc-list-event.holiday-text-event { background-color: transparent !important; border: none !important; }
                .fc-list-event.holiday-text-event .fc-list-event-title a { color: #ef4444 !important; font-weight: 800 !important; }
                .fc-segment-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; padding: 0 2px; }
                .fc-daygrid-event .holiday-segment-title { color: #ffffff !important; font-weight: 800 !important; }
                .fc-list-event .holiday-segment-title { color: #ef4444 !important; font-weight: 800 !important; }
            `}</style>
    </div>
  );
};

export default ManageSchedule;
