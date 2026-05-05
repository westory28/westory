import React, { useEffect, useState } from "react";
import { InlineLoading } from "./LoadingState";
import PointRankBadge from "./PointRankBadge";
import {
  getWisHallOfFameGradeLeaderboard,
  getWisHallOfFameSnapshot,
} from "../../lib/wisHallOfFame";
import { getPointPolicy } from "../../lib/points";
import {
  getPointRankDefaultEmojiValue,
  getPointRankDisplay,
} from "../../lib/pointRanks";
import type {
  PointPolicy,
  PointWallet,
  SystemConfig,
  WisHallOfFameEntry,
} from "../../types";

interface WisRankingPanelProps {
  config: SystemConfig | null | undefined;
}

const formatWis = (value: unknown) => {
  const amount = Math.max(0, Number(value || 0));
  return `${amount.toLocaleString("ko-KR")} ₩s`;
};

const rankTone = (rank: number) => {
  if (rank === 1) return "border-amber-200 bg-amber-50 text-amber-700";
  if (rank === 2) return "border-slate-200 bg-slate-50 text-slate-600";
  if (rank === 3) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-gray-200 bg-white text-gray-900";
};

const rankIcon = (rank: number) => {
  if (rank === 1) return "fas fa-crown text-amber-500";
  if (rank === 2) return "fas fa-crown text-slate-400";
  if (rank === 3) return "fas fa-crown text-orange-500";
  return "";
};

const buildRankWallet = (entry: WisHallOfFameEntry): PointWallet => ({
  uid: entry.uid,
  studentName: entry.studentName,
  grade: entry.grade,
  class: entry.class,
  number: "",
  balance: Number(entry.currentBalance || 0),
  earnedTotal: Number(entry.cumulativeEarned || 0),
  rankEarnedTotal: Number(entry.cumulativeEarned || 0),
  spentTotal: 0,
  adjustedTotal: 0,
  rankSnapshot: null,
});

const WisRankingPanel: React.FC<WisRankingPanelProps> = ({ config }) => {
  const [entries, setEntries] = useState<WisHallOfFameEntry[]>([]);
  const [rankPolicy, setRankPolicy] = useState<
    PointPolicy["rankPolicy"] | null
  >(null);
  const [defaultProfileIcon, setDefaultProfileIcon] = useState("😀");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const [snapshot, pointPolicy] = await Promise.all([
          getWisHallOfFameSnapshot(config),
          getPointPolicy(config).catch((error) => {
            console.warn("Failed to load wis ranking policy:", error);
            return null;
          }),
        ]);
        if (cancelled) return;
        setEntries(getWisHallOfFameGradeLeaderboard(snapshot).slice(0, 5));
        setRankPolicy(pointPolicy?.rankPolicy || null);
        setDefaultProfileIcon(
          pointPolicy?.rankPolicy
            ? getPointRankDefaultEmojiValue(pointPolicy.rankPolicy)
            : "😀",
        );
      } catch (error) {
        console.warn("Failed to load wis ranking:", error);
        if (!cancelled) {
          setEntries([]);
          setRankPolicy(null);
          setDefaultProfileIcon("😀");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  return (
    <div className="flex h-full min-h-[260px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-trophy mr-2 text-blue-600"></i>
          위스 순위
        </h3>
      </div>

      <div className="min-h-0 flex-1 space-y-2">
        {loading && (
          <InlineLoading
            className="flex h-full min-h-[160px] items-center"
            message="순위를 불러오는 중입니다."
            showWarning
          />
        )}

        {!loading && entries.length === 0 && (
          <div className="flex h-full min-h-[160px] items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-bold text-gray-400">
            표시할 위스 순위가 없습니다.
          </div>
        )}

        {!loading &&
          entries.map((entry, index) => {
            const rank = Number(entry.rank || index + 1);
            const iconClassName = rankIcon(rank);
            const entryRank = rankPolicy
              ? getPointRankDisplay({
                  rankPolicy,
                  wallet: buildRankWallet(entry),
                })
              : null;
            return (
              <div
                key={entry.uid}
                className={`grid grid-cols-[2.35rem_minmax(4.25rem,1fr)_auto_auto_auto] items-center gap-1.5 rounded-lg border px-2 py-2 sm:grid-cols-[2.75rem_minmax(5rem,1fr)_auto_auto_auto] sm:px-2.5 sm:py-2.5 ${rankTone(rank)}`}
              >
                <div className="flex min-w-0 items-center gap-1">
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black sm:h-7 sm:w-7 sm:text-sm ${
                      rank <= 3 ? "bg-white/70" : "bg-slate-900 text-white"
                    }`}
                  >
                    {rank}
                  </span>
                  {iconClassName ? (
                    <i
                      className={`${iconClassName} shrink-0 text-[11px] sm:text-xs`}
                      aria-hidden="true"
                    ></i>
                  ) : null}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 text-[11px] shadow-sm sm:h-5 sm:w-5 sm:text-xs">
                    {entry.profileIcon || defaultProfileIcon}
                  </span>
                  <span className="min-w-0 truncate text-[clamp(0.75rem,0.95vw,0.9375rem)] font-extrabold leading-tight text-gray-900">
                    {entry.displayName || entry.studentName}
                  </span>
                </div>
                <div className="shrink-0">
                  <PointRankBadge
                    rank={entryRank}
                    size="sm"
                    className="!min-h-[1.45rem] !min-w-[2.75rem] !px-1.5 !py-0 !text-[10px]"
                  />
                </div>
                <div className="whitespace-nowrap text-[clamp(0.625rem,0.82vw,0.8125rem)] font-bold text-gray-500">
                  {entry.grade}학년 {entry.class}반
                </div>
                <div className="whitespace-nowrap text-right text-[clamp(0.6875rem,0.92vw,0.9375rem)] font-black text-blue-600">
                  {formatWis(entry.currentBalance)}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default WisRankingPanel;
