import React, { useMemo, useState } from 'react';
import WisHallOfFameLeaderboardList from '../../../../components/common/WisHallOfFameLeaderboardList';
import WisHallOfFamePodium from '../../../../components/common/WisHallOfFamePodium';
import { formatPointDateShortTime } from '../../../../lib/pointFormatters';
import {
    applyHallOfFameRankLimit,
    buildWisHallOfFameClassKey,
    getHallOfFameLeaderboardTailEntries,
    getWisHallOfFameClassEntries,
    getWisHallOfFameClassLeaderboardEntries,
    getWisHallOfFameGradeEntries,
    getWisHallOfFameGradeLeaderboardEntries,
    resolveHallOfFameInterfaceConfig,
} from '../../../../lib/wisHallOfFame';
import type {
    HallOfFameInterfaceConfig,
    WisHallOfFameSnapshot,
} from '../../../../types';

interface StudentPointHallOfFameTabProps {
    snapshot: WisHallOfFameSnapshot | null;
    hallOfFameConfig?: HallOfFameInterfaceConfig | null;
    currentGrade?: string;
    currentClass?: string;
}

type HallView = 'grade' | 'class';

const PRIMARY_GRADE_KEY = '3';

const normalizeNumberText = (value: unknown) => {
    const raw = String(value || '').trim();
    const digits = raw.match(/\d+/)?.[0] || '';
    if (!digits) return raw;
    const parsed = Number(digits);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const buildStatusText = (snapshot: WisHallOfFameSnapshot | null) => {
    if (!snapshot?.updatedAt) return '화랑의 전당을 준비 중이에요.';
    return `최근 반영 ${formatPointDateShortTime(snapshot.updatedAt)}`;
};

const StudentPointHallOfFameTab: React.FC<StudentPointHallOfFameTabProps> = ({
    snapshot,
    hallOfFameConfig,
    currentGrade,
    currentClass,
}) => {
    const [activeView, setActiveView] = useState<HallView>('grade');
    const resolvedConfig = resolveHallOfFameInterfaceConfig(hallOfFameConfig);
    const primaryGradeKey = snapshot?.primaryGradeKey || PRIMARY_GRADE_KEY;
    const normalizedGrade = normalizeNumberText(currentGrade);
    const normalizedClass = normalizeNumberText(currentClass);
    const classKey = buildWisHallOfFameClassKey(normalizedGrade, normalizedClass);
    const canOpenClassView = Boolean(classKey);

    const gradePodiumEntries = getWisHallOfFameGradeEntries(snapshot, primaryGradeKey);
    const classPodiumEntries = getWisHallOfFameClassEntries(snapshot, normalizedGrade, normalizedClass);
    const gradeLeaderboardEntries = getWisHallOfFameGradeLeaderboardEntries(snapshot, primaryGradeKey);
    const classLeaderboardEntries = getWisHallOfFameClassLeaderboardEntries(snapshot, normalizedGrade, normalizedClass);

    const activePodiumEntries = activeView === 'grade' ? gradePodiumEntries : classPodiumEntries;
    const activeLeaderboardEntries = activeView === 'grade' ? gradeLeaderboardEntries : classLeaderboardEntries;
    const classTitle = normalizedGrade && normalizedClass
        ? `${normalizedGrade}학년 ${normalizedClass}반 랭킹`
        : '우리 학급 랭킹';
    const viewTitle = activeView === 'grade' ? `${primaryGradeKey}학년 전교 랭킹` : classTitle;
    const viewScopeLabel = activeView === 'grade'
        ? `전교 ${resolvedConfig.publicRange.gradeRankLimit}위까지 공개`
        : `우리 학급 ${resolvedConfig.publicRange.classRankLimit}위까지 공개`;
    const showTieCaption = resolvedConfig.publicRange.includeTies;
    const appliedRankLimit = activeView === 'grade'
        ? resolvedConfig.publicRange.gradeRankLimit
        : resolvedConfig.publicRange.classRankLimit;
    const visibleLeaderboardEntries = applyHallOfFameRankLimit(
        activeLeaderboardEntries,
        appliedRankLimit,
        showTieCaption,
    );
    const rightRailEntries = getHallOfFameLeaderboardTailEntries(visibleLeaderboardEntries, 3);

    const emptyPodiumMessage = activeView === 'grade'
        ? (snapshot ? `${primaryGradeKey}학년 전교 랭킹을 집계 중이에요.` : '화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다.')
        : (snapshot ? '아직 우리 학급 랭킹이 없어요.' : '우리 학급 랭킹도 잠시 후 다시 표시됩니다.');

    const rightRailEmptyMessage = activeView === 'grade'
        ? '전교 추가 랭킹을 집계 중이에요.'
        : '우리 학급 추가 랭킹을 준비 중이에요.';

    const statusText = useMemo(() => buildStatusText(snapshot), [snapshot]);
    const desktopRail = resolvedConfig.leaderboardPanel.desktop;
    const desktopPodiumWidth = Math.min(78, Math.max(56, desktopRail.leftPercent || 71));
    const desktopRailWidth = Math.min(40, Math.max(22, desktopRail.widthPercent || 29));
    const desktopRailTop = `${Math.max(0, Number(desktopRail.topPercent || 0) / 10)}rem`;

    return (
        <div
            className="space-y-5"
            style={{
                ['--hall-podium-width' as string]: `${desktopPodiumWidth}%`,
                ['--hall-rail-width' as string]: `${desktopRailWidth}%`,
                ['--hall-rail-top' as string]: desktopRailTop,
            }}
        >
            {!snapshot && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-900">
                    화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다.
                </div>
            )}

            <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="min-w-0">
                        <div className="text-[11px] font-black tracking-[0.16em] text-amber-600">HALL OF FAME</div>
                        <h2 className="mt-2 text-xl font-black text-slate-900 sm:text-2xl">{viewTitle}</h2>
                        <p className="mt-2 text-sm text-slate-500">누적 획득 위스 기준으로 화랑의 전당이 반영돼요.</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                            <span className="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-white">
                                {viewScopeLabel}
                            </span>
                            {showTieCaption && (
                                <span className="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                                    동점자는 함께 공개
                                </span>
                            )}
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                                {statusText}
                            </span>
                        </div>
                    </div>

                    <div className="inline-flex w-full rounded-full bg-slate-100 p-1 sm:w-auto">
                        <button
                            type="button"
                            onClick={() => setActiveView('grade')}
                            className={`min-h-11 flex-1 rounded-full px-4 text-sm font-black transition sm:min-w-[132px] ${
                                activeView === 'grade'
                                    ? 'bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.16)]'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            전교 랭킹 보기
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveView('class')}
                            disabled={!canOpenClassView}
                            className={`min-h-11 flex-1 rounded-full px-4 text-sm font-black transition sm:min-w-[132px] ${
                                activeView === 'class'
                                    ? 'bg-white text-slate-900 shadow-[0_10px_20px_rgba(15,23,42,0.08)]'
                                    : canOpenClassView
                                        ? 'text-slate-600 hover:text-slate-900'
                                        : 'cursor-not-allowed text-slate-400'
                            }`}
                        >
                            우리 학급 보기
                        </button>
                    </div>
                </div>
            </div>

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="w-full xl:w-[var(--hall-podium-width)]">
                    <WisHallOfFamePodium
                        title={viewTitle}
                        subtitle={activeView === 'grade' ? '3학년 전교 시상대' : '우리 학급 시상대'}
                        entries={activePodiumEntries}
                        hallOfFameConfig={resolvedConfig}
                        emptyMessage={emptyPodiumMessage}
                        showHeader={false}
                    />
                </div>

                <div className="min-h-[280px] w-full xl:mt-[var(--hall-rail-top)] xl:w-[var(--hall-rail-width)] xl:max-h-[720px]">
                    <WisHallOfFameLeaderboardList
                        entries={rightRailEntries}
                        hallOfFameConfig={resolvedConfig}
                        title="4위부터 이어지는 랭킹"
                        subtitle={showTieCaption
                            ? '공개 범위를 넘기더라도 같은 순위의 친구들은 함께 보여요.'
                            : '공개 범위 안에서 순서대로 보여요.'}
                        emptyMessage={rightRailEmptyMessage}
                        className="h-full"
                    />
                </div>
            </div>
        </div>
    );
};

export default StudentPointHallOfFameTab;
