import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { runAfterNextPaint, runWhenIdle } from '../../lib/browserTasks';
import { markLoginPerf, measureLoginPerf } from '../../lib/loginPerf';
import { buildAttendanceSourceId, claimPointActivityReward, getPointActivityTransaction } from '../../lib/points';
import { useScheduleCategories } from '../../lib/scheduleCategories';
import { readSiteSettingDoc } from '../../lib/siteSettings';
import { getYearSemester } from '../../lib/semesterScope';
import { CalendarEvent } from '../../types';
import EventDetailPanel from './components/EventDetailPanel';

const CalendarSection = lazy(() => import('./components/CalendarSection'));
const NoticeBoard = lazy(() => import('./components/NoticeBoard'));
const SearchModal = lazy(() => import('./components/SearchModal'));

const normalizeClassValue = (value: unknown): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';
    const digits = normalized.match(/\d+/)?.[0] || '';
    if (!digits) return normalized;
    const parsed = Number(digits);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(parsed);
};

const withSuffix = (label: string, suffix: string) => {
    if (!label) return '';
    return label.endsWith(suffix) ? label : `${label}${suffix}`;
};

const DashboardCalendarFallback: React.FC = () => (
    <div className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-xl bg-white p-4 shadow-sm md:min-h-0">
        <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">
                <i className="far fa-calendar-alt mr-2 text-blue-600"></i>학사 일정
            </h2>
            <span className="text-xs font-semibold text-gray-400">초기 로드 최적화 중</span>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-blue-100 bg-blue-50/50 px-6 text-center text-sm font-medium text-blue-700">
            학사 일정을 먼저 준비하고 있습니다.
        </div>
    </div>
);

