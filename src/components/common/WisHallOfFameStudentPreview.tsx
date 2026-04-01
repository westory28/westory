import React, { useMemo } from "react";
import { formatPointDateShortTime } from "../../lib/pointFormatters";
import {
  WIS_HALL_OF_FAME_GRADE_KEY,
  applyHallOfFameRankLimit,
  buildWisHallOfFameClassKey,
  getHallOfFameLeaderboardTailEntries,
  getWisHallOfFameClassEntries,
  getWisHallOfFameClassLeaderboardEntries,
  getWisHallOfFameGradeEntries,
  getWisHallOfFameGradeLeaderboardEntries,
  resolveHallOfFameInterfaceConfig,
} from "../../lib/wisHallOfFame";
import type {
  HallOfFameInterfaceConfig,
  WisHallOfFameSnapshot,
} from "../../types";
import WisHallOfFameLeaderboardList from "./WisHallOfFameLeaderboardList";
import WisHallOfFamePodium from "./WisHallOfFamePodium";

export type HallOfFamePreviewView = "grade" | "class";
export type HallOfFamePreviewDeviceMode = "responsive" | "desktop" | "mobile";

interface WisHallOfFameStudentPreviewProps {
  snapshot: WisHallOfFameSnapshot | null;
  hallOfFameConfig?: HallOfFameInterfaceConfig | null;
  activeView: HallOfFamePreviewView;
  onActiveViewChange: (view: HallOfFamePreviewView) => void;
  gradeKey?: string;
  currentGrade?: string;
  currentClass?: string;
  deviceMode?: HallOfFamePreviewDeviceMode;
  showSnapshotAlert?: boolean;
}

