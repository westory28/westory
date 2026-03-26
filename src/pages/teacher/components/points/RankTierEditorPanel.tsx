import React from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import {
  POINT_RANK_BADGE_STYLE_OPTIONS,
  POINT_RANK_CELEBRATION_EFFECT_LABELS,
  POINT_RANK_FIELD_HELPERS,
  POINT_RANK_FIELD_LABELS,
} from "../../../../constants/pointLabels";
import type { PointRankDisplay } from "../../../../lib/pointRanks";
import type {
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
} from "../../../../types";

const inputClassName =
  "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm";
const selectClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm";

const normalizeText = (value: unknown) => String(value || "").trim();
const clampNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

interface RankTierEditorPanelProps {
  canManage: boolean;
  draftRankPolicy: PointRankPolicy;
  validationError: string;
  selectedTierCode: PointRankPolicyTier["code"] | null;
  selectedTier: PointRankPolicyTier | null;
  selectedTierPreview: PointRankDisplay | null;
  enabledEmojiCount: number;
  celebrationPreviewTierLabel: string;
  celebrationPreviewAvailable: boolean;
  onSelectTier: (tierCode: PointRankPolicyTier["code"]) => void;
  onAddTier: () => void;
  onRemoveTier: (tierCode: PointRankPolicyTier["code"]) => void;
  onSetTierField: <K extends keyof PointRankPolicyTier>(
    tierCode: PointRankPolicyTier["code"],
    field: K,
    value: PointRankPolicyTier[K],
  ) => void;
  onSetActiveThemeTierField: (
    tierCode: PointRankPolicyTier["code"],
    field: "label" | "shortLabel" | "description",
    value: string,
  ) => void;
  onToggleTierEmoji: (
    tierCode: PointRankPolicyTier["code"],
    emojiId: string,
  ) => void;
  onCelebrationEnabledChange: (enabled: boolean) => void;
  onCelebrationEffectLevelChange: (effectLevel: "subtle" | "standard") => void;
  onOpenCelebrationPreview: () => void;
  getTierPreview: (
    tier: PointRankPolicyTier,
    themeId?: PointRankThemeId,
  ) => PointRankDisplay | null;
}

