import React, { useMemo, useState } from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
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
  onMoveEmojiToTier: (
    entryId: string,
    targetTierCode: PointRankPolicyTier["code"],
  ) => void;
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
  onMoveEmojiToTier,
  onReorderEmojiRegistry,
  getTierPreview,
}) => {
  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null);
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<EditingEntryState | null>(
    null,
  );
  const [openTierCodes, setOpenTierCodes] = useState<string[]>(() =>
    [
      ...[...draftRankPolicy.tiers]
        .sort((a, b) => Number(b.minPoints || 0) - Number(a.minPoints || 0))
        .map((tier) => tier.code),
    ].filter(Boolean),
  );

  const displayTiers = useMemo(
    () =>
      [...draftRankPolicy.tiers]
        .map((tier, index) => ({ tier, index }))
        .sort((left, right) => {
          const thresholdDiff =
            Number(right.tier.minPoints || 0) -
            Number(left.tier.minPoints || 0);
          return thresholdDiff !== 0 ? thresholdDiff : left.index - right.index;
        })
        .map(({ tier }) => tier),
    [draftRankPolicy.tiers],
  );

  const groupedEntries = useMemo(() => {
    const assignedIds = new Set(
      displayTiers.flatMap((tier) => tier.allowedEmojiIds || []),
    );
    const fallbackTierCode = displayTiers[displayTiers.length - 1]?.code || "";
    return displayTiers.map((tier) => ({
      tier,
      preview: getTierPreview(tier),
      entries: draftRankPolicy.emojiRegistry.filter(
        (entry) =>
          (tier.allowedEmojiIds || []).includes(entry.id) ||
          (!assignedIds.has(entry.id) && tier.code === fallbackTierCode),
      ),
    }));
  }, [displayTiers, draftRankPolicy.emojiRegistry, getTierPreview]);

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

  const toggleTierOpen = (tierCode: string) => {
    setOpenTierCodes((prev) =>
      prev.includes(tierCode)
        ? prev.filter((code) => code !== tierCode)
        : [...prev, tierCode],
    );
  };

  const handleSubmitEditor = () => {
    if (!editingEntry) return;
    onEmojiValueChange(editingEntry.id, editingEntry.value, editingEntry.index);
    setEditingEntry(null);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-lg font-extrabold text-gray-900">이모지 모음</h2>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">
            총 {draftRankPolicy.emojiRegistry.length}개
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 whitespace-nowrap">
            활성 {enabledEmojiCount}개
          </span>
          <span
            className={[
              "rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap",
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
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
          >
            추가
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canManage}
            className="inline-flex h-11 items-center justify-center rounded-2xl bg-blue-600 px-4 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300 whitespace-nowrap"
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

      <div className="space-y-4">
        {groupedEntries.map(({ tier, preview, entries }) => {
          const isOpen = openTierCodes.includes(tier.code);
          return (
            <article
              key={tier.code}
              className="overflow-hidden rounded-[1.6rem] border border-gray-200 bg-white"
            >
              <button
                type="button"
                onClick={() => toggleTierOpen(tier.code)}
                className="flex w-full flex-wrap items-center justify-between gap-3 bg-gray-50/80 px-5 py-4 text-left transition hover:bg-gray-100/80"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  <PointRankBadge rank={preview} size="sm" showTheme />
                  <span className="inline-flex whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                    기준 {tier.minPoints.toLocaleString("ko-KR")} ₩s
                  </span>
                  <span className="inline-flex whitespace-nowrap rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600">
                    {entries.length}개
                  </span>
                </div>
                <div className="inline-flex items-center gap-2 text-xs font-bold text-gray-500 whitespace-nowrap">
                  <span>{isOpen ? "접기" : "펼치기"}</span>
                  <i
                    className={`fas ${isOpen ? "fa-chevron-up" : "fa-chevron-down"} text-[10px]`}
                    aria-hidden="true"
                  ></i>
                </div>
              </button>

              {isOpen && (
                <div className="space-y-3 p-4 sm:p-5">
                  {entries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500">
                      이 등급에서 처음 해금되는 이모지가 아직 없습니다.
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
                      {entries.map((entry, entryIndex) => {
                        const registryIndex =
                          draftRankPolicy.emojiRegistry.findIndex(
                            (candidate) => candidate.id === entry.id,
                          );
                        const isDragTarget =
                          dragOverEntryId === entry.id &&
                          draggedEntryId !== entry.id;
                        return (
                          <article
                            key={entry.id}
                            onDragOver={(event) => {
                              if (!canManage) return;
                              event.preventDefault();
                              setDragOverEntryId(entry.id);
                            }}
                            onDragLeave={() => {
                              if (dragOverEntryId === entry.id)
                                setDragOverEntryId(null);
                            }}
                            onDrop={(event) => handleDrop(entry.id, event)}
                            className={[
                              "group relative flex min-h-[116px] min-w-0 flex-col rounded-[0.95rem] border px-2 py-2 transition",
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
                            <div className="flex justify-center pb-1">
                              <button
                                type="button"
                                draggable={canManage}
                                onDragStart={(event) =>
                                  handleDragStart(entry.id, event)
                                }
                                onDragEnd={() => {
                                  setDraggedEntryId(null);
                                  setDragOverEntryId(null);
                                }}
                                disabled={!canManage}
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-50 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label={`${entry.emoji} 순서 변경`}
                                title="순서 변경"
                              >
                                <span
                                  className="grid grid-cols-3 gap-[2px]"
                                  aria-hidden="true"
                                >
                                  {Array.from({ length: 6 }).map(
                                    (_, dotIndex) => (
                                      <span
                                        key={`${entry.id}-drag-dot-${dotIndex}`}
                                        className="h-1 w-1 rounded-full bg-current"
                                      ></span>
                                    ),
                                  )}
                                </span>
                              </button>
                            </div>

                            <div className="flex flex-1 flex-col items-center text-center">
                              <div className="relative mt-1">
                                <div
                                  className={[
                                    "inline-flex h-11 w-11 items-center justify-center rounded-[0.95rem] border text-[1.62rem] leading-none shadow-inner",
                                    entry.enabled === false
                                      ? "border-gray-200 bg-white text-gray-300"
                                      : "border-slate-200 bg-slate-50 text-slate-900",
                                  ].join(" ")}
                                  title={entry.label}
                                >
                                  {entry.emoji}
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingEntry({
                                      id: entry.id,
                                      index:
                                        registryIndex >= 0
                                          ? registryIndex
                                          : entryIndex,
                                      label: entry.label,
                                      value: entry.emoji,
                                    })
                                  }
                                  disabled={!canManage}
                                  className="absolute -bottom-1 -left-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={`${entry.label} 이모지 수정`}
                                  title="이모지 수정"
                                >
                                  <i
                                    className="fas fa-pen text-[10px]"
                                    aria-hidden="true"
                                  ></i>
                                </button>
                              </div>

                              <div className="mt-2 w-full max-w-[126px]">
                                <div className="relative">
                                  <select
                                    value={tier.code}
                                    onChange={(event) =>
                                      onMoveEmojiToTier(
                                        entry.id,
                                        event.target
                                          .value as PointRankPolicyTier["code"],
                                      )
                                    }
                                    disabled={!canManage}
                                    className="w-full appearance-none rounded-full border border-gray-200 bg-white px-3 py-1.5 pr-7 text-center text-[11px] font-bold text-gray-700 shadow-sm outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:opacity-60 whitespace-nowrap"
                                    title={entry.label}
                                  >
                                    {displayTiers.map((optionTier) => {
                                      const optionPreview =
                                        getTierPreview(optionTier);
                                      return (
                                        <option
                                          key={`${entry.id}-${optionTier.code}`}
                                          value={optionTier.code}
                                        >
                                          {optionPreview?.label ||
                                            optionPreview?.shortLabel ||
                                            "등급"}
                                        </option>
                                      );
                                    })}
                                  </select>
                                  <i
                                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 fas fa-chevron-down text-[10px] text-gray-400"
                                    aria-hidden="true"
                                  ></i>
                                </div>
                              </div>

                              <div className="mt-auto flex justify-center pt-2">
                                <label
                                  className={[
                                    "relative inline-flex items-center",
                                    canManage
                                      ? "cursor-pointer"
                                      : "cursor-not-allowed",
                                  ].join(" ")}
                                >
                                  <input
                                    type="checkbox"
                                    checked={entry.enabled !== false}
                                    onChange={() =>
                                      onToggleEmojiEnabled(entry.id)
                                    }
                                    disabled={!canManage}
                                    className="peer sr-only"
                                    aria-label={`${entry.label} ${entry.enabled === false ? "사용으로 전환" : "비활성화"}`}
                                  />
                                  <span
                                    className="relative block h-5 w-9 rounded-full bg-gray-200 transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-4 peer-checked:after:border-white peer-focus-visible:ring-4 peer-focus-visible:ring-blue-100 peer-disabled:opacity-60"
                                    aria-hidden="true"
                                  ></span>
                                </label>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {editingEntry && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900">이모지 수정</h3>
                <p className="mt-1 text-xs text-gray-500">
                  {editingEntry.label}
                </p>
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
