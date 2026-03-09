import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    clampRatio,
    getTightTextRegionBounds,
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
    onDeleteBlank?: (blankId: string) => void;
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

const MIN_DRAG_SIZE = 0.003;
const LIVE_REGION_INTERSECTION_RATIO = 0.04;
const FINAL_REGION_INTERSECTION_RATIO = 0.12;

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

const getMatchedRegions = (
    pageImage: LessonWorksheetPageImage,
    pageRegions: LessonWorksheetTextRegion[],
    rect: {
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
    },
    minIntersectionRatio: number,
) => {
    const selection = {
        left: rect.leftRatio * pageImage.width,
        top: rect.topRatio * pageImage.height,
        right: (rect.leftRatio + rect.widthRatio) * pageImage.width,
        bottom: (rect.topRatio + rect.heightRatio) * pageImage.height,
    };

    return pageRegions.filter((region) => {
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
        return (intersectionArea / regionArea) >= minIntersectionRatio;
    });
};

const getPointMatchedRegions = (
    pageImage: LessonWorksheetPageImage,
    pageRegions: LessonWorksheetTextRegion[],
    point: { x: number; y: number },
) => {
    const px = point.x * pageImage.width;
    const py = point.y * pageImage.height;

    const directHits = pageRegions.filter((region) => {
        const bounds = getTightTextRegionBounds(region, pageImage);
        if (!bounds) return false;
        const left = bounds.left;
        const top = bounds.top;
        const right = bounds.left + bounds.width;
        const bottom = bounds.top + bounds.height;
        return px >= left && px <= right && py >= top && py <= bottom;
    });
    if (directHits.length) return directHits;

    let nearest: LessonWorksheetTextRegion | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    pageRegions.forEach((region) => {
        const bounds = getTightTextRegionBounds(region, pageImage);
        if (!bounds) return;
        const cx = bounds.left + (bounds.width / 2);
        const cy = bounds.top + (bounds.height / 2);
        const dx = cx - px;
        const dy = cy - py;
        const distance = Math.hypot(dx, dy);
        const threshold = Math.max(bounds.width, bounds.height) * 0.9;
        if (distance <= threshold && distance < nearestDistance) {
            nearest = region;
            nearestDistance = distance;
        }
    });

    return nearest ? [nearest] : [];
};

