import React, { useEffect, useRef, useState } from "react";
import { formatWisAmount } from "../../lib/pointFormatters";
import {
  DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
  getDefaultHallOfFamePositions,
  normalizeHallOfFameInterfaceConfig,
} from "../../lib/wisHallOfFame";
import type {
  HallOfFameInterfaceConfig,
  HallOfFamePodiumPositions,
  HallOfFamePodiumSlotKey,
  WisHallOfFameEntry,
} from "../../types";

interface WisHallOfFamePodiumProps {
  entries?: WisHallOfFameEntry[] | null;
  hallOfFameConfig?: HallOfFameInterfaceConfig | null;
  imageUrl?: string;
  emptyMessage?: string;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  showHeader?: boolean;
  deviceMode?: "responsive" | "desktop" | "mobile";
  slotControls?: Partial<
    Record<
      HallOfFamePodiumSlotKey,
      {
        active?: boolean;
        disabled?: boolean;
        dragLabel?: string;
        onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
        onClick?: () => void;
      }
    >
  >;
}

const SLOT_ORDER: HallOfFamePodiumSlotKey[] = ["second", "first", "third"];

type SlotLayoutMode = "desktop" | "mobile";

const DESKTOP_PODIUM_SCALE_BOUNDS = {
  baselineWidth: 860,
  min: 0.72,
  max: 1,
} as const;

const MOBILE_PODIUM_SCALE_BOUNDS = {
  baselineWidth: 420,
  min: 0.8,
  max: 0.98,
} as const;

const SLOT_SAFE_AREA = {
  desktop: {
    centerRangePercentBySlot: {
      first: { min: 44, max: 56 },
      second: { min: 25, max: 38 },
      third: { min: 62, max: 74 },
    },
    topPercentRangeBySlot: {
      first: { min: 12, max: 42 },
      second: { min: 20, max: 56 },
      third: { min: 20, max: 56 },
    },
    widthPercentBySlot: {
      first: { min: 19, max: 22 },
      second: { min: 15, max: 18.5 },
      third: { min: 15, max: 18.5 },
    },
  },
  mobile: {
    centerRangePercentBySlot: {
      first: { min: 43, max: 57 },
      second: { min: 26, max: 39 },
      third: { min: 61, max: 74 },
    },
    topPercentRangeBySlot: {
      first: { min: 16, max: 48 },
      second: { min: 26, max: 60 },
      third: { min: 26, max: 60 },
    },
    widthPercentBySlot: {
      first: { min: 24, max: 29 },
      second: { min: 18, max: 21.5 },
      third: { min: 18, max: 21.5 },
    },
  },
} as const;

const getEntryTone = (slotKey: HallOfFamePodiumSlotKey) => {
  if (slotKey === "first") {
    return {
      badgeClassName:
        "border-amber-300/95 bg-white text-amber-950 shadow-[0_20px_38px_rgba(217,119,6,0.3)] ring-2 ring-amber-300/75",
      nameClassName:
        "border-white/20 bg-[linear-gradient(135deg,_rgba(2,6,23,0.94),_rgba(15,23,42,0.84))] text-white shadow-[0_22px_40px_rgba(15,23,42,0.34)] ring-1 ring-white/12",
      scoreClassName:
        "border-white/30 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.96))] text-white shadow-[0_18px_34px_rgba(15,23,42,0.28)] ring-1 ring-white/15",
      emojiClassName: "text-[3.55rem]",
    };
  }

  if (slotKey === "second") {
    return {
      badgeClassName:
        "border-slate-200/95 bg-slate-50 text-slate-950 shadow-[0_16px_30px_rgba(71,85,105,0.24)] ring-1 ring-white/80",
      nameClassName:
        "border-white/20 bg-[linear-gradient(135deg,_rgba(2,6,23,0.92),_rgba(15,23,42,0.82))] text-white shadow-[0_18px_34px_rgba(15,23,42,0.32)] ring-1 ring-white/12",
      scoreClassName:
        "border-white/25 bg-[linear-gradient(135deg,_rgba(15,23,42,0.94),_rgba(51,65,85,0.94))] text-white shadow-[0_16px_30px_rgba(15,23,42,0.26)] ring-1 ring-white/15",
      emojiClassName: "text-[2.95rem]",
    };
  }

  return {
    badgeClassName:
      "border-orange-200/95 bg-orange-100 text-orange-950 shadow-[0_16px_30px_rgba(194,120,3,0.24)] ring-1 ring-white/80",
    nameClassName:
      "border-white/20 bg-[linear-gradient(135deg,_rgba(2,6,23,0.92),_rgba(30,41,59,0.8))] text-white shadow-[0_18px_34px_rgba(15,23,42,0.32)] ring-1 ring-white/12",
    scoreClassName:
      "border-white/30 bg-[linear-gradient(135deg,_rgba(30,41,59,0.94),_rgba(194,65,12,0.92))] text-white shadow-[0_16px_30px_rgba(15,23,42,0.24)] ring-1 ring-white/15",
    emojiClassName: "text-[2.95rem]",
  };
};

