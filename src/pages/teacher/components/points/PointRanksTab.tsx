import React, { useEffect, useState } from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import {
    getPointFeedbackToneClass,
    POINT_RANK_BADGE_STYLE_OPTIONS,
    POINT_RANK_CELEBRATION_EFFECT_LABELS,
    POINT_RANK_FIELD_HELPERS,
    POINT_RANK_FIELD_LABELS,
    POINT_RANK_THEME_DETAIL_LABELS,
    POINT_RANK_THEME_LABELS,
} from '../../../../constants/pointLabels';
import {
    createPointRankTierCode,
    getPointRankDisplay,
    getPointRankPolicyValidationError,
    getPointRankThemeName,
    resolvePointRankPolicyDraft,
} from '../../../../lib/pointRanks';
import type {
    PointPolicy,
    PointRankEmojiRegistryEntry,
    PointRankPolicy,
    PointRankPolicyTier,
    PointRankThemeId,
} from '../../../../types';

interface PointRanksTabProps {
    policy: PointPolicy;
    canManage: boolean;
    hasUnsavedChanges: boolean;
    saveFeedback: string;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: (event: React.FormEvent) => void;
}

const inputClassName = 'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm';
const selectClassName = 'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm bg-white';

const normalizeText = (value: unknown) => String(value || '').trim();

