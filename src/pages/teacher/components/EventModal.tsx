import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useAppToast } from '../../../components/common/AppToastProvider';
import { useAuth } from '../../../contexts/AuthContext';
import { db } from '../../../lib/firebase';
import {
    COLOR_EMOJI_OPTIONS,
    DEFAULT_SCHEDULE_CATEGORIES,
    ScheduleCategory,
    createScheduleCategoryKey,
    getColorForEmoji,
    resolveScheduleCategories,
    useScheduleCategories,
} from '../../../lib/scheduleCategories';
import { CalendarEvent } from '../../../types';

interface EventModalProps {
    isOpen: boolean;
    onClose: () => void;
    eventData?: CalendarEvent;
    onSave: () => void;
    initialDate?: string;
}

type SchoolOption = { value: string; label: string };

const EventModal: React.FC<EventModalProps> = ({ isOpen, onClose, eventData, onSave, initialDate }) => {
    const { config } = useAuth();
    const { categories } = useScheduleCategories();
    const { showToast } = useAppToast();

    const [title, setTitle] = useState('');
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');
    const [endEnabled, setEndEnabled] = useState(false);
    const [description, setDescription] = useState('');
    const [eventType, setEventType] = useState(DEFAULT_SCHEDULE_CATEGORIES[0].key);
    const [targetType, setTargetType] = useState('common');
    const [targetGrade, setTargetGrade] = useState('1');
    const [targetClass, setTargetClass] = useState('1');
    const [gradeOptions, setGradeOptions] = useState<SchoolOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [classOptions, setClassOptions] = useState<SchoolOption[]>(
        Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` }))
    );
    const [loading, setLoading] = useState(false);
    const [savingCategories, setSavingCategories] = useState(false);
    const [categoryDrafts, setCategoryDrafts] = useState<ScheduleCategory[]>(DEFAULT_SCHEDULE_CATEGORIES);
    const [newCategoryLabel, setNewCategoryLabel] = useState('');
    const [newCategoryEmoji, setNewCategoryEmoji] = useState(DEFAULT_SCHEDULE_CATEGORIES[3]?.emoji || COLOR_EMOJI_OPTIONS[0]);

    useEffect(() => {
        const loadSchoolConfig = async () => {
            try {
                const snap = await getDoc(doc(db, 'site_settings', 'school_config'));
                if (!snap.exists()) return;
                const data = snap.data() as {
                    grades?: Array<{ value?: string; label?: string }>;
                    classes?: Array<{ value?: string; label?: string }>;
                };
                const nextGrades = (data.grades || [])
                    .map((g) => ({ value: String(g?.value ?? '').trim(), label: String(g?.label ?? '').trim() }))
                    .filter((g) => g.value && g.label);
                const nextClasses = (data.classes || [])
                    .map((c) => ({ value: String(c?.value ?? '').trim(), label: String(c?.label ?? '').trim() }))
                    .filter((c) => c.value && c.label);
                if (nextGrades.length > 0) setGradeOptions(nextGrades);
                if (nextClasses.length > 0) setClassOptions(nextClasses);
            } catch (error) {
                console.error('Failed to load school config:', error);
            }
        };
        void loadSchoolConfig();
    }, []);

    useEffect(() => {
        setCategoryDrafts(categories);
    }, [categories]);

    useEffect(() => {
        if (!categoryDrafts.some((item) => item.key === eventType)) {
            setEventType(categoryDrafts[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
        }
    }, [categoryDrafts, eventType]);

    useEffect(() => {
        if (!isOpen) return;

        if (eventData) {
            setTitle(eventData.title || '');
            setStart(eventData.start || '');
            setEnd(eventData.end || '');
            setEndEnabled(Boolean(eventData.end && eventData.end !== eventData.start));
            setDescription(eventData.description || '');
            setEventType(eventData.eventType || categories[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
            setTargetType(eventData.targetType || 'common');
            const [g, c] = (eventData.targetClass || '1-1').split('-');
            setTargetGrade(g || '1');
            setTargetClass(c || '1');
            return;
        }

        setTitle('');
        setStart(initialDate || '');
        setEnd('');
        setEndEnabled(false);
        setDescription('');
        setEventType(categories[0]?.key || DEFAULT_SCHEDULE_CATEGORIES[0].key);
        setTargetType('common');
        setTargetGrade(gradeOptions[0]?.value || '1');
        setTargetClass(classOptions[0]?.value || '1');
    }, [isOpen, eventData, initialDate, gradeOptions, classOptions, categories]);

    useEffect(() => {
        const category = categories.find((item) => item.key === eventType);
        if (category?.key !== 'exam' || endEnabled) return;
        setEndEnabled(true);
        if (!end && start) setEnd(start);
    }, [categories, eventType, endEnabled, end, start]);

    if (!isOpen) return null;

    const handleCategoryDraftChange = (key: string, patch: Partial<ScheduleCategory>) => {
        setCategoryDrafts((prev) => prev.map((item) => (
            item.key === key ? { ...item, ...patch } : item
        )));
    };

    const handleAddCategory = () => {
        const label = newCategoryLabel.trim();
        if (!label) {
            alert('일정 분류 이름을 입력해 주세요.');
            return;
        }

        const nextKey = createScheduleCategoryKey(label);
        const nextCategory: ScheduleCategory = {
            key: nextKey,
            label,
            color: getColorForEmoji(newCategoryEmoji, '#0ea5e9'),
            emoji: newCategoryEmoji,
            order: categoryDrafts.length,
        };

        setCategoryDrafts((prev) => [...prev, nextCategory]);
        setEventType(nextKey);
        setNewCategoryLabel('');
        setNewCategoryEmoji(DEFAULT_SCHEDULE_CATEGORIES[3]?.emoji || COLOR_EMOJI_OPTIONS[0]);
    };

    const persistCategoryDrafts = async () => {
        const items = resolveScheduleCategories(categoryDrafts).map((item, index) => ({
            key: item.key,
            label: item.label.trim(),
            color: item.color,
            emoji: item.emoji,
            order: index,
        }));

        if (items.some((item) => !item.label)) {
            alert('분류 이름이 비어 있으면 저장할 수 없습니다.');
            return;
        }

        await setDoc(doc(db, 'site_settings', 'schedule_categories'), {
            items,
            updatedAt: serverTimestamp(),
        }, { merge: true });
    };

    const handleSaveCategories = async () => {
        setSavingCategories(true);
        try {
            await persistCategoryDrafts();
            showToast({
                tone: 'success',
                title: '일정 분류가 저장되었습니다.',
            });
        } catch (error) {
            console.error('Error saving schedule categories:', error);
            showToast({
                tone: 'error',
                title: '일정 분류 저장에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setSavingCategories(false);
        }
    };

    const handleSave = async () => {
        if (!config) return;
        if (!title.trim() || !start) {
            showToast({
                tone: 'warning',
                title: '제목과 시작 날짜를 확인해 주세요.',
            });
            return;
        }
        setLoading(true);

        try {
            if (!categories.some((item) => item.key === eventType)) {
                await persistCategoryDrafts();
            }
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            const docRef = eventData ? doc(db, path, eventData.id) : doc(collection(db, path));
            const finalEnd = endEnabled ? (end || start) : start;

            const data: Record<string, unknown> = {
                title: title.trim(),
                start,
                end: finalEnd,
                description: description.trim(),
                eventType,
                targetType,
                targetClass: targetType === 'class' ? `${targetGrade}-${targetClass}` : null,
                updatedAt: serverTimestamp(),
            };

            if (!eventData) data.createdAt = serverTimestamp();

            await setDoc(docRef, data, { merge: true });
            onSave();
            showToast({
                tone: 'success',
                title: eventData ? '일정이 수정되었습니다.' : '일정이 저장되었습니다.',
                message: '학사 일정에 최신 내용이 반영되었습니다.',
            });
            onClose();
        } catch (error) {
            console.error('Error saving event:', error);
            showToast({
                tone: 'error',
                title: '일정 저장에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!eventData || !config || !confirm('이 일정을 삭제하시겠습니까?')) return;
        setLoading(true);
        try {
            const path = `years/${config.year}/semesters/${config.semester}/calendar`;
            await deleteDoc(doc(db, path, eventData.id));
            onSave();
            showToast({
                tone: 'success',
                title: '일정이 삭제되었습니다.',
            });
            onClose();
        } catch (error) {
            console.error('Error deleting event:', error);
            showToast({
                tone: 'error',
                title: '일정 삭제에 실패했습니다.',
                message: '잠시 후 다시 시도해 주세요.',
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 md:items-center"
            onClick={onClose}
        >
            <div
                className="my-auto flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white p-4 shadow-2xl md:p-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-6 flex items-center justify-between">
                    <h3 className="text-xl font-bold text-gray-800">
                        <i className="fas fa-edit mr-2 text-blue-500"></i>
                        {eventData ? '일정 수정' : '일정 등록'}
                    </h3>
                    <button type="button" onClick={onClose} className="text-gray-400 transition hover:text-gray-600">
                        <i className="fas fa-times fa-lg"></i>
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                    <div>
                        <label className="mb-1 block text-sm font-bold text-gray-700">일정 제목</label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 p-2.5 outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="예: 1차 수행평가"
                        />
                    </div>

                    <div className={`grid ${endEnabled ? 'grid-cols-2' : 'grid-cols-[minmax(0,1fr)_64px]'} items-end gap-1.5 overflow-hidden`}>
                        <div className="min-w-0 overflow-hidden">
                            <label className="mb-1 block text-[11px] font-bold text-gray-700 md:text-sm">시작 날짜</label>
                            <input
                                type="date"
                                value={start}
                                onChange={(e) => {
                                    const nextStart = e.target.value;
                                    setStart(nextStart);
                                    if (endEnabled && !end) setEnd(nextStart);
                                }}
                                className="block w-full min-w-0 max-w-full rounded-lg border border-gray-300 p-1.5 text-[10px] outline-none md:p-2.5 md:text-sm"
                            />
                        </div>
                        <div className="min-w-0 overflow-hidden">
                            <label className="mb-1 block text-[10px] font-bold text-gray-500 md:text-xs">{endEnabled ? '종료 날짜' : '종료'}</label>
                            {endEnabled ? (
                                <div className="flex items-center gap-1">
                                    <input
                                        type="date"
                                        value={end}
                                        onChange={(e) => setEnd(e.target.value)}
                                        className="block w-full min-w-0 max-w-full rounded-lg border border-gray-300 p-1.5 text-[10px] outline-none md:p-2.5 md:text-sm"
                                    />
                                    {eventType !== 'exam' && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setEndEnabled(false);
                                                setEnd('');
                                            }}
                                            className="h-8 w-8 shrink-0 rounded-lg border border-gray-300 text-gray-500 hover:text-gray-700 md:h-9 md:w-9"
                                            aria-label="종료 날짜 비활성화"
                                        >
                                            <i className="fas fa-times text-xs"></i>
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setEndEnabled(true);
                                        setEnd((prev) => prev || start);
                                    }}
                                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-[11px] font-bold text-gray-600 hover:bg-gray-50"
                                >
                                    종료+
                                </button>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-bold text-gray-700">일정 분류</label>
                        <select
                            value={eventType}
                            onChange={(e) => setEventType(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 p-2.5 font-bold outline-none"
                        >
                            {categoryDrafts.map((category) => (
                                <option key={category.key} value={category.key}>
                                    {`${category.emoji} ${category.label}`}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-sm font-bold text-gray-800">분류 편집</p>
                                <p className="text-xs text-gray-500">새 분류를 추가하고, 이름과 색 이모지만 바로 수정할 수 있습니다.</p>
                            </div>
                            <button
                                type="button"
                                onClick={handleSaveCategories}
                                disabled={savingCategories}
                                className="shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                                {savingCategories ? '저장 중...' : '분류 저장'}
                            </button>
                        </div>

                        <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                            {categoryDrafts.map((category) => (
                                <div key={category.key} className="grid grid-cols-[minmax(0,1fr)_74px] items-center gap-2 rounded-lg border border-blue-100 bg-white p-2">
                                    <input
                                        type="text"
                                        value={category.label}
                                        onChange={(e) => handleCategoryDraftChange(category.key, { label: e.target.value })}
                                        className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold outline-none"
                                    />
                                    <select
                                        value={category.emoji}
                                        onChange={(e) => handleCategoryDraftChange(category.key, {
                                            emoji: e.target.value,
                                            color: getColorForEmoji(e.target.value, category.color),
                                        })}
                                        className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none"
                                    >
                                        {COLOR_EMOJI_OPTIONS.map((emoji) => (
                                            <option key={emoji} value={emoji}>{emoji}</option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>

                        <div className="grid grid-cols-[minmax(0,1fr)_74px_auto] items-center gap-2">
                            <input
                                type="text"
                                value={newCategoryLabel}
                                onChange={(e) => setNewCategoryLabel(e.target.value)}
                                placeholder="새 분류 이름"
                                className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none"
                            />
                            <select
                                value={newCategoryEmoji}
                                onChange={(e) => setNewCategoryEmoji(e.target.value)}
                                className="rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none"
                            >
                                {COLOR_EMOJI_OPTIONS.map((emoji) => (
                                    <option key={emoji} value={emoji}>{emoji}</option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={handleAddCategory}
                                className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                            >
                                추가
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="mb-2 block text-sm font-bold text-gray-700">대상 선택</label>
                        <div className="mb-2 flex items-center space-x-4">
                            <label className="flex cursor-pointer items-center">
                                <input
                                    type="radio"
                                    name="eventTargetType"
                                    value="common"
                                    checked={targetType === 'common'}
                                    onChange={() => setTargetType('common')}
                                    className="h-4 w-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm font-bold text-gray-700">전체 공통</span>
                            </label>
                            <label className="flex cursor-pointer items-center">
                                <input
                                    type="radio"
                                    name="eventTargetType"
                                    value="class"
                                    checked={targetType === 'class'}
                                    onChange={() => setTargetType('class')}
                                    className="h-4 w-4 text-blue-600"
                                />
                                <span className="ml-2 text-sm font-bold text-gray-700">반별 지정</span>
                            </label>
                        </div>

                        <div className="flex gap-2">
                            <select
                                value={targetGrade}
                                onChange={(e) => setTargetGrade(e.target.value)}
                                disabled={targetType !== 'class'}
                                className="w-1/3 rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-center font-bold outline-none transition disabled:opacity-50"
                            >
                                {gradeOptions.map((gradeOpt) => (
                                    <option key={gradeOpt.value} value={gradeOpt.value}>{gradeOpt.label}</option>
                                ))}
                            </select>
                            <select
                                value={targetClass}
                                onChange={(e) => setTargetClass(e.target.value)}
                                disabled={targetType !== 'class'}
                                className="w-2/3 rounded-lg border border-gray-300 bg-gray-50 p-2.5 font-bold outline-none transition disabled:opacity-50"
                            >
                                {classOptions.map((classOpt) => (
                                    <option key={classOpt.value} value={classOpt.value}>{classOpt.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-sm font-bold text-gray-700">상세 내용 (선택)</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows={3}
                            className="w-full resize-none rounded-lg border border-gray-300 p-2.5 outline-none"
                            placeholder="일정에 대한 상세 설명을 입력하세요."
                        ></textarea>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-2 border-t border-gray-100 pt-4">
                    {eventData && (
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={loading}
                            className="rounded-lg bg-red-100 px-4 py-2 font-bold text-red-600 transition hover:bg-red-200"
                        >
                            삭제
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg bg-gray-100 px-5 py-2 font-bold text-gray-600 transition hover:bg-gray-200"
                    >
                        취소
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={loading}
                        className="rounded-lg bg-blue-600 px-5 py-2 font-bold text-white shadow-md transition active:scale-95 hover:bg-blue-700 disabled:opacity-50"
                    >
                        {loading ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EventModal;
