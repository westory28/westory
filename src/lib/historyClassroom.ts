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
    timeLimitMinutes: number;
    cooldownMinutes: number;
    passThresholdPercent: number;
    targetGrade: string;
    targetClass: string;
    targetStudentUid: string;
    targetStudentUids: string[];
    targetStudentName: string;
    targetStudentNames: string[];
    targetStudentNumber: string;
    isPublished: boolean;
    createdAt?: unknown;
    updatedAt?: unknown;
}

export type HistoryClassroomResultStatus = 'passed' | 'failed' | 'cancelled';

export interface HistoryClassroomResult {
    id: string;
    assignmentId: string;
    assignmentTitle?: string;
    uid: string;
    studentName: string;
    studentGrade?: string;
    studentClass?: string;
    studentNumber?: string;
    answers: Record<string, string>;
    score: number;
    total: number;
    percent: number;
    passThresholdPercent: number;
    passed: boolean;
    status: HistoryClassroomResultStatus;
    cancellationReason?: string;
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
    timeLimitMinutes: Math.max(0, Number(raw.timeLimitMinutes) || 0),
    cooldownMinutes: Number(raw.cooldownMinutes) || 0,
    passThresholdPercent: Math.min(100, Math.max(0, Number(raw.passThresholdPercent) || 80)),
    targetGrade: String(raw.targetGrade || '').trim(),
    targetClass: String(raw.targetClass || '').trim(),
    targetStudentUid: String(raw.targetStudentUid || '').trim(),
    targetStudentUids: Array.isArray(raw.targetStudentUids)
        ? raw.targetStudentUids.map((item) => String(item || '').trim()).filter(Boolean)
        : (String(raw.targetStudentUid || '').trim() ? [String(raw.targetStudentUid || '').trim()] : []),
    targetStudentName: String(raw.targetStudentName || '').trim(),
    targetStudentNames: Array.isArray(raw.targetStudentNames)
        ? raw.targetStudentNames.map((item) => String(item || '').trim()).filter(Boolean)
        : (String(raw.targetStudentName || '').trim() ? [String(raw.targetStudentName || '').trim()] : []),
    targetStudentNumber: String(raw.targetStudentNumber || '').trim(),
    isPublished: raw.isPublished === true,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
});

export const normalizeHistoryClassroomResult = (
    id: string,
    raw: Partial<HistoryClassroomResult>,
): HistoryClassroomResult => ({
    id,
    assignmentId: String(raw.assignmentId || '').trim(),
    assignmentTitle: String(raw.assignmentTitle || '').trim(),
    uid: String(raw.uid || '').trim(),
    studentName: String(raw.studentName || '').trim(),
    studentGrade: String(raw.studentGrade || '').trim(),
    studentClass: String(raw.studentClass || '').trim(),
    studentNumber: String(raw.studentNumber || '').trim(),
    answers: raw.answers && typeof raw.answers === 'object' ? raw.answers : {},
    score: Number(raw.score) || 0,
    total: Number(raw.total) || 0,
    percent: Math.min(100, Math.max(0, Number(raw.percent) || 0)),
    passThresholdPercent: Math.min(100, Math.max(0, Number(raw.passThresholdPercent) || 80)),
    passed: raw.passed === true,
    status: raw.status === 'cancelled' || raw.status === 'passed' || raw.status === 'failed'
        ? raw.status
        : (raw.passed ? 'passed' : 'failed'),
    cancellationReason: String(raw.cancellationReason || '').trim(),
    createdAt: raw.createdAt,
});

export const buildAnswerOptions = (blanks: HistoryClassroomBlank[]) =>
    Array.from(new Set(blanks.map((blank) => blank.answer.trim()).filter(Boolean)));
