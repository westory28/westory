import React from "react";
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

const KOREAN = {
  title: "\u0034\uC704\uBD80\uD130 \uC774\uC5B4\uC9C0\uB294 \uC21C\uC704",
  subtitle:
    "\uB3D9\uC810\uC790\uB294 \uAC19\uC740 \uC21C\uC704\uB85C \uD568\uAED8 \uD45C\uC2DC\uB3FC\uC694.",
  empty:
    "\uC544\uC9C1 \uACF5\uAC1C\uD560 \uCD94\uAC00 \uC21C\uC704\uAC00 \uC5C6\uC5B4\uC694.",
  peopleSuffix: "\uBA85",
  tiePrefix: "\uACF5\uB3D9",
  gradeSuffix: "\uD559\uB144",
  classSuffix: "\uBC18",
} as const;

const formatRailWis = (value: unknown) =>
  `${Number(value || 0).toLocaleString("ko-KR")} \u16B9s`;

const formatGradeClass = (entry: WisHallOfFameEntry) =>
  `${entry.grade}${KOREAN.gradeSuffix} ${entry.class}${KOREAN.classSuffix}`;

const WisHallOfFameLeaderboardList: React.FC<
  WisHallOfFameLeaderboardListProps
> = ({
  entries = [],
  hallOfFameConfig: _hallOfFameConfig = null,
  title = KOREAN.title,
  subtitle = KOREAN.subtitle,
  emptyMessage = KOREAN.empty,
  className = "",
  style,
  headerAccessory = null,
}) => {
  const safeEntries = entries || [];
  const hasTieForRank = (rank: number) =>
    safeEntries.filter((entry) => entry.rank === rank).length > 1;

  return (
    <div
      className={`flex h-full min-h-[13.75rem] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)] sm:min-h-[15rem] ${className}`}
      style={style}
    >
      <div className="border-b border-slate-100 bg-slate-50 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
            <p className="mt-1 break-keep text-[13px] leading-5 text-slate-500">
              {subtitle}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAccessory}
            <span className="inline-flex items-center whitespace-nowrap rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
              {safeEntries.length}
              {KOREAN.peopleSuffix}
            </span>
          </div>
        </div>
      </div>

      {safeEntries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm font-semibold text-slate-500">
          {emptyMessage}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3 sm:px-4 sm:py-3.5">
          <div className="space-y-2">
            {safeEntries.map((entry, index) => (
              <div
                key={`${entry.uid}-${entry.rank}-${index}`}
                className="rounded-[1.1rem] border border-slate-200 bg-white px-2.5 py-2.25 shadow-[0_10px_24px_rgba(15,23,42,0.06)] sm:px-3.25 sm:py-2.5"
              >
                <div className="grid grid-cols-[2.7rem_minmax(0,1fr)_auto_auto] items-center gap-x-1.5 sm:grid-cols-[3.55rem_minmax(0,1fr)_auto_auto] sm:gap-x-2.25">
                  <div className="inline-flex min-h-7 min-w-[2.7rem] shrink-0 items-center justify-center whitespace-nowrap rounded-[0.95rem] bg-slate-900 px-1.5 text-[10px] font-black text-white shadow-[0_10px_20px_rgba(15,23,42,0.18)] sm:min-h-9 sm:min-w-[3.55rem] sm:px-2 sm:text-[12px]">
                    {hasTieForRank(entry.rank)
                      ? `${KOREAN.tiePrefix} ${entry.rank}`
                      : entry.rank}
                  </div>

                  <span className="min-w-0 truncate text-[12px] font-black leading-4 text-slate-900 sm:text-sm">
                    {entry.displayName || entry.studentName}
                  </span>

                  <span className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-slate-200 bg-slate-50 px-1.5 py-1 text-[9px] font-bold text-slate-700 sm:px-2.25 sm:text-[11px]">
                    {formatGradeClass(entry)}
                  </span>

                  <div className="inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border border-white/15 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.94))] px-1.75 py-1 text-[10px] font-black leading-none text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] sm:min-h-8 sm:px-2.75 sm:text-[12px]">
                    {formatRailWis(entry.cumulativeEarned)}
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
