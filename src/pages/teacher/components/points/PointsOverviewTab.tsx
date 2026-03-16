import React from 'react';
import { POINT_TRANSACTION_TYPE_LABELS, getPointDeltaToneClass } from '../../../../constants/pointLabels';
import { formatPointDateShortTime, formatPointDateTime, formatPointStudentLabel } from '../../../../lib/pointFormatters';
import type { PointTransaction, PointWallet } from '../../../../types';

interface PointsOverviewTabProps {
    wallets: PointWallet[];
    selectedWallet: PointWallet | null;
    selectedUid: string;
    gradeFilter: string;
    classFilter: string;
    numberFilter: string;
    nameSearch: string;
    gradeOptions: string[];
    classOptions: string[];
    numberOptions: string[];
    transactions: PointTransaction[];
    canManage: boolean;
    selectedEditableTransactionId: string;
    adjustmentDraftValue: string;
    adjustmentFeedback: string;
    adjustmentSaving: boolean;
    onGradeFilterChange: (value: string) => void;
    onClassFilterChange: (value: string) => void;
    onNumberFilterChange: (value: string) => void;
    onNameSearchChange: (value: string) => void;
    onSelectWallet: (uid: string) => void;
    onSelectEditableTransaction: (transactionId: string) => void;
    onAdjustmentDraftChange: (value: string) => void;
    onSubmitAdjustmentUpdate: () => void;
    onSubmitAdjustmentCancel: () => void;
}

