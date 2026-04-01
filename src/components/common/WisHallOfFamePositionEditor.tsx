import React, { useEffect, useMemo, useRef, useState } from "react";
import WisHallOfFameLeaderboardList from "./WisHallOfFameLeaderboardList";
import WisHallOfFamePodium from "./WisHallOfFamePodium";
import {
  DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
  WIS_HALL_OF_FAME_GRADE_KEY,
  applyHallOfFameRankLimit,
  getDefaultHallOfFameLeaderboardPanelPosition,
  getDefaultHallOfFamePositions,
  getHallOfFameLeaderboardTailEntries,
  getWisHallOfFameClassEntries,
  getWisHallOfFameClassLeaderboardEntries,
  getWisHallOfFameGradeEntries,
  getWisHallOfFameGradeLeaderboardEntries,
  resolveHallOfFameInterfaceConfig,
} from "../../lib/wisHallOfFame";
import type {
  HallOfFameInterfaceConfig,
  HallOfFameLeaderboardPanelPosition,
  HallOfFamePodiumPositions,
  HallOfFamePodiumSlotKey,
  WisHallOfFameSnapshot,
} from "../../types";

export type HallOfFameEditorDeviceMode = "desktop" | "mobile";
type HallOfFameEditorPreviewView = "grade" | "class";
type EditableKey = HallOfFamePodiumSlotKey | "leaderboard";

export interface WisHallOfFamePositionEditorValue {
  positions: {
    desktop: HallOfFamePodiumPositions;
    mobile: HallOfFamePodiumPositions;
  };
  leaderboardPanel: {
    desktop: HallOfFameLeaderboardPanelPosition;
    mobile: HallOfFameLeaderboardPanelPosition;
  };
}

interface WisHallOfFamePositionEditorProps {
  value?: WisHallOfFamePositionEditorValue;
  imageUrl?: string;
  hallOfFameConfig?: HallOfFameInterfaceConfig | null;
  snapshot?: WisHallOfFameSnapshot | null;
  previewView?: HallOfFameEditorPreviewView;
  gradeKey?: string;
  currentGrade?: string;
  currentClass?: string;
  deviceMode: HallOfFameEditorDeviceMode;
  disabled?: boolean;
  showPreviewStage?: boolean;
  onChange: (nextValue: WisHallOfFamePositionEditorValue) => void;
  onDeviceModeChange: (nextMode: HallOfFameEditorDeviceMode) => void;
  onReset: () => void;
}

type DragState = {
  key: EditableKey;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originLeft: number;
  originTop: number;
  stageWidth: number;
  stageHeight: number;
  rootFontSize: number;
};

const DEFAULT_EDITOR_VALUE: WisHallOfFamePositionEditorValue = {
  positions: getDefaultHallOfFamePositions(),
  leaderboardPanel: getDefaultHallOfFameLeaderboardPanelPosition(),
};

const PRESET_ITEMS: Array<{
  key: EditableKey;
  label: string;
  toneClassName: string;
}> = [
  {
    key: "first",
    label: "1위 시상대",
    toneClassName: "border-amber-300 bg-amber-100/95 text-amber-950",
  },
  {
    key: "second",
    label: "2위 시상대",
    toneClassName: "border-slate-300 bg-slate-100/95 text-slate-900",
  },
  {
    key: "third",
    label: "3위 시상대",
    toneClassName: "border-orange-300 bg-orange-100/95 text-orange-950",
  },
  {
    key: "leaderboard",
    label: "오른쪽 랭킹 패널",
    toneClassName: "border-sky-300 bg-sky-100/95 text-sky-950",
  },
];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const DEFAULT_RAIL_CENTER = 71;

const getWidthBounds = (
  key: EditableKey,
  deviceMode: HallOfFameEditorDeviceMode,
) =>
  key === "leaderboard"
    ? deviceMode === "desktop"
      ? { min: 24, max: 38 }
      : { min: 78, max: 100 }
    : { min: 12, max: 42 };

