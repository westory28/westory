import React, {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type FullCalendar from "@fullcalendar/react";
import { useNavigate } from "react-router-dom";
import ScheduleEventDetailModal from "../../components/common/ScheduleEventDetailModal";
import StatePanel from "../../components/common/StatePanel";
import WisHallOfFameRecognitionModal from "../../components/common/WisHallOfFameRecognitionModal";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import { useAuth } from "../../contexts/AuthContext";
import { runAfterNextPaint, runWhenIdle } from "../../lib/browserTasks";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import { markLoginPerf, measureLoginPerf } from "../../lib/loginPerf";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import { readSiteSettingDoc } from "../../lib/siteSettings";
import { getStudentClassKey } from "../../lib/visibleSchedule";
import {
  W8DomainError,
  getW8DomainState,
  toW8LocalDateTimeInput,
  toW8StatePanelState,
  type AttendanceStatus,
  type W8AttendanceRecord,
  type W8AttendanceSession,
  type W8ScheduleEvent,
} from "../../lib/w8Domains";
import {
  loadHallOfFameRecognition,
  markHallOfFameRecognitionSeen,
  type HallOfFameRecognition,
} from "../../lib/wisHallOfFameRecognition";
import type { CalendarEvent } from "../../types";

const CalendarSection = lazy(() => import("./components/CalendarSection"));
const NoticeBoard = lazy(() => import("./components/NoticeBoard"));
const SearchModal = lazy(() => import("./components/SearchModal"));

const normalizeClassValue = (value: unknown): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  const digits = normalized.match(/\d+/)?.[0] || "";
  if (!digits) return normalized;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return String(parsed);
};

const withSuffix = (label: string, suffix: string) => {
  if (!label) return "";
  return label.endsWith(suffix) ? label : `${label}${suffix}`;
};

const legacyEventTypeFromW8 = (event: W8ScheduleEvent) => {
  const sourceMatch = event.sourceReference.match(
    /^legacy-calendar:(exam|performance|event|diagnosis|formative):/u,
  );
  if (sourceMatch) return sourceMatch[1];
  if (event.eventType === "HOLIDAY") return "holiday";
  if (event.eventType === "ASSESSMENT") return "performance";
  if (event.eventType === "LEARNING_DEADLINE") return "formative";
  return "event";
};

const toLegacyDate = (value: string) =>
  toW8LocalDateTimeInput(value).split("T")[0] || value.split("T")[0] || "";

const projectScheduleEvent = (
  event: W8ScheduleEvent,
  studentClassKey: string,
): CalendarEvent => ({
  id: event.eventId,
  title: event.title,
  description: event.description,
  start: toLegacyDate(event.startAt),
  end: toLegacyDate(event.endAt),
  period: event.period,
  eventType: legacyEventTypeFromW8(event),
  targetType: event.classIds.length ? "class" : "common",
  targetClass: event.classIds.length ? studentClassKey : undefined,
});

interface AttendanceProjection {
  dates: string[];
  label: string;
  title: string;
}

const EMPTY_ATTENDANCE_PROJECTION: AttendanceProjection = {
  dates: [],
  label: "기록 없음",
  title: "오늘 등록된 출석 기록이 없습니다.",
};

const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  UNRECORDED: "확인 전",
  PRESENT: "출석 완료",
  LATE: "지각 기록",
  ABSENT: "결석 기록",
  EARLY_LEAVE: "조퇴 기록",
  EXCUSED: "출석 인정",
};

const ATTENDED_STATUSES = new Set<AttendanceStatus>([
  "PRESENT",
  "LATE",
  "EARLY_LEAVE",
  "EXCUSED",
]);

const getKstDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const valueOf = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
};

const projectAttendance = (
  sessions: W8AttendanceSession[],
  records: W8AttendanceRecord[],
): AttendanceProjection => {
  const recordBySessionId = new Map(
    records.map((record) => [record.sessionId, record]),
  );
  const dates = Array.from(
    new Set(
      sessions
        .filter((session) => {
          const status = recordBySessionId.get(
            session.sessionId,
          )?.attendanceStatus;
          return status ? ATTENDED_STATUSES.has(status) : false;
        })
        .map((session) => session.date.split("T")[0])
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date)),
    ),
  ).sort();

  const todaySessions = sessions.filter(
    (session) => session.date.split("T")[0] === getKstDateKey(),
  );
  const todayStatuses = todaySessions.map(
    (session) =>
      recordBySessionId.get(session.sessionId)?.attendanceStatus ||
      "UNRECORDED",
  );
  if (todayStatuses.length === 0) {
    return { ...EMPTY_ATTENDANCE_PROJECTION, dates };
  }

  const recordedStatuses = todayStatuses.filter(
    (status) => status !== "UNRECORDED",
  );
  if (recordedStatuses.length === 0) {
    return {
      dates,
      label: "확인 전",
      title: "오늘 출석 기록을 아직 확인하지 않았습니다.",
    };
  }

  const uniqueStatuses = Array.from(new Set(recordedStatuses));
  const label =
    recordedStatuses.length !== todayStatuses.length ||
    uniqueStatuses.length > 1
      ? "기록 확인"
      : ATTENDANCE_STATUS_LABELS[uniqueStatuses[0]];
  const details = todaySessions.map((session, index) => {
    const period = session.period ? `${session.period} ` : "";
    return `${period}${ATTENDANCE_STATUS_LABELS[todayStatuses[index]]}`;
  });
  return {
    dates,
    label,
    title: `오늘 출석: ${details.join(", ")}`,
  };
};

