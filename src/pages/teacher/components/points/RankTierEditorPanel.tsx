import React, { useMemo } from 'react';
import PointRankBadge from '../../../../components/common/PointRankBadge';
import { POINT_RANK_BADGE_STYLE_OPTIONS, POINT_RANK_FIELD_HELPERS, POINT_RANK_FIELD_LABELS } from '../../../../constants/pointLabels';
import { formatWisAmount } from '../../../../lib/pointFormatters';
import type { PointRankDisplay } from '../../../../lib/pointRanks';
import type { PointRankPolicy, PointRankPolicyTier, PointRankThemeId } from '../../../../types';

const inputClassName = 'w-full min-w-0 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm transition focus:border-blue-300 focus:outline-none focus:ring-4 focus:ring-blue-50';
const selectClassName = inputClassName;
const fieldCardClassName = 'block rounded-2xl border border-gray-200 bg-gray-50/80 p-4';
const tierSummaryChipClassName = 'inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 whitespace-nowrap';
const tierActionButtonClassName = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';

const clampNumber = (value: unknown, fallback = 0) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
};

interface RankTierEditorPanelProps {
    canManage: boolean;
    draftRankPolicy: PointRankPolicy;
    validationError: string;
    selectedTierCode: PointRankPolicyTier['code'] | null;
    enabledEmojiCount: number;
    hasUnsavedChanges: boolean;
    saveFeedbackMessage: string;
    saveFeedbackTone: 'success' | 'error' | 'warning' | null;
    onSave: () => void;
    onSelectTier: (tierCode: PointRankPolicyTier['code']) => void;
    onAddTier: () => void;
    onRemoveTier: (tierCode: PointRankPolicyTier['code']) => void;
    onPreviewCelebration: (tierCode: PointRankPolicyTier['code']) => void;
    onSetTierField: <K extends keyof PointRankPolicyTier>(tierCode: PointRankPolicyTier['code'], field: K, value: PointRankPolicyTier[K]) => void;
    onSetActiveThemeTierField: (tierCode: PointRankPolicyTier['code'], field: 'label' | 'shortLabel' | 'description', value: string) => void;
    onToggleTierEmoji: (tierCode: PointRankPolicyTier['code'], emojiId: string) => void;
    getTierPreview: (tier: PointRankPolicyTier, themeId?: PointRankThemeId) => PointRankDisplay | null;
}

const feedbackToneClassName: Record<'success' | 'error' | 'warning', string> = {
    success: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
    error: 'border border-red-200 bg-red-50 text-red-700',
    warning: 'border border-amber-200 bg-amber-50 text-amber-800',
};

