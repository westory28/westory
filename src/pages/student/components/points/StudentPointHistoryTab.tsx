import React from 'react';
import { POINT_HISTORY_FILTER_LABELS, POINT_TRANSACTION_TYPE_LABELS, getPointDeltaToneClass } from '../../../../constants/pointLabels';
import { formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointTransaction } from '../../../../types';

type HistoryFilter = 'all' | 'earned' | 'spent' | 'attendance' | 'attendance_monthly_bonus' | 'quiz' | 'lesson' | 'manual_adjust' | 'purchase';

interface StudentPointHistoryTabProps {
    historyFilter: HistoryFilter;
    transactions: PointTransaction[];
    onHistoryFilterChange: (value: HistoryFilter) => void;
}

const StudentPointHistoryTab: React.FC<StudentPointHistoryTabProps> = ({ historyFilter, transactions, onHistoryFilterChange }) => (
    <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
                <h2 className="text-lg font-bold text-gray-800">{'\uD3EC\uC778\uD2B8 \uB0B4\uC5ED'}</h2>
                <p className="mt-1 text-sm text-gray-500">{'\uC801\uB9BD\uACFC \uC0AC\uC6A9 \uB0B4\uC5ED\uC744 \uCD5C\uC2E0\uC21C\uC73C\uB85C \uD655\uC778\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
                {(Object.keys(POINT_HISTORY_FILTER_LABELS) as HistoryFilter[]).map((filterKey) => (
                    <button
                        key={filterKey}
                        type="button"
                        onClick={() => onHistoryFilterChange(filterKey)}
                        className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                            historyFilter === filterKey ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        {POINT_HISTORY_FILTER_LABELS[filterKey]}
                    </button>
                ))}
            </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200">
            <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm text-left">
                    <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                        <tr>
                            <th className="px-4 py-3">{'\uC77C\uC2DC'}</th>
                            <th className="px-4 py-3">{'\uC720\uD615'}</th>
                            <th className="px-4 py-3 text-right">{'\uC99D\uAC10'}</th>
                            <th className="px-4 py-3">{'\uC0AC\uC720'}</th>
                            <th className="px-4 py-3 text-right">{'\uC794\uC561'}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                        {transactions.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{'\uC870\uAC74\uC5D0 \uB9DE\uB294 \uD3EC\uC778\uD2B8 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}</td>
                            </tr>
                        )}
                        {transactions.map((transaction) => {
                            const labelKey = transaction.activityType || transaction.type;
                            const label = POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
                            const reason = transaction.targetMonth
                                ? `${transaction.sourceLabel || label} · ${transaction.targetMonth}`
                                : transaction.sourceLabel || label;

                            return (
                                <tr key={transaction.id} className="hover:bg-gray-50">
                                    <td className="px-4 py-4 text-gray-500">{formatPointDateTime(transaction.createdAt)}</td>
                                    <td className="px-4 py-4">
                                        <span className="inline-flex rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
                                            {label}
                                        </span>
                                    </td>
                                    <td className={`px-4 py-4 text-right font-black ${getPointDeltaToneClass(transaction.delta)}`}>
                                        {transaction.delta >= 0 ? '+' : ''}
                                        {transaction.delta}
                                    </td>
                                    <td className="px-4 py-4 text-gray-700">{reason}</td>
                                    <td className="px-4 py-4 text-right font-bold text-gray-800">{transaction.balanceAfter}</td>
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
