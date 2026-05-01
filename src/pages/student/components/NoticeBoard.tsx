import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { getYearSemester } from '../../../lib/semesterScope';
import {
    getStudentClassKey,
    subscribeVisibleNotices,
    type VisibleNotice,
} from '../../../lib/visibleSchedule';

type Notice = VisibleNotice;

const NoticeBoard: React.FC = () => {
    const { config, userData } = useAuth();
    const [notices, setNotices] = useState<Notice[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeIndex, setActiveIndex] = useState(0);
    const mobileListRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const { year, semester } = getYearSemester(config);

        const path = `years/${year}/semesters/${semester}/notices`;
        const userClassStr = getStudentClassKey(userData?.grade, userData?.class);
        const unsubscribe = subscribeVisibleNotices(db, path, userClassStr, (loadedNotices) => {
            setNotices(loadedNotices);
            setLoading(false);
        }, (error) => {
            console.error("Notice fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [config?.year, config?.semester, userData?.class, userData?.grade]);

    useEffect(() => {
        setActiveIndex(0);
    }, [notices.length]);

    const showMobileCarousel = useMemo(() => notices.length > 1, [notices.length]);

    const scrollToNotice = (index: number) => {
        const container = mobileListRef.current;
        if (!container) return;
        const target = container.children.item(index) as HTMLElement | null;
        if (!target) return;
        target.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
        setActiveIndex(index);
    };

    const handleMobileScroll = () => {
        const container = mobileListRef.current;
        if (!container || container.clientWidth <= 0) return;
        const nextIndex = Math.round(container.scrollLeft / container.clientWidth);
        if (nextIndex !== activeIndex) {
            setActiveIndex(Math.max(0, Math.min(notices.length - 1, nextIndex)));
        }
    };

    const getBadge = (notice: Notice) => {
        const baseClass = "px-2 py-0.5 rounded text-xs font-bold text-white mr-2";
        switch (notice.category) {
            case 'normal': return <span className={`${baseClass} bg-red-500`}>📢 공지</span>;
            case 'exam': return <span className={`${baseClass} bg-blue-500`}>🔥 정기</span>;
            case 'performance': return <span className={`${baseClass} bg-green-500`}>⚡ 수행</span>;
            case 'prep': return <span className={`${baseClass} bg-yellow-500`}>🎒 준비</span>;
            case 'dday':
                let dDayStr = 'D-Day';
                if (notice.targetDate) {
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const target = new Date(notice.targetDate); target.setHours(0, 0, 0, 0);
                    const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    dDayStr = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-Day' : `D+${Math.abs(diff)}`);
                }
                return <span className={`${baseClass} bg-purple-500`}>⏳ {dDayStr}</span>;
            default: return <span className={`${baseClass} bg-gray-500`}>📢 알림</span>;
        }
    };

    return (
        <div className="bg-[#fffbeb] rounded-xl shadow-sm border border-yellow-200 p-3 md:p-4 flex flex-col relative overflow-hidden min-h-[220px] md:min-h-0 h-full">
            <div className="flex justify-between items-center mb-2 border-b border-yellow-200 pb-2">
                <h3 className="text-lg font-extrabold text-amber-800 flex items-center">
                    <i className="fas fa-thumbtack mr-2 text-amber-600"></i>알림장
                </h3>
            </div>
            <div className="flex-1">
                {loading && <div className="text-center text-amber-800/50 py-10 font-bold text-sm">불러오는 중...</div>}

                {!loading && notices.length === 0 && (
                    <div className="text-center text-amber-800/50 py-10 font-bold text-sm">등록된 알림이 없습니다.</div>
                )}

                {!loading && notices.length > 0 && (
                    <>
                        <div
                            ref={mobileListRef}
                            onScroll={handleMobileScroll}
                            className={`-mx-3 flex gap-3 overflow-x-auto px-3 pb-1 md:hidden ${showMobileCarousel ? 'snap-x snap-mandatory touch-pan-x' : ''}`}
                        >
                            {notices.map((notice) => (
                                <article
                                    key={`${notice.id}-mobile`}
                                    className="w-full shrink-0 snap-center rounded-lg border border-yellow-200 bg-white/90 p-3 shadow-sm"
                                >
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        {getBadge(notice)}
                                        <span className="text-[10px] text-amber-800/60 font-mono whitespace-nowrap">
                                            {notice.createdAt?.seconds ? new Date(notice.createdAt.seconds * 1000).toLocaleDateString() : ''}
                                        </span>
                                    </div>
                                    <div className="text-sm font-bold leading-6 text-gray-800 whitespace-pre-wrap break-keep">
                                        {notice.content}
                                    </div>
                                </article>
                            ))}
                        </div>

                        {showMobileCarousel && (
                            <div className="mt-2 flex items-center justify-center gap-2 md:hidden">
                                {notices.map((notice, index) => (
                                    <button
                                        key={`${notice.id}-dot`}
                                        type="button"
                                        onClick={() => scrollToNotice(index)}
                                        className={`h-2.5 rounded-full transition ${activeIndex === index ? 'w-6 bg-amber-500' : 'w-2.5 bg-amber-200'}`}
                                        aria-label={`${index + 1}번째 공지 보기`}
                                    />
                                ))}
                            </div>
                        )}

                        <div className="hidden h-full overflow-y-auto space-y-2 pr-1 md:block custom-scroll scrollbar-thin scrollbar-thumb-amber-200 scrollbar-track-transparent">
                            {notices.map((notice) => (
                                <article key={notice.id} className="rounded-lg border border-yellow-200 bg-white/80 p-3 shadow-sm">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        {getBadge(notice)}
                                        <span className="text-[10px] text-amber-800/60 font-mono whitespace-nowrap">
                                            {notice.createdAt?.seconds ? new Date(notice.createdAt.seconds * 1000).toLocaleDateString() : ''}
                                        </span>
                                    </div>
                                    <div className="text-sm font-bold leading-relaxed text-gray-800 whitespace-pre-wrap">
                                        {notice.content}
                                    </div>
                                </article>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default NoticeBoard;