const LessonWorksheetStage: React.FC<LessonWorksheetStageProps> = ({
    pageImages,
    blanks,
    mode,
    textRegions = [],
    selectedBlankId,
    studentAnswers = {},
    onSelectBlank,
    onDeleteBlank,
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

        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraftRect({
            page,
            startX: point.x,
            startY: point.y,
            currentX: point.x,
            currentY: point.y,
        });
    };

    const updateDraftPoint = (page: number, clientX: number, clientY: number) => {
        if (!draftRect || draftRect.page !== page) return;

        const point = resolveRatioPoint(page, clientX, clientY);
        if (!point) return;

        setDraftRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : null));
    };

    const handlePointerUp = (pageImage: LessonWorksheetPageImage) => {
        if (!draftRect || draftRect.page !== pageImage.page) return;

        const nextRect = {
            leftRatio: Math.min(draftRect.startX, draftRect.currentX),
            topRatio: Math.min(draftRect.startY, draftRect.currentY),
            widthRatio: Math.abs(draftRect.currentX - draftRect.startX),
            heightRatio: Math.abs(draftRect.currentY - draftRect.startY),
        };

        const pageRegions = regionsByPage.get(pageImage.page) || [];
        const matchedRegions = nextRect.widthRatio < MIN_DRAG_SIZE || nextRect.heightRatio < MIN_DRAG_SIZE
            ? getPointMatchedRegions(pageImage, pageRegions, {
                x: (draftRect.startX + draftRect.currentX) / 2,
                y: (draftRect.startY + draftRect.currentY) / 2,
            })
            : getMatchedRegions(
                pageImage,
                pageRegions,
                nextRect,
                FINAL_REGION_INTERSECTION_RATIO,
            );
        if (!matchedRegions.length) {
            setDraftRect(null);
            return;
        }

        onCreateBlankFromSelection?.(pageImage.page, nextRect, matchedRegions);
        setDraftRect(null);
    };

    useEffect(() => {
        if (!draftRect) return undefined;

        const handleWindowPointerMove = (event: PointerEvent) => {
            updateDraftPoint(draftRect.page, event.clientX, event.clientY);
        };

        const handleWindowPointerUp = () => {
            const pageImage = pageImages.find((item) => item.page === draftRect.page);
            if (!pageImage) {
                setDraftRect(null);
                return;
            }
            handlePointerUp(pageImage);
        };

        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [draftRect, pageImages, regionsByPage]);

    return (
        <div className="space-y-6">
            {pageImages.map((pageImage) => {
                const pageBlanks = blanksByPage.get(pageImage.page) || [];
                const pageRegions = regionsByPage.get(pageImage.page) || [];
                const pagePendingBlank = pendingBlank?.page === pageImage.page ? pendingBlank : null;
                const liveDraft = draftRect && draftRect.page === pageImage.page
                    ? {
                        leftRatio: Math.min(draftRect.startX, draftRect.currentX),
                        topRatio: Math.min(draftRect.startY, draftRect.currentY),
                        widthRatio: Math.abs(draftRect.currentX - draftRect.startX),
                        heightRatio: Math.abs(draftRect.currentY - draftRect.startY),
                    }
                    : null;

                const draftRegions = liveDraft
                    ? getMatchedRegions(pageImage, pageRegions, liveDraft, LIVE_REGION_INTERSECTION_RATIO)
                    : [];

                return (
                    <section key={pageImage.page} className="rounded-3xl border border-gray-200 bg-white p-3 shadow-sm md:p-4">
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Page {pageImage.page}
                            </div>
                            {mode === 'teacher' && (
                                <div className="text-xs text-gray-500">
                                    페이지에서 원하는 글자를 드래그하면 실제 선택처럼 음영이 보이고, 놓으면 그 글자만 가려집니다.
                                </div>
                            )}
                        </div>

                        <div
                            ref={(node) => {
                                pageRefs.current[pageImage.page] = node;
                            }}
                            className={`relative overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 ${mode === 'teacher' ? 'touch-none cursor-text' : ''}`}
                            onDragStart={(event) => event.preventDefault()}
                            onPointerDown={(event) => handlePointerDown(pageImage.page, event)}
                            onPointerMove={(event) => updateDraftPoint(pageImage.page, event.clientX, event.clientY)}
                            onPointerUp={() => handlePointerUp(pageImage)}
                            onPointerCancel={() => setDraftRect(null)}
                        >
                            <img
                                src={pageImage.imageUrl}
                                alt={`학습지 ${pageImage.page}페이지`}
                                className="block h-auto w-full select-none"
                                draggable={false}
                                onDragStart={(event) => event.preventDefault()}
                            />

                            {mode === 'teacher' && pageBlanks.map((blank) => {
                                const maskedRegions = getMatchedRegions(
                                    pageImage,
                                    pageRegions,
                                    blank,
                                    FINAL_REGION_INTERSECTION_RATIO,
                                );
                                const renderRegions = maskedRegions.length
                                    ? maskedRegions.map((region) => {
                                        const bounds = getTightTextRegionBounds(region, pageImage);
                                        return bounds ? {
                                        key: `${blank.id}-${region.left}-${region.top}`,
                                        leftRatio: bounds.leftRatio,
                                        topRatio: bounds.topRatio,
                                        widthRatio: bounds.widthRatio,
                                        heightRatio: bounds.heightRatio,
                                    } : null;
                                    }).filter((item): item is NonNullable<typeof item> => Boolean(item))
                                    : [{
                                        key: blank.id,
                                        leftRatio: blank.leftRatio,
                                        topRatio: blank.topRatio,
                                        widthRatio: blank.widthRatio,
                                        heightRatio: blank.heightRatio,
                                    }];

                                return renderRegions.map((region) => (
                                    <button
                                        key={region.key}
                                        type="button"
                                        data-blank-box="true"
                                        onClick={() => onSelectBlank?.(blank.id)}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            onDeleteBlank?.(blank.id);
                                        }}
                                        aria-label="빈칸 선택"
                                        className={`absolute border-0 p-0 ${
                                            selectedBlankId === blank.id
                                                ? 'bg-slate-100/96 shadow-[0_0_0_1px_rgba(59,130,246,0.38)]'
                                                : 'bg-white/96'
                                        }`}
                                        style={{
                                            left: toPercent(region.leftRatio),
                                            top: toPercent(region.topRatio),
                                            width: toPercent(region.widthRatio),
                                            height: toPercent(region.heightRatio),
                                        }}
                                    />
                                ));
                            })}

                            {mode === 'student' && pageBlanks.map((blank) => {
                                const studentAnswer = studentAnswers[blank.id];
                                const status = studentAnswer?.status || '';

                                return (
                                    <div
                                        key={blank.id}
                                        data-blank-box="true"
                                        className={`absolute overflow-hidden rounded-sm border shadow-sm ${
                                            status === 'correct'
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
                                    </div>
                                );
                            })}

                            {mode === 'teacher' && pagePendingBlank && (
                                <>
                                    {(getMatchedRegions(pageImage, pageRegions, pagePendingBlank, FINAL_REGION_INTERSECTION_RATIO).length
                                        ? getMatchedRegions(pageImage, pageRegions, pagePendingBlank, FINAL_REGION_INTERSECTION_RATIO).map((region) => {
                                            const bounds = getTightTextRegionBounds(region, pageImage);
                                            return bounds ? {
                                            key: `pending-${region.left}-${region.top}`,
                                            leftRatio: bounds.leftRatio,
                                            topRatio: bounds.topRatio,
                                            widthRatio: bounds.widthRatio,
                                            heightRatio: bounds.heightRatio,
                                        } : null;
                                        }).filter((item): item is NonNullable<typeof item> => Boolean(item))
                                        : [{
                                            key: `pending-${pagePendingBlank.id}`,
                                            leftRatio: pagePendingBlank.leftRatio,
                                            topRatio: pagePendingBlank.topRatio,
                                            widthRatio: pagePendingBlank.widthRatio,
                                            heightRatio: pagePendingBlank.heightRatio,
                                        }]
                                    ).map((region) => (
                                        <div
                                            key={region.key}
                                            className="pointer-events-none absolute bg-slate-100/95 shadow-[0_0_0_1px_rgba(245,158,11,0.45)]"
                                            style={{
                                                left: toPercent(region.leftRatio),
                                                top: toPercent(region.topRatio),
                                                width: toPercent(region.widthRatio),
                                                height: toPercent(region.heightRatio),
                                            }}
                                        />
                                    ))}
                                </>
                            )}

                            {mode === 'teacher' && draftRegions.map((region, index) => (
                                (() => {
                                    const bounds = getTightTextRegionBounds(region, pageImage);
                                    if (!bounds) return null;
                                    return (
                                        <div
                                            key={`draft-${pageImage.page}-${index}`}
                                            className="pointer-events-none absolute bg-sky-300/35 mix-blend-multiply"
                                            style={{
                                                left: toPercent(bounds.leftRatio),
                                                top: toPercent(bounds.topRatio),
                                                width: toPercent(bounds.widthRatio),
                                                height: toPercent(bounds.heightRatio),
                                            }}
                                        />
                                    );
                                })()
                            ))}
                        </div>
                    </section>
                );
            })}
        </div>
    );
};

export default LessonWorksheetStage;
