import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    clampRatio,
    getTightTextRegionBounds,
    normalizeBlankText,
    splitTextRegionIntoTokens,
    type LessonWorksheetBlank,
    type LessonWorksheetPageImage,
    type LessonWorksheetTextRegion,
} from '../../lib/lessonWorksheet';

type AnswerStatus = '' | 'correct' | 'wrong';
type StudentTool = 'move' | 'pen' | 'highlighter' | 'eraser' | 'text';
type DrawingColor = 'blue' | 'red' | 'green' | 'yellow' | 'black';

interface LessonWorksheetStageProps {
    pageImages: LessonWorksheetPageImage[];
    blanks: LessonWorksheetBlank[];
    mode: 'teacher' | 'student';
    teacherTool?: 'ocr' | 'box';
    textRegions?: LessonWorksheetTextRegion[];
    selectedBlankId?: string | null;
    studentAnswers?: Record<string, { value?: string; status?: AnswerStatus }>;
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
        source: 'ocr' | 'manual',
    ) => void;
    onStudentAnswerChange?: (blankId: string, value: string, answer: string) => void;
    pendingBlank?: LessonWorksheetBlank | null;
    annotationEnabled?: boolean;
}

interface DraftRect {
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

interface RatioPoint {
    x: number;
    y: number;
}

interface AnnotationStroke {
    id: string;
    page: number;
    tool: 'pen' | 'highlighter';
    color: string;
    width: number;
    points: RatioPoint[];
}

interface AnnotationTextNote {
    id: string;
    page: number;
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
    text: string;
}

interface PinchState {
    startDistance: number;
    startZoom: number;
}

interface ToolColorOption {
    key: DrawingColor;
    label: string;
    pen: string;
    highlighter: string;
}

const MIN_DRAG_SIZE = 0.0012;
const MIN_BOX_DRAG_SIZE = 0.003;
const LIVE_REGION_INTERSECTION_RATIO = 0.04;
const FINAL_REGION_INTERSECTION_RATIO = 0.12;
const EMPTY_BLANK_LABEL = '빈칸';
const MIN_STUDENT_ZOOM = 0.7;
const MAX_STUDENT_ZOOM = 2.4;
const TOOL_COLORS: ToolColorOption[] = [
    { key: 'blue', label: '파랑', pen: '#2563eb', highlighter: 'rgba(59, 130, 246, 0.28)' },
    { key: 'red', label: '빨강', pen: '#dc2626', highlighter: 'rgba(248, 113, 113, 0.3)' },
    { key: 'green', label: '초록', pen: '#16a34a', highlighter: 'rgba(74, 222, 128, 0.28)' },
    { key: 'yellow', label: '노랑', pen: '#ca8a04', highlighter: 'rgba(250, 204, 21, 0.34)' },
    { key: 'black', label: '검정', pen: '#111827', highlighter: 'rgba(148, 163, 184, 0.34)' },
];

const MOVE_CURSOR = 'grab';
const PEN_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath fill='%23111827' d='M20.8 4.2l3 3c.8.8.8 2 0 2.8L12 21.9l-5.1 1.3L8.2 18 20 6.2c.8-.8 2-.8 2.8 0z'/%3E%3Cpath fill='%2360A5FA' d='M6.9 23.2l1.3-5 3.7 3.7z'/%3E%3C/g%3E%3C/svg%3E") 4 24, crosshair`;
const HIGHLIGHTER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath fill='%23FACC15' d='M18.5 4l5.5 5.5-10.9 10.9-6.2.8.8-6.2z'/%3E%3Cpath fill='%23924100' d='M18.5 4l5.5 5.5 1.1-1.1c.7-.7.7-1.8 0-2.5l-3-3c-.7-.7-1.8-.7-2.5 0z'/%3E%3Cpath stroke='%23111827' stroke-width='1.2' d='M7.2 21.1l-1.9 1.9h7.3'/%3E%3C/g%3E%3C/svg%3E") 5 23, crosshair`;
const ERASER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cpath fill='%23F59E0B' d='M10.3 5.3l12.4 12.4-5.3 5.3H8.6L3 17.4z'/%3E%3Cpath fill='%23FFF7ED' d='M10.3 5.3l6.1 6.1-8 8L3 17.4z'/%3E%3Cpath stroke='%23111827' stroke-width='1.4' d='M3.5 17.4l6.8 6.8m12.1-6.5l-5.1 5.1m-8.7 1h13.2'/%3E%3C/g%3E%3C/svg%3E") 6 22, cell`;

const toPercent = (value: number) => `${value * 100}%`;
const clampZoom = (value: number) => Math.min(MAX_STUDENT_ZOOM, Math.max(MIN_STUDENT_ZOOM, value));

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

const expandRegionsForSelection = (
    pageRegions: LessonWorksheetTextRegion[],
    pageImage: LessonWorksheetPageImage,
) => pageRegions.flatMap((region) => {
    const tokens = splitTextRegionIntoTokens(region, pageImage);
    return tokens.length > 0 ? tokens : [region];
});

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
    const expandedRegions = expandRegionsForSelection(pageRegions, pageImage);
    const selection = {
        left: rect.leftRatio * pageImage.width,
        top: rect.topRatio * pageImage.height,
        right: (rect.leftRatio + rect.widthRatio) * pageImage.width,
        bottom: (rect.topRatio + rect.heightRatio) * pageImage.height,
    };