const StudentDashboard: React.FC = () => {
    const { user, userData, config } = useAuth();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);
    const [welcomeText, setWelcomeText] = useState('학생 정보를 불러오는 중');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>({});
    const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>({});
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [attendanceChecked, setAttendanceChecked] = useState(false);
    const [attendanceMessage, setAttendanceMessage] = useState('');
    const [attendanceDates, setAttendanceDates] = useState<string[]>([]);
    const [secondaryPanelsReady, setSecondaryPanelsReady] = useState(false);

    const calendarRef = useRef<FullCalendar>(null);
    const { year, semester } = getYearSemester(config);
    const { categories } = useScheduleCategories();
    const todayDate = new Date().toLocaleDateString('en-CA');
    const attendanceScope = `${year}_${semester}`;
    const todayAttendanceSourceId = buildAttendanceSourceId();

    useEffect(() => {
        markLoginPerf('westory-student-dashboard-rendered');
        measureLoginPerf(
            'westory-first-page-render',
            'westory-login-first-route-decided',
            'westory-student-dashboard-rendered',
        );

        const cancel = runAfterNextPaint(() => {
            setSecondaryPanelsReady(true);
            markLoginPerf('westory-student-dashboard-interactive');
            measureLoginPerf(
                'westory-total-to-interactive',
                'westory-app-load-start',
                'westory-student-dashboard-interactive',
            );
        });

        return cancel;
    }, []);

    const visibleAttendanceDates = useMemo(() => {
        const set = new Set(attendanceDates);
        if (attendanceChecked) set.add(todayDate);
        return Array.from(set).sort();
    }, [attendanceChecked, attendanceDates, todayDate]);

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const data = await readSiteSettingDoc<{
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                }>('school_config');
                if (!data) return;
                const nextGradeMap: Record<string, string> = {};
                const nextClassMap: Record<string, string> = {};
                (data.grades || []).forEach((g) => {
                    const value = String(g?.value ?? '').trim();
                    const label = String(g?.label ?? '').trim();
                    if (value && label) nextGradeMap[value] = label;
                });
                (data.classes || []).forEach((c) => {
                    const value = String(c?.value ?? '').trim();
                    const label = String(c?.label ?? '').trim();
                    if (value && label) nextClassMap[value] = label;
                });
                setGradeLabelMap(nextGradeMap);
                setClassLabelMap(nextClassMap);
            } catch (error) {
                console.error('Failed to load school labels:', error);
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
            setWelcomeText(`${withSuffix(gradeLabel, '학년')} ${withSuffix(classLabel, '반')}의 대시보드`);
        } else {
            setWelcomeText(`${(userData.name || '학생').trim()}의 대시보드`);
        }
    }, [userData, gradeLabelMap, classLabelMap]);

    useEffect(() => {
        const { year: currentYear, semester: currentSemester } = getYearSemester(config);
        const path = `years/${currentYear}/semesters/${currentSemester}/calendar`;
        const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
            const gradeLabel = normalizeClassValue(userData?.grade);
            const classLabel = normalizeClassValue(userData?.class);
            const userClassStr = gradeLabel && classLabel ? `${gradeLabel}-${classLabel}` : null;
            const loadedEvents: CalendarEvent[] = [];

            snapshot.forEach((entry) => {
                const data = entry.data();
                const isCommon = data.targetType === 'common';
                const isHoliday = data.eventType === 'holiday';
                const isMyClass = data.targetType === 'class' && data.targetClass === userClassStr;

                if (isCommon || isHoliday || isMyClass) {
                    loadedEvents.push({ id: entry.id, ...data } as CalendarEvent);
                }
            });
            setEvents(loadedEvents);
        });

        return () => unsubscribe();
    }, [config, userData]);

    useEffect(() => {
        if (!userData?.uid) return;
        const loadAttendanceStatus = async () => {
            try {
                const attendanceTx = await getPointActivityTransaction(config, userData.uid, 'attendance', todayAttendanceSourceId);
                if (attendanceTx) {
                    setAttendanceChecked(true);
                    setAttendanceMessage(`오늘 출석이 이미 반영되었습니다. +${attendanceTx.delta}위스`);
                } else {
                    setAttendanceChecked(false);
                    setAttendanceMessage('');
                }
            } catch (error) {
                console.error('Failed to load attendance point status:', error);
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
            collection(db, 'users', user.uid, 'attendance'),
            where('scope', '==', attendanceScope),
        );

        const unsubscribe = onSnapshot(attendanceQuery, (snapshot) => {
            const nextDates = snapshot.docs
                .map((item) => String(item.data().date || '').trim())
                .filter(Boolean)
                .sort();
            setAttendanceDates(nextDates);
        });

        return () => unsubscribe();
    }, [attendanceScope, user]);

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
        setAttendanceMessage('');
        try {
            const result = await claimPointActivityReward({
                config,
                activityType: 'attendance',
                sourceId: todayAttendanceSourceId,
                sourceLabel: `${todayAttendanceSourceId.replace('attendance-', '')} 출석 체크`,
            });

            await setDoc(
                doc(db, 'users', userData.uid, 'attendance', `${attendanceScope}_${todayDate}`),
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

            if (result.monthlyBonusAwarded && result.monthlyBonusAmount) {
                setAttendanceMessage(`출석 체크 완료. +${result.amount}위스, 월간 개근 보너스 +${result.monthlyBonusAmount}위스`);
            } else if (result.awarded && result.amount > 0) {
                setAttendanceMessage(`출석 체크가 완료되었습니다. +${result.amount}위스`);
            } else {
                setAttendanceMessage('오늘 출석은 이미 반영되었습니다.');
            }
        } catch (error) {
            console.error('Failed to apply attendance point reward:', error);
            setAttendanceMessage('출석 체크 처리 중 오류가 발생했습니다.');
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
                        <Suspense fallback={<div className="rounded-xl border border-yellow-200 bg-[#fffbeb] p-4 text-sm font-semibold text-amber-800/70">알림장을 준비 중입니다.</div>}>
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
                <Suspense fallback={<div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-20 text-sm font-semibold text-white">검색 도구를 준비 중입니다.</div>}>
                    <SearchModal
                        categories={categories}
                        isOpen={isSearchOpen}
                        onClose={() => setIsSearchOpen(false)}
                        onSelectEvent={handleSelectSearchResults}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default StudentDashboard;