const resolveSlotEntries = (entries: WisHallOfFameEntry[]) => {
  const slotEntries = new Map<HallOfFamePodiumSlotKey, WisHallOfFameEntry[]>();
  entries.forEach((entry) => {
    const podiumSlot = entry.podiumSlot || entry.rank;
    if (podiumSlot === 1) {
      slotEntries.set("first", [...(slotEntries.get("first") || []), entry]);
    }
    if (podiumSlot === 2) {
      slotEntries.set("second", [...(slotEntries.get("second") || []), entry]);
    }
    if (podiumSlot === 3) {
      slotEntries.set("third", [...(slotEntries.get("third") || []), entry]);
    }
  });
  return slotEntries;
};

const readElementWidth = (element: HTMLElement | null) =>
  Math.max(0, Math.round(element?.getBoundingClientRect().width || 0));

const buildSlotStyle = (
  slotKey: HallOfFamePodiumSlotKey,
  positions: {
    desktop: HallOfFamePodiumPositions;
    mobile: HallOfFamePodiumPositions;
  },
) => {
  const resolveLayout = (mode: SlotLayoutMode) => {
    const rawSlot = positions[mode][slotKey];
    const guardrails = SLOT_SAFE_AREA[mode];
    const centerRange = guardrails.centerRangePercentBySlot[slotKey];
    const topRange = guardrails.topPercentRangeBySlot[slotKey];
    const widthBounds = guardrails.widthPercentBySlot[slotKey];
    const widthPercent = Math.min(
      widthBounds.max,
      Math.max(widthBounds.min, rawSlot.widthPercent),
    );
    const leftPercent = Math.min(
      centerRange.max,
      Math.max(centerRange.min, rawSlot.leftPercent),
    );
    const topPercent = Math.min(
      topRange.max,
      Math.max(topRange.min, rawSlot.topPercent),
    );

    return {
      leftPercent,
      topPercent,
      widthPercent,
    };
  };

  const desktop = resolveLayout("desktop");
  const mobile = resolveLayout("mobile");
  const cardBaseWidth = slotKey === "first" ? 10.9 : 9.45;

  return {
    ["--slot-left" as string]: `${desktop.leftPercent}%`,
    ["--slot-top" as string]: `${desktop.topPercent}%`,
    ["--slot-width" as string]: `${desktop.widthPercent}%`,
    ["--slot-left-mobile" as string]: `${mobile.leftPercent}%`,
    ["--slot-top-mobile" as string]: `${mobile.topPercent}%`,
    ["--slot-width-mobile" as string]: `${mobile.widthPercent}%`,
    ["--slot-card-max-width" as string]: `${cardBaseWidth}rem`,
  } as React.CSSProperties;
};

const buildRankLabel = (
  entries: WisHallOfFameEntry[],
  entry: WisHallOfFameEntry,
) => {
  const tiedCount = entries.filter(
    (candidate) => candidate.rank === entry.rank,
  ).length;
  return `${tiedCount > 1 ? "공동 " : ""}${entry.rank}위`;
};

const getInfoCardAlignClassName = (
  slotKey: HallOfFamePodiumSlotKey,
  deviceMode: SlotLayoutMode,
) => {
  if (slotKey === "first") {
    return "self-center";
  }
  if (deviceMode === "mobile") {
    return slotKey === "second" ? "self-start" : "self-end";
  }
  return slotKey === "second" ? "self-start" : "self-end";
};

