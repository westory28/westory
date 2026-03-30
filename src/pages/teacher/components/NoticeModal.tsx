import React, { useState, useEffect } from 'react';
import { db } from '../../../lib/firebase';
import { doc, setDoc, deleteDoc, serverTimestamp, collection } from 'firebase/firestore';
import { useAppToast } from '../../../components/common/AppToastProvider';
import { useAuth } from '../../../contexts/AuthContext';

interface NoticeModalProps {
    isOpen: boolean;
    onClose: () => void;
    noticeData?: any; // If editing
    onSave: () => void;
}

const NoticeModal: React.FC<NoticeModalProps> = ({ isOpen, onClose, noticeData, onSave }) => {
    const { config } = useAuth();
    const { showToast } = useAppToast();
    const [category, setCategory] = useState('normal');
    const [content, setContent] = useState('');
    const [targetType, setTargetType] = useState('common');
    const [targetGrade, setTargetGrade] = useState('1');
    const [targetClass, setTargetClass] = useState('1');
    const [targetDate, setTargetDate] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            if (noticeData) {
                setCategory(noticeData.category || 'normal');
                setContent(noticeData.content || '');
                setTargetType(noticeData.targetType || 'common');
                const [g, c] = (noticeData.targetClass || '1-1').split('-');
                setTargetGrade(g || '1');
                setTargetClass(c || '1');
                setTargetDate(noticeData.targetDate || '');
            } else {
                // Reset
                setCategory('normal');
                setContent('');
                setTargetType('common');
                setTargetGrade('1');
                setTargetClass('1');
                setTargetDate('');
            }
        }
    }, [isOpen, noticeData]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!config) return;
        if (!content.trim()) {
            showToast({
                tone: 'warning',
                title: '알림 내용을 입력해 주세요.',
            });
            return;
        }
        setLoading(true);

        try {
            const path = `years/${config.year}/semesters/${config.semester}/notices`;
            const docRef = noticeData ? doc(db, path, noticeData.id) : doc(collection(db, path));

            const data: any = {
                category,
                content: content.trim(),
                targetType,
                targetClass: targetType === 'class' ? `${targetGrade}-${targetClass}` : null,
                updatedAt: serverTimestamp()
            };

            if (!noticeData) {
                data.createdAt = serverTimestamp();
            }

            if (category === 'dday' && targetDate) {
                data.targetDate = targetDate;
            } else {
                data.targetDate = null;
            }

            await setDoc(docRef, data, { merge: true });
            onSave();
            showToast({
                tone: 'success',
                title: noticeData ? '알림이 수정되었습니다.' : '알림이 저장되었습니다.',
                message: '알림장에 최신 내용이 반영되었습니다.',
            });
            onClose();
        } catch (error) {
            console.error("Error saving notice:", error);
            showToast({
                tone: 'error',
                title: '알림 저장에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!noticeData || !config || !confirm("정말 삭제하시겠습니까?")) return;
        setLoading(true);
        try {
            const path = `years/${config.year}/semesters/${config.semester}/notices`;
            await deleteDoc(doc(db, path, noticeData.id));
            onSave();
            showToast({
                tone: 'success',
                title: '알림이 삭제되었습니다.',
            });
            onClose();
        } catch (error) {
            console.error("Error deleting notice:", error);
            showToast({
                tone: 'error',
                title: '알림 삭제에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center" onClick={onClose}>
            <div className="bg-[#fffbeb] rounded-xl shadow-2xl w-full max-w-lg p-8 m-4 border-t-8 border-amber-400 relative" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-amber-800 hover:text-amber-600">
                    <i className="fas fa-times fa-lg"></i>
                </button>
                <h3 className="text-xl font-extrabold text-amber-900 mb-6"><i className="fas fa-pen-fancy mr-2"></i>알림 쓰기</h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-amber-800 mb-2">카테고리</label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {[
                                { val: 'normal', label: '📢 공지', activeClass: 'bg-red-500 border-red-600 text-white' },
                                { val: 'exam', label: '🔥 정기', activeClass: 'bg-blue-500 border-blue-600 text-white' },
                                { val: 'performance', label: '⚡ 수행', activeClass: 'bg-green-500 border-green-600 text-white' },
                                { val: 'prep', label: '🎒 준비', activeClass: 'bg-yellow-500 border-yellow-600 text-white' },
                                { val: 'dday', label: '⏳ D-Day', activeClass: 'bg-purple-500 border-purple-600 text-white' },
                            ].map((opt) => (
                                <label key={opt.val} className="cursor-pointer">
                                    <input
                                        type="radio"
                                        name="category"
                                        value={opt.val}
                                        checked={category === opt.val}
                                        onChange={e => setCategory(e.target.value)}
                                        className="peer sr-only"
                                    />
                                    <div className={`px-3 py-2 rounded-lg border text-sm font-bold text-center transition shadow-sm ${category === opt.val ? opt.activeClass : 'border-yellow-300 bg-white text-gray-900'}`}>
                                        {opt.label}
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {category === 'dday' && (
                        <div>
                            <label className="block text-xs font-bold text-amber-800 mb-1">목표 날짜</label>
                            <input
                                type="date"
                                value={targetDate}
                                onChange={e => setTargetDate(e.target.value)}
                                className="w-full bg-white border border-yellow-300 rounded p-2 text-sm outline-none"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-amber-800 mb-1">알림 내용</label>
                        <textarea
                            value={content}
                            onChange={e => setContent(e.target.value)}
                            rows={4}
                            className="w-full bg-white border border-yellow-300 rounded p-3 text-sm resize-none outline-none focus:ring-2 focus:ring-amber-300 placeholder-amber-800/30"
                            placeholder="내용을 입력하세요..."
                        ></textarea>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-amber-800 mb-2">대상 선택</label>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                                <input
                                    type="radio"
                                    name="targetType"
                                    value="common"
                                    checked={targetType === 'common'}
                                    onChange={() => setTargetType('common')}
                                    className="text-amber-600 focus:ring-amber-500"
                                />
                                <span className="text-sm font-bold text-amber-900">전체 공통</span>
                            </label>
                            <label className="inline-flex items-center gap-1 cursor-pointer">
                                <input
                                    type="radio"
                                    name="targetType"
                                    value="class"
                                    checked={targetType === 'class'}
                                    onChange={() => setTargetType('class')}
                                    className="text-amber-600 focus:ring-amber-500"
                                />
                                <span className="text-sm font-bold text-gray-700">반 선택</span>
                            </label>

                            {targetType === 'class' && (
                                <div className="flex items-center gap-1 ml-1">
                                    <select
                                        value={targetGrade}
                                        onChange={e => setTargetGrade(e.target.value)}
                                        className="border border-gray-300 rounded px-2 py-1 text-sm outline-none bg-white font-bold w-16 text-center">
                                        {[1, 2, 3].map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                    <span className="text-gray-500 text-xs font-bold">학년</span>
                                    <select
                                        value={targetClass}
                                        onChange={e => setTargetClass(e.target.value)}
                                        className="border border-gray-300 rounded px-2 py-1 text-sm outline-none bg-white font-bold w-16 text-center">
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <span className="text-gray-500 text-xs font-bold">반</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    {noticeData && (
                        <button
                            onClick={handleDelete}
                            disabled={loading}
                            className="px-3 py-2 text-red-600 hover:bg-red-50 rounded font-bold text-sm"
                        >
                            삭제
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-5 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 shadow-md transition transform active:scale-95 disabled:opacity-50"
                    >
                        {loading ? '저장 중...' : '게시하기'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default NoticeModal;
