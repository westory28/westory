import React, { useEffect, useId, useRef, useState } from 'react';
import type { PointRankDisplay } from '../../lib/pointRanks';
import type { PointRankEmojiRegistryEntry } from '../../types';
import PointRankBadge from './PointRankBadge';

interface StudentRankPromotionPopupProps {
    open: boolean;
    rank: PointRankDisplay;
    effectLevel: 'subtle' | 'standard';
    previewEmojiEntries: PointRankEmojiRegistryEntry[];
    onClose: () => void;
}

const StudentRankPromotionPopup: React.FC<StudentRankPromotionPopupProps> = ({
    open,
    rank,
    effectLevel,
    previewEmojiEntries,
    onClose,
}) => {
    const [entered, setEntered] = useState(false);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        if (!open) {
            setEntered(false);
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            setEntered(true);
            closeButtonRef.current?.focus();
        });

        return () => window.cancelAnimationFrame(frame);
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [open]);

    useEffect(() => {
        if (!open) return undefined;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    const previewLimit = effectLevel === 'subtle' ? 3 : 5;
    const visiblePreviewEmojis = previewEmojiEntries.slice(0, previewLimit);
    const hasPreviewEmojis = visiblePreviewEmojis.length > 0;

    return (
        <div className="fixed inset-0 z-[220] flex items-center justify-center px-4 py-6 sm:px-6">
            <button
                type="button"
                aria-label="축하 팝업 닫기"
                onClick={onClose}
                className={[
                    'absolute inset-0 h-full w-full border-0 bg-slate-950/65 transition-opacity duration-300 motion-reduce:transition-none',
                    entered ? 'opacity-100' : 'opacity-0',
                ].join(' ')}
            />

            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                className={[
                    'relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/60 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)] transition-all duration-300 motion-reduce:transition-none',
                    effectLevel === 'subtle' ? 'sm:max-w-[30rem]' : 'sm:max-w-[34rem]',
                    entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.98] opacity-0',
                ].join(' ')}
            >
                <div
                    className={[
                        'absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-sky-50',
                        effectLevel === 'subtle' ? 'opacity-90' : 'opacity-100',
                    ].join(' ')}
                />

                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className={[
                        'absolute -right-8 -top-10 h-32 w-32 rounded-full bg-amber-300/20 blur-3xl',
                        effectLevel === 'subtle' ? 'opacity-70' : 'opacity-100',
                    ].join(' ')} />
                    <div className={[
                        'absolute -left-10 bottom-0 h-36 w-36 rounded-full bg-sky-300/15 blur-3xl',
                        effectLevel === 'subtle' ? 'opacity-50' : 'opacity-90',
                    ].join(' ')} />
                </div>

                <div className="relative p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.42em] text-amber-700/80">
                                Rank Up
                            </p>
                            <h2 id={titleId} className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-[2rem]">
                                등급이 상승했어요
                            </h2>
                            <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">
                                한 단계 더 올라갔어요. 새로 열린 이모지를 먼저 보여드릴게요.
                            </p>
                        </div>

                        <button
                            type="button"
                            ref={closeButtonRef}
                            onClick={onClose}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-500 transition hover:border-amber-200 hover:text-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-300"
                            aria-label="닫기"
                        >
                            <i className="fas fa-times text-sm" />
                        </button>
                    </div>

                    <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className={[
                            'relative flex h-24 w-24 shrink-0 items-center justify-center rounded-[1.75rem] border border-white/80 bg-white/80 shadow-inner',
                            effectLevel === 'subtle' ? 'shadow-[0_10px_24px_rgba(148,163,184,0.16)]' : 'shadow-[0_18px_32px_rgba(245,158,11,0.18)]',
                        ].join(' ')}>
                            <div className={[
                                'absolute inset-3 rounded-[1.2rem] bg-gradient-to-br from-amber-200/70 via-white to-sky-200/70',
                                effectLevel === 'standard' ? 'animate-pulse motion-reduce:animate-none' : '',
                            ].join(' ')} />
                            <div className="relative text-4xl">
                                🎉
                            </div>
                        </div>

                        <div className="min-w-0 flex-1">
                            <PointRankBadge rank={rank} size="md" showTheme />
                            <p className="mt-3 text-sm leading-6 text-slate-700">
                                {rank.description}
                            </p>
                            <p className="mt-2 text-xs font-medium text-slate-500">
                                현재 누적 위스 {rank.metricValue.toLocaleString('ko-KR')} ₩s 기준으로 도달한 등급이에요.
                            </p>
                        </div>
                    </div>

                    <div className="mt-6">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-sm font-extrabold text-slate-900">
                                새로 해금된 이모지
                            </h3>
                            <span className="text-xs font-medium text-slate-500">
                                {effectLevel === 'subtle' ? '미리보기 3개' : '미리보기 5개'}
                            </span>
                        </div>

                        {hasPreviewEmojis ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                                {visiblePreviewEmojis.map((entry) => (
                                    <div
                                        key={entry.id}
                                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-2 text-sm shadow-sm"
                                    >
                                        <span className="text-lg leading-none">{entry.emoji}</span>
                                        <span className="whitespace-nowrap font-semibold text-slate-700">{entry.label}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-3 text-sm text-slate-500">
                                이번 단계에서 새로 열린 이모지가 없어요.
                            </p>
                        )}
                    </div>

                    <div className="mt-6 flex justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-black text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        >
                            확인
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default StudentRankPromotionPopup;
