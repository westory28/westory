import React, { useEffect, useState } from 'react';
import StudentRankPromotionPopup from '../../../../components/common/StudentRankPromotionPopup';
import { POINT_RANK_BADGE_STYLE_OPTIONS, POINT_RANK_FIELD_LABELS } from '../../../../constants/pointLabels';
import { buildStudentRankPromotionPreview } from '../../../../lib/pointRankPromotion';
import {
    createPointRankTierCode,
    getPointRankDisplay,
    getPointRankPolicyValidationError,
    getPointRankThemeName,
    resolvePointRankPolicyDraft,
} from '../../../../lib/pointRanks';
import { findDuplicateProfileEmojiEntry, normalizeProfileEmojiValue } from '../../../../lib/profileEmojis';
import type {
    PointPolicy,
    PointRankEmojiRegistryEntry,
    PointRankPolicy,
    PointRankPolicyTier,
    PointRankThemeId,
} from '../../../../types';
import RankEmojiCollectionPanel from './RankEmojiCollectionPanel';
import RankSettingsSidebar, {
    type RankSettingsPanelId,
    type RankSettingsSidebarItem,
} from './RankSettingsSidebar';
import RankThemePreviewPanel from './RankThemePreviewPanel';
import RankTierEditorPanel from './RankTierEditorPanel';

interface PointRanksTabProps {
    policy: PointPolicy;
    canManage: boolean;
    hasUnsavedChanges: boolean;
    saveFeedbackMessage: string;
    saveFeedbackTone: 'success' | 'error' | 'warning' | null;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: (event: React.FormEvent) => void;
}

const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const buildEmojiCollectionLabel = (emoji: string, fallbackIndex: number) => {
    const normalizedEmoji = normalizeProfileEmojiValue(emoji);
    return normalizedEmoji ? `${normalizedEmoji} 아이콘` : `이모지 ${fallbackIndex + 1}`;
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

const makeEmojiRegistryDraft = (
    entries: PointRankEmojiRegistryEntry[],
    emojiValue: string,
): PointRankEmojiRegistryEntry => {
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
        emoji: emojiValue,
        value: emojiValue,
        label: buildEmojiCollectionLabel(emojiValue, nextIndex - 1),
        category: '기타',
        sortOrder: nextSortOrder,
        enabled: true,
        legacyValues: [],
    };
};

const resequenceEmojiRegistry = (entries: PointRankEmojiRegistryEntry[]) => entries.map((entry, index) => ({
    ...entry,
    sortOrder: (index + 1) * 10,
}));

type DuplicateEmojiDialogState = {
    emoji: string;
    label: string;
    enabled: boolean;
};

