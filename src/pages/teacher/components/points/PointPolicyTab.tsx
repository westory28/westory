import React from 'react';
import { POINT_POLICY_FIELD_HELPERS, POINT_POLICY_FIELD_LABELS } from '../../../../constants/pointLabels';
import { formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointPolicy } from '../../../../types';

interface PointPolicyTabProps {
    policy: PointPolicy;
    canManage: boolean;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: (event: React.FormEvent) => void;
}

const inputClassName = 'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm';

const PointPolicyTab: React.FC<PointPolicyTabProps> = ({ policy, canManage, onPolicyChange, onSubmit }) => (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">{'\uD3EC\uC778\uD2B8 \uC6B4\uC601 \uC815\uCC45'}</h2>
                    <p className="mt-1 text-sm text-gray-500">{'\uC774\uBC88 \uD559\uAE30 \uC790\uB3D9 \uC801\uB9BD, \uCD94\uAC00 \uBCF4\uC0C1, \uAD50\uC0AC \uC870\uC815 \uAE30\uC900\uC744 \uD55C \uD654\uBA74\uC5D0\uC11C \uAD00\uB9AC\uD569\uB2C8\uB2E4.'}</p>
                </div>
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{'\uC800\uC7A5 \uC989\uC2DC \uD604\uC7AC \uD559\uAE30 \uD3EC\uC778\uD2B8 \uC6B4\uC601\uC5D0 \uBC18\uC601\uB429\uB2C8\uB2E4.'}</div>
            </div>

            <div className="mt-6 space-y-6">
                <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                    <div className="mb-4">
                        <h3 className="font-bold text-gray-900">{'\uC790\uB3D9 \uC801\uB9BD \uAE30\uC900'}</h3>
                        <p className="mt-1 text-sm text-gray-500">{'\uD559\uC0DD \uD65C\uB3D9\uC774 \uC644\uB8CC\uB418\uBA74 \uC790\uB3D9\uC73C\uB85C \uC9C0\uAE09\uB418\uB294 \uAE30\uBCF8 \uD3EC\uC778\uD2B8\uC785\uB2C8\uB2E4.'}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <label>
                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceDaily}</div>
                            <input type="number" min="0" value={policy.attendanceDaily} onChange={(event) => onPolicyChange((prev) => ({ ...prev, attendanceDaily: Number(event.target.value || 0) }))} className={inputClassName} disabled={!canManage} />
                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.attendanceDaily}</div>
                        </label>
                        <label>
                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.quizSolve}</div>
                            <input type="number" min="0" value={policy.quizSolve} onChange={(event) => onPolicyChange((prev) => ({ ...prev, quizSolve: Number(event.target.value || 0) }))} className={inputClassName} disabled={!canManage} />
                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.quizSolve}</div>
                        </label>
                        <label>
                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.lessonView}</div>
                            <input type="number" min="0" value={policy.lessonView} onChange={(event) => onPolicyChange((prev) => ({ ...prev, lessonView: Number(event.target.value || 0) }))} className={inputClassName} disabled={!canManage} />
                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.lessonView}</div>
                        </label>
                    </div>
                </section>

                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="mb-4">
                        <h3 className="font-bold text-gray-900">{'\uCD94\uAC00 \uBCF4\uC0C1 \uAE30\uC900'}</h3>
                        <p className="mt-1 text-sm text-gray-500">{'\uAFB8\uC900\uD788 \uCC38\uC5EC\uD55C \uD559\uC0DD\uC5D0\uAC8C \uD55C \uB2E8\uACC4 \uB354 \uBCF4\uC0C1\uD560 \uC218 \uC788\uB294 \uC6B4\uC601 \uD56D\uBAA9\uC785\uB2C8\uB2E4.'}</p>
                    </div>
                    <label className="block max-w-sm">
                        <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceMonthlyBonus}</div>
                        <input type="number" min="0" value={policy.attendanceMonthlyBonus} onChange={(event) => onPolicyChange((prev) => ({ ...prev, attendanceMonthlyBonus: Number(event.target.value || 0) }))} className={inputClassName} disabled={!canManage} />
                        <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.attendanceMonthlyBonus}</div>
                    </label>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-white p-5">
                    <div className="mb-4">
                        <h3 className="font-bold text-gray-900">{'\uC6B4\uC601 \uC81C\uC5B4 \uC124\uC815'}</h3>
                        <p className="mt-1 text-sm text-gray-500">{'\uAD50\uC0AC \uC870\uC815 \uAE30\uB2A5\uACFC \uCC28\uAC10 \uD5C8\uC6A9 \uBC94\uC704\uB97C \uC6B4\uC601 \uAE30\uC900\uC5D0 \uB9DE\uAC8C \uC124\uC815\uD569\uB2C8\uB2E4.'}</p>
                    </div>
                    <div className="space-y-3">
                        <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                            <div>
                                <div className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.manualAdjustEnabled}</div>
                                <div className="mt-1 text-sm text-gray-500">{POINT_POLICY_FIELD_HELPERS.manualAdjustEnabled}</div>
                            </div>
                            <input type="checkbox" checked={policy.manualAdjustEnabled} onChange={(event) => onPolicyChange((prev) => ({ ...prev, manualAdjustEnabled: event.target.checked }))} disabled={!canManage} className="h-4 w-4" />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                            <div>
                                <div className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.allowNegativeBalance}</div>
                                <div className="mt-1 text-sm text-gray-500">{POINT_POLICY_FIELD_HELPERS.allowNegativeBalance}</div>
                            </div>
                            <input type="checkbox" checked={policy.allowNegativeBalance} onChange={(event) => onPolicyChange((prev) => ({ ...prev, allowNegativeBalance: event.target.checked }))} disabled={!canManage} className="h-4 w-4" />
                        </label>
                    </div>
                </section>
            </div>

            <button type="submit" disabled={!canManage} className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300">{'\uC6B4\uC601 \uC815\uCC45 \uC800\uC7A5'}</button>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800">{'\uC815\uCC45 \uBA54\uD0C0 \uC815\uBCF4'}</h3>
            <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="text-gray-500">{'\uB9C8\uC9C0\uB9C9 \uC218\uC815\uC790'}</div>
                    <div className="mt-1 font-bold text-gray-900">{policy.updatedBy || '-'}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="text-gray-500">{'\uB9C8\uC9C0\uB9C9 \uC218\uC815 \uC2DC\uAC01'}</div>
                    <div className="mt-1 font-bold text-gray-900">{formatPointDateTime(policy.updatedAt)}</div>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">{'\uC6D4\uAC04 \uAC1C\uADFC \uBCF4\uB108\uC2A4\uB294 \uD574\uB2F9 \uC6D4 \uB9C8\uC9C0\uB9C9 \uCD9C\uC11D \uC2DC\uC810\uC5D0 \uC11C\uBC84\uC5D0\uC11C \uD55C \uBC88\uB9CC \uACC4\uC0B0\uB418\uACE0, \uAC70\uB798 \uC6D0\uC7A5\uC73C\uB85C \uC911\uBCF5 \uC9C0\uAE09\uC744 \uB9C9\uC2B5\uB2C8\uB2E4.'}</div>
            </div>
        </div>
    </div>
);

export default PointPolicyTab;
