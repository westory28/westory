import React, { useEffect, useState, useRef } from 'react';
import { db } from '../../../../lib/firebase';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';

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
    const [lesson, setLesson] = useState<LessonData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    // Check Answers State
    const contentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!unitId) {
            setLesson(null);
            return;
        }

        const fetchLesson = async () => {
            setLoading(true);
            setError(false);
            try {
                const q = query(collection(db, 'lessons'), where('unitId', '==', unitId), limit(1));
                const snap = await getDocs(q);

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
    }, [unitId]);

    // Parse HTML and inject inputs
    const renderContent = (html: string) => {
        // Replace [answer] with <input ... />
        // Note: Using dangerouslySetInnerHTML. 
        // We need to process the string to replace [..] with input tags.
        // And importantly, since React re-renders, we need to handle input state or just use DOM manipulation for the inputs as they are simple.

        return html.replace(/\[(.*?)\]/g, (match, p1) => {
            return `<input type="text" class="cloze-input" data-answer="${p1}" placeholder="빈칸" autocomplete="off" />`;
        });
    };

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
    };

    const handleReset = () => {
        if (!contentRef.current) return;
        if (!confirm("입력한 내용을 모두 지우시겠습니까?")) return;

        const inputs = contentRef.current.querySelectorAll('.cloze-input') as NodeListOf<HTMLInputElement>;
        inputs.forEach(input => {
            input.value = '';
            input.classList.remove('correct', 'wrong');
        });
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
                <div className="text-6xl mb-4">👈</div>
                <h2 className="text-xl font-bold text-gray-700">학습할 단원을 선택하세요</h2>
                <p className="text-gray-500 mt-2">왼쪽 목록에서 수업 자료를 클릭하면 내용이 표시됩니다.</p>
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
                    width: 100px;
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
                .note-content p { margin-bottom: 1em; }
                .note-content img { max-width: 100%; border-radius: 8px; margin: 10px 0; }
            `}</style>
        </div>
    );
};

export default LessonContent;
