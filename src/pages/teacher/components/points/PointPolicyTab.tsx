import React from 'react';
import {
    POINT_POLICY_FIELD_HELPERS,
    POINT_POLICY_FIELD_LABELS,
} from '../../../../constants/pointLabels';
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

interface PolicySectionItem {
    id: string;
    label: string;
    description: string;
}

interface PolicyToggleProps {
    title: string;
    description: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (nextChecked: boolean) => void;
}

interface AmountFieldProps {
    title: string;
    description: string;
    value: number;
    disabled?: boolean;
    suffix: string;
    min?: number;
    onChange: (nextValue: number) => void;
}

const policySections: PolicySectionItem[] = [
    {
        id: 'policy-auto-reward',
        label: '기본 자동 지급',
        description: '기본 행동 보상',
    },
    {
        id: 'policy-bonus',
        label: '조건부 보너스',
        description: '추가 조건 달성 보상',
    },
    {
        id: 'policy-control',
        label: '운영 제어',
        description: '운영 관련 설정',
    },
];

const inputClassName =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 shadow-sm transition focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:bg-slate-100 disabled:text-slate-500';
const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const formatClaims = (value: number) =>
    `${Math.max(1, Math.round(Number(value || 0)))}회`;
const formatScoreThreshold = (value: number) => `${Number(value || 0)}점 이상`;
const formatPercentThreshold = (value: number) => `${Number(value || 0)}% 이상`;

const ToggleSwitch = ({
    checked,
    disabled,
}: {
    checked: boolean;
    disabled?: boolean;
}) => (
    <span
        aria-hidden="true"
        className={[
            'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition',
            checked ? 'bg-blue-600' : 'bg-slate-300',
            disabled ? 'opacity-60' : '',
        ].join(' ')}
    >
        <span
            className={[
                'inline-block h-5 w-5 rounded-full bg-white shadow transition',
                checked ? 'translate-x-6' : 'translate-x-1',
            ].join(' ')}
        />
    </span>
);

const PolicyToggle = ({
    title,
    description,
    checked,
    disabled,
    onChange,
}: PolicyToggleProps) => (
    <label
        className={[
            'flex min-h-[88px] cursor-pointer items-center justify-between gap-4 rounded-lg border bg-white px-4 py-4 transition',
            checked ? 'border-blue-200 shadow-sm' : 'border-slate-200',
            disabled
                ? 'cursor-not-allowed opacity-70'
                : 'hover:border-blue-200 hover:bg-blue-50/30',
        ].join(' ')}
    >
        <span className="min-w-0">
            <span className="block text-sm font-extrabold text-slate-900">
                {title}
            </span>
            <span className="mt-1 block text-xs leading-5 text-slate-500">
                {description}
            </span>
        </span>
        <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            disabled={disabled}
            className="sr-only"
        />
        <ToggleSwitch checked={checked} disabled={disabled} />
    </label>
);

const QuickPolicyToggle = (props: PolicyToggleProps & { badge: string }) => (
    <PolicyToggle
        {...props}
        description={`${props.badge} · ${props.description}`}
    />
);

const AmountField = ({
    title,
    description,
    value,
    disabled,
    suffix,
    min = 0,
    onChange,
}: AmountFieldProps) => (
    <label className="block rounded-lg border border-slate-200 bg-white p-4">
        <span className="block text-sm font-extrabold text-slate-900">
            {title}
        </span>
        <span className="mt-1 block min-h-[40px] text-xs leading-5 text-slate-500">
            {description}
        </span>
        <span className="mt-3 grid grid-cols-[minmax(0,1fr)_92px] overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <input
                type="number"
                min={min}
                value={value}
                onChange={(event) => onChange(Number(event.target.value || 0))}
                className={`${inputClassName} rounded-none border-0 shadow-none focus:ring-0`}
                disabled={disabled}
            />
            <span className="inline-flex items-center justify-center border-l border-slate-200 px-2 text-xs font-bold text-slate-700">
                {suffix}
            </span>
        </span>
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
}: PolicyToggleProps & {
    summary: string;
    footer: string;
    children: React.ReactNode;
}) => (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-900">
                    {title}
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                    {description}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <span className="rounded-md border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                    {summary}
                </span>
                <label
                    className={
                        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                    }
                >
                    <input
                        type="checkbox"
                        aria-label={title}
                        checked={checked}
                        onChange={(event) => onChange(event.target.checked)}
                        disabled={disabled}
                        className="sr-only"
                    />
                    <ToggleSwitch checked={checked} disabled={disabled} />
                </label>
            </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4">{children}</div>
        <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {footer}
        </div>
    </div>
);

