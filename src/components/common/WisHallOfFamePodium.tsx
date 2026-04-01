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

type SlotLayoutMode = 'desktop' | 'mobile';

const SLOT_SAFE_AREA = {
    desktop: {
        centerRangePercentBySlot: {
            first: { min: 43, max: 57 },
            second: { min: 25, max: 36 },
            third: { min: 64, max: 75 },
        },
        topPercentRangeBySlot: {
            first: { min: 23, max: 41 },
            second: { min: 27, max: 45 },
            third: { min: 27, max: 45 },
        },
        widthPercentBySlot: {
            first: { min: 18.5, max: 20.5 },
            second: { min: 14.5, max: 16.25 },
            third: { min: 14.5, max: 16.25 },
        },
    },
    mobile: {
        centerRangePercentBySlot: {
            first: { min: 43, max: 57 },
            second: { min: 28, max: 39 },
            third: { min: 61, max: 72 },
        },
        topPercentRangeBySlot: {
            first: { min: 26, max: 44 },
            second: { min: 30, max: 48 },
            third: { min: 30, max: 48 },
        },
        widthPercentBySlot: {
            first: { min: 23.5, max: 26 },
            second: { min: 17.25, max: 19.25 },
            third: { min: 17.25, max: 19.25 },
        },
    },
} as const;

