import React from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import type { PointRankDisplay } from '../../../../lib/pointRanks';
import { POINT_TRANSACTION_TYPE_LABELS, getPointDeltaToneClass } from '../../../../constants/pointLabels';
import { formatPointDateOnly, formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointTransaction, PointWallet } from '../../../../types';

interface StudentPointSummaryTabProps {
    wallet: PointWallet;
    rank: PointRankDisplay | null;
    recentTransactions: PointTransaction[];
    onOpenHistory: () => void;
}

const StudentPointSummaryTab: React.FC<StudentPointSummaryTabProps> = ({ wallet, rank, recentTransactions, onOpenHistory }) => (
    <div className="space-y-6">
        {rank && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-sm font-bold text-gray-700">{'현재 등급'}</div>
                <PointRankBadge rank={rank} />
                <div className="text-xs text-gray-500">
                    {rank.nextLabel
                        ? `다음 등급 ${rank.nextLabel}까지 ${rank.remainingToNext}점 남았습니다.`
                        : '현재 최고 등급이며, 구매나 차감으로 내려가지 않습니다.'}
                </div>
            </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">{'\uD604\uC7AC \uBCF4\uC720 \uD3EC\uC778\uD2B8'}</div>
                <div className="mt-2 text-3xl font-black text-gray-900">{wallet.balance || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">{'\uB204\uC801 \uC801\uB9BD \uD3EC\uC778\uD2B8'}</div>
                <div className="mt-2 text-3xl font-black text-emerald-600">{wallet.earnedTotal || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">{'\uB204\uC801 \uC0AC\uC6A9 \uD3EC\uC778\uD2B8'}</div>
                <div className="mt-2 text-3xl font-black text-rose-500">{wallet.spentTotal || 0}</div>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="text-sm font-bold text-gray-500">{'\uCD5C\uADFC \uBCC0\uB3D9\uC77C'}</div>
                <div className="mt-2 text-lg font-extrabold text-gray-900">{formatPointDateOnly(wallet.lastTransactionAt)}</div>
            </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-800">{'\uCD5C\uADFC \uD3EC\uC778\uD2B8 \uB0B4\uC5ED'}</h2>
                    <button type="button" onClick={onOpenHistory} className="text-sm font-bold text-blue-600 hover:text-blue-700">
                        {'\uC804\uCCB4 \uBCF4\uAE30'}
                    </button>
                </div>
                <div className="space-y-3">
                    {recentTransactions.length === 0 && (
                        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center text-sm text-gray-500">
                            {'\uC544\uC9C1 \uD3EC\uC778\uD2B8 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}
                        </div>
                    )}
                    {recentTransactions.map((transaction) => {
                        const labelKey = transaction.activityType || transaction.type;
                        const label = POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
                        return (
                            <div key={transaction.id} className="rounded-xl border border-gray-200 px-4 py-3">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="font-bold text-gray-800">{transaction.sourceLabel || label}</div>
                                        <div className="mt-1 text-xs text-gray-500">
                                            {label}
                                            {transaction.targetMonth ? ` · ${transaction.targetMonth}` : ''}
                                            {` · ${formatPointDateTime(transaction.createdAt)}`}
                                        </div>
                                    </div>
                                    <div className={`text-lg font-black ${getPointDeltaToneClass(transaction.delta)}`}>
                                        {transaction.delta >= 0 ? '+' : ''}
                                        {transaction.delta}
                                    </div>
                                </div>
                                <div className="mt-2 text-xs font-bold text-gray-500">{`\uBCC0\uB3D9 \uD6C4 \uC794\uC561 ${transaction.balanceAfter}\uC810`}</div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-blue-50 p-5">
                <h2 className="text-lg font-bold text-gray-800">{'\uB0B4 \uD3EC\uC778\uD2B8 \uC548\uB0B4'}</h2>
                <div className="mt-4 space-y-3 text-sm leading-6 text-gray-700">
                    <div className="rounded-xl bg-white/80 px-4 py-3">{'\uCD9C\uC11D, \uBB38\uC81C \uD480\uC774, \uC218\uC5C5 \uC790\uB8CC \uD655\uC778 \uAC19\uC740 \uD65C\uB3D9\uC73C\uB85C \uD3EC\uC778\uD2B8\uB97C \uBC1B\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</div>
                    <div className="rounded-xl bg-white/80 px-4 py-3">{'\uD55C \uB2EC \uB3D9\uC548 \uB9E4\uC77C \uCD9C\uC11D\uD558\uBA74 \uC6D4\uAC04 \uAC1C\uADFC \uBCF4\uB108\uC2A4\uAC00 \uCD94\uAC00\uB85C \uC801\uB9BD\uB420 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</div>
                    <div className="rounded-xl bg-white/80 px-4 py-3">{'\uC0C1\uC810 \uC0C1\uD488\uC740 \uAD6C\uB9E4 \uC694\uCCAD \uD6C4 \uAD50\uC0AC \uD655\uC778\uC744 \uAC70\uCCD0 \uCC98\uB9AC\uB429\uB2C8\uB2E4.'}</div>
                    <div className="rounded-xl bg-white/80 px-4 py-3">{'\uC694\uCCAD \uACB0\uACFC\uB294 '}<span className="font-bold text-blue-700">{'\uAD6C\uB9E4 \uB0B4\uC5ED'}</span>{'\u00A0\uD0ED\uC5D0\uC11C \uBC14\uB85C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</div>
                </div>
            </section>
        </div>
    </div>
);

export default StudentPointSummaryTab;
