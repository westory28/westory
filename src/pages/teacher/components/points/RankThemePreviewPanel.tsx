import React from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import {
  POINT_RANK_THEME_DETAIL_LABELS,
  POINT_RANK_THEME_LABELS,
} from "../../../../constants/pointLabels";
import type { PointRankDisplay } from "../../../../lib/pointRanks";
import type {
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
} from "../../../../types";

const selectClassName =
  "w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm";

interface RankThemePreviewPanelProps {
  canManage: boolean;
  draftRankPolicy: PointRankPolicy;
  activeThemeName: string;
  previewThemeId: PointRankThemeId;
  previewThemeName: string;
  enabledEmojiCount: number;
  onThemeChange: (themeId: PointRankThemeId) => void;
  getTierPreview: (
    tier: PointRankPolicyTier,
    themeId?: PointRankThemeId,
  ) => PointRankDisplay | null;
}

const RankThemePreviewPanel: React.FC<RankThemePreviewPanelProps> = ({
  canManage,
  draftRankPolicy,
  activeThemeName,
  previewThemeId,
  previewThemeName,
  enabledEmojiCount,
  onThemeChange,
  getTierPreview,
}) => {
  const compareThemes: Array<{
    themeId: PointRankThemeId;
    label: string;
    name: string;
    chipTone: string;
    isPrimary: boolean;
  }> = [
    {
      themeId: draftRankPolicy.activeThemeId,
      label: "현재 활성 테마",
      name: activeThemeName,
      chipTone: "border-blue-200 bg-blue-50 text-blue-700",
      isPrimary: true,
    },
    {
      themeId: previewThemeId,
      label: "비교 미리보기",
      name: previewThemeName,
      chipTone: "border-gray-200 bg-gray-100 text-gray-600",
      isPrimary: false,
    },
  ];

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">테마 미리보기</h2>
            <p className="mt-1 text-sm text-gray-500">
              현재 저장 대상 테마를 중심으로 등급 감각을 비교합니다.
            </p>
          </div>
          <div className="grid gap-2 lg:min-w-[380px] lg:grid-cols-[minmax(0,1fr)_200px]">
            <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
              <label className="block">
                <div className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  현재 활성 테마
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-blue-200 bg-white px-2.5 py-0.5 text-[11px] font-bold text-blue-700">
                    저장 대상
                  </span>
                  <span className="text-sm font-bold text-gray-800">
                    {activeThemeName}
                  </span>
                </div>
                <select
                  value={draftRankPolicy.activeThemeId}
                  onChange={(event) =>
                    onThemeChange(
                      event.target.value === "world_nobility"
                        ? "world_nobility"
                        : "korean_golpum",
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
                비교 미리보기
              </div>
              <div className="mt-1 text-sm font-bold text-gray-700">
                {previewThemeName}
              </div>
              <div className="mt-1 text-xs text-gray-500">보조 비교용</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.85fr)]">
        {compareThemes.map((theme) => (
          <article
            key={theme.themeId}
            className={[
              "border transition",
              theme.isPrimary
                ? "rounded-3xl border-blue-200 bg-gradient-to-br from-blue-50 via-white to-slate-50 p-6 shadow-[0_18px_40px_-32px_rgba(37,99,235,0.55)] ring-1 ring-blue-100"
                : "rounded-2xl border-gray-200 bg-gray-50/80 p-4",
            ].join(" ")}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <div
                  className={[
                    "inline-flex rounded-full border px-3 py-1 text-xs font-bold",
                    theme.isPrimary
                      ? "border-blue-200 bg-white text-blue-700"
                      : "border-gray-200 bg-white text-gray-600",
                  ].join(" ")}
                >
                  {theme.isPrimary ? "현재 저장 대상" : "비교용 미리보기"}
                </div>
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-gray-500">
                    {theme.label}
                  </div>
                  <h3
                    className={
                      theme.isPrimary
                        ? "mt-1 text-xl font-bold text-gray-900"
                        : "mt-1 text-lg font-bold text-gray-800"
                    }
                  >
                    {theme.name}
                  </h3>
                  <p
                    className={
                      theme.isPrimary
                        ? "mt-2 text-sm text-blue-700"
                        : "mt-2 text-sm text-gray-500"
                    }
                  >
                    {theme.isPrimary
                      ? "저장 버튼을 누르면 이 테마 설정이 학생 화면에 반영됩니다."
                      : "이름과 등급 감각만 가볍게 비교합니다."}
                  </p>
                </div>
              </div>
              <div
                className={`rounded-full border px-3 py-1 text-xs font-bold ${theme.chipTone}`}
              >
                {POINT_RANK_THEME_LABELS[theme.themeId]}
              </div>
            </div>

            {theme.isPrimary && (
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  등급 {draftRankPolicy.tiers.length}개
                </div>
                <div className="rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                  활성 이모지 {enabledEmojiCount}개
                </div>
              </div>
            )}

            <div
              className={
                theme.isPrimary ? "mt-4 space-y-3" : "mt-4 space-y-2.5"
              }
            >
              {draftRankPolicy.tiers.map((tier) => {
                const previewRank = getTierPreview(tier, theme.themeId);

                return (
                  <div
                    key={`${theme.themeId}-${tier.code}`}
                    className={
                      theme.isPrimary
                        ? "rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-sm"
                        : "rounded-xl border border-gray-200 bg-white/70 px-3 py-2.5"
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <PointRankBadge rank={previewRank} size="sm" showTheme />
                      <span className="text-xs font-bold uppercase tracking-wide text-gray-500">
                        {tier.code}
                      </span>
                    </div>
                    <div
                      className={
                        theme.isPrimary
                          ? "mt-2 text-sm text-gray-600"
                          : "mt-2 text-xs font-medium text-gray-500"
                      }
                    >
                      기준 포인트 {tier.minPoints}점 이상
                    </div>
                    <div
                      className={
                        theme.isPrimary
                          ? "mt-1 text-xs leading-5 text-gray-500"
                          : "mt-1 text-[11px] leading-5 text-gray-500"
                      }
                    >
                      {previewRank?.description || "등급 설명이 표시됩니다."}
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
