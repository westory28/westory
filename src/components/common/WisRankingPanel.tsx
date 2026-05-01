import React, { useEffect, useState } from "react";
import { getWisHallOfFameGradeLeaderboard, getWisHallOfFameSnapshot } from "../../lib/wisHallOfFame";
import type { SystemConfig, WisHallOfFameEntry } from "../../types";

interface WisRankingPanelProps {
  config: SystemConfig | null | undefined;
}

const formatWis = (value: unknown) => {
  const amount = Math.max(0, Number(value || 0));
  return `${amount.toLocaleString("ko-KR")} W$`;
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

const WisRankingPanel: React.FC<WisRankingPanelProps> = ({ config }) => {
  const [entries, setEntries] = useState<WisHallOfFameEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getWisHallOfFameSnapshot(config)
      .then((snapshot) => {
        if (cancelled) return;
        setEntries(getWisHallOfFameGradeLeaderboard(snapshot).slice(0, 5));
      })
      .catch((error) => {
        console.warn("Failed to load wis ranking:", error);
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
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
          <div className="flex h-full min-h-[160px] items-center justify-center text-sm font-bold text-gray-400">
            순위를 불러오는 중...
          </div>
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
            return (
              <div
                key={entry.uid}
                className={`grid grid-cols-[72px_minmax(0,1fr)_92px_minmax(80px,auto)] items-center gap-3 rounded-lg border px-3 py-2.5 ${rankTone(rank)}`}
              >
                <div className="flex items-center gap-2">
                  {iconClassName ? (
                    <i className={`${iconClassName} text-lg`}></i>
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                      {rank}
                    </span>
                  )}
                  {rank <= 3 && (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/70 text-sm font-black">
                      {rank}
                    </span>
                  )}
                </div>
                <div className="truncate text-base font-extrabold text-gray-900">
                  {entry.displayName || entry.studentName}
                </div>
                <div className="truncate text-sm font-bold text-gray-500">
                  {entry.grade}학년 {entry.class}반
                </div>
                <div className="text-right text-base font-black text-blue-600">
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