const clampNumber = (value: unknown, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

const makeTierDraft = (tiers: PointRankPolicyTier[]): PointRankPolicyTier => {
    const highestThreshold = tiers.reduce(
        (maxValue, tier) => Math.max(maxValue, Number(tier.minPoints || 0)),
        -50,
    );
    const nextThreshold = Math.max(0, highestThreshold + 50);
    const nextIndex = tiers.length + 1;

    return {
        code: createPointRankTierCode(tiers),
        minPoints: nextThreshold,
        badgeStyleToken: POINT_RANK_BADGE_STYLE_OPTIONS[(nextIndex - 1) % POINT_RANK_BADGE_STYLE_OPTIONS.length]?.value || 'stone',
        allowedEmojiIds: [],
    };
};

const makeEmojiRegistryDraft = (entries: PointRankEmojiRegistryEntry[]): PointRankEmojiRegistryEntry => {
    const nextIndex = entries.length + 1;
    const nextSortOrder = entries.reduce((maxValue, entry) => Math.max(maxValue, Number(entry.sortOrder || 0)), 0) + 10;
    const candidateId = `emoji_${nextIndex}`;
    const usedIds = new Set(entries.map((entry) => entry.id));
    let nextId = candidateId;
    let suffix = 2;

    while (usedIds.has(nextId)) {
        nextId = `${candidateId}_${suffix}`;
        suffix += 1;
    }

    return {
        id: nextId,
        emoji: '🙂',
        label: `새 이모지 ${nextIndex}`,
        category: '기본',
        sortOrder: nextSortOrder,
        enabled: true,
        unlockTierCode: entries[0]?.unlockTierCode || 'tier_1',
        legacyValues: [],
    };
};

const PointRanksTab: React.FC<PointRanksTabProps> = ({
    policy,
    canManage,
    hasUnsavedChanges,
    saveFeedback,
    onPolicyChange,
    onSubmit,
}) => {
    const draftRankPolicy = resolvePointRankPolicyDraft(policy.rankPolicy);
    const validationError = getPointRankPolicyValidationError(policy.rankPolicy);
    const previewThemeId: PointRankThemeId = draftRankPolicy.activeThemeId === 'korean_golpum'
        ? 'world_nobility'
        : 'korean_golpum';
    const [selectedTierCode, setSelectedTierCode] = useState<string | null>(null);
    const [expandedEmojiRegistryEntryId, setExpandedEmojiRegistryEntryId] = useState<string | null>(null);

    const updateRankPolicy = (updater: (prev: PointRankPolicy) => PointRankPolicy) => {
        onPolicyChange((prev) => ({
            ...prev,
            rankPolicy: updater(resolvePointRankPolicyDraft(prev.rankPolicy)),
        }));
    };

    const updateTier = (tierCode: string, updater: (tier: PointRankPolicyTier) => PointRankPolicyTier) => {
        updateRankPolicy((prev) => ({
            ...prev,
            tiers: prev.tiers.map((tier) => (tier.code === tierCode ? updater(tier) : tier)),
        }));
    };

    const setTierField = <K extends keyof PointRankPolicyTier>(tierCode: string, field: K, value: PointRankPolicyTier[K]) => {
        updateTier(tierCode, (tier) => ({
            ...tier,
            [field]: value,
        }));
    };

    const setActiveThemeTierField = (
        tierCode: string,
        field: 'label' | 'shortLabel' | 'description',
        value: string,
    ) => {
        updateRankPolicy((prev) => ({
            ...prev,
            themes: {
                ...(prev.themes || {}),
                [prev.activeThemeId]: {
                    ...(prev.themes?.[prev.activeThemeId] || {}),
                    tiers: {
                        ...(prev.themes?.[prev.activeThemeId]?.tiers || {}),
                        [tierCode]: {
                            ...(prev.themes?.[prev.activeThemeId]?.tiers?.[tierCode] || {}),
                            [field]: value,
                        },
                    },
                },
            },
        }));
    };

    const toggleTierEmoji = (tierCode: string, emojiId: string) => {
        updateRankPolicy((prev) => {
            const nextTiers = prev.tiers.map((tier) => ({
                ...tier,
                allowedEmojiIds: (tier.allowedEmojiIds || []).filter((item) => item !== emojiId),
            }));
            const targetTier = nextTiers.find((tier) => tier.code === tierCode);
            if (!targetTier) return prev;

            const wasChecked = (prev.tiers.find((tier) => tier.code === tierCode)?.allowedEmojiIds || []).includes(emojiId);
            if (!wasChecked) {
                targetTier.allowedEmojiIds = [...(targetTier.allowedEmojiIds || []), emojiId];
            }

            return {
                ...prev,
                tiers: nextTiers,
                emojiRegistry: prev.emojiRegistry.map((entry) => (
                    entry.id === emojiId && !wasChecked
                        ? { ...entry, unlockTierCode: tierCode }
                        : entry
                )),
            };
        });
    };

    const moveEmojiToTier = (emojiId: string, tierCode: string) => {
        updateRankPolicy((prev) => {
            const nextTiers = prev.tiers.map((tier) => ({
                ...tier,
                allowedEmojiIds: (tier.allowedEmojiIds || []).filter((item) => item !== emojiId),
            }));
            const targetTier = nextTiers.find((tier) => tier.code === tierCode);
            if (!targetTier) return prev;

            targetTier.allowedEmojiIds = [...(targetTier.allowedEmojiIds || []), emojiId];
            return {
                ...prev,
                tiers: nextTiers,
                emojiRegistry: prev.emojiRegistry.map((entry) => (
                    entry.id === emojiId
                        ? { ...entry, unlockTierCode: tierCode }
                        : entry
                )),
            };
        });
    };

    const setActiveThemeId = (themeId: PointRankThemeId) => {
        updateRankPolicy((prev) => ({
            ...prev,
            activeThemeId: themeId,
            themeId,
        }));
    };

    const addEmojiRegistryEntry = () => {
        const nextEntry = makeEmojiRegistryDraft(draftRankPolicy.emojiRegistry);
        updateRankPolicy((prev) => ({
            ...prev,
            emojiRegistry: [...prev.emojiRegistry, nextEntry],
        }));
        setExpandedEmojiRegistryEntryId(nextEntry.id);
    };

    const updateEmojiRegistryEntry = (
        entryId: string,
        updater: (entry: PointRankEmojiRegistryEntry) => PointRankEmojiRegistryEntry,
    ) => {
        updateRankPolicy((prev) => ({
            ...prev,
            emojiRegistry: prev.emojiRegistry.map((entry) => (entry.id === entryId ? updater(entry) : entry)),
        }));
    };

    useEffect(() => {
        if (!selectedTierCode) return;
        const exists = draftRankPolicy.tiers.some((tier) => tier.code === selectedTierCode);
        if (!exists) {
            setSelectedTierCode(null);
        }
    }, [draftRankPolicy.tiers, selectedTierCode]);

    useEffect(() => {
        if (!expandedEmojiRegistryEntryId) return;
        const exists = draftRankPolicy.emojiRegistry.some((entry) => entry.id === expandedEmojiRegistryEntryId);
        if (!exists) {
            setExpandedEmojiRegistryEntryId(null);
        }
    }, [draftRankPolicy.emojiRegistry, expandedEmojiRegistryEntryId]);

    const getTierPreview = (tier: PointRankPolicyTier, themeId: PointRankThemeId = draftRankPolicy.activeThemeId) => getPointRankDisplay({
        rankPolicy: {
            ...draftRankPolicy,
            activeThemeId: themeId,
            themeId,
        },
        wallet: {
            earnedTotal: tier.minPoints,
            rankEarnedTotal: tier.minPoints,
        },
    });

    const handleSelectTier = (tierCode: string) => {
        setSelectedTierCode((prev) => (prev === tierCode ? null : tierCode));
    };

    const handleAddTier = () => {
        const nextTier = makeTierDraft(draftRankPolicy.tiers);
        updateRankPolicy((prev) => ({
            ...prev,
            tiers: [...prev.tiers, nextTier],
        }));
        setSelectedTierCode(nextTier.code);
    };

    const handleRemoveTier = (tierCode: string) => {
        const tierIndex = draftRankPolicy.tiers.findIndex((tier) => tier.code === tierCode);
        if (tierIndex < 0 || draftRankPolicy.tiers.length <= 1) return;
        const removedTier = draftRankPolicy.tiers[tierIndex];
        const targetTier = draftRankPolicy.tiers[tierIndex - 1] || draftRankPolicy.tiers[tierIndex + 1] || null;
        const removedTierLabel = getTierPreview(removedTier)?.label || removedTier.code;
        const targetTierLabel = targetTier ? (getTierPreview(targetTier)?.label || targetTier.code) : '';

        const confirmed = window.confirm(
            targetTier
                ? `'${removedTierLabel}' 등급을 삭제할까요?\n연결된 허용 이모지와 테마 설정은 '${targetTierLabel}' 등급으로 옮겨집니다.`
                : `'${removedTierLabel}' 등급을 삭제할까요?`,
        );
        if (!confirmed) return;

        updateRankPolicy((prev) => {
            if (prev.tiers.length <= 1) return prev;
            const currentTierIndex = prev.tiers.findIndex((tier) => tier.code === tierCode);
            if (currentTierIndex < 0) return prev;
            const removedCurrentTier = prev.tiers[currentTierIndex];
            const targetCurrentTier = prev.tiers[currentTierIndex - 1] || prev.tiers[currentTierIndex + 1] || null;

            return {
                ...prev,
                tiers: prev.tiers
                    .filter((tier) => tier.code !== tierCode)
                    .map((tier) => {
                        if (!targetCurrentTier || tier.code !== targetCurrentTier.code) return tier;
                        return {
                            ...tier,
                            allowedEmojiIds: Array.from(new Set([
                                ...(tier.allowedEmojiIds || []),
                                ...(removedCurrentTier.allowedEmojiIds || []),
                            ])),
                        };
                    }),
                themes: Object.fromEntries(
                    Object.entries(prev.themes || {}).map(([themeId, themeConfig]) => [
                        themeId,
                        {
                            ...themeConfig,
                            tiers: Object.fromEntries(
                                Object.entries(themeConfig?.tiers || {}).filter(([code]) => code !== tierCode),
                            ),
                        },
                    ]),
                ),
            };
        });

        setSelectedTierCode((prev) => (prev === tierCode ? (targetTier?.code || null) : prev));
    };

    const activeThemeName = getPointRankThemeName(draftRankPolicy, draftRankPolicy.activeThemeId);
    const previewThemeName = getPointRankThemeName(draftRankPolicy, previewThemeId);
    const selectedTier = selectedTierCode
        ? draftRankPolicy.tiers.find((tier) => tier.code === selectedTierCode) || null
        : null;
    const selectedTierPreview = selectedTier ? getTierPreview(selectedTier) : null;
    const enabledEmojiCount = draftRankPolicy.emojiRegistry.filter((entry) => entry.enabled !== false).length;
    const compareThemes: Array<{
        themeId: PointRankThemeId;
        label: string;
        name: string;
        tone: string;
    }> = [
        {
            themeId: draftRankPolicy.activeThemeId,
            label: '현재 활성 테마',
            name: activeThemeName,
            tone: 'bg-blue-50 text-blue-700 border-blue-200',
        },
        {
            themeId: previewThemeId,
            label: '비교 미리보기 테마',
            name: previewThemeName,
            tone: 'bg-amber-50 text-amber-700 border-amber-200',
        },
    ];

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                    <div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {POINT_RANK_FIELD_LABELS.activeThemeId}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">등급 설정</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                            현재 활성 테마를 기준으로 등급, 이모지, 축하 효과를 편집합니다. 저장 전에는 실제 정책에 반영되지 않습니다.
                        </p>
                    </div>
                </div>
                <div className="flex flex-col gap-3 md:min-w-[280px] md:items-end">
                    <button
                        type="submit"
                        disabled={!canManage || Boolean(validationError)}
                        className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                        등급 설정 저장
                    </button>
                    <div className={[
                        'rounded-xl border px-4 py-3 text-sm',
                        hasUnsavedChanges
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-gray-200 bg-gray-50 text-gray-600',
                    ].join(' ')}>
                        {hasUnsavedChanges
                            ? '현재 화면은 draft입니다. 저장 전에는 실제 policy와 학생 반영값이 바뀌지 않습니다.'
                            : '저장된 등급 정책과 동일합니다.'}
                    </div>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                        변경사항은 저장 버튼을 눌러야 반영됩니다. 기준 포인트 순서는 저장 시점에 정리됩니다.
                    </div>
                    {saveFeedback && (
                        <div className={`rounded-xl px-4 py-3 text-sm ${getPointFeedbackToneClass(saveFeedback)}`}>
                            {saveFeedback}
                        </div>
                    )}
                </div>
            </div>

            <section className="space-y-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900">한국사 / 세계사 비교 카드</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            현재 선택한 활성 테마와 비교 미리보기를 분리해서 보여 줍니다.
                        </p>
                    </div>
                    <div className="grid gap-2 md:min-w-[320px] md:grid-cols-2">
                        <label className="block">
                            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">현재 활성 테마</div>
                            <select
                                value={draftRankPolicy.activeThemeId}
                                onChange={(event) => setActiveThemeId(event.target.value === 'world_nobility' ? 'world_nobility' : 'korean_golpum')}
                                className={selectClassName}
                                disabled={!canManage}
                            >
                                <option value="korean_golpum">{POINT_RANK_THEME_DETAIL_LABELS.korean_golpum}</option>
                                <option value="world_nobility">{POINT_RANK_THEME_DETAIL_LABELS.world_nobility}</option>
                            </select>
                        </label>
                        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                            <div className="text-xs font-bold uppercase tracking-wide text-gray-500">비교 미리보기</div>
                            <div className="mt-1 text-sm font-bold text-gray-800">{previewThemeName}</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {compareThemes.map((theme) => (
                        <div key={theme.themeId} className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{theme.label}</div>
                                    <h4 className="mt-1 text-lg font-bold text-gray-900">{theme.name}</h4>
                                    <p className="mt-1 text-sm text-gray-500">
                                        {theme.themeId === draftRankPolicy.activeThemeId
                                            ? '이 카드의 설정이 저장 대상입니다.'
                                            : '현재 설정을 그대로 옮겨 본 미리보기입니다.'}
                                    </p>
                                </div>
                                <div className={`rounded-full border px-3 py-1 text-xs font-bold ${theme.tone}`}>
                                    {POINT_RANK_THEME_LABELS[theme.themeId]}
                                </div>
                            </div>

                            <div className="mt-4 space-y-3">
                                {draftRankPolicy.tiers.map((tier) => {
                                    const previewRank = getTierPreview(tier, theme.themeId);

                                    return (
                                        <div key={`${theme.themeId}-${tier.code}`} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <PointRankBadge rank={previewRank} size="sm" showTheme />
                                                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{tier.code}</span>
                                            </div>
                                            <div className="mt-2 text-sm text-gray-600">기준 포인트 {tier.minPoints}점 이상</div>
                                            <div className="mt-1 text-xs leading-5 text-gray-500">{previewRank?.description || '등급 설명이 표시됩니다.'}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.9fr)]">
                <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                            <h3 className="text-base font-bold text-gray-900">등급 설정</h3>
                            <p className="mt-1 text-sm text-gray-500">
                                등급을 선택해 상세 설정을 수정하세요. 허용 이모지는 오른쪽 패널에서 따로 관리합니다.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleAddTier}
                            disabled={!canManage}
                            className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {POINT_RANK_FIELD_LABELS.addTier}
                        </button>
                    </div>

                    {validationError && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                            {validationError}
                        </div>
                    )}

                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        현재 보이는 등급 카드 순서는 draft 편집 순서입니다. 기준 포인트 정렬은 저장 시점에만 정리되며, 저장 전에는 학생 화면에 반영되지 않습니다.
                    </div>

                    <div className="space-y-3">
                        {draftRankPolicy.tiers.map((tier, tierIndex) => {
                            const tierPreview = getTierPreview(tier);
                            const isOpen = selectedTierCode === tier.code;
                            const canDelete = draftRankPolicy.tiers.length > 1;
                            const badgeStyleLabel = POINT_RANK_BADGE_STYLE_OPTIONS.find((option) => option.value === (tier.badgeStyleToken || 'stone'))?.label
                                || String(tier.badgeStyleToken || 'stone');

                            return (
                                <article
                                    key={tier.code}
                                    className={[
                                        'overflow-hidden rounded-2xl border transition',
                                        isOpen ? 'border-blue-200 bg-blue-50/40' : 'border-gray-200 bg-gray-50',
                                    ].join(' ')}
                                >
                                    <button
                                        type="button"
                                        onClick={() => handleSelectTier(tier.code)}
                                        aria-expanded={isOpen}
                                        aria-controls={`point-rank-tier-panel-${tier.code}`}
                                        className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-white/70"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0 space-y-3">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <PointRankBadge rank={tierPreview} size="sm" showTheme />
                                                    <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{tier.code}</span>
                                                    {isOpen && (
                                                        <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                                            편집 중
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-2 xl:grid-cols-4">
                                                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">등급명</div>
                                                        <div className="mt-1 font-bold text-gray-800">{tierPreview?.label || `등급 ${tierIndex + 1}`}</div>
                                                    </div>
                                                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">기준 포인트</div>
                                                        <div className="mt-1 font-bold text-gray-800">{tier.minPoints}점 이상</div>
                                                    </div>
                                                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">허용 이모지</div>
                                                        <div className="mt-1 font-bold text-gray-800">{tier.allowedEmojiIds?.length || 0}개 선택</div>
                                                    </div>
                                                    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                                                        <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">배지 스타일</div>
                                                        <div className="mt-1 font-bold text-gray-800">{badgeStyleLabel}</div>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                                                {isOpen ? '접기' : '열기'}
                                            </div>
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div
                                            id={`point-rank-tier-panel-${tier.code}`}
                                            className="border-t border-blue-100 bg-white px-4 py-4"
                                        >
                                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                                <div className="text-xs leading-5 text-gray-500">
                                                    왼쪽에서는 등급 정보만 수정하고, 허용 이모지는 오른쪽 패널에서 관리합니다.
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveTier(tier.code)}
                                                    disabled={!canManage || !canDelete}
                                                    className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                                >
                                                    {POINT_RANK_FIELD_LABELS.deleteTier}
                                                </button>
                                            </div>

                                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                <label className="block">
                                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierThreshold}</div>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={tier.minPoints}
                                                        onChange={(event) => setTierField(tier.code, 'minPoints', clampNumber(event.target.value, 0))}
                                                        className={inputClassName}
                                                        disabled={!canManage}
                                                    />
                                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierThreshold}</div>
                                                </label>

                                                <label className="block">
                                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.badgeStyleToken}</div>
                                                    <select
                                                        value={tier.badgeStyleToken || 'stone'}
                                                        onChange={(event) => setTierField(tier.code, 'badgeStyleToken', normalizeText(event.target.value) || 'stone')}
                                                        className={selectClassName}
                                                        disabled={!canManage}
                                                    >
                                                        {POINT_RANK_BADGE_STYLE_OPTIONS.map((option) => (
                                                            <option key={option.value} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.badgeStyleToken}</div>
                                                </label>

                                                <label className="block">
                                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierLabel}</div>
                                                    <input
                                                        value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.label || ''}
                                                        onChange={(event) => setActiveThemeTierField(tier.code, 'label', event.target.value)}
                                                        placeholder={tierPreview?.label || `등급 ${tierIndex + 1}`}
                                                        className={inputClassName}
                                                        disabled={!canManage}
                                                    />
                                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierLabel}</div>
                                                </label>

                                                <label className="block">
                                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierShortLabel}</div>
                                                    <input
                                                        value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.shortLabel || ''}
                                                        onChange={(event) => setActiveThemeTierField(tier.code, 'shortLabel', event.target.value)}
                                                        placeholder={tierPreview?.shortLabel || tierPreview?.label || `등급 ${tierIndex + 1}`}
                                                        className={inputClassName}
                                                        disabled={!canManage}
                                                    />
                                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierShortLabel}</div>
                                                </label>
                                            </div>

                                            <label className="mt-4 block">
                                                <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierDescription}</div>
                                                <textarea
                                                    rows={3}
                                                    value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.description || ''}
                                                    onChange={(event) => setActiveThemeTierField(tier.code, 'description', event.target.value)}
                                                    placeholder={tierPreview?.description || '등급 설명을 입력하세요.'}
                                                    className={inputClassName}
                                                    disabled={!canManage}
                                                />
                                                <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierDescription}</div>
                                            </label>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </div>

                <aside className="rounded-2xl border border-gray-200 bg-white p-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
                    <div className="space-y-2 border-b border-gray-200 pb-4">
                        <h3 className="text-base font-bold text-gray-900">이모지 선택</h3>
                        <p className="text-sm text-gray-500">
                            선택한 등급에서 사용할 수 있는 이모지를 지정하세요. 변경사항은 저장 버튼을 눌러야 반영됩니다.
                        </p>
                    </div>

                    {!selectedTier && (
                        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-sm leading-6 text-gray-500">
                            왼쪽에서 등급을 선택하면 허용 이모지를 편집할 수 있습니다.
                        </div>
                    )}

                    {selectedTier && (
                        <div className="space-y-4 pt-4">
                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <PointRankBadge rank={selectedTierPreview} size="sm" showTheme />
                                    <span className="text-xs font-bold uppercase tracking-wide text-blue-700">{selectedTier.code}</span>
                                </div>
                                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-blue-500">등급명</div>
                                        <div className="mt-1 font-bold text-gray-900">{selectedTierPreview?.label || selectedTier.code}</div>
                                        <div className="mt-1 text-xs text-gray-500">{selectedTierPreview?.shortLabel || '약칭 없음'}</div>
                                    </div>
                                    <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wide text-blue-500">기준 포인트</div>
                                        <div className="mt-1 font-bold text-gray-900">{selectedTier.minPoints}점 이상</div>
                                        <div className="mt-1 text-xs text-gray-500">{selectedTier.allowedEmojiIds?.length || 0}개 선택됨</div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">선택 수</div>
                                    <div className="mt-1 text-lg font-bold text-gray-900">{selectedTier.allowedEmojiIds?.length || 0}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">활성 이모지</div>
                                    <div className="mt-1 text-lg font-bold text-gray-900">{enabledEmojiCount}</div>
                                </div>
                                <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                                    <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">현재 테마</div>
                                    <div className="mt-1 text-sm font-bold text-gray-900">{POINT_RANK_THEME_LABELS[draftRankPolicy.activeThemeId]}</div>
                                </div>
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-500">
                                선택한 이모지는 현재 등급으로 이동합니다. 비활성 이모지는 회색으로 표시되며 선택할 수 없습니다.
                            </div>

                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2 2xl:grid-cols-3">
                                {draftRankPolicy.emojiRegistry.map((entry) => {
                                    const checked = (selectedTier.allowedEmojiIds || []).includes(entry.id);
                                    const disabled = !canManage || entry.enabled === false;
                                    const unlockTierCode = draftRankPolicy.tiers.find((tier) => (
                                        (tier.allowedEmojiIds || []).includes(entry.id)
                                    ))?.code || entry.unlockTierCode || draftRankPolicy.tiers[0]?.code || 'tier_1';
                                    const unlockTier = draftRankPolicy.tiers.find((tier) => tier.code === unlockTierCode) || null;
                                    const unlockLabel = unlockTier ? (getTierPreview(unlockTier)?.label || unlockTier.code) : '기본 등급';

                                    return (
                                        <button
                                            key={`${selectedTier.code}-${entry.id}`}
                                            type="button"
                                            onClick={() => toggleTierEmoji(selectedTier.code, entry.id)}
                                            disabled={disabled}
                                            className={[
                                                'rounded-xl border px-3 py-3 text-left transition',
                                                checked
                                                    ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                                                entry.enabled === false ? 'opacity-50' : '',
                                                disabled ? 'cursor-not-allowed' : '',
                                            ].filter(Boolean).join(' ')}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="text-2xl leading-none">{entry.emoji}</div>
                                                <span
                                                    className={[
                                                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                                                        checked ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500',
                                                    ].join(' ')}
                                                >
                                                    {checked ? '선택됨' : entry.enabled === false ? '비활성' : '선택 가능'}
                                                </span>
                                            </div>
                                            <div className="mt-2 text-sm font-bold">{entry.label}</div>
                                            <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-gray-500">
                                                {entry.category && (
                                                    <span className="rounded-full bg-gray-100 px-2 py-0.5">{entry.category}</span>
                                                )}
                                                <span>{checked ? '현재 등급' : `해제 ${unlockLabel}`}</span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-5 text-gray-500">
                                {draftRankPolicy.tiers[0]?.code === selectedTier.code
                                    ? '첫 번째 등급에는 기본 이모지가 자동으로 포함됩니다.'
                                    : '상위 등급과의 이모지 중복은 자동으로 정리됩니다.'}
                            </div>
                        </div>
                    )}
                </aside>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900">이모지 레지스트리</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            자주 바꾸는 정보만 먼저 보여줍니다. 상세 메타데이터는 카드별 고급 설정에서 확인할 수 있습니다.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
                            등록 {draftRankPolicy.emojiRegistry.length}개
                        </div>
                        <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                            활성 {enabledEmojiCount}개
                        </div>
                        <button
                            type="button"
                            onClick={addEmojiRegistryEntry}
                            disabled={!canManage}
                            className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            {POINT_RANK_FIELD_LABELS.addRegistryItem}
                        </button>
                    </div>
                </div>

                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                    이모지 추가와 수정은 draft로만 반영됩니다. 실제 해제 순서와 정렬값은 저장 시점에 최종 정리됩니다.
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {draftRankPolicy.emojiRegistry.map((entry) => {
                        const isAdvancedOpen = expandedEmojiRegistryEntryId === entry.id;
                        const assignedTier = draftRankPolicy.tiers.find((tier) => (
                            (tier.allowedEmojiIds || []).includes(entry.id)
                        )) || null;
                        const unlockTierCode = assignedTier?.code || entry.unlockTierCode || draftRankPolicy.tiers[0]?.code || 'tier_1';
                        const unlockTier = draftRankPolicy.tiers.find((tier) => tier.code === unlockTierCode) || null;
                        const unlockLabel = unlockTier ? (getTierPreview(unlockTier)?.label || unlockTier.code) : '기본 등급';

                        return (
                            <article
                                key={entry.id}
                                className={[
                                    'rounded-2xl border p-4 transition',
                                    entry.enabled === false ? 'border-gray-200 bg-gray-50 opacity-80' : 'border-gray-200 bg-white',
                                ].join(' ')}
                            >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="flex min-w-0 items-start gap-3">
                                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-2xl">
                                        {entry.emoji}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h4 className="text-base font-bold text-gray-900">{entry.label}</h4>
                                            <span className={[
                                                'rounded-full border px-2 py-0.5 text-[11px] font-bold',
                                                entry.enabled === false
                                                    ? 'border-gray-200 bg-gray-100 text-gray-500'
                                                    : 'border-emerald-200 bg-emerald-50 text-emerald-700',
                                            ].join(' ')}>
                                                {entry.enabled === false ? '비활성' : '활성'}
                                            </span>
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                            <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 font-bold text-blue-700">
                                                해제 {unlockLabel}
                                            </span>
                                            {entry.category && (
                                                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5">
                                                    {entry.category}
                                                </span>
                                            )}
                                            {assignedTier && (
                                                <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                                                    현재 배치 {assignedTier.code}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <label className="flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                                    <input
                                        type="checkbox"
                                        checked={entry.enabled !== false}
                                        onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                            ...current,
                                            enabled: event.target.checked,
                                        }))}
                                        disabled={!canManage}
                                        className="h-4 w-4"
                                    />
                                    {POINT_RANK_FIELD_LABELS.registryEnabled}
                                </label>
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[88px_minmax(0,1fr)]">
                                <label className="block">
                                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{POINT_RANK_FIELD_LABELS.registryEmoji}</div>
                                    <input
                                        value={entry.emoji}
                                        onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                            ...current,
                                            emoji: event.target.value,
                                            value: event.target.value,
                                            legacyValues: Array.from(new Set([
                                                ...(current.legacyValues || []),
                                                current.emoji && current.emoji !== event.target.value ? current.emoji : '',
                                            ].filter(Boolean))),
                                        }))}
                                        className={inputClassName}
                                        disabled={!canManage}
                                    />
                                </label>

                                <label className="block">
                                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{POINT_RANK_FIELD_LABELS.registryLabel}</div>
                                    <input
                                        value={entry.label}
                                        onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                            ...current,
                                            label: event.target.value,
                                        }))}
                                        className={inputClassName}
                                        disabled={!canManage}
                                    />
                                </label>
                            </div>

                            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                                <label className="block">
                                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">{POINT_RANK_FIELD_LABELS.registryUnlockTierCode}</div>
                                    <select
                                        value={unlockTierCode}
                                        onChange={(event) => moveEmojiToTier(entry.id, event.target.value)}
                                        className={selectClassName}
                                        disabled={!canManage}
                                    >
                                        {draftRankPolicy.tiers.map((tier) => (
                                            <option key={tier.code} value={tier.code}>
                                                {getTierPreview(tier)?.label || tier.code}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <button
                                    type="button"
                                    onClick={() => setExpandedEmojiRegistryEntryId((prev) => (prev === entry.id ? null : entry.id))}
                                    className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:bg-gray-100"
                                >
                                    {isAdvancedOpen ? '고급 설정 닫기' : '고급 설정'}
                                </button>
                            </div>

                            {isAdvancedOpen && (
                                <div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-200 pt-4 lg:grid-cols-2">
                                    <label className="block">
                                        <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registryCategory}</div>
                                        <input
                                            value={entry.category}
                                            onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                                ...current,
                                                category: event.target.value,
                                            }))}
                                            className={inputClassName}
                                            disabled={!canManage}
                                        />
                                        <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registryCategory}</div>
                                    </label>

                                    <label className="block">
                                        <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registrySortOrder}</div>
                                        <input
                                            type="number"
                                            value={entry.sortOrder}
                                            onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                                ...current,
                                                sortOrder: clampNumber(event.target.value, 0),
                                            }))}
                                            className={inputClassName}
                                            disabled={!canManage}
                                        />
                                        <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registrySortOrder}</div>
                                    </label>

                                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 lg:col-span-2">
                                        <div className="text-xs font-bold uppercase tracking-wide text-gray-500">{POINT_RANK_FIELD_LABELS.registryId}</div>
                                        <div className="mt-1 break-all font-mono text-sm text-gray-800">{entry.id}</div>
                                        <div className="mt-2 text-xs leading-5 text-gray-500">
                                            {POINT_RANK_FIELD_HELPERS.registryId}
                                        </div>
                                    </div>
                                </div>
                            )}
                            </article>
                        );
                    })}
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900">축하 정책</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            등급 상승 시의 축하 효과를 켜고 끌 수 있습니다. 강도는 표준 또는 절제형으로 나눕니다.
                        </p>
                    </div>
                    <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
                        {draftRankPolicy.celebrationPolicy.enabled ? '축하 효과 활성화됨' : '축하 효과 비활성화됨'}
                    </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
                    <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
                        <div className="pr-4">
                            <div className="font-bold text-gray-800">{POINT_RANK_FIELD_LABELS.celebrationEnabled}</div>
                            <div className="mt-1 text-sm text-gray-500">{POINT_RANK_FIELD_HELPERS.celebrationEnabled}</div>
                        </div>
                        <input
                            type="checkbox"
                            checked={draftRankPolicy.celebrationPolicy.enabled}
                            onChange={(event) => updateRankPolicy((prev) => ({
                                ...prev,
                                celebrationPolicy: {
                                    ...prev.celebrationPolicy,
                                    enabled: event.target.checked,
                                },
                            }))}
                            disabled={!canManage}
                            className="h-4 w-4"
                        />
                    </label>

                    <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.celebrationEffectLevel}</div>
                        <select
                            value={draftRankPolicy.celebrationPolicy.effectLevel}
                            onChange={(event) => updateRankPolicy((prev) => ({
                                ...prev,
                                celebrationPolicy: {
                                    ...prev.celebrationPolicy,
                                    effectLevel: event.target.value === 'subtle' ? 'subtle' : 'standard',
                                },
                            }))}
                            className={selectClassName}
                            disabled={!canManage}
                        >
                            <option value="subtle">{POINT_RANK_CELEBRATION_EFFECT_LABELS.subtle}</option>
                            <option value="standard">{POINT_RANK_CELEBRATION_EFFECT_LABELS.standard}</option>
                        </select>
                        <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.celebrationEffectLevel}</div>
                    </label>
                </div>
            </section>
        </form>
    );
};

export default PointRanksTab;
