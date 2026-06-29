import React from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import {
  POINT_HISTORY_FILTER_LABELS,
  POINT_TRANSACTION_TYPE_LABELS,
  getPointDeltaToneClass,
} from "../../../../constants/pointLabels";
import {
  formatPointDateOnly,
  formatPointDateTime,
  formatWisAmount,
  formatWisDelta,
} from "../../../../lib/pointFormatters";
import {
  getPointWalletCumulativeEarned,
  type PointRankDisplay,
} from "../../../../lib/pointRanks";
import type { PointTransaction, PointWallet } from "../../../../types";

type HistoryFilter = keyof typeof POINT_HISTORY_FILTER_LABELS;

const QUICK_HISTORY_FILTERS: HistoryFilter[] = ["all", "earned", "spent"];
const DETAIL_HISTORY_FILTERS = (
  Object.keys(POINT_HISTORY_FILTER_LABELS) as HistoryFilter[]
).filter((filterKey) => !QUICK_HISTORY_FILTERS.includes(filterKey));

interface StudentPointSummaryTabProps {
  wallet: PointWallet;
  rank: PointRankDisplay | null;
  historyFilter: HistoryFilter;
  transactions: PointTransaction[];
  historyLoading?: boolean;
  historyErrorMessage?: string;
  onHistoryFilterChange: (value: HistoryFilter) => void;
}

const getTransactionLabel = (transaction: PointTransaction) => {
  const labelKey = transaction.activityType || transaction.type;
  return POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
};

const getTransactionReason = (transaction: PointTransaction) => {
  const label = getTransactionLabel(transaction);
  return transaction.targetMonth
    ? `${transaction.sourceLabel || label} · ${transaction.targetMonth}`
    : transaction.sourceLabel || label;
};

const StudentPointSummaryTab: React.FC<StudentPointSummaryTabProps> = ({
  wallet,
  rank,
  historyFilter,
  transactions,
  historyLoading = false,
  historyErrorMessage = "",
  onHistoryFilterChange,
}) => {
  const selectedDetailFilter = QUICK_HISTORY_FILTERS.includes(historyFilter)
    ? ""
    : historyFilter;

  return (
    <div className="space-y-5">
      <section className="border-b border-gray-100 px-1 pb-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-500">보유 위스</div>
            <div className="mt-1 whitespace-nowrap text-4xl font-black tracking-normal text-gray-950">
              {formatWisAmount(wallet.balance || 0)}
            </div>
            {rank && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <PointRankBadge rank={rank} size="md" />
                <span className="inline-flex whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                  누적 기준 {formatWisAmount(rank.metricValue)}
                </span>
              </div>
            )}
          </div>

          <dl className="grid w-full gap-x-6 gap-y-4 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:w-auto lg:min-w-[620px] lg:grid-cols-4 lg:border-t-0 lg:pt-0">
            <div>
              <dt className="text-xs font-bold text-gray-500">누적 획득</dt>
              <dd className="mt-1 whitespace-nowrap text-lg font-black text-emerald-600">
                {formatWisAmount(getPointWalletCumulativeEarned(wallet))}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-gray-500">누적 사용</dt>
              <dd className="mt-1 whitespace-nowrap text-lg font-black text-rose-500">
                {formatWisAmount(wallet.spentTotal || 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-gray-500">최근 변동</dt>
              <dd className="mt-1 whitespace-nowrap text-lg font-black text-gray-900">
                {formatPointDateOnly(wallet.lastTransactionAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-gray-500">다음 단계</dt>
              <dd className="mt-1 whitespace-nowrap text-lg font-black text-gray-900">
                {rank
                  ? rank.nextLabel
                    ? formatWisAmount(rank.remainingToNext)
                    : "최고 등급"
                  : "-"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-gray-900">위스 기록</h2>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-bold text-gray-600">
                {transactions.length}건
              </span>
              {historyLoading && (
                <span className="text-xs font-bold text-blue-600">
                  업데이트 중
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="inline-flex rounded-full bg-gray-100 p-1">
                {QUICK_HISTORY_FILTERS.map((filterKey) => (
                  <button
                    key={filterKey}
                    type="button"
                    onClick={() => onHistoryFilterChange(filterKey)}
                    className={`min-h-9 flex-1 rounded-full px-3 text-xs font-bold transition sm:flex-none ${
                      historyFilter === filterKey
                        ? "bg-blue-600 text-white shadow-sm"
                        : "text-gray-600 hover:bg-white hover:text-gray-900"
                    }`}
                  >
                    {POINT_HISTORY_FILTER_LABELS[filterKey]}
                  </button>
                ))}
              </div>
              <select
                value={selectedDetailFilter}
                onChange={(event) =>
                  onHistoryFilterChange(
                    (event.target.value || "all") as HistoryFilter,
                  )
                }
                aria-label="위스 상세 유형"
                className="min-h-10 rounded-full border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                <option value="">상세 유형</option>
                {DETAIL_HISTORY_FILTERS.map((filterKey) => (
                  <option key={filterKey} value={filterKey}>
                    {POINT_HISTORY_FILTER_LABELS[filterKey]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {historyErrorMessage && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm font-bold text-red-700">
            {historyErrorMessage}
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {!historyErrorMessage && transactions.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-gray-500">
              조건에 맞는 위스 기록이 없습니다.
            </div>
          )}
          {transactions.map((transaction) => {
            const label = getTransactionLabel(transaction);
            return (
              <article
                key={transaction.id}
                className="grid gap-3 px-5 py-4 transition hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex whitespace-nowrap rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                      {label}
                    </span>
                    <span className="text-xs font-medium text-gray-500">
                      {formatPointDateTime(transaction.createdAt)}
                    </span>
                  </div>
                  <div className="mt-2 truncate font-bold text-gray-900">
                    {getTransactionReason(transaction)}
                  </div>
                </div>
                <div className="flex items-baseline justify-between gap-4 sm:flex-col sm:items-end sm:justify-center">
                  <div
                    className={`whitespace-nowrap text-base font-black ${getPointDeltaToneClass(transaction.delta)}`}
                  >
                    {formatWisDelta(transaction.delta)}
                  </div>
                  <div className="whitespace-nowrap text-xs font-bold text-gray-500">
                    잔액 {formatWisAmount(transaction.balanceAfter)}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default StudentPointSummaryTab;
