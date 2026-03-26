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
  "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-50";
const selectClassName =
  "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-50";
const fieldCardClassName =
  "block rounded-2xl border border-gray-200 bg-gray-50/80 p-4";

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
  hasUnsavedChanges: boolean;
  saveFeedbackMessage: string;
  saveFeedbackTone: "success" | "error" | "warning" | null;
  onSave: () => void;
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

const feedbackToneClassName: Record<"success" | "error" | "warning", string> = {
  success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border border-red-200 bg-red-50 text-red-700",
  warning: "border border-amber-200 bg-amber-50 text-amber-800",
};
const tierSummaryChipClassName =
  "inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 whitespace-nowrap";

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
  hasUnsavedChanges,
  saveFeedbackMessage,
  saveFeedbackTone,
  onSave,
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">등급 설정</h2>
          <p className="mt-1 text-sm text-gray-500">
            기준 포인트, 이름, 약칭, 허용 이모지와 축하 팝업을 이 탭에서 저장합니다.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:min-w-[320px] lg:flex-col lg:items-end">
          <button
            type="button"
            onClick={onSave}
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
              ? "등급 설정 변경사항이 저장 대기 중입니다."
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
    </div>

    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.95fr)]">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">등급 목록</h3>
            <p className="mt-1 text-sm text-gray-500">
              등급 기준, 이름, 설명, 배지 스타일을 이 탭에서 정리합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                총 {draftRankPolicy.tiers.length}개
              </span>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                활성 이모지 {enabledEmojiCount}개
              </span>
            </div>
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

        <div className="space-y-4 p-5 sm:p-6">
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
                      ? "border-blue-200 bg-blue-50/40 ring-1 ring-blue-100 shadow-[0_18px_34px_-28px_rgba(37,99,235,0.48)]"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTier(tier.code)}
                    aria-expanded={isOpen}
                    aria-controls={`point-rank-tier-panel-${tier.code}`}
                    className="flex w-full flex-col gap-4 px-5 py-5 text-left transition sm:px-6"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <PointRankBadge rank={tierPreview} size="sm" showTheme />
                      <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-gray-500 whitespace-nowrap">
                        {tier.code}
                      </span>
                      {isOpen && (
                        <span className="rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700 whitespace-nowrap">
                          선택됨
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="max-w-full truncate text-base font-bold text-gray-900 sm:text-lg">
                          {tierPreview?.label || `등급 ${tierIndex + 1}`}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={tierSummaryChipClassName}>
                            기준
                            <span className="ml-1 text-gray-900">
                              {tier.minPoints}점+
                            </span>
                          </span>
                          <span className={tierSummaryChipClassName}>
                            이모지
                            <span className="ml-1 text-gray-900">
                              {tier.allowedEmojiIds?.length || 0}개
                            </span>
                          </span>
                          <span className={tierSummaryChipClassName}>
                            배지
                            <span className="ml-1 text-gray-900">
                              {badgeStyleLabel}
                            </span>
                          </span>
                          {tierPreview?.shortLabel && (
                            <span className={tierSummaryChipClassName}>
                              약칭
                              <span className="ml-1 text-gray-900">
                                {tierPreview.shortLabel}
                              </span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className={[
                          "inline-flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-xs font-bold transition",
                          isOpen
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-white text-gray-600",
                        ].join(" ")}
                      >
                        <span>{isOpen ? "접기" : "상세 설정"}</span>
                        <i
                          className={`fas ${
                            isOpen ? "fa-chevron-up" : "fa-chevron-down"
                          } text-[10px]`}
                          aria-hidden="true"
                        ></i>
                      </div>
                    </div>
                  </button>

                  {isOpen && (
                    <div
                      id={`point-rank-tier-panel-${tier.code}`}
                      className="border-t border-blue-100 bg-white px-5 py-5 sm:px-6"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                          허용 이모지는 오른쪽 패널에서 선택합니다.
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveTier(tier.code)}
                          disabled={!canManage || !canDelete}
                          className="inline-flex items-center justify-center rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {POINT_RANK_FIELD_LABELS.deleteTier}
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <label className={fieldCardClassName}>
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

                        <label className={fieldCardClassName}>
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

                        <label className={fieldCardClassName}>
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

                        <label className={fieldCardClassName}>
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

                      <label className={`${fieldCardClassName} mt-4`}>
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
      </div>

      <aside className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm xl:sticky xl:top-8 xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
        <div className="space-y-2 border-b border-gray-200 px-5 py-5 sm:px-6">
          <h3 className="text-base font-extrabold text-gray-900">등급별 이모지</h3>
          <p className="text-sm text-gray-500">
            선택한 등급에 허용할 이모지를 바로 고릅니다.
          </p>
        </div>

        {!selectedTier && (
          <div className="p-5 sm:p-6">
            <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-10 text-center text-sm leading-6 text-gray-500">
              왼쪽에서 등급을 선택하면 허용 이모지를 편집할 수 있습니다.
            </div>
          </div>
        )}

        {selectedTier && (
          <div className="space-y-4 p-5 sm:p-6">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-4">
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
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  {selectedTierPreview?.label || selectedTier.code}
                </span>
                {selectedTierPreview?.shortLabel && (
                  <span className="inline-flex items-center rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                    약칭 {selectedTierPreview.shortLabel}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  기준 {selectedTier.minPoints}점
                </span>
                <span className="inline-flex items-center rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  선택 {selectedTier.allowedEmojiIds?.length || 0}개
                </span>
                <span className="inline-flex items-center rounded-full border border-white/80 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  활성 {enabledEmojiCount}개
                </span>
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
