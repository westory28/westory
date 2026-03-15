import React, { useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { buildAttendanceSourceId, claimPointActivityReward, getPointActivityTransaction } from '../../lib/points';
import { getYearSemester } from '../../lib/semesterScope';
import { CalendarEvent } from '../../types';
import CalendarSection from './components/CalendarSection';
import EventDetailPanel from './components/EventDetailPanel';
import NoticeBoard from './components/NoticeBoard';
import SearchModal from './components/SearchModal';

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

const StudentDashboard: React.FC = () => {
    const { user, userData, config } = useAuth();
    const [events, setEvents] = useState<CalendarEvent[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [dailyEvents, setDailyEvents] = useState<CalendarEvent[]>([]);
    const [welcomeText, setWelcomeText] = useState('?숇뀈/諛??뺣낫瑜?遺덈윭?ㅻ뒗 以?..');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [gradeLabelMap, setGradeLabelMap] = useState<Record<string, string>>({});
    const [classLabelMap, setClassLabelMap] = useState<Record<string, string>>({});
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [attendanceChecked, setAttendanceChecked] = useState(false);
    const [attendanceMessage, setAttendanceMessage] = useState('');
    const [attendanceDates, setAttendanceDates] = useState<string[]>([]);

    const calendarRef = useRef<FullCalendar>(null);
    const { year, semester } = getYearSemester(config);
    const todayDate = new Date().toLocaleDateString('en-CA');
    const attendanceScope = `${year}_${semester}`;
    const todayAttendanceSourceId = buildAttendanceSourceId();

    const visibleAttendanceDates = useMemo(() => {
        const set = new Set(attendanceDates);
        if (attendanceChecked) set.add(todayDate);
        return Array.from(set).sort();
    }, [attendanceChecked, attendanceDates, todayDate]);

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const snap = await getDoc(doc(db, 'site_settings', 'school_config'));
                if (!snap.exists()) return;
                const data = snap.data() as {
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                };
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
        void loadSchoolConfig();
    }, []);

    useEffect(() => {
        if (!userData) return;
        const gradeValue = normalizeClassValue(userData.grade);
        const classValue = normalizeClassValue(userData.class);
        const gradeLabel = gradeLabelMap[gradeValue] || gradeValue;
        const classLabel = classLabelMap[classValue] || classValue;
        if (gradeLabel && classLabel) {
            setWelcomeText(`${withSuffix(gradeLabel, '?숇뀈')} ${withSuffix(classLabel, '諛?)}????쒕낫??);
        } else {
            setWelcomeText(`${(userData.name || '?숈깮').trim()}????쒕낫??);
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
                    setAttendanceMessage(`?ㅻ뒛 異쒖꽍???꾨즺?섏뿀?듬땲?? +${attendanceTx.delta}?ъ씤??);
                } else {
                    setAttendanceChecked(false);
                    setAttendanceMessage('');
                }
            } catch (error) {
                console.error('Failed to load attendance point status:', error);
            }
        };
        void loadAttendanceStatus();
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
                sourceLabel: `${todayAttendanceSourceId.replace('attendance-', '')} 異쒖꽍 泥댄겕`,
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

            if (result.awarded && result.amount > 0) {
                setAttendanceMessage(`異쒖꽍 泥댄겕媛 ?꾨즺?섏뿀?듬땲?? +${result.amount}?ъ씤??);
            } else {
                setAttendanceMessage('?ㅻ뒛 異쒖꽍? ?대? 諛섏쁺?섏뿀?듬땲??');
            }
        } catch (error) {
            console.error('Failed to apply attendance point reward:', error);
            setAttendanceMessage('異쒖꽍 泥댄겕 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.');
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
                            {config.year}?숇뀈??{config.semester}?숆린
                        </span>
                    )}
                </div>
            </div>

            <div className="flex h-auto min-h-[500px] flex-col gap-4 md:grid md:h-[calc(100vh-140px)] md:grid-cols-5 md:grid-rows-2">
                <div className="order-1 md:order-2 md:col-span-2 md:row-span-1">
                    <NoticeBoard />
                </div>

                <div className="order-2 md:order-1 md:col-span-3 md:row-span-2">
                    <CalendarSection
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
                </div>

                <div className="order-3 md:order-3 md:col-span-2 md:row-span-1">
                    <EventDetailPanel selectedDate={selectedDate} events={dailyEvents} />
                </div>
            </div>

            <SearchModal
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                onSelectEvent={handleSelectSearchResults}
            />
        </div>
    );
};

export default StudentDashboard;