const PointsOverviewTab: React.FC<PointsOverviewTabProps> = ({
    wallets,
    selectedWallet,
    selectedUid,
    gradeFilter,
    classFilter,
    numberFilter,
    nameSearch,
    gradeOptions,
    classOptions,
    numberOptions,
    transactions,
    canManage,
    selectedEditableTransactionId,
    adjustmentDraftValue,
    adjustmentFeedback,
    adjustmentSaving,
    onGradeFilterChange,
    onClassFilterChange,
    onNumberFilterChange,
    onNameSearchChange,
    onSelectWallet,
    onSelectEditableTransaction,
    onAdjustmentDraftChange,
    onSubmitAdjustmentUpdate,
    onSubmitAdjustmentCancel,
}) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.95fr]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gray-50 p-5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">학생별 포인트 현황</h2>
                        <p className="mt-1 text-sm text-gray-500">학년, 반, 번호, 이름 검색을 조합해 학생 포인트 현황과 최근 거래 내역을 빠르게 확인할 수 있습니다.</p>
                    </div>
                    <div className="text-sm font-bold text-gray-500">{`검색 결과 ${wallets.length}명`}</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <select value={gradeFilter} onChange={(event) => onGradeFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">전체 학년</option>
                        {gradeOptions.map((option) => <option key={option} value={option}>{`${option}학년`}</option>)}
                    </select>
                    <select value={classFilter} onChange={(event) => onClassFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">전체 반</option>
                        {classOptions.map((option) => <option key={option} value={option}>{`${option}반`}</option>)}
                    </select>
                    <select value={numberFilter} onChange={(event) => onNumberFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">전체 번호</option>
                        {numberOptions.map((option) => <option key={option} value={option}>{`${option}번`}</option>)}
                    </select>
                    <input value={nameSearch} onChange={(event) => onNameSearchChange(event.target.value)} placeholder="이름 또는 일부 검색" className="rounded-lg border border-gray-300 px-4 py-2 text-sm" />
                </div>
            </div>

            <div className="hidden md:block">
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_120px] gap-3 border-b border-gray-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <div>학생</div>
                    <div>소속</div>
                    <div className="text-right">보유</div>
                    <div className="text-right">누적 적립</div>
                    <div className="text-right">누적 사용</div>
                </div>
                <div className="divide-y divide-gray-100">
                    {wallets.length === 0 && <div className="px-5 py-12 text-center text-sm text-gray-400">조건에 맞는 학생이 없습니다.</div>}
                    {wallets.map((wallet) => (
                        <button
                            key={wallet.uid}
                            type="button"
                            onClick={() => onSelectWallet(wallet.uid)}
                            className={`grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_120px] gap-3 px-5 py-4 text-left transition ${wallet.uid === selectedUid ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                            <div className="min-w-0">
                                <div className="truncate font-bold text-gray-800">{wallet.studentName || '(이름 없음)'}</div>
                                <div className="mt-1 text-xs text-gray-500">{`(${formatPointDateShortTime(wallet.lastTransactionAt)})`}</div>
                            </div>
                            <div className="truncate text-sm text-gray-600">
                                {[
                                    wallet.grade ? `${wallet.grade}학년` : '',
                                    wallet.class ? `${wallet.class}반` : '',
                                ].filter(Boolean).join(' ') || '-'}
                            </div>
                            <div className="text-right text-lg font-black text-blue-700">{wallet.balance || 0}</div>
                            <div className="text-right font-bold text-emerald-600">{wallet.earnedTotal || 0}</div>
                            <div className="text-right font-bold text-rose-500">{wallet.spentTotal || 0}</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {!selectedWallet ? (
                <div className="py-16 text-center text-gray-400">왼쪽 목록에서 학생을 선택해 주세요.</div>
            ) : (
                <>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-extrabold text-gray-900">{selectedWallet.studentName || '(이름 없음)'}</h3>
                            <div className="mt-1 text-sm text-gray-500">{formatPointStudentLabel(selectedWallet) || '소속 정보 없음'}</div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                            <div className="text-xs font-bold text-blue-500">현재 보유 포인트</div>
                            <div className="mt-1 text-3xl font-black text-blue-700">{selectedWallet.balance || 0}</div>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="text-xs font-bold text-gray-500">누적 적립</div>
                            <div className="mt-1 text-lg font-extrabold text-emerald-600">{selectedWallet.earnedTotal || 0}</div>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="text-xs font-bold text-gray-500">누적 사용</div>
                            <div className="mt-1 text-lg font-extrabold text-rose-500">{selectedWallet.spentTotal || 0}</div>
                        </div>
                    </div>

                    <div className="mt-5">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="font-bold text-gray-800">최근 거래 내역</div>
                            {canManage && (
                                <div className="text-[11px] font-bold text-gray-400">최신 교사 부여 항목만 수정/취소 가능</div>
                            )}
                        </div>
                        <div className="max-h-[320px] overflow-y-auto rounded-xl border border-gray-200">
                            {transactions.length === 0 && <div className="p-6 text-center text-sm text-gray-400">거래 내역이 없습니다.</div>}
                            {transactions.map((transaction, index) => {
                                const labelKey = transaction.activityType || transaction.type;
                                const label = POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
                                const isEditable = canManage && transaction.type === 'manual_adjust' && index === 0;
                                const isSelected = selectedEditableTransactionId === transaction.id;

                                return (
                                    <div key={transaction.id} className="border-b border-gray-100 p-4 last:border-0">
                                        <button
                                            type="button"
                                            disabled={!isEditable}
                                            onClick={() => onSelectEditableTransaction(isSelected ? '' : transaction.id)}
                                            className={`w-full text-left ${isEditable ? 'cursor-pointer' : 'cursor-default'}`}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <div className="font-bold text-gray-800">{transaction.sourceLabel || label}</div>
                                                    <div className="mt-1 text-xs text-gray-500">
                                                        {label}
                                                        {transaction.targetMonth ? ` · ${transaction.targetMonth}` : ''}
                                                        {isEditable ? ' · 클릭해 수정' : ''}
                                                    </div>
                                                </div>
                                                <div className={`text-sm font-extrabold ${getPointDeltaToneClass(transaction.delta)}`}>
                                                    {transaction.delta >= 0 ? '+' : ''}
                                                    {transaction.delta}
                                                </div>
                                            </div>
                                            <div className="mt-1 text-xs text-gray-500">{`잔액 ${transaction.balanceAfter} · ${formatPointDateTime(transaction.createdAt)}`}</div>
                                        </button>
                                        {isSelected && isEditable && (
                                            <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3">
                                                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                                                    <label className="flex-1">
                                                        <div className="mb-1 text-xs font-bold text-blue-700">수정 포인트</div>
                                                        <input
                                                            type="number"
                                                            value={adjustmentDraftValue}
                                                            onChange={(event) => onAdjustmentDraftChange(event.target.value)}
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
                                                            {adjustmentSaving ? '처리 중...' : '점수 수정'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={onSubmitAdjustmentCancel}
                                                            disabled={adjustmentSaving}
                                                            className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-bold text-rose-600 disabled:text-rose-300"
                                                        >
                                                            부여 취소
                                                        </button>
                                                    </div>
                                                </div>
                                                {adjustmentFeedback && (
                                                    <div className="mt-2 text-xs font-bold text-blue-700">{adjustmentFeedback}</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
        </div>
    </div>
);

export default PointsOverviewTab;
