import React from 'react';
import { POINT_POLICY_FIELD_HELPERS, POINT_POLICY_FIELD_LABELS } from '../../../../constants/pointLabels';
import { formatWisAmount } from '../../../../lib/pointFormatters';
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

const inputClassName = 'w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-50';
const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const sectionCardClassName = 'rounded-[1.6rem] border border-gray-200 bg-white p-5 shadow-sm';
const metricCardClassName = 'rounded-2xl border border-gray-200 bg-gray-50/80 p-4';

const ToggleCard = ({
    title,
    description,
    checked,
    disabled,
    onChange,
}: {
    title: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (nextChecked: boolean) => void;
}) => (
    <label className="flex items-start justify-between gap-4 rounded-2xl border border-gray-200 bg-white px-4 py-4">
        <div className="min-w-0">
            <div className="font-bold text-gray-900 whitespace-nowrap">{title}</div>
            <div className="mt-1 text-sm leading-6 text-gray-500">{description}</div>
        </div>
        <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            disabled={disabled}
            className="mt-1 h-4 w-4 shrink-0"
        />
    </label>
);

const RewardAmountCard = ({
    title,
    description,
    value,
    disabled,
    summary,
    onChange,
}: {
    title: string;
    description: string;
    value: number;
    disabled?: boolean;
    summary: string;
    onChange: (nextValue: number) => void;
}) => (
    <label className={metricCardClassName}>
        <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
                <div className="text-sm font-bold text-gray-900 whitespace-nowrap">{title}</div>
                <div className="mt-1 text-xs leading-5 text-gray-500">{description}</div>
            </div>
            <span className="inline-flex whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                {summary}
            </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px] sm:items-center">
            <input
                type="number"
                min="0"
                value={value}
                onChange={(event) => onChange(Number(event.target.value || 0))}
                className={inputClassName}
                disabled={disabled}
            />
            <div className="inline-flex h-[50px] items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-700 whitespace-nowrap">
                {formatWisAmount(value)}
            </div>
        </div>
    </label>
);

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
                <h2 className="text-lg font-bold text-gray-900">위스 운영 정책</h2>
                <p className="mt-1 text-sm text-gray-500">
                    학생 행동별 자동 지급, 보너스 규칙, 직접 조정 허용 범위를 한 화면에서 정리합니다.
                </p>
            </div>
            <div className="flex flex-col items-start gap-3 md:items-end">
                <button
                    type="submit"
                    disabled={!canManage}
                    className="inline-flex items-center justify-center whitespace-nowrap rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:bg-blue-300"
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
                        ? '저장되지 않은 변경사항이 있습니다. 저장 후 실제 운영 정책에 반영됩니다.'
                        : '현재 저장된 운영 정책과 동일합니다.'}
                </div>
                {saveFeedbackMessage && saveFeedbackTone && (
                    <div className={`rounded-xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}>
                        {saveFeedbackMessage}
                    </div>
                )}
            </div>
        </div>

        <section className={sectionCardClassName}>
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h3 className="text-base font-extrabold text-gray-900">A. 기본 자동 지급</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        어떤 행동을 했을 때 기본으로 얼마의 위스를 지급할지 설정합니다.
                    </p>
                </div>
                <span className="inline-flex self-start whitespace-nowrap rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
                    행동 → 기본 위스
                </span>
            </div>

            <div className="mt-4">
                <ToggleCard
                    title={POINT_POLICY_FIELD_LABELS.autoRewardEnabled}
                    description={POINT_POLICY_FIELD_HELPERS.autoRewardEnabled}
                    checked={policy.autoRewardEnabled}
                    disabled={!canManage}
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        autoRewardEnabled: checked,
                    }))}
                />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <RewardAmountCard
                    title={POINT_POLICY_FIELD_LABELS.attendanceDaily}
                    description={POINT_POLICY_FIELD_HELPERS.attendanceDaily}
                    value={policy.attendanceDaily}
                    disabled={!canManage}
                    summary="출석 체크"
                    onChange={(value) => onPolicyChange((prev) => ({
                        ...prev,
                        attendanceDaily: value,
                    }))}
                />
                <RewardAmountCard
                    title={POINT_POLICY_FIELD_LABELS.quizSolve}
                    description={POINT_POLICY_FIELD_HELPERS.quizSolve}
                    value={policy.quizSolve}
                    disabled={!canManage}
                    summary="문제 풀이"
                    onChange={(value) => onPolicyChange((prev) => ({
                        ...prev,
                        quizSolve: value,
                    }))}
                />
                <RewardAmountCard
                    title={POINT_POLICY_FIELD_LABELS.lessonView}
                    description={POINT_POLICY_FIELD_HELPERS.lessonView}
                    value={policy.lessonView}
                    disabled={!canManage}
                    summary="수업 자료 확인"
                    onChange={(value) => onPolicyChange((prev) => ({
                        ...prev,
                        lessonView: value,
                    }))}
                />
            </div>
        </section>

        <section className={sectionCardClassName}>
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h3 className="text-base font-extrabold text-gray-900">B. 조건부 보너스</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        기본 지급과 별도로 한 번만 지급되어야 하는 추가 위스를 관리합니다.
                    </p>
                </div>
                <span className="inline-flex self-start whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                    기본 지급과 분리 저장
                </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.96fr)_minmax(0,1.04fr)]">
                <RewardAmountCard
                    title={POINT_POLICY_FIELD_LABELS.attendanceMonthlyBonus}
                    description={POINT_POLICY_FIELD_HELPERS.attendanceMonthlyBonus}
                    value={policy.attendanceMonthlyBonus}
                    disabled={!canManage}
                    summary="월간 개근"
                    onChange={(value) => onPolicyChange((prev) => ({
                        ...prev,
                        attendanceMonthlyBonus: value,
                    }))}
                />

                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <ToggleCard
                        title={POINT_POLICY_FIELD_LABELS.quizBonusEnabled}
                        description={POINT_POLICY_FIELD_HELPERS.quizBonusEnabled}
                        checked={policy.quizBonusEnabled}
                        disabled={!canManage || !policy.autoRewardEnabled}
                        onChange={(checked) => onPolicyChange((prev) => ({
                            ...prev,
                            quizBonusEnabled: checked,
                        }))}
                    />
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="rounded-2xl border border-amber-100 bg-white px-4 py-4">
                            <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                                {POINT_POLICY_FIELD_LABELS.quizBonusThreshold}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">
                                {POINT_POLICY_FIELD_HELPERS.quizBonusThreshold}
                            </div>
                            <div className="mt-4 grid gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={policy.quizBonusThreshold}
                                    onChange={(event) => onPolicyChange((prev) => ({
                                        ...prev,
                                        quizBonusThreshold: Number(event.target.value || 0),
                                    }))}
                                    className={inputClassName}
                                    disabled={!canManage || !policy.quizBonusEnabled || !policy.autoRewardEnabled}
                                />
                                <div className="inline-flex h-[50px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 whitespace-nowrap">
                                    {`${Number(policy.quizBonusThreshold || 0)}점 이상`}
                                </div>
                            </div>
                        </label>

                        <label className="rounded-2xl border border-amber-100 bg-white px-4 py-4">
                            <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                                {POINT_POLICY_FIELD_LABELS.quizBonusAmount}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">
                                {POINT_POLICY_FIELD_HELPERS.quizBonusAmount}
                            </div>
                            <div className="mt-4 grid gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={policy.quizBonusAmount}
                                    onChange={(event) => onPolicyChange((prev) => ({
                                        ...prev,
                                        quizBonusAmount: Number(event.target.value || 0),
                                    }))}
                                    className={inputClassName}
                                    disabled={!canManage || !policy.quizBonusEnabled || !policy.autoRewardEnabled}
                                />
                                <div className="inline-flex h-[50px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 whitespace-nowrap">
                                    {formatWisAmount(policy.quizBonusAmount)}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            </div>
        </section>

        <section className={sectionCardClassName}>
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                    <h3 className="text-base font-extrabold text-gray-900">C. 운영 제어</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        교사 직접 조정 가능 여부와 잔액 정책을 보수적으로 제어합니다.
                    </p>
                </div>
                <span className="inline-flex self-start whitespace-nowrap rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-bold text-gray-600">
                    trusted write path 유지
                </span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ToggleCard
                    title={POINT_POLICY_FIELD_LABELS.manualAdjustEnabled}
                    description={POINT_POLICY_FIELD_HELPERS.manualAdjustEnabled}
                    checked={policy.manualAdjustEnabled}
                    disabled={!canManage}
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        manualAdjustEnabled: checked,
                    }))}
                />
                <ToggleCard
                    title={POINT_POLICY_FIELD_LABELS.allowNegativeBalance}
                    description={POINT_POLICY_FIELD_HELPERS.allowNegativeBalance}
                    checked={policy.allowNegativeBalance}
                    disabled={!canManage}
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        allowNegativeBalance: checked,
                    }))}
                />
            </div>
        </section>
    </form>
);

export default PointPolicyTab;
