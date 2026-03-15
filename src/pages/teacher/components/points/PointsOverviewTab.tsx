import React from 'react';
import { getPointDeltaToneClass, getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointDateTime, formatPointStudentLabel } from '../../../../lib/pointFormatters';
import type { PointTransaction, PointWallet } from '../../../../types';

interface PointsOverviewTabProps {
    wallets: PointWallet[];
    selectedWallet: PointWallet | null;
    selectedUid: string;
    search: string;
    classFilter: string;
    classOptions: string[];
    transactions: PointTransaction[];
    canManage: boolean;
    amount: string;
    reason: string;
    action: 'grant' | 'deduct';
    feedback: string;
    onSearchChange: (value: string) => void;
    onClassFilterChange: (value: string) => void;
    onSelectWallet: (uid: string) => void;
    onAmountChange: (value: string) => void;
    onReasonChange: (value: string) => void;
    onActionChange: (value: 'grant' | 'deduct') => void;
    onSubmitAdjust: (event: React.FormEvent) => void;
}

const PointsOverviewTab: React.FC<PointsOverviewTabProps> = ({
    wallets,
    selectedWallet,
    selectedUid,
    search,
    classFilter,
    classOptions,
    transactions,
    canManage,
    amount,
    reason,
    action,
    feedback,
    onSearchChange,
    onClassFilterChange,
    onSelectWallet,
    onAmountChange,
    onReasonChange,
    onActionChange,
    onSubmitAdjust,
}) => (
    <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.95fr] gap-6">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50 p-5 md:flex-row md:items-center md:justify-between">
                <h2 className="text-lg font-bold text-gray-800">학생 포인트 현황</h2>
                <div className="flex w-full gap-2 md:w-auto">
                    <select
                        value={classFilter}
                        onChange={(event) => onClassFilterChange(event.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700"
                    >
                        <option value="all">전체 학급</option>
                        {classOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                    <input
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="이름 또는 학급 검색"
                        className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm md:w-64"
                    />
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm text-left">
                    <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                        <tr>
                            <th className="p-4">이름</th>
                            <th className="p-4">학년/반/번호</th>
                            <th className="p-4 text-right">현재 포인트</th>
                            <th className="p-4 text-right">누적 적립</th>
                            <th className="p-4 text-right">누적 사용</th>
                            <th className="p-4 text-right">최근 변동일</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {wallets.length === 0 && (
                            <tr>
                                <td colSpan={6} className="p-10 text-center text-gray-400">조건에 맞는 포인트 지갑이 없습니다.</td>
                            </tr>
                        )}
                        {wallets.map((wallet) => (
                            <tr
                                key={wallet.uid}
                                className={`cursor-pointer transition ${wallet.uid === selectedUid ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                onClick={() => onSelectWallet(wallet.uid)}
                            >
                                <td className="p-4 font-bold text-gray-800">{wallet.studentName || '(이름 없음)'}</td>
                                <td className="p-4 text-gray-600">{formatPointStudentLabel(wallet) || '-'}</td>
                                <td className="p-4 text-right font-extrabold text-blue-700">{wallet.balance || 0}</td>
                                <td className="p-4 text-right text-gray-700">{wallet.earnedTotal || 0}</td>
                                <td className="p-4 text-right text-gray-700">{wallet.spentTotal || 0}</td>
                                <td className="p-4 text-right text-gray-500">{formatPointDateTime(wallet.lastTransactionAt)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            {!selectedWallet ? (
                <div className="py-16 text-center text-gray-400">학생을 선택하세요.</div>
            ) : (
                <>
                    <h3 className="text-xl font-extrabold text-gray-900">{selectedWallet.studentName || '(이름 없음)'}</h3>
                    <div className="mt-1 text-sm text-gray-500">{formatPointStudentLabel(selectedWallet) || '학급 정보 없음'}</div>
                    <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="text-sm font-bold text-gray-500">현재 포인트</div>
                        <div className="mt-2 text-3xl font-extrabold text-blue-700">{selectedWallet.balance || 0}</div>
                    </div>

                    <div className="mt-5">
                        <div className="mb-3 font-bold text-gray-800">최근 거래 내역</div>
                        <div className="max-h-[280px] overflow-y-auto rounded-xl border border-gray-200">
                            {transactions.length === 0 && (
                                <div className="p-6 text-center text-sm text-gray-400">거래 내역이 없습니다.</div>
                            )}
                            {transactions.map((transaction) => (
                                <div key={transaction.id} className="border-b border-gray-100 p-4 last:border-0">
                                    <div className="flex items-center justify-between">
                                        <div className="font-bold text-gray-800">{transaction.sourceLabel || transaction.type}</div>
                                        <div className={`text-sm font-extrabold ${getPointDeltaToneClass(transaction.delta)}`}>
                                            {transaction.delta >= 0 ? '+' : ''}
                                            {transaction.delta}
                                        </div>
                                    </div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        잔액 {transaction.balanceAfter}점 · {formatPointDateTime(transaction.createdAt)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <form onSubmit={onSubmitAdjust} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="mb-3 font-bold text-gray-800">수동 지급/차감</div>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => onActionChange('grant')}
                                className={`rounded-lg px-4 py-2 text-sm font-bold ${action === 'grant' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600'}`}
                            >
                                지급
                            </button>
                            <button
                                type="button"
                                onClick={() => onActionChange('deduct')}
                                className={`rounded-lg px-4 py-2 text-sm font-bold ${action === 'deduct' ? 'bg-red-500 text-white' : 'border border-gray-300 bg-white text-gray-600'}`}
                            >
                                차감
                            </button>
                        </div>
                        <input
                            type="number"
                            min="1"
                            value={amount}
                            onChange={(event) => onAmountChange(event.target.value)}
                            placeholder="포인트 수량"
                            className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm"
                            disabled={!canManage}
                        />
                        <textarea
                            value={reason}
                            onChange={(event) => onReasonChange(event.target.value)}
                            rows={3}
                            placeholder="지급/차감 사유"
                            className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm"
                            disabled={!canManage}
                        />
                        {!!feedback && (
                            <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${getPointFeedbackToneClass(feedback)}`}>
                                {feedback}
                            </div>
                        )}
                        <button
                            type="submit"
                            disabled={!canManage}
                            className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                        >
                            포인트 저장
                        </button>
                    </form>
                </>
            )}
        </div>
    </div>
);

export default PointsOverviewTab;
