import React, { useEffect, useState } from "react";
import StudentRankPromotionPopup from "../../../../components/common/StudentRankPromotionPopup";
import { POINT_RANK_BADGE_STYLE_OPTIONS } from "../../../../constants/pointLabels";
import { buildStudentRankPromotionPreview } from "../../../../lib/pointRankPromotion";
import {
  createPointRankTierCode,
  getPointRankDisplayByTierCode,
  getPointRankTierMeta,
  getPointRankPolicyValidationError,
  getPointRankThemeName,
  resolvePointRankPolicyDraft,
} from "../../../../lib/pointRanks";
import {
  findDuplicateProfileEmojiEntry,
  normalizeProfileEmojiValue,
} from "../../../../lib/profileEmojis";
import type {
  PointRankEmojiRegistryEntry,
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
} from "../../../../types";
import RankEmojiCollectionPanel from "./RankEmojiCollectionPanel";
import RankSettingsSidebar, {
  type RankSettingsPanelId,
  type RankSettingsSidebarItem,
} from "./RankSettingsSidebar";
import RankThemePreviewPanel from "./RankThemePreviewPanel";
import RankTierEditorPanel from "./RankTierEditorPanel";

export interface RankThemeDraft {
  activeThemeId: PointRankThemeId;
}

export interface RankSettingsDraft {
  tiers: PointRankPolicyTier[];
  themes?: PointRankPolicy["themes"];
  celebrationPolicy: PointRankPolicy["celebrationPolicy"];
}

export interface RankEmojiCollectionDraft {
  emojiRegistry: PointRankEmojiRegistryEntry[];
  tiers: PointRankPolicyTier[];
}

export type RankPanelSaveTone = "success" | "error" | "warning";

interface PointRanksTabProps {
  savedRankPolicy: PointRankPolicy;
  canManage: boolean;
  themeDraft: RankThemeDraft;
  themeHasUnsavedChanges: boolean;
  themeSaveFeedbackMessage: string;
  themeSaveFeedbackTone: RankPanelSaveTone | null;
  onThemeDraftChange: (
    updater: (prev: RankThemeDraft) => RankThemeDraft,
  ) => void;
  onThemeSave: () => void;
  rankSettingsDraft: RankSettingsDraft;
  rankSettingsHasUnsavedChanges: boolean;
  rankSettingsSaveFeedbackMessage: string;
  rankSettingsSaveFeedbackTone: RankPanelSaveTone | null;
  onRankSettingsDraftChange: (
    updater: (prev: RankSettingsDraft) => RankSettingsDraft,
  ) => void;
  onRankSettingsSave: () => void;
  emojiDraft: RankEmojiCollectionDraft;
  emojiHasUnsavedChanges: boolean;
  emojiSaveFeedbackMessage: string;
  emojiSaveFeedbackTone: RankPanelSaveTone | null;
  onEmojiDraftChange: (
    updater: (prev: RankEmojiCollectionDraft) => RankEmojiCollectionDraft,
  ) => void;
  onEmojiSave: () => void;
}

const buildEmojiCollectionLabel = (emoji: string, fallbackIndex: number) => {
  const normalizedEmoji = normalizeProfileEmojiValue(emoji);
  return normalizedEmoji
    ? `${normalizedEmoji} 아이콘`
    : `이모지 ${fallbackIndex + 1}`;
};

const cloneRankTiers = (tiers: PointRankPolicyTier[] = []) =>
  tiers.map((tier) => ({
    ...tier,
    allowedEmojiIds: [...(tier.allowedEmojiIds || [])],
  }));

const cloneRankThemes = (
  themes: PointRankPolicy["themes"] = {},
): PointRankPolicy["themes"] =>
  Object.fromEntries(
    Object.entries(themes || {}).map(([themeId, themeConfig]) => [
      themeId,
      {
        ...themeConfig,
        tiers: Object.fromEntries(
          Object.entries(themeConfig?.tiers || {}).map(
            ([tierCode, tierOverride]) => [tierCode, { ...tierOverride }],
          ),
        ),
      },
    ]),
  ) as PointRankPolicy["themes"];

const cloneRankEmojiRegistry = (
  emojiRegistry: PointRankEmojiRegistryEntry[] = [],
) =>
  emojiRegistry.map((entry) => ({
    ...entry,
    legacyValues: [...(entry.legacyValues || [])],
  }));

