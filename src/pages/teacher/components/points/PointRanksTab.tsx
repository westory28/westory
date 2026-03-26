import React, { useEffect, useState } from "react";
import StudentRankPromotionPopup from "../../../../components/common/StudentRankPromotionPopup";
import { POINT_RANK_BADGE_STYLE_OPTIONS } from "../../../../constants/pointLabels";
import type { PointRankDisplay } from "../../../../lib/pointRanks";
import {
  createPointRankTierCode,
  getPointRankDisplay,
  getPointRankPolicyValidationError,
  getPointRankThemeName,
  resolvePointRankPolicyDraft,
} from "../../../../lib/pointRanks";
import { buildStudentRankPromotionPreview } from "../../../../lib/pointRankPromotion";
import type {
  PointPolicy,
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

interface PointRanksTabProps {
  policy: PointPolicy;
  canManage: boolean;
  hasUnsavedChanges: boolean;
  saveFeedbackMessage: string;
  saveFeedbackTone: "success" | "error" | "warning" | null;
  onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
  onSubmit: (event: React.FormEvent) => void;
}

const feedbackToneClassName: Record<"success" | "error" | "warning", string> = {
  success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border border-red-200 bg-red-50 text-red-700",
  warning: "border border-amber-200 bg-amber-50 text-amber-800",
};

const normalizeText = (value: unknown) => String(value || "").trim();

const normalizeEmojiValue = (value: unknown) => {
  const normalized = normalizeText(value);
  return normalized ? normalized.normalize("NFC") : "";
};

const buildEmojiCollectionLabel = (emoji: string, fallbackIndex: number) => {
  const normalizedEmoji = normalizeEmojiValue(emoji);
  return normalizedEmoji
    ? `${normalizedEmoji} 아이콘`
    : `이모지 ${fallbackIndex + 1}`;
};

const buildReindexedEmojiRegistry = (entries: PointRankEmojiRegistryEntry[]) =>
  entries.map((entry, index) => ({
    ...entry,
    sortOrder: (index + 1) * 10,
  }));

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
    badgeStyleToken:
      POINT_RANK_BADGE_STYLE_OPTIONS[
        (nextIndex - 1) % POINT_RANK_BADGE_STYLE_OPTIONS.length
      ]?.value || "stone",
    allowedEmojiIds: [],
  };
};

const makeEmojiRegistryDraft = (
  entries: PointRankEmojiRegistryEntry[],
  emoji: string,
): PointRankEmojiRegistryEntry => {
  const nextIndex = entries.length + 1;
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
    emoji,
    value: emoji,
    label: buildEmojiCollectionLabel(emoji, nextIndex - 1),
    category: "기타",
    sortOrder: nextIndex * 10,
    enabled: true,
    legacyValues: [],
  };
};