const getEntryTone = (slotKey: HallOfFamePodiumSlotKey) => {
    if (slotKey === 'first') {
        return {
            badgeClassName: 'border-amber-300/95 bg-white text-amber-950 shadow-[0_20px_38px_rgba(217,119,6,0.3)] ring-2 ring-amber-300/75',
            nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_20px_36px_rgba(15,23,42,0.3)] ring-1 ring-black/5',
            scoreClassName: 'border-white/30 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.96))] text-white shadow-[0_18px_34px_rgba(15,23,42,0.28)] ring-1 ring-white/15',
            emojiClassName: 'text-[clamp(3.25rem,6.6vw,4.8rem)]',
        };
    }

    if (slotKey === 'second') {
        return {
            badgeClassName: 'border-slate-200/95 bg-slate-50 text-slate-950 shadow-[0_16px_30px_rgba(71,85,105,0.24)] ring-1 ring-white/80',
            nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_18px_32px_rgba(15,23,42,0.28)] ring-1 ring-black/5',
            scoreClassName: 'border-white/25 bg-[linear-gradient(135deg,_rgba(15,23,42,0.94),_rgba(51,65,85,0.94))] text-white shadow-[0_16px_30px_rgba(15,23,42,0.26)] ring-1 ring-white/15',
            emojiClassName: 'text-[clamp(2.6rem,5.2vw,3.9rem)]',
        };
    }

    return {
        badgeClassName: 'border-orange-200/95 bg-orange-100 text-orange-950 shadow-[0_16px_30px_rgba(194,120,3,0.24)] ring-1 ring-white/80',
        nameClassName: 'border-white/80 bg-slate-950/82 text-white shadow-[0_18px_32px_rgba(15,23,42,0.28)] ring-1 ring-black/5',
        scoreClassName: 'border-white/30 bg-[linear-gradient(135deg,_rgba(30,41,59,0.94),_rgba(194,65,12,0.92))] text-white shadow-[0_16px_30px_rgba(15,23,42,0.24)] ring-1 ring-white/15',
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
    const resolveLayout = (mode: SlotLayoutMode) => {
        const rawSlot = positions[mode][slotKey];
        const guardrails = SLOT_SAFE_AREA[mode];
        const centerRange = guardrails.centerRangePercentBySlot[slotKey];
        const topRange = guardrails.topPercentRangeBySlot[slotKey];
        const widthBounds = guardrails.widthPercentBySlot[slotKey];
        const widthPercent = Math.min(widthBounds.max, Math.max(widthBounds.min, rawSlot.widthPercent));
        const leftPercent = Math.min(centerRange.max, Math.max(centerRange.min, rawSlot.leftPercent));
        const topPercent = Math.min(
            topRange.max,
            Math.max(topRange.min, rawSlot.topPercent),
        );

        return {
            leftPercent,
            topPercent,
            widthPercent,
        };
    };

    const desktop = resolveLayout('desktop');
    const mobile = resolveLayout('mobile');
    const cardMaxWidth = slotKey === 'first' ? '11.5rem' : '9.6rem';

    return {
        ['--slot-left' as string]: `${desktop.leftPercent}%`,
        ['--slot-top' as string]: `${desktop.topPercent}%`,
        ['--slot-width' as string]: `${desktop.widthPercent}%`,
        ['--slot-left-mobile' as string]: `${mobile.leftPercent}%`,
        ['--slot-top-mobile' as string]: `${mobile.topPercent}%`,
        ['--slot-width-mobile' as string]: `${mobile.widthPercent}%`,
        ['--slot-card-max-width' as string]: cardMaxWidth,
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
        ? 'absolute left-[var(--slot-left)] top-[var(--slot-top)] z-20 w-[var(--slot-width)] -translate-x-1/2 px-0.5'
        : deviceMode === 'mobile'
            ? 'absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] z-20 w-[var(--slot-width-mobile)] -translate-x-1/2 px-0'
            : 'absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] z-20 w-[var(--slot-width-mobile)] -translate-x-1/2 px-0 md:left-[var(--slot-left)] md:top-[var(--slot-top)] md:w-[var(--slot-width)] md:px-0.5';

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

            <div className="relative aspect-[80/50] min-h-[25rem] bg-[#f5f7fb] sm:min-h-[29rem] lg:min-h-[33rem] xl:min-h-[36rem]">
                <img
                    src={resolvedImageUrl}
                    alt="화랑의 전당 시상대"
                    className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/12 via-transparent to-slate-950/12" />

                <div className="relative z-10 h-full px-4 pt-5 pb-[7.5rem] sm:px-5 sm:pt-6 sm:pb-[8.5rem] lg:px-6 lg:pb-[9.5rem] xl:pb-[10.5rem]">
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
                                <div className="mx-auto flex w-full max-w-[var(--slot-card-max-width)] flex-col items-center gap-1 text-center sm:gap-1.5">
                                    <div
                                        className={`inline-flex min-h-9 max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black tracking-[0.08em] shadow-[0_14px_26px_rgba(15,23,42,0.16)] sm:min-h-10 sm:px-3 sm:py-1.25 sm:text-sm ${tone.badgeClassName}`}
                                    >
                                        {buildRankLabel(safeEntries, entry)}
                                    </div>

                                    <div className={`leading-none drop-shadow-[0_12px_18px_rgba(15,23,42,0.24)] ${tone.emojiClassName}`}>
                                        {entry.profileIcon || '🙂'}
                                    </div>

                                    <div className={`w-full max-w-full rounded-[1.3rem] border px-2.5 py-2 backdrop-blur-xl sm:px-3 sm:py-2.5 ${tone.nameClassName}`}>
                                        <div className="whitespace-nowrap text-[9px] font-bold uppercase tracking-[0.12em] text-white/78 sm:text-[10px]">
                                            {entry.grade}학년 {entry.class}반
                                        </div>
                                        <div className="mt-1 truncate whitespace-nowrap break-keep text-[11px] font-black leading-[1.3] text-white sm:text-sm md:text-[15px]">
                                            {entry.displayName || entry.studentName}
                                        </div>
                                    </div>

                                    <div
                                        className={`inline-flex min-h-[2.2rem] max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-black leading-none backdrop-blur shadow-[0_14px_30px_rgba(15,23,42,0.2)] sm:min-h-[2.4rem] sm:px-3 sm:py-1.25 sm:text-sm ${tone.scoreClassName}`}
                                    >
                                        누적 {formatWisAmount(entry.cumulativeEarned)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default WisHallOfFamePodium;
