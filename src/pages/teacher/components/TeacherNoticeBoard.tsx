import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../../lib/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import NoticeModal from './NoticeModal';
import { getYearSemester } from '../../../lib/semesterScope';

interface Notice {
    id: string;
    targetType: string;
    targetClass?: string;
    category: string;
    content: string;
    createdAt: any;
    targetDate?: string;
}

const TeacherNoticeBoard: React.FC = () => {
    const { config } = useAuth();
    const [notices, setNotices] = useState<Notice[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedNotice, setSelectedNotice] = useState<Notice | undefined>(undefined);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const mobileListRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const { year, semester } = getYearSemester(config);

        const path = `years/${year}/semesters/${semester}/notices`;
        const q = query(collection(db, path), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const loadedNotices: Notice[] = [];
            snapshot.forEach((doc) => {
                loadedNotices.push({ id: doc.id, ...doc.data() } as Notice);
            });
            setNotices(loadedNotices);
            setLoading(false);
        }, (error) => {
            console.error("Notice fetch error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [config]);

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
        let badge;
        switch (notice.category) {
            case 'normal': badge = <span className={`${baseClass} bg-red-500`}>📢 공지</span>; break;
            case 'exam': badge = <span className={`${baseClass} bg-blue-500`}>🔥 정기</span>; break;
            case 'performance': badge = <span className={`${baseClass} bg-green-500`}>⚡ 수행</span>; break;
            case 'prep': badge = <span className={`${baseClass} bg-yellow-500`}>🎒 준비</span>; break;
            case 'dday':
                let dDayStr = 'D-Day';
                if (notice.targetDate) {
                    const today = new Date(); today.setHours(0, 0, 0, 0);
                    const target = new Date(notice.targetDate); target.setHours(0, 0, 0, 0);
                    const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    dDayStr = diff > 0 ? `D-${diff}` : (diff === 0 ? 'D-Day' : `D+${Math.abs(diff)}`);
                }
                badge = <span className={`${baseClass} bg-purple-500`}>⏳ {dDayStr}</span>;
                break;
            default: badge = <span className={`${baseClass} bg-gray-500`}>📢 알림</span>;
        }
        return badge;
    };

    const handleCreate = () => {
        setSelectedNotice(undefined);
        setIsModalOpen(true);
    };

    const handleEdit = (notice: Notice) => {
        setSelectedNotice(notice);
        setIsModalOpen(true);
    };

    return (
        <div className="bg-[#fffbeb] rounded-xl shadow-sm border border-yellow-200 p-3 md:p-4 flex flex-col relative overflow-hidden min-h-[220px] md:min-h-0 h-full">
            <div className="flex justify-between items-center mb-2 border-b border-yellow-200 pb-2">
                <h3 className="text-lg font-extrabold text-amber-800 flex items-center">
                    <i className="fas fa-thumbtack mr-2 text-amber-600"></i>알림장
                </h3>
                <button
                    onClick={handleCreate}
                    className="text-amber-700 hover:text-amber-900 bg-yellow-200 hover:bg-yellow-300 px-2 py-1 rounded text-xs font-bold transition flex items-center"
                >
                    <i className="fas fa-plus mr-1"></i>쓰기
                </button>
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
                                    onClick={() => handleEdit(notice)}
                                    className="w-full shrink-0 snap-center rounded-lg border border-yellow-200 bg-white/90 p-3 shadow-sm cursor-pointer"
                                >
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            {getBadge(notice)}
                                            {notice.targetType === 'class' && (
                                                <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                                    {notice.targetClass}반
                                                </span>
                                            )}
                                        </div>
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
                                <article
                                    key={notice.id}
                                    onClick={() => handleEdit(notice)}
                                    className="bg-white/80 p-3 rounded-lg border border-yellow-200 shadow-sm relative cursor-pointer hover:bg-white transition"
                                >
                                    <div className="mb-2 flex justify-between items-center gap-2">
                                        <div className="flex min-w-0 items-center gap-2">
                                            {getBadge(notice)}
                                            {notice.targetType === 'class' && (
                                                <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                                                    {notice.targetClass}반
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[10px] text-amber-800/60 font-mono whitespace-nowrap">
                                            {notice.createdAt?.seconds ? new Date(notice.createdAt.seconds * 1000).toLocaleDateString() : ''}
                                        </span>
                                    </div>
                                    <div className="text-gray-800 text-sm font-bold leading-relaxed whitespace-pre-wrap">
                                        {notice.content}
                                    </div>
                                </article>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <NoticeModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                noticeData={selectedNotice}
                onSave={() => { /* Real-time updates handle list refresh */ }}
            />
        </div>
    );
};

export default TeacherNoticeBoard;
