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
    <div className="wis-ranking-panel flex h-full min-h-[260px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="wis-ranking-title flex items-center text-lg font-extrabold text-gray-900">
          <i className="fas fa-trophy mr-2 text-blue-600"></i>
          위스 순위
        </h3>
      </div>

      <div className="wis-ranking-list min-h-0 flex-1 space-y-2">
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
                className={`wis-ranking-row rounded-lg border px-2 py-2 sm:grid sm:grid-cols-[72px_minmax(0,1fr)_92px_minmax(80px,auto)] sm:items-center sm:gap-3 sm:px-3 sm:py-2.5 max-[1120px]:sm:grid-cols-[52px_minmax(0,1fr)_70px_minmax(64px,auto)] max-[1120px]:sm:gap-1.5 max-[1120px]:sm:px-2 max-[1120px]:sm:py-2 ${rankTone(rank)}`}
              >
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:hidden">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                      rank <= 3 ? "bg-white/70" : "bg-slate-900 text-white"
                    }`}
                  >
                    {rank}
                  </span>
                  <span
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    {iconClassName && (
                      <i className={`${iconClassName} text-xs`}></i>
                    )}
                  </span>
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/80 text-[11px] shadow-sm">
                    {entry.profileIcon || defaultProfileIcon}
                  </span>
                  <span className="text-sm font-extrabold leading-snug text-gray-900">
                    {entry.displayName || entry.studentName}
                  </span>
                  {entryRank && (
                    <span
                      className={`inline-flex min-h-[1.25rem] shrink-0 items-center justify-center rounded-full border px-1.5 text-[10px] font-bold leading-none ${entryRank.badgeClass}`}
                    >
                      {entryRank.shortLabel || entryRank.label}
                    </span>
                  )}
                  <span className="text-[11px] font-bold leading-snug text-gray-500">
                    {entry.grade}학년 {entry.class}반
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-black leading-snug text-blue-600">
                    {formatWis(entry.currentBalance)}
                  </span>
                </div>

                <div className="wis-ranking-rank hidden grid-cols-[2rem_1.25rem] items-center gap-1.5 sm:grid max-[1120px]:sm:grid-cols-[1.75rem_0.875rem] max-[1120px]:sm:gap-1">
                  <span
                    className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-black max-[1120px]:h-7 max-[1120px]:w-7 max-[1120px]:text-xs ${
                      rank <= 3 ? "bg-white/70" : "bg-slate-900 text-white"
                    }`}
                  >
                    {rank}
                  </span>
                  {iconClassName && (
                    <i
                      className={`${iconClassName} justify-self-center text-base max-[1120px]:text-xs`}
                      aria-hidden="true"
                    ></i>
                  )}
                </div>
                <div className="wis-ranking-student hidden min-w-0 items-center gap-1.5 sm:flex max-[1120px]:sm:gap-1">
                  <span className="wis-ranking-profile inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-sm shadow-sm max-[1120px]:h-5 max-[1120px]:w-5 max-[1120px]:text-xs">
                    {entry.profileIcon || defaultProfileIcon}
                  </span>
                  <span className="wis-ranking-name min-w-0 truncate text-base font-extrabold text-gray-900 max-[1120px]:text-[13px]">
                    {entry.displayName || entry.studentName}
                  </span>
                  <PointRankBadge
                    rank={entryRank}
                    size="sm"
                    className="wis-ranking-rank-badge max-[1120px]:!min-h-[1.45rem] max-[1120px]:!min-w-[2.75rem] max-[1120px]:!px-1.5 max-[1120px]:!py-0 max-[1120px]:!text-[10px]"
                  />
                </div>
                <div className="wis-ranking-class hidden truncate text-sm font-bold text-gray-500 sm:block max-[1120px]:text-[11px]">
                  {entry.grade}학년 {entry.class}반
                </div>
                <div className="wis-ranking-score hidden text-right text-base font-black text-blue-600 sm:block max-[1120px]:text-[13px]">
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
