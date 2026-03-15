import React from 'react';
import { POINT_TRANSACTION_TYPE_LABELS, getPointDeltaToneClass } from '../../../../constants/pointLabels';
import { formatPointDateOnly, formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointTransaction, PointWallet } from '../../../../types';

interface StudentPointSummaryTabProps {
    wallet: PointWallet;
    recentTransactions: PointTransaction[];
    onOpenHistory: () => void;
}

const StudentPointSummaryTab: React.FC<StudentPointSummaryTabProps> = ({ wallet, recentTransactions, onOpenHistory }) => (
    <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">현재 보유 포인트</div>
                <div className="mt-2 text-3xl font-black text-gray-900">{wallet.balance || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">누적 적립 포인트</div>
                <div className="mt-2 text-3xl font-black text-emerald-600">{wallet.earnedTotal || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">누적 사용 포인트</div>
                <div className="mt-2 text-3xl font-black text-rose-500">{wallet.spentTotal || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">최근 변동일</div>
                <div className="mt-2 text-lg font-extrabold text-gray-900">{formatPointDateOnly(wallet.lastTransactionAt)}</div>
            </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-800">최근 포인트 내역</h2>
                    <button type="button" onClick={onOpenHistory} className="text-sm font-bold text-blue-600 hover:text-blue-700">
                        전체 보기
                    </button>
                </div>
                <div className="space-y-3">
                    {recentTransactions.length === 0 && (
                        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center text-sm text-gray-500">
                            아직 포인트 내역이 없습니다.
                        </div>
                    )}
                    {recentTransactions.map((transaction) => (
                        <div key={transaction.id} className="rounded-xl border border-gray-200 px-4 py-3">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="font-bold text-gray-800">{transaction.sourceLabel || POINT_TRANSACTION_TYPE_LABELS[transaction.type]}</div>
                                    <div className="mt-1 text-xs text-gray-500">
                                        {POINT_TRANSACTION_TYPE_LABELS[transaction.type]} · {formatPointDateTime(transaction.createdAt)}
                                    </div>
                                </div>
                                <div className={`text-lg font-black ${getPointDeltaToneClass(transaction.delta)}`}>
                                    {transaction.delta >= 0 ? '+' : ''}
                                    {transaction.delta}
                                </div>
                            </div>
                            <div className="mt-2 text-xs font-bold text-gray-500">변동 후 잔액 {transaction.balanceAfter}점</div>
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-blue-50 p-5">
                <h2 className="text-lg font-bold text-gray-800">내 포인트 안내</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-gray-700">
                    <div className="rounded-xl bg-white/80 px-4 py-3">출석, 문제 풀이, 수업 자료 확인 같은 활동으로 포인트를 받을 수 있습니다.</div>
                    <div className="rounded-xl bg-white/80 px-4 py-3">상점 상품은 구매 요청 후 교사 확인을 거쳐 처리됩니다.</div>
                    <div className="rounded-xl bg-white/80 px-4 py-3">요청 결과는 <span className="font-bold text-blue-700">구매 내역</span> 탭에서 바로 확인할 수 있습니다.</div>
                </div>
            </section>
        </div>
    </div>
);

export default StudentPointSummaryTab;
