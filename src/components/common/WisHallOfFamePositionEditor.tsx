import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL,
  getDefaultHallOfFameLeaderboardPanelPosition,
  getDefaultHallOfFamePositions,
} from '../../lib/wisHallOfFame';
import type {
  HallOfFameLeaderboardPanelPosition,
  HallOfFamePodiumPositions,
  HallOfFamePodiumSlotKey,
} from '../../types';

export type HallOfFameEditorDeviceMode = 'desktop' | 'mobile';
type EditableKey = HallOfFamePodiumSlotKey | 'leaderboard';

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
  deviceMode: HallOfFameEditorDeviceMode;
  disabled?: boolean;
  showPreviewStage?: boolean;
  onChange: (nextValue: WisHallOfFamePositionEditorValue) => void;
  onDeviceModeChange: (nextMode: HallOfFameEditorDeviceMode) => void;
  onReset: () => void;
}

type DragState = {
  key: EditableKey;
  startClientX: number;
  startClientY: number;
  originLeft: number;
  originTop: number;
  stageWidth: number;
  stageHeight: number;
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
    key: 'first',
    label: '1위 시상대',
    toneClassName: 'border-amber-300 bg-amber-100/95 text-amber-950',
  },
  {
    key: 'second',
    label: '2위 시상대',
    toneClassName: 'border-slate-300 bg-slate-100/95 text-slate-900',
  },
  {
    key: 'third',
    label: '3위 시상대',
    toneClassName: 'border-orange-300 bg-orange-100/95 text-orange-950',
  },
  {
    key: 'leaderboard',
    label: '오른쪽 랭킹 패널',
    toneClassName: 'border-sky-300 bg-sky-100/95 text-sky-950',
  },
];

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const getWidthBounds = (key: EditableKey) =>
  key === 'leaderboard'
    ? { min: 40, max: 100 }
    : { min: 12, max: 42 };

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
  deviceMode,
  disabled = false,
  showPreviewStage = true,
  onChange,
  onDeviceModeChange,
  onReset,
}) => {
  const [selectedKey, setSelectedKey] = useState<EditableKey>('first');
  const [dragState, setDragState] = useState<DragState | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const editorValue = useMemo(() => cloneEditorValue(value), [value]);

  const getPosition = (key: EditableKey) => {
    if (key === 'leaderboard') {
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
    if (key === 'leaderboard') {
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
      const deltaXPercent =
        ((event.clientX - dragState.startClientX) / dragState.stageWidth) * 100;
      const deltaYPercent =
        ((event.clientY - dragState.startClientY) / dragState.stageHeight) * 100;

      updatePosition(dragState.key, (current) => ({
        ...current,
        leftPercent: clamp(dragState.originLeft + deltaXPercent, 0, 100),
        topPercent: clamp(dragState.originTop + deltaYPercent, 0, 100),
      }));
    };

    const handlePointerUp = () => {
      setDragState(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [dragState, editorValue, onChange]);

  const selectedPosition = getPosition(selectedKey);

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    key: EditableKey,
  ) => {
    if (disabled || !stageRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = stageRef.current.getBoundingClientRect();
    const current = getPosition(key);
    setSelectedKey(key);
    setDragState({
      key,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originLeft: current.leftPercent,
      originTop: current.topPercent,
      stageWidth: rect.width || 1,
      stageHeight: rect.height || 1,
    });
  };

  const handleWidthChange = (nextWidth: number) => {
    const widthBounds = getWidthBounds(selectedKey);
    updatePosition(selectedKey, (current) => ({
      ...current,
      widthPercent: clamp(nextWidth, widthBounds.min, widthBounds.max),
    }));
  };

  const handlePositionFieldChange = (
    field: 'leftPercent' | 'topPercent' | 'widthPercent',
    nextValue: number,
  ) => {
    updatePosition(selectedKey, (current) => ({
      ...current,
      [field]: field === 'widthPercent'
        ? clamp(nextValue, getWidthBounds(selectedKey).min, getWidthBounds(selectedKey).max)
        : clamp(nextValue, 0, 100),
    }));
  };

  const resolvedImageUrl = imageUrl || DEFAULT_WIS_HALL_OF_FAME_PODIUM_IMAGE_URL;

  const controls = (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="mb-4">
        <h5 className="text-sm font-black text-slate-900">선택한 항목 조정</h5>
        <p className="mt-1 text-sm text-slate-500 break-keep">
          현재 선택: {PRESET_ITEMS.find((item) => item.key === selectedKey)?.label}
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
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
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
          min={selectedKey === 'leaderboard' ? 40 : 12}
          max={selectedKey === 'leaderboard' ? 100 : 42}
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
                  'leftPercent',
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
                  'topPercent',
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
              min={getWidthBounds(selectedKey).min}
              max={getWidthBounds(selectedKey).max}
              value={Math.round(selectedPosition.widthPercent)}
              onChange={(event) =>
                handlePositionFieldChange(
                  'widthPercent',
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
        직접 드래그로 위치를 잡고, 숫자 입력으로 가로/세로/넓이를 더 세밀하게 맞출 수 있습니다.
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h4 className="text-base font-black text-slate-900">배치 편집</h4>
          <p className="mt-1 text-sm text-slate-500 break-keep">
            항목을 드래그해 위치를 옮기고, 넓이를 조절해 배경 이미지에 맞춰 보세요.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => onDeviceModeChange('desktop')}
              className={`min-h-10 rounded-full px-4 text-sm font-black transition ${
                deviceMode === 'desktop'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              } whitespace-nowrap`}
            >
              데스크톱
            </button>
            <button
              type="button"
              onClick={() => onDeviceModeChange('mobile')}
              className={`min-h-10 rounded-full px-4 text-sm font-black transition ${
                deviceMode === 'mobile'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_360px]">
          <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
            <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-600 whitespace-nowrap">
              {deviceMode === 'desktop' ? '데스크톱' : '모바일'} 미리보기
            </div>
            <div
              ref={stageRef}
              className={`relative aspect-[16/9] overflow-hidden bg-slate-100 touch-none select-none xl:aspect-[16/10] ${
                disabled ? 'opacity-70' : ''
              }`}
            >
              <img
                src={resolvedImageUrl}
                alt="화랑의 전당 배치 편집 미리보기"
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-b from-white/15 via-transparent to-slate-950/10" />

              {PRESET_ITEMS.map((item) => {
                const position = getPosition(item.key);
                const isLeaderboard = item.key === 'leaderboard';
                const isSelected = selectedKey === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onPointerDown={(event) => handlePointerDown(event, item.key)}
                    onClick={() => setSelectedKey(item.key)}
                    style={{
                      left: `${position.leftPercent}%`,
                      top: `${position.topPercent}%`,
                      width: `${position.widthPercent}%`,
                    }}
                    className={`absolute -translate-x-1/2 touch-none select-none rounded-3xl border px-3 py-3 text-left shadow-[0_16px_32px_rgba(15,23,42,0.14)] backdrop-blur-md transition ${item.toneClassName} ${
                      isSelected
                        ? 'ring-4 ring-slate-900/15'
                        : 'hover:ring-2 hover:ring-slate-900/10'
                    } ${
                      disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                    }`}
                  >
                    {isLeaderboard ? (
                      <div className="space-y-2">
                        <div className="inline-flex whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-black">
                          오픈 랭킹
                        </div>
                        <div className="rounded-2xl bg-white/82 px-3 py-2 text-xs font-bold text-slate-700">
                          <div className="flex items-center justify-between gap-2">
                            <span className="whitespace-nowrap">4위</span>
                            <span className="whitespace-nowrap">🐯 김서윤</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="whitespace-nowrap">5위</span>
                            <span className="whitespace-nowrap">🦊 박도윤</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="whitespace-nowrap">6위</span>
                            <span className="whitespace-nowrap">🦁 이지후</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-center">
                        <div className="inline-flex whitespace-nowrap rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-black">
                          {item.label}
                        </div>
                        <div className="text-[30px] leading-none drop-shadow-[0_10px_18px_rgba(15,23,42,0.18)]">
                          {item.key === 'first'
                            ? '👑'
                            : item.key === 'second'
                              ? '🛡️'
                              : '🏹'}
                        </div>
                        <div className="rounded-2xl bg-white/84 px-3 py-2 text-xs font-black text-slate-800 whitespace-nowrap">
                          {item.key === 'first'
                            ? '1위 최유진'
                            : item.key === 'second'
                              ? '2위 김현우'
                              : '3위 박지안'}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
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