const extractRankSettingsDraft = (
  rankPolicy: PointRankPolicy,
): RankSettingsDraft => ({
  tiers: cloneRankTiers(rankPolicy.tiers),
  themes: cloneRankThemes(rankPolicy.themes),
  celebrationPolicy: {
    ...rankPolicy.celebrationPolicy,
  },
});

const buildRankSettingsPolicy = (
  savedRankPolicy: PointRankPolicy,
  draft: RankSettingsDraft,
) =>
  resolvePointRankPolicyDraft({
    ...savedRankPolicy,
    tiers: cloneRankTiers(draft.tiers),
    themes: cloneRankThemes(draft.themes),
    celebrationPolicy: {
      ...draft.celebrationPolicy,
    },
  });

const extractRankEmojiDraft = (
  rankPolicy: PointRankPolicy,
): RankEmojiCollectionDraft => ({
  emojiRegistry: cloneRankEmojiRegistry(rankPolicy.emojiRegistry),
  tiers: cloneRankTiers(rankPolicy.tiers),
});

const buildEmojiCollectionPolicy = (
  savedRankPolicy: PointRankPolicy,
  draft: RankEmojiCollectionDraft,
) =>
  resolvePointRankPolicyDraft({
    ...savedRankPolicy,
    tiers: cloneRankTiers(draft.tiers),
    emojiRegistry: cloneRankEmojiRegistry(draft.emojiRegistry),
  });

const makeTierDraft = (tiers: PointRankPolicyTier[]): PointRankPolicyTier => {
  const lowestThreshold = tiers.reduce(
    (minValue, tier) => Math.min(minValue, Number(tier.minPoints || 0)),
    Number.POSITIVE_INFINITY,
  );
  const nextIndex = tiers.length + 1;

  return {
    code: createPointRankTierCode(tiers),
    // New tiers should start as the lowest step so teachers can rename and
    // tune the threshold before saving.
    minPoints: Number.isFinite(lowestThreshold)
      ? Math.max(0, lowestThreshold)
      : 0,
    badgeStyleToken:
      POINT_RANK_BADGE_STYLE_OPTIONS[
        (nextIndex - 1) % POINT_RANK_BADGE_STYLE_OPTIONS.length
      ]?.value || "stone",
    allowedEmojiIds: [],
  };
};

const makeEmojiRegistryDraft = (
  entries: PointRankEmojiRegistryEntry[],
  emojiValue: string,
): PointRankEmojiRegistryEntry => {
  const nextIndex = entries.length + 1;
  const nextSortOrder =
    entries.reduce(
      (maxValue, entry) => Math.max(maxValue, Number(entry.sortOrder || 0)),
      0,
    ) + 10;
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
    category: "기타",
    sortOrder: nextSortOrder,
    enabled: true,
    legacyValues: [],
  };
};

const resequenceEmojiRegistry = (entries: PointRankEmojiRegistryEntry[]) =>
  entries.map((entry, index) => ({
    ...entry,
    sortOrder: (index + 1) * 10,
  }));

type DuplicateEmojiDialogState = {
  emoji: string;
  label: string;
  enabled: boolean;
};

