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
const policyRuleCardClassName = 'rounded-2xl border border-gray-200 bg-white p-4';

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

const InlineMetricField = ({
    title,
    description,
    value,
    disabled,
    suffix,
    onChange,
}: {
    title: string;
    description: string;
    value: number;
    disabled?: boolean;
    suffix: string;
    onChange: (nextValue: number) => void;
}) => (
    <label className="rounded-2xl border border-gray-200 bg-gray-50/70 px-4 py-4">
        <div className="text-sm font-bold text-gray-900 whitespace-nowrap">{title}</div>
        <div className="mt-1 text-xs leading-5 text-gray-500">{description}</div>
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
                {suffix}
            </div>
        </div>
    </label>
);

const PolicyRuleCard = ({
    title,
    description,
    checked,
    disabled,
    summary,
    footer,
    onChange,
    children,
}: {
    title: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    summary: string;
    footer: string;
    onChange: (nextChecked: boolean) => void;
    children: React.ReactNode;
}) => (
    <div className={policyRuleCardClassName}>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
                <div className="text-base font-extrabold text-gray-900">{title}</div>
                <div className="mt-1 text-sm leading-6 text-gray-500">{description}</div>
            </div>
            <div className="flex items-center gap-3">
                <span className="inline-flex whitespace-nowrap rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                    {summary}
                </span>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onChange(event.target.checked)}
                    disabled={disabled}
                    className="h-4 w-4 shrink-0"
                />
            </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4">{children}</div>
        <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-xs font-medium leading-5 text-gray-600">
            {footer}
        </div>
    </div>
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

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <PolicyRuleCard
                    title={POINT_POLICY_FIELD_LABELS.thinkCloudEnabled}
                    description={POINT_POLICY_FIELD_HELPERS.thinkCloudEnabled}
                    checked={policy.thinkCloudEnabled}
                    disabled={!canManage || !policy.autoRewardEnabled}
                    summary={`총 최대 ${formatWisAmount(policy.thinkCloudAmount * policy.thinkCloudMaxClaims)}`}
                    footer="생각모아 참여 보상은 마지막 적립 시점 기준 rolling 24시간마다 1회만 인정되고, 학생당 누적 최대 횟수를 넘기면 더 이상 지급되지 않습니다."
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        thinkCloudEnabled: checked,
                    }))}
                >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.thinkCloudAmount}
                            description={POINT_POLICY_FIELD_HELPERS.thinkCloudAmount}
                            value={policy.thinkCloudAmount}
                            disabled={!canManage || !policy.autoRewardEnabled || !policy.thinkCloudEnabled}
                            suffix={formatWisAmount(policy.thinkCloudAmount)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                thinkCloudAmount: value,
                            }))}
                        />
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.thinkCloudMaxClaims}
                            description={POINT_POLICY_FIELD_HELPERS.thinkCloudMaxClaims}
                            value={policy.thinkCloudMaxClaims}
                            disabled={!canManage || !policy.autoRewardEnabled || !policy.thinkCloudEnabled}
                            suffix={`${policy.thinkCloudMaxClaims}회`}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                thinkCloudMaxClaims: Math.max(1, Math.round(value || 0)),
                            }))}
                        />
                    </div>
                </PolicyRuleCard>

                <PolicyRuleCard
                    title={POINT_POLICY_FIELD_LABELS.mapTagEnabled}
                    description={POINT_POLICY_FIELD_HELPERS.mapTagEnabled}
                    checked={policy.mapTagEnabled}
                    disabled={!canManage || !policy.autoRewardEnabled}
                    summary={`총 최대 ${formatWisAmount(policy.mapTagAmount * policy.mapTagMaxClaims)}`}
                    footer="지도 보상은 팝업 모달 안에서 태그를 직접 눌렀을 때만 적립됩니다. 단순 모달 열기만으로는 지급되지 않으며, 마지막 적립 후 24시간이 지나야 다시 인정됩니다."
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        mapTagEnabled: checked,
                    }))}
                >
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.mapTagAmount}
                            description={POINT_POLICY_FIELD_HELPERS.mapTagAmount}
                            value={policy.mapTagAmount}
                            disabled={!canManage || !policy.autoRewardEnabled || !policy.mapTagEnabled}
                            suffix={formatWisAmount(policy.mapTagAmount)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                mapTagAmount: value,
                            }))}
                        />
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.mapTagMaxClaims}
                            description={POINT_POLICY_FIELD_HELPERS.mapTagMaxClaims}
                            value={policy.mapTagMaxClaims}
                            disabled={!canManage || !policy.autoRewardEnabled || !policy.mapTagEnabled}
                            suffix={`${policy.mapTagMaxClaims}회`}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                mapTagMaxClaims: Math.max(1, Math.round(value || 0)),
                            }))}
                        />
                    </div>
                </PolicyRuleCard>
            </div>

            <div className="mt-4">
                <PolicyRuleCard
                    title={POINT_POLICY_FIELD_LABELS.historyClassroomEnabled}
                    description={POINT_POLICY_FIELD_HELPERS.historyClassroomEnabled}
                    checked={policy.historyClassroomEnabled}
                    disabled={!canManage || !policy.autoRewardEnabled}
                    summary="24시간마다 1회"
                    footer="역사교실 기본 참여 위스는 같은 학생 기준으로 마지막 적립 시점부터 24시간이 지나야 다시 지급됩니다."
                    onChange={(checked) => onPolicyChange((prev) => ({
                        ...prev,
                        historyClassroomEnabled: checked,
                    }))}
                >
                    <InlineMetricField
                        title={POINT_POLICY_FIELD_LABELS.historyClassroomAmount}
                        description={POINT_POLICY_FIELD_HELPERS.historyClassroomAmount}
                        value={policy.historyClassroomAmount}
                        disabled={!canManage || !policy.autoRewardEnabled || !policy.historyClassroomEnabled}
                        suffix={formatWisAmount(policy.historyClassroomAmount)}
                        onChange={(value) => onPolicyChange((prev) => ({
                            ...prev,
                            historyClassroomAmount: value,
                        }))}
                    />
                </PolicyRuleCard>
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

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
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

                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                    <ToggleCard
                        title={POINT_POLICY_FIELD_LABELS.historyClassroomBonusEnabled}
                        description={POINT_POLICY_FIELD_HELPERS.historyClassroomBonusEnabled}
                        checked={policy.historyClassroomBonusEnabled}
                        disabled={!canManage || !policy.autoRewardEnabled}
                        onChange={(checked) => onPolicyChange((prev) => ({
                            ...prev,
                            historyClassroomBonusEnabled: checked,
                        }))}
                    />
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <label className="rounded-2xl border border-amber-100 bg-white px-4 py-4">
                            <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                                {POINT_POLICY_FIELD_LABELS.historyClassroomBonusThreshold}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">
                                {POINT_POLICY_FIELD_HELPERS.historyClassroomBonusThreshold}
                            </div>
                            <div className="mt-4 grid gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={policy.historyClassroomBonusThreshold}
                                    onChange={(event) => onPolicyChange((prev) => ({
                                        ...prev,
                                        historyClassroomBonusThreshold: Number(event.target.value || 0),
                                    }))}
                                    className={inputClassName}
                                    disabled={!canManage || !policy.historyClassroomBonusEnabled || !policy.autoRewardEnabled}
                                />
                                <div className="inline-flex h-[50px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 whitespace-nowrap">
                                    {`${Number(policy.historyClassroomBonusThreshold || 0)}% 이상`}
                                </div>
                            </div>
                        </label>

                        <label className="rounded-2xl border border-amber-100 bg-white px-4 py-4">
                            <div className="text-sm font-bold text-gray-900 whitespace-nowrap">
                                {POINT_POLICY_FIELD_LABELS.historyClassroomBonusAmount}
                            </div>
                            <div className="mt-1 text-xs leading-5 text-gray-500">
                                {POINT_POLICY_FIELD_HELPERS.historyClassroomBonusAmount}
                            </div>
                            <div className="mt-4 grid gap-2">
                                <input
                                    type="number"
                                    min="0"
                                    value={policy.historyClassroomBonusAmount}
                                    onChange={(event) => onPolicyChange((prev) => ({
                                        ...prev,
                                        historyClassroomBonusAmount: Number(event.target.value || 0),
                                    }))}
                                    className={inputClassName}
                                    disabled={!canManage || !policy.historyClassroomBonusEnabled || !policy.autoRewardEnabled}
                                />
                                <div className="inline-flex h-[50px] items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-700 whitespace-nowrap">
                                    {formatWisAmount(policy.historyClassroomBonusAmount)}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 xl:col-span-2">
                    <ToggleCard
                        title={POINT_POLICY_FIELD_LABELS.attendanceMilestoneBonusEnabled}
                        description={POINT_POLICY_FIELD_HELPERS.attendanceMilestoneBonusEnabled}
                        checked={policy.attendanceMilestoneBonusEnabled}
                        disabled={!canManage || !policy.autoRewardEnabled}
                        onChange={(checked) => onPolicyChange((prev) => ({
                            ...prev,
                            attendanceMilestoneBonusEnabled: checked,
                        }))}
                    />
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.attendanceMilestone50}
                            description={POINT_POLICY_FIELD_HELPERS.attendanceMilestone50}
                            value={policy.attendanceMilestone50}
                            disabled={!canManage || !policy.attendanceMilestoneBonusEnabled || !policy.autoRewardEnabled}
                            suffix={formatWisAmount(policy.attendanceMilestone50)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                attendanceMilestone50: value,
                            }))}
                        />
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.attendanceMilestone100}
                            description={POINT_POLICY_FIELD_HELPERS.attendanceMilestone100}
                            value={policy.attendanceMilestone100}
                            disabled={!canManage || !policy.attendanceMilestoneBonusEnabled || !policy.autoRewardEnabled}
                            suffix={formatWisAmount(policy.attendanceMilestone100)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                attendanceMilestone100: value,
                            }))}
                        />
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.attendanceMilestone200}
                            description={POINT_POLICY_FIELD_HELPERS.attendanceMilestone200}
                            value={policy.attendanceMilestone200}
                            disabled={!canManage || !policy.attendanceMilestoneBonusEnabled || !policy.autoRewardEnabled}
                            suffix={formatWisAmount(policy.attendanceMilestone200)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                attendanceMilestone200: value,
                            }))}
                        />
                        <InlineMetricField
                            title={POINT_POLICY_FIELD_LABELS.attendanceMilestone300}
                            description={POINT_POLICY_FIELD_HELPERS.attendanceMilestone300}
                            value={policy.attendanceMilestone300}
                            disabled={!canManage || !policy.attendanceMilestoneBonusEnabled || !policy.autoRewardEnabled}
                            suffix={formatWisAmount(policy.attendanceMilestone300)}
                            onChange={(value) => onPolicyChange((prev) => ({
                                ...prev,
                                attendanceMilestone300: value,
                            }))}
                        />
                    </div>
                    <div className="mt-4 rounded-2xl border border-dashed border-amber-200 bg-white/80 px-4 py-3 text-xs font-medium leading-5 text-gray-600">
                        누적 출석 50회, 100회, 200회, 300회를 정확히 달성한 시점에만 각 보너스가 학생당 1회씩 지급됩니다.
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
