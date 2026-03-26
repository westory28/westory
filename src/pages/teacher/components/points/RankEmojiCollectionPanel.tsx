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
  hasUnsavedChanges: boolean;
  saveFeedbackMessage: string;
  saveFeedbackTone: "success" | "error" | "warning" | null;
  onNewEmojiValueChange: (value: string) => void;
  onAddEmoji: () => void;
  onSave: () => void;
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

type EditingEntryState = {
  id: string;
  index: number;
  label: string;
  value: string;
};

const feedbackToneClassName: Record<"success" | "error" | "warning", string> = {
  success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border border-red-200 bg-red-50 text-red-700",
  warning: "border border-amber-200 bg-amber-50 text-amber-800",
};

const RankEmojiCollectionPanel: React.FC<RankEmojiCollectionPanelProps> = ({
  canManage,
  draftRankPolicy,
  enabledEmojiCount,
  newEmojiValue,
  hasUnsavedChanges,
  saveFeedbackMessage,
  saveFeedbackTone,
  onNewEmojiValueChange,
  onAddEmoji,
  onSave,
  onEmojiValueChange,
  onToggleEmojiEnabled,
  onReorderEmojiRegistry,
  getTierPreview,
}) => {
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<EditingEntryState | null>(
    null,
  );

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

  const handleOpenEditor = (
    entryId: string,
    entryIndex: number,
    emoji: string,
    label: string,
  ) => {
    setEditingEntry({
      id: entryId,
      index: entryIndex,
      label,
      value: emoji,
    });
  };

  const handleSubmitEditor = () => {
    if (!editingEntry) return;
    onEmojiValueChange(
      editingEntry.id,
      editingEntry.value,
      editingEntry.index,
    );
    setEditingEntry(null);
  };

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-extrabold text-gray-900">이모지 모음</h2>
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
              총 {draftRankPolicy.emojiRegistry.length}개
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              활성 {enabledEmojiCount}개
            </span>
          </div>
          <div className="flex flex-col gap-3 xl:min-w-[380px] xl:items-end">
            <div className="flex w-full flex-wrap items-center gap-2 xl:justify-end">
              <input
                value={newEmojiValue}
                onChange={(event) => onNewEmojiValueChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAddEmoji();
                  }
                }}
                placeholder="😀"
                className="h-11 w-24 rounded-xl border border-gray-200 bg-white px-3 text-center text-2xl font-bold text-gray-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
                maxLength={8}
                disabled={!canManage}
                aria-label="새 이모지"
              />
              <button
                type="button"
                onClick={onAddEmoji}
                disabled={!canManage}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                추가
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={!canManage}
                className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                이모지 모음 저장
              </button>
            </div>
            <div
              className={[
                "w-full rounded-2xl border px-4 py-3 text-sm xl:max-w-[380px]",
                hasUnsavedChanges
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : "border-gray-200 bg-gray-50 text-gray-600",
              ].join(" ")}
            >
              {hasUnsavedChanges
                ? "이모지 변경사항이 저장 대기 중입니다."
                : "저장된 이모지 모음과 같습니다."}
            </div>
            {saveFeedbackMessage && saveFeedbackTone && (
              <div
                className={`w-full rounded-2xl px-4 py-3 text-sm xl:max-w-[380px] ${feedbackToneClassName[saveFeedbackTone]}`}
              >
                {saveFeedbackMessage}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
          {draftRankPolicy.emojiRegistry.map((entry, entryIndex) => {
            const assignedTier =
              draftRankPolicy.tiers.find((tier) =>
                (tier.allowedEmojiIds || []).includes(entry.id),
              ) || null;
            const assignedTierPreview = assignedTier
              ? getTierPreview(assignedTier)
              : null;
            const assignedTierLabel =
              assignedTierPreview?.shortLabel ||
              assignedTierPreview?.label ||
              assignedTier?.code ||
              "미지정";
            const isDragTarget =
              dragOverEntryId === entry.id && draggedEntryId !== entry.id;

            return (
              <article
                key={entry.id}
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
                  "group flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
                  entry.enabled === false
                    ? "border-gray-200 bg-slate-50/90"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
                  draggedEntryId === entry.id ? "opacity-60" : "",
                  isDragTarget ? "border-blue-300 bg-blue-50/70 ring-1 ring-blue-100" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <button
                  type="button"
                  draggable={canManage}
                  onDragStart={(event) => handleDragStart(entry.id, event)}
                  onDragEnd={() => {
                    setDraggedEntryId(null);
                    setDragOverEntryId(null);
                  }}
                  disabled={!canManage}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-500 transition hover:border-gray-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`${entry.emoji} 순서 변경`}
                  title="순서 변경"
                >
                  <i className="fas fa-grip-vertical text-xs" aria-hidden="true"></i>
                </button>

                <div
                  className={[
                    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-2xl leading-none",
                    entry.enabled === false
                      ? "border-gray-200 bg-white text-gray-400"
                      : "border-gray-200 bg-gray-50 text-gray-900",
                  ].join(" ")}
                  aria-hidden="true"
                  title={entry.label}
                >
                  {entry.emoji}
                </div>

                <div className="min-w-0 flex-1">
                  <span
                    className={[
                      "inline-flex max-w-full items-center rounded-full border px-3 py-1.5 text-xs font-bold",
                      assignedTier
                        ? "border-blue-100 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-gray-50 text-gray-500",
                    ].join(" ")}
                    title={assignedTierLabel}
                  >
                    <span className="truncate">{assignedTierLabel}</span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    handleOpenEditor(entry.id, entryIndex, entry.emoji, entry.label)
                  }
                  disabled={!canManage}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={`${entry.label} 이모지 수정`}
                  title="이모지 수정"
                >
                  <i className="fas fa-pencil-alt text-xs" aria-hidden="true"></i>
                </button>

                <label
                  className={[
                    "relative inline-flex shrink-0 items-center",
                    canManage ? "cursor-pointer" : "cursor-not-allowed",
                  ].join(" ")}
                  title={entry.enabled === false ? "비활성 상태" : "사용 중"}
                >
                  <input
                    type="checkbox"
                    checked={entry.enabled !== false}
                    onChange={() => onToggleEmojiEnabled(entry.id)}
                    disabled={!canManage}
                    className="peer sr-only"
                    aria-label={`${entry.label} ${
                      entry.enabled === false ? "사용으로 전환" : "비활성화"
                    }`}
                  />
                  <span
                    className="relative block h-6 w-11 rounded-full bg-gray-200 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus-visible:ring-4 peer-focus-visible:ring-blue-100 peer-disabled:opacity-60"
                    aria-hidden="true"
                  ></span>
                </label>
              </article>
            );
          })}
        </div>
      </div>

      {editingEntry && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-gray-900">이모지 편집</h3>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-50"
                aria-label="이모지 수정 닫기"
              >
                <i className="fas fa-times text-xs" aria-hidden="true"></i>
              </button>
            </div>
            <input
              value={editingEntry.value}
              onChange={(event) =>
                setEditingEntry((prev) =>
                  prev ? { ...prev, value: event.target.value } : prev,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSubmitEditor();
                }
              }}
              className="mt-4 h-16 w-full rounded-xl border border-gray-300 bg-white px-4 text-center text-4xl text-gray-900"
              maxLength={8}
              aria-label={`${editingEntry.label} 이모지`}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSubmitEditor}
                className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-700"
              >
                적용
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default RankEmojiCollectionPanel;
