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
import { readSiteSettingDoc } from "../../lib/siteSettings";
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
import EventDetailPanel from "./components/EventDetailPanel";

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
  const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);
  const [welcomeText, setWelcomeText] = useState("학생 정보를 불러오는 중");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>(
    {},
  );
  const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>(
    {},
  );
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
    const loadSchoolConfig = async () => {
      try {
        const data = await readSiteSettingDoc<{
          grades?: Array<{ value?: string; label?: string }>;
          classes?: Array<{ value?: string; label?: string }>;
        }>("school_config");
        if (!data) return;
        const nextGradeMap: Record<string, string> = {};
        const nextClassMap: Record<string, string> = {};
        (data.grades || []).forEach((g) => {
          const value = String(g?.value ?? "").trim();
          const label = String(g?.label ?? "").trim();
          if (value && label) nextGradeMap[value] = label;
        });
        (data.classes || []).forEach((c) => {
          const value = String(c?.value ?? "").trim();
          const label = String(c?.label ?? "").trim();
          if (value && label) nextClassMap[value] = label;
        });
        setGradeLabelMap(nextGradeMap);
        setClassLabelMap(nextClassMap);
      } catch (error) {
        console.error("Failed to load school labels:", error);
      }
    };

    const cancel = runWhenIdle(() => {
      void loadSchoolConfig();
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
  }, [userData, gradeLabelMap, classLabelMap]);

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
    const filtered = events.filter((event) => {
      const start = new Date(event.start);
      const end = new Date(event.end || event.start);
      const target = new Date(dateStr);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      target.setHours(0, 0, 0, 0);
      return target >= start && target <= end;
    });
    setDailyEvents(filtered);
  };

  const handleEventClick = (event: CalendarEvent) => {
    handleDateClick(event.start);
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
    <div className="dashboard-container mx-auto w-full max-w-7xl px-4 py-6">
      <div className="mb-6 flex shrink-0 flex-col items-center justify-between gap-3 md:flex-row">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 md:text-3xl">
            {welcomeText}
          </h1>
          {config && (
            <span className="shrink-0 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white shadow-md md:text-sm">
              {config.year}학년도 {config.semester}학기
            </span>
          )}
        </div>
      </div>

      <div className="flex h-auto min-h-[500px] flex-col gap-4 md:grid md:h-[calc(100vh-140px)] md:grid-cols-5 md:grid-rows-2">
        <div className="order-1 md:order-2 md:col-span-2 md:row-span-1">
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

        <div className="order-2 md:order-1 md:col-span-3 md:row-span-2">
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

        <div className="order-3 md:order-3 md:col-span-2 md:row-span-1">
          <EventDetailPanel
            categories={categories}
            selectedDate={selectedDate}
            events={dailyEvents}
          />
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
    </div>
  );
};

export default StudentDashboard;
