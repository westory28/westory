import React, {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type FullCalendar from "@fullcalendar/react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { runAfterNextPaint, runWhenIdle } from "../../lib/browserTasks";
import { markLoginPerf, measureLoginPerf } from "../../lib/loginPerf";
import { notifyPointsUpdated } from "../../lib/appEvents";
import {
  buildAttendanceSourceId,
  buildPointRewardFeedback,
  claimPointActivityReward,
  getPointActivityTransaction,
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

const CalendarSection = lazy(() => import("./components/CalendarSection"));
const NoticeBoard = lazy(() => import("./components/NoticeBoard"));
const SearchModal = lazy(() => import("./components/SearchModal"));

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
  const { user, userData, config, interfaceConfig } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceChecked, setAttendanceChecked] = useState(false);
  const [attendanceMessage, setAttendanceMessage] = useState("");
  const [attendanceDates, setAttendanceDates] = useState<string[]>([]);
  const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);
  const [hallOfFameRecognition, setHallOfFameRecognition] =
    useState<HallOfFameRecognition | null>(null);
  const { showToast } = useAppToast();

  const calendarRef = useRef<FullCalendar>(null);
  const { year, semester } = getYearSemester(config);
  const { categories } = useScheduleCategories();
  const todayDate = new Date().toLocaleDateString("en-CA");
  const attendanceScope = `${year}_${semester}`;
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
    const unsubscribe = subscribeVisibleCalendarEvents(
      db,
      path,
      userClassStr,
      (loadedEvents) => {
        if (active) setEvents(loadedEvents);
        void getKoreanPublicHolidays(currentYear)
          .then((holidays) => {
            if (!active) return;
            setEvents(
              mergeEventsWithKoreanPublicHolidays(loadedEvents, holidays),
            );
          })
          .catch((error) => {
            console.error("Failed to load Korean public holidays:", error);
            if (active) setEvents(loadedEvents);
          });
      },
      (error) => console.error("Dashboard calendar fetch error:", error),
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [config?.year, config?.semester, userData?.class, userData?.grade]);

  useEffect(() => {
    if (!userData?.uid) return;
    const loadAttendanceStatus = async () => {
      try {
        const attendanceTx = await getPointActivityTransaction(
          config,
          userData.uid,
          "attendance",
          todayAttendanceSourceId,
        );
        if (attendanceTx) {
          setAttendanceChecked(true);
          setAttendanceMessage(
            `오늘 출석이 이미 반영되었습니다. +${attendanceTx.delta}위스`,
          );
        } else {
          setAttendanceChecked(false);
          setAttendanceMessage("");
        }
      } catch (error) {
        console.error("Failed to load attendance point status:", error);
      }
    };

    const cancel = runWhenIdle(() => {
      void loadAttendanceStatus();
    }, 700);

    return cancel;
  }, [config, todayAttendanceSourceId, userData?.uid]);

  useEffect(() => {
    if (!user) {
      setAttendanceDates([]);
      return;
    }

    const attendanceQuery = query(
      collection(db, "users", user.uid, "attendance"),
      where("scope", "==", attendanceScope),
    );

    const unsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
      const nextDates = snapshot.docs
        .map((item) => String(item.data().date || "").trim())
        .filter(Boolean)
        .sort();
      setAttendanceDates(nextDates);
    });

    return () => unsubscribe();
  }, [attendanceScope, user]);

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
    handleDateClick(event.start);
    setDetailEvent(event);
  };

  const handleSelectSearchResults = (dateStr: string) => {
    if (calendarRef.current) {
      calendarRef.current.getApi().gotoDate(dateStr);
      handleDateClick(dateStr);
    }
  };

  const handleAttendanceCheck = async () => {
    if (!userData?.uid || attendanceLoading || attendanceChecked) return;
    setAttendanceLoading(true);
    setAttendanceMessage("");
    try {
      const result = await claimPointActivityReward({
        config,
        activityType: "attendance",
        sourceId: todayAttendanceSourceId,
        sourceLabel: `${todayAttendanceSourceId.replace("attendance-", "")} 출석 체크`,
      });

      await setDoc(
        doc(
          db,
          "users",
          userData.uid,
          "attendance",
          `${attendanceScope}_${todayDate}`,
        ),
        {
          uid: userData.uid,
          scope: attendanceScope,
          year,
          semester,
          date: todayDate,
          checkedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setAttendanceChecked(true);
      setSelectedDate(todayDate);
      handleDateClick(todayDate);
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
      console.error("Failed to apply attendance point reward:", error);
      setAttendanceMessage("출석 체크 처리 중 오류가 발생했습니다.");
      showToast({
        tone: "error",
        title: "출석 체크에 실패했습니다.",
        message: "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setAttendanceLoading(false);
    }
  };

  return (
    <div className="dashboard-container student-dashboard-container mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-4 flex shrink-0 items-start justify-start">
        <div className="flex items-center gap-3">
          {config && (
            <h1 className="inline-flex shrink-0 rounded-full bg-blue-600 px-4 py-2 text-base font-bold text-white">
              {config.year}학년도 {config.semester}학기
            </h1>
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
              onAttendanceCheck={() => void handleAttendanceCheck()}
              calendarRef={calendarRef}
              selectedDate={selectedDate}
              attendanceLoading={attendanceLoading}
              attendanceChecked={attendanceChecked}
              attendanceMessage={attendanceMessage}
              attendanceDates={visibleAttendanceDates}
              attendanceGoalText={attendanceGoalText}
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