const SectionPanel = ({
    id,
    label,
    description,
    badge,
    children,
}: {
    id: string;
    label: string;
    description: string;
    badge: string;
    children: React.ReactNode;
}) => (
    <section
        id={id}
        className="scroll-mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
        <div className="flex flex-col gap-2 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
            <div>
                <h3 className="text-base font-extrabold text-slate-900">
                    {label}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{description}</p>
            </div>
            <span className="inline-flex self-start rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                {badge}
            </span>
        </div>
        <div className="mt-4">{children}</div>
    </section>
);

const PointPolicyTab: React.FC<PointPolicyTabProps> = ({
    policy,
    canManage,
    hasUnsavedChanges,
    saveFeedbackMessage,
    saveFeedbackTone,
    onPolicyChange,
    onSubmit,
}) => {
    const [activeSectionId, setActiveSectionId] = React.useState(
        policySections[0].id,
    );

    return (
        <form
            onSubmit={(event) => {
                event.preventDefault();
                onSubmit();
            }}
            className="space-y-6"
        >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-2xl font-extrabold tracking-normal text-slate-900">
                        위스 운영 정책
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">
                        학생 행동 자동 지급, 보너스 규칙, 직접 조정 허용 범위를
                        설정합니다.
                    </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div
                        className={[
                            'rounded-lg border px-4 py-2.5 text-sm font-semibold',
                            hasUnsavedChanges
                                ? 'border-amber-200 bg-amber-50 text-amber-800'
                                : 'border-slate-200 bg-slate-50 text-slate-600',
                        ].join(' ')}
                    >
                        {hasUnsavedChanges
                            ? '저장되지 않은 변경사항'
                            : '저장된 정책과 동일'}
                    </div>
                    <button
                        type="submit"
                        disabled={!canManage}
                        className="inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-5 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                    >
                        운영 정책 저장
                    </button>
                </div>
            </div>

            {saveFeedbackMessage && saveFeedbackTone && (
                <div
                    className={`rounded-lg px-4 py-3 text-sm font-semibold ${feedbackToneClassName[saveFeedbackTone]}`}
                >
                    {saveFeedbackMessage}
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <QuickPolicyToggle
                    badge="전체 자동 보상"
                    title={POINT_POLICY_FIELD_LABELS.autoRewardEnabled}
                    description="끄면 학생 활동 자동 적립이 모두 멈춥니다."
                    checked={policy.autoRewardEnabled}
                    disabled={!canManage}
                    onChange={(checked) =>
                        onPolicyChange((prev) => ({
                            ...prev,
                            autoRewardEnabled: checked,
                        }))
                    }
                />
                <QuickPolicyToggle
                    badge="교사 권한"
                    title={POINT_POLICY_FIELD_LABELS.manualAdjustEnabled}
                    description="지급 및 환수 탭의 실행 가능 여부를 정합니다."
                    checked={policy.manualAdjustEnabled}
                    disabled={!canManage}
                    onChange={(checked) =>
                        onPolicyChange((prev) => ({
                            ...prev,
                            manualAdjustEnabled: checked,
                        }))
                    }
                />
                <QuickPolicyToggle
                    badge="차감 제한"
                    title={POINT_POLICY_FIELD_LABELS.allowNegativeBalance}
                    description="보유 위스보다 많이 환수할 수 있는지 정합니다."
                    checked={policy.allowNegativeBalance}
                    disabled={!canManage}
                    onChange={(checked) =>
                        onPolicyChange((prev) => ({
                            ...prev,
                            allowNegativeBalance: checked,
                        }))
                    }
                />
            </div>

            <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
                <aside
                    className="lg:sticky lg:top-4 lg:self-start"
                    aria-label="운영 정책 하위 메뉴"
                >
                    <nav className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                        {policySections.map((item) => {
                            const isActive = activeSectionId === item.id;

                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setActiveSectionId(item.id)}
                                    aria-current={isActive ? 'page' : undefined}
                                    className={[
                                        'block w-full border-b border-slate-200 px-4 py-4 text-left transition last:border-b-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-400',
                                        isActive
                                            ? 'border-l-4 border-l-blue-600 bg-blue-50 text-blue-700'
                                            : 'border-l-4 border-l-transparent text-slate-700 hover:bg-slate-50 focus:bg-slate-50',
                                    ].join(' ')}
                                >
                                    <span className="block text-sm font-extrabold">
                                        {item.label}
                                    </span>
                                    <span
                                        className={[
                                            'mt-1 block text-xs leading-5',
                                            isActive
                                                ? 'text-blue-600'
                                                : 'text-slate-500',
                                        ].join(' ')}
                                    >
                                        {item.description}
                                    </span>
                                </button>
                            );
                        })}
                    </nav>
                </aside>

                <div className="space-y-5">
                    {activeSectionId === 'policy-auto-reward' && (
                        <SectionPanel
                            id="policy-auto-reward"
                            label="기본 자동 지급"
                            description="학생이 기본 활동을 완료했을 때 지급할 위스와 반복 인정 조건을 정합니다."
                            badge="핵심 자동 지급"
                        >
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                                <AmountField
                                    title={
                                        POINT_POLICY_FIELD_LABELS.attendanceDaily
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.attendanceDaily
                                    }
                                    value={policy.attendanceDaily}
                                    disabled={!canManage}
                                    suffix={formatWisAmount(
                                        policy.attendanceDaily,
                                    )}
                                    onChange={(value) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            attendanceDaily: value,
                                        }))
                                    }
                                />
                                <AmountField
                                    title={POINT_POLICY_FIELD_LABELS.quizSolve}
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.quizSolve
                                    }
                                    value={policy.quizSolve}
                                    disabled={!canManage}
                                    suffix={formatWisAmount(policy.quizSolve)}
                                    onChange={(value) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            quizSolve: value,
                                        }))
                                    }
                                />
                                <AmountField
                                    title={POINT_POLICY_FIELD_LABELS.lessonView}
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.lessonView
                                    }
                                    value={policy.lessonView}
                                    disabled={!canManage}
                                    suffix={formatWisAmount(policy.lessonView)}
                                    onChange={(value) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            lessonView: value,
                                        }))
                                    }
                                />
                            </div>

                            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.thinkCloudEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.thinkCloudEnabled
                                    }
                                    checked={policy.thinkCloudEnabled}
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary={`총 최대 ${formatWisAmount(policy.thinkCloudAmount * policy.thinkCloudMaxClaims)}`}
                                    footer="생각모아 참여 보상은 마지막 적립 시점 기준 rolling 24시간마다 1회만 인정되고, 학생당 누적 최대 횟수를 넘기면 더 이상 지급되지 않습니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            thinkCloudEnabled: checked,
                                        }))
                                    }
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.thinkCloudAmount
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.thinkCloudAmount
                                            }
                                            value={policy.thinkCloudAmount}
                                            disabled={
                                                !canManage ||
                                                !policy.autoRewardEnabled ||
                                                !policy.thinkCloudEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.thinkCloudAmount,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    thinkCloudAmount: value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.thinkCloudMaxClaims
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.thinkCloudMaxClaims
                                            }
                                            value={policy.thinkCloudMaxClaims}
                                            disabled={
                                                !canManage ||
                                                !policy.autoRewardEnabled ||
                                                !policy.thinkCloudEnabled
                                            }
                                            suffix={formatClaims(
                                                policy.thinkCloudMaxClaims,
                                            )}
                                            min={1}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    thinkCloudMaxClaims:
                                                        Math.max(
                                                            1,
                                                            Math.round(
                                                                value || 0,
                                                            ),
                                                        ),
                                                }))
                                            }
                                        />
                                    </div>
                                </PolicyRuleCard>

                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.mapTagEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.mapTagEnabled
                                    }
                                    checked={policy.mapTagEnabled}
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary={`총 최대 ${formatWisAmount(policy.mapTagAmount * policy.mapTagMaxClaims)}`}
                                    footer="지도 보상은 팝업 모달 안에서 태그를 직접 눌렀을 때만 적립됩니다. 단순 모달 열기만으로는 지급되지 않으며, 마지막 적립 후 24시간이 지나야 다시 인정됩니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            mapTagEnabled: checked,
                                        }))
                                    }
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.mapTagAmount
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.mapTagAmount
                                            }
                                            value={policy.mapTagAmount}
                                            disabled={
                                                !canManage ||
                                                !policy.autoRewardEnabled ||
                                                !policy.mapTagEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.mapTagAmount,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    mapTagAmount: value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.mapTagMaxClaims
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.mapTagMaxClaims
                                            }
                                            value={policy.mapTagMaxClaims}
                                            disabled={
                                                !canManage ||
                                                !policy.autoRewardEnabled ||
                                                !policy.mapTagEnabled
                                            }
                                            suffix={formatClaims(
                                                policy.mapTagMaxClaims,
                                            )}
                                            min={1}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    mapTagMaxClaims: Math.max(
                                                        1,
                                                        Math.round(value || 0),
                                                    ),
                                                }))
                                            }
                                        />
                                    </div>
                                </PolicyRuleCard>

                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.historyClassroomEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.historyClassroomEnabled
                                    }
                                    checked={policy.historyClassroomEnabled}
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary="24시간마다 1회"
                                    footer="역사교실 기본 참여 위스는 같은 학생 기준으로 마지막 적립 시점부터 24시간이 지나야 다시 지급됩니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            historyClassroomEnabled: checked,
                                        }))
                                    }
                                >
                                    <AmountField
                                        title={
                                            POINT_POLICY_FIELD_LABELS.historyClassroomAmount
                                        }
                                        description={
                                            POINT_POLICY_FIELD_HELPERS.historyClassroomAmount
                                        }
                                        value={policy.historyClassroomAmount}
                                        disabled={
                                            !canManage ||
                                            !policy.autoRewardEnabled ||
                                            !policy.historyClassroomEnabled
                                        }
                                        suffix={formatWisAmount(
                                            policy.historyClassroomAmount,
                                        )}
                                        onChange={(value) =>
                                            onPolicyChange((prev) => ({
                                                ...prev,
                                                historyClassroomAmount: value,
                                            }))
                                        }
                                    />
                                </PolicyRuleCard>
                            </div>
                        </SectionPanel>
                    )}

                    {activeSectionId === 'policy-bonus' && (
                        <SectionPanel
                            id="policy-bonus"
                            label="조건부 보너스"
                            description="기본 지급과 별도로 조건 달성 시 한 번 더 지급되는 보너스를 관리합니다."
                            badge="추가 조건 달성 보상"
                        >
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <AmountField
                                    title={
                                        POINT_POLICY_FIELD_LABELS.attendanceMonthlyBonus
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.attendanceMonthlyBonus
                                    }
                                    value={policy.attendanceMonthlyBonus}
                                    disabled={!canManage}
                                    suffix={formatWisAmount(
                                        policy.attendanceMonthlyBonus,
                                    )}
                                    onChange={(value) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            attendanceMonthlyBonus: value,
                                        }))
                                    }
                                />

                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.quizBonusEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.quizBonusEnabled
                                    }
                                    checked={policy.quizBonusEnabled}
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary={formatWisAmount(
                                        policy.quizBonusAmount,
                                    )}
                                    footer="문제 풀이 기본 위스와 별도로 기준 점수 이상일 때만 추가 지급됩니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            quizBonusEnabled: checked,
                                        }))
                                    }
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.quizBonusThreshold
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.quizBonusThreshold
                                            }
                                            value={policy.quizBonusThreshold}
                                            disabled={
                                                !canManage ||
                                                !policy.quizBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatScoreThreshold(
                                                policy.quizBonusThreshold,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    quizBonusThreshold: value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.quizBonusAmount
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.quizBonusAmount
                                            }
                                            value={policy.quizBonusAmount}
                                            disabled={
                                                !canManage ||
                                                !policy.quizBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.quizBonusAmount,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    quizBonusAmount: value,
                                                }))
                                            }
                                        />
                                    </div>
                                </PolicyRuleCard>

                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.historyClassroomBonusEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.historyClassroomBonusEnabled
                                    }
                                    checked={
                                        policy.historyClassroomBonusEnabled
                                    }
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary={formatWisAmount(
                                        policy.historyClassroomBonusAmount,
                                    )}
                                    footer="역사교실 기본 지급과 별도로 정답률 기준을 넘긴 시도에 성과 보너스를 지급합니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            historyClassroomBonusEnabled:
                                                checked,
                                        }))
                                    }
                                >
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.historyClassroomBonusThreshold
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.historyClassroomBonusThreshold
                                            }
                                            value={
                                                policy.historyClassroomBonusThreshold
                                            }
                                            disabled={
                                                !canManage ||
                                                !policy.historyClassroomBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatPercentThreshold(
                                                policy.historyClassroomBonusThreshold,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    historyClassroomBonusThreshold:
                                                        value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.historyClassroomBonusAmount
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.historyClassroomBonusAmount
                                            }
                                            value={
                                                policy.historyClassroomBonusAmount
                                            }
                                            disabled={
                                                !canManage ||
                                                !policy.historyClassroomBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.historyClassroomBonusAmount,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    historyClassroomBonusAmount:
                                                        value,
                                                }))
                                            }
                                        />
                                    </div>
                                </PolicyRuleCard>

                                <PolicyRuleCard
                                    title={
                                        POINT_POLICY_FIELD_LABELS.attendanceMilestoneBonusEnabled
                                    }
                                    description={
                                        POINT_POLICY_FIELD_HELPERS.attendanceMilestoneBonusEnabled
                                    }
                                    checked={
                                        policy.attendanceMilestoneBonusEnabled
                                    }
                                    disabled={
                                        !canManage || !policy.autoRewardEnabled
                                    }
                                    summary="50 / 100 / 200 / 300회"
                                    footer="누적 출석 50회, 100회, 200회, 300회를 정확히 달성한 시점에만 각 보너스가 학생당 1회씩 지급됩니다."
                                    onChange={(checked) =>
                                        onPolicyChange((prev) => ({
                                            ...prev,
                                            attendanceMilestoneBonusEnabled:
                                                checked,
                                        }))
                                    }
                                >
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.attendanceMilestone50
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.attendanceMilestone50
                                            }
                                            value={policy.attendanceMilestone50}
                                            disabled={
                                                !canManage ||
                                                !policy.attendanceMilestoneBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.attendanceMilestone50,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    attendanceMilestone50:
                                                        value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.attendanceMilestone100
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.attendanceMilestone100
                                            }
                                            value={
                                                policy.attendanceMilestone100
                                            }
                                            disabled={
                                                !canManage ||
                                                !policy.attendanceMilestoneBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.attendanceMilestone100,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    attendanceMilestone100:
                                                        value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.attendanceMilestone200
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.attendanceMilestone200
                                            }
                                            value={
                                                policy.attendanceMilestone200
                                            }
                                            disabled={
                                                !canManage ||
                                                !policy.attendanceMilestoneBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.attendanceMilestone200,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    attendanceMilestone200:
                                                        value,
                                                }))
                                            }
                                        />
                                        <AmountField
                                            title={
                                                POINT_POLICY_FIELD_LABELS.attendanceMilestone300
                                            }
                                            description={
                                                POINT_POLICY_FIELD_HELPERS.attendanceMilestone300
                                            }
                                            value={
                                                policy.attendanceMilestone300
                                            }
                                            disabled={
                                                !canManage ||
                                                !policy.attendanceMilestoneBonusEnabled ||
                                                !policy.autoRewardEnabled
                                            }
                                            suffix={formatWisAmount(
                                                policy.attendanceMilestone300,
                                            )}
                                            onChange={(value) =>
                                                onPolicyChange((prev) => ({
                                                    ...prev,
                                                    attendanceMilestone300:
                                                        value,
                                                }))
                                            }
                                        />
                                    </div>
                                </PolicyRuleCard>
                            </div>
                        </SectionPanel>
                    )}

                    {activeSectionId === 'policy-control' && (
                        <SectionPanel
                            id="policy-control"
                            label="운영 제어"
                            description="상단 공통 옵션에서 제어한 정책이 실제 운영에 어떤 의미인지 확인합니다."
                            badge="공통 옵션 영향"
                        >
                            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                                <div className="rounded-lg border border-slate-200 bg-white p-4">
                                    <div className="text-sm font-extrabold text-slate-900">
                                        {
                                            POINT_POLICY_FIELD_LABELS.manualAdjustEnabled
                                        }
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-slate-500">
                                        {
                                            POINT_POLICY_FIELD_HELPERS.manualAdjustEnabled
                                        }
                                    </div>
                                    <div className="mt-4 inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                                        현재{' '}
                                        {policy.manualAdjustEnabled
                                            ? '허용'
                                            : '차단'}
                                    </div>
                                </div>
                                <div className="rounded-lg border border-slate-200 bg-white p-4">
                                    <div className="text-sm font-extrabold text-slate-900">
                                        {
                                            POINT_POLICY_FIELD_LABELS.allowNegativeBalance
                                        }
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-slate-500">
                                        {
                                            POINT_POLICY_FIELD_HELPERS.allowNegativeBalance
                                        }
                                    </div>
                                    <div className="mt-4 inline-flex rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-700">
                                        현재{' '}
                                        {policy.allowNegativeBalance
                                            ? '허용'
                                            : '차단'}
                                    </div>
                                </div>
                            </div>
                        </SectionPanel>
                    )}
                </div>
            </div>
        </form>
    );
};

export default PointPolicyTab;
