import { LoadingOverlay } from "../../../../components/common/LoadingState";
import NumericInput from "../../../../components/common/NumericInput";
import React from "react";
import "../teacher-list-controls.css";
import PointRankBadge from "../../../../components/common/PointRankBadge";
import InfoHelp from "../../../../components/common/InfoHelp";
import {
  POINT_TRANSACTION_TYPE_LABELS,
  getPointDeltaToneClass,
} from "../../../../constants/pointLabels";
import {
  getPointRankDisplay,
  getPointWalletCumulativeEarned,
} from "../../../../lib/pointRanks";
import {
  formatPointDateShortTime,
  formatPointDateTime,
  formatPointStudentLabel,
  formatWisAmount,
  formatWisDelta,
} from "../../../../lib/pointFormatters";
import type {
  PointRankPolicy,
  PointTransaction,
  PointWallet,
} from "../../../../types";

type OverviewSortKey =
  | "none"
  | "affiliation"
  | "balance"
  | "earnedTotal"
  | "spentTotal";
type OverviewSortDirection = "asc" | "desc";

interface PointsOverviewTabProps {
  wallets: PointWallet[];
  totalWalletCount: number;
  currentPage: number;
  totalPages: number;
  loading?: boolean;
  sortKey: OverviewSortKey;
  sortDirection: OverviewSortDirection;
  selectedWallet: PointWallet | null;
  selectedUid: string;
  rankPolicy: PointRankPolicy;
  rankManualAdjustEarnedPointsByUid: Record<string, number>;
  gradeFilter: string;
  classFilter: string;
  numberFilter: string;
  nameSearch: string;
  gradeOptions: string[];
  classOptions: string[];
  numberOptions: string[];
  transactions: PointTransaction[];
  transactionsLoading?: boolean;
  transactionsError?: string;
  transactionsHasMore?: boolean;
  onLoadMoreTransactions?: () => void;
  onReloadTransactions?: () => void;
  canManage: boolean;
  selectedEditableTransactionId: string;
  adjustmentDraftValue: string;
  adjustmentFeedback: string;
  adjustmentSaving: boolean;
  onGradeFilterChange: (value: string) => void;
  onClassFilterChange: (value: string) => void;
  onNumberFilterChange: (value: string) => void;
  onNameSearchChange: (value: string) => void;
  onSortChange: (sortKey: Exclude<OverviewSortKey, "none">) => void;
  onPageChange: (page: number) => void;
  onSelectWallet: (uid: string) => void;
  onSelectEditableTransaction: (transactionId: string) => void;
  onAdjustmentDraftChange: (value: string) => void;
  onSubmitAdjustmentUpdate: () => void;
  onSubmitAdjustmentCancel: () => void;
}

