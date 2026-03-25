import React from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import {
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
    resolvePointRankPolicy,
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
    const lastTier = tiers[tiers.length - 1];
    const nextThreshold = lastTier ? Math.max(0, Number(lastTier.minPoints || 0) + 50) : 0;
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

const PointRanksTab: React.FC<PointRanksTabProps> = ({ policy, canManage, onPolicyChange, onSubmit }) => {
    const resolvedRankPolicy = resolvePointRankPolicy(policy.rankPolicy);
    const validationError = getPointRankPolicyValidationError(policy.rankPolicy);
    const previewThemeId: PointRankThemeId = resolvedRankPolicy.activeThemeId === 'korean_golpum'
        ? 'world_nobility'
        : 'korean_golpum';

    const updateRankPolicy = (updater: (prev: PointRankPolicy) => PointRankPolicy) => {
        onPolicyChange((prev) => ({
            ...prev,
            rankPolicy: updater(resolvePointRankPolicy(prev.rankPolicy)),
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

    const addTier = () => {
        updateRankPolicy((prev) => ({
            ...prev,
            tiers: [...prev.tiers, makeTierDraft(prev.tiers)],
        }));
    };

    const removeTier = (tierCode: string) => {
        const tierIndex = resolvedRankPolicy.tiers.findIndex((tier) => tier.code === tierCode);
        if (tierIndex < 0 || resolvedRankPolicy.tiers.length <= 1) return;

        const removedTier = resolvedRankPolicy.tiers[tierIndex];
        const targetTier = resolvedRankPolicy.tiers[tierIndex - 1] || resolvedRankPolicy.tiers[tierIndex + 1] || null;
        const removedTierLabel = getPointRankDisplay({
            rankPolicy: resolvedRankPolicy,
            wallet: {
                earnedTotal: removedTier.minPoints,
                rankEarnedTotal: removedTier.minPoints,
            },
        })?.label || removedTier.code;
        const targetTierLabel = targetTier
            ? (getPointRankDisplay({
                rankPolicy: resolvedRankPolicy,
                wallet: {
                    earnedTotal: targetTier.minPoints,
                    rankEarnedTotal: targetTier.minPoints,
                },
            })?.label || targetTier.code)
            : '';

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
    };

    const addEmojiRegistryEntry = () => {
        updateRankPolicy((prev) => ({
            ...prev,
            emojiRegistry: [...prev.emojiRegistry, makeEmojiRegistryDraft(prev.emojiRegistry)],
        }));
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

    const activeThemeName = getPointRankThemeName(resolvedRankPolicy, resolvedRankPolicy.activeThemeId);
    const previewThemeName = getPointRankThemeName(resolvedRankPolicy, previewThemeId);
    const compareThemes: Array<{
        themeId: PointRankThemeId;
        label: string;
        name: string;
        tone: string;
    }> = [
        {
            themeId: resolvedRankPolicy.activeThemeId,
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
                            현재 활성 테마를 기준으로 등급, 이모지, 축하 효과를 편집합니다. 비교 카드는 한국사와 세계사 테마를 나란히 보여 줍니다.
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
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        저장은 기존 `onPolicyChange`와 `onSubmit` 흐름을 그대로 사용합니다.
                    </div>
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
                                value={resolvedRankPolicy.activeThemeId}
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
                                        {theme.themeId === resolvedRankPolicy.activeThemeId
                                            ? '이 카드의 설정이 저장 대상입니다.'
                                            : '현재 설정을 그대로 옮겨 본 미리보기입니다.'}
                                    </p>
                                </div>
                                <div className={`rounded-full border px-3 py-1 text-xs font-bold ${theme.tone}`}>
                                    {POINT_RANK_THEME_LABELS[theme.themeId]}
                                </div>
                            </div>

                            <div className="mt-4 space-y-3">
                                {resolvedRankPolicy.tiers.map((tier) => {
                                    const previewRank = getPointRankDisplay({
                                        rankPolicy: {
                                            ...resolvedRankPolicy,
                                            activeThemeId: theme.themeId,
                                            themeId: theme.themeId,
                                        },
                                        wallet: {
                                            earnedTotal: tier.minPoints,
                                            rankEarnedTotal: tier.minPoints,
                                        },
                                    });

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
            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900">등급 편집</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            기준 포인트, 이름, 약칭, 설명, 배지 스타일, 허용 이모지를 한 등급씩 수정합니다.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={addTier}
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

                <div className="space-y-4">
                    {resolvedRankPolicy.tiers.map((tier, tierIndex) => {
                        const tierPreview = getPointRankDisplay({
                            rankPolicy: resolvedRankPolicy,
                            wallet: {
                                earnedTotal: tier.minPoints,
                                rankEarnedTotal: tier.minPoints,
                            },
                        });
                        const canDelete = resolvedRankPolicy.tiers.length > 1;

                        return (
                            <article key={tier.code} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <PointRankBadge rank={tierPreview} size="sm" showTheme />
                                            <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{tier.code}</span>
                                        </div>
                                        <div className="mt-2 text-sm text-gray-600">현재 활성 테마 기준 {tier.minPoints}점 이상</div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => removeTier(tier.code)}
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
                                            value={resolvedRankPolicy.themes?.[resolvedRankPolicy.activeThemeId]?.tiers?.[tier.code]?.label || ''}
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
                                            value={resolvedRankPolicy.themes?.[resolvedRankPolicy.activeThemeId]?.tiers?.[tier.code]?.shortLabel || ''}
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
                                        value={resolvedRankPolicy.themes?.[resolvedRankPolicy.activeThemeId]?.tiers?.[tier.code]?.description || ''}
                                        onChange={(event) => setActiveThemeTierField(tier.code, 'description', event.target.value)}
                                        placeholder={tierPreview?.description || '등급 설명을 입력하세요.'}
                                        className={inputClassName}
                                        disabled={!canManage}
                                    />
                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierDescription}</div>
                                </label>

                                <div className="mt-5">
                                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                        <div>
                                            <div className="text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.allowedEmojiIds}</div>
                                            <p className="mt-1 text-xs leading-5 text-gray-500">
                                                이 등급에서 사용할 수 있는 이모지를 선택합니다. 비활성 이모지는 회색으로 표시됩니다.
                                            </p>
                                        </div>
                                        <div className="text-xs font-bold text-gray-500">{tier.allowedEmojiIds?.length || 0}개 선택됨</div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                                        {resolvedRankPolicy.emojiRegistry.map((entry) => {
                                            const checked = (tier.allowedEmojiIds || []).includes(entry.id);
                                            const disabled = !canManage || entry.enabled === false;

                                            return (
                                                <button
                                                    key={`${tier.code}-${entry.id}`}
                                                    type="button"
                                                    onClick={() => toggleTierEmoji(tier.code, entry.id)}
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
                                                    <div className="text-2xl leading-none">{entry.emoji}</div>
                                                    <div className="mt-2 text-sm font-bold">{entry.label}</div>
                                                    <div className="mt-1 text-[11px] text-gray-500">{entry.id}</div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-5 text-gray-500">
                                    {tierIndex === 0
                                        ? '첫 번째 등급에는 기본 이모지가 자동으로 묶입니다.'
                                        : '이 등급의 이모지 선택은 상위 등급과 중복되지 않도록 정리됩니다.'}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="text-base font-bold text-gray-900">이모지 레지스트리</h3>
                        <p className="mt-1 text-sm text-gray-500">
                            등급에서 사용할 이모지를 추가, 수정, 비활성화합니다. 비활성화는 소프트 삭제로 동작합니다.
                        </p>
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

                <div className="space-y-4">
                    {resolvedRankPolicy.emojiRegistry.map((entry) => (
                        <article
                            key={entry.id}
                            className={[
                                'rounded-2xl border p-4',
                                entry.enabled === false ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 bg-white',
                            ].join(' ')}
                        >
                            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                <div className="flex items-start gap-3">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50 text-2xl">{entry.emoji}</div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h4 className="text-base font-bold text-gray-900">{entry.label}</h4>
                                            {!entry.enabled && (
                                                <span className="rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">
                                                    비활성
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{entry.id}</div>
                                    </div>
                                </div>

                                <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
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

                            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                                <label className="block">
                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registryId}</div>
                                    <input
                                        value={entry.id}
                                        className={inputClassName}
                                        disabled
                                        readOnly
                                    />
                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registryId}</div>
                                </label>

                                <label className="block">
                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registryEmoji}</div>
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
                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registryEmoji}</div>
                                </label>

                                <label className="block">
                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registryLabel}</div>
                                    <input
                                        value={entry.label}
                                        onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                            ...current,
                                            label: event.target.value,
                                        }))}
                                        className={inputClassName}
                                        disabled={!canManage}
                                    />
                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registryLabel}</div>
                                </label>

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

                                <label className="block">
                                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.registryUnlockTierCode}</div>
                                    <select
                                        value={entry.unlockTierCode || ''}
                                        onChange={(event) => updateEmojiRegistryEntry(entry.id, (current) => ({
                                            ...current,
                                            unlockTierCode: normalizeText(event.target.value) || undefined,
                                        }))}
                                        className={selectClassName}
                                        disabled={!canManage}
                                    >
                                        <option value="">기본값</option>
                                        {resolvedRankPolicy.tiers.map((tier) => (
                                            <option key={tier.code} value={tier.code}>
                                                {getPointRankDisplay({
                                                    rankPolicy: resolvedRankPolicy,
                                                    wallet: {
                                                        earnedTotal: tier.minPoints,
                                                        rankEarnedTotal: tier.minPoints,
                                                    },
                                                })?.label || tier.code}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.registryUnlockTierCode}</div>
                                </label>
                            </div>
                        </article>
                    ))}
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
                        {resolvedRankPolicy.celebrationPolicy.enabled ? '축하 효과 활성화됨' : '축하 효과 비활성화됨'}
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
                            checked={resolvedRankPolicy.celebrationPolicy.enabled}
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
                            value={resolvedRankPolicy.celebrationPolicy.effectLevel}
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