const DashboardCalendarFallback: React.FC = () => (
  <div className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-xl bg-white p-4 shadow-sm md:min-h-0">
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-bold text-gray-800">
        <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
      </h2>
      <span className="text-xs font-semibold text-gray-400">
        초기 로드 최적화 중
      </span>
    </div>
    <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-blue-100 bg-blue-50/50 px-6 text-center text-sm font-medium text-blue-700">
      학사 일정을 먼저 준비하고 있습니다.
    </div>
  </div>
);

const StudentDashboard: React.FC = () => {
  const { config, configReady, currentUser, interfaceConfig, userData } =
    useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [welcomeText, setWelcomeText] = useState("학생 정보를 불러오는 중");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>(
    {},
  );
  const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>(
    {},
  );
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);
  const [hallOfFameRecognition, setHallOfFameRecognition] =
    useState<HallOfFameRecognition | null>(null);
  const [attendance, setAttendance] = useState<AttendanceProjection>(
    EMPTY_ATTENDANCE_PROJECTION,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<W8DomainError | null>(null);

  const calendarRef = useRef<FullCalendar>(null);
  const { categories } = useScheduleCategories();
  const studentClassKey = getStudentClassKey(userData?.grade, userData?.class);

  useEffect(() => {
    markLoginPerf("westory-student-dashboard-rendered");
    measureLoginPerf(
      "westory-first-page-render",
      "westory-login-first-route-decided",
      "westory-student-dashboard-rendered",
    );
    const cancel = runAfterNextPaint(() => {
      setSecondaryPanelsReady(true);
      markLoginPerf("westory-student-dashboard-interactive");
      measureLoginPerf(
        "westory-total-to-interactive",
        "westory-app-load-start",
        "westory-student-dashboard-interactive",
      );
    });
    return cancel;
  }, []);

  const load = useCallback(async () => {
    if (!configReady || !currentUser?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const nextState = await getW8DomainState({
        config,
        domain: "DASHBOARD",
        audience: "student",
        studentUid: currentUser.uid,
        source: "CURRENT",
      });
      const projectedEvents = nextState.scheduleEvents
        .filter((event) => event.status === "ACTIVE")
        .map((event) => projectScheduleEvent(event, studentClassKey));
      setAttendance(
        projectAttendance(
          nextState.attendanceSessions,
          nextState.attendanceRecords,
        ),
      );
      const year = nextState.semesterId.split("-")[0] || config?.year || "";
      try {
        const holidays = await getKoreanPublicHolidays(year);
        setEvents(
          mergeEventsWithKoreanPublicHolidays(projectedEvents, holidays),
        );
      } catch (holidayError) {
        console.error("Failed to load Korean public holidays:", holidayError);
        setEvents(projectedEvents);
      }
    } catch (caught) {
      setError(
        caught instanceof W8DomainError
          ? caught
          : new W8DomainError("UNKNOWN", "오늘 자료를 불러오지 못했습니다."),
      );
    } finally {
      setLoading(false);
    }
  }, [config, configReady, currentUser?.uid, studentClassKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const cancel = runWhenIdle(() => {
      void readSiteSettingDoc<{
        grades?: Array<{ value?: string; label?: string }>;
        classes?: Array<{ value?: string; label?: string }>;
      }>("school_config")
        .then((data) => {
          if (!data) return;
          const nextGradeMap: Record<string, string> = {};
          const nextClassMap: Record<string, string> = {};
          (data.grades || []).forEach((grade) => {
            const value = String(grade?.value ?? "").trim();
            const label = String(grade?.label ?? "").trim();
            if (value && label) nextGradeMap[value] = label;
          });
          (data.classes || []).forEach((schoolClass) => {
            const value = String(schoolClass?.value ?? "").trim();
            const label = String(schoolClass?.label ?? "").trim();
            if (value && label) nextClassMap[value] = label;
          });
          setGradeLabelMap(nextGradeMap);
          setClassLabelMap(nextClassMap);
        })
        .catch((schoolConfigError) => {
          console.error("Failed to load school labels:", schoolConfigError);
        });
    }, 500);
    return cancel;
  }, []);

  useEffect(() => {
    if (!userData) return;
    const gradeValue = normalizeClassValue(userData.grade);
    const classValue = normalizeClassValue(userData.class);
    const gradeLabel = gradeLabelMap[gradeValue] || gradeValue;
    const classLabel = classLabelMap[classValue] || classValue;
    if (gradeLabel && classLabel) {
      setWelcomeText(
        `${withSuffix(gradeLabel, "학년")} ${withSuffix(classLabel, "반")}의 대시보드`,
      );
    } else {
      setWelcomeText(`${(userData.name || "학생").trim()}의 대시보드`);
    }
  }, [classLabelMap, gradeLabelMap, userData]);

  useEffect(() => {
    if (!userData?.uid) {
      setHallOfFameRecognition(null);
      return;
    }
    let cancelled = false;
    const cancel = runWhenIdle(() => {
      void loadHallOfFameRecognition(
        config,
        userData,
        interfaceConfig?.hallOfFame,
      ).then((recognition) => {
        if (!cancelled && recognition) setHallOfFameRecognition(recognition);
      });
    }, 900);
    return () => {
      cancelled = true;
      cancel();
    };
  }, [config, interfaceConfig?.hallOfFame, userData]);

  const handleDateClick = (dateStr: string) => setSelectedDate(dateStr);
  const handleEventClick = (event: CalendarEvent) => {
    handleDateClick(event.start);
    setDetailEvent(event);
  };
  const handleSelectSearchResults = (dateStr: string) => {
    if (!calendarRef.current) return;
    calendarRef.current.getApi().gotoDate(dateStr);
    handleDateClick(dateStr);
  };
  const semesterLabel = useMemo(
    () => (config ? `${config.year}학년도 ${config.semester}학기` : ""),
    [config],
  );

  if (loading) return <StatePanel state="LOADING" />;
  if (error) {
    return (
      <StatePanel
        state={toW8StatePanelState(error)}
        description={error.message}
        action={{ label: "다시 불러오기", onClick: () => void load() }}
        retryable
      />
    );
  }

  return (
    <div className="dashboard-container student-dashboard-container mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-6 flex shrink-0 flex-col items-center justify-between gap-3 md:flex-row">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">
            {welcomeText}
          </h1>
          {config && (
            <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-md md:text-sm">
              {semesterLabel}
            </span>
          )}
        </div>
      </div>

      <div className="student-dashboard-grid flex h-auto min-h-[500px] flex-col gap-4 md:grid md:grid-cols-5 md:grid-rows-2">
        <div className="student-dashboard-notice order-1 md:order-2 md:col-span-2 md:row-span-1">
          {secondaryPanelsReady ? (
            <Suspense
              fallback={
                <div className="rounded-xl border border-yellow-200 bg-[#fffbeb] p-4 text-sm font-semibold text-amber-800/70">
                  알림장을 준비 중입니다.
                </div>
              }
            >
              <NoticeBoard />
            </Suspense>
          ) : (
            <div className="rounded-xl border border-yellow-200 bg-[#fffbeb] p-4 text-sm font-semibold text-amber-800/70">
              알림장을 준비 중입니다.
            </div>
          )}
        </div>

        <div className="student-dashboard-calendar order-2 md:order-1 md:col-span-3 md:row-span-2">
          <Suspense fallback={<DashboardCalendarFallback />}>
            <CalendarSection
              categories={categories}
              events={events}
              onDateClick={handleDateClick}
              onEventClick={handleEventClick}
              onSearchClick={() => setIsSearchOpen(true)}
              onAttendanceCheck={() => navigate("/student/attendance")}
              calendarRef={calendarRef}
              selectedDate={selectedDate}
              attendanceDates={attendance.dates}
              attendanceStatusLabel={attendance.label}
              attendanceStatusTitle={attendance.title}
            />
          </Suspense>
        </div>

        <div className="student-dashboard-ranking order-3 md:order-3 md:col-span-2 md:row-span-1">
          {secondaryPanelsReady ? (
            <WisRankingPanel
              config={config}
              hallOfFamePath="/student/points?tab=hall-of-fame"
            />
          ) : (
            <div className="flex h-full min-h-[260px] items-center justify-center rounded-xl border border-blue-100 bg-white p-4 text-sm font-semibold text-blue-700/70 shadow-sm">
              위스 순위를 준비 중입니다.
            </div>
          )}
        </div>
      </div>

      {isSearchOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-20 text-sm font-semibold text-white">
              검색 도구를 준비 중입니다.
            </div>
          }
        >
          <SearchModal
            categories={categories}
            events={events}
            isOpen={isSearchOpen}
            onClose={() => setIsSearchOpen(false)}
            onSelectEvent={handleSelectSearchResults}
          />
        </Suspense>
      )}

      <WisHallOfFameRecognitionModal
        recognition={hallOfFameRecognition}
        onClose={() => {
          if (hallOfFameRecognition) {
            markHallOfFameRecognitionSeen(hallOfFameRecognition.seenKey);
          }
          setHallOfFameRecognition(null);
        }}
        onOpenHallOfFame={() => {
          if (hallOfFameRecognition) {
            markHallOfFameRecognitionSeen(hallOfFameRecognition.seenKey);
          }
          setHallOfFameRecognition(null);
          navigate("/student/points?tab=hall-of-fame");
        }}
      />

      <ScheduleEventDetailModal
        event={detailEvent}
        categories={categories}
        onClose={() => setDetailEvent(null)}
      />
    </div>
  );
};

export default StudentDashboard;
