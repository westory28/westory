import React from 'react';
import { formatWisAmount } from '../../lib/pointFormatters';
import {
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
    getDefaultHallOfFamePositions,
    normalizeHallOfFameInterfaceConfig,
} from '../../lib/wisHallOfFame';
import type {
    HallOfFameInterfaceConfig,
    HallOfFamePodiumPositions,
    HallOfFamePodiumSlotKey,
    WisHallOfFameEntry,
} from '../../types';

interface WisHallOfFamePodiumProps {
    entries?: WisHallOfFameEntry[] | null;
    hallOfFameConfig?: HallOfFameInterfaceConfig | null;
    imageUrl?: string;
    emptyMessage?: string;
    title?: string;
    subtitle?: string;
    action?: React.ReactNode;
    showHeader?: boolean;
    deviceMode?: 'responsive' | 'desktop' | 'mobile';
}

const SLOT_ORDER: HallOfFamePodiumSlotKey[] = ['second', 'first', 'third'];

const getEntryTone = (slotKey: HallOfFamePodiumSlotKey) => {
    if (slotKey === 'first') {
        return {
            badgeClassName: 'border-amber-300/90 bg-amber-100/92 text-amber-950 shadow-[0_12px_26px_rgba(217,119,6,0.22)]',
            nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_20px_36px_rgba(15,23,42,0.3)] ring-1 ring-black/5',
            scoreClassName: 'border-white/90 bg-white/96 text-slate-900 shadow-[0_14px_28px_rgba(15,23,42,0.22)] ring-1 ring-slate-900/6',
            emojiClassName: 'text-[clamp(3.25rem,6.6vw,4.8rem)]',
        };
    }

    if (slotKey === 'second') {
        return {
            badgeClassName: 'border-slate-300/90 bg-slate-100/92 text-slate-900 shadow-[0_10px_22px_rgba(71,85,105,0.18)]',
            nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_18px_32px_rgba(15,23,42,0.28)] ring-1 ring-black/5',
            scoreClassName: 'border-white/90 bg-white/96 text-slate-900 shadow-[0_14px_28px_rgba(15,23,42,0.2)] ring-1 ring-slate-900/6',
            emojiClassName: 'text-[clamp(2.6rem,5.2vw,3.9rem)]',
        };
    }

    return {
        badgeClassName: 'border-orange-300/90 bg-orange-100/92 text-orange-950 shadow-[0_10px_22px_rgba(194,120,3,0.18)]',
        nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_18px_32px_rgba(15,23,42,0.28)] ring-1 ring-black/5',
        scoreClassName: 'border-white/90 bg-white/96 text-slate-900 shadow-[0_14px_28px_rgba(15,23,42,0.2)] ring-1 ring-slate-900/6',
        emojiClassName: 'text-[clamp(2.6rem,5.2vw,3.9rem)]',
    };
};

const resolveSlotEntries = (entries: WisHallOfFameEntry[]) => {
    const slotEntries = new Map<HallOfFamePodiumSlotKey, WisHallOfFameEntry>();
    entries.forEach((entry) => {
        const podiumSlot = entry.podiumSlot || entry.rank;
        if (podiumSlot === 1) slotEntries.set('first', entry);
        if (podiumSlot === 2) slotEntries.set('second', entry);
        if (podiumSlot === 3) slotEntries.set('third', entry);
    });
    return slotEntries;
};

const buildSlotStyle = (
    slotKey: HallOfFamePodiumSlotKey,
    positions: { desktop: HallOfFamePodiumPositions; mobile: HallOfFamePodiumPositions },
) => {
    const desktop = positions.desktop[slotKey];
    const mobile = positions.mobile[slotKey];

    return {
        ['--slot-left' as string]: `${desktop.leftPercent}%`,
        ['--slot-top' as string]: `${desktop.topPercent}%`,
        ['--slot-width' as string]: `${desktop.widthPercent}%`,
        ['--slot-left-mobile' as string]: `${mobile.leftPercent}%`,
        ['--slot-top-mobile' as string]: `${mobile.topPercent}%`,
        ['--slot-width-mobile' as string]: `${mobile.widthPercent}%`,
    } as React.CSSProperties;
};

const buildRankLabel = (entries: WisHallOfFameEntry[], entry: WisHallOfFameEntry) => {
    const tiedCount = entries.filter((candidate) => candidate.rank === entry.rank).length;
    return `${tiedCount > 1 ? '공동 ' : ''}${entry.rank}위`;
};