const DEFAULT_RAIL_CENTER = 71;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const normalizeNumberText = (value: unknown) => {
  const raw = String(value || "").trim();
  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const buildStatusText = (snapshot: WisHallOfFameSnapshot | null) => {
  if (!snapshot?.updatedAt) return "화랑의 전당을 준비 중이에요.";
  return `최근 반영 ${formatPointDateShortTime(snapshot.updatedAt)}`;
};

const resolveRailAlignClassName = (leftPercent: number) => {
  if (leftPercent <= 44) return "self-start";
  if (leftPercent >= 56) return "self-end";
  return "self-center";
};

const WisHallOfFameStudentPreview: React.FC<
  WisHallOfFameStudentPreviewProps
> = ({
  snapshot,
  hallOfFameConfig,
  activeView,
  onActiveViewChange,
  gradeKey,
  currentGrade,
  currentClass,
  deviceMode = "responsive",
  showSnapshotAlert = true,
}) => {
  const resolvedConfig = resolveHallOfFameInterfaceConfig(hallOfFameConfig);
  const normalizedGrade = normalizeNumberText(currentGrade);
  const normalizedClass = normalizeNumberText(currentClass);
  const availableGradeKeys = useMemo(
    () =>
      Array.from(
        new Set([
          ...Object.keys(snapshot?.gradeLeaderboardByGrade || {}),
          ...Object.keys(snapshot?.gradeTop3ByGrade || {}),
        ]),
      ).sort((left, right) =>
        left.localeCompare(right, "ko-KR", { numeric: true }),
      ),
    [snapshot],
  );
  const requestedGradeKey = String(gradeKey || "").trim();
  const preferredGradeKey =
    normalizedGrade && availableGradeKeys.includes(normalizedGrade)
      ? normalizedGrade
      : "";
  const previewGradeKey =
    preferredGradeKey ||
    (requestedGradeKey && availableGradeKeys.includes(requestedGradeKey)
      ? requestedGradeKey
      : "") ||
    (snapshot?.primaryGradeKey &&
    availableGradeKeys.includes(snapshot.primaryGradeKey)
      ? snapshot.primaryGradeKey
      : "") ||
    availableGradeKeys[0] ||
    normalizedGrade ||
    WIS_HALL_OF_FAME_GRADE_KEY;
  const classKey = buildWisHallOfFameClassKey(normalizedGrade, normalizedClass);
  const canOpenClassView = Boolean(classKey);
  const effectiveView =
    activeView === "class" && canOpenClassView ? "class" : "grade";

  const gradePodiumEntries = getWisHallOfFameGradeEntries(
    snapshot,
    previewGradeKey,
  );
  const classPodiumEntries = getWisHallOfFameClassEntries(
    snapshot,
    normalizedGrade,
    normalizedClass,
  );
  const gradeLeaderboardEntries = getWisHallOfFameGradeLeaderboardEntries(
    snapshot,
    previewGradeKey,
  );
  const classLeaderboardEntries = getWisHallOfFameClassLeaderboardEntries(
    snapshot,
    normalizedGrade,
    normalizedClass,
  );

  const activePodiumEntries =
    effectiveView === "grade" ? gradePodiumEntries : classPodiumEntries;
  const activeLeaderboardEntries =
    effectiveView === "grade"
      ? gradeLeaderboardEntries
      : classLeaderboardEntries;
  const classTitle =
    normalizedGrade && normalizedClass
      ? `${normalizedGrade}학년 ${normalizedClass}반 랭킹`
      : "우리 학급 랭킹";
  const viewTitle =
    effectiveView === "grade" ? `${previewGradeKey}학년 전교 랭킹` : classTitle;
  const viewScopeLabel =
    effectiveView === "grade"
      ? `전교 ${resolvedConfig.publicRange.gradeRankLimit}위까지 공개`
      : `우리 학급 ${resolvedConfig.publicRange.classRankLimit}위까지 공개`;
  const showTieCaption = resolvedConfig.publicRange.includeTies;
  const appliedRankLimit =
    effectiveView === "grade"
      ? resolvedConfig.publicRange.gradeRankLimit
      : resolvedConfig.publicRange.classRankLimit;
  const visibleLeaderboardEntries = applyHallOfFameRankLimit(
    activeLeaderboardEntries,
    appliedRankLimit,
    showTieCaption,
  );
  const rightRailEntries = getHallOfFameLeaderboardTailEntries(
    visibleLeaderboardEntries,
    3,
  );

  const emptyPodiumMessage =
    effectiveView === "grade"
      ? snapshot
        ? `${previewGradeKey}학년 전교 랭킹을 집계 중이에요.`
        : "화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다."
      : snapshot
        ? "아직 우리 학급 랭킹이 없어요."
        : "우리 학급 랭킹도 잠시 후 다시 표시됩니다.";

  const rightRailEmptyMessage =
    effectiveView === "grade"
      ? "전교 추가 랭킹을 집계 중이에요."
      : "우리 학급 추가 랭킹을 준비 중이에요.";

  const statusText = useMemo(() => buildStatusText(snapshot), [snapshot]);
  const desktopRail = resolvedConfig.leaderboardPanel.desktop;
  const mobileRail = resolvedConfig.leaderboardPanel.mobile;
  const desktopRailWidth = clamp(
    Number(desktopRail.widthPercent || 29),
    23,
    36,
  );
  const desktopPodiumWidth = clamp(100 - desktopRailWidth - 3, 60, 78);
  const desktopRailTop = `${clamp(
    Number(desktopRail.topPercent || 0) / 10,
    0,
    4.5,
  )}rem`;
  const desktopRailShift = `${clamp(
    (Number(desktopRail.leftPercent || DEFAULT_RAIL_CENTER) -
      DEFAULT_RAIL_CENTER) /
      4,
    -2.5,
    2.5,
  )}rem`;
  const mobileRailWidth = `${clamp(
    Number(mobileRail.widthPercent || 100),
    78,
    100,
  )}%`;
  const mobileRailTop = `${clamp(
    Number(mobileRail.topPercent || 0) / 18,
    0,
    1.75,
  )}rem`;
  const mobileRailAlignClassName = resolveRailAlignClassName(
    Number(mobileRail.leftPercent || 50),
  );
  const viewSummary =
    effectiveView === "grade"
      ? `${previewGradeKey}학년 전체 화랑의 전당`
      : canOpenClassView
        ? `${normalizedGrade}학년 ${normalizedClass}반 화랑의 전당`
        : "반 정보가 없어 전교 랭킹만 확인할 수 있어요.";
  const toggleHint = canOpenClassView
    ? "전교 보기와 우리 학급 보기가 시상대와 우측 레일에 함께 반영돼요."
    : "반 정보가 없어서 지금은 전교 랭킹만 볼 수 있어요.";
  const railTitle =
    effectiveView === "grade"
      ? "전교 추가 공개 랭킹"
      : "우리 학급 추가 공개 랭킹";
  const railSubtitle = showTieCaption
    ? "기본은 4위부터 보이고, 같은 순위는 함께 이어서 보여요."
    : "공개 범위 안에서 4위부터 차례대로 보여요.";
  const previewStyle = {
    ["--hall-podium-width" as string]: `${desktopPodiumWidth}%`,
    ["--hall-rail-width" as string]: `${desktopRailWidth}%`,
    ["--hall-rail-desktop-top" as string]: desktopRailTop,
    ["--hall-rail-desktop-shift" as string]: desktopRailShift,
    ["--hall-rail-mobile-width" as string]: mobileRailWidth,
    ["--hall-rail-mobile-top" as string]: mobileRailTop,
  };
  const previewLayoutClassName =
    deviceMode === "desktop"
      ? "flex flex-row items-start justify-between gap-5"
      : deviceMode === "mobile"
        ? "mx-auto flex max-w-[420px] flex-col gap-5"
        : "flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between xl:gap-5";
  const podiumContainerClassName =
    deviceMode === "desktop"
      ? "w-[var(--hall-podium-width)]"
      : deviceMode === "mobile"
        ? "w-full"
        : "w-full xl:w-[var(--hall-podium-width)]";
  const railContainerClassName =
    deviceMode === "desktop"
      ? "mt-[var(--hall-rail-desktop-top)] ml-[var(--hall-rail-desktop-shift)] min-w-[18rem] w-[var(--hall-rail-width)]"
      : deviceMode === "mobile"
        ? `mt-[var(--hall-rail-mobile-top)] w-full max-w-[var(--hall-rail-mobile-width)] ${mobileRailAlignClassName}`
        : `mt-[var(--hall-rail-mobile-top)] w-full sm:max-w-[var(--hall-rail-mobile-width)] xl:mt-[var(--hall-rail-desktop-top)] xl:ml-[var(--hall-rail-desktop-shift)] xl:min-w-[18rem] xl:w-[var(--hall-rail-width)] xl:max-w-none ${mobileRailAlignClassName}`;
  const podiumDeviceMode =
    deviceMode === "responsive" ? "responsive" : deviceMode;

  return (
    <div className="space-y-5" style={previewStyle}>
      {showSnapshotAlert && !snapshot && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-900">
          화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다.
        </div>
      )}

      <div className="rounded-[1.75rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_48px_rgba(15,23,42,0.06)] sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-[11px] font-black tracking-[0.16em] text-amber-600">
              HALL OF FAME
            </div>
            <h2 className="mt-2 text-xl font-black text-slate-900 sm:text-2xl">
              {viewTitle}
            </h2>
            <p className="mt-2 break-keep text-sm text-slate-500">
              누적 획득 위스 기준으로 화랑의 전당이 반영돼요.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-white">
                {viewScopeLabel}
              </span>
              {showTieCaption && (
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                  동점자는 함께 공개
                </span>
              )}
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                {statusText}
              </span>
            </div>
          </div>

          <div className="inline-flex w-full rounded-full bg-slate-100 p-1 sm:w-auto">
            <button
              type="button"
              onClick={() => onActiveViewChange("grade")}
              className={`min-h-11 flex-1 rounded-full px-4 py-2 text-left text-sm font-black transition sm:min-w-[156px] ${
                effectiveView === "grade"
                  ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.16)]"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <span className="block whitespace-nowrap break-keep">
                전교 랭킹 보기
              </span>
              <span
                className={`mt-0.5 block text-[11px] font-semibold ${
                  effectiveView === "grade" ? "text-white/72" : "text-slate-500"
                }`}
              >
                {previewGradeKey}학년 전체
              </span>
            </button>
            <button
              type="button"
              onClick={() => canOpenClassView && onActiveViewChange("class")}
              disabled={!canOpenClassView}
              className={`min-h-11 flex-1 rounded-full px-4 py-2 text-left text-sm font-black transition sm:min-w-[156px] ${
                effectiveView === "class"
                  ? "bg-white text-slate-900 shadow-[0_10px_20px_rgba(15,23,42,0.08)]"
                  : canOpenClassView
                    ? "text-slate-600 hover:text-slate-900"
                    : "cursor-not-allowed text-slate-400"
              }`}
            >
              <span className="block whitespace-nowrap break-keep">
                우리 학급 보기
              </span>
              <span
                className={`mt-0.5 block text-[11px] font-semibold ${
                  effectiveView === "class"
                    ? "text-slate-500"
                    : canOpenClassView
                      ? "text-slate-500"
                      : "text-slate-400"
                }`}
              >
                {canOpenClassView
                  ? `${normalizedGrade}학년 ${normalizedClass}반`
                  : "반 정보 확인 중"}
              </span>
            </button>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold text-slate-600 break-keep">
            {viewSummary}
          </p>
          <p className="break-keep">{toggleHint}</p>
        </div>
      </div>

      <div className="rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,251,235,0.9),_rgba(248,250,252,0.98)_42%,_rgba(255,255,255,1)_100%)] p-4 shadow-[0_22px_54px_rgba(15,23,42,0.08)] sm:p-5 xl:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
            현재 보기
          </span>
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1.5 text-white shadow-[0_8px_18px_rgba(15,23,42,0.14)]">
            {effectiveView === "grade"
              ? `${previewGradeKey}학년 전교`
              : canOpenClassView
                ? `${normalizedGrade}학년 ${normalizedClass}반`
                : "전교"}
          </span>
          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-white/80 px-3 py-1.5 text-slate-500">
            좌측 시상대 + 우측 공개 랭킹
          </span>
        </div>

        <div className={previewLayoutClassName}>
          <div className={podiumContainerClassName}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <p className="text-[11px] font-black tracking-[0.14em] text-amber-600">
                  PODIUM
                </p>
                <p className="mt-1 break-keep text-sm font-bold text-slate-600">
                  1위부터 3위까지 시상대에 올라와요.
                </p>
              </div>
            </div>
            <WisHallOfFamePodium
              title={viewTitle}
              subtitle={
                effectiveView === "grade"
                  ? `${previewGradeKey}학년 전교 시상대`
                  : "우리 학급 시상대"
              }
              entries={activePodiumEntries}
              hallOfFameConfig={resolvedConfig}
              emptyMessage={emptyPodiumMessage}
              showHeader={false}
              deviceMode={podiumDeviceMode}
            />
          </div>

          <div className={railContainerClassName}>
            <div className="mb-3 flex items-center justify-between px-1">
              <div>
                <p className="text-[11px] font-black tracking-[0.14em] text-sky-700">
                  OPEN RANKING
                </p>
                <p className="mt-1 break-keep text-sm font-bold text-slate-600">
                  우측 레일에서 4위 이후 순위를 이어서 확인해요.
                </p>
              </div>
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
                {rightRailEntries.length > 0
                  ? `${rightRailEntries[0].rank}위부터`
                  : "4위부터"}
              </span>
            </div>

            <div className="min-h-[25rem] sm:min-h-[28rem] xl:min-h-[31rem] xl:max-h-[min(52rem,calc(100vh-12rem))]">
              <WisHallOfFameLeaderboardList
                entries={rightRailEntries}
                hallOfFameConfig={resolvedConfig}
                title={railTitle}
                subtitle={railSubtitle}
                emptyMessage={rightRailEmptyMessage}
                className="h-full"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WisHallOfFameStudentPreview;