const normalizeNumberText = (value: unknown) => {
  const raw = String(value || "").trim();
  const digits = raw.match(/\d+/)?.[0] || "";
  if (!digits) return raw;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : raw;
};

const resolveRailAlignClassName = (leftPercent: number) => {
  if (leftPercent <= 44) return "self-start";
  if (leftPercent >= 56) return "self-end";
  return "self-center";
};

const cloneEditorValue = (
  value?: WisHallOfFamePositionEditorValue,
): WisHallOfFamePositionEditorValue => ({
  positions: {
    desktop: {
      first: {
        ...(value?.positions?.desktop?.first ||
          DEFAULT_EDITOR_VALUE.positions.desktop.first),
      },
      second: {
        ...(value?.positions?.desktop?.second ||
          DEFAULT_EDITOR_VALUE.positions.desktop.second),
      },
      third: {
        ...(value?.positions?.desktop?.third ||
          DEFAULT_EDITOR_VALUE.positions.desktop.third),
      },
    },
    mobile: {
      first: {
        ...(value?.positions?.mobile?.first ||
          DEFAULT_EDITOR_VALUE.positions.mobile.first),
      },
      second: {
        ...(value?.positions?.mobile?.second ||
          DEFAULT_EDITOR_VALUE.positions.mobile.second),
      },
      third: {
        ...(value?.positions?.mobile?.third ||
          DEFAULT_EDITOR_VALUE.positions.mobile.third),
      },
    },
  },
  leaderboardPanel: {
    desktop: {
      ...(value?.leaderboardPanel?.desktop ||
        DEFAULT_EDITOR_VALUE.leaderboardPanel.desktop),
    },
    mobile: {
      ...(value?.leaderboardPanel?.mobile ||
        DEFAULT_EDITOR_VALUE.leaderboardPanel.mobile),
    },
  },
});

const WisHallOfFamePositionEditor: React.FC<
  WisHallOfFamePositionEditorProps
