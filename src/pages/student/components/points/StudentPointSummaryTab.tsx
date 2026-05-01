import React from "react";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import {
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

interface StudentPointSummaryTabProps {
  wallet: PointWallet;
  rank: PointRankDisplay | null;
  recentTransactions: PointTransaction[];
  onOpenHistory: () => void;
}

const StudentPointSummaryTab: React.FC<StudentPointSummaryTabProps> = ({
  wallet,
  rank,
  recentTransactions,
  onOpenHistory,
}) => (
  <div className="space-y-5">
    {rank && (
      <section className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-gray-600">현재 등급</span>
              <PointRankBadge rank={rank} size="md" />
              <span className="inline-flex whitespace-nowrap rounded-full border border-blue-100 bg-white px-3 py-1 text-xs font-bold text-blue-700">
                누적 기준 {formatWisAmount(rank.metricValue)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 lg:text-right">
            <div className="text-xs font-bold text-gray-500">다음 단계까지</div>
            <div className="whitespace-nowrap text-xl font-black text-gray-900">
              {rank.nextLabel
                ? formatWisAmount(rank.remainingToNext)
                : "최고 등급"}
            </div>
          </div>
        </div>
      </section>
    )}

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <div className="text-sm font-bold text-gray-500">현재 보유 위스</div>
        <div className="mt-2 whitespace-nowrap text-3xl font-black text-gray-900">
          {formatWisAmount(wallet.balance || 0)}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <div className="text-sm font-bold text-gray-500">누적 획득 위스</div>
        <div className="mt-2 whitespace-nowrap text-3xl font-black text-emerald-600">
          {formatWisAmount(getPointWalletCumulativeEarned(wallet))}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <div className="text-sm font-bold text-gray-500">누적 사용 위스</div>
        <div className="mt-2 whitespace-nowrap text-3xl font-black text-rose-500">
          {formatWisAmount(wallet.spentTotal || 0)}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
        <div className="text-sm font-bold text-gray-500">최근 변동일</div>
        <div className="mt-2 text-lg font-extrabold text-gray-900">
          {formatPointDateOnly(wallet.lastTransactionAt)}
        </div>
      </div>
    </div>

    <div>
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">최근 위스 내역</h2>
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-sm font-bold text-blue-600 hover:text-blue-700 whitespace-nowrap"
          >
            전체 보기
          </button>
        </div>
        <div className="space-y-3">
          {recentTransactions.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center text-sm text-gray-500">
              아직 위스 내역이 없습니다.
            </div>
          )}
          {recentTransactions.map((transaction) => {
            const labelKey = transaction.activityType || transaction.type;
            const label =
              POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
            return (
              <div
                key={transaction.id}
                className="rounded-xl border border-gray-200 px-4 py-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-gray-800">
                      {transaction.sourceLabel || label}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-gray-500">
                      <span className="whitespace-nowrap">
                        {label}
                        {transaction.targetMonth
                          ? ` · ${transaction.targetMonth}`
                          : ""}
                      </span>
                      <span className="whitespace-nowrap">
                        {formatPointDateTime(transaction.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`text-sm font-black whitespace-nowrap ${getPointDeltaToneClass(transaction.delta)}`}
                  >
                    {formatWisDelta(transaction.delta)}
                  </div>
                </div>
                <div className="mt-2 text-xs font-bold text-gray-500">{`변동 후 잔액 ${formatWisAmount(transaction.balanceAfter)}`}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  </div>
);

export default StudentPointSummaryTab;