const PointRanksTab: React.FC<PointRanksTabProps> = ({
    policy,
    canManage,
    hasUnsavedChanges,
    saveFeedbackMessage,
    saveFeedbackTone,
    onPolicyChange,
    onSubmit,
}) => {
    const draftRankPolicy = resolvePointRankPolicyDraft(policy.rankPolicy);
    const validationError = getPointRankPolicyValidationError(policy.rankPolicy);
    const previewThemeId: PointRankThemeId = draftRankPolicy.activeThemeId === 'korean_golpum'
        ? 'world_nobility'
        : 'korean_golpum';
    const [activePanel, setActivePanel] = useState<RankSettingsPanelId>('theme_preview');
    const [selectedTierCode, setSelectedTierCode] = useState<PointRankPolicyTier['code'] | null>(null);
    const [isCelebrationPreviewOpen, setIsCelebrationPreviewOpen] = useState(false);
    const [newEmojiValue, setNewEmojiValue] = useState('');
    const [duplicateEmojiDialog, setDuplicateEmojiDialog] = useState<DuplicateEmojiDialogState | null>(null);

    const updateRankPolicy = (updater: (prev: PointRankPolicy) => PointRankPolicy) => {
        onPolicyChange((prev) => ({
            ...prev,
            rankPolicy: updater(resolvePointRankPolicyDraft(prev.rankPolicy)),
        }));
    };

    const updateTier = (tierCode: PointRankPolicyTier['code'], updater: (tier: PointRankPolicyTier) => PointRankPolicyTier) => {
        updateRankPolicy((prev) => ({
            ...prev,
            tiers: prev.tiers.map((tier) => (tier.code === tierCode ? updater(tier) : tier)),
        }));
    };

    const setTierField = <K extends keyof PointRankPolicyTier>(tierCode: PointRankPolicyTier['code'], field: K, value: PointRankPolicyTier[K]) => {
        updateTier(tierCode, (tier) => ({
            ...tier,
            [field]: value,
        }));
    };

    const setActiveThemeTierField = (
        tierCode: PointRankPolicyTier['code'],
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

    const toggleTierEmoji = (tierCode: PointRankPolicyTier['code'], emojiId: string) => {
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

    const setActiveThemeId = (themeId: PointRankThemeId) => {
        updateRankPolicy((prev) => ({
            ...prev,
            activeThemeId: themeId,
            themeId,
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

    const showDuplicateEmojiDialog = (entry: PointRankEmojiRegistryEntry) => {
        setDuplicateEmojiDialog({
            emoji: entry.emoji,
            label: entry.label,
            enabled: entry.enabled !== false,
        });
        setActivePanel('emoji_collection');
    };

    const findDuplicateEmoji = (emoji: string, excludedId?: string | null) => (
        findDuplicateProfileEmojiEntry(draftRankPolicy.emojiRegistry, emoji, { excludeId: excludedId })
    );

    const handleAddEmojiRegistryEntry = () => {
        const nextEmoji = normalizeProfileEmojiValue(newEmojiValue);
        if (!nextEmoji) return;

        const duplicateEntry = findDuplicateEmoji(nextEmoji);
        if (duplicateEntry) {
            showDuplicateEmojiDialog(duplicateEntry);
            return;
        }

        const nextEntry = makeEmojiRegistryDraft(draftRankPolicy.emojiRegistry, nextEmoji);
        updateRankPolicy((prev) => ({
            ...prev,
            emojiRegistry: [...prev.emojiRegistry, nextEntry],
        }));
        setNewEmojiValue('');
    };

    const handleEmojiValueChange = (entryId: string, nextEmoji: string, entryIndex: number) => {
        const normalizedEmoji = normalizeProfileEmojiValue(nextEmoji);
        if (!normalizedEmoji) return;

        const duplicateEntry = findDuplicateEmoji(normalizedEmoji, entryId);
        if (duplicateEntry) {
            showDuplicateEmojiDialog(duplicateEntry);
            return;
        }

        updateEmojiRegistryEntry(entryId, (current) => ({
            ...current,
            emoji: normalizedEmoji,
            value: normalizedEmoji,
            label: buildEmojiCollectionLabel(normalizedEmoji, entryIndex),
            legacyValues: Array.from(new Set([
                ...(current.legacyValues || []),
                current.emoji && current.emoji !== normalizedEmoji ? current.emoji : '',
            ].filter(Boolean))),
        }));
    };

    const handleToggleEmojiEnabled = (entryId: string) => {
        updateEmojiRegistryEntry(entryId, (current) => ({
            ...current,
            enabled: current.enabled === false,
        }));
    };

    const handleReorderEmojiRegistry = (sourceId: string, targetId: string) => {
        updateRankPolicy((prev) => {
            const nextRegistry = [...prev.emojiRegistry];
            const sourceIndex = nextRegistry.findIndex((entry) => entry.id === sourceId);
            const targetIndex = nextRegistry.findIndex((entry) => entry.id === targetId);
            if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return prev;

            const [movedEntry] = nextRegistry.splice(sourceIndex, 1);
            nextRegistry.splice(targetIndex, 0, movedEntry);

            return {
                ...prev,
                emojiRegistry: resequenceEmojiRegistry(nextRegistry),
            };
        });
    };

    useEffect(() => {
        if (!selectedTierCode) return;
        const exists = draftRankPolicy.tiers.some((tier) => tier.code === selectedTierCode);
        if (!exists) {
            setSelectedTierCode(null);
        }
    }, [draftRankPolicy.tiers, selectedTierCode]);

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

    const handleSelectTier = (tierCode: PointRankPolicyTier['code']) => {
        setSelectedTierCode((prev) => (prev === tierCode ? null : tierCode));
    };

    const handleAddTier = () => {
        const nextTier = makeTierDraft(draftRankPolicy.tiers);
        updateRankPolicy((prev) => ({
            ...prev,
            tiers: [...prev.tiers, nextTier],
        }));
        setSelectedTierCode(nextTier.code);
        setActivePanel('rank_settings');
    };

    const handleRemoveTier = (tierCode: PointRankPolicyTier['code']) => {
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
    const celebrationPreview = buildStudentRankPromotionPreview(
        draftRankPolicy,
        selectedTierCode as PointRankPolicyTier['code'] | null,
    );
    const celebrationPreviewTier = celebrationPreview.targetTierCode
        ? draftRankPolicy.tiers.find((tier) => tier.code === celebrationPreview.targetTierCode) || null
        : null;
    const celebrationPreviewTierLabel = celebrationPreviewTier
        ? (getTierPreview(celebrationPreviewTier)?.label || celebrationPreviewTier.code)
        : '샘플 등급';

    const sidebarItems: RankSettingsSidebarItem[] = [
        {
            id: 'theme_preview',
            label: '테마 미리보기',
            description: `${activeThemeName} 테마를 중심으로 비교 미리보기를 확인합니다.`,
            iconClassName: 'fas fa-palette',
            badge: '저장 대상',
            meta: `등급 ${draftRankPolicy.tiers.length}개 · 활성 ${enabledEmojiCount}개`,
        },
        {
            id: 'rank_settings',
            label: '등급 설정',
            description: selectedTierPreview
                ? `${selectedTierPreview.label} 등급을 편집하고 있습니다.`
                : '기준 포인트, 이름, 설명, 허용 이모지를 설정합니다.',
            iconClassName: 'fas fa-medal',
            badge: selectedTierPreview ? '편집 중' : undefined,
            meta: `등급 ${draftRankPolicy.tiers.length}개`,
        },
        {
            id: 'emoji_collection',
            label: '이모지 모음',
            description: '이모지를 추가하고, 비활성화하고, 순서를 드래그로 정리합니다.',
            iconClassName: 'fas fa-smile',
            badge: `총 ${draftRankPolicy.emojiRegistry.length}개`,
            meta: `활성 ${enabledEmojiCount}개 · 저장 후 반영`,
        },
    ];

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:flex-row md:items-start md:justify-between">
                <div className="space-y-2">
                    <div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                        {POINT_RANK_FIELD_LABELS.activeThemeId}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-900">등급 설정</h2>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
                            변경사항은 저장 버튼을 눌러야 반영됩니다. 왼쪽 패널로 작업 영역을 나눠서 편집하세요.
                        </p>
                    </div>
                </div>
                <div className="flex flex-col gap-3 md:min-w-[300px] md:items-end">
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
                            ? '저장 전 변경사항이 있습니다. 저장해야 학생 화면에 반영됩니다.'
                            : '저장된 등급 설정과 같습니다.'}
                    </div>
                    {saveFeedbackMessage && saveFeedbackTone && (
                        <div className={`rounded-xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}>
                            {saveFeedbackMessage}
                        </div>
                    )}
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
                <RankSettingsSidebar
                    activePanel={activePanel}
                    items={sidebarItems}
                    onSelect={setActivePanel}
                />

                <div className="min-w-0">
                    {activePanel === 'theme_preview' && (
                        <RankThemePreviewPanel
                            canManage={canManage}
                            draftRankPolicy={draftRankPolicy}
                            activeThemeName={activeThemeName}
                            previewThemeId={previewThemeId}
                            previewThemeName={previewThemeName}
                            enabledEmojiCount={enabledEmojiCount}
                            onThemeChange={setActiveThemeId}
                            getTierPreview={getTierPreview}
                        />
                    )}

                    {activePanel === 'rank_settings' && (
                        <RankTierEditorPanel
                            canManage={canManage}
                            draftRankPolicy={draftRankPolicy}
                            validationError={validationError}
                            selectedTierCode={selectedTierCode}
                            selectedTier={selectedTier}
                            selectedTierPreview={selectedTierPreview}
                            enabledEmojiCount={enabledEmojiCount}
                            celebrationPreviewTierLabel={celebrationPreviewTierLabel}
                            celebrationPreviewAvailable={Boolean(celebrationPreview.rank)}
                            onSelectTier={handleSelectTier}
                            onAddTier={handleAddTier}
                            onRemoveTier={handleRemoveTier}
                            onSetTierField={setTierField}
                            onSetActiveThemeTierField={setActiveThemeTierField}
                            onToggleTierEmoji={toggleTierEmoji}
                            onCelebrationEnabledChange={(enabled) => updateRankPolicy((prev) => ({
                                ...prev,
                                celebrationPolicy: {
                                    ...prev.celebrationPolicy,
                                    enabled,
                                },
                            }))}
                            onCelebrationEffectLevelChange={(effectLevel) => updateRankPolicy((prev) => ({
                                ...prev,
                                celebrationPolicy: {
                                    ...prev.celebrationPolicy,
                                    effectLevel,
                                },
                            }))}
                            onOpenCelebrationPreview={() => setIsCelebrationPreviewOpen(true)}
                            getTierPreview={getTierPreview}
                        />
                    )}

                    {activePanel === 'emoji_collection' && (
                        <RankEmojiCollectionPanel
                            canManage={canManage}
                            draftRankPolicy={draftRankPolicy}
                            enabledEmojiCount={enabledEmojiCount}
                            newEmojiValue={newEmojiValue}
                            onNewEmojiValueChange={setNewEmojiValue}
                            onAddEmoji={handleAddEmojiRegistryEntry}
                            onEmojiValueChange={handleEmojiValueChange}
                            onToggleEmojiEnabled={handleToggleEmojiEnabled}
                            onReorderEmojiRegistry={handleReorderEmojiRegistry}
                            getTierPreview={getTierPreview}
                        />
                    )}
                </div>
            </div>

            {celebrationPreview.rank && (
                <StudentRankPromotionPopup
                    open={isCelebrationPreviewOpen}
                    rank={celebrationPreview.rank}
                    effectLevel={celebrationPreview.effectLevel}
                    previewEmojiEntries={celebrationPreview.previewEmojiEntries}
                    onClose={() => setIsCelebrationPreviewOpen(false)}
                />
            )}

            {duplicateEmojiDialog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
                    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
                            <i className="fas fa-exclamation-circle text-lg" aria-hidden="true"></i>
                        </div>
                        <h3 className="mt-4 text-lg font-bold text-gray-900">이미 등록된 이모지입니다</h3>
                        <p className="mt-2 text-sm leading-6 text-gray-600">
                            {duplicateEmojiDialog.enabled
                                ? '같은 이모지는 이모지 모음에 한 번만 추가할 수 있습니다. 기존 항목을 수정하거나 다시 활성화해 주세요.'
                                : '같은 이모지가 비활성 상태로 이미 등록되어 있습니다. 새로 추가하지 말고 기존 항목을 다시 사용으로 바꿔 주세요.'}
                        </p>

                        <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="text-3xl leading-none">{duplicateEmojiDialog.emoji}</div>
                            <div className="mt-2 text-sm font-bold text-gray-900">{duplicateEmojiDialog.label}</div>
                            <div className="mt-1 text-xs text-gray-500">
                                현재 상태: {duplicateEmojiDialog.enabled ? '사용 중' : '비활성'}
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setDuplicateEmojiDialog(null)}
                                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </form>
    );
};

export default PointRanksTab;
