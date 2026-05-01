import React, { useMemo, useState } from "react";
import type { ScoreBreakdownItem, ScoreRow } from "../../lib/studentScores";
import { getTypeLabel } from "../../lib/studentScores";

interface SegmentRef {
  rowId: string;
  itemKey: string;
}

interface SegmentedAchievementChartProps {
  rows: ScoreRow[];
  emptyMessage?: string;
  maxRows?: number;
}

const isSameSegment = (left: SegmentRef | null, right: SegmentRef | null) =>
  left?.rowId === right?.rowId && left?.itemKey === right?.itemKey;

const getSegmentId = (row: ScoreRow, item: ScoreBreakdownItem): SegmentRef => ({
  rowId: row.id,
  itemKey: item.key,
});

const formatPoint = (value: number) => `${Number(value || 0).toFixed(1).replace(/\.0$/, "")}점`;

const SegmentedAchievementChart: React.FC<SegmentedAchievementChartProps> = ({
  rows,
  emptyMessage = "표시할 성적 데이터가 없습니다.",
  maxRows,
}) => {
  const [activeSegment, setActiveSegment] = useState<SegmentRef | null>(null);
  const visibleRows = useMemo(
    () => (maxRows ? rows.slice(0, maxRows) : rows),
    [maxRows, rows],
  );

  if (!visibleRows.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {visibleRows.map((row) => {
        const filledItems = row.breakdown.filter((item) => item.entered && item.weighted > 0);
        const remaining = Math.max(0, 100 - row.total);

        return (
          <div key={row.id} className="grid gap-2 sm:grid-cols-[74px_1fr_54px] sm:items-center">
            <div className="text-sm font-extrabold text-slate-700">{row.subject}</div>
            <div className="relative">
              <div className="flex h-7 w-full gap-[3px] rounded-lg bg-slate-100 p-[3px] ring-1 ring-slate-200">
                {filledItems.map((item) => {
                  const segment = getSegmentId(row, item);
                  const active = isSameSegment(activeSegment, segment);
                  const width = Math.max(2, Math.min(100, item.weighted));

                  return (
                    <button
                      key={item.key}
                      type="button"
                      aria-label={`${row.subject} ${item.name} ${formatPoint(item.weighted)} 반영`}
                      onBlur={() => setActiveSegment(null)}
                      onClick={() =>
                        setActiveSegment((prev) =>
                          isSameSegment(prev, segment) ? null : segment,
                        )
                      }
                      onFocus={() => setActiveSegment(segment)}
                      onMouseEnter={() => setActiveSegment(segment)}
                      onMouseLeave={() => setActiveSegment(null)}
                      className={`relative h-full rounded-[5px] bg-blue-600 transition ${
                        active ? "z-20 -translate-y-0.5 bg-blue-700 shadow-md" : "hover:bg-blue-700"
                      }`}
                      style={{ flex: `0 0 ${width}%` }}
                    >
                      {active && (
                        <span className="pointer-events-none absolute left-1/2 top-[-3.15rem] z-30 min-w-[156px] -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-[11px] font-bold leading-4 text-slate-700 shadow-lg">
                          <span className="block text-blue-700">
                            {row.subject} · {getTypeLabel(item.type)}
                          </span>
                          <span className="block truncate">{item.name}</span>
                          <span className="block text-slate-500">
                            원점수 {formatPoint(item.score)} / {formatPoint(item.maxScore)}
                          </span>
                          <span className="block text-slate-900">
                            반영 {formatPoint(item.weighted)}
                          </span>
                        </span>
                      )}
                    </button>
                  );
                })}
                {remaining > 0 && (
                  <div
                    className="h-full rounded-[5px] border border-dashed border-slate-300 bg-white/70"
                    style={{ flex: `${remaining} 1 0%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-slate-400">
                <span>정기시험·수행평가 조각별 반영 점수</span>
                <span>PC는 마우스 올림, 모바일은 터치</span>
              </div>
            </div>
            <div className="text-right text-sm font-black text-blue-700">{formatPoint(row.total)}</div>
          </div>
        );
      })}
    </div>
  );
};

export default SegmentedAchievementChart;
