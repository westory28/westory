import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { useAttendanceDates } from "./hooks/useAttendanceDates";
import { checkStudentAttendance, attendanceErrorMessage } from "./attendance";
import { runAfterNextPaint, runWhenIdle } from "../../lib/browserTasks";
import { markLoginPerf, measureLoginPerf } from "../../lib/loginPerf";
import { notifyPointsUpdated } from "../../lib/appEvents";
import {
  buildAttendanceSourceId,
  buildPointRewardFeedback,
} from "../../lib/points";
import { useScheduleCategories } from "../../lib/scheduleCategories";
import { getYearSemester } from "../../lib/semesterScope";
import {
  getKoreanPublicHolidays,
  mergeEventsWithKoreanPublicHolidays,
} from "../../lib/koreanPublicHolidays";
import {
  getStudentClassKey,
  subscribeVisibleCalendarEvents,
} from "../../lib/visibleSchedule";
import { CalendarEvent } from "../../types";
import { useAppToast } from "../../components/common/AppToastProvider";
import WisHallOfFameRecognitionModal from "../../components/common/WisHallOfFameRecognitionModal";
import {
  loadHallOfFameRecognition,
  markHallOfFameRecognitionSeen,
  type HallOfFameRecognition,
} from "../../lib/wisHallOfFameRecognition";
import ScheduleEventDetailModal from "../../components/common/ScheduleEventDetailModal";
import WisRankingPanel from "../../components/common/WisRankingPanel";
import {
  calendarDateKey,
  getKoreanDateKey,
  getWeekStart,
} from "../../lib/calendarWeek";
import "./studentDashboard.css";

const StudentWeekSchedule = lazy(
  () => import("./components/StudentWeekSchedule"),
);
const NoticeBoard = lazy(() => import("./components/NoticeBoard"));

const DashboardCalendarFallback: React.FC = () => (
  <div className="student-dashboard-placeholder" role="status">
    학사 일정을 불러오는 중입니다.
  </div>
);

