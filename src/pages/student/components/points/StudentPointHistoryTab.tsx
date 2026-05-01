import React from "react";
import {
  POINT_HISTORY_FILTER_LABELS,
  POINT_TRANSACTION_TYPE_LABELS,
  getPointDeltaToneClass,
} from "../../../../constants/pointLabels";
import {
  formatPointDateTime,
  formatWisAmount,
  formatWisDelta,
} from "../../../../lib/pointFormatters";
import type { PointTransaction } from "../../../../types";

type HistoryFilter = keyof typeof POINT_HISTORY_FILTER_LABELS;

interface StudentPointHistoryTabProps {
  historyFilter: HistoryFilter;
  transactions: PointTransaction[];
  onHistoryFilterChange: (value: HistoryFilter) => void;
}

const StudentPointHistoryTab: React.FC<StudentPointHistoryTabProps> = ({
  historyFilter,
  transactions,
  onHistoryFilterChange,
}) => (
  <div className="space-y-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-lg font-bold text-gray-800">위스 내역</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(POINT_HISTORY_FILTER_LABELS) as HistoryFilter[]).map(
          (filterKey) => (
            <button
              key={filterKey}
              type="button"
              onClick={() => onHistoryFilterChange(filterKey)}
              className={`rounded-full px-4 py-2 text-xs font-bold transition whitespace-nowrap ${
                historyFilter === filterKey
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {POINT_HISTORY_FILTER_LABELS[filterKey]}
            </button>
          ),
        )}
      </div>
    </div>

    <div className="overflow-hidden rounded-2xl border border-gray-200">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm text-left">
          <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
            <tr>
              <th className="px-4 py-3">일시</th>
              <th className="px-4 py-3">유형</th>
              <th className="px-4 py-3 text-right">증감</th>
              <th className="px-4 py-3">사유</th>
              <th className="px-4 py-3 text-right">잔액</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {transactions.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-gray-400"
                >
                  조건에 맞는 위스 내역이 없습니다.
                </td>
              </tr>
            )}
            {transactions.map((transaction) => {
              const labelKey = transaction.activityType || transaction.type;
              const label =
                POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
              const reason = transaction.targetMonth
                ? `${transaction.sourceLabel || label} · ${transaction.targetMonth}`
                : transaction.sourceLabel || label;

              return (
                <tr key={transaction.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 whitespace-nowrap text-gray-500">
                    {formatPointDateTime(transaction.createdAt)}
                  </td>
                  <td className="px-4 py-4">
                    <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                      {label}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-4 text-right font-black whitespace-nowrap ${getPointDeltaToneClass(transaction.delta)}`}
                  >
                    {formatWisDelta(transaction.delta)}
                  </td>
                  <td className="px-4 py-4 text-gray-700">{reason}</td>
                  <td className="px-4 py-4 text-right font-bold text-gray-800 whitespace-nowrap">
                    {formatWisAmount(transaction.balanceAfter)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

export default StudentPointHistoryTab;