const PointsOverviewTab: React.FC<PointsOverviewTabProps> = ({
  wallets,
  totalWalletCount,
  currentPage,
  totalPages,
  loading = false,
  sortKey,
  sortDirection,
  selectedWallet,
  selectedUid,
  rankPolicy,
  rankManualAdjustEarnedPointsByUid,
  gradeFilter,
  classFilter,
  numberFilter,
  nameSearch,
  gradeOptions,
  classOptions,
  numberOptions,
  transactions,
  transactionsLoading = false,
  transactionsError = "",
  transactionsHasMore = false,
  onLoadMoreTransactions,
  onReloadTransactions,
  canManage,
  selectedEditableTransactionId,
  adjustmentDraftValue,
  adjustmentFeedback,
  adjustmentSaving,
  onGradeFilterChange,
  onClassFilterChange,
  onNumberFilterChange,
  onNameSearchChange,
  onSortChange,
  onPageChange,
  onSelectWallet,
  onSelectEditableTransaction,
  onAdjustmentDraftChange,
  onSubmitAdjustmentUpdate,
  onSubmitAdjustmentCancel,
}) => {
  const sortIndicatorClass = (targetKey: Exclude<OverviewSortKey, "none">) => {
    if (sortKey !== targetKey) return "fa-sort text-gray-300";
    return sortDirection === "desc"
      ? "fa-sort-down text-blue-600"
      : "fa-sort-up text-blue-600";
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.28fr)_minmax(360px,0.92fr)]">
      <div className="min-w-0">
        <div className="points-student-filter-header ws-flat-section mb-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-800">
                학생별 위스 현황
              </h2>
            </div>
            <div className="text-sm font-bold text-gray-500">
              {loading
                ? "불러오는 중"
                : `현재 페이지 ${totalWalletCount}명${nameSearch.trim() ? " · 이름순" : ""}`}
            </div>
          </div>
          <div className="points-student-filters mt-4 grid gap-3 md:grid-cols-4">
            <select
              aria-label="학년 필터"
              value={gradeFilter}
              onChange={(event) => onGradeFilterChange(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
            >
              <option value="all">전체 학년</option>
              {gradeOptions.map((option) => (
                <option key={option} value={option}>{`${option}학년`}</option>
              ))}
            </select>
            <select
              aria-label="반 필터"
              value={classFilter}
              disabled={gradeFilter === "all"}
              onChange={(event) => onClassFilterChange(event.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
            >
              <option value="all">전체 반</option>
              {classOptions.map((option) => (
                <option key={option} value={option}>{`${option}반`}</option>
              ))}
            </select>
            <input
              aria-label="번호 필터"
              inputMode="numeric"
              maxLength={3}
              value={numberFilter === "all" ? "" : numberFilter}
              disabled={classFilter === "all"}
              placeholder="전체 번호"
              onChange={(event) =>
                onNumberFilterChange(
                  event.target.value.replace(/\D/g, "").replace(/^0+/, "") ||
                    "all",
                )
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
            />
            <input
              lang="ko"
              inputMode="text"
              aria-label="학생 이름 앞부분 검색"
              maxLength={60}
              value={nameSearch}
              onChange={(event) => onNameSearchChange(event.target.value)}
              placeholder="이름 앞부분 검색"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm"
            />
          </div>
        </div>

        <div
          className="points-student-table overflow-x-auto rounded-xl border border-gray-200 bg-white"
          role="region"
          aria-label="학생별 위스 목록"
          tabIndex={0}
        >
          <div className="grid grid-cols-[minmax(220px,1.65fr)_minmax(108px,0.95fr)_114px_124px_124px] gap-3 border-b border-gray-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
            <div>학생</div>
            <div>소속</div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => onSortChange("balance")}
                disabled={!!nameSearch.trim()}
                className="inline-flex items-center justify-end gap-1 text-right transition hover:text-blue-600"
              >
                보유 위스
                <i
                  className={`fas ${sortIndicatorClass("balance")} text-xs`}
                  aria-hidden="true"
                ></i>
              </button>
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => onSortChange("earnedTotal")}
                disabled={!!nameSearch.trim()}
                className="inline-flex items-center justify-end gap-1 text-right transition hover:text-blue-600"
              >
                누적 적립
                <i
                  className={`fas ${sortIndicatorClass("earnedTotal")} text-xs`}
                  aria-hidden="true"
                ></i>
              </button>
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => onSortChange("spentTotal")}
                disabled={!!nameSearch.trim()}
                className="inline-flex items-center justify-end gap-1 text-right transition hover:text-blue-600"
              >
                상점 사용
                <i
                  className={`fas ${sortIndicatorClass("spentTotal")} text-xs`}
                  aria-hidden="true"
                ></i>
              </button>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {loading && (
              <div
                role="status"
                className="px-5 py-12 text-center text-sm text-gray-500"
              >
                위스 명단을 불러오고 있습니다.
              </div>
            )}
            {!loading && totalWalletCount === 0 && (
              <div className="px-5 py-12 text-center text-sm text-gray-400">
                조건에 맞는 학생이 없습니다.
              </div>
            )}
            {wallets.map((wallet) => {
              const rank = getPointRankDisplay({
                rankPolicy,
                wallet,
                earnedPointsFromTransactions:
                  rankManualAdjustEarnedPointsByUid[wallet.uid] || 0,
              });

              return (
                <button
                  key={wallet.uid}
                  type="button"
                  onClick={() => onSelectWallet(wallet.uid)}
                  className={`grid w-full grid-cols-[minmax(220px,1.65fr)_minmax(108px,0.95fr)_114px_124px_124px] gap-3 px-5 py-4 text-left transition ${wallet.uid === selectedUid ? "bg-blue-50" : "hover:bg-gray-50"}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-bold text-gray-800">
                        {wallet.studentName || "(이름 없음)"}
                      </div>
                      <PointRankBadge rank={rank} size="sm" />
                    </div>
                    <div className="mt-1 whitespace-nowrap text-xs text-gray-500">{`(${formatPointDateShortTime(wallet.lastTransactionAt)})`}</div>
                  </div>
                  <div className="truncate text-sm text-gray-600">
                    {[
                      wallet.grade ? `${wallet.grade}학년` : "",
                      wallet.class ? `${wallet.class}반` : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || "-"}
                  </div>
                  <div className="text-right text-sm font-black text-blue-700 whitespace-nowrap">
                    {formatWisAmount(wallet.balance || 0)}
                  </div>
                  <div className="text-right text-sm font-bold text-emerald-600 whitespace-nowrap">
                    {formatWisAmount(getPointWalletCumulativeEarned(wallet))}
                  </div>
                  <div className="text-right text-sm font-bold text-rose-500 whitespace-nowrap">
                    {formatWisAmount(wallet.spentTotal || 0)}
                  </div>
                </button>
              );
            })}
          </div>
          {(currentPage > 1 || totalPages > currentPage) && (
            <div className="flex items-center justify-center gap-1.5 border-t border-gray-100 bg-white px-5 py-3">
              <button
                type="button"
                className="min-h-11 rounded-md px-3 text-sm font-bold text-blue-700 disabled:text-gray-400"
                disabled={loading || currentPage <= 1}
                onClick={() => onPageChange(currentPage - 1)}
              >
                이전
              </button>
              <span className="px-3 text-sm" aria-current="page">
                {currentPage}페이지
              </span>
              <button
                type="button"
                className="min-h-11 rounded-md px-3 text-sm font-bold text-blue-700 disabled:text-gray-400"
                disabled={loading || totalPages <= currentPage}
                onClick={() => onPageChange(currentPage + 1)}
              >
                다음
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        {!selectedWallet ? (
          <div className="py-16 text-center text-gray-400">
            왼쪽 목록에서 학생을 선택해 주세요.
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-extrabold text-gray-900">
                    {selectedWallet.studentName || "(이름 없음)"}
                  </h3>
                  <PointRankBadge
                    rank={getPointRankDisplay({
                      rankPolicy,
                      wallet: selectedWallet,
                      earnedPointsFromTransactions:
                        rankManualAdjustEarnedPointsByUid[selectedWallet.uid] ||
                        0,
                    })}
                  />
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {formatPointStudentLabel(selectedWallet) || "소속 정보 없음"}
                </div>
              </div>
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                <div className="text-xs font-bold text-blue-500">
                  현재 보유 위스
                </div>
                <div className="mt-1 whitespace-nowrap text-2xl font-black text-blue-700">
                  {formatWisAmount(selectedWallet.balance || 0)}
                </div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-1 text-xs font-bold text-gray-500">
                  누적 획득 위스
                  <InfoHelp label="누적 획득 위스 기준">
                    초기 지급 위스는 제외합니다. 게임·상점에서 사용해도 누적
                    획득 위스는 줄지 않습니다.
                  </InfoHelp>
                </div>
                <div className="mt-1 whitespace-nowrap text-lg font-extrabold text-emerald-600">
                  {formatWisAmount(
                    getPointWalletCumulativeEarned(selectedWallet),
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-1 text-xs font-bold text-gray-500">
                  상점 사용 위스
                  <InfoHelp label="상점 사용 위스 기준">
                    상품·아바타 구매에서 환불을 뺀 금액입니다. 게임 비용과 교사
                    환수는 거래 내역에서 확인할 수 있습니다.
                  </InfoHelp>
                </div>
                <div className="mt-1 whitespace-nowrap text-lg font-extrabold text-rose-500">
                  {formatWisAmount(selectedWallet.spentTotal || 0)}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="whitespace-nowrap font-bold text-gray-800">
                  거래 내역
                </div>
                <button
                  type="button"
                  className="min-h-11 whitespace-nowrap text-sm text-blue-700 underline disabled:opacity-50"
                  onClick={onReloadTransactions}
                  disabled={transactionsLoading}
                >
                  새로고침
                </button>
                {canManage && (
                  <div className="text-[11px] font-bold text-gray-400">
                    최신 교사 직접 지급/환수 항목만 수정·취소 가능
                  </div>
                )}
              </div>
              <div className="max-h-[480px] overflow-y-auto rounded-xl border border-gray-200">
                {transactionsError && (
                  <div role="alert" className="p-4 text-sm text-red-700">
                    {transactionsError}
                  </div>
                )}
                {transactionsLoading && <LoadingOverlay />}
                {!transactionsLoading &&
                  !transactionsError &&
                  transactions.length === 0 && (
                    <div className="p-6 text-center text-sm text-gray-400">
                      거래 내역이 없습니다.
                    </div>
                  )}
                {transactions.map((transaction, index) => {
                  const labelKey = transaction.activityType || transaction.type;
                  const label =
                    POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
                  const isEditable =
                    canManage &&
                    transaction.canReverse === true &&
                    ["manual_adjust", "manual_reclaim"].includes(
                      transaction.type,
                    ) &&
                    index === 0;
                  const isSelected =
                    selectedEditableTransactionId === transaction.id;

                  return (
                    <div
                      key={transaction.id}
                      className="border-b border-gray-100 p-4 last:border-0"
                    >
                      <button
                        type="button"
                        disabled={!isEditable}
                        onClick={() =>
                          onSelectEditableTransaction(
                            isSelected ? "" : transaction.id,
                          )
                        }
                        className={`w-full text-left ${isEditable ? "cursor-pointer" : "cursor-default"}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <div className="font-bold text-gray-800">
                              {transaction.sourceLabel || label}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {label}
                              {transaction.targetMonth
                                ? ` · ${transaction.targetMonth}`
                                : ""}
                              {isEditable ? " · 클릭해 수정" : ""}
                            </div>
                          </div>
                          <div
                            className={`text-sm font-extrabold ${getPointDeltaToneClass(transaction.delta)}`}
                          >
                            {formatWisDelta(transaction.delta)}
                          </div>
                        </div>
                        <div className="mt-1 whitespace-nowrap text-[11px] text-gray-500">{`잔액 ${formatWisAmount(transaction.balanceAfter)} · ${formatPointDateTime(transaction.createdAt)}`}</div>
                      </button>
                      {isSelected && isEditable && (
                        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                          <div className="flex flex-col gap-3 md:flex-row md:items-end">
                            <label className="flex-1">
                              <div className="mb-1 text-xs font-bold text-blue-700">
                                수정 위스
                              </div>
                              <NumericInput
                                allowEmpty
                                type="number"
                                value={adjustmentDraftValue}
                                onChange={(event) =>
                                  onAdjustmentDraftChange(event.target.value)
                                }
                                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"
                                disabled={adjustmentSaving}
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={onSubmitAdjustmentUpdate}
                                disabled={adjustmentSaving}
                                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:bg-blue-300"
                              >
                                {adjustmentSaving ? "처리 중..." : "위스 수정"}
                              </button>
                              <button
                                type="button"
                                onClick={onSubmitAdjustmentCancel}
                                disabled={adjustmentSaving}
                                className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 disabled:text-rose-300"
                              >
                                내역 취소
                              </button>
                            </div>
                          </div>
                          {adjustmentFeedback && (
                            <div className="mt-2 text-xs font-bold text-blue-700">
                              {adjustmentFeedback}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {transactionsHasMore && (
                  <button
                    type="button"
                    className="min-h-11 w-full border-t border-gray-200 bg-white px-4 text-sm font-bold text-blue-700 disabled:opacity-50"
                    onClick={onLoadMoreTransactions}
                    disabled={transactionsLoading}
                  >
                    이전 기록 더 보기
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PointsOverviewTab;
