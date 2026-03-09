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
    onCreateBlankAtPoint?: (page: number, point: { x: number; y: number }) => void;
    onCreateBlankFromSelection?: (
        page: number,
        rect: {
            leftRatio: number;
            topRatio: number;
            widthRatio: number;
            heightRatio: number;
        },
        matchedRegions: LessonWorksheetTextRegion[],
    ) => void;
    onStudentAnswerChange?: (blankId: string, value: string) => void;
    pendingBlank?: LessonWorksheetBlank | null;
}

interface DraftRect {
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

const MIN_DRAG_SIZE = 0.008;
const MIN_REGION_INTERSECTION_RATIO = 0.28;

const toPercent = (value: number) => `${value * 100}%`;

const getIntersectionArea = (
    leftA: number,
    topA: number,
    rightA: number,
    bottomA: number,
    leftB: number,
    topB: number,
    rightB: number,
    bottomB: number,
) => {
    const width = Math.max(0, Math.min(rightA, rightB) - Math.max(leftA, leftB));
    const height = Math.max(0, Math.min(bottomA, bottomB) - Math.max(topA, topB));
    return width * height;
};

const LessonWorksheetStage: React.FC<LessonWorksheetStageProps> = ({
    pageImages,
    blanks,
    mode,
    textRegions = [],
    selectedBlankId,
    studentAnswers = {},
    onSelectBlank,
    onCreateBlankAtPoint,
    onCreateBlankFromSelection,
    onStudentAnswerChange,
    pendingBlank = null,
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
        if ((event.target as HTMLElement).closest('[data-blank-box]')) return;

        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        if (!point) return;

        event.currentTarget.setPointerCapture(event.pointerId);
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

        setDraftRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : null));
    };

    const handlePointerUp = (pageImage: LessonWorksheetPageImage) => {
        if (!draftRect || draftRect.page !== pageImage.page) return;

        const leftRatio = Math.min(draftRect.startX, draftRect.currentX);
        const topRatio = Math.min(draftRect.startY, draftRect.currentY);
        const widthRatio = Math.abs(draftRect.currentX - draftRect.startX);
        const heightRatio = Math.abs(draftRect.currentY - draftRect.startY);

        if (widthRatio < MIN_DRAG_SIZE || heightRatio < MIN_DRAG_SIZE) {
            onCreateBlankAtPoint?.(pageImage.page, { x: draftRect.startX, y: draftRect.startY });
            setDraftRect(null);
            return;
        }

        const selection = {
            left: leftRatio * pageImage.width,
            top: topRatio * pageImage.height,
            right: (leftRatio + widthRatio) * pageImage.width,
            bottom: (topRatio + heightRatio) * pageImage.height,
        };

        const matchedRegions = (regionsByPage.get(pageImage.page) || []).filter((region) => {
            const regionRight = region.left + region.width;
            const regionBottom = region.top + region.height;
            const intersectionArea = getIntersectionArea(
                selection.left,
                selection.top,
                selection.right,
                selection.bottom,
                region.left,
                region.top,
                regionRight,
                regionBottom,
            );
            const regionArea = Math.max(1, region.width * region.height);
            return (intersectionArea / regionArea) >= MIN_REGION_INTERSECTION_RATIO;
        });

        onCreateBlankFromSelection?.(pageImage.page, { leftRatio, topRatio, widthRatio, heightRatio }, matchedRegions);
        setDraftRect(null);
    };

    return (
        <div className="space-y-6">
            {pageImages.map((pageImage) => {
                const pageBlanks = blanksByPage.get(pageImage.page) || [];
                const pagePendingBlank = pendingBlank?.page === pageImage.page ? pendingBlank : null;
                const liveDraft = draftRect && draftRect.page === pageImage.page
                    ? {
                        leftRatio: Math.min(draftRect.startX, draftRect.currentX),
                        topRatio: Math.min(draftRect.startY, draftRect.currentY),
                        widthRatio: Math.abs(draftRect.currentX - draftRect.startX),
                        heightRatio: Math.abs(draftRect.currentY - draftRect.startY),
                    }
                    : null;

                return (
                    <section key={pageImage.page} className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm md:p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Page {pageImage.page}
                            </div>
                            {mode === 'teacher' && (
                                <div className="text-xs text-gray-500">
                                    페이지에서 원하는 글자를 드래그하면 해당 부분이 바로 가려지고 OCR 글자가 정답으로 들어갑니다.
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
                            onPointerUp={() => handlePointerUp(pageImage)}
                            onPointerCancel={() => setDraftRect(null)}
                        >
                            <img
                                src={pageImage.imageUrl}
                                alt={`학습지 ${pageImage.page}페이지`}
                                className="block h-auto w-full"
                            />

                            {pageBlanks.map((blank) => {
                                const studentAnswer = studentAnswers[blank.id];
                                const status = studentAnswer?.status || '';

                                return (
                                    <div
                                        key={blank.id}
                                        data-blank-box="true"
                                        onClick={() => onSelectBlank?.(blank.id)}
                                        className={`absolute overflow-hidden rounded-md border shadow-sm ${
                                            mode === 'teacher'
                                                ? selectedBlankId === blank.id
                                                    ? 'border-blue-600 bg-white ring-2 ring-blue-200'
                                                    : 'border-slate-300 bg-white'
                                                : status === 'correct'
                                                    ? 'border-emerald-500 bg-emerald-50/98'
                                                    : status === 'wrong'
                                                        ? 'border-rose-500 bg-rose-50/98'
                                                        : 'border-slate-300 bg-white/98'
                                        }`}
                                        style={{
                                            left: toPercent(blank.leftRatio),
                                            top: toPercent(blank.topRatio),
                                            width: toPercent(blank.widthRatio),
                                            height: toPercent(blank.heightRatio),
                                        }}
                                    >
                                        {mode === 'teacher' ? (
                                            <div className="flex h-full w-full items-center justify-center px-1">
                                                <span className="rounded bg-slate-100/95 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-500 md:text-[11px]">
                                                    빈칸
                                                </span>
                                            </div>
                                        ) : (
                                            <input
                                                type="text"
                                                value={studentAnswer?.value || ''}
                                                data-blank-id={blank.id}
                                                data-answer={blank.answer}
                                                className={`worksheet-blank-input h-full w-full border-0 px-2 text-center font-bold outline-none ${
                                                    status === 'correct'
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : status === 'wrong'
                                                            ? 'bg-rose-50 text-rose-700'
                                                            : 'bg-white text-blue-700'
                                                }`}
                                                placeholder={blank.prompt || '빈칸'}
                                                onChange={(event) => onStudentAnswerChange?.(blank.id, event.target.value)}
                                                style={{ fontSize: 'clamp(11px, 1.6vw, 18px)' }}
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {mode === 'teacher' && pagePendingBlank && (
                                <div
                                    className="pointer-events-none absolute rounded-md border border-amber-300 bg-white shadow-sm ring-2 ring-amber-200/70"
                                    style={{
                                        left: toPercent(pagePendingBlank.leftRatio),
                                        top: toPercent(pagePendingBlank.topRatio),
                                        width: toPercent(pagePendingBlank.widthRatio),
                                        height: toPercent(pagePendingBlank.heightRatio),
                                    }}
                                />
                            )}

                            {mode === 'teacher' && liveDraft && (
                                <div
                                    className="pointer-events-none absolute rounded-md border border-blue-300 bg-white/92 shadow-sm ring-2 ring-blue-200/70"
                                    style={{
                                        left: toPercent(liveDraft.leftRatio),
                                        top: toPercent(liveDraft.topRatio),
                                        width: toPercent(liveDraft.widthRatio),
                                        height: toPercent(liveDraft.heightRatio),
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
