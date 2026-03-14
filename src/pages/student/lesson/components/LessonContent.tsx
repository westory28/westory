import React, { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import LessonWorksheetStage, { type LessonWorksheetAnnotationState } from '../../../../components/common/LessonWorksheetStage';
import { useAuth } from '../../../../contexts/AuthContext';
import { db } from '../../../../lib/firebase';
import { getSemesterCollectionPath } from '../../../../lib/semesterScope';
import type { LessonWorksheetBlank, LessonWorksheetPageImage, LessonWorksheetTextRegion } from '../../../../lib/lessonWorksheet';

type AnswerStatus = '' | 'correct' | 'wrong';

export interface LessonData {
    title: string;
    videoUrl?: string;
    contentHtml?: string;
    isVisibleToStudents?: boolean;
    pdfName?: string;
    pdfUrl?: string;
    worksheetPageImages?: LessonWorksheetPageImage[];
    worksheetTextRegions?: LessonWorksheetTextRegion[];
    worksheetBlanks?: LessonWorksheetBlank[];
}

interface LessonContentProps {
    unitId: string | null;
    fallbackTitle?: string | null;
    lessonOverride?: LessonData | null;
    disablePersistence?: boolean;
    fullscreenPreview?: boolean;
    onClosePreview?: () => void;
    annotationUiMode?: 'always' | 'onDemand';
    allowHiddenAccess?: boolean;
}

const EMPTY_BLANK_LABEL = '빈칸';

const EMPTY_ANNOTATION_STATE: LessonWorksheetAnnotationState = { strokes: [], boxes: [], textNotes: [] };

const normalizeAnswer = (value: string) => String(value || '').trim().replace(/\s+/g, '');

const getInputStatus = (value: string, answer: string): AnswerStatus => {
    if (!normalizeAnswer(value)) return '';
    return normalizeAnswer(value) === normalizeAnswer(answer) ? 'correct' : 'wrong';
};

const getInlineBlankWidth = (answer: string) => Math.min(220, Math.max(76, answer.length * 14 + 24));

const getInlineBlankFontSize = (width: number, textLength: number) => {
    const safeLength = Math.max(1, textLength);
    return Math.max(11, Math.min(19, (width - 12) / (safeLength * 0.92)));
};

const LessonContent: React.FC<LessonContentProps> = ({
    unitId,
    fallbackTitle,
    lessonOverride = null,
    disablePersistence = false,
    fullscreenPreview = false,
    onClosePreview,
    annotationUiMode = 'always',
    allowHiddenAccess = false,
}) => {
    const { config, currentUser } = useAuth();
    const [lesson, setLesson] = useState<LessonData | null>(lessonOverride);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const [isBlocked, setIsBlocked] = useState(false);
    const [studentAnswers, setStudentAnswers] = useState<Record<string, { value?: string; status?: AnswerStatus }>>({});
    const [annotationState, setAnnotationState] = useState<LessonWorksheetAnnotationState>(EMPTY_ANNOTATION_STATE);
    const [worksheetScreenOpen, setWorksheetScreenOpen] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');

    const contentRef = useRef<HTMLDivElement>(null);
    const canPersist = Boolean(!disablePersistence && currentUser?.uid && unitId);

    useEffect(() => {
        setLesson(lessonOverride);
        setIsBlocked(Boolean(!allowHiddenAccess && lessonOverride && lessonOverride.isVisibleToStudents === false));
        setError(false);
        setLoading(false);
        setStudentAnswers({});
        setAnnotationState(EMPTY_ANNOTATION_STATE);
        setHasUnsavedChanges(false);
        setSaveMessage('');
    }, [allowHiddenAccess, lessonOverride]);

    useEffect(() => {
        if (lessonOverride || !unitId) {
            if (!lessonOverride) {
                setLesson(null);
                setIsBlocked(false);
                setStudentAnswers({});
            }
            return;
        }

        const fetchLesson = async () => {
            setLoading(true);
            setError(false);
            setIsBlocked(false);
            try {
                const semesterQuery = query(
                    collection(db, getSemesterCollectionPath(config, 'lessons')),
                    where('unitId', '==', unitId),
                    limit(1),
                );
                let snap = await getDocs(semesterQuery);

                if (snap.empty) {
                    const legacyQuery = query(collection(db, 'lessons'), where('unitId', '==', unitId), limit(1));
                    snap = await getDocs(legacyQuery);
                }

                if (!snap.empty) {
                    const data = snap.docs[0].data() as LessonData;
                    setLesson(data);
                    setIsBlocked(!allowHiddenAccess && data.isVisibleToStudents === false);
                    setStudentAnswers({});
                    setAnnotationState(EMPTY_ANNOTATION_STATE);
                    setHasUnsavedChanges(false);
                    setSaveMessage('');
                } else {
                    setLesson(null);
                    setStudentAnswers({});
                    setAnnotationState(EMPTY_ANNOTATION_STATE);
                    setHasUnsavedChanges(false);
                    setSaveMessage('');
                }
            } catch (fetchError) {
                console.error('Error fetching lesson:', fetchError);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        void fetchLesson();
    }, [allowHiddenAccess, config, lessonOverride, unitId]);

    const getProgressRef = () => {
        if (!canPersist || !currentUser?.uid || !unitId) return null;
        return doc(
            db,
            `${getSemesterCollectionPath(config, 'lesson_progress')}/${currentUser.uid}/units/${unitId}`,
        );
    };

    const serializeAnswers = () => {
        const container = contentRef.current;
        if (!container) return {};
        const inputs = container.querySelectorAll('.cloze-input, .worksheet-blank-input') as NodeListOf<HTMLInputElement>;
        const answers: Record<string, { value: string; status: AnswerStatus }> = {};
        inputs.forEach((input, index) => {
            const key = input.dataset.blankId || input.dataset.blankIndex || String(index);
            const status: AnswerStatus = input.classList.contains('correct')
                ? 'correct'
                : input.classList.contains('wrong')
                    ? 'wrong'
                    : '';
            answers[key] = { value: input.value || '', status };
        });
        return answers;
    };

    const saveProgressToFirestore = async () => {
        const progressRef = getProgressRef();
        if (!progressRef || !currentUser?.uid || !unitId) return;
        try {
            setIsSaving(true);
            await setDoc(progressRef, {
                userId: currentUser.uid,
                unitId,
                answers: serializeAnswers(),
                annotations: annotationState,
                updatedAt: serverTimestamp(),
            }, { merge: true });
            setHasUnsavedChanges(false);
            setSaveMessage('저장됨');
        } catch (saveError) {
            console.error('Failed to save lesson progress:', saveError);
            setSaveMessage('저장 실패');
        } finally {
            setIsSaving(false);
        }
    };

    const applyHierarchySpacing = (html: string) => {
        const addClass = (attrs: string, className: string) => {
            const classMatch = attrs.match(/\bclass=(['"])(.*?)\1/i);
            if (!classMatch) return `${attrs} class="${className}"`;
            const quote = classMatch[1];
            const current = classMatch[2];
            const merged = new Set(`${current} ${className}`.split(/\s+/).filter(Boolean));
            return attrs.replace(classMatch[0], `class=${quote}${Array.from(merged).join(' ')}${quote}`);
        };

        return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
            const text = String(inner)
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;|&#160;/g, ' ')
                .trim();

            let levelClass = '';
            if (/^\d+\.\s/.test(text)) levelClass = 'lesson-level-1';
            else if (/^\d+\)\s/.test(text)) levelClass = 'lesson-level-2';
            else if (/^[\u2460-\u2473]\s*/.test(text)) levelClass = 'lesson-level-3';
            else if (/^[\u2022\u00b7\u25aa\u25e6-]\s/.test(text) || /^\u2192\s*/.test(text)) levelClass = 'lesson-level-4';

            if (!levelClass) return full;
            return `<p${addClass(String(attrs), levelClass)}>${inner}</p>`;
        });
    };

    const renderContent = (html: string) => {
        let blankIndex = 0;
        const hierarchyHtml = applyHierarchySpacing(html);
        return hierarchyHtml.replace(/\[(.*?)\]/g, (_match, rawAnswer) => {
            const answer = String(rawAnswer || '').trim();
            const width = getInlineBlankWidth(answer);
            const fontSize = getInlineBlankFontSize(width, EMPTY_BLANK_LABEL.length);
            const index = blankIndex++;
            return `<input type="text" class="cloze-input" data-answer="${answer}" data-blank-index="${index}" placeholder="${EMPTY_BLANK_LABEL}" autocomplete="off" style="width:${width}px; --blank-font-size:${fontSize}px;" />`;
        });
    };

    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;

        const handleInput = (event: Event) => {
            const target = event.target as HTMLInputElement | null;
            if (!target || (!target.classList.contains('cloze-input') && !target.classList.contains('worksheet-blank-input'))) return;
            const status = getInputStatus(target.value, target.dataset.answer || '');
            target.classList.toggle('correct', status === 'correct');
            target.classList.toggle('wrong', status === 'wrong');
            setHasUnsavedChanges(true);
            setSaveMessage('저장 필요');
        };

        container.addEventListener('input', handleInput);
        return () => {
            container.removeEventListener('input', handleInput);
        };
    }, [lesson?.contentHtml, lesson?.worksheetBlanks]);

    useEffect(() => {
        if (!canPersist) return;

        const restoreProgress = async () => {
            const progressRef = getProgressRef();
            const container = contentRef.current;
            if (!progressRef || !container) return;
            try {
                const snap = await getDoc(progressRef);
                if (!snap.exists()) return;
                const data = snap.data() as {
                    answers?: Record<string, { value?: string; status?: AnswerStatus }>;
                    annotations?: LessonWorksheetAnnotationState;
                };
                const answers = data.answers || {};
                setStudentAnswers(answers);
                setAnnotationState(data.annotations || EMPTY_ANNOTATION_STATE);
                setHasUnsavedChanges(false);
                setSaveMessage('');

                const inputs = container.querySelectorAll('.cloze-input, .worksheet-blank-input') as NodeListOf<HTMLInputElement>;
                inputs.forEach((input, index) => {
                    const key = input.dataset.blankId || input.dataset.blankIndex || String(index);
                    const saved = answers[key];
                    if (!saved) return;
                    input.value = saved.value || '';
                    input.classList.remove('correct', 'wrong');
                    if (saved.status) input.classList.add(saved.status);
                });
            } catch (restoreError) {
                console.error('Failed to restore lesson progress:', restoreError);
            }
        };

        if ((!lesson?.contentHtml && !(lesson?.worksheetBlanks || []).length) || !unitId || !currentUser?.uid) return;
        void restoreProgress();
    }, [canPersist, config, currentUser?.uid, lesson?.contentHtml, lesson?.worksheetBlanks, unitId]);

    const handleReset = () => {
        if (!contentRef.current) return;
        if (!window.confirm('입력한 내용을 모두 지우시겠습니까?')) return;

        const inputs = contentRef.current.querySelectorAll('.cloze-input, .worksheet-blank-input') as NodeListOf<HTMLInputElement>;
        const nextAnswers: Record<string, { value?: string; status?: AnswerStatus }> = {};
        inputs.forEach((input, index) => {
            const key = input.dataset.blankId || input.dataset.blankIndex || String(index);
            input.value = '';
            input.classList.remove('correct', 'wrong');
            nextAnswers[key] = { value: '', status: '' };
        });
        setStudentAnswers(nextAnswers);
        setHasUnsavedChanges(true);
        setSaveMessage('저장 필요');
    };

    const handleWorksheetAnswerChange = (blankId: string, value: string, answer: string) => {
        setStudentAnswers((prev) => ({
            ...prev,
            [blankId]: {
                value,
                status: getInputStatus(value, answer),
            },
        }));
        setHasUnsavedChanges(true);
        setSaveMessage('저장 필요');
    };

    const handleAnnotationChange = (nextState: LessonWorksheetAnnotationState) => {
        let changed = false;
        setAnnotationState((prev) => {
            const same =
                JSON.stringify(prev.strokes) === JSON.stringify(nextState.strokes)
                && JSON.stringify(prev.boxes) === JSON.stringify(nextState.boxes)
                && JSON.stringify(prev.textNotes) === JSON.stringify(nextState.textNotes);
            if (same) return prev;
            changed = true;
            return nextState;
        });
        if (changed) {
            setHasUnsavedChanges(true);
            setSaveMessage('저장 필요');
        }
    };

    const handleSaveClick = () => {
        if (!canPersist || isSaving || !hasUnsavedChanges) return;
        void saveProgressToFirestore();
    };

    const getVideoEmbedUrl = (url?: string) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}` : null;
    };

    if (!unitId && !lessonOverride) {
        return (
            <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
                <div className="mb-4 text-6xl">📋</div>
                <h2 className="text-xl font-bold text-gray-700">학습할 단원을 선택하세요</h2>
                <p className="mt-2 text-gray-500">수업 목차의 단원에서 수업 자료를 클릭하면 내용이 표시됩니다.</p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 backdrop-blur-sm">
                <div className="rounded-2xl bg-white px-6 py-5 text-center shadow-2xl">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                        <i className="fas fa-spinner fa-spin text-xl"></i>
                    </div>
                    <div className="text-sm font-bold text-gray-800">수업 자료를 불러오는 중입니다.</div>
                    <div className="mt-1 text-xs text-gray-500">잠시만 기다려 주세요.</div>
                </div>
            </div>
        );
    }

    if (error || !lesson) {
        return (
            <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
                <div className="mb-4 text-6xl text-gray-200">📭</div>
                <h2 className="text-xl font-bold text-gray-500">수업 자료를 찾을 수 없습니다</h2>
                <p className="mt-2 text-sm text-gray-400">등록된 자료가 없거나 불러오지 못했습니다.</p>
            </div>
        );
    }

    if (isBlocked) {
        return (
            <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
                <div className="mb-4 text-6xl text-amber-400">🔒</div>
                <h2 className="text-xl font-bold text-gray-700">수업 자료가 공개되지 않았습니다</h2>
                <p className="mt-2 text-sm text-gray-500">교사가 학생 수업에 활성화한 뒤에만 확인할 수 있습니다.</p>
            </div>
        );
    }

    const embedUrl = getVideoEmbedUrl(lesson.videoUrl);
    const hasInteractiveBlanks = Boolean((lesson.worksheetBlanks || []).length || lesson.contentHtml?.includes('['));
    const content = (
        <div className={fullscreenPreview ? 'mx-auto w-full max-w-[min(100vw-1.5rem,1600px)] animate-fadeIn' : 'mx-auto max-w-4xl animate-fadeIn'}>
            <div className={`rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur ${fullscreenPreview ? 'p-4 md:p-5' : 'mb-6 p-5 md:p-7'}`}>
                <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4">
                    <div className="min-w-0 flex-1 order-1">
                        <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600">
                            학생 수업 화면
                        </span>
                        <h1 className="mt-3 text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">
                            {lesson.title || fallbackTitle || '제목 없음'}
                        </h1>
                        {hasInteractiveBlanks && (
                            <p className="mt-2 text-sm text-slate-500">
                                빈칸은 입력 즉시 정답 여부가 표시됩니다. 상단 플로팅 도구로 필기와 메모를 할 수 있습니다.
                            </p>
                        )}
                    </div>
                    {canPersist && (
                        <div className="order-3 flex basis-full flex-wrap items-center justify-end gap-3 md:-mt-1">
                            <span className={`rounded-full px-4 py-2 text-sm font-bold ${
                                hasUnsavedChanges
                                    ? 'bg-amber-50 text-amber-700'
                                    : saveMessage === '저장됨'
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-500'
                            }`}>
                                {isSaving ? '저장 중...' : saveMessage || '저장 대기'}
                            </span>
                            <button
                                type="button"
                                onClick={handleSaveClick}
                                disabled={isSaving || !hasUnsavedChanges}
                                className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-base font-bold transition ${
                                    isSaving || !hasUnsavedChanges
                                        ? 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400'
                                        : 'border border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                                }`}
                            >
                                <i className="fas fa-save text-sm"></i>
                                저장
                            </button>
                        </div>
                    )}
                    {fullscreenPreview && onClosePreview && (
                        <button
                            type="button"
                            onClick={onClosePreview}
                            className="order-2 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                            <i className="fas fa-times text-xs"></i>
                            닫기
                        </button>
                    )}
                </div>

                {embedUrl && (
                    <div className="relative mb-6 h-0 overflow-hidden rounded-2xl bg-black shadow-md" style={{ paddingBottom: '56.25%' }}>
                        <iframe
                            className="absolute left-0 top-0 h-full w-full"
                            src={embedUrl}
                            frameBorder="0"
                            allowFullScreen
                            title="Lesson Video"
                        />
                    </div>
                )}

                <div ref={contentRef} className="space-y-6">
                    {(lesson.worksheetPageImages || []).length > 0 && (
                        fullscreenPreview ? (
                            <LessonWorksheetStage
                                pageImages={lesson.worksheetPageImages || []}
                                blanks={lesson.worksheetBlanks || []}
                                textRegions={lesson.worksheetTextRegions || []}
                                mode="student"
                                studentAnswers={studentAnswers}
                                onStudentAnswerChange={handleWorksheetAnswerChange}
                                annotationEnabled
                                annotationUiMode={annotationUiMode}
                                annotationState={annotationState}
                                onAnnotationChange={handleAnnotationChange}
                            />
                        ) : (
                            <button
                                type="button"
                                onClick={() => setWorksheetScreenOpen(true)}
                                className="group block w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-lg"
                            >
                                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                                    <div>
                                        <div className="text-sm font-bold text-slate-800">학습지 수업 화면 열기</div>
                                        <div className="mt-1 text-xs text-slate-500">학습지 컨테이너를 클릭하면 전체 화면에서 필기할 수 있습니다.</div>
                                    </div>
                                    <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600">
                                        <i className="fas fa-expand text-[11px]"></i>
                                        {(lesson.worksheetPageImages || []).length} page
                                    </div>
                                </div>
                                <div className="bg-[radial-gradient(circle_at_top,_rgba(239,246,255,0.96),_rgba(248,250,252,0.98)_58%,_rgba(241,245,249,1)_100%)] p-4">
                                    <img
                                        src={lesson.worksheetPageImages?.[0]?.imageUrl}
                                        alt="학습지 미리보기"
                                        className="mx-auto max-h-[26rem] w-auto rounded-2xl border border-slate-200 bg-white shadow-sm transition group-hover:scale-[1.01]"
                                    />
                                </div>
                            </button>
                        )
                    )}

                    {!!lesson.contentHtml && (
                        <div
                            className="note-content prose prose-blue max-w-none rounded-3xl border border-slate-200 bg-white p-6 leading-loose text-slate-700 shadow-sm md:p-10"
                            dangerouslySetInnerHTML={{ __html: renderContent(lesson.contentHtml || '') }}
                        />
                    )}
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-slate-200 pt-5">
                    <button
                        type="button"
                        onClick={handleReset}
                        className="rounded-xl border-2 border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
                    >
                        <i className="fas fa-undo mr-2"></i>다시 풀기
                    </button>
                    {hasInteractiveBlanks && (
                        <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                            입력하면 바로 정답/오답이 반영됩니다.
                        </span>
                    )}
                </div>

                {worksheetScreenOpen && !fullscreenPreview && (
                    <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm">
                        <div className="h-full overflow-y-auto">
                            <LessonContent
                                unitId={unitId}
                                fallbackTitle={fallbackTitle}
                                lessonOverride={lesson}
                                disablePersistence={disablePersistence}
                                fullscreenPreview
                                onClosePreview={() => setWorksheetScreenOpen(false)}
                                annotationUiMode="always"
                                allowHiddenAccess={allowHiddenAccess}
                            />
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                .cloze-input {
                    border: none;
                    border-bottom: 2px solid #334155;
                    text-align: center;
                    font-weight: 700;
                    color: #2563eb;
                    background: transparent;
                    padding: 0 4px;
                    margin: 0 4px;
                    transition: all 0.2s ease;
                    font-size: var(--blank-font-size, 1rem);
                    line-height: 1.2;
                }
                .cloze-input::placeholder {
                    color: #94a3b8;
                    opacity: 1;
                }
                .cloze-input:focus {
                    outline: none;
                    border-bottom-color: #2563eb;
                    background-color: #eff6ff;
                }
                .cloze-input.correct {
                    border-bottom-color: #22c55e;
                    color: #15803d;
                    background-color: #dcfce7;
                }
                .cloze-input.wrong {
                    border-bottom-color: #ef4444;
                    color: #b91c1c;
                    background-color: #fee2e2;
                }
                .worksheet-blank-input {
                    border-radius: 0;
                }
                .worksheet-blank-input:focus {
                    box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.2);
                }
                .worksheet-blank-input::placeholder {
                    color: #94a3b8;
                    opacity: 1;
                }
                .note-content h1 {
                    margin-top: 1em;
                    margin-bottom: 0.5em;
                    color: #111827;
                    font-size: 1.5em;
                    font-weight: 700;
                }
                .note-content h2 {
                    margin-top: 1em;
                    margin-bottom: 0.5em;
                    border-left: 4px solid #2563eb;
                    padding-left: 10px;
                    color: #374151;
                    font-size: 1.25em;
                    font-weight: 700;
                }
                .note-content p {
                    margin-bottom: 1em;
                    white-space: pre-wrap;
                }
                .note-content p.lesson-level-1 {
                    padding-left: 0.75rem;
                    text-indent: -0.75rem;
                }
                .note-content p.lesson-level-2 {
                    padding-left: 2rem;
                    text-indent: -1.2rem;
                }
                .note-content p.lesson-level-3 {
                    padding-left: 3.4rem;
                    text-indent: -1.2rem;
                }
                .note-content p.lesson-level-4 {
                    padding-left: 4.8rem;
                    text-indent: -1.2rem;
                }
                .note-content img {
                    margin: 10px 0;
                    max-width: 100%;
                    border-radius: 8px;
                }
            `}</style>
        </div>
    );

    if (!fullscreenPreview) {
        return content;
    }

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(219,234,254,0.9),_rgba(241,245,249,0.96)_38%,_rgba(226,232,240,1)_100%)] p-2 md:p-4">
            {content}
        </div>
    );
};

export default LessonContent;
