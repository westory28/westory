import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
type StudentTool = 'move' | 'pen' | 'highlighter' | 'rectangle' | 'eraser' | 'text';
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
    annotationUiMode?: 'always' | 'onDemand';
    annotationState?: LessonWorksheetAnnotationState;
    onAnnotationChange?: (nextState: LessonWorksheetAnnotationState) => void;
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
    straight?: boolean;
}

interface AnnotationBox {
    id: string;
    page: number;
    color: string;
    width: number;
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
}

interface AnnotationTextNote {
    id: string;
    page: number;
    leftRatio: number;
    topRatio: number;
    widthRatio: number;
    heightRatio: number;
    text: string;
    fontSize?: number;
}

interface TextNoteTransformState {
    noteId: string;
    page: number;
    mode: 'move' | 'resize';
    startClientX: number;
    startClientY: number;
    initialLeftRatio: number;
    initialTopRatio: number;
    initialWidthRatio: number;
    initialHeightRatio: number;
}

interface PinchState {
    startDistance: number;
    startZoom: number;
}

interface PanState {
    page: number;
    startClientX: number;
    startClientY: number;
    startScrollLeft: number;
    startScrollTop: number;
}

interface PressHoldState {
    timeoutId: number | null;
    page: number | null;
}

interface AnnotationSnapshot {
    strokes: AnnotationStroke[];
    boxes: AnnotationBox[];
    textNotes: AnnotationTextNote[];
}