const WisHallOfFamePodium: React.FC<WisHallOfFamePodiumProps> = ({
    entries = [],
    hallOfFameConfig,
    imageUrl,
    emptyMessage = '아직 화랑의 전당이 준비되지 않았어요.',
    title = '화랑의 전당',
    subtitle = '',
    action = null,
    showHeader = true,
    deviceMode = 'responsive',
}) => {
    const safeEntries = entries || [];
    const normalizedConfig = normalizeHallOfFameInterfaceConfig(hallOfFameConfig);
    const resolvedImageUrl = (imageUrl || normalizedConfig.podiumImageUrl || '').trim()
        || DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;
    const normalizedPositions = normalizedConfig.positions || getDefaultHallOfFamePositions();
    const slotEntries = resolveSlotEntries(safeEntries);

    const slotPositionClassName = deviceMode === 'desktop'
        ? 'absolute left-[var(--slot-left)] top-[var(--slot-top)] z-10 w-[var(--slot-width)] -translate-x-1/2 px-1.5'
        : deviceMode === 'mobile'
            ? 'absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] z-10 w-[var(--slot-width-mobile)] -translate-x-1/2 px-1'
            : 'absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] z-10 w-[var(--slot-width-mobile)] -translate-x-1/2 px-1 md:left-[var(--slot-left)] md:top-[var(--slot-top)] md:w-[var(--slot-width)] md:px-1.5';

    return (
        <div className="overflow-hidden rounded-[1.85rem] border border-slate-200 bg-white shadow-[0_22px_54px_rgba(15,23,42,0.08)]">
            {showHeader && (
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-[linear-gradient(135deg,_#0f172a,_#1f2d45)] px-5 py-5 text-white sm:flex-row sm:items-end sm:justify-between sm:px-6">
                    <div className="min-w-0">
                        <div className="text-[11px] font-black tracking-[0.16em] text-amber-200/90">HALL OF FAME</div>
                        <h2 className="mt-2 text-xl font-black leading-tight text-white sm:text-[1.7rem]">{title}</h2>
                        {subtitle && (
                            <p className="mt-2 text-sm leading-6 text-slate-200">{subtitle}</p>
                        )}
                    </div>
                    {action && <div className="w-full sm:w-auto sm:shrink-0">{action}</div>}
                </div>
            )}

            <div className="relative aspect-[36/23] bg-[#f5f7fb]">
                <img
                    src={resolvedImageUrl}
                    alt="화랑의 전당 시상대"
                    className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/12 via-transparent to-slate-950/12" />

                {safeEntries.length === 0 && (
                    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-3xl border border-white/70 bg-white/88 px-6 py-5 text-center text-sm font-semibold text-slate-600 shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur">
                        {emptyMessage}
                    </div>
                )}

                {SLOT_ORDER.map((slotKey) => {
                    const entry = slotEntries.get(slotKey);
                    if (!entry) return null;

                    const tone = getEntryTone(slotKey);
                    return (
                        <div
                            key={`${slotKey}-${entry.uid}`}
                            style={buildSlotStyle(slotKey, normalizedPositions)}
                            className={slotPositionClassName}
                        >
                            <div className="mx-auto flex max-w-full flex-col items-center gap-2.5 text-center">
                                <div
                                    className={`inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-black tracking-[0.08em] shadow-[0_10px_20px_rgba(15,23,42,0.14)] sm:text-sm ${tone.badgeClassName}`}
                                >
                                    {buildRankLabel(safeEntries, entry)}
                                </div>

                                <div className={`leading-none drop-shadow-[0_12px_18px_rgba(15,23,42,0.24)] ${tone.emojiClassName}`}>
                                    {entry.profileIcon || '😀'}
                                </div>

                                <div className={`w-fit max-w-full min-w-0 rounded-[1.35rem] border px-3.5 py-2.5 backdrop-blur-xl ${tone.nameClassName}`}>
                                    <div className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.12em] text-white/78">
                                        {entry.grade}학년 {entry.class}반
                                    </div>
                                    <div className="mt-1 whitespace-pre-line break-keep text-[12px] font-black leading-[1.35] text-white sm:text-sm md:text-base">
                                        {entry.displayName || entry.studentName}
                                    </div>
                                </div>

                                <div
                                    className={`inline-flex min-h-[2.25rem] min-w-[6.15rem] shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-4 py-1.5 text-[11px] font-black leading-none backdrop-blur shadow-[0_12px_26px_rgba(15,23,42,0.16)] sm:min-h-[2.4rem] sm:min-w-[6.85rem] sm:px-5 sm:text-sm ${tone.scoreClassName}`}
                                >
                                    누적 {formatWisAmount(entry.cumulativeEarned)}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default WisHallOfFamePodium;
