import React from "react";
import { formatWisAmount } from "../../lib/pointFormatters";
import type {
  HallOfFameInterfaceConfig,
  WisHallOfFameEntry,
} from "../../types";

interface WisHallOfFameLeaderboardListProps {
  entries?: WisHallOfFameEntry[] | null;
  hallOfFameConfig?: HallOfFameInterfaceConfig | null;
  title?: string;
  subtitle?: string;
  emptyMessage?: string;
  className?: string;
  style?: React.CSSProperties;
  headerAccessory?: React.ReactNode;
}

const WisHallOfFameLeaderboardList: React.FC<
  WisHallOfFameLeaderboardListProps
> = ({
  entries = [],
  hallOfFameConfig: _hallOfFameConfig = null,
  title = "4위부터 이어지는 순위",
  subtitle = "동점자는 같은 순위로 함께 표시해요.",
  emptyMessage = "아직 공개된 추가 순위가 없어요.",
  className = "",
  style,
  headerAccessory = null,
}) => {
  const safeEntries = entries || [];
  const hasTieForRank = (rank: number) =>
    safeEntries.filter((entry) => entry.rank === rank).length > 1;

  return (
    <div
      className={`flex h-full min-h-[16rem] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)] sm:min-h-[18rem] ${className}`}
      style={style}
    >
      <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
            <p className="mt-1 break-keep text-sm text-slate-500">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAccessory}
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">
              {safeEntries.length}명
            </span>
          </div>
        </div>
      </div>

      {safeEntries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm font-semibold text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="space-y-2.5">
            {safeEntries.map((entry, index) => (
              <div
                key={`${entry.uid}-${entry.rank}-${index}`}
                className="rounded-2xl border border-slate-200 bg-white px-3.5 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] sm:px-4"
              >
                <div className="flex flex-wrap items-center gap-2.5 sm:flex-nowrap">
                  <div className="inline-flex min-h-9 min-w-[4rem] shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-slate-900 px-2.5 text-[13px] font-black text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)]">
                    {hasTieForRank(entry.rank)
                      ? `공동 ${entry.rank}`
                      : entry.rank}
                  </div>

                  <div className="shrink-0 text-[1.75rem] leading-none drop-shadow-[0_4px_8px_rgba(15,23,42,0.16)]">
                    {entry.profileIcon || "🏆"}
                  </div>

                  <div className="flex min-w-0 flex-1 items-center gap-2.25">
                    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                      {entry.grade}학년 {entry.class}반
                    </span>
                    <span className="min-w-0 truncate text-sm font-black leading-5 text-slate-900 sm:text-[15px]">
                      {entry.displayName || entry.studentName}
                    </span>
                    <div className="ml-auto inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full border border-white/15 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.94))] px-3 py-1 text-[13px] font-black leading-none text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]">
                      누적 {formatWisAmount(entry.cumulativeEarned)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WisHallOfFameLeaderboardList;