    return expandedRegions.filter((region) => {
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
    point: RatioPoint,
) => {
    const expandedRegions = expandRegionsForSelection(pageRegions, pageImage);
    const px = point.x * pageImage.width;
    const py = point.y * pageImage.height;

    const directHits = expandedRegions.filter((region) => {
        const bounds = getTightTextRegionBounds(region, pageImage);
        if (!bounds) return false;
        const left = Math.min(region.left, bounds.left) - 6;
        const top = Math.min(region.top, bounds.top) - 4;
        const right = Math.max(region.left + region.width, bounds.left + bounds.width) + 6;
        const bottom = Math.max(region.top + region.height, bounds.top + bounds.height) + 4;
        return px >= left && px <= right && py >= top && py <= bottom;
    });
    if (directHits.length) return directHits;

    let nearest: LessonWorksheetTextRegion | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    expandedRegions.forEach((region) => {
        const bounds = getTightTextRegionBounds(region, pageImage);
        if (!bounds) return;
        const cx = bounds.left + (bounds.width / 2);
        const cy = bounds.top + (bounds.height / 2);
        const dx = cx - px;
        const dy = cy - py;
        const distance = Math.hypot(dx, dy);
        const threshold = Math.max(region.width, bounds.width, bounds.height) * 1.8;
        if (distance <= threshold && distance < nearestDistance) {
            nearest = region;
            nearestDistance = distance;
        }
    });

    return nearest ? [nearest] : [];
};

const resolveBlankRenderRect = (
    blank: LessonWorksheetBlank,
    pageImage: LessonWorksheetPageImage,
    pageRegions: LessonWorksheetTextRegion[],
) => {
    const blankCenterX = blank.leftRatio + (blank.widthRatio / 2);
    const blankCenterY = blank.topRatio + (blank.heightRatio / 2);
    const normalizedAnswer = normalizeBlankText(blank.answer);
    const expandedRegions = expandRegionsForSelection(pageRegions, pageImage);
    const candidates = normalizedAnswer
        ? expandedRegions.filter((region) => normalizeBlankText(region.label) === normalizedAnswer)
        : [];

    if (candidates.length) {
        const nearest = candidates
            .map((region) => {
                const bounds = getTightTextRegionBounds(region, pageImage);
                if (!bounds) return null;
                const dx = (bounds.leftRatio + (bounds.widthRatio / 2)) - blankCenterX;
                const dy = (bounds.topRatio + (bounds.heightRatio / 2)) - blankCenterY;
                return { bounds, distance: Math.hypot(dx, dy) };
            })
            .filter((item): item is NonNullable<typeof item> => Boolean(item))
            .sort((a, b) => a.distance - b.distance)[0];

        if (nearest) return nearest.bounds;
    }

    return {
        leftRatio: blank.leftRatio,
        topRatio: blank.topRatio,
        widthRatio: blank.widthRatio,
        heightRatio: blank.heightRatio,
    };
};

const expandRect = (
    rect: {
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
    },
    pageImage: LessonWorksheetPageImage,
    options?: {
        padX?: number;
        padY?: number;
        minWidth?: number;
        minHeight?: number;
    },
) => {
    const padX = options?.padX ?? 8;
    const padY = options?.padY ?? 5;
    const minWidth = options?.minWidth ?? 44;
    const minHeight = options?.minHeight ?? 20;
    const left = Math.max(0, (rect.leftRatio * pageImage.width) - padX);
    const top = Math.max(0, (rect.topRatio * pageImage.height) - padY);
    const right = Math.min(pageImage.width, ((rect.leftRatio + rect.widthRatio) * pageImage.width) + padX);
    const bottom = Math.min(pageImage.height, ((rect.topRatio + rect.heightRatio) * pageImage.height) + padY);
    const width = Math.max(minWidth, right - left);
    const height = Math.max(minHeight, bottom - top);

    return {
        leftRatio: left / pageImage.width,
        topRatio: top / pageImage.height,
        widthRatio: Math.min(1 - (left / pageImage.width), width / pageImage.width),
        heightRatio: Math.min(1 - (top / pageImage.height), height / pageImage.height),
    };
};

const getStudentBlankRect = (
    blank: LessonWorksheetBlank,
    pageImage: LessonWorksheetPageImage,
    pageRegions: LessonWorksheetTextRegion[],
) => {
    const baseRect = blank.source === 'manual'
        ? {
            leftRatio: blank.leftRatio,
            topRatio: blank.topRatio,
            widthRatio: blank.widthRatio,
            heightRatio: blank.heightRatio,
        }
        : resolveBlankRenderRect(blank, pageImage, pageRegions);
    const pixelWidth = Math.max(1, baseRect.widthRatio * pageImage.width);
    const pixelHeight = Math.max(1, baseRect.heightRatio * pageImage.height);

    if (blank.source === 'manual') {
        return expandRect(baseRect, pageImage, {
            padX: pixelWidth < 34 ? 2 : 3,
            padY: pixelHeight < 18 ? 1.5 : 2.5,
            minWidth: Math.max(34, Math.min(pixelWidth + 10, 88)),
            minHeight: Math.max(18, Math.min(pixelHeight + 8, 36)),
        });
    }

    return expandRect(baseRect, pageImage, {
        padX: pixelWidth < 40 ? 2.5 : 4,
        padY: pixelHeight < 20 ? 2 : 2.5,
        minWidth: Math.max(36, Math.min(pixelWidth + 14, 94)),
        minHeight: Math.max(20, Math.min(pixelHeight + 8, 38)),
    });
};

const getStudentBlankFontSize = (pixelWidth: number, pixelHeight: number, contentLength: number) => {
    const safeLength = Math.max(1, contentLength);
    const widthBased = Math.max(1, pixelWidth - 4) / (safeLength * 0.8);
    const heightBased = Math.max(1, pixelHeight - 2) * 0.84;
    return Math.max(7, Math.min(19, widthBased, heightBased));
};

const buildStrokePath = (points: RatioPoint[], pageImage: LessonWorksheetPageImage) => {
    if (!points.length) return '';
    return points.map((point) => `${point.x * pageImage.width},${point.y * pageImage.height}`).join(' ');
};

const createStroke = (page: number, tool: 'pen' | 'highlighter', point: RatioPoint): AnnotationStroke => ({
    id: `stroke-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    tool,
    color: tool === 'pen' ? TOOL_COLORS[0].pen : TOOL_COLORS[0].highlighter,
    width: tool === 'pen' ? 4 : 15,
    points: [point],
});

const createTextNote = (page: number, point: RatioPoint): AnnotationTextNote => ({
    id: `note-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    leftRatio: Math.min(0.82, point.x),
    topRatio: Math.min(0.9, point.y),
    widthRatio: 0.18,
    heightRatio: 0.08,
    text: '',
});

const LessonWorksheetStage: React.FC<LessonWorksheetStageProps> = ({
    pageImages,
    blanks,
    mode,
    teacherTool = 'ocr',
    textRegions = [],
    selectedBlankId,
    studentAnswers = {},
    onSelectBlank,
    onDeleteBlank,
    onCreateBlankFromSelection,
    onStudentAnswerChange,
    pendingBlank = null,
    annotationEnabled = false,
}) => {
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
    const [activeTeacherPage, setActiveTeacherPage] = useState<number | null>(pageImages[0]?.page ?? null);
    const [activeStudentPage, setActiveStudentPage] = useState<number | null>(pageImages[0]?.page ?? null);
    const [annotationTool, setAnnotationTool] = useState<StudentTool>('move');
    const [penColorKey, setPenColorKey] = useState<DrawingColor>('blue');
    const [highlighterColorKey, setHighlighterColorKey] = useState<DrawingColor>('yellow');
    const [studentZoom, setStudentZoom] = useState(1);
    const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
    const [draftStroke, setDraftStroke] = useState<AnnotationStroke | null>(null);
    const [textNotes, setTextNotes] = useState<AnnotationTextNote[]>([]);
    const [activeTextNoteId, setActiveTextNoteId] = useState<string | null>(null);
    const pinchRef = useRef<PinchState | null>(null);

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

    useEffect(() => {
        if (!pageImages.length) {
            setActiveTeacherPage(null);
            setActiveStudentPage(null);
            return;
        }
        setActiveTeacherPage((current) => {
            if (current && pageImages.some((page) => page.page === current)) return current;
            return pageImages[0].page;
        });
        setActiveStudentPage((current) => {
            if (current && pageImages.some((page) => page.page === current)) return current;
            return pageImages[0].page;
        });
    }, [pageImages]);

    const visiblePageImages = useMemo(() => {
        if (mode === 'teacher') {
            if (activeTeacherPage == null) return pageImages;
            return pageImages.filter((pageImage) => pageImage.page === activeTeacherPage);
        }
        if (mode === 'student' && activeStudentPage != null) {
            return pageImages.filter((pageImage) => pageImage.page === activeStudentPage);
        }
        return pageImages;
    }, [activeStudentPage, activeTeacherPage, mode, pageImages]);

    const activeTeacherPageIndex = mode === 'teacher' && activeTeacherPage != null
        ? pageImages.findIndex((pageImage) => pageImage.page === activeTeacherPage)
        : -1;
    const activeStudentPageIndex = mode === 'student' && activeStudentPage != null
        ? pageImages.findIndex((pageImage) => pageImage.page === activeStudentPage)
        : -1;

    const handleTeacherPageChange = (direction: -1 | 1) => {
        if (mode !== 'teacher' || activeTeacherPageIndex < 0) return;
        const nextPage = pageImages[activeTeacherPageIndex + direction];
        if (!nextPage) return;
        setDraftRect(null);
        setActiveTeacherPage(nextPage.page);
    };

    const handleStudentPageChange = (direction: -1 | 1) => {
        if (mode !== 'student' || activeStudentPageIndex < 0) return;
        const nextPage = pageImages[activeStudentPageIndex + direction];
        if (!nextPage) return;
        setDraftStroke(null);
        setActiveTextNoteId(null);
        setActiveStudentPage(nextPage.page);
    };

    const getTouchDistance = (touches: React.TouchList) => {
        if (touches.length < 2) return null;
        const first = touches[0];
        const second = touches[1];
        return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    };

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

    const eraseAnnotationAtPoint = (page: number, point: RatioPoint, pageImage: LessonWorksheetPageImage) => {
        const noteHit = textNotes.find((note) => (
            note.page === page
            && point.x >= note.leftRatio
            && point.x <= note.leftRatio + note.widthRatio
            && point.y >= note.topRatio
            && point.y <= note.topRatio + note.heightRatio
        ));
        if (noteHit) {
            setTextNotes((prev) => prev.filter((note) => note.id !== noteHit.id));
            if (activeTextNoteId === noteHit.id) setActiveTextNoteId(null);
            return;
        }

        const threshold = Math.max(0.012, 22 / Math.max(pageImage.width, 1));
        const hitStroke = strokes.find((stroke) => (
            stroke.page === page
            && stroke.points.some((strokePoint) => Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= threshold)
        ));
        if (hitStroke) {
            setStrokes((prev) => prev.filter((stroke) => stroke.id !== hitStroke.id));
        }
    };

    const selectedPenColor = TOOL_COLORS.find((color) => color.key === penColorKey) || TOOL_COLORS[0];
    const selectedHighlighterColor = TOOL_COLORS.find((color) => color.key === highlighterColorKey) || TOOL_COLORS[3];
    const zoomPercent = Math.round(studentZoom * 100);
    const stageCursor = mode === 'student' && annotationEnabled
        ? annotationTool === 'move'
            ? MOVE_CURSOR
            : annotationTool === 'eraser'
            ? ERASER_CURSOR
            : annotationTool === 'text'
                ? 'text'
                : annotationTool === 'highlighter'
                    ? HIGHLIGHTER_CURSOR
                    : PEN_CURSOR
        : undefined;

    const applyStudentZoom = (nextZoom: number) => {
        setStudentZoom(clampZoom(nextZoom));
    };

    const handlePointerDown = (page: number, event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;

        if (mode === 'teacher') {
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
            return;
        }

        if (!annotationEnabled) return;
        const target = event.target as HTMLElement;
        if (target.closest('[data-blank-box]') || target.closest('[data-annotation-note]')) return;
        if (annotationTool === 'move') return;
        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        const pageImage = pageImages.find((item) => item.page === page);
        if (!point || !pageImage) return;

        event.preventDefault();
        if (annotationTool === 'text') {
            const nextNote = createTextNote(page, point);
            setTextNotes((prev) => [...prev, nextNote]);
            setActiveTextNoteId(nextNote.id);
            return;
        }
        if (annotationTool === 'eraser') {
            eraseAnnotationAtPoint(page, point, pageImage);
            return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        const nextStroke = createStroke(page, annotationTool, point);
        nextStroke.color = annotationTool === 'pen' ? selectedPenColor.pen : selectedHighlighterColor.highlighter;
        nextStroke.width = annotationTool === 'pen' ? 4 : 18;
        setDraftStroke(nextStroke);
    };

    const updateDraftPoint = (page: number, clientX: number, clientY: number) => {
        if (mode === 'teacher') {
            if (!draftRect || draftRect.page !== page) return;
            const point = resolveRatioPoint(page, clientX, clientY);
            if (!point) return;
            setDraftRect((prev) => (prev ? { ...prev, currentX: point.x, currentY: point.y } : null));
            return;
        }

        if (!draftStroke || draftStroke.page !== page) return;
        const point = resolveRatioPoint(page, clientX, clientY);
        if (!point) return;
        setDraftStroke((prev) => {
            if (!prev) return null;
            const lastPoint = prev.points[prev.points.length - 1];
            if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < 0.002) return prev;
            return { ...prev, points: [...prev.points, point] };
        });
    };

    const handleTeacherPointerUp = (pageImage: LessonWorksheetPageImage) => {
        if (!draftRect || draftRect.page !== pageImage.page) return;

        const nextRect = {
            leftRatio: Math.min(draftRect.startX, draftRect.currentX),
            topRatio: Math.min(draftRect.startY, draftRect.currentY),
            widthRatio: Math.abs(draftRect.currentX - draftRect.startX),
            heightRatio: Math.abs(draftRect.currentY - draftRect.startY),
        };

        const pageRegions = regionsByPage.get(pageImage.page) || [];
        const isTinyDrag = nextRect.widthRatio < MIN_DRAG_SIZE || nextRect.heightRatio < MIN_DRAG_SIZE;
        const isBoxTool = teacherTool === 'box';

        if (isBoxTool && (nextRect.widthRatio < MIN_BOX_DRAG_SIZE || nextRect.heightRatio < MIN_BOX_DRAG_SIZE)) {
            setDraftRect(null);
            return;
        }

        const matchedRegions = isTinyDrag
            ? getPointMatchedRegions(pageImage, pageRegions, {
                x: (draftRect.startX + draftRect.currentX) / 2,
                y: (draftRect.startY + draftRect.currentY) / 2,
            })
            : getMatchedRegions(pageImage, pageRegions, nextRect, FINAL_REGION_INTERSECTION_RATIO);

        if (!isBoxTool && !matchedRegions.length && isTinyDrag) {
            setDraftRect(null);
            return;
        }

        onCreateBlankFromSelection?.(
            pageImage.page,
            nextRect,
            isBoxTool ? [] : matchedRegions,
            isBoxTool ? 'manual' : (matchedRegions.length ? 'ocr' : 'manual'),
        );
        setDraftRect(null);
    };

    const finishStudentStroke = () => {
        setDraftStroke((prev) => {
            if (!prev) return null;
            const finalized = prev.points.length === 1
                ? { ...prev, points: [...prev.points, prev.points[0]] }
                : prev;
            setStrokes((existing) => [...existing, finalized]);
            return null;
        });
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
            handleTeacherPointerUp(pageImage);
        };
        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [draftRect, pageImages, teacherTool, textRegions]);

    useEffect(() => {
        if (!draftStroke) return undefined;
        const handleWindowPointerMove = (event: PointerEvent) => {
            updateDraftPoint(draftStroke.page, event.clientX, event.clientY);
        };
        const handleWindowPointerUp = () => {
            finishStudentStroke();
        };
        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [draftStroke]);

    return (
        <div className="space-y-6">
            {mode === 'student' && annotationEnabled && (
                <div className="sticky top-3 z-40 flex justify-center">
                    <div className="flex w-full max-w-[min(96vw,1180px)] flex-wrap items-center justify-center gap-2 rounded-full border border-blue-100 bg-white/92 px-3 py-3 shadow-[0_18px_48px_rgba(37,99,235,0.16)] backdrop-blur-xl md:px-4">
                        {[
                            ['move', '이동', 'fa-up-down-left-right'],
                            ['pen', '펜', 'fa-pen'],
                            ['highlighter', '형광펜', 'fa-highlighter'],
                            ['eraser', '지우개', 'fa-eraser'],
                            ['text', '텍스트', 'fa-font'],
                        ].map(([tool, label, icon]) => (
                            <button
                                key={tool}
                                type="button"
                                onClick={() => setAnnotationTool(tool as StudentTool)}
                                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                                    annotationTool === tool
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                            >
                                <i className={`fas ${icon} text-xs`}></i>
                                {label}
                            </button>
                        ))}
                        {(annotationTool === 'pen' || annotationTool === 'highlighter') && (
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                                {TOOL_COLORS.map((color) => {
                                    const isPen = annotationTool === 'pen';
                                    const selected = isPen ? penColorKey === color.key : highlighterColorKey === color.key;
                                    return (
                                        <button
                                            key={`${annotationTool}-${color.key}`}
                                            type="button"
                                            aria-label={`${annotationTool === 'pen' ? '펜' : '형광펜'} ${color.label}`}
                                            onClick={() => {
                                                if (isPen) setPenColorKey(color.key);
                                                else setHighlighterColorKey(color.key);
                                            }}
                                            className={`h-7 w-7 rounded-full border-2 transition ${selected ? 'border-slate-900 scale-110' : 'border-white/80 hover:scale-105'}`}
                                            style={{ background: isPen ? color.pen : color.highlighter }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
                            <button
                                type="button"
                                onClick={() => applyStudentZoom(studentZoom - 0.1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 transition hover:bg-slate-50"
                                aria-label="축소"
                            >
                                <i className="fas fa-minus text-xs"></i>
                            </button>
                            <button
                                type="button"
                                onClick={() => applyStudentZoom(1)}
                                className="min-w-[58px] rounded-full bg-slate-50 px-3 py-1 text-center text-xs font-bold text-slate-700 transition hover:bg-slate-100"
                            >
                                {zoomPercent}%
                            </button>
                            <button
                                type="button"
                                onClick={() => applyStudentZoom(studentZoom + 0.1)}
                                className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 transition hover:bg-slate-50"
                                aria-label="확대"
                            >
                                <i className="fas fa-plus text-xs"></i>
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setStrokes([]);
                                setTextNotes([]);
                                setActiveTextNoteId(null);
                            }}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                            <i className="fas fa-trash-alt text-xs"></i>
                            전체 지우기
                        </button>
                    </div>
                </div>
            )}
            {mode === 'student' && pageImages.length > 1 && activeStudentPageIndex >= 0 && (
                <div className="flex items-center justify-between rounded-3xl border border-slate-200 bg-white/88 px-4 py-3 shadow-sm backdrop-blur">
                    <button
                        type="button"
                        onClick={() => handleStudentPageChange(-1)}
                        disabled={activeStudentPageIndex === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <i className="fas fa-chevron-left text-xs"></i>
                        이전 페이지
                    </button>
                    <div className="text-center">
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">Page</div>
                        <div className="text-sm font-bold text-slate-800">
                            {activeStudentPageIndex + 1} / {pageImages.length}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => handleStudentPageChange(1)}
                        disabled={activeStudentPageIndex === pageImages.length - 1}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        다음 페이지
                        <i className="fas fa-chevron-right text-xs"></i>
                    </button>
                </div>
            )}
            {mode === 'teacher' && pageImages.length > 1 && activeTeacherPageIndex >= 0 && (
                <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                    <button
                        type="button"
                        onClick={() => handleTeacherPageChange(-1)}
                        disabled={activeTeacherPageIndex === 0}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <i className="fas fa-chevron-left text-xs"></i>
                        이전
                    </button>
                    <div className="text-center">
                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Page</div>
                        <div className="text-sm font-bold text-gray-800">
                            {activeTeacherPageIndex + 1} / {pageImages.length}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => handleTeacherPageChange(1)}
                        disabled={activeTeacherPageIndex === pageImages.length - 1}
                        className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        다음
                        <i className="fas fa-chevron-right text-xs"></i>
                    </button>
                </div>
            )}
            {visiblePageImages.map((pageImage) => {
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

                const draftRegions = liveDraft && teacherTool === 'ocr'
                    ? (
                        liveDraft.widthRatio < MIN_DRAG_SIZE || liveDraft.heightRatio < MIN_DRAG_SIZE
                            ? getPointMatchedRegions(pageImage, pageRegions, {
                                x: (draftRect!.startX + draftRect!.currentX) / 2,
                                y: (draftRect!.startY + draftRect!.currentY) / 2,
                            })
                            : getMatchedRegions(pageImage, pageRegions, liveDraft, LIVE_REGION_INTERSECTION_RATIO)
                    )
                    : [];

                const showDraftRect = Boolean(
                    mode === 'teacher'
                    && liveDraft
                    && (teacherTool === 'box' || draftRegions.length === 0)
                    && liveDraft.widthRatio >= (teacherTool === 'box' ? MIN_BOX_DRAG_SIZE : MIN_DRAG_SIZE)
                    && liveDraft.heightRatio >= (teacherTool === 'box' ? MIN_BOX_DRAG_SIZE : MIN_DRAG_SIZE),
                );

                const pageStrokes = strokes.filter((stroke) => stroke.page === pageImage.page);
                const pageTextNotes = textNotes.filter((note) => note.page === pageImage.page);
                const currentDraftStroke = draftStroke?.page === pageImage.page ? draftStroke : null;

                return (
                    <section key={pageImage.page} className={`rounded-[2rem] border border-gray-200 bg-white shadow-sm ${mode === 'student' ? 'p-2 md:p-3' : 'p-3 md:p-4'}`}>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                                Page {pageImage.page}
                            </div>
                            {mode === 'teacher' && (
                                <div className="text-xs text-gray-500">
                                    페이지에서 원하는 글자를 드래그하면 실제 선택처럼 반영되고, 놓으면 그 글자만 가려집니다.
                                </div>
                            )}
                        </div>

                        <div
                            className="overflow-auto rounded-2xl border border-gray-200 bg-gray-50"
                            onWheel={(event) => {
                                if (mode !== 'student' || !annotationEnabled) return;
                                event.preventDefault();
                                const delta = event.deltaY < 0 ? 0.08 : -0.08;
                                applyStudentZoom(studentZoom + delta);
                            }}
                            onTouchStart={(event) => {
                                if (mode !== 'student' || !annotationEnabled) return;
                                const distance = getTouchDistance(event.touches);
                                if (!distance) return;
                                pinchRef.current = {
                                    startDistance: distance,
                                    startZoom: studentZoom,
                                };
                            }}
                            onTouchMove={(event) => {
                                if (mode !== 'student' || !annotationEnabled) return;
                                if (!pinchRef.current) return;
                                const distance = getTouchDistance(event.touches);
                                if (!distance) return;
                                event.preventDefault();
                                applyStudentZoom(pinchRef.current.startZoom * (distance / pinchRef.current.startDistance));
                            }}
                            onTouchEnd={() => {
                                pinchRef.current = null;
                            }}
                        >
                            <div
                                ref={(node) => {
                                    pageRefs.current[pageImage.page] = node;
                                }}
                                className={`relative ${
                                    mode === 'teacher'
                                        ? `touch-none ${teacherTool === 'box' ? 'cursor-default' : 'cursor-text'}`
                                        : annotationEnabled
                                            ? `touch-none ${annotationTool === 'move' ? 'cursor-grab' : annotationTool === 'eraser' ? 'cursor-not-allowed' : annotationTool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`
                                            : ''
                                }`}
                                style={{
                                    cursor: stageCursor,
                                    width: mode === 'student' ? `${studentZoom * 100}%` : '100%',
                                    minWidth: mode === 'student' ? `${studentZoom * 100}%` : '100%',
                                    maxWidth: mode === 'student' ? 'none' : '100%',
                                    margin: mode === 'student' && studentZoom <= 1 ? '0 auto' : undefined,
                                }}
                                onDragStart={(event) => event.preventDefault()}
                                onPointerDown={(event) => handlePointerDown(pageImage.page, event)}
                                onPointerMove={(event) => updateDraftPoint(pageImage.page, event.clientX, event.clientY)}
                                onPointerUp={() => {
                                    if (mode === 'teacher') handleTeacherPointerUp(pageImage);
                                    else finishStudentStroke();
                                }}
                                onPointerCancel={() => {
                                    setDraftRect(null);
                                    setDraftStroke(null);
                                }}
                            >
                                <img
                                    src={pageImage.imageUrl}
                                    alt={`학습지 ${pageImage.page}페이지`}
                                    className="block h-auto w-full select-none"
                                    draggable={false}
                                    onDragStart={(event) => event.preventDefault()}
                                />

                                {(pageStrokes.length > 0 || currentDraftStroke) && (
                                    <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full">
                                        {pageStrokes.map((stroke) => (
                                            <polyline
                                                key={stroke.id}
                                                fill="none"
                                                points={buildStrokePath(stroke.points, pageImage)}
                                                stroke={stroke.color}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={stroke.width}
                                                strokeOpacity={1}
                                            />
                                        ))}
                                        {currentDraftStroke && (
                                            <polyline
                                                fill="none"
                                                points={buildStrokePath(currentDraftStroke.points, pageImage)}
                                                stroke={currentDraftStroke.color}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={currentDraftStroke.width}
                                                strokeOpacity={1}
                                            />
                                        )}
                                    </svg>
                                )}

                            {pageTextNotes.map((note) => (
                                <div
                                    key={note.id}
                                    data-annotation-note="true"
                                    className={`absolute z-[12] overflow-hidden rounded-xl border shadow-lg ${
                                        activeTextNoteId === note.id
                                            ? 'border-blue-400 bg-white'
                                            : 'border-amber-200 bg-white/95'
                                    }`}
                                    style={{
                                        left: toPercent(note.leftRatio),
                                        top: toPercent(note.topRatio),
                                        width: toPercent(note.widthRatio),
                                        height: toPercent(note.heightRatio),
                                    }}
                                    onClick={() => setActiveTextNoteId(note.id)}
                                >
                                    <div className="flex items-center justify-between border-b border-slate-200 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                                        <span>텍스트</span>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setTextNotes((prev) => prev.filter((item) => item.id !== note.id));
                                                if (activeTextNoteId === note.id) setActiveTextNoteId(null);
                                            }}
                                            className="text-slate-400 transition hover:text-red-500"
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                    <textarea
                                        value={note.text}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTextNotes((prev) => prev.map((item) => (
                                                item.id === note.id ? { ...item, text: value } : item
                                            )));
                                        }}
                                        className="h-[calc(100%-22px)] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-[11px] leading-4 text-slate-700 outline-none"
                                        placeholder="메모"
                                    />
                                </div>
                            ))}

                            {mode === 'teacher' && pageBlanks.map((blank) => {
                                const maskedRegions = getMatchedRegions(
                                    pageImage,
                                    pageRegions,
                                    blank,
                                    FINAL_REGION_INTERSECTION_RATIO,
                                );
                                const renderRegions = blank.source !== 'manual' && maskedRegions.length
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
                                        onPointerDown={(event) => {
                                            if (event.button === 2) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onDeleteBlank?.(blank.id);
                                            }
                                        }}
                                        onContextMenu={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            onDeleteBlank?.(blank.id);
                                        }}
                                        aria-label="빈칸 선택"
                                        className={`absolute z-10 border-0 p-0 ${
                                            selectedBlankId === blank.id
                                                ? 'bg-sky-300/42 mix-blend-multiply'
                                                : 'bg-sky-300/30 mix-blend-multiply'
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
                                const renderRect = getStudentBlankRect(blank, pageImage, pageRegions);
                                const pixelWidth = renderRect.widthRatio * pageImage.width;
                                const pixelHeight = renderRect.heightRatio * pageImage.height;
                                const placeholder = blank.prompt || EMPTY_BLANK_LABEL;
                                const activeValue = (studentAnswer?.value || '').trim();
                                const sizingText = activeValue || placeholder || blank.answer || EMPTY_BLANK_LABEL;
                                const fontSize = getStudentBlankFontSize(pixelWidth, pixelHeight, sizingText.length);
                                const horizontalPadding = pixelWidth < 52 ? 1 : pixelWidth < 80 ? 1.5 : 2;
                                const verticalPadding = pixelHeight < 24 ? 0.5 : 1;

                                return (
                                    <div
                                        key={blank.id}
                                        data-blank-box="true"
                                        className={`absolute overflow-hidden rounded-md border shadow-sm ${
                                            status === 'correct'
                                                ? 'border-emerald-500 bg-emerald-50/98'
                                                : status === 'wrong'
                                                    ? 'border-rose-500 bg-rose-50'
                                                    : 'border-slate-200 bg-white'
                                        }`}
                                        style={{
                                            left: toPercent(renderRect.leftRatio),
                                            top: toPercent(renderRect.topRatio),
                                            width: toPercent(renderRect.widthRatio),
                                            height: toPercent(renderRect.heightRatio),
                                            zIndex: 18,
                                        }}
                                    >
                                        <input
                                            type="text"
                                            value={studentAnswer?.value || ''}
                                            data-blank-id={blank.id}
                                            data-answer={blank.answer}
                                            className={`worksheet-blank-input relative z-10 block h-full w-full border-0 text-center font-bold outline-none ${
                                                status === 'correct'
                                                    ? 'bg-emerald-50 text-emerald-700'
                                                    : status === 'wrong'
                                                        ? 'bg-rose-50 text-rose-700'
                                                        : 'bg-white text-blue-700'
                                            }`}
                                            placeholder={placeholder}
                                            onChange={(event) => onStudentAnswerChange?.(blank.id, event.target.value, blank.answer)}
                                            style={{
                                                fontSize: `${fontSize}px`,
                                                lineHeight: 1,
                                                letterSpacing: '-0.02em',
                                                paddingLeft: `${horizontalPadding}px`,
                                                paddingRight: `${horizontalPadding}px`,
                                                paddingTop: `${verticalPadding}px`,
                                                paddingBottom: `${verticalPadding}px`,
                                                boxSizing: 'border-box',
                                            }}
                                        />
                                        {!!activeValue && (
                                            <div className={`pointer-events-none absolute right-1 top-1 z-20 rounded-full px-1.5 py-[1px] text-[9px] font-black ${
                                                status === 'correct'
                                                    ? 'bg-emerald-500 text-white'
                                                    : status === 'wrong'
                                                        ? 'bg-rose-500 text-white'
                                                        : 'hidden'
                                            }`}>
                                                {status === 'correct' ? '정답' : status === 'wrong' ? '오답' : ''}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {mode === 'teacher' && pagePendingBlank && (
                                <>
                                    {(pagePendingBlank.source !== 'manual' && getMatchedRegions(pageImage, pageRegions, pagePendingBlank, FINAL_REGION_INTERSECTION_RATIO).length
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
                                            className="pointer-events-none absolute z-20 bg-sky-400/40"
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

                            {mode === 'teacher' && draftRegions.map((region, index) => {
                                const bounds = getTightTextRegionBounds(region, pageImage);
                                if (!bounds) return null;
                                return (
                                    <div
                                        key={`draft-${pageImage.page}-${index}`}
                                        className="pointer-events-none absolute z-30 bg-sky-500/42"
                                        style={{
                                            left: toPercent(bounds.leftRatio),
                                            top: toPercent(bounds.topRatio),
                                            width: toPercent(bounds.widthRatio),
                                            height: toPercent(bounds.heightRatio),
                                        }}
                                    />
                                );
                            })}

                                {showDraftRect && liveDraft && (
                                    <div
                                        className="pointer-events-none absolute z-30 bg-sky-500/38"
                                        style={{
                                            left: toPercent(liveDraft.leftRatio),
                                            top: toPercent(liveDraft.topRatio),
                                            width: toPercent(liveDraft.widthRatio),
                                            height: toPercent(liveDraft.heightRatio),
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    </section>
                );
            })}
        </div>
    );
};

export default LessonWorksheetStage;
