import React from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import { POINT_POLICY_FIELD_HELPERS, POINT_POLICY_FIELD_LABELS } from '../../../../constants/pointLabels';
import {
    getPointRankAllowedEmojiIds,
    getPointRankDisplay,
    getPointRankTierMeta,
    resolvePointRankPolicy,
} from '../../../../lib/pointRanks';
import { getProfileEmojiEntryById, PROFILE_EMOJI_REGISTRY } from '../../../../lib/profileEmojis';
import type { PointPolicy, PointRankPolicy, PointRankTierCode } from '../../../../types';

interface PointPolicyTabProps {
    policy: PointPolicy;
    canManage: boolean;
    onPolicyChange: (updater: (prev: PointPolicy) => PointPolicy) => void;
    onSubmit: (event: React.FormEvent) => void;
}

const inputClassName = 'w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm';

const PointPolicyTab: React.FC<PointPolicyTabProps> = ({ policy, canManage, onPolicyChange, onSubmit }) => {
    const rankPolicy = resolvePointRankPolicy(policy.rankPolicy);

    const updateRankPolicy = (updater: (prev: PointRankPolicy) => PointRankPolicy) => {
        onPolicyChange((prev) => ({
            ...prev,
            rankPolicy: updater(resolvePointRankPolicy(prev.rankPolicy)),
        }));
    };

    const toggleTierEmoji = (tierCode: PointRankTierCode, emojiId: string) => {
        updateRankPolicy((prev) => {
            const currentTier = prev.emojiPolicy.tiers[tierCode] || { allowedEmojiIds: [] };
            const nextAllowedEmojiIds = currentTier.allowedEmojiIds.includes(emojiId)
                ? currentTier.allowedEmojiIds.filter((item) => item !== emojiId)
                : [...currentTier.allowedEmojiIds, emojiId];

            return {
                ...prev,
                emojiPolicy: {
                    ...prev.emojiPolicy,
                    tiers: {
                        ...prev.emojiPolicy.tiers,
                        [tierCode]: {
                            allowedEmojiIds: nextAllowedEmojiIds,
                        },
                    },
                },
            };
        });
    };

    return (
        <form onSubmit={onSubmit} className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">포인트 운영 정책</h2>
                    <p className="mt-1 text-sm text-gray-500">이번 학기 자동 적립, 추가 보상, 교사 조정 기준을 한 화면에서 관리합니다.</p>
                </div>
                <div className="flex flex-col items-start gap-3 md:items-end">
                    <button type="submit" disabled={!canManage} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-blue-300">운영 정책 저장</button>
                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">저장 즉시 현재 학기 포인트 운영에 반영됩니다.</div>
                </div>
            </div>

            <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <div className="mb-4">
                    <h3 className="font-bold text-gray-900">자동 적립 기준</h3>
                    <p className="mt-1 text-sm text-gray-500">학생 활동이 완료되면 자동으로 지급되는 기본 포인트입니다.</p>
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
                    <h3 className="font-bold text-gray-900">추가 보상 기준</h3>
                    <p className="mt-1 text-sm text-gray-500">꾸준히 참여한 학생에게 한 단계 더 보상할 수 있는 운영 항목입니다.</p>
                </div>
                <label className="block max-w-sm">
                    <div className="mb-2 text-sm font-bold text-gray-700">{POINT_POLICY_FIELD_LABELS.attendanceMonthlyBonus}</div>
                    <input type="number" min="0" value={policy.attendanceMonthlyBonus} onChange={(event) => onPolicyChange((prev) => ({ ...prev, attendanceMonthlyBonus: Number(event.target.value || 0) }))} className={inputClassName} disabled={!canManage} />
                    <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_POLICY_FIELD_HELPERS.attendanceMonthlyBonus}</div>
                </label>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="mb-4">
                    <h3 className="font-bold text-gray-900">운영 제어 설정</h3>
                    <p className="mt-1 text-sm text-gray-500">교사 조정 기능과 차감 허용 범위를 운영 기준에 맞게 설정합니다.</p>
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

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="font-bold text-gray-900">등급 성장 설정</h3>
                        <p className="mt-1 text-sm text-gray-500">등급은 누적 획득 포인트를 기준으로 계산되며, 구매·차감·반려로는 내려가지 않습니다.</p>
                    </div>
                    <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                        <input
                            type="checkbox"
                            checked={rankPolicy.enabled}
                            onChange={(event) => updateRankPolicy((prev) => ({ ...prev, enabled: event.target.checked }))}
                            disabled={!canManage}
                            className="h-4 w-4"
                        />
                        등급제 사용
                    </label>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <label>
                        <div className="mb-2 text-sm font-bold text-gray-700">등급 테마</div>
                        <select
                            value={rankPolicy.themeId}
                            onChange={(event) => updateRankPolicy((prev) => ({ ...prev, themeId: event.target.value === 'world_nobility' ? 'world_nobility' : 'korean_golpum' }))}
                            className={inputClassName}
                            disabled={!canManage}
                        >
                            <option value="korean_golpum">한국사 골품제</option>
                            <option value="world_nobility">세계사 작위</option>
                        </select>
                        <div className="mt-2 text-xs leading-5 text-gray-500">표시 이름만 바뀌고, 내부 tier code와 누적 기준은 유지됩니다.</div>
                    </label>

                    <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm text-blue-800">
                        등급 누적치는 자동 적립과 양수 교사 지급만 포함합니다. 음수 조정, 구매 요청, 반려, 취소, 잔액 감소는 등급 성장을 깎지 않습니다.
                    </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    {rankPolicy.tiers.map((tier) => {
                        const tierMeta = getPointRankTierMeta(rankPolicy.themeId, tier.code);
                        const previewRank = getPointRankDisplay({
                            rankPolicy,
                            wallet: {
                                earnedTotal: tier.minPoints,
                                rankEarnedTotal: tier.minPoints,
                            },
                        });

                        return (
                            <div key={tier.code} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <PointRankBadge rank={previewRank} size="sm" />
                                        <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{tier.code}</span>
                                    </div>
                                    <div className="text-xs text-gray-500">{tierMeta.description}</div>
                                </div>
                                <label className="mt-4 block">
                                    <div className="mb-2 text-sm font-bold text-gray-700">승급 기준 누적 포인트</div>
                                    <input
                                        type="number"
                                        min="0"
                                        value={tier.minPoints}
                                        onChange={(event) => updateRankPolicy((prev) => ({
                                            ...prev,
                                            tiers: prev.tiers.map((item) => (
                                                item.code === tier.code
                                                    ? { ...item, minPoints: Math.max(0, Number(event.target.value || 0)) }
                                                    : item
                                            )),
                                        }))}
                                        className={inputClassName}
                                        disabled={!canManage}
                                    />
                                </label>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 md:flex-row md:items-start md:justify-between">
                    <div>
                        <h3 className="font-bold text-gray-900">등급별 프로필 이모지 해금</h3>
                        <p className="mt-1 text-sm text-gray-500">아래에서 체크한 이모지는 해당 등급부터 열립니다. 상위 등급 학생은 낮은 등급 이모지도 계속 선택할 수 있습니다.</p>
                    </div>
                    <label className="flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                        <input
                            type="checkbox"
                            checked={rankPolicy.emojiPolicy.enabled}
                            onChange={(event) => updateRankPolicy((prev) => ({
                                ...prev,
                                emojiPolicy: {
                                    ...prev.emojiPolicy,
                                    enabled: event.target.checked,
                                },
                            }))}
                            disabled={!canManage}
                            className="h-4 w-4"
                        />
                        이모지 잠금 사용
                    </label>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <label>
                        <div className="mb-2 text-sm font-bold text-gray-700">기본 아이콘</div>
                        <select
                            value={rankPolicy.emojiPolicy.defaultEmojiId}
                            onChange={(event) => updateRankPolicy((prev) => ({
                                ...prev,
                                emojiPolicy: {
                                    ...prev.emojiPolicy,
                                    defaultEmojiId: event.target.value,
                                },
                            }))}
                            className={inputClassName}
                            disabled={!canManage}
                        >
                            {PROFILE_EMOJI_REGISTRY.map((entry) => (
                                <option key={entry.id} value={entry.id}>{`${entry.value} ${entry.label}`}</option>
                            ))}
                        </select>
                        <div className="mt-2 text-xs leading-5 text-gray-500">저장된 아이콘이 없거나 정책에서 비어 있을 때 기본으로 보여줄 아이콘입니다.</div>
                    </label>

                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600">
                        등급별 허용 개수는 각 카드의 체크 수와 누적 해금 수로 자동 계산됩니다. 별도 숫자를 따로 입력하지 않아도 됩니다.
                    </div>
                </div>

                <div className="mt-6 space-y-4">
                    {rankPolicy.tiers.map((tier) => {
                        const tierMeta = getPointRankTierMeta(rankPolicy.themeId, tier.code);
                        const currentTierEmojiIds = rankPolicy.emojiPolicy.tiers[tier.code]?.allowedEmojiIds || [];
                        const cumulativeEmojiCount = getPointRankAllowedEmojiIds(rankPolicy, tier.code).length;

                        return (
                            <div key={`emoji-${tier.code}`} className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <PointRankBadge
                                            rank={getPointRankDisplay({
                                                rankPolicy,
                                                wallet: {
                                                    earnedTotal: tier.minPoints,
                                                    rankEarnedTotal: tier.minPoints,
                                                },
                                            })}
                                            size="sm"
                                        />
                                        <span className="text-sm font-bold text-gray-800">{tierMeta.label} 해금 세트</span>
                                    </div>
                                    <div className="text-xs text-gray-500">{`이번 등급 해금 ${currentTierEmojiIds.length}개 · 누적 선택 가능 ${cumulativeEmojiCount}개`}</div>
                                </div>

                                <div className="mt-4 grid grid-cols-4 gap-2 md:grid-cols-6 xl:grid-cols-8">
                                    {PROFILE_EMOJI_REGISTRY.map((entry) => {
                                        const checked = currentTierEmojiIds.includes(entry.id);
                                        return (
                                            <button
                                                key={`${tier.code}-${entry.id}`}
                                                type="button"
                                                onClick={() => toggleTierEmoji(tier.code, entry.id)}
                                                disabled={!canManage}
                                                className={`rounded-xl border px-2 py-3 text-center transition ${
                                                    checked
                                                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                                } disabled:cursor-not-allowed disabled:opacity-60`}
                                            >
                                                <div className="text-2xl leading-none">{entry.value}</div>
                                                <div className="mt-2 text-[11px] font-bold">{entry.label}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </form>
    );
};

export default PointPolicyTab;
