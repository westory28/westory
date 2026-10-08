import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InlineLoading } from "./LoadingState";
import PointRankBadge from "./PointRankBadge";
import WisIcon from "./WisIcon";
import { getWisHallOfFameGradeLeaderboard } from "../../lib/wisHallOfFame";
import { getPointPolicy } from "../../lib/points";
import { getStudentPointHallOfFame } from "../../lib/studentWis";
import { getCanonicalWisHallOfFame } from "../../lib/pointEconomyAdapter";
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
  hallOfFamePath?: string;
}

const formatWis = (value: unknown) => {
  const amount = Math.max(0, Number(value || 0));
  return amount.toLocaleString("ko-KR");
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

const rankAccentClassName = (rank: number) => {
  if (rank >= 1 && rank <= 5) return `wis-ranking-row--rank-${rank}`;
  return "wis-ranking-row--default";
};

const buildRankWallet = (entry: WisHallOfFameEntry): PointWallet => ({
  uid: entry.uid,
  studentName: entry.studentName,
  grade: entry.grade,
  class: entry.class,
  number: entry.number || "",
  balance: Number(entry.currentBalance || 0),
  earnedTotal: Number(entry.cumulativeEarned || 0),
  rankEarnedTotal: Number(entry.cumulativeEarned || 0),
  spentTotal: 0,
  adjustedTotal: 0,
  rankSnapshot: null,
});

const WisRankingPanel: React.FC<WisRankingPanelProps> = ({
  config,
  hallOfFamePath,
}) => {
  const navigate = useNavigate();
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
          hallOfFamePath?.startsWith("/student")
            ? getStudentPointHallOfFame(config)
            : getCanonicalWisHallOfFame(config),
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
  }, [config, hallOfFamePath]);

  return (
    <div className="wis-ranking-panel flex h-full min-h-[260px] flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:min-h-0">
      <div className="wis-ranking-heading flex items-center justify-between gap-2">
        {hallOfFamePath ? (
          <button
            type="button"
            onClick={() => navigate(hallOfFamePath)}
            className="wis-ranking-title wis-ranking-title-link flex items-center rounded-md bg-transparent p-0 text-left text-lg font-extrabold text-gray-900 transition hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="명예의 전당으로 이동"
          >
            <i className="fas fa-trophy mr-2 text-blue-600"></i>
            위스 순위
          </button>
        ) : (
          <h3 className="wis-ranking-title flex items-center text-lg font-extrabold text-gray-900">
            <i className="fas fa-trophy mr-2 text-blue-600"></i>
            위스 순위
          </h3>
        )}
        {hallOfFamePath && (
          <button
            type="button"
            onClick={() => navigate(hallOfFamePath)}
            className="wis-ranking-more-button inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 text-xs font-black text-blue-700 transition hover:border-blue-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            aria-label="명예의 전당 더보기"
          >
            더보기
            <i
              className="fas fa-chevron-right text-[10px]"
              aria-hidden="true"
            />
          </button>
        )}
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
            const rank = index + 1;
            const iconClassName = rankIcon(rank);
            const entryRank = rankPolicy
              ? getPointRankDisplay({
                  rankPolicy,
                  wallet: buildRankWallet(entry),
                })
              : null;
            const rankAccent = rankAccentClassName(rank);
            return (
              <div
                key={entry.uid}
                className={`wis-ranking-row ${rankAccent} rounded-lg border ${rankTone(rank)}`}
              >
                <span className="wis-ranking-place">
                  <span
                    className="wis-ranking-rank-medal"
                    aria-label={`${rank}위`}
                  >
                    {rank}
                  </span>
                  {iconClassName && (
                    <i
                      className={`wis-ranking-crown ${iconClassName}`}
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="wis-ranking-person">
                  <span className="wis-ranking-identity">
                    <span className="wis-ranking-profile" aria-hidden="true">
                      {entry.profileIcon || defaultProfileIcon}
                    </span>
                    <span className="wis-ranking-name">
                      {entry.displayName || entry.studentName}
                    </span>
                  </span>
                  <PointRankBadge
                    rank={entryRank}
                    size="sm"
                    className="wis-ranking-rank-badge"
                  />
                </span>
                <span className="wis-ranking-classroom">
                  <span>
                    {entry.grade}학년 {entry.class}반
                  </span>
                  {entry.number && <span>{entry.number}번</span>}
                </span>
                <span
                  className="wis-ranking-score"
                  aria-label={`${formatWis(entry.cumulativeEarned)} 위스`}
                >
                  <span>{formatWis(entry.cumulativeEarned)}</span>
                  <WisIcon />
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default WisRankingPanel;
