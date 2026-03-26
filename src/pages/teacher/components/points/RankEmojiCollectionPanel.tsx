import React, { useState } from "react";
import type { PointRankDisplay } from "../../../../lib/pointRanks";
import type {
  PointRankPolicy,
  PointRankPolicyTier,
  PointRankThemeId,
} from "../../../../types";

interface RankEmojiCollectionPanelProps {
  canManage: boolean;
  draftRankPolicy: PointRankPolicy;
  enabledEmojiCount: number;
  newEmojiValue: string;
  onNewEmojiValueChange: (value: string) => void;
  onAddEmoji: () => void;
  onEmojiValueChange: (
    entryId: string,
    nextEmoji: string,
    entryIndex: number,
  ) => void;
  onToggleEmojiEnabled: (entryId: string) => void;
  onReorderEmojiRegistry: (sourceId: string, targetId: string) => void;
  getTierPreview: (
    tier: PointRankPolicyTier,
    themeId?: PointRankThemeId,
  ) => PointRankDisplay | null;
}

const RankEmojiCollectionPanel: React.FC<RankEmojiCollectionPanelProps> = ({
  canManage,
  draftRankPolicy,
  enabledEmojiCount,
  newEmojiValue,
  onNewEmojiValueChange,
  onAddEmoji,
  onEmojiValueChange,
  onToggleEmojiEnabled,
  onReorderEmojiRegistry,
  getTierPreview,
}) => {
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);

  const handleDragStart = (
    entryId: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    if (!canManage) return;
    setDraggedEntryId(entryId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entryId);
  };

  const handleDrop = (
    targetId: string,
    event: React.DragEvent<HTMLElement>,
  ) => {
    event.preventDefault();
    const sourceId =
      draggedEntryId || event.dataTransfer.getData("text/plain") || "";
    setDraggedEntryId(null);
    setDragOverEntryId(null);
    if (!sourceId || sourceId === targetId) return;
    onReorderEmojiRegistry(sourceId, targetId);
  };

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">이모지 모음</h2>
            <p className="mt-1 text-sm text-gray-500">
              이모지 추가, 비활성화, 순서 조정을 이 탭에서 가볍게 관리합니다.
            </p>
          </div>
          <div className="grid gap-3 lg:min-w-[360px]">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
              <label className="block">
                <div className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  새 이모지 추가
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={newEmojiValue}
                    onChange={(event) =>
                      onNewEmojiValueChange(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onAddEmoji();
                      }
                    }}
                    placeholder="예: 🐉"
                    className="h-12 w-full rounded-xl border border-blue-200 bg-white px-4 text-center text-2xl font-bold text-gray-900"
                    maxLength={8}
                    disabled={!canManage}
                    aria-label="새 이모지"
                  />
                  <button
                    type="button"
                    onClick={onAddEmoji}
                    disabled={!canManage}
                    className="inline-flex h-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    추가
                  </button>
                </div>
              </label>
              <p className="mt-2 text-xs leading-5 text-blue-700">
                같은 이모지는 한 번만 등록할 수 있습니다.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
                총 {draftRankPolicy.emojiRegistry.length}개
              </div>
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                활성 {enabledEmojiCount}개
              </div>
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                드래그 후 저장
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {draftRankPolicy.emojiRegistry.map((entry, entryIndex) => {
          const assignedTier =
            draftRankPolicy.tiers.find((tier) =>
              (tier.allowedEmojiIds || []).includes(entry.id),
            ) || null;
          const assignedTierLabel = assignedTier
            ? getTierPreview(assignedTier)?.label || assignedTier.code
            : "등급 미지정";
          const isDragTarget =
            dragOverEntryId === entry.id && draggedEntryId !== entry.id;

          return (
            <article
              key={entry.id}
              draggable={canManage}
              onDragStart={(event) => handleDragStart(entry.id, event)}
              onDragEnd={() => {
                setDraggedEntryId(null);
                setDragOverEntryId(null);
              }}
              onDragOver={(event) => {
                if (!canManage) return;
                event.preventDefault();
                setDragOverEntryId(entry.id);
              }}
              onDragLeave={() => {
                if (dragOverEntryId === entry.id) {
                  setDragOverEntryId(null);
                }
              }}
              onDrop={(event) => handleDrop(entry.id, event)}
              className={[
                "flex min-h-[220px] flex-col rounded-2xl border p-4 transition",
                entry.enabled === false
                  ? "border-gray-200 bg-gray-50/90"
                  : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
                canManage ? "cursor-grab active:cursor-grabbing" : "",
                draggedEntryId === entry.id ? "opacity-60" : "",
                isDragTarget ? "border-blue-300 ring-2 ring-blue-100" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div
                    className={[
                      "inline-flex h-9 w-9 items-center justify-center rounded-xl border text-gray-500",
                      canManage
                        ? "border-gray-200 bg-gray-50"
                        : "border-gray-100 bg-gray-50/70",
                    ].join(" ")}
                    title={
                      canManage ? "드래그해 순서를 변경하세요." : "읽기 전용"
                    }
                    aria-hidden="true"
                  >
                    <i className="fas fa-grip-vertical text-sm"></i>
                  </div>
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-gray-400">
                      정렬 #{entryIndex + 1}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      드래그해 순서 변경
                    </div>
                  </div>
                </div>
                <span
                  className={[
                    "rounded-full border px-2 py-0.5 text-[10px] font-bold",
                    assignedTier
                      ? "border-blue-100 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-gray-50 text-gray-500",
                  ].join(" ")}
                >
                  {assignedTier ? assignedTierLabel : "미지정"}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span
                  className={[
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold",
                    entry.enabled === false
                      ? "border-gray-200 bg-white text-gray-500"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700",
                  ].join(" ")}
                >
                  {entry.enabled === false ? "비활성" : "사용 중"}
                </span>
                <span className="text-xs text-gray-400">{entry.id}</span>
              </div>

              <label className="mt-4 flex flex-1 items-center justify-center">
                <span className="sr-only">{entry.label} 이모지</span>
                <input
                  value={entry.emoji}
                  onChange={(event) =>
                    onEmojiValueChange(entry.id, event.target.value, entryIndex)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  className={[
                    "h-24 w-full rounded-2xl border text-center text-5xl leading-none transition",
                    entry.enabled === false
                      ? "border-gray-200 bg-white text-gray-400"
                      : "border-gray-200 bg-gray-50 text-gray-900 focus:border-blue-200 focus:bg-white",
                  ].join(" ")}
                  disabled={!canManage}
                  maxLength={8}
                  aria-label={`${entry.label} 이모지`}
                />
              </label>

              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
                <div className="text-sm font-bold text-gray-800">
                  {entry.label}
                </div>
                <div className="mt-1 text-xs leading-5 text-gray-500">
                  {assignedTier
                    ? `${assignedTierLabel}에서 학생이 사용할 수 있습니다.`
                    : "아직 허용 등급이 정해지지 않았습니다."}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onToggleEmojiEnabled(entry.id)}
                disabled={!canManage}
                className={[
                  "mt-3 inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-bold transition",
                  entry.enabled === false
                    ? "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                ].join(" ")}
              >
                {entry.enabled === false ? "다시 사용" : "비활성화"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
};

export default RankEmojiCollectionPanel;
