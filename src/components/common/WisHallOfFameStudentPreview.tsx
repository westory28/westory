import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { buildHallOfFamePreviewLayout } from "../../lib/wisHallOfFameLayout";
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

const SPLIT_LAYOUT_MIN_WIDTH = 1180;

const readElementWidth = (element: HTMLElement | null) =>
  Math.max(0, Math.round(element?.getBoundingClientRect().width || 0));

const normalizeNumberText = (value: unknown) => {
  const raw = String(value || "").trim();
  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
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
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(0);
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

  const desktopRail = resolvedConfig.leaderboardPanel.desktop;
  const mobileRail = resolvedConfig.leaderboardPanel.mobile;
  const usesSplitLayout =
    deviceMode === "desktop" ||
    (deviceMode === "responsive" && previewWidth >= SPLIT_LAYOUT_MIN_WIDTH);
  const usesStackedLayout =
    deviceMode === "mobile" ||
    (deviceMode === "responsive" && !usesSplitLayout);

  useEffect(() => {
    const rootElement = previewRootRef.current;
    if (!rootElement) return undefined;

    const updateWidth = () => {
      const nextWidth = readElementWidth(rootElement);
      setPreviewWidth((previousWidth) =>
        previousWidth === nextWidth ? previousWidth : nextWidth,
      );
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(rootElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  const {
    previewStyle,
    mobileRailAlignClassName,
    desktopRailJustifyClassName,
  } = buildHallOfFamePreviewLayout(desktopRail, mobileRail);
  const railTitle =
    effectiveView === "grade" ? "4위부터 10위까지" : "학급 4위부터 10위까지";
  const railSubtitle = showTieCaption
    ? "동점자는 같은 순위로 함께 표시돼요."
    : "공개 범위 안에서 차례대로 보여요.";
  const previewLayoutClassName = usesSplitLayout
    ? "grid grid-cols-[minmax(0,1fr)_minmax(18rem,var(--hall-rail-desktop-track))] items-start gap-5 overflow-visible xl:gap-6"
    : "mx-auto flex w-full max-w-[420px] flex-col gap-5 overflow-visible sm:max-w-none";
  const podiumContainerClassName = usesSplitLayout
    ? "min-w-0 self-start overflow-visible"
    : "min-w-0 w-full overflow-visible";
  const railContainerClassName = usesSplitLayout
    ? `relative z-10 mt-[var(--hall-rail-desktop-top)] w-[var(--hall-rail-desktop-track)] max-w-full translate-x-[var(--hall-rail-desktop-nudge)] self-start ${desktopRailJustifyClassName}`
    : `relative z-10 mt-[var(--hall-rail-mobile-top)] min-w-0 w-full max-w-[var(--hall-rail-mobile-width)] ${mobileRailAlignClassName}`;
  const podiumDeviceMode =
    deviceMode === "responsive"
      ? usesStackedLayout
        ? "mobile"
        : "desktop"
      : deviceMode;

  return (
    <div ref={previewRootRef} className="space-y-3" style={previewStyle}>
      {showSnapshotAlert && !snapshot && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm font-semibold text-amber-900">
          화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다.
        </div>
      )}

      <div className="flex justify-start sm:justify-end">
        <div className="inline-flex w-full rounded-full border border-slate-200 bg-slate-100 p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => onActiveViewChange("grade")}
            className={`min-h-11 flex-1 rounded-full px-4 py-2 text-center text-sm font-black transition sm:min-w-[164px] ${
              effectiveView === "grade"
                ? "bg-slate-900 text-white shadow-[0_10px_20px_rgba(15,23,42,0.16)]"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span className="block whitespace-nowrap break-keep">
              {previewGradeKey}학년 전교 랭킹
            </span>
          </button>
          <button
            type="button"
            onClick={() => canOpenClassView && onActiveViewChange("class")}
            disabled={!canOpenClassView}
            className={`min-h-11 flex-1 rounded-full px-4 py-2 text-center text-sm font-black transition sm:min-w-[156px] ${
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
          </button>
        </div>
      </div>

      <div className="overflow-visible rounded-[1.5rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(255,251,235,0.72),_rgba(248,250,252,0.98)_38%,_rgba(255,255,255,1)_100%)] p-3 shadow-[0_16px_38px_rgba(15,23,42,0.07)] sm:p-4 xl:p-5">
        <div className={previewLayoutClassName}>
          <div className={podiumContainerClassName}>
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
            <div className="min-h-[14rem] sm:min-h-[15.5rem] lg:min-h-[17.5rem]">
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