const WisHallOfFamePodium: React.FC<WisHallOfFamePodiumProps> = ({
  entries = [],
  hallOfFameConfig,
  imageUrl,
  emptyMessage = "아직 화랑의 전당이 준비되지 않았어요.",
  title = "화랑의 전당",
  subtitle = "",
  action = null,
  showHeader = true,
  deviceMode = "responsive",
  slotControls,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const safeEntries = entries || [];
  const normalizedConfig = normalizeHallOfFameInterfaceConfig(hallOfFameConfig);
  const resolvedImageUrl =
    (imageUrl || normalizedConfig.podiumImageUrl || "").trim() ||
    DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;
  const normalizedPositions =
    normalizedConfig.positions || getDefaultHallOfFamePositions();
  const slotEntries = resolveSlotEntries(safeEntries);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeEntryKey, setActiveEntryKey] = useState<string | null>(null);
  const [hoveredEntryKey, setHoveredEntryKey] = useState<string | null>(null);
  const resolvedDeviceMode: SlotLayoutMode =
    deviceMode === "mobile"
      ? "mobile"
      : deviceMode === "desktop"
        ? "desktop"
        : stageWidth > 0 && stageWidth < 600
          ? "mobile"
          : "desktop";
  const scaleBounds =
    resolvedDeviceMode === "desktop"
      ? DESKTOP_PODIUM_SCALE_BOUNDS
      : MOBILE_PODIUM_SCALE_BOUNDS;
  const podiumScale =
    stageWidth > 0
      ? Math.min(
          scaleBounds.max,
          Math.max(scaleBounds.min, stageWidth / scaleBounds.baselineWidth),
        )
      : 1;
  const stageMinHeight =
    resolvedDeviceMode === "desktop"
      ? `${Math.min(28.5, Math.max(21, 23.8 * podiumScale))}rem`
      : `${Math.min(22.5, Math.max(17.25, 18.9 * podiumScale))}rem`;
  const contentPaddingX =
    resolvedDeviceMode === "desktop"
      ? `${Math.min(1.65, Math.max(0.9, 1.2 * podiumScale))}rem`
      : `${Math.min(1.15, Math.max(0.75, 0.95 * podiumScale))}rem`;
  const contentPaddingTop =
    resolvedDeviceMode === "desktop"
      ? `${Math.min(1.95, Math.max(1.25, 1.52 * podiumScale))}rem`
      : `${Math.min(1.45, Math.max(0.95, 1.15 * podiumScale))}rem`;
  const contentPaddingBottom =
    resolvedDeviceMode === "desktop"
      ? `${Math.min(8.4, Math.max(5.1, 6.2 * podiumScale))}rem`
      : `${Math.min(6.15, Math.max(3.9, 4.85 * podiumScale))}rem`;

  useEffect(() => {
    const stageElement = stageRef.current;
    if (!stageElement) return undefined;

    const updateWidth = () => {
      const nextWidth = readElementWidth(stageElement);
      setStageWidth((previousWidth) =>
        previousWidth === nextWidth ? previousWidth : nextWidth,
      );
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(stageElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setActiveEntryKey(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const slotPositionClassName =
    resolvedDeviceMode === "desktop"
      ? "absolute left-[var(--slot-left)] top-[var(--slot-top)] z-30 w-[var(--slot-width)] -translate-x-1/2 px-0"
      : "absolute left-[var(--slot-left-mobile)] top-[var(--slot-top-mobile)] z-30 w-[var(--slot-width-mobile)] -translate-x-1/2 px-0";

  const podiumStyle = {
    ["--hall-podium-scale" as string]: `${podiumScale}`,
    ["--hall-podium-stage-min-height" as string]: stageMinHeight,
    ["--hall-podium-content-px" as string]: contentPaddingX,
    ["--hall-podium-content-pt" as string]: contentPaddingTop,
    ["--hall-podium-content-pb" as string]: contentPaddingBottom,
  } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className="overflow-visible rounded-[1.85rem] border border-slate-200 bg-white shadow-[0_22px_54px_rgba(15,23,42,0.08)]"
      style={podiumStyle}
    >
      {showHeader && (
        <div className="overflow-hidden rounded-t-[1.85rem] border-b border-slate-100 bg-[linear-gradient(135deg,_#0f172a,_#1f2d45)] px-5 py-5 text-white sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-black tracking-[0.16em] text-amber-200/90">
              HALL OF FAME
            </div>
            <h2 className="mt-2 text-xl font-black leading-tight text-white sm:text-[1.7rem]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-2 text-sm leading-6 text-slate-200">
                {subtitle}
              </p>
            )}
          </div>
          {action && (
            <div className="w-full sm:w-auto sm:shrink-0">{action}</div>
          )}
        </div>
      )}

      <div className="relative overflow-visible px-2 pb-3 pt-2 sm:px-3 sm:pb-4 sm:pt-2.5">
        <div
          ref={stageRef}
          className="relative aspect-[80/49] w-full min-h-[var(--hall-podium-stage-min-height)] max-w-full overflow-visible rounded-[1.65rem] bg-[#f5f7fb]"
        >
          <div className="absolute inset-0 overflow-hidden rounded-[1.65rem]">
            <img
              src={resolvedImageUrl}
              alt="화랑의 전당 시상대"
              className="absolute inset-0 h-full w-full scale-[1.03] object-cover object-center opacity-35 blur-xl"
              aria-hidden="true"
            />
            <img
              src={resolvedImageUrl}
              alt=""
              className="absolute inset-x-0 bottom-0 h-full w-full object-contain object-bottom"
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_rgba(255,255,255,0.03)_36%,_rgba(15,23,42,0.18)_100%)]" />
            <div className="absolute inset-0 bg-gradient-to-b from-white/12 via-transparent to-slate-950/12" />
          </div>

          <div className="relative z-10 h-full overflow-visible px-[var(--hall-podium-content-px)] pb-[var(--hall-podium-content-pb)] pt-[var(--hall-podium-content-pt)]">
            {safeEntries.length === 0 && (
              <div className="absolute inset-x-6 top-1/2 z-20 -translate-y-1/2 rounded-3xl border border-white/70 bg-white/88 px-6 py-5 text-center text-sm font-semibold text-slate-600 shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur">
                {emptyMessage}
              </div>
            )}

            {SLOT_ORDER.map((slotKey) => {
              const entriesForSlot = slotEntries.get(slotKey) || [];
              if (!entriesForSlot.length) return null;

              const tone = getEntryTone(slotKey);
              const control = slotControls?.[slotKey];
              const primaryEntry = entriesForSlot[0];
              const rankLabel = buildRankLabel(safeEntries, primaryEntry);
              const tieCountLabel =
                entriesForSlot.length > 1 ? ` · ${entriesForSlot.length}명` : "";
              const displayedEntry =
                entriesForSlot.length === 1
                  ? primaryEntry
                  : entriesForSlot.find(
                      (entry) =>
                        `${slotKey}:${entry.uid}` === activeEntryKey ||
                        `${slotKey}:${entry.uid}` === hoveredEntryKey,
                    ) || null;
              const badgeClassName = `inline-flex min-h-8 max-w-full items-center justify-center whitespace-nowrap rounded-full border px-2.25 py-1 text-[9px] font-black tracking-[0.08em] shadow-[0_14px_26px_rgba(15,23,42,0.16)] sm:min-h-9 sm:px-2.75 sm:text-[13px] ${tone.badgeClassName}`;
              return (
                <div
                  key={`${slotKey}-${entriesForSlot.map((entry) => entry.uid).join("-")}`}
                  style={buildSlotStyle(slotKey, normalizedPositions)}
                  className={`${slotPositionClassName} overflow-visible`}
                >
                  <div className="mx-auto flex w-full max-w-[var(--slot-card-max-width)] origin-top flex-col items-center gap-1.25 overflow-visible text-center [transform:scale(var(--hall-podium-scale))] sm:gap-1.5">
                    {control ? (
                      <button
                        type="button"
                        aria-label={
                          control.dragLabel || `${rankLabel} 시상대 위치 이동`
                        }
                        onPointerDown={control.onPointerDown}
                        onClick={control.onClick}
                        disabled={control.disabled}
                        className={`${badgeClassName} touch-none select-none transition ${
                          control.active
                            ? "ring-4 ring-slate-900/15"
                            : "hover:ring-2 hover:ring-slate-900/10"
                        } ${
                          control.disabled
                            ? "cursor-default"
                            : "cursor-grab active:cursor-grabbing"
                        }`}
                      >
                        {`${rankLabel}${tieCountLabel}`}
                      </button>
                    ) : (
                      <div className={badgeClassName}>{`${rankLabel}${tieCountLabel}`}</div>
                    )}

                    {entriesForSlot.length === 1 ? (
                      <>
                        <div
                          className={`relative z-10 leading-none drop-shadow-[0_12px_18px_rgba(15,23,42,0.24)] ${tone.emojiClassName}`}
                        >
                          {primaryEntry.profileIcon || "🙂"}
                        </div>

                        <div
                          className={`relative z-10 w-full max-w-full rounded-[1.2rem] border px-2.25 py-2.25 backdrop-blur-xl sm:px-3 sm:py-2.75 ${tone.nameClassName}`}
                        >
                          <div className="whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.12em] text-white/80 [text-shadow:0_1px_2px_rgba(15,23,42,0.46)] sm:text-[9px]">
                            {primaryEntry.grade}학년 {primaryEntry.class}반
                          </div>
                          <div className="mt-1 whitespace-normal break-keep text-[10px] font-black leading-[1.28] text-white [text-shadow:0_1px_3px_rgba(15,23,42,0.72)] sm:text-[13px] lg:text-[14px]">
                            {primaryEntry.displayName || primaryEntry.studentName}
                          </div>
                        </div>

                        <div
                          className={`relative z-10 inline-flex min-h-[2rem] max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.25 py-1 text-[9px] font-black leading-none backdrop-blur shadow-[0_14px_30px_rgba(15,23,42,0.2)] sm:min-h-[2.2rem] sm:px-2.75 sm:text-[13px] ${tone.scoreClassName}`}
                        >
                          누적 {formatWisAmount(primaryEntry.cumulativeEarned)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="relative z-10 flex min-h-[3.5rem] w-full items-end justify-center">
                          {entriesForSlot.map((entry, index) => {
                            const entryKey = `${slotKey}:${entry.uid}`;
                            const isActive = activeEntryKey === entryKey;
                            const isHovered = hoveredEntryKey === entryKey;
                            return (
                              <button
                                key={entryKey}
                                type="button"
                                onClick={() =>
                                  setActiveEntryKey((previousValue) =>
                                    previousValue === entryKey ? null : entryKey,
                                  )
                                }
                                onMouseEnter={() => setHoveredEntryKey(entryKey)}
                                onMouseLeave={() =>
                                  setHoveredEntryKey((previousValue) =>
                                    previousValue === entryKey ? null : previousValue,
                                  )
                                }
                                aria-label={`${rankLabel} ${entry.displayName || entry.studentName} 정보 보기`}
                                className={`relative leading-none drop-shadow-[0_12px_18px_rgba(15,23,42,0.24)] transition-transform ${
                                  tone.emojiClassName
                                } ${
                                  index === 0 ? "" : "-ml-3.5 sm:-ml-4.5"
                                } ${
                                  isActive || isHovered ? "z-20 -translate-y-1 scale-105" : "z-10 hover:-translate-y-0.5"
                                }`}
                              >
                                <span
                                  className={`inline-flex rounded-full ring-offset-2 transition ${
                                    isActive || isHovered
                                      ? "ring-2 ring-white ring-offset-transparent"
                                      : ""
                                  }`}
                                >
                                  {entry.profileIcon || "🙂"}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {displayedEntry && (
                          <div
                            className={`relative z-20 mt-1.5 w-[min(12.5rem,calc(100vw-2rem))] max-w-[12.5rem] rounded-[1.2rem] border px-2.5 py-2.5 backdrop-blur-xl sm:px-3 sm:py-2.75 ${tone.nameClassName} ${getInfoCardAlignClassName(slotKey, resolvedDeviceMode)}`}
                          >
                            <div className="whitespace-nowrap text-[8px] font-bold uppercase tracking-[0.12em] text-white/80 [text-shadow:0_1px_2px_rgba(15,23,42,0.46)] sm:text-[9px]">
                              {displayedEntry.grade}학년 {displayedEntry.class}반
                            </div>
                            <div className="mt-1 whitespace-normal break-keep text-[10px] font-black leading-[1.28] text-white [text-shadow:0_1px_3px_rgba(15,23,42,0.72)] sm:text-[13px] lg:text-[14px]">
                              {displayedEntry.displayName || displayedEntry.studentName}
                            </div>
                            <div
                              className={`mt-2 inline-flex min-h-[2rem] max-w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full border px-2.25 py-1 text-[9px] font-black leading-none backdrop-blur shadow-[0_14px_30px_rgba(15,23,42,0.2)] sm:min-h-[2.2rem] sm:px-2.75 sm:text-[13px] ${tone.scoreClassName}`}
                            >
                              누적 {formatWisAmount(displayedEntry.cumulativeEarned)}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WisHallOfFamePodium;
