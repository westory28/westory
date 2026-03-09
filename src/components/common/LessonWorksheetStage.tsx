import React, { useMemo, useRef, useState } from 'react';
import {
    clampRatio,
    type LessonWorksheetBlank,
    type LessonWorksheetPageImage,
    type LessonWorksheetTextRegion,
} from '../../lib/lessonWorksheet';

interface LessonWorksheetStageProps {
    pageImages: LessonWorksheetPageImage[];
    blanks: LessonWorksheetBlank[];
    mode: 'teacher' | 'student';
    textRegions?: LessonWorksheetTextRegion[];
    selectedBlankId?: string | null;
    studentAnswers?: Record<string, { value?: string; status?: '' | 'correct' | 'wrong' }>;
    onSelectBlank?: (blankId: string) => void;
    onCreateBlankFromRegion?: (region: LessonWorksheetTextRegion) => void;
    onCreateBlankFromRect?: (page: number, rect: {
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
    }) => void;
    onStudentAnswerChange?: (blankId: string, value: string) => void;
}

interface DraftRect {
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

const MIN_DRAG_SIZE = 0.01;

const LessonWorksheetStage: React.FC<LessonWorksheetStageProps> = ({
    pageImages,
    blanks,
    mode,
    textRegions = [],
    selectedBlankId,
    studentAnswers = {},
    onSelectBlank,
    onCreateBlankFromRegion,
    onCreateBlankFromRect,
    onStudentAnswerChange,
}) => {
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [draftRect, setDraftRect] = useState<DraftRect | null>(null);

    const regionsByPage = useMemo(() => {
        const grouped = new Map<number, LessonWorksheetTextRegion[]>();
        textRegions.forEach((region) => {
            const current = grouped.get(region.page) || [];
            current.push(region);
            grouped.set(region.page, current);
        });
        return grouped;
    }, [textRegions]);

    const blanksByPage = useMemo(() => {
        const grouped = new Map<number, LessonWorksheetBlank[]>();
        blanks.forEach((blank) => {
            const current = grouped.get(blank.page) || [];
            current.push(blank);
            grouped.set(blank.page, current);
        });
        return grouped;
    }, [blanks]);

    const resolveRatioPoint = (page: number, clientX: number, clientY: number) => {
        const host = pageRefs.current[page];
        if (!host) return null;
        const rect = host.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;

        return {
            x: clampRatio((clientX - rect.left) / rect.width),
            y: clampRatio((clientY - rect.top) / rect.height),
        };
    };

    const handlePointerDown = (page: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (mode !== 'teacher' || event.button !== 0) return;
        if ((event.target as HTMLElement).closest('[data-region-button], [data-blank-box]')) return;

        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        if (!point) return;

        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        setDraftRect({
            page,
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y,
        });
    };

    const handlePointerMove = (page: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (!draftRect || draftRect.page !== page) return;
        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        if (!point) return;
        setDraftRect((prev) => prev ? { ...prev, currentX: point.x, currentY: point.y } : null);
    };

    const finishDraftRect = () => {
        if (!draftRect || !onCreateBlankFromRect) {
            setDraftRect(null);
            return;
        }

        const leftRatio = Math.min(draftRect.startX, draftRect.currentX);
        const topRatio = Math.min(draftRect.startY, draftRect.currentY);
        const widthRatio = Math.abs(draftRect.currentX - draftRect.startX);
        const heightRatio = Math.abs(draftRect.currentY - draftRect.startY);

        if (widthRatio >= MIN_DRAG_SIZE && heightRatio >= MIN_DRAG_SIZE) {
            onCreateBlankFromRect(draftRect.page, { leftRatio, topRatio, widthRatio, heightRatio });
        }

        setDraftRect(null);
    };

    return (
        <div className="space-y-6">
            {pageImages.map((pageImage) => {
                const pageBlanks = blanksByPage.get(pageImage.page) || [];
                const pageRegions = regionsByPage.get(pageImage.page) || [];
                const liveDraft = draftRect && draftRect.page === pageImage.page
                    ? {
                        leftRatio: Math.min(draftRect.startX, draftRect.currentX),
                        topRatio: Math.min(draftRect.startY, draftRect.currentY),
                        widthRatio: Math.abs(draftRect.currentX - draftRect.startX),
                        heightRatio: Math.abs(draftRect.currentY - draftRect.startY),
                    }
                    : null;

                return (
                    <section key={pageImage.page} className="rounded-3xl border border-gray-200 bg-white p-3 md:p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Page {pageImage.page}
                            </div>
                            {mode === 'teacher' && (
                                <div className="text-xs text-gray-500">
                                    OCR 박스를 클릭하거나 페이지를 드래그해 빈칸을 추가하세요.
                                </div>
                            )}
                        </div>

                        <div
                            ref={(node) => {
                                pageRefs.current[pageImage.page] = node;
                            }}
                            className={`relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 ${mode === 'teacher' ? 'touch-none' : ''}`}
                            onPointerDown={(event) => handlePointerDown(pageImage.page, event)}
                            onPointerMove={(event) => handlePointerMove(pageImage.page, event)}
                            onPointerUp={finishDraftRect}
                            onPointerCancel={() => setDraftRect(null)}
                        >
                            <img
                                src={pageImage.imageUrl}
                                alt={`학습지 ${pageImage.page}페이지`}
                                className="block h-auto w-full"
                            />

                            {mode === 'teacher' && pageRegions.map((region, index) => (
                                <button
                                    key={`${pageImage.page}-region-${index}-${region.left}-${region.top}`}
                                    type="button"
                                    data-region-button="true"
                                    onClick={() => onCreateBlankFromRegion?.(region)}
                                    className="absolute border border-sky-300 bg-sky-200/20 transition hover:bg-sky-300/30"
                                    style={{
                                        left: `${(region.left / pageImage.width) * 100}%`,
                                        top: `${(region.top / pageImage.height) * 100}%`,
                                        width: `${(region.width / pageImage.width) * 100}%`,
                                        height: `${(region.height / pageImage.height) * 100}%`,
                                    }}
                                    title={region.label}
                                />
                            ))}

                            {pageBlanks.map((blank) => {
                                const studentAnswer = studentAnswers[blank.id];
                                const status = studentAnswer?.status || '';

                                return (
                                    <div
                                        key={blank.id}
                                        data-blank-box="true"
                                        onClick={() => onSelectBlank?.(blank.id)}
                                        className={`absolute rounded-md border-2 bg-white/96 shadow-sm ${
                                            mode === 'teacher'
                                                ? selectedBlankId === blank.id
                                                    ? 'border-blue-600 ring-2 ring-blue-200'
                                                    : 'border-slate-500'
                                                : status === 'correct'
                                                    ? 'border-emerald-500 bg-emerald-50/95'
                                                    : status === 'wrong'
                                                        ? 'border-rose-500 bg-rose-50/95'
                                                        : 'border-slate-400'
                                        }`}
                                        style={{
                                            left: `${blank.leftRatio * 100}%`,
                                            top: `${blank.topRatio * 100}%`,
                                            width: `${blank.widthRatio * 100}%`,
                                            height: `${blank.heightRatio * 100}%`,
                                        }}
                                    >
                                        {mode === 'teacher' ? (
                                            <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-bold leading-tight text-slate-700 md:text-xs">
                                                {blank.answer || '정답 입력'}
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                value={studentAnswer?.value || ''}
                                                data-blank-id={blank.id}
                                                data-answer={blank.answer}
                                                className="worksheet-blank-input h-full w-full bg-transparent px-1 text-center font-bold text-blue-700 outline-none"
                                                placeholder={blank.prompt || '빈칸'}
                                                onChange={(event) => onStudentAnswerChange?.(blank.id, event.target.value)}
                                                style={{ fontSize: 'clamp(11px, 1.6vw, 18px)' }}
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {mode === 'teacher' && liveDraft && (
                                <div
                                    className="pointer-events-none absolute border-2 border-dashed border-blue-500 bg-blue-300/20"
                                    style={{
                                        left: `${liveDraft.leftRatio * 100}%`,
                                        top: `${liveDraft.topRatio * 100}%`,
                                        width: `${liveDraft.widthRatio * 100}%`,
                                        height: `${liveDraft.heightRatio * 100}%`,
                                    }}
                                />
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
};

export default LessonWorksheetStage;