const RankTierEditorPanel: React.FC<RankTierEditorPanelProps> = ({
  canManage,
  draftRankPolicy,
  validationError,
  selectedTierCode,
  selectedTier,
  selectedTierPreview,
  enabledEmojiCount,
  celebrationPreviewTierLabel,
  celebrationPreviewAvailable,
  onSelectTier,
  onAddTier,
  onRemoveTier,
  onSetTierField,
  onSetActiveThemeTierField,
  onToggleTierEmoji,
  onCelebrationEnabledChange,
  onCelebrationEffectLevelChange,
  onOpenCelebrationPreview,
  getTierPreview,
}) => (
  <section className="space-y-6">
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.95fr)]">
      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">등급 설정</h2>
            <p className="mt-1 text-sm text-gray-500">
              등급 기준, 이름, 설명, 배지 스타일을 이 탭에서 정리합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddTier}
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
          카드 순서는 편집 중 그대로 유지되고, 기준 포인트 정렬은 저장할 때만
          정리됩니다.
        </div>

        <div className="space-y-3">
          {draftRankPolicy.tiers.map((tier, tierIndex) => {
            const tierPreview = getTierPreview(tier);
            const isOpen = selectedTierCode === tier.code;
            const canDelete = draftRankPolicy.tiers.length > 1;
            const badgeStyleLabel =
              POINT_RANK_BADGE_STYLE_OPTIONS.find(
                (option) => option.value === (tier.badgeStyleToken || "stone"),
              )?.label || String(tier.badgeStyleToken || "stone");

            return (
              <article
                key={tier.code}
                className={[
                  "overflow-hidden rounded-2xl border transition",
                  isOpen
                    ? "border-blue-200 bg-blue-50/40"
                    : "border-gray-200 bg-gray-50",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => onSelectTier(tier.code)}
                  aria-expanded={isOpen}
                  aria-controls={`point-rank-tier-panel-${tier.code}`}
                  className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-white/70"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <PointRankBadge
                          rank={tierPreview}
                          size="sm"
                          showTheme
                        />
                        <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
                          {tier.code}
                        </span>
                        {isOpen && (
                          <span className="rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                            편집 중
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 gap-2 text-sm text-gray-600 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            등급명
                          </div>
                          <div className="mt-1 font-bold text-gray-800">
                            {tierPreview?.label || `등급 ${tierIndex + 1}`}
                          </div>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            기준 포인트
                          </div>
                          <div className="mt-1 font-bold text-gray-800">
                            {tier.minPoints}점 이상
                          </div>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            허용 이모지
                          </div>
                          <div className="mt-1 font-bold text-gray-800">
                            {tier.allowedEmojiIds?.length || 0}개 선택
                          </div>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            배지 스타일
                          </div>
                          <div className="mt-1 font-bold text-gray-800">
                            {badgeStyleLabel}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                      {isOpen ? "접기" : "열기"}
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
                        등급 허용 이모지는 오른쪽에서 설정합니다.
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveTier(tier.code)}
                        disabled={!canManage || !canDelete}
                        className="inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {POINT_RANK_FIELD_LABELS.deleteTier}
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700">
                          {POINT_RANK_FIELD_LABELS.tierThreshold}
                        </div>
                        <input
                          type="number"
                          min="0"
                          value={tier.minPoints}
                          onChange={(event) =>
                            onSetTierField(
                              tier.code,
                              "minPoints",
                              clampNumber(event.target.value, 0),
                            )
                          }
                          className={inputClassName}
                          disabled={!canManage}
                        />
                        <div className="mt-2 text-xs leading-5 text-gray-500">
                          {POINT_RANK_FIELD_HELPERS.tierThreshold}
                        </div>
                      </label>

                      <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700">
                          {POINT_RANK_FIELD_LABELS.badgeStyleToken}
                        </div>
                        <select
                          value={tier.badgeStyleToken || "stone"}
                          onChange={(event) =>
                            onSetTierField(
                              tier.code,
                              "badgeStyleToken",
                              normalizeText(event.target.value) || "stone",
                            )
                          }
                          className={selectClassName}
                          disabled={!canManage}
                        >
                          {POINT_RANK_BADGE_STYLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <div className="mt-2 text-xs leading-5 text-gray-500">
                          {POINT_RANK_FIELD_HELPERS.badgeStyleToken}
                        </div>
                      </label>

                      <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700">
                          {POINT_RANK_FIELD_LABELS.tierLabel}
                        </div>
                        <input
                          value={
                            draftRankPolicy.themes?.[
                              draftRankPolicy.activeThemeId
                            ]?.tiers?.[tier.code]?.label || ""
                          }
                          onChange={(event) =>
                            onSetActiveThemeTierField(
                              tier.code,
                              "label",
                              event.target.value,
                            )
                          }
                          placeholder={
                            tierPreview?.label || `등급 ${tierIndex + 1}`
                          }
                          className={inputClassName}
                          disabled={!canManage}
                        />
                        <div className="mt-2 text-xs leading-5 text-gray-500">
                          {POINT_RANK_FIELD_HELPERS.tierLabel}
                        </div>
                      </label>

                      <label className="block">
                        <div className="mb-2 text-sm font-bold text-gray-700">
                          {POINT_RANK_FIELD_LABELS.tierShortLabel}
                        </div>
                        <input
                          value={
                            draftRankPolicy.themes?.[
                              draftRankPolicy.activeThemeId
                            ]?.tiers?.[tier.code]?.shortLabel || ""
                          }
                          onChange={(event) =>
                            onSetActiveThemeTierField(
                              tier.code,
                              "shortLabel",
                              event.target.value,
                            )
                          }
                          placeholder={
                            tierPreview?.shortLabel ||
                            tierPreview?.label ||
                            `등급 ${tierIndex + 1}`
                          }
                          className={inputClassName}
                          disabled={!canManage}
                        />
                        <div className="mt-2 text-xs leading-5 text-gray-500">
                          {POINT_RANK_FIELD_HELPERS.tierShortLabel}
                        </div>
                      </label>
                    </div>

                    <label className="mt-4 block">
                      <div className="mb-2 text-sm font-bold text-gray-700">
                        {POINT_RANK_FIELD_LABELS.tierDescription}
                      </div>
                      <textarea
                        rows={3}
                        value={
                          draftRankPolicy.themes?.[
                            draftRankPolicy.activeThemeId
                          ]?.tiers?.[tier.code]?.description || ""
                        }
                        onChange={(event) =>
                          onSetActiveThemeTierField(
                            tier.code,
                            "description",
                            event.target.value,
                          )
                        }
                        placeholder={
                          tierPreview?.description || "등급 설명을 입력하세요."
                        }
                        className={inputClassName}
                        disabled={!canManage}
                      />
                      <div className="mt-2 text-xs leading-5 text-gray-500">
                        {POINT_RANK_FIELD_HELPERS.tierDescription}
                      </div>
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>

      <aside className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm xl:sticky xl:top-6 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
        <div className="space-y-2 border-b border-gray-200 pb-4">
          <h3 className="text-base font-bold text-gray-900">등급별 이모지</h3>
          <p className="text-sm text-gray-500">
            선택한 등급에 허용할 이모지를 바로 고릅니다.
          </p>
        </div>

        {!selectedTier && (
          <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-sm leading-6 text-gray-500">
            왼쪽에서 등급을 선택하면 허용 이모지를 편집할 수 있습니다.
          </div>
        )}

        {selectedTier && (
          <div className="space-y-4 pt-4">
            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <PointRankBadge
                  rank={selectedTierPreview}
                  size="sm"
                  showTheme
                />
                <span className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  {selectedTier.code}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-blue-500">
                    등급명
                  </div>
                  <div className="mt-1 font-bold text-gray-900">
                    {selectedTierPreview?.label || selectedTier.code}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedTierPreview?.shortLabel || "약칭 없음"}
                  </div>
                </div>
                <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-blue-500">
                    기준 포인트
                  </div>
                  <div className="mt-1 font-bold text-gray-900">
                    {selectedTier.minPoints}점 이상
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    {selectedTier.allowedEmojiIds?.length || 0}개 선택됨
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  선택 수
                </div>
                <div className="mt-1 text-lg font-bold text-gray-900">
                  {selectedTier.allowedEmojiIds?.length || 0}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  활성 이모지
                </div>
                <div className="mt-1 text-lg font-bold text-gray-900">
                  {enabledEmojiCount}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-5 text-gray-500">
              비활성 이모지는 선택할 수 없습니다.
            </div>

            <div className="grid grid-cols-2 gap-2 md:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))]">
              {draftRankPolicy.emojiRegistry.map((entry) => {
                const checked = (selectedTier.allowedEmojiIds || []).includes(
                  entry.id,
                );
                const disabled = !canManage || entry.enabled === false;
                const assignedTierCode =
                  draftRankPolicy.tiers.find((tier) =>
                    (tier.allowedEmojiIds || []).includes(entry.id),
                  )?.code ||
                  entry.unlockTierCode ||
                  draftRankPolicy.tiers[0]?.code ||
                  "tier_1";
                const assignedTier =
                  draftRankPolicy.tiers.find(
                    (tier) => tier.code === assignedTierCode,
                  ) || null;
                const assignedTierLabel = assignedTier
                  ? getTierPreview(assignedTier)?.label || assignedTier.code
                  : "등급 미지정";

                return (
                  <button
                    key={`${selectedTier.code}-${entry.id}`}
                    type="button"
                    onClick={() =>
                      onToggleTierEmoji(selectedTier.code, entry.id)
                    }
                    disabled={disabled}
                    className={[
                      "rounded-xl border px-3 py-3 text-left transition",
                      checked
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                      entry.enabled === false ? "opacity-50" : "",
                      disabled ? "cursor-not-allowed" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-2xl leading-none">{entry.emoji}</div>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[10px] font-bold",
                          checked
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-500",
                        ].join(" ")}
                      >
                        {checked
                          ? "선택됨"
                          : entry.enabled === false
                            ? "비활성"
                            : "선택 가능"}
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-bold">{entry.label}</div>
                    <div className="mt-2 text-[11px] text-gray-500">
                      {checked
                        ? "배정: 현재 등급"
                        : assignedTier
                          ? `배정: ${assignedTierLabel}`
                          : "미지정"}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-xs leading-5 text-gray-500">
              {draftRankPolicy.tiers[0]?.code === selectedTier.code
                ? "첫 등급에는 기본 이모지가 자동 포함됩니다."
                : "중복 선택은 자동으로 정리됩니다."}
            </div>
          </div>
        )}
      </aside>
    </div>

    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900">축하 팝업</h3>
          <p className="mt-1 text-sm text-gray-500">
            등급 상승 시 보여 줄 축하 팝업의 표시 여부와 강도를 정합니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500">
            {draftRankPolicy.celebrationPolicy.enabled
              ? "축하 팝업 사용 중"
              : "축하 팝업 꺼짐"}
          </div>
          <button
            type="button"
            onClick={onOpenCelebrationPreview}
            disabled={!celebrationPreviewAvailable}
            className="inline-flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            축하 팝업 미리보기
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1fr_220px]">
        <label className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4">
          <div className="pr-4">
            <div className="font-bold text-gray-800">
              {POINT_RANK_FIELD_LABELS.celebrationEnabled}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {POINT_RANK_FIELD_HELPERS.celebrationEnabled}
            </div>
          </div>
          <input
            type="checkbox"
            checked={draftRankPolicy.celebrationPolicy.enabled}
            onChange={(event) =>
              onCelebrationEnabledChange(event.target.checked)
            }
            disabled={!canManage}
            className="h-4 w-4"
          />
        </label>

        <label className="block">
          <div className="mb-2 text-sm font-bold text-gray-700">
            {POINT_RANK_FIELD_LABELS.celebrationEffectLevel}
          </div>
          <select
            value={draftRankPolicy.celebrationPolicy.effectLevel}
            onChange={(event) =>
              onCelebrationEffectLevelChange(
                event.target.value === "subtle" ? "subtle" : "standard",
              )
            }
            className={selectClassName}
            disabled={!canManage}
          >
            <option value="subtle">
              {POINT_RANK_CELEBRATION_EFFECT_LABELS.subtle}
            </option>
            <option value="standard">
              {POINT_RANK_CELEBRATION_EFFECT_LABELS.standard}
            </option>
          </select>
          <div className="mt-2 text-xs leading-5 text-gray-500">
            {POINT_RANK_FIELD_HELPERS.celebrationEffectLevel}
          </div>
        </label>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
        {selectedTier
          ? `${celebrationPreviewTierLabel} 등급 기준으로 현재 테마와 효과를 미리볼 수 있습니다.`
          : `${celebrationPreviewTierLabel} 등급을 샘플로 현재 테마와 효과를 미리봅니다.`}
        {!draftRankPolicy.celebrationPolicy.enabled && (
          <div className="mt-1 text-xs text-gray-500">
            현재 설정에서는 실제 학생 화면에 축하 팝업이 표시되지 않습니다.
          </div>
        )}
      </div>
    </section>
  </section>
);

export default RankTierEditorPanel;