const findDuplicateEmojiEntry = (
  entries: PointRankEmojiRegistryEntry[],
  emoji: string,
  excludeEntryId?: string,
) => {
  const normalizedEmoji = normalizeEmojiValue(emoji);
  if (!normalizedEmoji) return null;

  return (
    entries.find(
      (entry) =>
        entry.id !== excludeEntryId &&
        normalizeEmojiValue(entry.emoji) === normalizedEmoji,
    ) || null
  );
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
  const previewThemeId: PointRankThemeId =
    draftRankPolicy.activeThemeId === "korean_golpum"
      ? "world_nobility"
      : "korean_golpum";
  const [activePanel, setActivePanel] =
    useState<RankSettingsPanelId>("theme-preview");
  const [selectedTierCode, setSelectedTierCode] = useState<
    PointRankPolicyTier["code"] | null
  >(null);
  const [isCelebrationPreviewOpen, setIsCelebrationPreviewOpen] =
    useState(false);
  const [duplicateEmojiEntry, setDuplicateEmojiEntry] =
    useState<PointRankEmojiRegistryEntry | null>(null);

  const updateRankPolicy = (
    updater: (prev: PointRankPolicy) => PointRankPolicy,
  ) => {
    onPolicyChange((prev) => ({
      ...prev,
      rankPolicy: updater(resolvePointRankPolicyDraft(prev.rankPolicy)),
    }));
  };

  const updateTier = (
    tierCode: PointRankPolicyTier["code"],
    updater: (tier: PointRankPolicyTier) => PointRankPolicyTier,
  ) => {
    updateRankPolicy((prev) => ({
      ...prev,
      tiers: prev.tiers.map((tier) =>
        tier.code === tierCode ? updater(tier) : tier,
      ),
    }));
  };

  const updateEmojiRegistryEntry = (
    entryId: string,
    updater: (
      entry: PointRankEmojiRegistryEntry,
    ) => PointRankEmojiRegistryEntry,
  ) => {
    updateRankPolicy((prev) => ({
      ...prev,
      emojiRegistry: prev.emojiRegistry.map((entry) =>
        entry.id === entryId ? updater(entry) : entry,
      ),
    }));
  };

  useEffect(() => {
    if (!selectedTierCode) return;
    const exists = draftRankPolicy.tiers.some(
      (tier) => tier.code === selectedTierCode,
    );
    if (!exists) {
      setSelectedTierCode(null);
    }
  }, [draftRankPolicy.tiers, selectedTierCode]);

  const getTierPreview = (
    tier: PointRankPolicyTier,
    themeId: PointRankThemeId = draftRankPolicy.activeThemeId,
  ): PointRankDisplay | null =>
    getPointRankDisplay({
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

  const showDuplicateEmojiNotice = (entry: PointRankEmojiRegistryEntry) => {
    setDuplicateEmojiEntry(entry);
    setActivePanel("emoji-collection");
    return false;
  };

  const handleAddTier = () => {
    const nextTier = makeTierDraft(draftRankPolicy.tiers);
    updateRankPolicy((prev) => ({
      ...prev,
      tiers: [...prev.tiers, nextTier],
    }));
    setSelectedTierCode(nextTier.code);
  };

  const handleRemoveTier = (tierCode: PointRankPolicyTier["code"]) => {
    const tierIndex = draftRankPolicy.tiers.findIndex(
      (tier) => tier.code === tierCode,
    );
    if (tierIndex < 0 || draftRankPolicy.tiers.length <= 1) return;
    const removedTier = draftRankPolicy.tiers[tierIndex];
    const targetTier =
      draftRankPolicy.tiers[tierIndex - 1] ||
      draftRankPolicy.tiers[tierIndex + 1] ||
      null;
    const removedTierLabel =
      getTierPreview(removedTier)?.label || removedTier.code;
    const targetTierLabel = targetTier
      ? getTierPreview(targetTier)?.label || targetTier.code
      : "";

    const confirmed = window.confirm(
      targetTier
        ? `'${removedTierLabel}' 등급을 삭제할까요?\n연결된 허용 이모지와 테마 설정은 '${targetTierLabel}' 등급으로 옮겨집니다.`
        : `'${removedTierLabel}' 등급을 삭제할까요?`,
    );
    if (!confirmed) return;

    updateRankPolicy((prev) => {
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

  const handleToggleTierEmoji = (
    tierCode: PointRankPolicyTier["code"],
    emojiId: string,
  ) => {
    updateRankPolicy((prev) => {
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
        emojiRegistry: prev.emojiRegistry.map((entry) =>
          entry.id === emojiId && !wasChecked
            ? { ...entry, unlockTierCode: tierCode }
            : entry,
        ),
      };
    });
  };

  const handleAddEmojiRegistryEntry = (emoji: string) => {
    const normalizedEmoji = normalizeEmojiValue(emoji);
    if (!normalizedEmoji) return false;

    const duplicateEntry = findDuplicateEmojiEntry(
      draftRankPolicy.emojiRegistry,
      normalizedEmoji,
    );
    if (duplicateEntry) {
      return showDuplicateEmojiNotice(duplicateEntry);
    }

    updateRankPolicy((prev) => ({
      ...prev,
      emojiRegistry: buildReindexedEmojiRegistry([
        ...prev.emojiRegistry,
        makeEmojiRegistryDraft(prev.emojiRegistry, normalizedEmoji),
      ]),
    }));
    return true;
  };

  const handleCommitEmojiRegistryEntry = (
    entryId: string,
    emoji: string,
    entryIndex: number,
  ) => {
    const normalizedEmoji = normalizeEmojiValue(emoji);
    if (!normalizedEmoji) return false;

    const duplicateEntry = findDuplicateEmojiEntry(
      draftRankPolicy.emojiRegistry,
      normalizedEmoji,
      entryId,
    );
    if (duplicateEntry) {
      return showDuplicateEmojiNotice(duplicateEntry);
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
            current.emoji &&
            normalizeEmojiValue(current.emoji) !== normalizedEmoji
              ? current.emoji
              : "",
          ].filter(Boolean),
        ),
      ),
    }));
    return true;
  };

  const handleReorderEmojiRegistry = (activeId: string, overId: string) => {
    updateRankPolicy((prev) => {
      const currentIndex = prev.emojiRegistry.findIndex(
        (entry) => entry.id === activeId,
      );
      const nextIndex = prev.emojiRegistry.findIndex(
        (entry) => entry.id === overId,
      );
      if (currentIndex < 0 || nextIndex < 0 || currentIndex === nextIndex)
        return prev;

      const nextRegistry = [...prev.emojiRegistry];
      const [movedEntry] = nextRegistry.splice(currentIndex, 1);
      nextRegistry.splice(nextIndex, 0, movedEntry);

      return {
        ...prev,
        emojiRegistry: buildReindexedEmojiRegistry(nextRegistry),
      };
    });
  };

  const handleThemeTierFieldChange = (
    tierCode: PointRankPolicyTier["code"],
    field: "label" | "shortLabel" | "description",
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

  const handleSetActiveThemeId = (themeId: PointRankThemeId) => {
    updateRankPolicy((prev) => ({
      ...prev,
      activeThemeId: themeId,
      themeId,
    }));
  };

  const activeThemeName = getPointRankThemeName(
    draftRankPolicy,
    draftRankPolicy.activeThemeId,
  );
  const previewThemeName = getPointRankThemeName(
    draftRankPolicy,
    previewThemeId,
  );
  const enabledEmojiCount = draftRankPolicy.emojiRegistry.filter(
    (entry) => entry.enabled !== false,
  ).length;
  const celebrationPreview = buildStudentRankPromotionPreview(
    draftRankPolicy,
    selectedTierCode as PointRankPolicyTier["code"] | null,
  );
  const celebrationPreviewTier = celebrationPreview.targetTierCode
    ? draftRankPolicy.tiers.find(
        (tier) => tier.code === celebrationPreview.targetTierCode,
      ) || null
    : null;
  const celebrationPreviewTierLabel = celebrationPreviewTier
    ? getTierPreview(celebrationPreviewTier)?.label ||
      celebrationPreviewTier.code
    : "샘플 등급";

  const sidebarItems: RankSettingsSidebarItem[] = [
    {
      id: "theme-preview",
      title: "테마 미리보기",
      description: "현재 저장 대상과 비교 미리보기를 확인합니다.",
      iconClassName: "fas fa-eye",
      badgeText: activeThemeName,
    },
    {
      id: "tier-settings",
      title: "등급 설정",
      description: "등급 기준, 이름, 배지, 허용 이모지를 편집합니다.",
      iconClassName: "fas fa-layer-group",
      badgeText: `등급 ${draftRankPolicy.tiers.length}개`,
    },
    {
      id: "emoji-collection",
      title: "이모지 모음",
      description: "추가, 비활성화, 순서 조정을 관리합니다.",
      iconClassName: "fas fa-smile",
      badgeText: `활성 ${enabledEmojiCount}/${draftRankPolicy.emojiRegistry.length}`,
    },
  ];

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-gray-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
            포인트 관리 &gt; 등급 설정
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-gray-900">등급 설정</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              좌측 탭에서 편집 영역을 고르고, 우측에서 현재 선택한 영역만
              수정합니다.
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
          <div
            className={[
              "rounded-xl border px-4 py-3 text-sm",
              hasUnsavedChanges
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-gray-200 bg-gray-50 text-gray-600",
            ].join(" ")}
          >
            {hasUnsavedChanges
              ? "변경사항은 저장 버튼을 눌러야 반영됩니다."
              : "저장된 등급 설정과 같습니다."}
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <RankSettingsSidebar
          items={sidebarItems}
          activePanel={activePanel}
          onSelect={setActivePanel}
        />

        <div className="min-w-0">
          {activePanel === "theme-preview" && (
            <RankThemePreviewPanel
              activeThemeId={draftRankPolicy.activeThemeId}
              activeThemeName={activeThemeName}
              previewThemeId={previewThemeId}
              previewThemeName={previewThemeName}
              canManage={canManage}
              enabledEmojiCount={enabledEmojiCount}
              tiers={draftRankPolicy.tiers}
              getTierPreview={getTierPreview}
              onActiveThemeChange={handleSetActiveThemeId}
            />
          )}

          {activePanel === "tier-settings" && (
            <RankTierEditorPanel
              canManage={canManage}
              validationError={validationError}
              draftRankPolicy={draftRankPolicy}
              selectedTierCode={selectedTierCode}
              enabledEmojiCount={enabledEmojiCount}
              celebrationPreviewTierLabel={celebrationPreviewTierLabel}
              canPreviewCelebration={Boolean(celebrationPreview.rank)}
              onSelectTier={(tierCode) =>
                setSelectedTierCode((prev) =>
                  prev === tierCode ? null : tierCode,
                )
              }
              onAddTier={handleAddTier}
              onRemoveTier={handleRemoveTier}
              onTierMinPointsChange={(tierCode, minPoints) =>
                updateTier(tierCode, (tier) => ({
                  ...tier,
                  minPoints,
                }))
              }
              onTierBadgeStyleTokenChange={(tierCode, badgeStyleToken) =>
                updateTier(tierCode, (tier) => ({
                  ...tier,
                  badgeStyleToken,
                }))
              }
              onThemeTierFieldChange={handleThemeTierFieldChange}
              onToggleTierEmoji={handleToggleTierEmoji}
              onCelebrationEnabledChange={(enabled) =>
                updateRankPolicy((prev) => ({
                  ...prev,
                  celebrationPolicy: {
                    ...prev.celebrationPolicy,
                    enabled,
                  },
                }))
              }
              onCelebrationEffectLevelChange={(effectLevel) =>
                updateRankPolicy((prev) => ({
                  ...prev,
                  celebrationPolicy: {
                    ...prev.celebrationPolicy,
                    effectLevel,
                  },
                }))
              }
              onOpenCelebrationPreview={() => setIsCelebrationPreviewOpen(true)}
              getTierPreview={getTierPreview}
            />
          )}

          {activePanel === "emoji-collection" && (
            <RankEmojiCollectionPanel
              canManage={canManage}
              emojiRegistry={draftRankPolicy.emojiRegistry}
              tiers={draftRankPolicy.tiers}
              enabledEmojiCount={enabledEmojiCount}
              onAddEmoji={handleAddEmojiRegistryEntry}
              onCommitEmoji={handleCommitEmojiRegistryEntry}
              onToggleEmojiEnabled={(entryId) =>
                updateEmojiRegistryEntry(entryId, (current) => ({
                  ...current,
                  enabled: current.enabled === false,
                }))
              }
              onReorderEmoji={handleReorderEmojiRegistry}
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

      {duplicateEmojiEntry && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/45 p-4"
          onClick={() => setDuplicateEmojiEntry(null)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
              중복 이모지
            </div>
            <h3 className="mt-3 text-lg font-bold text-gray-900">
              이미 등록된 이모지입니다
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              같은 이모지는 이모지 모음에 한 번만 추가할 수 있습니다. 기존
              항목을 수정하거나 다시 활성화해 주세요.
            </p>
            <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="text-2xl leading-none">
                  {duplicateEmojiEntry.emoji}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-gray-900">
                    {duplicateEmojiEntry.label}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {duplicateEmojiEntry.enabled === false
                      ? "현재 비활성 상태로 등록되어 있습니다."
                      : "현재 사용 중인 항목입니다."}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setDuplicateEmojiEntry(null)}
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
