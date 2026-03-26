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
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-extrabold text-gray-900">이모지 모음</h2>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
            총 {draftRankPolicy.emojiRegistry.length}개
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            활성 {enabledEmojiCount}개
          </span>
          <span
            className={[
              "rounded-full px-3 py-1 text-xs font-bold",
              hasUnsavedChanges
                ? "border border-amber-200 bg-amber-50 text-amber-800"
                : "border border-gray-200 bg-white text-gray-600",
            ].join(" ")}
          >
            {hasUnsavedChanges ? "미저장" : "저장됨"}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
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
            className="h-11 w-20 rounded-2xl border border-gray-200 bg-white px-3 text-center text-2xl font-bold text-gray-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
            maxLength={8}
            disabled={!canManage}
            aria-label="새 이모지"
          />
          <button
            type="button"
            onClick={onAddEmoji}
            disabled={!canManage}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            추가
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canManage}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            이모지 모음 저장
          </button>
        </div>
      </div>

      {saveFeedbackMessage && saveFeedbackTone && (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}
        >
          {saveFeedbackMessage}
        </div>
      )}

      <div className="rounded-[1.6rem] border border-gray-200 bg-white p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
          {draftRankPolicy.emojiRegistry.map((entry, entryIndex) => {
            const assignedTier =
              draftRankPolicy.tiers.find((tier) =>
                (tier.allowedEmojiIds || []).includes(entry.id),
              ) || null;
            const assignedTierPreview = assignedTier
              ? getTierPreview(assignedTier)
              : null;
            const assignedTierLabel =
              assignedTierPreview?.label ||
              assignedTierPreview?.shortLabel ||
              assignedTier?.code ||
              "미지정";
            const assignedTierBadgeClass =
              assignedTierPreview?.badgeClass ||
              "border-gray-200 bg-gray-50 text-gray-500";
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
                  "group relative flex min-h-[164px] flex-col rounded-[1.35rem] border p-3 transition",
                  entry.enabled === false
                    ? "border-gray-200 bg-slate-50/95"
                    : "border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm",
                  draggedEntryId === entry.id ? "opacity-60" : "",
                  isDragTarget
                    ? "border-blue-300 bg-blue-50/70 ring-1 ring-blue-100"
                    : "",
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
                  className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 transition hover:border-gray-300 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`${entry.emoji} 순서 변경`}
                  title="순서 변경"
                >
                  <i
                    className="fas fa-grip-vertical text-[11px]"
                    aria-hidden="true"
                  ></i>
                </button>

                <div className="flex flex-1 flex-col items-center justify-center pb-2 pt-5 text-center">
                  <div
                    className={[
                      "inline-flex h-16 w-16 items-center justify-center rounded-[1.45rem] border text-[2.5rem] leading-none shadow-inner",
                      entry.enabled === false
                        ? "border-gray-200 bg-white text-gray-300"
                        : "border-slate-200 bg-slate-50 text-slate-900",
                    ].join(" ")}
                    aria-hidden="true"
                    title={entry.label}
                  >
                    {entry.emoji}
                  </div>

                  <span
                    className={[
                      "mt-4 inline-flex min-h-8 items-center justify-center rounded-full border px-3 py-1.5 text-center text-[11px] font-bold leading-4 break-keep",
                      assignedTierBadgeClass,
                    ].join(" ")}
                    title={assignedTierLabel}
                  >
                    {assignedTierLabel}
                  </span>
                </div>

                <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() =>
                      handleOpenEditor(
                        entry.id,
                        entryIndex,
                        entry.emoji,
                        entry.label,
                      )
                    }
                    disabled={!canManage}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label={`${entry.label} 이모지 수정`}
                    title="이모지 수정"
                  >
                    <i className="fas fa-pen text-[11px]" aria-hidden="true"></i>
                  </button>

                  <label
                    className={[
                      "relative inline-flex items-center",
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
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {editingEntry && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900">이모지 수정</h3>
                <p className="mt-1 text-xs text-gray-500">{editingEntry.label}</p>
              </div>
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
