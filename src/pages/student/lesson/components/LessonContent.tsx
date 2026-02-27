import React, { useEffect, useState, useRef } from 'react';
import { db } from '../../../../lib/firebase';
import { collection, query, where, getDocs, limit, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../../../contexts/AuthContext';
import { getSemesterCollectionPath } from '../../../../lib/semesterScope';

interface LessonContentProps {
    unitId: string | null;
    fallbackTitle?: string | null;
}

interface LessonData {
    title: string;
    videoUrl?: string;
    contentHtml?: string;
}

const LessonContent: React.FC<LessonContentProps> = ({ unitId, fallbackTitle }) => {
    const { config, currentUser } = useAuth();
    const [lesson, setLesson] = useState<LessonData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    // Check Answers State
    const contentRef = useRef<HTMLDivElement>(null);
    const saveTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!unitId) {
            setLesson(null);
            return;
        }

        const fetchLesson = async () => {
            setLoading(true);
            setError(false);
            try {
                const semesterQuery = query(
                    collection(db, getSemesterCollectionPath(config, 'lessons')),
                    where('unitId', '==', unitId),
                    limit(1)
                );
                let snap = await getDocs(semesterQuery);

                if (snap.empty) {
                    const legacyQuery = query(collection(db, 'lessons'), where('unitId', '==', unitId), limit(1));
                    snap = await getDocs(legacyQuery);
                }

                if (!snap.empty) {
                    setLesson(snap.docs[0].data() as LessonData);
                } else {
                    setLesson(null);
                }
            } catch (err) {
                console.error("Error fetching lesson:", err);
                setError(true);
            } finally {
                setLoading(false);
            }
        };

        fetchLesson();
    }, [config, unitId]);

    const getProgressRef = () => {
        if (!currentUser?.uid || !unitId) return null;
        return doc(
            db,
            `${getSemesterCollectionPath(config, 'lesson_progress')}/${currentUser.uid}/units/${unitId}`,
        );
    };

    const serializeAnswers = () => {
        const container = contentRef.current;
        if (!container) return {};
        const inputs = container.querySelectorAll('.cloze-input') as NodeListOf<HTMLInputElement>;
        const answers: Record<string, { value: string; status: '' | 'correct' | 'wrong' }> = {};
        inputs.forEach((input, index) => {
            const key = input.dataset.blankIndex || String(index);
            const status: '' | 'correct' | 'wrong' = input.classList.contains('correct')
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
        const answers = serializeAnswers();
        try {
            await setDoc(progressRef, {
                userId: currentUser.uid,
                unitId,
                answers,
                updatedAt: serverTimestamp(),
            }, { merge: true });
        } catch (saveError) {
            console.error('Failed to save lesson progress:', saveError);
        }
    };

    const scheduleProgressSave = () => {
        if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = window.setTimeout(() => {
            void saveProgressToFirestore();
        }, 450);
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

    // Parse HTML and inject inputs
    const renderContent = (html: string) => {
        let blankIndex = 0;
        const hierarchyHtml = applyHierarchySpacing(html);
        return hierarchyHtml.replace(/\[(.*?)\]/g, (_match, p1) => {
            const answer = String(p1 || '').trim();
            const width = Math.min(220, Math.max(76, answer.length * 14 + 24));
            const index = blankIndex++;
            return `<input type="text" class="cloze-input" data-answer="${answer}" data-blank-index="${index}" placeholder="빈칸" autocomplete="off" style="width:${width}px;" />`;
        });
    };

    useEffect(() => {
        const container = contentRef.current;
        if (!container) return;
        const handleInput = (event: Event) => {
            const target = event.target as HTMLElement | null;
            if (!target || !target.classList.contains('cloze-input')) return;
            target.classList.remove('correct', 'wrong');
            scheduleProgressSave();
        };
        container.addEventListener('input', handleInput);
        return () => {
            container.removeEventListener('input', handleInput);
        };
    }, [unitId, lesson?.contentHtml, currentUser?.uid]);

    useEffect(() => {
        const restoreProgress = async () => {
            const progressRef = getProgressRef();
            const container = contentRef.current;
            if (!progressRef || !container) return;
            try {
                const snap = await getDoc(progressRef);
                if (!snap.exists()) return;
                const data = snap.data() as {
                    answers?: Record<string, { value?: string; status?: '' | 'correct' | 'wrong' }>;
                };
                const answers = data.answers || {};
                const inputs = container.querySelectorAll('.cloze-input') as NodeListOf<HTMLInputElement>;
                inputs.forEach((input, index) => {
                    const key = input.dataset.blankIndex || String(index);
                    const saved = answers[key];
                    if (!saved) return;
                    input.value = saved.value || '';
                    input.classList.remove('correct', 'wrong');
                    if (saved.status === 'correct' || saved.status === 'wrong') {
                        input.classList.add(saved.status);
                    }
                });
            } catch (restoreError) {
                console.error('Failed to restore lesson progress:', restoreError);
            }
        };

        if (!lesson?.contentHtml || !unitId || !currentUser?.uid) return;
        void restoreProgress();
    }, [config, lesson?.contentHtml, unitId, currentUser?.uid]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
            }
        };
    }, []);

    const handleCheckAnswers = () => {
        if (!contentRef.current) return;
        const inputs = contentRef.current.querySelectorAll('.cloze-input') as NodeListOf<HTMLInputElement>;

        if (inputs.length === 0) {
            alert("채점할 빈칸이 없습니다.");
            return;
        }

        let correctCount = 0;
        inputs.forEach(input => {
            const userAnswer = input.value.trim().replace(/\s+/g, '');
            const correctAnswer = (input.dataset.answer || '').replace(/\s+/g, '');

            if (userAnswer === correctAnswer) {
                input.classList.add('correct');
                input.classList.remove('wrong');
                correctCount++;
            } else {
                input.classList.add('wrong');
                input.classList.remove('correct');
            }
        });

        if (correctCount === inputs.length) {
            alert("🎉 훌륭합니다! 모든 빈칸을 완벽하게 채웠습니다.");
        }
        void saveProgressToFirestore();
    };

    const handleReset = () => {
        if (!contentRef.current) return;
        if (!confirm("입력한 내용을 모두 지우시겠습니까?")) return;

        const inputs = contentRef.current.querySelectorAll('.cloze-input') as NodeListOf<HTMLInputElement>;
        inputs.forEach(input => {
            input.value = '';
            input.classList.remove('correct', 'wrong');
        });
        void saveProgressToFirestore();
    };

    const getVideoEmbedUrl = (url?: string) => {
        if (!url) return null;
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? `https://www.youtube.com/embed/${match[2]}` : null;
    };

    if (!unitId) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center py-32 animate-fadeIn">
                <div className="text-6xl mb-4">📋</div>
                <h2 className="text-xl font-bold text-gray-700">학습할 단원을 선택하세요</h2>
                <p className="text-gray-500 mt-2">수업 목차의 단원에서 수업 자료를 클릭하면 내용이 표시됩니다.</p>
            </div>
        );
    }

    if (loading) {
        return <div className="flex justify-center items-center h-full"><i className="fas fa-spinner fa-spin text-3xl text-blue-500"></i></div>;
    }

    if (error || !lesson) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center py-32 animate-fadeIn">
                <div className="text-6xl mb-4 text-gray-200">📭</div>
                <h2 className="text-xl font-bold text-gray-500">수업 자료를 찾을 수 없습니다</h2>
                <p className="text-gray-400 mt-2 text-sm">등록된 자료가 없거나 불러오지 못했습니다.</p>
            </div>
        );
    }

    const embedUrl = getVideoEmbedUrl(lesson.videoUrl);

    return (
        <div className="max-w-4xl mx-auto animate-fadeIn">
            {/* Title */}
            <div className="mb-6">
                <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded mb-2 inline-block">
                    학습 자료
                </span>
                <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900 leading-tight">
                    {lesson.title || fallbackTitle || '제목 없음'}
                </h1>
            </div>

            {/* Video */}
            {embedUrl && (
                <div className="relative pb-[56.25%] h-0 overflow-hidden rounded-xl shadow-md mb-8 bg-black">
                    <iframe
                        className="absolute top-0 left-0 w-full h-full"
                        src={embedUrl}
                        frameBorder="0"
                        allowFullScreen
                        title="Lesson Video"
                    ></iframe>
                </div>
            )}

            {/* Content Body */}
            <div
                ref={contentRef}
                className="prose prose-blue max-w-none bg-white p-6 md:p-10 rounded-2xl shadow-sm border border-gray-100 leading-loose text-gray-700 font-medium note-content"
                dangerouslySetInnerHTML={{ __html: renderContent(lesson.contentHtml || '') }}
            />

            {/* Actions */}
            <div className="mt-8 flex justify-center gap-4 py-8">
                <button
                    onClick={handleReset}
                    className="px-6 py-3 bg-white border-2 border-gray-200 text-gray-600 font-bold rounded-xl shadow-sm hover:bg-gray-50 transition"
                >
                    <i className="fas fa-undo mr-2"></i>다시 풀기
                </button>
                <button
                    onClick={handleCheckAnswers}
                    className="px-8 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg hover:bg-blue-700 transition transform active:scale-95"
                >
                    <i className="fas fa-check mr-2"></i>정답 확인
                </button>
            </div>

            <style>{`
                .cloze-input {
                    border: none;
                    border-bottom: 2px solid #374151;
                    text-align: center;
                    font-weight: bold;
                    color: #2563eb;
                    background: transparent;
                    padding: 0 4px;
                    transition: all 0.2s;
                    margin: 0 4px;
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
                .note-content h1 { font-size: 1.5em; font-weight: bold; margin-top: 1em; margin-bottom: 0.5em; color: #111827; }
                .note-content h2 { font-size: 1.25em; font-weight: bold; margin-top: 1em; margin-bottom: 0.5em; border-left: 4px solid #2563eb; padding-left: 10px; color: #374151; }
                .note-content p {
                    margin-bottom: 1em;
                    white-space: pre-wrap;
                }
                .note-content p.lesson-level-1 { padding-left: 0.25rem; }
                .note-content p.lesson-level-2 { padding-left: 1.6rem; }
                .note-content p.lesson-level-3 { padding-left: 3.2rem; }
                .note-content p.lesson-level-4 { padding-left: 4.6rem; }
                .note-content img { max-width: 100%; border-radius: 8px; margin: 10px 0; }
            `}</style>
        </div>
    );
};

export default LessonContent;

