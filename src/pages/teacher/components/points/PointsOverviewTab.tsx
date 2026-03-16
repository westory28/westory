import React from 'react';
import { POINT_TRANSACTION_TYPE_LABELS, getPointDeltaToneClass, getPointFeedbackToneClass } from '../../../../constants/pointLabels';
import { formatPointDateOnly, formatPointDateTime, formatPointStudentLabel } from '../../../../lib/pointFormatters';
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
    amount: string;
    reason: string;
    action: 'grant' | 'deduct';
    feedback: string;
    onGradeFilterChange: (value: string) => void;
    onClassFilterChange: (value: string) => void;
    onNumberFilterChange: (value: string) => void;
    onNameSearchChange: (value: string) => void;
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
    gradeFilter,
    classFilter,
    numberFilter,
    nameSearch,
    gradeOptions,
    classOptions,
    numberOptions,
    transactions,
    canManage,
    amount,
    reason,
    action,
    feedback,
    onGradeFilterChange,
    onClassFilterChange,
    onNumberFilterChange,
    onNameSearchChange,
    onSelectWallet,
    onAmountChange,
    onReasonChange,
    onActionChange,
    onSubmitAdjust,
}) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.95fr]">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 bg-gray-50 p-5">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">{'\uD559\uC0DD\uBCC4 \uD3EC\uC778\uD2B8 \uD604\uD669'}</h2>
                        <p className="mt-1 text-sm text-gray-500">{'\uD559\uB144, \uBC18, \uBC88\uD638, \uC774\uB984 \uAC80\uC0C9\uC744 \uC870\uD569\uD574 \uD559\uC0DD\uC744 \uBE60\uB974\uAC8C \uCC3E\uACE0 \uBC14\uB85C \uC870\uC815\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.'}</p>
                    </div>
                    <div className="text-sm font-bold text-gray-500">{`\uAC80\uC0C9 \uACB0\uACFC ${wallets.length}\uBA85`}</div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <select value={gradeFilter} onChange={(event) => onGradeFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">{'\uC804\uCCB4 \uD559\uB144'}</option>
                        {gradeOptions.map((option) => <option key={option} value={option}>{`${option}\uD559\uB144`}</option>)}
                    </select>
                    <select value={classFilter} onChange={(event) => onClassFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">{'\uC804\uCCB4 \uBC18'}</option>
                        {classOptions.map((option) => <option key={option} value={option}>{`${option}\uBC18`}</option>)}
                    </select>
                    <select value={numberFilter} onChange={(event) => onNumberFilterChange(event.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700">
                        <option value="all">{'\uC804\uCCB4 \uBC88\uD638'}</option>
                        {numberOptions.map((option) => <option key={option} value={option}>{`${option}\uBC88`}</option>)}
                    </select>
                    <input value={nameSearch} onChange={(event) => onNameSearchChange(event.target.value)} placeholder={'\uC774\uB984 \uB610\uB294 \uC77C\uBD80 \uAC80\uC0C9'} className="rounded-lg border border-gray-300 px-4 py-2 text-sm" />
                </div>
            </div>

            <div className="hidden md:block">
                <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_120px] gap-3 border-b border-gray-100 px-5 py-3 text-xs font-bold uppercase tracking-wide text-gray-500">
                    <div>{'\uD559\uC0DD'}</div>
                    <div>{'\uC18C\uC18D'}</div>
                    <div className="text-right">{'\uBCF4\uC720'}</div>
                    <div className="text-right">{'\uB204\uC801 \uC801\uB9BD'}</div>
                    <div className="text-right">{'\uB204\uC801 \uC0AC\uC6A9'}</div>
                </div>
                <div className="divide-y divide-gray-100">
                    {wallets.length === 0 && <div className="px-5 py-12 text-center text-sm text-gray-400">{'\uC870\uAC74\uC5D0 \uB9DE\uB294 \uD559\uC0DD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}</div>}
                    {wallets.map((wallet) => (
                        <button
                            key={wallet.uid}
                            type="button"
                            onClick={() => onSelectWallet(wallet.uid)}
                            className={`grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_110px_120px_120px] gap-3 px-5 py-4 text-left transition ${wallet.uid === selectedUid ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                            <div className="min-w-0">
                                <div className="truncate font-bold text-gray-800">{wallet.studentName || '(\uC774\uB984 \uC5C6\uC74C)'}</div>
                                <div className="mt-1 text-xs text-gray-500">{`\uCD5C\uADFC \uBCC0\uB3D9\uC77C ${formatPointDateOnly(wallet.lastTransactionAt)}`}</div>
                            </div>
                            <div className="truncate text-sm text-gray-600">{formatPointStudentLabel(wallet) || '-'}</div>
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
                <div className="py-16 text-center text-gray-400">{'\uC67C\uCABD \uBAA9\uB85D\uC5D0\uC11C \uD559\uC0DD\uC744 \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.'}</div>
            ) : (
                <>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h3 className="text-xl font-extrabold text-gray-900">{selectedWallet.studentName || '(\uC774\uB984 \uC5C6\uC74C)'}</h3>
                            <div className="mt-1 text-sm text-gray-500">{formatPointStudentLabel(selectedWallet) || '\uC18C\uC18D \uC815\uBCF4 \uC5C6\uC74C'}</div>
                        </div>
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                            <div className="text-xs font-bold text-blue-500">{'\uD604\uC7AC \uBCF4\uC720 \uD3EC\uC778\uD2B8'}</div>
                            <div className="mt-1 text-3xl font-black text-blue-700">{selectedWallet.balance || 0}</div>
                        </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="text-xs font-bold text-gray-500">{'\uB204\uC801 \uC801\uB9BD'}</div>
                            <div className="mt-1 text-lg font-extrabold text-emerald-600">{selectedWallet.earnedTotal || 0}</div>
                        </div>
                        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                            <div className="text-xs font-bold text-gray-500">{'\uB204\uC801 \uC0AC\uC6A9'}</div>
                            <div className="mt-1 text-lg font-extrabold text-rose-500">{selectedWallet.spentTotal || 0}</div>
                        </div>
                    </div>

                    <div className="mt-5">
                        <div className="mb-3 font-bold text-gray-800">{'\uCD5C\uADFC \uAC70\uB798 \uB0B4\uC5ED'}</div>
                        <div className="max-h-[280px] overflow-y-auto rounded-xl border border-gray-200">
                            {transactions.length === 0 && <div className="p-6 text-center text-sm text-gray-400">{'\uAC70\uB798 \uB0B4\uC5ED\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.'}</div>}
                            {transactions.map((transaction) => {
                                const labelKey = transaction.activityType || transaction.type;
                                const label = POINT_TRANSACTION_TYPE_LABELS[labelKey] || transaction.type;
                                return (
                                    <div key={transaction.id} className="border-b border-gray-100 p-4 last:border-0">
                                        <div className="flex items-center justify-between gap-4">
                                            <div>
                                                <div className="font-bold text-gray-800">{transaction.sourceLabel || label}</div>
                                                <div className="mt-1 text-xs text-gray-500">
                                                    {label}
                                                    {transaction.targetMonth ? ` · ${transaction.targetMonth}` : ''}
                                                </div>
                                            </div>
                                            <div className={`text-sm font-extrabold ${getPointDeltaToneClass(transaction.delta)}`}>
                                                {transaction.delta >= 0 ? '+' : ''}
                                                {transaction.delta}
                                            </div>
                                        </div>
                                        <div className="mt-1 text-xs text-gray-500">{`\uC794\uC561 ${transaction.balanceAfter} · ${formatPointDateTime(transaction.createdAt)}`}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <form onSubmit={onSubmitAdjust} className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                        <div className="mb-1 font-bold text-gray-800">{'\uAD50\uC0AC \uC9C1\uC811 \uC9C0\uAE09\u00B7\uCC28\uAC10'}</div>
                        <p className="mb-4 text-sm text-gray-500">{'\uD55C \uBC88\uC5D0 \uD55C \uD559\uC0DD\uB9CC \uC120\uD0DD\uD574\uC11C \uC0AC\uC720\uC640 \uD568\uAED8 \uBC18\uC601\uD569\uB2C8\uB2E4.'}</p>
                        <div className="grid grid-cols-2 gap-3">
                            <button type="button" onClick={() => onActionChange('grant')} className={`rounded-lg px-4 py-2 text-sm font-bold ${action === 'grant' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600'}`}>{'\uD3EC\uC778\uD2B8 \uC9C0\uAE09'}</button>
                            <button type="button" onClick={() => onActionChange('deduct')} className={`rounded-lg px-4 py-2 text-sm font-bold ${action === 'deduct' ? 'bg-rose-500 text-white' : 'border border-gray-300 bg-white text-gray-600'}`}>{'\uD3EC\uC778\uD2B8 \uCC28\uAC10'}</button>
                        </div>
                        <input type="number" min="1" value={amount} onChange={(event) => onAmountChange(event.target.value)} placeholder={'\uC870\uC815\uD560 \uD3EC\uC778\uD2B8 \uC218\uB7C9'} className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm" disabled={!canManage} />
                        <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} rows={3} placeholder={'\uC608: \uD589\uC0AC \uCC38\uC5EC \uBCF4\uC0C1, \uC911\uBCF5 \uC801\uB9BD \uD68C\uC218'} className="mt-3 w-full rounded-lg border border-gray-300 px-4 py-3 text-sm" disabled={!canManage} />
                        {!!feedback && <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-bold ${getPointFeedbackToneClass(feedback)}`}>{feedback}</div>}
                        <button type="submit" disabled={!canManage} className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-blue-300">{'\uD3EC\uC778\uD2B8 \uBC18\uC601\uD558\uAE30'}</button>
                    </form>
                </>
            )}
        </div>
    </div>
);

export default PointsOverviewTab;
