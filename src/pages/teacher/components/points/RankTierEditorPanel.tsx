import React, { useMemo } from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import {
  POINT_RANK_BADGE_STYLE_OPTIONS,
  POINT_RANK_FIELD_HELPERS,
  POINT_RANK_FIELD_LABELS,
} from "../../../../constants/pointLabels";
import { formatWisAmount } from "../../../../lib/pointFormatters";
import type { PointRankDisplay } from "../../../../lib/pointRanks";
import type {
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
} from "../../../../types";

const inputClassName =
  "w-full min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-50";
const fieldCardClassName =
  "block rounded-2xl border border-gray-200 bg-gray-50/80 p-4";
const tierSummaryChipClassName =
  "inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 whitespace-nowrap";
const tierActionButtonClassName =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const tierSummaryActionButtonClassName =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition whitespace-nowrap";

const clampNumber = (value: unknown, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const badgeStyleOptionMap = new Map(
  POINT_RANK_BADGE_STYLE_OPTIONS.map((option) => [option.value, option]),
);

interface RankTierEditorPanelProps {
  canManage: boolean;
  draftRankPolicy: PointRankPolicy;
  activeThemeId: PointRankThemeId;
  draftTiers: PointRankPolicyTier[];
  draftThemes?: PointRankPolicy["themes"];
  validationError: string;
  selectedTierCode: PointRankPolicyTier["code"] | null;
  enabledEmojiCount: number;
  hasUnsavedChanges: boolean;
  saveFeedbackMessage: string;
  saveFeedbackTone: "success" | "error" | "warning" | null;
  onSave: () => void;
  onSelectTier: (tierCode: PointRankPolicyTier["code"]) => void;
  onAddTier: () => void;
  onRemoveTier: (tierCode: PointRankPolicyTier["code"]) => void;
  onPreviewCelebration: (tierCode: PointRankPolicyTier["code"]) => void;
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

const RankTierEditorPanel: React.FC<RankTierEditorPanelProps> = ({
  canManage,
  draftRankPolicy,
  activeThemeId,
  draftTiers,
  draftThemes,
  validationError,
  selectedTierCode,
  enabledEmojiCount,
  hasUnsavedChanges,
  saveFeedbackMessage,
  saveFeedbackTone,
  onSave,
  onSelectTier,
  onAddTier,
  onRemoveTier,
  onPreviewCelebration,
  onSetTierField,
  onSetActiveThemeTierField,
  onToggleTierEmoji,
  getTierPreview,
}) => {
  const displayTiers = useMemo(
    () =>
      [...draftTiers]
        .map((tier, index) => ({ tier, index }))
        .sort((left, right) => {
          const thresholdDiff =
            Number(right.tier.minPoints || 0) -
            Number(left.tier.minPoints || 0);
          return thresholdDiff !== 0 ? thresholdDiff : left.index - right.index;
        })
        .map(({ tier }) => tier),
    [draftTiers],
  );

  return (
    <section className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-gray-900">설정</h2>
            <p className="mt-1 text-sm text-gray-500">
              등급 카드를 펼쳐 이름, 기준 위스, 설명과 이모지 연결까지 한 번에
              정리합니다.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:min-w-[320px] lg:flex-col lg:items-end">
            <button
              type="button"
              onClick={onSave}
              disabled={!canManage || Boolean(validationError)}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              등급 관리 저장
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
                ? "등급 관리 변경사항이 저장 대기 중입니다."
                : "저장된 등급 관리와 같습니다."}
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

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">등급 목록</h3>
            <p className="mt-1 text-sm text-gray-500">
              높은 등급부터 보면서 이름, 기준 위스, 설명, 허용 이모지를
              정리합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">
                총 {draftRankPolicy.tiers.length}개
              </span>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 whitespace-nowrap">
                활성 이모지 {enabledEmojiCount}개
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onAddTier}
            disabled={!canManage}
            className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
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
            표시는 높은 등급부터 보이지만, 저장할 때는 기준 위스값으로
            정렬됩니다.
          </div>

          <div className="space-y-3">
            {displayTiers.map((tier, tierIndex) => {
              const tierPreview = getTierPreview(tier);
              const isOpen = selectedTierCode === tier.code;
              const selectedEmojiIds = new Set(tier.allowedEmojiIds || []);
              const badgeStyleOption =
                badgeStyleOptionMap.get(tier.badgeStyleToken || "stone") ||
                badgeStyleOptionMap.get("stone");
              const badgeStyleLabel =
                badgeStyleOption?.label ||
                String(tier.badgeStyleToken || "stone");

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
                  <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
                    <button
                      type="button"
                      onClick={() => onSelectTier(tier.code)}
                      aria-expanded={isOpen}
                      aria-controls={`point-rank-tier-panel-${tier.code}`}
                      className="min-w-0 flex-1 text-left transition"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <PointRankBadge
                          rank={tierPreview}
                          size="sm"
                          showTheme
                        />
                        {tierIndex === 0 && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 whitespace-nowrap">
                            최상위 등급
                          </span>
                        )}
                        {isOpen && (
                          <span className="rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700 whitespace-nowrap">
                            선택됨
                          </span>
                        )}
                      </div>

                      <div className="mt-4 min-w-0">
                        <div className="max-w-full truncate text-base font-bold text-gray-900 sm:text-lg">
                          {tierPreview?.label || `등급 ${tierIndex + 1}`}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={tierSummaryChipClassName}>
                            기준
                            <span className="ml-1 text-gray-900">
                              {formatWisAmount(tier.minPoints)}
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
                            <span
                              className={[
                                "ml-1 h-3.5 w-3.5 shrink-0 rounded-full",
                                badgeStyleOption?.swatchClassName ||
                                  "bg-stone-500",
                              ].join(" ")}
                              aria-hidden="true"
                              title={badgeStyleLabel}
                            ></span>
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
                    </button>

                    <div className="flex shrink-0 items-center justify-end gap-2 self-start whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onPreviewCelebration(tier.code)}
                        className={`${tierSummaryActionButtonClassName} border-gray-200 bg-white text-gray-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700`}
                      >
                        <i
                          className="fas fa-sparkles text-[11px]"
                          aria-hidden="true"
                        ></i>
                        <span>미리보기</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectTier(tier.code)}
                        aria-expanded={isOpen}
                        aria-controls={`point-rank-tier-panel-${tier.code}`}
                        className={`${tierSummaryActionButtonClassName} ${isOpen ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-white"}`}
                      >
                        <span>상세 설정</span>
                        <i
                          className={`fas ${isOpen ? "fa-chevron-up" : "fa-chevron-down"} text-[10px]`}
                          aria-hidden="true"
                        ></i>
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div
                      id={`point-rank-tier-panel-${tier.code}`}
                      className="border-t border-blue-100 bg-white px-5 py-5 sm:px-6"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 whitespace-nowrap">
                            상세 설정 + 허용 이모지
                          </span>
                          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 whitespace-nowrap">
                            활성 {enabledEmojiCount}개
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2.5">
                          <button
                            type="button"
                            onClick={() => onRemoveTier(tier.code)}
                            disabled={
                              !canManage || draftRankPolicy.tiers.length <= 1
                            }
                            className={`${tierActionButtonClassName} border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}
                          >
                            {POINT_RANK_FIELD_LABELS.deleteTier}
                          </button>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(272px,0.88fr)] xl:items-start">
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
                              <div>
                                <div className="flex flex-wrap gap-2.5">
                                  {POINT_RANK_BADGE_STYLE_OPTIONS.map(
                                    (option) => {
                                      const isSelected =
                                        option.value ===
                                        (tier.badgeStyleToken || "stone");
                                      return (
                                        <button
                                          key={`${tier.code}-${option.value}`}
                                          type="button"
                                          onClick={() =>
                                            onSetTierField(
                                              tier.code,
                                              "badgeStyleToken",
                                              String(
                                                option.value,
                                              ) as PointRankPolicyTier["badgeStyleToken"],
                                            )
                                          }
                                          disabled={!canManage}
                                          className={[
                                            "inline-flex h-11 w-11 items-center justify-center rounded-full border-2 bg-white transition",
                                            isSelected
                                              ? "border-gray-900 ring-2 ring-blue-200 ring-offset-2"
                                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50",
                                            !canManage
                                              ? "cursor-not-allowed opacity-60"
                                              : "",
                                          ]
                                            .filter(Boolean)
                                            .join(" ")}
                                          aria-pressed={isSelected}
                                          aria-label={option.label}
                                          title={option.label}
                                        >
                                          <span
                                            className={[
                                              "h-5 w-5 shrink-0 rounded-full",
                                              option.swatchClassName,
                                            ].join(" ")}
                                            aria-hidden="true"
                                          ></span>
                                        </button>
                                      );
                                    },
                                  )}
                                </div>
                              </div>
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
                                  draftThemes?.[activeThemeId]?.tiers?.[
                                    tier.code
                                  ]?.label || ""
                                }
                                onChange={(event) =>
                                  onSetActiveThemeTierField(
                                    tier.code,
                                    "label",
                                    event.target.value,
                                  )
                                }
                                placeholder={tierPreview?.label || "등급 이름"}
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
                                  draftThemes?.[activeThemeId]?.tiers?.[
                                    tier.code
                                  ]?.shortLabel || ""
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
                                  "약칭"
                                }
                                className={inputClassName}
                                disabled={!canManage}
                              />
                              <div className="mt-2 text-xs leading-5 text-gray-500">
                                {POINT_RANK_FIELD_HELPERS.tierShortLabel}
                              </div>
                            </label>
                          </div>

                          <label className={fieldCardClassName}>
                            <div className="mb-2 text-sm font-bold text-gray-700">
                              {POINT_RANK_FIELD_LABELS.tierDescription}
                            </div>
                            <textarea
                              rows={3}
                              value={
                                draftThemes?.[activeThemeId]?.tiers?.[tier.code]
                                  ?.description || ""
                              }
                              onChange={(event) =>
                                onSetActiveThemeTierField(
                                  tier.code,
                                  "description",
                                  event.target.value,
                                )
                              }
                              placeholder={
                                tierPreview?.description ||
                                "등급 설명을 입력하세요."
                              }
                              className={inputClassName}
                              disabled={!canManage}
                            />
                            <div className="mt-2 text-xs leading-5 text-gray-500">
                              {POINT_RANK_FIELD_HELPERS.tierDescription}
                            </div>
                          </label>
                        </div>

                        <aside className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 sm:p-5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-extrabold text-gray-900">
                                허용 이모지
                              </h4>
                              <p className="mt-1 text-xs text-gray-500">
                                선택 {tier.allowedEmojiIds?.length || 0}개
                              </p>
                            </div>
                            <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-bold text-gray-500 whitespace-nowrap">
                              비활성 자동 잠금
                            </span>
                          </div>
                          {draftRankPolicy.emojiRegistry.length === 0 ? (
                            <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-sm leading-6 text-gray-500">
                              등록된 이모지가 없습니다.
                            </div>
                          ) : (
                            <div className="mt-4 grid grid-cols-4 justify-items-center gap-x-4 gap-y-4 px-2">
                              {draftRankPolicy.emojiRegistry.map((entry) => {
                                const checked = selectedEmojiIds.has(entry.id);
                                const disabled =
                                  !canManage || entry.enabled === false;
                                return (
                                  <button
                                    key={`${tier.code}-${entry.id}`}
                                    type="button"
                                    onClick={() =>
                                      onToggleTierEmoji(tier.code, entry.id)
                                    }
                                    disabled={disabled}
                                    aria-pressed={checked}
                                    title={entry.label}
                                    className={[
                                      "relative flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border text-[1.02rem] leading-none transition",
                                      checked
                                        ? "border-blue-200 bg-blue-50 text-blue-700"
                                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                                      entry.enabled === false
                                        ? "border-gray-200 bg-gray-100 text-gray-300"
                                        : "",
                                      disabled ? "cursor-not-allowed" : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" ")}
                                  >
                                    <span>{entry.emoji}</span>
                                    <span
                                      className={[
                                        "absolute right-0.5 top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border text-[7px]",
                                        checked
                                          ? "border-blue-600 bg-blue-600 text-white"
                                          : "border-gray-300 bg-white text-transparent",
                                      ].join(" ")}
                                      aria-hidden="true"
                                    >
                                      <i
                                        className="fas fa-check"
                                        aria-hidden="true"
                                      ></i>
                                    </span>
                                    <span
                                      className={[
                                        "absolute bottom-0.5 left-0.5 inline-flex h-2 w-2 rounded-full",
                                        entry.enabled === false
                                          ? "bg-gray-300"
                                          : "bg-emerald-400",
                                      ].join(" ")}
                                      aria-hidden="true"
                                    ></span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-3 text-[11px] leading-5 text-gray-500">
                            첫 등급 기본 이모지 포함, 중복 선택은 자동
                            정리됩니다.
                          </div>
                        </aside>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default RankTierEditorPanel;
