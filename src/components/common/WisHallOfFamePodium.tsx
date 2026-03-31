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
}

const SLOT_BY_RANK: Record<1 | 2 | 3, HallOfFamePodiumSlotKey> = {
    1: 'first',
    2: 'second',
    3: 'third',
};

const SLOT_ORDER: HallOfFamePodiumSlotKey[] = ['second', 'first', 'third'];

const getEntryTone = (rank: number) => {
    if (rank === 1) {
        return {
            rankClassName: 'border-amber-300/90 bg-amber-100/90 text-amber-900 shadow-[0_10px_25px_rgba(217,119,6,0.18)]',
            scoreClassName: 'border-amber-200/90 bg-white/88 text-amber-900',
            emojiClassName: 'text-[clamp(3.2rem,7vw,5rem)]',
            textClassName: 'text-gray-900',
        };
    }

    if (rank === 2) {
        return {
            rankClassName: 'border-slate-300/90 bg-slate-100/92 text-slate-800 shadow-[0_8px_20px_rgba(71,85,105,0.14)]',
            scoreClassName: 'border-slate-200/90 bg-white/88 text-slate-700',
            emojiClassName: 'text-[clamp(2.5rem,5vw,3.8rem)]',
            textClassName: 'text-gray-900',
        };
    }

    return {
        rankClassName: 'border-orange-300/90 bg-orange-100/92 text-orange-900 shadow-[0_8px_20px_rgba(194,120,3,0.14)]',
        scoreClassName: 'border-orange-200/90 bg-white/88 text-orange-800',
        emojiClassName: 'text-[clamp(2.5rem,5vw,3.8rem)]',
        textClassName: 'text-gray-900',
    };
};

const resolveSlotEntries = (entries: WisHallOfFameEntry[]) => {
    const slotEntries = new Map<HallOfFamePodiumSlotKey, WisHallOfFameEntry>();
    entries.forEach((entry) => {
        const slotKey = SLOT_BY_RANK[entry.rank];
        if (slotKey) {
            slotEntries.set(slotKey, entry);
        }
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

const WisHallOfFamePodium: React.FC<WisHallOfFamePodiumProps> = ({
    entries = [],
    hallOfFameConfig,
    imageUrl,
    emptyMessage = '아직 화랑의 전당이 준비되지 않았어요.',
    title = '화랑의 전당',
    subtitle = '',
    action = null,
}) => {
    const safeEntries = entries || [];
    const normalizedConfig = normalizeHallOfFameInterfaceConfig(hallOfFameConfig);
    const normalizedPositions = normalizedConfig.positions || getDefaultHallOfFamePositions();
    const resolvedImageUrl = (imageUrl || normalizedConfig.podiumImageUrl || '').trim()
        || DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;
    const slotEntries = resolveSlotEntries(safeEntries);

    return (
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-[linear-gradient(135deg,_#0f172a,_#1e293b)] px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="min-w-0">
                    <div className="text-[11px] font-black tracking-[0.12em] text-amber-200/90">화랑의 전당</div>
                    <h2 className="mt-2 text-xl font-black leading-tight text-white sm:text-2xl">{title}</h2>
                    {subtitle && (
                        <p className="mt-2 text-sm leading-6 text-slate-200">{subtitle}</p>
                    )}
                </div>
                {action && <div className="w-full sm:w-auto sm:shrink-0">{action}</div>}
            </div>
            <div className="relative aspect-[36/23] bg-[#f5f7fb]">
                <img
                    src={resolvedImageUrl}
                    alt="화랑의 전당 시상대"
                    className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-white/15 via-transparent to-slate-900/5" />

                {safeEntries.length === 0 && (
                    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-3xl border border-white/70 bg-white/84 px-6 py-5 text-center text-sm font-semibold text-slate-600 shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur">
                        {emptyMessage}
                    </div>
                )}

                {SLOT_ORDER.map((slotKey) => {
                    const entry = slotEntries.get(slotKey);
                    if (!entry) return null;
                    const tone = getEntryTone(entry.rank);
                    return (
                        <div
                            key={`${slotKey}-${entry.uid}`}
                            style={buildSlotStyle(slotKey, normalizedPositions)}
                            className="absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] w-[var(--slot-width-mobile)] -translate-x-1/2 md:left-[var(--slot-left)] md:top-[var(--slot-top)] md:w-[var(--slot-width)]"
                        >
                            <div className="mx-auto flex max-w-full flex-col items-center text-center">
                                <div
                                    className={`inline-flex min-h-9 items-center justify-center rounded-full border px-3 py-1 text-xs font-black tracking-[0.08em] sm:text-sm ${tone.rankClassName}`}
                                >
                                    {entry.rank}위
                                </div>
                                <div className={`mt-2 leading-none ${tone.emojiClassName}`}>
                                    {entry.profileIcon || '😀'}
                                </div>
                                <div
                                    className={`mt-2 whitespace-pre-line break-keep text-[12px] font-extrabold leading-[1.35] sm:text-sm md:text-base ${tone.textClassName}`}
                                >
                                    {`${entry.grade}학년 ${entry.class}반\n${entry.displayName}`}
                                </div>
                                <div
                                    className={`mt-2 inline-flex max-w-full rounded-full border px-3 py-1 text-[10px] font-bold sm:text-xs ${tone.scoreClassName}`}
                                >
                                    <span className="truncate">
                                        누적 {formatWisAmount(entry.cumulativeEarned)}
                                    </span>
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