const PointRanksTab: React.FC<PointRanksTabProps> = ({
  savedRankPolicy,
  canManage,
  themeDraft,
  themeHasUnsavedChanges,
  themeSaveFeedbackMessage,
  themeSaveFeedbackTone,
  onThemeDraftChange,
  onThemeSave,
  rankSettingsDraft,
  rankSettingsHasUnsavedChanges,
  rankSettingsSaveFeedbackMessage,
  rankSettingsSaveFeedbackTone,
  onRankSettingsDraftChange,
  onRankSettingsSave,
  emojiDraft,
  emojiHasUnsavedChanges,
  emojiSaveFeedbackMessage,
  emojiSaveFeedbackTone,
  onEmojiDraftChange,
  onEmojiSave,
}) => {
  const [activePanel, setActivePanel] =
    useState<RankSettingsPanelId>("theme_preview");
  const [selectedTierCode, setSelectedTierCode] = useState<
    PointRankPolicyTier["code"] | null
  >(null);
  const [newEmojiValue, setNewEmojiValue] = useState("");
  const [duplicateEmojiDialog, setDuplicateEmojiDialog] =
    useState<DuplicateEmojiDialogState | null>(null);
  const [celebrationPreviewTierCode, setCelebrationPreviewTierCode] = useState<
    PointRankPolicyTier["code"] | null
  >(null);

  const themePreviewPolicy = resolvePointRankPolicyDraft({
    ...savedRankPolicy,
    activeThemeId: themeDraft.activeThemeId,
    themeId: themeDraft.activeThemeId,
  });
  const rankSettingsPolicy = buildRankSettingsPolicy(
    savedRankPolicy,
    rankSettingsDraft,
  );
  const emojiCollectionPolicy = buildEmojiCollectionPolicy(
    savedRankPolicy,
    emojiDraft,
  );
  const rankSettingsValidationError =
    getPointRankPolicyValidationError(rankSettingsPolicy);
  const previewThemeId: PointRankThemeId =
    themePreviewPolicy.activeThemeId === "korean_golpum"
      ? "world_nobility"
      : "korean_golpum";

  const updateRankSettingsPolicy = (
    updater: (prev: PointRankPolicy) => PointRankPolicy,
  ) => {
    onRankSettingsDraftChange((prev) =>
      extractRankSettingsDraft(
        updater(buildRankSettingsPolicy(savedRankPolicy, prev)),
      ),
    );
  };

  const updateEmojiCollectionPolicy = (
    updater: (prev: PointRankPolicy) => PointRankPolicy,
  ) => {
    onEmojiDraftChange((prev) =>
      extractRankEmojiDraft(
        updater(buildEmojiCollectionPolicy(savedRankPolicy, prev)),
      ),
    );
  };

  const updateTier = (
    tierCode: PointRankPolicyTier["code"],
    updater: (tier: PointRankPolicyTier) => PointRankPolicyTier,
  ) => {
    updateRankSettingsPolicy((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier) =>
        tier.code === tierCode ? updater(tier) : tier,
      ),
    }));
  };

  const setTierField = <K extends keyof PointRankPolicyTier>(
    tierCode: PointRankPolicyTier["code"],
    field: K,
    value: PointRankPolicyTier[K],
  ) => {
    updateTier(tierCode, (tier) => ({
      ...tier,
      [field]: value,
    }));
  };

  const setActiveThemeTierField = (
    tierCode: PointRankPolicyTier["code"],
    field: "label" | "shortLabel" | "description",
    value: string,
  ) => {
    updateRankSettingsPolicy((prev) => ({
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

  const toggleTierEmoji = (
    tierCode: PointRankPolicyTier["code"],
    emojiId: string,
  ) => {
    updateRankSettingsPolicy((prev) => {
      const nextTiers = prev.tiers.map((tier) => ({
        ...tier,
        allowedEmojiIds: (tier.allowedEmojiIds || []).filter(
          (item) => item !== emojiId,
        ),
      }));
      const targetTier = nextTiers.find((tier) => tier.code === tierCode);
      if (!targetTier) return prev;

      const wasChecked = (
        prev.tiers.find((tier) => tier.code === tierCode)?.allowedEmojiIds || []
      ).includes(emojiId);
      if (!wasChecked) {
        targetTier.allowedEmojiIds = [
          ...(targetTier.allowedEmojiIds || []),
          emojiId,
        ];
      }

      return {
        ...prev,
        tiers: nextTiers,
      };
    });
  };

  const setActiveThemeId = (themeId: PointRankThemeId) => {
    onThemeDraftChange(() => ({
      activeThemeId: themeId,
    }));
  };

  const updateEmojiRegistryEntry = (
    entryId: string,
    updater: (
      entry: PointRankEmojiRegistryEntry,
    ) => PointRankEmojiRegistryEntry,
  ) => {
    updateEmojiCollectionPolicy((prev) => ({
      ...prev,
      emojiRegistry: prev.emojiRegistry.map((entry) =>
        entry.id === entryId ? updater(entry) : entry,
      ),
    }));
  };

  const showDuplicateEmojiDialog = (entry: PointRankEmojiRegistryEntry) => {
    setDuplicateEmojiDialog({
      emoji: entry.emoji,
      label: entry.label,
      enabled: entry.enabled !== false,
    });
    setActivePanel("emoji_collection");
  };

  const findDuplicateEmoji = (emoji: string, excludedId?: string | null) =>
    findDuplicateProfileEmojiEntry(emojiCollectionPolicy.emojiRegistry, emoji, {
      excludeId: excludedId,
    });

  const handleAddEmojiRegistryEntry = () => {
    const nextEmoji = normalizeProfileEmojiValue(newEmojiValue);
    if (!nextEmoji) return;

    const duplicateEntry = findDuplicateEmoji(nextEmoji);
    if (duplicateEntry) {
      showDuplicateEmojiDialog(duplicateEntry);
      return;
    }

    const nextEntry = makeEmojiRegistryDraft(
      emojiCollectionPolicy.emojiRegistry,
      nextEmoji,
    );
    updateEmojiCollectionPolicy((prev) => ({
      ...prev,
      emojiRegistry: [...prev.emojiRegistry, nextEntry],
    }));
    setNewEmojiValue("");
  };

  const handleEmojiValueChange = (
    entryId: string,
    nextEmoji: string,
    entryIndex: number,
  ) => {
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
      legacyValues: Array.from(
        new Set(
          [
            ...(current.legacyValues || []),
            current.emoji && current.emoji !== normalizedEmoji
              ? current.emoji
              : "",
          ].filter(Boolean),
        ),
      ),
    }));
  };

  const handleToggleEmojiEnabled = (entryId: string) => {
    updateEmojiRegistryEntry(entryId, (current) => ({
      ...current,
      enabled: current.enabled === false,
    }));
  };

  const handleMoveEmojiToTier = (
    entryId: string,
    targetTierCode: PointRankPolicyTier["code"],
  ) => {
    updateEmojiCollectionPolicy((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier) => ({
        ...tier,
        allowedEmojiIds:
          tier.code === targetTierCode
            ? Array.from(
                new Set([
                  ...(tier.allowedEmojiIds || []).filter(
                    (item) => item !== entryId,
                  ),
                  entryId,
                ]),
              )
            : (tier.allowedEmojiIds || []).filter((item) => item !== entryId),
      })),
    }));
  };

  const handleReorderEmojiRegistry = (sourceId: string, targetId: string) => {
    updateEmojiCollectionPolicy((prev) => {
      const nextRegistry = [...prev.emojiRegistry];
      const sourceIndex = nextRegistry.findIndex(
        (entry) => entry.id === sourceId,
      );
      const targetIndex = nextRegistry.findIndex(
        (entry) => entry.id === targetId,
      );
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
        return prev;

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
    const exists = rankSettingsPolicy.tiers.some(
      (tier) => tier.code === selectedTierCode,
    );
    if (!exists) {
      setSelectedTierCode(null);
    }
  }, [rankSettingsPolicy.tiers, selectedTierCode]);

  const buildTierPreviewGetter =
    (rankPolicy: PointRankPolicy) =>
    (
      tier: PointRankPolicyTier,
      themeId: PointRankThemeId = rankPolicy.activeThemeId,
    ) =>
      getPointRankDisplayByTierCode({
        rankPolicy: {
          ...rankPolicy,
          activeThemeId: themeId,
          themeId,
        },
        tierCode: tier.code,
        themeId,
      });

  const getThemeTierPreview = buildTierPreviewGetter(themePreviewPolicy);
  const getRankSettingsTierPreview = buildTierPreviewGetter(rankSettingsPolicy);
  const getEmojiTierPreview = buildTierPreviewGetter(emojiCollectionPolicy);
  const celebrationPreview = celebrationPreviewTierCode
    ? buildStudentRankPromotionPreview(
        rankSettingsPolicy,
        celebrationPreviewTierCode,
      )
    : null;

  const handleSelectTier = (tierCode: PointRankPolicyTier["code"]) => {
    setSelectedTierCode((prev) => (prev === tierCode ? null : tierCode));
  };

  const handleAddTier = () => {
    const nextTier = makeTierDraft(rankSettingsPolicy.tiers);
    updateRankSettingsPolicy((prev) => {
      const nextPolicy: PointRankPolicy = {
        ...prev,
        tiers: [...prev.tiers, nextTier],
      };
      const initialTierMeta = getPointRankTierMeta(
        nextPolicy,
        prev.activeThemeId,
        nextTier.code,
      );

      return {
        ...nextPolicy,
        themes: {
          ...(nextPolicy.themes || {}),
          [prev.activeThemeId]: {
            ...(nextPolicy.themes?.[prev.activeThemeId] || {}),
            tiers: {
              ...(nextPolicy.themes?.[prev.activeThemeId]?.tiers || {}),
              [nextTier.code]: {
                ...(nextPolicy.themes?.[prev.activeThemeId]?.tiers?.[
                  nextTier.code
                ] || {}),
                label: initialTierMeta.label,
                shortLabel: initialTierMeta.shortLabel,
                description: initialTierMeta.description,
              },
            },
          },
        },
      };
    });
    setSelectedTierCode(nextTier.code);
    setActivePanel("rank_settings");
  };

  const handleRemoveTier = (tierCode: PointRankPolicyTier["code"]) => {
    const tierIndex = rankSettingsPolicy.tiers.findIndex(
      (tier) => tier.code === tierCode,
    );
    if (tierIndex < 0 || rankSettingsPolicy.tiers.length <= 1) return;
    const removedTier = rankSettingsPolicy.tiers[tierIndex];
    const targetTier =
      rankSettingsPolicy.tiers[tierIndex - 1] ||
      rankSettingsPolicy.tiers[tierIndex + 1] ||
      null;
    const removedTierLabel =
      getRankSettingsTierPreview(removedTier)?.label || "선택한 등급";
    const targetTierLabel = targetTier
      ? getRankSettingsTierPreview(targetTier)?.label || "다른 등급"
      : "";

    const confirmed = window.confirm(
      targetTier
        ? `'${removedTierLabel}' 등급을 삭제할까요?\n연결된 허용 이모지와 테마 설정은 '${targetTierLabel}' 등급으로 옮겨집니다.`
        : `'${removedTierLabel}' 등급을 삭제할까요?`,
    );
    if (!confirmed) return;

    updateRankSettingsPolicy((prev) => {
      if (prev.tiers.length <= 1) return prev;
      const currentTierIndex = prev.tiers.findIndex(
        (tier) => tier.code === tierCode,
      );
      if (currentTierIndex < 0) return prev;
      const removedCurrentTier = prev.tiers[currentTierIndex];
      const targetCurrentTier =
        prev.tiers[currentTierIndex - 1] ||
        prev.tiers[currentTierIndex + 1] ||
        null;

      return {
        ...prev,
        tiers: prev.tiers
          .filter((tier) => tier.code !== tierCode)
          .map((tier) => {
            if (!targetCurrentTier || tier.code !== targetCurrentTier.code)
              return tier;
            return {
              ...tier,
              allowedEmojiIds: Array.from(
                new Set([
                  ...(tier.allowedEmojiIds || []),
                  ...(removedCurrentTier.allowedEmojiIds || []),
                ]),
              ),
            };
          }),
        themes: Object.fromEntries(
          Object.entries(prev.themes || {}).map(([themeId, themeConfig]) => [
            themeId,
            {
              ...themeConfig,
              tiers: Object.fromEntries(
                Object.entries(themeConfig?.tiers || {}).filter(
                  ([code]) => code !== tierCode,
                ),
              ),
            },
          ]),
        ),
      };
    });

    setSelectedTierCode((prev) =>
      prev === tierCode ? targetTier?.code || null : prev,
    );
  };

  const activeThemeName = getPointRankThemeName(
    themePreviewPolicy,
    themePreviewPolicy.activeThemeId,
  );
  const previewThemeName = getPointRankThemeName(
    themePreviewPolicy,
    previewThemeId,
  );
  const savedEnabledEmojiCount = savedRankPolicy.emojiRegistry.filter(
    (entry) => entry.enabled !== false,
  ).length;
  const emojiEnabledCount = emojiCollectionPolicy.emojiRegistry.filter(
    (entry) => entry.enabled !== false,
  ).length;
  const sidebarItems: RankSettingsSidebarItem[] = [
    {
      id: "theme_preview",
      label: "테마 미리보기",
      iconClassName: "fas fa-palette",
      badge: themeHasUnsavedChanges ? "미저장" : "저장됨",
      meta: activeThemeName,
    },
    {
      id: "rank_settings",
      label: "등급 관리",
      iconClassName: "fas fa-medal",
      badge: rankSettingsHasUnsavedChanges ? "미저장" : "저장됨",
      meta: `등급 ${rankSettingsPolicy.tiers.length}개`,
    },
    {
      id: "emoji_collection",
      label: "이모지 모음",
      iconClassName: "fas fa-smile",
      badge: emojiHasUnsavedChanges ? "미저장" : "저장됨",
      meta: `총 ${emojiCollectionPolicy.emojiRegistry.length}개 · 활성 ${emojiEnabledCount}개`,
    },
  ];
  const activeSidebarItem =
    sidebarItems.find((item) => item.id === activePanel) || sidebarItems[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <RankSettingsSidebar
          activePanel={activePanel}
          items={sidebarItems}
          onSelect={setActivePanel}
        />

        <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 whitespace-nowrap">
                <i
                  className={`${activeSidebarItem.iconClassName} text-[11px]`}
                  aria-hidden="true"
                ></i>
                {activeSidebarItem.label}
              </span>
              {activeSidebarItem.meta && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 whitespace-nowrap">
                  {activeSidebarItem.meta}
                </span>
              )}
              {activeSidebarItem.badge && (
                <span
                  className={[
                    "rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap",
                    activeSidebarItem.badge === "미저장"
                      ? "border border-amber-200 bg-amber-50 text-amber-800"
                      : "border border-gray-200 bg-gray-50 text-gray-600",
                  ].join(" ")}
                >
                  {activeSidebarItem.badge}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-5 bg-gray-50/75 p-4 sm:space-y-6 sm:p-6">
            {activePanel === "theme_preview" && (
              <RankThemePreviewPanel
                canManage={canManage}
                draftRankPolicy={themePreviewPolicy}
                activeThemeName={activeThemeName}
                previewThemeId={previewThemeId}
                previewThemeName={previewThemeName}
                enabledEmojiCount={savedEnabledEmojiCount}
                hasUnsavedChanges={themeHasUnsavedChanges}
                saveFeedbackMessage={themeSaveFeedbackMessage}
                saveFeedbackTone={themeSaveFeedbackTone}
                onThemeChange={setActiveThemeId}
                onSave={onThemeSave}
                getTierPreview={getThemeTierPreview}
              />
            )}

            {activePanel === "rank_settings" && (
              <RankTierEditorPanel
                canManage={canManage}
                draftRankPolicy={rankSettingsPolicy}
                validationError={rankSettingsValidationError}
                selectedTierCode={selectedTierCode}
                enabledEmojiCount={savedEnabledEmojiCount}
                hasUnsavedChanges={rankSettingsHasUnsavedChanges}
                saveFeedbackMessage={rankSettingsSaveFeedbackMessage}
                saveFeedbackTone={rankSettingsSaveFeedbackTone}
                onSave={onRankSettingsSave}
                onSelectTier={handleSelectTier}
                onAddTier={handleAddTier}
                onRemoveTier={handleRemoveTier}
                onPreviewCelebration={setCelebrationPreviewTierCode}
                onSetTierField={setTierField}
                onSetActiveThemeTierField={setActiveThemeTierField}
                onToggleTierEmoji={toggleTierEmoji}
                getTierPreview={getRankSettingsTierPreview}
              />
            )}

            {activePanel === "emoji_collection" && (
              <RankEmojiCollectionPanel
                canManage={canManage}
                draftRankPolicy={emojiCollectionPolicy}
                enabledEmojiCount={emojiEnabledCount}
                newEmojiValue={newEmojiValue}
                hasUnsavedChanges={emojiHasUnsavedChanges}
                saveFeedbackMessage={emojiSaveFeedbackMessage}
                saveFeedbackTone={emojiSaveFeedbackTone}
                onNewEmojiValueChange={setNewEmojiValue}
                onAddEmoji={handleAddEmojiRegistryEntry}
                onSave={onEmojiSave}
                onEmojiValueChange={handleEmojiValueChange}
                onToggleEmojiEnabled={handleToggleEmojiEnabled}
                onMoveEmojiToTier={handleMoveEmojiToTier}
                onReorderEmojiRegistry={handleReorderEmojiRegistry}
                getTierPreview={getEmojiTierPreview}
              />
            )}
          </div>
        </div>
      </div>

      {celebrationPreview && celebrationPreview.rank && (
        <StudentRankPromotionPopup
          open={Boolean(celebrationPreviewTierCode)}
          rank={celebrationPreview.rank}
          effectLevel={celebrationPreview.effectLevel}
          previewEmojiEntries={celebrationPreview.previewEmojiEntries}
          onClose={() => setCelebrationPreviewTierCode(null)}
        />
      )}

      {duplicateEmojiDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-700">
              <i
                className="fas fa-exclamation-circle text-lg"
                aria-hidden="true"
              ></i>
            </div>
            <h3 className="mt-4 text-lg font-bold text-gray-900">
              이미 등록된 이모지입니다
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              {duplicateEmojiDialog.enabled
                ? "같은 이모지는 이모지 모음에 한 번만 추가할 수 있습니다. 기존 항목을 수정하거나 다시 활성화해 주세요."
                : "같은 이모지가 비활성 상태로 이미 등록되어 있습니다. 새로 추가하지 말고 기존 항목을 다시 사용으로 바꿔 주세요."}
            </p>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="text-3xl leading-none">
                {duplicateEmojiDialog.emoji}
              </div>
              <div className="mt-2 text-sm font-bold text-gray-900">
                {duplicateEmojiDialog.label}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                현재 상태: {duplicateEmojiDialog.enabled ? "사용 중" : "비활성"}
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
    </div>
  );
};

export default PointRanksTab;