> = ({
  value,
  imageUrl,
  hallOfFameConfig = null,
  snapshot = null,
  previewView = "grade",
  gradeKey = "",
  currentGrade = "",
  currentClass = "",
  deviceMode,
  disabled = false,
  showPreviewStage = true,
  onChange,
  onDeviceModeChange,
  onReset,
}) => {
  const [selectedKey, setSelectedKey] = useState<EditableKey>("first");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const podiumStageRef = useRef<HTMLDivElement | null>(null);
  const activeHandleRef = useRef<HTMLButtonElement | null>(null);
  const editorValue = useMemo(() => cloneEditorValue(value), [value]);
  const normalizedGrade = normalizeNumberText(currentGrade);
  const normalizedClass = normalizeNumberText(currentClass);
  const resolvedConfig = useMemo(
    () =>
      resolveHallOfFameInterfaceConfig({
        ...(hallOfFameConfig || {}),
        podiumImageUrl:
          (imageUrl || hallOfFameConfig?.podiumImageUrl || "").trim() ||
          DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
        positions: editorValue.positions,
        leaderboardPanel: editorValue.leaderboardPanel,
      }),
    [editorValue, hallOfFameConfig, imageUrl],
  );
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
  const canOpenClassView = Boolean(normalizedGrade && normalizedClass);
  const effectivePreviewView =
    previewView === "class" && canOpenClassView ? "class" : "grade";
  const activePodiumEntries =
    effectivePreviewView === "grade"
      ? getWisHallOfFameGradeEntries(snapshot, previewGradeKey)
      : getWisHallOfFameClassEntries(
          snapshot,
          normalizedGrade,
          normalizedClass,
        );
  const activeLeaderboardEntries =
    effectivePreviewView === "grade"
      ? getWisHallOfFameGradeLeaderboardEntries(snapshot, previewGradeKey)
      : getWisHallOfFameClassLeaderboardEntries(
          snapshot,
          normalizedGrade,
          normalizedClass,
        );
  const appliedRankLimit =
    effectivePreviewView === "grade"
      ? resolvedConfig.publicRange.gradeRankLimit
      : resolvedConfig.publicRange.classRankLimit;
  const visibleLeaderboardEntries = applyHallOfFameRankLimit(
    activeLeaderboardEntries,
    appliedRankLimit,
    resolvedConfig.publicRange.includeTies,
  );
  const rightRailEntries = getHallOfFameLeaderboardTailEntries(
    visibleLeaderboardEntries,
    3,
  );
  const viewScopeLabel =
    effectivePreviewView === "grade"
      ? `${previewGradeKey}학년 전교`
      : canOpenClassView
        ? `${normalizedGrade}학년 ${normalizedClass}반`
        : "전교";
  const emptyPodiumMessage =
    effectivePreviewView === "grade"
      ? snapshot
        ? `${previewGradeKey}학년 전교 랭킹을 집계 중이에요.`
        : "화랑의 전당을 준비 중이에요. 잠시 후 다시 표시됩니다."
      : snapshot
        ? "아직 우리 학급 랭킹이 없어요."
        : "우리 학급 랭킹도 잠시 후 다시 표시됩니다.";
  const rightRailEmptyMessage =
    effectivePreviewView === "grade"
      ? "전교 추가 랭킹을 집계 중이에요."
      : "우리 학급 추가 랭킹을 준비 중이에요.";
  const desktopRail = resolvedConfig.leaderboardPanel.desktop;
  const mobileRail = resolvedConfig.leaderboardPanel.mobile;
  const desktopRailWidth = clamp(
    Number(desktopRail.widthPercent || 29),
    24,
    38,
  );
  const desktopRailTop = `${clamp(
    Number(desktopRail.topPercent || 0) / 10,
    0,
    4.5,
  )}rem`;
  const desktopRailShift = `${clamp(
    (Number(desktopRail.leftPercent || DEFAULT_RAIL_CENTER) -
      DEFAULT_RAIL_CENTER) /
      8,
    -1.25,
    1.25,
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
  const previewStyle = {
    ["--hall-rail-width" as string]: `${desktopRailWidth}%`,
    ["--hall-rail-desktop-top" as string]: desktopRailTop,
    ["--hall-rail-desktop-shift" as string]: desktopRailShift,
    ["--hall-rail-mobile-width" as string]: mobileRailWidth,
    ["--hall-rail-mobile-top" as string]: mobileRailTop,
  };
  const previewLayoutClassName =
    deviceMode === "desktop"
      ? "flex flex-row items-start gap-6 overflow-hidden"
      : "mx-auto flex max-w-[420px] flex-col gap-5 overflow-hidden";
  const podiumContainerClassName =
    deviceMode === "desktop"
      ? "min-w-0 flex-1 overflow-hidden"
      : "min-w-0 w-full overflow-hidden";
  const railContainerClassName =
    deviceMode === "desktop"
      ? "relative z-10 mt-[var(--hall-rail-desktop-top)] ml-[var(--hall-rail-desktop-shift)] min-w-[19rem] w-[max(var(--hall-rail-width),19rem)] max-w-full shrink-0"
      : `relative z-10 mt-[var(--hall-rail-mobile-top)] min-w-0 w-full max-w-[var(--hall-rail-mobile-width)] ${mobileRailAlignClassName}`;

  const getPosition = (key: EditableKey) => {
    if (key === "leaderboard") {
      return editorValue.leaderboardPanel[deviceMode];
    }
    return editorValue.positions[deviceMode][key];
  };

  const updatePosition = (
    key: EditableKey,
    updater: (
      current: HallOfFameLeaderboardPanelPosition,
    ) => HallOfFameLeaderboardPanelPosition,
  ) => {
    const nextValue = cloneEditorValue(editorValue);
    if (key === "leaderboard") {
      nextValue.leaderboardPanel[deviceMode] = updater(
        nextValue.leaderboardPanel[deviceMode],
      );
    } else {
      nextValue.positions[deviceMode][key] = updater(
        nextValue.positions[deviceMode][key],
      );
    }
    onChange(nextValue);
  };

  useEffect(() => {
    if (!dragState) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - dragState.startClientX;
      const deltaY = event.clientY - dragState.startClientY;

      if (dragState.key === "leaderboard") {
        const nextLeftPercent =
          deviceMode === "desktop"
            ? clamp(
                dragState.originLeft + (deltaX / dragState.rootFontSize) * 4,
                0,
                100,
              )
            : clamp(
                dragState.originLeft + (deltaX / dragState.stageWidth) * 100,
                0,
                100,
              );
        const nextTopPercent =
          deviceMode === "desktop"
            ? clamp(
                dragState.originTop + (deltaY / dragState.rootFontSize) * 10,
                0,
                100,
              )
            : clamp(
                dragState.originTop + (deltaY / dragState.rootFontSize) * 18,
                0,
                100,
              );
        updatePosition(dragState.key, (current) => ({
          ...current,
          leftPercent: nextLeftPercent,
          topPercent: nextTopPercent,
        }));
        return;
      }

      const deltaXPercent = (deltaX / dragState.stageWidth) * 100;
      const deltaYPercent = (deltaY / dragState.stageHeight) * 100;

      updatePosition(dragState.key, (current) => ({
        ...current,
        leftPercent: clamp(dragState.originLeft + deltaXPercent, 0, 100),
        topPercent: clamp(dragState.originTop + deltaYPercent, 0, 100),
      }));
    };

    const handlePointerUp = () => {
      if (
        activeHandleRef.current?.hasPointerCapture?.(dragState.pointerId)
      ) {
        activeHandleRef.current.releasePointerCapture(dragState.pointerId);
      }
      activeHandleRef.current = null;
      setDragState(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [deviceMode, dragState, onChange]);

  const selectedPosition = getPosition(selectedKey);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    key: EditableKey,
  ) => {
    const measurementTarget =
      key === "leaderboard" ? sceneRef.current : podiumStageRef.current;
    if (disabled || !measurementTarget) return;
    event.preventDefault();
    event.stopPropagation();
    activeHandleRef.current = event.currentTarget;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = measurementTarget.getBoundingClientRect();
    const current = getPosition(key);
    const rootFontSize =
      Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize || "16",
      ) || 16;
    setSelectedKey(key);
    setDragState({
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originLeft: current.leftPercent,
      originTop: current.topPercent,
      stageWidth: rect.width || 1,
      stageHeight: rect.height || 1,
      rootFontSize,
    });
  };

  const handleWidthChange = (nextWidth: number) => {
    const widthBounds = getWidthBounds(selectedKey, deviceMode);
    updatePosition(selectedKey, (current) => ({
      ...current,
      widthPercent: clamp(nextWidth, widthBounds.min, widthBounds.max),
    }));
  };

  const handlePositionFieldChange = (
    field: "leftPercent" | "topPercent" | "widthPercent",
    nextValue: number,
  ) => {
    updatePosition(selectedKey, (current) => ({
      ...current,
      [field]:
        field === "widthPercent"
          ? clamp(
              nextValue,
              getWidthBounds(selectedKey, deviceMode).min,
              getWidthBounds(selectedKey, deviceMode).max,
            )
          : clamp(nextValue, 0, 100),
    }));
  };

  const controls = (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="mb-4">
        <h5 className="text-sm font-black text-slate-900">선택한 항목 조정</h5>
        <p className="mt-1 text-sm text-slate-500 break-keep">
          현재 선택:{" "}
          {PRESET_ITEMS.find((item) => item.key === selectedKey)?.label}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {PRESET_ITEMS.map((item) => (
          <button
            key={`select-${item.key}`}
            type="button"
            onClick={() => setSelectedKey(item.key)}
            className={`rounded-full border px-3 py-2 text-sm font-bold transition ${
              selectedKey === item.key
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
            } whitespace-nowrap break-keep`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <label className="block">
        <div className="mb-2 flex items-center justify-between text-sm font-bold text-slate-700">
          <span>넓이</span>
          <span>{Math.round(selectedPosition.widthPercent)}%</span>
        </div>
        <input
          type="range"
          min={getWidthBounds(selectedKey, deviceMode).min}
          max={getWidthBounds(selectedKey, deviceMode).max}
          step={1}
          value={Math.round(selectedPosition.widthPercent)}
          onChange={(event) => handleWidthChange(Number(event.target.value))}
          className="w-full accent-slate-900"
          disabled={disabled}
        />
      </label>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-bold text-slate-500 whitespace-nowrap">
            가로 위치
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(selectedPosition.leftPercent)}
              onChange={(event) =>
                handlePositionFieldChange(
                  "leftPercent",
                  Number(event.target.value || selectedPosition.leftPercent),
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-900"
              disabled={disabled}
            />
            <span className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-500">
              %
            </span>
          </div>
        </label>
        <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-bold text-slate-500 whitespace-nowrap">
            세로 위치
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(selectedPosition.topPercent)}
              onChange={(event) =>
                handlePositionFieldChange(
                  "topPercent",
                  Number(event.target.value || selectedPosition.topPercent),
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-900"
              disabled={disabled}
            />
            <span className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-500">
              %
            </span>
          </div>
        </label>
        <label className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="text-xs font-bold text-slate-500 whitespace-nowrap">
            넓이
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={getWidthBounds(selectedKey, deviceMode).min}
              max={getWidthBounds(selectedKey, deviceMode).max}
              value={Math.round(selectedPosition.widthPercent)}
              onChange={(event) =>
                handlePositionFieldChange(
                  "widthPercent",
                  Number(event.target.value || selectedPosition.widthPercent),
                )
              }
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-black text-slate-900"
              disabled={disabled}
            />
            <span className="shrink-0 whitespace-nowrap text-xs font-bold text-slate-500">
              %
            </span>
          </div>
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-dashed border-sky-200 bg-sky-50 px-4 py-4 text-sm text-sky-900 break-keep">
        직접 드래그로 위치를 잡고, 숫자 입력으로 가로/세로/넓이를 더 세밀하게
        맞출 수 있습니다.
      </div>
    </div>
  );

  const podiumSlotControls = {
    first: {
      active: selectedKey === "first",
      disabled,
      dragLabel: "1위 시상대 위치 이동",
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) =>
        handlePointerDown(event, "first"),
      onClick: () => setSelectedKey("first"),
    },
    second: {
      active: selectedKey === "second",
      disabled,
      dragLabel: "2위 시상대 위치 이동",
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) =>
        handlePointerDown(event, "second"),
      onClick: () => setSelectedKey("second"),
    },
    third: {
      active: selectedKey === "third",
      disabled,
      dragLabel: "3위 시상대 위치 이동",
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) =>
        handlePointerDown(event, "third"),
      onClick: () => setSelectedKey("third"),
    },
  } as const;
  const leaderboardHeaderAccessory = (
    <button
      type="button"
      aria-label="오른쪽 랭킹 패널 위치 이동"
      onPointerDown={(event) => handlePointerDown(event, "leaderboard")}
      onClick={() => setSelectedKey("leaderboard")}
      disabled={disabled}
      className={`inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-black shadow-[0_12px_24px_rgba(15,23,42,0.14)] transition ${
        PRESET_ITEMS.find((item) => item.key === "leaderboard")?.toneClassName ||
        ""
      } ${
        selectedKey === "leaderboard"
          ? "ring-4 ring-slate-900/15"
          : "hover:ring-2 hover:ring-slate-900/10"
      } ${
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      패널 이동
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-base font-black text-slate-900">배치 편집</h4>
          <p className="mt-1 text-sm text-slate-500 break-keep">
            1위, 2위, 3위 배지와 우측 패널 헤더를 직접 드래그해 위치를 옮기고,
            넓이를 조절해 배경 이미지에 맞춰 보세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => onDeviceModeChange("desktop")}
              className={`min-h-10 rounded-full px-4 text-sm font-black transition ${
                deviceMode === "desktop"
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:text-slate-900"
              } whitespace-nowrap`}
            >
              데스크톱
            </button>
            <button
              type="button"
              onClick={() => onDeviceModeChange("mobile")}
              className={`min-h-10 rounded-full px-4 text-sm font-black transition ${
                deviceMode === "mobile"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              } whitespace-nowrap`}
            >
              모바일
            </button>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex min-h-10 items-center whitespace-nowrap break-keep rounded-full border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
          >
            기본 배치로 복원
          </button>
        </div>
      </div>

      {showPreviewStage ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(24rem,28rem)]">
          <div className="overflow-visible rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-600 whitespace-nowrap">
              {deviceMode === "desktop" ? "데스크톱" : "모바일"} 미리보기
            </div>
            <div
              ref={sceneRef}
              className={`relative overflow-hidden rounded-[1.85rem] bg-[radial-gradient(circle_at_top_left,_rgba(255,251,235,0.92),_rgba(248,250,252,0.98)_42%,_rgba(255,255,255,1)_100%)] p-4 touch-none select-none sm:p-5 lg:p-6 ${
                disabled ? "opacity-70" : ""
              } ${
                deviceMode === "desktop"
                  ? "min-h-[46rem] xl:min-h-[50rem]"
                  : "min-h-[34rem]"
              }`}
            >
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-white">
                  {deviceMode === "desktop"
                    ? "데스크톱 학생 화면"
                    : "모바일 학생 화면"}
                </span>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-white px-3 py-1 text-slate-700 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
                  {viewScopeLabel}
                </span>
                <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-50 px-3 py-1 text-sky-700">
                  실제 시상대 + 우측 공개 랭킹
                </span>
              </div>

              <div className={previewLayoutClassName} style={previewStyle}>
                <div className={podiumContainerClassName}>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <div>
                      <p className="text-[11px] font-black tracking-[0.14em] text-amber-600">
                        PODIUM
                      </p>
                      <p className="mt-1 break-keep text-sm font-bold text-slate-600">
                        실제 학생 화면과 같은 배지, 이름 배지, 누적 위스 pill을
                        그대로 보여줍니다.
                      </p>
                    </div>
                  </div>

                  <div ref={podiumStageRef} className="relative overflow-visible">
                    <div className="select-none">
                      <WisHallOfFamePodium
                        entries={activePodiumEntries}
                        hallOfFameConfig={resolvedConfig}
                        imageUrl={resolvedConfig.podiumImageUrl}
                        emptyMessage={emptyPodiumMessage}
                        showHeader={false}
                        deviceMode={deviceMode}
                        slotControls={podiumSlotControls}
                      />
                    </div>
                  </div>
                </div>

                <div className={railContainerClassName}>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <div>
                      <p className="text-[11px] font-black tracking-[0.14em] text-sky-700">
                        OPEN RANKING
                      </p>
                      <p className="mt-1 break-keep text-sm font-bold text-slate-600">
                        우측 패널도 실제 학생 화면과 같은 카드 구조로 미리
                        보여줍니다.
                      </p>
                    </div>
                  </div>

                  <div className="relative min-h-[320px] overflow-visible">
                    <div className="select-none">
                      <WisHallOfFameLeaderboardList
                        entries={rightRailEntries}
                        hallOfFameConfig={resolvedConfig}
                        title={
                          effectivePreviewView === "grade"
                            ? "전교 추가 공개 랭킹"
                            : "우리 학급 추가 공개 랭킹"
                        }
                        subtitle={
                          resolvedConfig.publicRange.includeTies
                            ? "기본은 4위부터 보이고, 같은 순위는 함께 이어서 보여요."
                            : "공개 범위 안에서 4위부터 차례대로 보여요."
                        }
                        emptyMessage={rightRailEmptyMessage}
                        className="h-full"
                        headerAccessory={leaderboardHeaderAccessory}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {controls}
        </div>
      ) : (
        controls
      )}
    </div>
  );
};

export default WisHallOfFamePositionEditor;
