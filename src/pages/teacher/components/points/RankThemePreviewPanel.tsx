import React, { useMemo } from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import {
    POINT_RANK_THEME_DETAIL_LABELS,
    POINT_RANK_THEME_LABELS,
} from '../../../../constants/pointLabels';
import { formatWisAmount } from '../../../../lib/pointFormatters';
import type { PointRankDisplay } from '../../../../lib/pointRanks';
import type {
    PointRankPolicy,
    PointRankPolicyTier,
    PointRankThemeId,
} from '../../../../types';

const selectClassName =
    'w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm';

interface RankThemePreviewPanelProps {
    canManage: boolean;
    draftRankPolicy: PointRankPolicy;
    activeThemeName: string;
    previewThemeId: PointRankThemeId;
    previewThemeName: string;
    enabledEmojiCount: number;
    hasUnsavedChanges: boolean;
    saveFeedbackMessage: string;
    saveFeedbackTone: 'success' | 'error' | 'warning' | null;
    onThemeChange: (themeId: PointRankThemeId) => void;
    onSave: () => void;
    getTierPreview: (
        tier: PointRankPolicyTier,
        themeId?: PointRankThemeId,
    ) => PointRankDisplay | null;
}

const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const RankThemePreviewPanel: React.FC<RankThemePreviewPanelProps> = ({
    canManage,
    draftRankPolicy,
    activeThemeName,
    previewThemeId,
    previewThemeName,
    enabledEmojiCount,
    hasUnsavedChanges,
    saveFeedbackMessage,
    saveFeedbackTone,
    onThemeChange,
    onSave,
    getTierPreview,
}) => {
    const displayTiers = useMemo(
        () => [...draftRankPolicy.tiers]
            .map((tier, index) => ({ tier, index }))
            .sort((left, right) => {
                const thresholdDiff = Number(right.tier.minPoints || 0) - Number(left.tier.minPoints || 0);
                return thresholdDiff !== 0 ? thresholdDiff : left.index - right.index;
            })
            .map(({ tier }) => tier),
        [draftRankPolicy.tiers],
    );

    const compareThemes: Array<{
        themeId: PointRankThemeId;
        label: string;
        name: string;
        chipTone: string;
        panelTone: string;
        helperText: string;
    }> = [
        {
            themeId: draftRankPolicy.activeThemeId,
            label: '현재 활성 테마',
            name: activeThemeName,
            chipTone: 'border-blue-200 bg-blue-50 text-blue-700',
            panelTone: 'rounded-[1.8rem] border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-5 shadow-[0_20px_40px_-32px_rgba(37,99,235,0.48)]',
            helperText: '저장 버튼을 누르면 학생 화면에 이 테마가 반영됩니다.',
        },
        {
            themeId: previewThemeId,
            label: '비교 미리보기',
            name: previewThemeName,
            chipTone: 'border-gray-200 bg-gray-100 text-gray-600',
            panelTone: 'rounded-[1.6rem] border border-gray-200 bg-gray-50/80 p-5',
            helperText: '등급 서열과 명칭 감각을 비교하기 위한 보조 미리보기입니다.',
        },
    ];

    return (
        <section className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">테마 미리보기</h2>
                        <p className="mt-1 text-sm text-gray-500">
                            높은 등급이 위, 낮은 등급이 아래로 보이도록 정렬해 학생이 체감하는 서열을 바로 비교합니다.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 xl:min-w-[300px] xl:items-end">
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={!canManage}
                            className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                        >
                            테마 설정 저장
                        </button>
                        <div
                            className={[
                                'rounded-xl border px-4 py-3 text-sm',
                                hasUnsavedChanges
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-gray-200 bg-gray-50 text-gray-600',
                            ].join(' ')}
                        >
                            {hasUnsavedChanges
                                ? '테마 변경사항이 저장 대기 중입니다.'
                                : '저장된 테마 설정과 같습니다.'}
                        </div>
                        {saveFeedbackMessage && saveFeedbackTone && (
                            <div
                                className={`rounded-xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}
                            >
                                {saveFeedbackMessage}
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_200px]">
                    <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                        <label className="block">
                            <div className="text-xs font-bold uppercase tracking-wide text-blue-700">
                                현재 활성 테마
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-blue-700 whitespace-nowrap">
                                    저장 대상
                                </span>
                                <span className="text-sm font-bold text-gray-800 whitespace-nowrap">
                                    {activeThemeName}
                                </span>
                            </div>
                            <select
                                value={draftRankPolicy.activeThemeId}
                                onChange={(event) =>
                                    onThemeChange(
                                        event.target.value === 'world_nobility'
                                            ? 'world_nobility'
                                            : 'korean_golpum',
                                    )
                                }
                                className={`${selectClassName} mt-3 border-blue-200`}
                                disabled={!canManage}
                            >
                                <option value="korean_golpum">
                                    {POINT_RANK_THEME_DETAIL_LABELS.korean_golpum}
                                </option>
                                <option value="world_nobility">
                                    {POINT_RANK_THEME_DETAIL_LABELS.world_nobility}
                                </option>
                            </select>
                        </label>
                    </div>
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                            미리보기 정보
                        </div>
                        <div className="mt-1 text-sm font-bold text-gray-700">
                            등급 {draftRankPolicy.tiers.length}개
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                            활성 이모지 {enabledEmojiCount}개
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.85fr)]">
                {compareThemes.map((theme) => (
                    <article key={theme.themeId} className={theme.panelTone}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
                                    {theme.label}
                                </div>
                                <h3 className="mt-1 text-xl font-extrabold text-gray-900 whitespace-nowrap">
                                    {theme.name}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-gray-600">
                                    {theme.helperText}
                                </p>
                            </div>
                            <span className={`inline-flex self-start whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${theme.chipTone}`}>
                                {POINT_RANK_THEME_LABELS[theme.themeId]}
                            </span>
                        </div>

                        <div className="mt-4 space-y-3">
                            {displayTiers.map((tier, tierIndex) => {
                                const previewRank = getTierPreview(tier, theme.themeId);
                                const isHighest = tierIndex === 0;

                                return (
                                    <div
                                        key={`${theme.themeId}-${tier.code}`}
                                        className={[
                                            'rounded-2xl border px-4 py-4',
                                            isHighest
                                                ? 'border-blue-100 bg-white shadow-sm'
                                                : 'border-gray-200 bg-white/85',
                                        ].join(' ')}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <PointRankBadge rank={previewRank} size="sm" showTheme />
                                            <span className={`inline-flex whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${
                                                isHighest
                                                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                                                    : 'border-gray-200 bg-gray-50 text-gray-600'
                                            }`}>
                                                {isHighest ? '최상위 등급' : '등급 미리보기'}
                                            </span>
                                        </div>
                                        <div className="mt-3 text-sm font-bold text-gray-900 whitespace-nowrap">
                                            기준 누적 위스 {formatWisAmount(tier.minPoints)}
                                        </div>
                                        <div className="mt-2 text-sm leading-6 text-gray-600">
                                            {previewRank?.description || '등급 설명이 표시됩니다.'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
};

export default RankThemePreviewPanel;
