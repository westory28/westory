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
            {safeEntries.map((entry, index) => {
              const rankLabel = hasTieForRank(entry.rank)
                ? `${KOREAN.tiePrefix} ${entry.rank}`
                : String(entry.rank);
              return (
                <div
                  key={`${entry.uid}-${entry.rank}-${index}`}
                  className="rounded-[1.05rem] border border-slate-200/85 bg-white px-2.5 py-2.25 shadow-[0_10px_22px_rgba(15,23,42,0.055)] transition hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] sm:px-3 sm:py-2.5"
                >
                  <div className="grid grid-cols-[2.35rem_minmax(0,1fr)_minmax(4.85rem,auto)] items-center gap-x-2 sm:grid-cols-[2.6rem_minmax(0,1fr)_minmax(5.25rem,auto)] sm:gap-x-2.5">
                    <div
                      className="inline-flex h-8 w-[2.35rem] shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-slate-950 px-1 text-[10px] font-black leading-none text-white shadow-[0_10px_18px_rgba(15,23,42,0.18)] sm:h-9 sm:w-[2.6rem] sm:text-[11px]"
                      aria-label={`${rankLabel}위`}
                    >
                      {rankLabel}
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-black leading-5 text-slate-950 sm:text-[14px]">
                        {entry.displayName || entry.studentName}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] font-bold leading-4 text-slate-500 sm:text-[11px]">
                        {formatGradeClass(entry)}
                      </div>
                    </div>

                    <div className="inline-flex min-h-8 max-w-full shrink-0 items-center justify-center justify-self-end whitespace-nowrap rounded-full border border-cyan-100/25 bg-[linear-gradient(135deg,_rgba(15,23,42,0.96),_rgba(14,116,144,0.94))] px-2 py-1 text-[10px] font-black leading-none text-white shadow-[0_12px_22px_rgba(15,23,42,0.16)] sm:px-2.5 sm:text-[11px]">
                      <span className="tabular-nums">
                        {formatWisAmount(entry.cumulativeEarned)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default WisHallOfFameLeaderboardList;
