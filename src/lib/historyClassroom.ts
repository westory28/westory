import type { MapResource } from './mapResources';

export interface HistoryClassroomBlank {
    id: string;
    page: number;
    left: number;
    top: number;
    width: number;
    height: number;
    answer: string;
}

export interface HistoryClassroomAssignment {
    id: string;
    title: string;
    description: string;
    mapResourceId: string;
    mapTitle: string;
    pdfPageImages: MapResource['pdfPageImages'];
    blanks: HistoryClassroomBlank[];
    answerOptions: string[];
    cooldownMinutes: number;
    targetGrade: string;
    targetClass: string;
    targetStudentUid: string;
    targetStudentName: string;
    targetStudentNumber: string;
    isPublished: boolean;
    createdAt?: unknown;
    updatedAt?: unknown;
}

export interface HistoryClassroomResult {
    id: string;
    assignmentId: string;
    uid: string;
    studentName: string;
    answers: Record<string, string>;
    score: number;
    total: number;
    createdAt?: unknown;
}

export const normalizeHistoryClassroomAssignment = (
    id: string,
    raw: Partial<HistoryClassroomAssignment>,
): HistoryClassroomAssignment => ({
    id,
    title: String(raw.title || '').trim() || '역사교실',
    description: String(raw.description || '').trim(),
    mapResourceId: String(raw.mapResourceId || '').trim(),
    mapTitle: String(raw.mapTitle || '').trim(),
    pdfPageImages: Array.isArray(raw.pdfPageImages) ? raw.pdfPageImages : [],
    blanks: Array.isArray(raw.blanks)
        ? raw.blanks.map((blank) => ({
            id: String(blank?.id || '').trim() || `blank-${Date.now()}`,
            page: Number(blank?.page) || 1,
            left: Number(blank?.left) || 0,
            top: Number(blank?.top) || 0,
            width: Number(blank?.width) || 140,
            height: Number(blank?.height) || 52,
            answer: String(blank?.answer || '').trim(),
        }))
        : [],
    answerOptions: Array.isArray(raw.answerOptions)
        ? raw.answerOptions.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    cooldownMinutes: Number(raw.cooldownMinutes) || 0,
    targetGrade: String(raw.targetGrade || '').trim(),
    targetClass: String(raw.targetClass || '').trim(),
    targetStudentUid: String(raw.targetStudentUid || '').trim(),
    targetStudentName: String(raw.targetStudentName || '').trim(),
    targetStudentNumber: String(raw.targetStudentNumber || '').trim(),
    isPublished: raw.isPublished === true,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
});

export const buildAnswerOptions = (blanks: HistoryClassroomBlank[]) =>
    Array.from(new Set(blanks.map((blank) => blank.answer.trim()).filter(Boolean)));