const RankTierEditorPanel: React.FC<RankTierEditorPanelProps> = ({
    canManage,
    draftRankPolicy,
    validationError,
    selectedTierCode,
    enabledEmojiCount,
    hasUnsavedChanges,
    saveFeedbackMessage,
    saveFeedbackTone,
    onSave,
    onSelectTier,
    onAddTier,
    onRemoveTier,
    onPreviewCelebration,
    onSetTierField,
    onSetActiveThemeTierField,
    onToggleTierEmoji,
    getTierPreview,
}) => {
    const displayTiers = useMemo(
        () => [...draftRankPolicy.tiers]
            .map((tier, index) => ({ tier, index }))
            .sort((left, right) => {
                const thresholdDiff = Number(right.tier.minPoints || 0) - Number(left.tier.minPoints || 0);
                return thresholdDiff !== 0 ? thresholdDiff : left.index - right.index;
            })
            .map(({ tier }) => tier),
        [draftRankPolicy.tiers],
    );

    return (
        <section className="space-y-6">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-4 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h2 className="text-lg font-extrabold text-gray-900">등급 설정</h2>
                        <p className="mt-1 text-sm text-gray-500">화면은 높은 등급부터 보여 주고, 저장 시에는 기준 위스로 안전하게 정리합니다.</p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:min-w-[320px] lg:flex-col lg:items-end">
                        <button type="button" onClick={onSave} disabled={!canManage || Boolean(validationError)} className="inline-flex items-center justify-center whitespace-nowrap rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300">
                            등급 설정 저장
                        </button>
                        <div className={['rounded-xl border px-4 py-3 text-sm', hasUnsavedChanges ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-50 text-gray-600'].join(' ')}>
                            {hasUnsavedChanges ? '등급 설정 변경사항이 저장 대기 중입니다.' : '저장된 등급 설정과 같습니다.'}
                        </div>
                        {saveFeedbackMessage && saveFeedbackTone && <div className={`rounded-xl px-4 py-3 text-sm ${feedbackToneClassName[saveFeedbackTone]}`}>{saveFeedbackMessage}</div>}
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                    <div>
                        <h3 className="text-lg font-extrabold text-gray-900">등급 목록</h3>
                        <p className="mt-1 text-sm text-gray-500">높은 등급부터 보면서 이름, 기준 위스, 설명, 허용 이모지를 정리합니다.</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">총 {draftRankPolicy.tiers.length}개</span>
                            <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 whitespace-nowrap">활성 이모지 {enabledEmojiCount}개</span>
                        </div>
                    </div>
                    <button type="button" onClick={onAddTier} disabled={!canManage} className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60">
                        {POINT_RANK_FIELD_LABELS.addTier}
                    </button>
                </div>

                <div className="space-y-4 p-5 sm:p-6">
                    {validationError && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{validationError}</div>}
                    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">표시는 높은 등급부터 보이지만, 저장할 때는 기준 위스값으로 정렬됩니다.</div>

                    <div className="space-y-3">
                        {displayTiers.map((tier, tierIndex) => {
                            const tierPreview = getTierPreview(tier);
                            const isOpen = selectedTierCode === tier.code;
                            const selectedEmojiIds = new Set(tier.allowedEmojiIds || []);
                            const badgeStyleLabel = POINT_RANK_BADGE_STYLE_OPTIONS.find((option) => option.value === (tier.badgeStyleToken || 'stone'))?.label || String(tier.badgeStyleToken || 'stone');

                            return (
                                <article key={tier.code} className={['overflow-hidden rounded-2xl border transition', isOpen ? 'border-blue-200 bg-blue-50/40 ring-1 ring-blue-100 shadow-[0_18px_34px_-28px_rgba(37,99,235,0.48)]' : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'].join(' ')}>
                                    <button type="button" onClick={() => onSelectTier(tier.code)} aria-expanded={isOpen} aria-controls={`point-rank-tier-panel-${tier.code}`} className="flex w-full flex-col gap-4 px-5 py-5 text-left transition sm:px-6">
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                <PointRankBadge rank={tierPreview} size="sm" showTheme />
                                                {tierIndex === 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 whitespace-nowrap">최상위 등급</span>}
                                                {isOpen && <span className="rounded-full border border-blue-200 bg-blue-100 px-2.5 py-1 text-[11px] font-bold text-blue-700 whitespace-nowrap">선택됨</span>}
                                            </div>
                                            {!isOpen && <div className="inline-flex items-center gap-2 self-start rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-600 transition whitespace-nowrap"><span>상세 설정</span><i className="fas fa-chevron-down text-[10px]" aria-hidden="true"></i></div>}
                                        </div>

                                        <div className="min-w-0">
                                            <div className="max-w-full truncate text-base font-bold text-gray-900 sm:text-lg">{tierPreview?.label || `등급 ${tierIndex + 1}`}</div>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <span className={tierSummaryChipClassName}>기준<span className="ml-1 text-gray-900">{formatWisAmount(tier.minPoints)}</span></span>
                                                <span className={tierSummaryChipClassName}>이모지<span className="ml-1 text-gray-900">{tier.allowedEmojiIds?.length || 0}개</span></span>
                                                <span className={tierSummaryChipClassName}>배지<span className="ml-1 text-gray-900">{badgeStyleLabel}</span></span>
                                                {tierPreview?.shortLabel && <span className={tierSummaryChipClassName}>약칭<span className="ml-1 text-gray-900">{tierPreview.shortLabel}</span></span>}
                                            </div>
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div id={`point-rank-tier-panel-${tier.code}`} className="border-t border-blue-100 bg-white px-5 py-5 sm:px-6">
                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 whitespace-nowrap">상세 설정 + 허용 이모지</span>
                                                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600 whitespace-nowrap">활성 {enabledEmojiCount}개</span>
                                                </div>
                                                <div className="flex flex-wrap items-center justify-end gap-2.5">
                                                    <button type="button" onClick={() => onPreviewCelebration(tier.code)} className={`${tierActionButtonClassName} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}><i className="fas fa-sparkles text-[11px]" aria-hidden="true"></i>축하 미리보기</button>
                                                    <button type="button" onClick={() => onSelectTier(tier.code)} className={`${tierActionButtonClassName} border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-white`}><span>접기</span><i className="fas fa-chevron-up text-[10px]" aria-hidden="true"></i></button>
                                                    <button type="button" onClick={() => onRemoveTier(tier.code)} disabled={!canManage || draftRankPolicy.tiers.length <= 1} className={`${tierActionButtonClassName} border-rose-200 bg-white text-rose-600 hover:bg-rose-50`}>{POINT_RANK_FIELD_LABELS.deleteTier}</button>
                                                </div>
                                            </div>

                                            <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(272px,0.88fr)] xl:items-start">
                                                <div className="space-y-4">
                                                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                                        <label className={fieldCardClassName}>
                                                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierThreshold}</div>
                                                            <input type="number" min="0" value={tier.minPoints} onChange={(event) => onSetTierField(tier.code, 'minPoints', clampNumber(event.target.value, 0))} className={inputClassName} disabled={!canManage} />
                                                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierThreshold}</div>
                                                        </label>
                                                        <label className={fieldCardClassName}>
                                                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.badgeStyleToken}</div>
                                                            <select value={tier.badgeStyleToken || 'stone'} onChange={(event) => onSetTierField(tier.code, 'badgeStyleToken', String(event.target.value || 'stone') as PointRankPolicyTier['badgeStyleToken'])} className={selectClassName} disabled={!canManage}>
                                                                {POINT_RANK_BADGE_STYLE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                                            </select>
                                                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.badgeStyleToken}</div>
                                                        </label>
                                                        <label className={fieldCardClassName}>
                                                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierLabel}</div>
                                                            <input value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.label || ''} onChange={(event) => onSetActiveThemeTierField(tier.code, 'label', event.target.value)} placeholder={tierPreview?.label || '등급 이름'} className={inputClassName} disabled={!canManage} />
                                                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierLabel}</div>
                                                        </label>
                                                        <label className={fieldCardClassName}>
                                                            <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierShortLabel}</div>
                                                            <input value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.shortLabel || ''} onChange={(event) => onSetActiveThemeTierField(tier.code, 'shortLabel', event.target.value)} placeholder={tierPreview?.shortLabel || tierPreview?.label || '약칭'} className={inputClassName} disabled={!canManage} />
                                                            <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierShortLabel}</div>
                                                        </label>
                                                    </div>

                                                    <label className={fieldCardClassName}>
                                                        <div className="mb-2 text-sm font-bold text-gray-700">{POINT_RANK_FIELD_LABELS.tierDescription}</div>
                                                        <textarea rows={3} value={draftRankPolicy.themes?.[draftRankPolicy.activeThemeId]?.tiers?.[tier.code]?.description || ''} onChange={(event) => onSetActiveThemeTierField(tier.code, 'description', event.target.value)} placeholder={tierPreview?.description || '등급 설명을 입력하세요.'} className={inputClassName} disabled={!canManage} />
                                                        <div className="mt-2 text-xs leading-5 text-gray-500">{POINT_RANK_FIELD_HELPERS.tierDescription}</div>
                                                    </label>
                                                </div>

                                                <aside className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 sm:p-5">
                                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                                        <div>
                                                            <h4 className="text-sm font-extrabold text-gray-900">허용 이모지</h4>
                                                            <p className="mt-1 text-xs text-gray-500">선택 {tier.allowedEmojiIds?.length || 0}개</p>
                                                        </div>
                                                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-bold text-gray-500 whitespace-nowrap">비활성 자동 잠금</span>
                                                    </div>
                                                    {draftRankPolicy.emojiRegistry.length === 0 ? (
                                                        <div className="mt-4 flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center text-sm leading-6 text-gray-500">등록된 이모지가 없습니다.</div>
                                                    ) : (
                                                        <div className="mt-4 grid grid-cols-4 justify-items-center gap-x-4 gap-y-4 px-2">
                                                            {draftRankPolicy.emojiRegistry.map((entry) => {
                                                                const checked = selectedEmojiIds.has(entry.id);
                                                                const disabled = !canManage || entry.enabled === false;
                                                                return (
                                                                    <button
                                                                        key={`${tier.code}-${entry.id}`}
                                                                        type="button"
                                                                        onClick={() => onToggleTierEmoji(tier.code, entry.id)}
                                                                        disabled={disabled}
                                                                        aria-pressed={checked}
                                                                        title={entry.label}
                                                                        className={[
                                                                            'relative flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border text-[1.02rem] leading-none transition',
                                                                            checked ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
                                                                            entry.enabled === false ? 'border-gray-200 bg-gray-100 text-gray-300' : '',
                                                                            disabled ? 'cursor-not-allowed' : '',
                                                                        ].filter(Boolean).join(' ')}
                                                                    >
                                                                        <span>{entry.emoji}</span>
                                                                        <span className={['absolute right-0.5 top-0.5 inline-flex h-3 w-3 items-center justify-center rounded-full border text-[7px]', checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-transparent'].join(' ')} aria-hidden="true"><i className="fas fa-check" aria-hidden="true"></i></span>
                                                                        <span className={['absolute bottom-0.5 left-0.5 inline-flex h-2 w-2 rounded-full', entry.enabled === false ? 'bg-gray-300' : 'bg-emerald-400'].join(' ')} aria-hidden="true"></span>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    <div className="mt-4 rounded-xl border border-gray-200 bg-white px-3 py-3 text-[11px] leading-5 text-gray-500">첫 등급 기본 이모지 포함, 중복 선택은 자동 정리됩니다.</div>
                                                </aside>
                                            </div>
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>
                </div>
            </div>
        </section>
    );
};

export default RankTierEditorPanel;
