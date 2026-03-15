import React from 'react';
import { POINT_POLICY_FIELD_LABELS } from '../../../../constants/pointLabels';
import { formatPointDateTime } from '../../../../lib/pointFormatters';
import type { PointPolicy } from '../../../../types';

interface PointPolicyTabProps {
    policy: PointPolicy;
    canManage: boolean;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: (event: React.FormEvent) => void;
}

const PointPolicyTab: React.FC<PointPolicyTabProps> = ({ policy, canManage, onPolicyChange, onSubmit }) => (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        <form onSubmit={onSubmit} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-800">포인트 정책</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label>
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceDaily}</div>
                    <input
                        type="number"
                        value={policy.attendanceDaily}
                        onChange={(event) => onPolicyChange((prev) => ({ ...prev, attendanceDaily: Number(event.target.value || 0) }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
                        disabled={!canManage}
                    />
                </label>
                <label>
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.quizSolve}</div>
                    <input
                        type="number"
                        value={policy.quizSolve}
                        onChange={(event) => onPolicyChange((prev) => ({ ...prev, quizSolve: Number(event.target.value || 0) }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
                        disabled={!canManage}
                    />
                </label>
                <label className="md:col-span-2">
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.lessonView}</div>
                    <input
                        type="number"
                        value={policy.lessonView}
                        onChange={(event) => onPolicyChange((prev) => ({ ...prev, lessonView: Number(event.target.value || 0) }))}
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm"
                        disabled={!canManage}
                    />
                </label>
                <label className="md:col-span-2 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <span className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.manualAdjustEnabled}</span>
                    <input
                        type="checkbox"
                        checked={policy.manualAdjustEnabled}
                        onChange={(event) => onPolicyChange((prev) => ({ ...prev, manualAdjustEnabled: event.target.checked }))}
                        disabled={!canManage}
                        className="h-4 w-4"
                    />
                </label>
                <label className="md:col-span-2 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <span className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.allowNegativeBalance}</span>
                    <input
                        type="checkbox"
                        checked={policy.allowNegativeBalance}
                        onChange={(event) => onPolicyChange((prev) => ({ ...prev, allowNegativeBalance: event.target.checked }))}
                        disabled={!canManage}
                        className="h-4 w-4"
                    />
                </label>
            </div>
            <button
                type="submit"
                disabled={!canManage}
                className="mt-5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
            >
                정책 저장
            </button>
        </form>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h3 className="text-lg font-bold text-gray-800">정책 메타 정보</h3>
            <div className="mt-4 space-y-3 text-sm">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="text-gray-500">마지막 수정자</div>
                    <div className="mt-1 font-bold text-gray-900">{policy.updatedBy || '-'}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                    <div className="text-gray-500">마지막 수정 시각</div>
                    <div className="mt-1 font-bold text-gray-900">{formatPointDateTime(policy.updatedAt)}</div>
                </div>
            </div>
        </div>
    </div>
);

export default PointPolicyTab;
