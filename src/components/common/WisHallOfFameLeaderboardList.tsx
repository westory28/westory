import React from 'react';
import { formatWisAmount } from '../../lib/pointFormatters';
import type { HallOfFameInterfaceConfig, WisHallOfFameEntry } from '../../types';

interface WisHallOfFameLeaderboardListProps {
    entries?: WisHallOfFameEntry[] | null;
    hallOfFameConfig?: HallOfFameInterfaceConfig | null;
    title?: string;
    subtitle?: string;
    emptyMessage?: string;
    className?: string;
    style?: React.CSSProperties;
}

const WisHallOfFameLeaderboardList: React.FC<WisHallOfFameLeaderboardListProps> = ({
    entries = [],
    hallOfFameConfig: _hallOfFameConfig = null,
    title = '4위부터 이어지는 랭킹',
    subtitle = '동점자는 같은 순위로 함께 표시돼요.',
    emptyMessage = '아직 공개된 추가 랭킹이 없어요.',
    className = '',
    style,
}) => {
    const safeEntries = entries || [];
    const hasTieForRank = (rank: number) => safeEntries.filter((entry) => entry.rank === rank).length > 1;

    return (
        <div
            className={`flex h-full min-h-[280px] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)] ${className}`}
            style={style}
        >
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-black text-slate-900">{title}</h3>
                        <p className="mt-1 break-keep text-sm text-slate-500">{subtitle}</p>
                    </div>
                    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
                        {safeEntries.length}명
                    </span>
                </div>
            </div>

            {safeEntries.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm font-semibold text-slate-500">
                    {emptyMessage}
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <div className="space-y-3">
                        {safeEntries.map((entry, index) => (
                            <div
                                key={`${entry.uid}-${entry.rank}-${index}`}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-[0_10px_24px_rgba(15,23,42,0.06)]"
                            >
                                <div className="flex items-start gap-3.5">
                                    <div className="inline-flex min-h-10 min-w-[4.5rem] items-center justify-center whitespace-nowrap rounded-2xl bg-slate-900 px-2.5 text-sm font-black text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
                                        {hasTieForRank(entry.rank) ? `공동 ${entry.rank}` : entry.rank}
                                    </div>
                                    <div className="flex min-w-0 flex-1 items-start gap-3">
                                        <div className="mt-0.5 text-2xl leading-none drop-shadow-[0_4px_8px_rgba(15,23,42,0.16)]">
                                            {entry.profileIcon || '😀'}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                <span className="inline-flex items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                                                    {entry.grade}학년 {entry.class}반
                                                </span>
                                                <span className="min-w-0 truncate text-sm font-black leading-5 text-slate-900">
                                                    {entry.displayName || entry.studentName}
                                                </span>
                                            </div>
                                            <div className="mt-2 inline-flex min-h-8 items-center whitespace-nowrap rounded-full border border-white/15 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.94))] px-3.5 py-1 text-sm font-black leading-none text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
                                                누적 {formatWisAmount(entry.cumulativeEarned)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WisHallOfFameLeaderboardList;
