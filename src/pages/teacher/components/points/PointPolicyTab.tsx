import React from 'react';
import { POINT_POLICY_FIELD_HELPERS, POINT_POLICY_FIELD_LABELS } from '../../../../constants/pointLabels';
import type { PointPolicy } from '../../../../types';

interface PointPolicyTabProps {
    policy: PointPolicy;
    canManage: boolean;
    hasUnsavedChanges: boolean;
    saveFeedbackMessage: string;
    saveFeedbackTone: 'success' | 'error' | 'warning' | null;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: () => void;
}

const inputClassName = 'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm';
const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const PointPolicyTab: React.FC<PointPolicyTabProps> = ({
    policy,
    canManage,
    hasUnsavedChanges,
    saveFeedbackMessage,
    saveFeedbackTone,
    onPolicyChange,
    onSubmit,
}) => (
    <form
        onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
        }}
        className="space-y-6"
    >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
                <h2 className="text-lg font-bold text-gray-900">운영 정책</h2>
                <p className="mt-1 text-sm text-gray-500">
                    학생 활동 포인트만 조정합니다. 등급과 이모지는 등급 설정 탭에서 관리합니다.
                </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
                <button
                    type="submit"
                    disabled={!canManage}
                    className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300"
                >
                    운영 정책 저장
                </button>
                <div className={[
                    'rounded-xl border px-4 py-3 text-sm',
                    hasUnsavedChanges
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-gray-200 bg-gray-50 text-gray-600',
                ].join(' ')}>
                    {hasUnsavedChanges
                        ? '저장 전 변경사항이 있습니다. 저장해야 실제 운영 정책에 반영됩니다.'
                        : '저장된 운영 정책과 같습니다.'}
                </div>
                {saveFeedbackMessage && saveFeedbackTone && (
                    <div className={`rounded-xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}>
                        {saveFeedbackMessage}
                    </div>
                )}
            </div>
        </div>

        <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
            <div className="mb-4">
                <h3 className="font-bold text-gray-900">기본 포인트</h3>
                <p className="mt-1 text-sm text-gray-500">학생 활동에 바로 연결되는 기본 포인트 항목만 수정합니다.</p>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceDaily}</div>
                    <input
                        type="number"
                        min="0"
                        value={policy.attendanceDaily}
                        onChange={(event) => onPolicyChange((prev) => ({
                            ...prev,
                            attendanceDaily: Number(event.target.value || 0),
                        }))}
                        className={inputClassName}
                        disabled={!canManage}
                    />
                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.attendanceDaily}</div>
                </label>
                <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.quizSolve}</div>
                    <input
                        type="number"
                        min="0"
                        value={policy.quizSolve}
                        onChange={(event) => onPolicyChange((prev) => ({
                            ...prev,
                            quizSolve: Number(event.target.value || 0),
                        }))}
                        className={inputClassName}
                        disabled={!canManage}
                    />
                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.quizSolve}</div>
                </label>
                <label className="block">
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.lessonView}</div>
                    <input
                        type="number"
                        min="0"
                        value={policy.lessonView}
                        onChange={(event) => onPolicyChange((prev) => ({
                            ...prev,
                            lessonView: Number(event.target.value || 0),
                        }))}
                        className={inputClassName}
                        disabled={!canManage}
                    />
                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.lessonView}</div>
                </label>
            </div>
        </section>

        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="mb-4">
                <h3 className="font-bold text-gray-900">추가 보상</h3>
                <p className="mt-1 text-sm text-gray-500">월간 개근 보상처럼 한 번만 지급되는 운영 항목을 설정합니다.</p>
            </div>
            <label className="block max-w-sm">
                <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceMonthlyBonus}</div>
                <input
                    type="number"
                    min="0"
                    value={policy.attendanceMonthlyBonus}
                    onChange={(event) => onPolicyChange((prev) => ({
                        ...prev,
                        attendanceMonthlyBonus: Number(event.target.value || 0),
                    }))}
                    className={inputClassName}
                    disabled={!canManage}
                />
                <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.attendanceMonthlyBonus}</div>
            </label>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-4">
                <h3 className="font-bold text-gray-900">운영 제어</h3>
                <p className="mt-1 text-sm text-gray-500">교사 직접 조정과 마이너스 잔액 허용 여부를 정합니다.</p>
            </div>
            <div className="space-y-3">
                <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                    <div>
                        <div className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.manualAdjustEnabled}</div>
                        <div className="mt-1 text-sm text-gray-500">{POINT_POLICY_FIELD_HELPERS.manualAdjustEnabled}</div>
                    </div>
                    <input
                        type="checkbox"
                        checked={policy.manualAdjustEnabled}
                        onChange={(event) => onPolicyChange((prev) => ({
                            ...prev,
                            manualAdjustEnabled: event.target.checked,
                        }))}
                        disabled={!canManage}
                        className="h-4 w-4"
                    />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                    <div>
                        <div className="font-bold text-gray-800">{POINT_POLICY_FIELD_LABELS.allowNegativeBalance}</div>
                        <div className="mt-1 text-sm text-gray-500">{POINT_POLICY_FIELD_HELPERS.allowNegativeBalance}</div>
                    </div>
                    <input
                        type="checkbox"
                        checked={policy.allowNegativeBalance}
                        onChange={(event) => onPolicyChange((prev) => ({
                            ...prev,
                            allowNegativeBalance: event.target.checked,
                        }))}
                        disabled={!canManage}
                        className="h-4 w-4"
                    />
                </label>
            </div>
        </section>
    </form>
);

export default PointPolicyTab;