export interface LessonWorksheetAnnotationState {
    strokes: AnnotationStroke[];
    boxes: AnnotationBox[];
    textNotes: AnnotationTextNote[];
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
const RECTANGLE_CURSOR = 'crosshair';
const STRAIGHT_LINE_HOLD_MS = 650;
const STRAIGHT_LINE_MOVE_THRESHOLD = 0.002;
const EMPTY_ANNOTATION_STATE: LessonWorksheetAnnotationState = { strokes: [], boxes: [], textNotes: [] };

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
    const widthBased = Math.max(1, pixelWidth - 6) / Math.max(1.2, safeLength * 1.05);
    const heightBased = Math.max(1, pixelHeight - 4) * 0.72;
    return Math.max(5.5, Math.min(18, widthBased, heightBased));
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

const createTextNote = (page: number, point: RatioPoint, fontSize = 20): AnnotationTextNote => ({
    id: `note-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    leftRatio: Math.min(0.82, point.x),
    topRatio: Math.min(0.9, point.y),
    widthRatio: 0.22,
    heightRatio: 0.06,
    text: '',
    fontSize,
});

const createBox = (page: number, point: RatioPoint, color: string): AnnotationBox => ({
    id: `box-${page}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    color,
    width: 3,
    leftRatio: point.x,
    topRatio: point.y,
    widthRatio: 0,
    heightRatio: 0,
});

const getAnnotationStateKey = (state: LessonWorksheetAnnotationState) => JSON.stringify(state);

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
    annotationUiMode = 'always',
    annotationState,
    onAnnotationChange,
}) => {
    const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const [draftRect, setDraftRect] = useState<DraftRect | null>(null);
    const [activeTeacherPage, setActiveTeacherPage] = useState<number | null>(pageImages[0]?.page ?? null);
    const [activeStudentPage, setActiveStudentPage] = useState<number | null>(pageImages[0]?.page ?? null);
    const [annotationTool, setAnnotationTool] = useState<StudentTool>('move');
    const [penColorKey, setPenColorKey] = useState<DrawingColor>('blue');
    const [highlighterColorKey, setHighlighterColorKey] = useState<DrawingColor>('yellow');
    const [studentZoom, setStudentZoom] = useState(1);
    const [toolbarVisible, setToolbarVisible] = useState(annotationUiMode === 'always');
    const [toolbarSubmenu, setToolbarSubmenu] = useState<'colors' | 'text' | null>(null);
    const [isMobileViewport, setIsMobileViewport] = useState(false);
    const [isMobileToolMenuOpen, setIsMobileToolMenuOpen] = useState(false);
    const [textFontSize, setTextFontSize] = useState(20);
    const [strokes, setStrokes] = useState<AnnotationStroke[]>(annotationState?.strokes || []);
    const [draftStroke, setDraftStroke] = useState<AnnotationStroke | null>(null);
    const [boxes, setBoxes] = useState<AnnotationBox[]>(annotationState?.boxes || []);
    const [draftBox, setDraftBox] = useState<AnnotationBox | null>(null);
    const [textNotes, setTextNotes] = useState<AnnotationTextNote[]>(annotationState?.textNotes || []);
    const [activeTextNoteId, setActiveTextNoteId] = useState<string | null>(null);
    const [editingTextNoteId, setEditingTextNoteId] = useState<string | null>(null);
    const [textNoteTransform, setTextNoteTransform] = useState<TextNoteTransformState | null>(null);
    const [undoStack, setUndoStack] = useState<AnnotationSnapshot[]>([]);
    const [redoStack, setRedoStack] = useState<AnnotationSnapshot[]>([]);
    const pinchRef = useRef<PinchState | null>(null);
    const panRef = useRef<PanState | null>(null);
    const scrollHostRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const holdRef = useRef<PressHoldState>({ timeoutId: null, page: null });
    const externalAnnotationKeyRef = useRef(getAnnotationStateKey(annotationState || EMPTY_ANNOTATION_STATE));

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

    useEffect(() => {
        setToolbarVisible(annotationUiMode === 'always');
    }, [annotationUiMode]);

    useEffect(() => {
        const updateViewportMode = () => setIsMobileViewport(window.innerWidth < 768);
        updateViewportMode();
        window.addEventListener('resize', updateViewportMode);
        return () => window.removeEventListener('resize', updateViewportMode);
    }, []);

    useEffect(() => {
        if (!isMobileViewport) {
            setIsMobileToolMenuOpen(false);
        }
    }, [isMobileViewport]);

    useEffect(() => {
        if (annotationTool !== 'text') {
            setEditingTextNoteId(null);
        }
    }, [annotationTool]);

    useEffect(() => {
        if (annotationTool === 'pen' || annotationTool === 'highlighter' || annotationTool === 'rectangle') {
            setToolbarSubmenu('colors');
            return;
        }
        if (annotationTool === 'text') {
            setToolbarSubmenu('text');
            return;
        }
        setToolbarSubmenu(null);
    }, [annotationTool]);

    useEffect(() => {
        if (!annotationState) return;
        const incomingKey = getAnnotationStateKey(annotationState);
        if (incomingKey === externalAnnotationKeyRef.current) return;
        externalAnnotationKeyRef.current = incomingKey;
        setStrokes(annotationState.strokes || []);
        setBoxes(annotationState.boxes || []);
        setTextNotes(annotationState.textNotes || []);
    }, [annotationState]);

    useEffect(() => {
        externalAnnotationKeyRef.current = getAnnotationStateKey({
            strokes,
            boxes,
            textNotes,
        });
        onAnnotationChange?.({
            strokes,
            boxes,
            textNotes,
        });
    }, [boxes, onAnnotationChange, strokes, textNotes]);

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
        setEditingTextNoteId(null);
        setTextNoteTransform(null);
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
            pushUndoSnapshot();
            setTextNotes((prev) => prev.filter((note) => note.id !== noteHit.id));
            if (activeTextNoteId === noteHit.id) setActiveTextNoteId(null);
            return;
        }

        const threshold = Math.max(0.012, 22 / Math.max(pageImage.width, 1));
        const hitBox = boxes.find((box) => (
            box.page === page
            && point.x >= box.leftRatio
            && point.x <= box.leftRatio + box.widthRatio
            && point.y >= box.topRatio
            && point.y <= box.topRatio + box.heightRatio
        ));
        if (hitBox) {
            pushUndoSnapshot();
            setBoxes((prev) => prev.filter((box) => box.id !== hitBox.id));
            return;
        }
        const hitStroke = strokes.find((stroke) => (
            stroke.page === page
            && stroke.points.some((strokePoint) => Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= threshold)
        ));
        if (hitStroke) {
            pushUndoSnapshot();
            setStrokes((prev) => prev.filter((stroke) => stroke.id !== hitStroke.id));
        }
    };

    const selectedPenColor = TOOL_COLORS.find((color) => color.key === penColorKey) || TOOL_COLORS[0];
    const selectedHighlighterColor = TOOL_COLORS.find((color) => color.key === highlighterColorKey) || TOOL_COLORS[3];
    const zoomPercent = Math.round(studentZoom * 100);
    const toolEntries: Array<[StudentTool | 'undo' | 'redo', string, string]> = [
        ['move', '이동', 'fa-up-down-left-right'],
        ['undo', '이전', 'fa-arrow-rotate-left'],
        ['redo', '다음', 'fa-arrow-rotate-right'],
        ['pen', '펜', 'fa-pen'],
        ['highlighter', '형광펜', 'fa-highlighter'],
        ['rectangle', '네모', 'fa-square'],
        ['eraser', '지우개', 'fa-eraser'],
        ['text', '텍스트', 'fa-font'],
    ];
    const stageCursor = mode === 'student' && annotationEnabled
        ? annotationTool === 'move'
            ? MOVE_CURSOR
            : annotationTool === 'eraser'
            ? ERASER_CURSOR
            : annotationTool === 'text'
                ? 'text'
                : annotationTool === 'rectangle'
                    ? RECTANGLE_CURSOR
                : annotationTool === 'highlighter'
                    ? HIGHLIGHTER_CURSOR
                    : PEN_CURSOR
        : undefined;

    const applyStudentZoom = (nextZoom: number) => {
        setStudentZoom(clampZoom(nextZoom));
    };

    const beginMovePan = (page: number, clientX: number, clientY: number) => {
        const host = scrollHostRefs.current[page];
        if (!host) return;
        panRef.current = {
            page,
            startClientX: clientX,
            startClientY: clientY,
            startScrollLeft: host.scrollLeft,
            startScrollTop: host.scrollTop,
        };
    };

    const autoSizeTextNote = (noteId: string, page: number, textarea: HTMLTextAreaElement) => {
        const host = pageRefs.current[page];
        if (!host) return;
        textarea.style.height = '0px';
        const nextHeightRatio = clampRatio((textarea.scrollHeight + 6) / host.clientHeight);
        textarea.style.height = '';
        setTextNotes((prev) => prev.map((item) => (
            item.id === noteId
                ? {
                    ...item,
                    heightRatio: Math.max(0.04, nextHeightRatio),
                }
                : item
        )));
    };

    const applyTextFontSize = (nextFontSize: number) => {
        const clamped = Math.max(12, Math.min(40, nextFontSize));
        setTextFontSize(clamped);
        if (!activeTextNoteId) return;
        setTextNotes((prev) => prev.map((note) => (
            note.id === activeTextNoteId ? { ...note, fontSize: clamped } : note
        )));
    };

    const handleToolSelect = (tool: StudentTool | 'undo' | 'redo') => {
        if (tool === 'undo') {
            setUndoStack((prev) => {
                const snapshot = prev[prev.length - 1];
                if (!snapshot) return prev;
                setRedoStack((redoPrev) => [...redoPrev, captureSnapshot()]);
                restoreSnapshot(snapshot);
                return prev.slice(0, -1);
            });
            return;
        }
        if (tool === 'redo') {
            setRedoStack((prev) => {
                const snapshot = prev[prev.length - 1];
                if (!snapshot) return prev;
                setUndoStack((undoPrev) => [...undoPrev, captureSnapshot()]);
                restoreSnapshot(snapshot);
                return prev.slice(0, -1);
            });
            return;
        }
        setAnnotationTool(tool);
        if (tool === 'pen' || tool === 'highlighter' || tool === 'rectangle') {
            setToolbarSubmenu((prev) => (annotationTool === tool && prev === 'colors' ? null : 'colors'));
            return;
        }
        if (tool === 'text') {
            setToolbarSubmenu((prev) => (annotationTool === tool && prev === 'text' ? null : 'text'));
            return;
        }
        setToolbarSubmenu(null);
    };

    const captureSnapshot = (): AnnotationSnapshot => ({
        strokes: strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })),
        boxes: boxes.map((box) => ({ ...box })),
        textNotes: textNotes.map((note) => ({ ...note })),
    });

    const restoreSnapshot = (snapshot: AnnotationSnapshot) => {
        setStrokes(snapshot.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })));
        setBoxes(snapshot.boxes.map((box) => ({ ...box })));
        setTextNotes(snapshot.textNotes.map((note) => ({ ...note })));
        setActiveTextNoteId(null);
    };

    const pushUndoSnapshot = () => {
        setUndoStack((prev) => [...prev, captureSnapshot()]);
        setRedoStack([]);
    };

    const clearHoldTimer = () => {
        if (holdRef.current.timeoutId) {
            window.clearTimeout(holdRef.current.timeoutId);
            holdRef.current.timeoutId = null;
        }
        holdRef.current.page = null;
    };

    const armStraightLineTimer = (page: number) => {
        clearHoldTimer();
        holdRef.current.page = page;
        holdRef.current.timeoutId = window.setTimeout(() => {
            setDraftStroke((prev) => {
                if (!prev || prev.page !== page || prev.points.length < 2) return prev;
                const lastPoint = prev.points[prev.points.length - 1];
                return { ...prev, straight: true, points: [prev.points[0], lastPoint] };
            });
        }, STRAIGHT_LINE_HOLD_MS);
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
        if (annotationUiMode === 'onDemand' && !toolbarVisible) {
            setToolbarVisible(true);
            return;
        }
        setToolbarSubmenu(null);
        const target = event.target as HTMLElement;
        if (target.closest('[data-blank-box]') || target.closest('[data-annotation-note]')) return;
        if (activeTextNoteId && annotationTool === 'text') {
            event.preventDefault();
            if (editingTextNoteId === activeTextNoteId) {
                setEditingTextNoteId(null);
                return;
            }
        }
        if (annotationTool === 'move') {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            beginMovePan(page, event.clientX, event.clientY);
            return;
        }
        const point = resolveRatioPoint(page, event.clientX, event.clientY);
        const pageImage = pageImages.find((item) => item.page === page);
        if (!point || !pageImage) return;

        event.preventDefault();
        if (annotationTool === 'text') {
            pushUndoSnapshot();
            const nextNote = createTextNote(page, point, textFontSize);
            setTextNotes((prev) => [...prev, nextNote]);
            setActiveTextNoteId(nextNote.id);
            setEditingTextNoteId(nextNote.id);
            return;
        }
        if (annotationTool === 'eraser') {
            eraseAnnotationAtPoint(page, point, pageImage);
            return;
        }
        if (annotationTool === 'rectangle') {
            pushUndoSnapshot();
            event.currentTarget.setPointerCapture(event.pointerId);
            setDraftBox(createBox(page, point, selectedPenColor.pen));
            return;
        }

        pushUndoSnapshot();
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

        if (draftBox && draftBox.page === page) {
            const point = resolveRatioPoint(page, clientX, clientY);
            if (!point) return;
            setDraftBox((prev) => {
                if (!prev) return null;
                const left = Math.min(prev.leftRatio, point.x);
                const top = Math.min(prev.topRatio, point.y);
                return {
                    ...prev,
                    leftRatio: left,
                    topRatio: top,
                    widthRatio: Math.abs(point.x - prev.leftRatio),
                    heightRatio: Math.abs(point.y - prev.topRatio),
                };
            });
            return;
        }

        if (!draftStroke || draftStroke.page !== page) return;
        const point = resolveRatioPoint(page, clientX, clientY);
        if (!point) return;
        setDraftStroke((prev) => {
            if (!prev) return null;
            const lastPoint = prev.points[prev.points.length - 1];
            if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < STRAIGHT_LINE_MOVE_THRESHOLD) return prev;
            if (!prev.straight) armStraightLineTimer(page);
            if (prev.straight) {
                return { ...prev, points: [prev.points[0], point] };
            }
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
        clearHoldTimer();
        setDraftStroke((prev) => {
            if (!prev) return null;
            const finalized = prev.points.length === 1
                ? { ...prev, points: [...prev.points, prev.points[0]] }
                : prev;
            setStrokes((existing) => [...existing, finalized]);
            return null;
        });
        setDraftBox((prev) => {
            if (!prev) return null;
            if (prev.widthRatio < 0.003 || prev.heightRatio < 0.003) return null;
            setBoxes((existing) => [...existing, prev]);
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

    useEffect(() => () => {
        clearHoldTimer();
    }, []);

    useEffect(() => {
        if (!panRef.current) return undefined;
        const handleWindowPointerMove = (event: PointerEvent) => {
            const currentPan = panRef.current;
            if (!currentPan) return;
            const host = scrollHostRefs.current[currentPan.page];
            if (!host) return;
            host.scrollLeft = currentPan.startScrollLeft - (event.clientX - currentPan.startClientX);
            host.scrollTop = currentPan.startScrollTop - (event.clientY - currentPan.startClientY);
        };
        const handleWindowPointerUp = () => {
            panRef.current = null;
        };
        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [annotationTool, studentZoom]);

    useEffect(() => {
        if (!textNoteTransform) return undefined;
        const handleWindowPointerMove = (event: PointerEvent) => {
            const host = pageRefs.current[textNoteTransform.page];
            if (!host) return;
            const width = Math.max(host.clientWidth, 1);
            const height = Math.max(host.clientHeight, 1);
            const deltaXRatio = (event.clientX - textNoteTransform.startClientX) / width;
            const deltaYRatio = (event.clientY - textNoteTransform.startClientY) / height;

            setTextNotes((prev) => prev.map((note) => {
                if (note.id !== textNoteTransform.noteId) return note;
                if (textNoteTransform.mode === 'move') {
                    return {
                        ...note,
                        leftRatio: clampRatio(Math.min(1 - note.widthRatio, textNoteTransform.initialLeftRatio + deltaXRatio)),
                        topRatio: clampRatio(Math.min(1 - note.heightRatio, textNoteTransform.initialTopRatio + deltaYRatio)),
                    };
                }
                return {
                    ...note,
                    widthRatio: Math.max(0.06, Math.min(1 - note.leftRatio, textNoteTransform.initialWidthRatio + deltaXRatio)),
                    heightRatio: Math.max(0.035, Math.min(1 - note.topRatio, textNoteTransform.initialHeightRatio + deltaYRatio)),
                };
            }));
        };
        const handleWindowPointerUp = () => {
            setTextNoteTransform(null);
        };
        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [textNoteTransform]);

    const renderToolbarSubmenu = () => (
        <>
            {toolbarSubmenu === 'colors' && (annotationTool === 'pen' || annotationTool === 'highlighter' || annotationTool === 'rectangle') && (
                <div className="flex w-fit max-w-[min(90vw,720px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                    {TOOL_COLORS.map((color) => {
                        const usesPenPalette = annotationTool === 'pen' || annotationTool === 'rectangle';
                        const selected = usesPenPalette ? penColorKey === color.key : highlighterColorKey === color.key;
                        return (
                            <button
                                key={`submenu-${annotationTool}-${color.key}`}
                                type="button"
                                aria-label={`${usesPenPalette ? (annotationTool === 'rectangle' ? '네모' : '펜') : '형광펜'} ${color.label}`}
                                onClick={() => {
                                    if (usesPenPalette) setPenColorKey(color.key);
                                    else setHighlighterColorKey(color.key);
                                }}
                                className={`h-9 w-9 rounded-full border-2 transition ${selected ? 'scale-110 border-slate-900' : 'border-white/80 hover:scale-105'}`}
                                style={{ background: usesPenPalette ? color.pen : color.highlighter }}
                            />
                        );
                    })}
                </div>
            )}
            {toolbarSubmenu === 'text' && annotationTool === 'text' && (
                <div className="flex w-fit max-w-[min(90vw,720px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                    <button
                        type="button"
                        onClick={() => applyTextFontSize(textFontSize - 2)}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-50"
                        aria-label="글자 작게"
                    >
                        <i className="fas fa-minus text-xs"></i>
                    </button>
                    {[14, 18, 24, 32].map((size) => (
                        <button
                            key={size}
                            type="button"
                            onClick={() => applyTextFontSize(size)}
                            className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
                                textFontSize === size ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            {size}px
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => applyTextFontSize(textFontSize + 2)}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-50"
                        aria-label="글자 크게"
                    >
                        <i className="fas fa-plus text-xs"></i>
                    </button>
                </div>
            )}
        </>
    );

    const mobileToolbarFloating = mode === 'student' && annotationEnabled && toolbarVisible && isMobileViewport ? (
        <div
            className="pointer-events-none fixed inset-x-0 z-[95] flex justify-end md:hidden"
            style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
            <div className="pointer-events-auto mr-4 flex flex-col items-end gap-3">
                {toolbarSubmenu && isMobileToolMenuOpen && (
                    <div className="max-w-[calc(100vw-2.5rem)]">{renderToolbarSubmenu()}</div>
                )}
                {isMobileToolMenuOpen && (
                    <div className="flex flex-col items-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                pushUndoSnapshot();
                                setStrokes([]);
                                setBoxes([]);
                                setTextNotes([]);
                                setActiveTextNoteId(null);
                                setToolbarSubmenu(null);
                                setIsMobileToolMenuOpen(false);
                            }}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg shadow-slate-300/30 transition hover:bg-slate-50"
                            aria-label="전체 지우기"
                        >
                            <i className="fas fa-trash-alt text-sm"></i>
                        </button>
                        <div className="flex flex-col items-center gap-2 rounded-3xl border border-blue-100 bg-white/96 px-2 py-3 shadow-[0_18px_48px_rgba(37,99,235,0.16)] backdrop-blur-xl">
                            {toolEntries.map(([tool, label, icon]) => (
                                <button
                                    key={`mobile-${tool}`}
                                    type="button"
                                    aria-label={label}
                                    title={label}
                                    onClick={() => handleToolSelect(tool)}
                                    disabled={(tool === 'undo' && undoStack.length === 0) || (tool === 'redo' && redoStack.length === 0)}
                                    className={`inline-flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold transition ${
                                        annotationTool === tool
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                                    }`}
                                >
                                    <i className={`fas ${icon} text-sm`}></i>
                                </button>
                            ))}
                            <div className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 py-2 shadow-sm">
                                <button
                                    type="button"
                                    onClick={() => applyStudentZoom(studentZoom + 0.1)}
                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 transition hover:bg-slate-50"
                                    aria-label="확대"
                                >
                                    <i className="fas fa-plus text-xs"></i>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => applyStudentZoom(1)}
                                    className="min-w-[52px] rounded-full bg-slate-50 px-2 py-1 text-center text-xs font-bold text-slate-700 transition hover:bg-slate-100"
                                >
                                    {zoomPercent}%
                                </button>
                                <button
                                    type="button"
                                    onClick={() => applyStudentZoom(studentZoom - 0.1)}
                                    className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 transition hover:bg-slate-50"
                                    aria-label="축소"
                                >
                                    <i className="fas fa-minus text-xs"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <button
                    type="button"
                    onClick={() => setIsMobileToolMenuOpen((prev) => !prev)}
                    className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_18px_48px_rgba(37,99,235,0.32)] transition hover:bg-blue-700"
                    aria-label="도구 모음 열기"
                >
                    <i className={`fas ${isMobileToolMenuOpen ? 'fa-xmark' : 'fa-wand-magic-sparkles'} text-lg`}></i>
                </button>
            </div>
        </div>
    ) : null;

    return (
        <>
        <div className="space-y-6">
            {mode === 'student' && annotationEnabled && toolbarVisible && (
                <>
                    <div className="sticky top-3 z-40 hidden flex-col items-center gap-2 md:flex">
                    <div className="inline-flex max-w-[min(96vw,1180px)] flex-nowrap items-center justify-center gap-2 overflow-x-auto rounded-full border border-blue-100 bg-white/92 px-3 py-3 shadow-[0_18px_48px_rgba(37,99,235,0.16)] backdrop-blur-xl md:px-4">
                        {[
                            ['move', '이동', 'fa-up-down-left-right'],
                            ['undo', '이전', 'fa-arrow-rotate-left'],
                            ['redo', '다음', 'fa-arrow-rotate-right'],
                            ['pen', '펜', 'fa-pen'],
                            ['highlighter', '형광펜', 'fa-highlighter'],
                            ['rectangle', '네모', 'fa-square'],
                            ['eraser', '지우개', 'fa-eraser'],
                            ['text', '텍스트', 'fa-font'],
                        ].map(([tool, label, icon]) => (
                            <button
                                key={tool}
                                type="button"
                                aria-label={label}
                                title={label}
                                onClick={() => {
                                    if (tool === 'undo') {
                                        setUndoStack((prev) => {
                                            const snapshot = prev[prev.length - 1];
                                            if (!snapshot) return prev;
                                            setRedoStack((redoPrev) => [...redoPrev, captureSnapshot()]);
                                            restoreSnapshot(snapshot);
                                            return prev.slice(0, -1);
                                        });
                                        return;
                                    }
                                    if (tool === 'redo') {
                                        setRedoStack((prev) => {
                                            const snapshot = prev[prev.length - 1];
                                            if (!snapshot) return prev;
                                            setUndoStack((undoPrev) => [...undoPrev, captureSnapshot()]);
                                            restoreSnapshot(snapshot);
                                            return prev.slice(0, -1);
                                        });
                                        return;
                                    }
                                    const nextTool = tool as StudentTool;
                                    setAnnotationTool(nextTool);
                                    if (nextTool === 'pen' || nextTool === 'highlighter' || nextTool === 'rectangle') {
                                        setToolbarSubmenu((prev) => (annotationTool === nextTool && prev === 'colors' ? null : 'colors'));
                                        return;
                                    }
                                    if (nextTool === 'text') {
                                        setToolbarSubmenu((prev) => (annotationTool === nextTool && prev === 'text' ? null : 'text'));
                                        return;
                                    }
                                    setToolbarSubmenu(null);
                                }}
                                disabled={(tool === 'undo' && undoStack.length === 0) || (tool === 'redo' && redoStack.length === 0)}
                                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition ${
                                    annotationTool === tool
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
                                }`}
                            >
                                <i className={`fas ${icon} text-xs`}></i>
                            </button>
                        ))}
                        {(annotationTool === 'pen' || annotationTool === 'highlighter' || annotationTool === 'rectangle') && (
                            <div className="hidden shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
                                {TOOL_COLORS.map((color) => {
                                    const usesPenPalette = annotationTool === 'pen' || annotationTool === 'rectangle';
                                    const selected = usesPenPalette ? penColorKey === color.key : highlighterColorKey === color.key;
                                    return (
                                        <button
                                            key={`${annotationTool}-${color.key}`}
                                            type="button"
                                            aria-label={`${usesPenPalette ? (annotationTool === 'rectangle' ? '네모' : '펜') : '형광펜'} ${color.label}`}
                                            onClick={() => {
                                                if (usesPenPalette) setPenColorKey(color.key);
                                                else setHighlighterColorKey(color.key);
                                            }}
                                            className={`h-7 w-7 rounded-full border-2 transition ${selected ? 'border-slate-900 scale-110' : 'border-white/80 hover:scale-105'}`}
                                            style={{ background: usesPenPalette ? color.pen : color.highlighter }}
                                        />
                                    );
                                })}
                            </div>
                        )}
                        <div className="flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-sm">
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
                                pushUndoSnapshot();
                                setStrokes([]);
                                setBoxes([]);
                                setTextNotes([]);
                                setActiveTextNoteId(null);
                                setToolbarSubmenu(null);
                            }}
                            aria-label="Clear all annotations"
                            title="Clear all annotations"
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[0px] font-semibold leading-none text-slate-600 transition hover:bg-slate-50"
                        >
                            <i className="fas fa-trash-alt text-xs"></i>
                        </button>
                    </div>
                    {toolbarSubmenu === 'colors' && (annotationTool === 'pen' || annotationTool === 'highlighter' || annotationTool === 'rectangle') && (
                        <div className="flex w-fit max-w-[min(90vw,720px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                            {TOOL_COLORS.map((color) => {
                                const usesPenPalette = annotationTool === 'pen' || annotationTool === 'rectangle';
                                const selected = usesPenPalette ? penColorKey === color.key : highlighterColorKey === color.key;
                                return (
                                    <button
                                        key={`submenu-${annotationTool}-${color.key}`}
                                        type="button"
                                        aria-label={`${usesPenPalette ? (annotationTool === 'rectangle' ? '네모' : '펜') : '형광펜'} ${color.label}`}
                                        onClick={() => {
                                            if (usesPenPalette) setPenColorKey(color.key);
                                            else setHighlighterColorKey(color.key);
                                        }}
                                        className={`h-9 w-9 rounded-full border-2 transition ${selected ? 'scale-110 border-slate-900' : 'border-white/80 hover:scale-105'}`}
                                        style={{ background: usesPenPalette ? color.pen : color.highlighter }}
                                    />
                                );
                            })}
                        </div>
                    )}
                    {toolbarSubmenu === 'text' && annotationTool === 'text' && (
                        <div className="flex w-fit max-w-[min(90vw,720px)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                            <button
                                type="button"
                                onClick={() => applyTextFontSize(textFontSize - 2)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-50"
                                aria-label="폰트 작게"
                            >
                                <i className="fas fa-minus text-xs"></i>
                            </button>
                            {[14, 18, 24, 32].map((size) => (
                                <button
                                    key={size}
                                    type="button"
                                    onClick={() => applyTextFontSize(size)}
                                    className={`rounded-full px-3 py-1.5 text-sm font-bold transition ${
                                        textFontSize === size ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                >
                                    {size}px
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => applyTextFontSize(textFontSize + 2)}
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-700 transition hover:bg-slate-50"
                                aria-label="폰트 크게"
                            >
                                <i className="fas fa-plus text-xs"></i>
                            </button>
                        </div>
                    )}
                </div>
                </>
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
                    && (liveDraft.widthRatio > 0.0001 || liveDraft.heightRatio > 0.0001),
                );

                const pageStrokes = strokes.filter((stroke) => stroke.page === pageImage.page);
                const pageBoxes = boxes.filter((box) => box.page === pageImage.page);
                const pageTextNotes = textNotes.filter((note) => note.page === pageImage.page);
                const currentDraftStroke = draftStroke?.page === pageImage.page ? draftStroke : null;
                const currentDraftBox = draftBox?.page === pageImage.page ? draftBox : null;

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
                            ref={(node) => {
                                scrollHostRefs.current[pageImage.page] = node;
                            }}
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
                                            ? `${annotationTool === 'move' ? (panRef.current?.page === pageImage.page ? 'cursor-grabbing' : 'cursor-grab') : `touch-none ${annotationTool === 'eraser' ? 'cursor-not-allowed' : annotationTool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}`
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
                                    clearHoldTimer();
                                    setDraftRect(null);
                                    setDraftStroke(null);
                                    setDraftBox(null);
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
                                <svg
                                    className="pointer-events-none absolute inset-0 z-[5] h-full w-full"
                                    viewBox={`0 0 ${pageImage.width} ${pageImage.height}`}
                                    preserveAspectRatio="none"
                                >
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

                            {(pageBoxes.length > 0 || currentDraftBox) && (
                                <svg
                                    className="pointer-events-none absolute inset-0 z-[6] h-full w-full"
                                    viewBox={`0 0 ${pageImage.width} ${pageImage.height}`}
                                    preserveAspectRatio="none"
                                >
                                    {pageBoxes.map((box) => (
                                        <rect
                                            key={box.id}
                                            x={box.leftRatio * pageImage.width}
                                            y={box.topRatio * pageImage.height}
                                            width={box.widthRatio * pageImage.width}
                                            height={box.heightRatio * pageImage.height}
                                            fill="none"
                                            stroke={box.color}
                                            strokeWidth={box.width}
                                            rx="4"
                                        />
                                    ))}
                                    {currentDraftBox && (
                                        <rect
                                            x={currentDraftBox.leftRatio * pageImage.width}
                                            y={currentDraftBox.topRatio * pageImage.height}
                                            width={currentDraftBox.widthRatio * pageImage.width}
                                            height={currentDraftBox.heightRatio * pageImage.height}
                                            fill="none"
                                            stroke={currentDraftBox.color}
                                            strokeWidth={currentDraftBox.width}
                                            strokeDasharray="8 4"
                                            rx="4"
                                        />
                                    )}
                                </svg>
                            )}

                            {pageTextNotes.map((note) => (
                                <div
                                    key={note.id}
                                    data-annotation-note="true"
                                    className="absolute z-[12] rounded-md"
                                    style={{
                                        left: toPercent(note.leftRatio),
                                        top: toPercent(note.topRatio),
                                        width: toPercent(note.widthRatio),
                                        height: toPercent(note.heightRatio),
                                    }}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setActiveTextNoteId(note.id);
                                    }}
                                    onPointerDown={(event) => {
                                        const target = event.target as HTMLElement;
                                        event.stopPropagation();
                                        setToolbarSubmenu(null);
                                        setActiveTextNoteId(note.id);
                                        setTextFontSize(note.fontSize || 20);
                                        if (target.closest('[data-note-delete]')) return;
                                        if (target.closest('[data-note-resize]')) {
                                            event.preventDefault();
                                            pushUndoSnapshot();
                                            setEditingTextNoteId(null);
                                            setTextNoteTransform({
                                                noteId: note.id,
                                                page: note.page,
                                                mode: 'resize',
                                                startClientX: event.clientX,
                                                startClientY: event.clientY,
                                                initialLeftRatio: note.leftRatio,
                                                initialTopRatio: note.topRatio,
                                                initialWidthRatio: note.widthRatio,
                                                initialHeightRatio: note.heightRatio,
                                            });
                                            return;
                                        }
                                        if (target.tagName === 'TEXTAREA' && editingTextNoteId === note.id) return;
                                        if (activeTextNoteId === note.id) {
                                            event.preventDefault();
                                            pushUndoSnapshot();
                                            setEditingTextNoteId(null);
                                            setTextNoteTransform({
                                                noteId: note.id,
                                                page: note.page,
                                                mode: 'move',
                                                startClientX: event.clientX,
                                                startClientY: event.clientY,
                                                initialLeftRatio: note.leftRatio,
                                                initialTopRatio: note.topRatio,
                                                initialWidthRatio: note.widthRatio,
                                                initialHeightRatio: note.heightRatio,
                                            });
                                        } else {
                                            setEditingTextNoteId(null);
                                        }
                                    }}
                                >
                                    <div className="hidden">
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
                                        readOnly={editingTextNoteId !== note.id}
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setActiveTextNoteId(note.id);
                                        }}
                                        onFocus={(event) => {
                                            setActiveTextNoteId(note.id);
                                            setEditingTextNoteId(note.id);
                                            autoSizeTextNote(note.id, note.page, event.currentTarget);
                                            setToolbarSubmenu(annotationTool === 'text' ? 'text' : null);
                                        }}
                                        onChange={(event) => {
                                            const value = event.target.value;
                                            setTextNotes((prev) => prev.map((item) => (
                                                item.id === note.id ? { ...item, text: value } : item
                                            )));
                                            autoSizeTextNote(note.id, note.page, event.currentTarget);
                                        }}
                                        className={`h-full w-full resize-none overflow-hidden border bg-transparent px-1.5 py-0.5 text-[11px] font-medium leading-4 text-slate-800 outline-none ${
                                            editingTextNoteId === note.id
                                                ? 'cursor-text border-blue-400'
                                                : textNoteTransform?.noteId === note.id
                                                    ? 'cursor-grabbing border-blue-400'
                                                    : activeTextNoteId === note.id
                                                        ? 'cursor-grab border-blue-400'
                                                        : 'cursor-text border-transparent'
                                        }`}
                                        placeholder="메모"
                                        style={{ fontSize: `${note.fontSize || textFontSize}px` }}
                                    />
                                    {activeTextNoteId === note.id && (
                                        <>
                                            <div className="pointer-events-none absolute inset-0 rounded-md border border-blue-400"></div>
                                            <button
                                                type="button"
                                                data-note-delete="true"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setTextNotes((prev) => prev.filter((item) => item.id !== note.id));
                                                    if (activeTextNoteId === note.id) setActiveTextNoteId(null);
                                                    if (editingTextNoteId === note.id) setEditingTextNoteId(null);
                                                    if (textNoteTransform?.noteId === note.id) setTextNoteTransform(null);
                                                }}
                                                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] text-slate-500 shadow-sm transition hover:text-red-500"
                                            >
                                                <i className="fas fa-times"></i>
                                            </button>
                                            <button
                                                type="button"
                                                data-note-resize="true"
                                                aria-label="Resize text box"
                                                className="absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-sm border border-blue-500 bg-white shadow-sm"
                                            />
                                        </>
                                    )}
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
                                const horizontalPadding = pixelWidth < 42 ? 0.2 : pixelWidth < 52 ? 0.5 : pixelWidth < 80 ? 1 : 1.5;
                                const verticalPadding = pixelHeight < 18 ? 0 : pixelHeight < 24 ? 0.2 : 0.5;

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
                                                letterSpacing: pixelWidth < 46 ? '-0.06em' : '-0.02em',
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
                                        className="pointer-events-none absolute z-30 border-2 border-sky-500 bg-sky-500/20"
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
        {typeof document !== 'undefined' && mobileToolbarFloating ? createPortal(mobileToolbarFloating, document.body) : null}
        </>
    );
};

export default LessonWorksheetStage;
