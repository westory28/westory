import React, { useMemo, useRef } from 'react';
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
    onCreateBlankAtPoint?: (page: number, point: { x: number; y: number }) => void;
    onStudentAnswerChange?: (blankId: string, value: string) => void;
    pendingBlank?: LessonWorksheetBlank | null;
}

const LessonWorksheetStage: React.FC<LessonWorksheetStageProps> = ({
    pageImages,
    blanks,
    mode,
    textRegions = [],
    selectedBlankId,
    studentAnswers = {},
    onSelectBlank,
    onCreateBlankFromRegion,
    onCreateBlankAtPoint,
    onStudentAnswerChange,
    pendingBlank = null,
}) => {
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

    const handleStageClick = (page: number, event: React.MouseEvent<HTMLDivElement>) => {
        if (mode !== 'teacher') return;
        if ((event.target as HTMLElement).closest('[data-region-button], [data-blank-box]')) return;

        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        if (!point) return;

        onCreateBlankAtPoint?.(page, point);
    };

    return (
        <div className="space-y-6">
            {pageImages.map((pageImage) => {
                const pageBlanks = blanksByPage.get(pageImage.page) || [];
                const pageRegions = regionsByPage.get(pageImage.page) || [];
                const pagePendingBlank = pendingBlank?.page === pageImage.page ? pendingBlank : null;

                return (
                    <section key={pageImage.page} className="rounded-3xl border border-gray-200 bg-white p-3 md:p-4 shadow-sm">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Page {pageImage.page}
                            </div>
                            {mode === 'teacher' && (
                                <div className="text-xs text-gray-500">
                                    OCR 박스나 페이지 아무 곳이나 클릭해서 빈칸 초안을 만들고 정답을 확정하세요.
                                </div>
                            )}
                        </div>

                        <div
                            ref={(node) => {
                                pageRefs.current[pageImage.page] = node;
                            }}
                            className="relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                            onClick={(event) => handleStageClick(pageImage.page, event)}
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

                            {mode === 'teacher' && pagePendingBlank && (
                                <div
                                    className="pointer-events-none absolute rounded-md border-2 border-dashed border-amber-500 bg-amber-200/30 shadow-sm"
                                    style={{
                                        left: `${pagePendingBlank.leftRatio * 100}%`,
                                        top: `${pagePendingBlank.topRatio * 100}%`,
                                        width: `${pagePendingBlank.widthRatio * 100}%`,
                                        height: `${pagePendingBlank.heightRatio * 100}%`,
                                    }}
                                >
                                    <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] font-bold leading-tight text-amber-800 md:text-xs">
                                        {pagePendingBlank.answer || '정답 입력 후 확정'}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
};

export default LessonWorksheetStage;