const StudentDashboard: React.FC = () => {
  const { user, userData, config, interfaceConfig } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getKoreanDateKey(),
  );
  const [weekStart, setWeekStart] = useState(() =>
    getWeekStart(getKoreanDateKey()),
  );
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [confirmedAttendance, setConfirmedAttendance] = useState({
    identity: "",
    date: "",
  });
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);
  const [hallOfFameRecognition, setHallOfFameRecognition] =
    useState<HallOfFameRecognition | null>(null);
  const { showToast } = useAppToast();

  const { year, semester } = getYearSemester(config);
  const { categories } = useScheduleCategories();
  const todayDate = getKoreanDateKey();
  const attendanceIdentity = `${user?.uid || ""}/${year}_${semester}`;
  const activeAttendanceIdentity = useRef(attendanceIdentity);
  activeAttendanceIdentity.current = attendanceIdentity;
  const {
    dates: attendanceDates,
    confirmedDates,
    error: attendanceHistoryError,
    retry: retryAttendanceHistory,
  } = useAttendanceDates(user?.uid, config ? { year, semester } : null);
  const attendanceChecked =
    confirmedDates.includes(todayDate) ||
    (confirmedAttendance.identity === attendanceIdentity &&
      confirmedAttendance.date === todayDate);
  const todayAttendanceSourceId = buildAttendanceSourceId();

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

  const visibleAttendanceDates = useMemo(() => {
    const set = new Set(attendanceDates);
    if (attendanceChecked) set.add(todayDate);
    return Array.from(set).sort();
  }, [attendanceChecked, attendanceDates, todayDate]);

  const attendanceGoalText = useMemo(() => {
    const todayKey = todayAttendanceSourceId.replace(/^attendance-/, "");
    const [yearValue, monthValue, dayValue] = todayKey
      .split("-")
      .map((value) => Number(value));
    if (!yearValue || !monthValue || !dayValue) return "";

    const monthPrefix = `${yearValue}-${String(monthValue).padStart(2, "0")}-`;
    const monthlyAttendance = new Set(
      visibleAttendanceDates.filter((date) => date.startsWith(monthPrefix)),
    );
    const toDateKey = (day: number) =>
      `${monthPrefix}${String(day).padStart(2, "0")}`;
    const missedPastDay = Array.from(
      { length: Math.max(dayValue - 1, 0) },
      (_, index) => index + 1,
    ).some((day) => !monthlyAttendance.has(toDateKey(day)));
    const daysInMonth = new Date(yearValue, monthValue, 0).getDate();
    const remainingDays = Array.from(
      { length: Math.max(daysInMonth - dayValue + 1, 0) },
      (_, index) => dayValue + index,
    ).filter((day) => !monthlyAttendance.has(toDateKey(day))).length;

    if (missedPastDay) return "이번 달 개근은 다음 달에 다시 도전";
    if (remainingDays <= 0) return "이번 달 개근 달성";
    return `개근까지 ${remainingDays}일`;
  }, [todayAttendanceSourceId, visibleAttendanceDates]);

  useEffect(() => {
    const { year: currentYear, semester: currentSemester } =
      getYearSemester(config);
    const path = `years/${currentYear}/semesters/${currentSemester}/calendar`;
    const userClassStr = getStudentClassKey(userData?.grade, userData?.class);
    let active = true;
    let snapshotVersion = 0;
    setEventsLoading(true);
    setEventsError(false);
    const unsubscribe = subscribeVisibleCalendarEvents(
      db,
      path,
      userClassStr,
      (loadedEvents) => {
        if (!active) return;
        const version = ++snapshotVersion;
        setEvents(loadedEvents);
        setEventsLoading(false);
        setEventsError(false);
        void getKoreanPublicHolidays(currentYear)
          .then((holidays) => {
            if (!active || version !== snapshotVersion) return;
            setEvents(
              mergeEventsWithKoreanPublicHolidays(loadedEvents, holidays),
            );
          })
          .catch((error) => {
            console.error("Failed to load Korean public holidays:", error);
            if (active && version === snapshotVersion) setEvents(loadedEvents);
          });
      },
      (error) => {
        console.error("Dashboard calendar fetch error:", error);
        if (active) {
          setEventsLoading(false);
          setEventsError(true);
        }
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [config?.year, config?.semester, userData?.class, userData?.grade]);

  useEffect(() => {
    setAttendanceMessage("");
  }, [attendanceIdentity]);

  useEffect(() => {
    if (!userData?.uid) {
      setHallOfFameRecognition(null);
      return;
    }

    let cancelled = false;
    const cancel = runWhenIdle(() => {
      void (async () => {
        try {
          const recognition = await loadHallOfFameRecognition(
            config,
            userData,
            interfaceConfig?.hallOfFame,
          );
          if (!recognition || cancelled) return;
          setHallOfFameRecognition(recognition);
        } catch (error) {
          if (!cancelled) {
            console.warn("Skipping hall of fame recognition modal:", error);
          }
        }
      })();
    }, 900);

    return () => {
      cancelled = true;
      cancel();
    };
  }, [config, interfaceConfig?.hallOfFame, userData]);

  const handleDateClick = (dateStr: string) => {
    setSelectedDate(dateStr);
  };

  const handleEventClick = (event: CalendarEvent) => {
    handleDateClick(calendarDateKey(event.start));
    setDetailEvent(event);
  };

  const handleSelectSearchResults = (dateStr: string) => {
    const date = calendarDateKey(dateStr);
    if (!date) return;
    setWeekStart(getWeekStart(date));
    handleDateClick(date);
  };

  const handleAttendanceCheck = async () => {
    if (!user?.uid || !config || attendanceLoading || attendanceChecked) return;
    const requestIdentity = attendanceIdentity;
    setAttendanceLoading(true);
    setAttendanceMessage("");
    try {
      const result = await checkStudentAttendance(year, semester);
      if (activeAttendanceIdentity.current !== requestIdentity) return;
      if (!result.attendanceRecorded || !result.attendanceDate) {
        throw new Error("Attendance was not confirmed by the server");
      }
      const recordedDate = result.attendanceDate;
      setConfirmedAttendance({ identity: requestIdentity, date: recordedDate });
      setWeekStart(getWeekStart(recordedDate));
      setSelectedDate(recordedDate);
      retryAttendanceHistory();
      notifyPointsUpdated();

      const rewardFeedback = buildPointRewardFeedback({
        actionLabel: "출석 체크",
        duplicateMessage: "오늘 출석은 이미 반영되었습니다.",
        result,
      });

      if (rewardFeedback) {
        setAttendanceMessage(
          rewardFeedback.tone === "warning"
            ? rewardFeedback.message
            : `${rewardFeedback.title}. ${rewardFeedback.message}`,
        );
        showToast(rewardFeedback);
      } else {
        setAttendanceMessage("출석 상태를 최신 정보로 반영했습니다.");
      }
    } catch (error) {
      if (activeAttendanceIdentity.current !== requestIdentity) return;
      console.error("Failed to check attendance:", error);
      const message = attendanceErrorMessage(error);
      setAttendanceMessage(message);
      showToast({
        tone: "error",
        title: "출석 체크에 실패했습니다.",
        message,
      });
    } finally {
      setAttendanceLoading(false);
    }
  };

  return (
    <div className="student-portal-dashboard">
      <h1 className="sr-only">학생 홈</h1>
      <div className="student-portal-dashboard__grid">
        <div className="student-portal-dashboard__notice">
          {secondaryPanelsReady ? (
            <Suspense
              fallback={
                <div className="student-dashboard-placeholder" role="status">
                  알림장을 불러오는 중입니다.
                </div>
              }
            >
              <NoticeBoard />
            </Suspense>
          ) : (
            <div className="student-dashboard-placeholder" role="status">
              알림장을 불러오는 중입니다.
            </div>
          )}
        </div>

        <div className="student-portal-dashboard__calendar">
          {attendanceHistoryError && (
            <div className="student-attendance-history-error" role="alert">
              출석 기록을 불러오지 못했습니다.
              <button type="button" onClick={retryAttendanceHistory}>
                다시 시도
              </button>
            </div>
          )}
          <Suspense fallback={<DashboardCalendarFallback />}>
            <StudentWeekSchedule
              categories={categories}
              events={events}
              onDateClick={handleDateClick}
              onEventClick={handleEventClick}
              weekStart={weekStart}
              loading={eventsLoading}
              error={eventsError}
              onWeekChange={setWeekStart}
              onSearchSelect={handleSelectSearchResults}
              onAttendanceCheck={() => void handleAttendanceCheck()}
              selectedDate={selectedDate}
              attendanceLoading={attendanceLoading}
              attendanceChecked={attendanceChecked}
              attendanceMessage={attendanceMessage}
              attendanceDates={visibleAttendanceDates}
              attendanceGoalText={attendanceGoalText}
            />
          </Suspense>
        </div>

        <div className="student-portal-dashboard__ranking">
          {secondaryPanelsReady ? (
            <WisRankingPanel
              config={config}
              hallOfFamePath="/student/points?tab=hall-of-fame"
            />
          ) : (
            <div className="student-dashboard-placeholder" role="status">
              위스 순위를 불러오는 중입니다.
            </div>
          )}
        </div>
      </div>

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
