import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, getDocs, query, orderBy } from 'firebase/firestore';
import SegmentedAchievementChart from '../../../components/common/SegmentedAchievementChart';
import { useAuth } from '../../../contexts/AuthContext';
import { getSemesterCollectionPath, getSemesterDocPath } from '../../../lib/semesterScope';
import { buildScoreRows, getScoreKey, getTypeLabel, normalizePlanItemType } from '../../../lib/studentScores';

interface GradingItem {
    type: '정기' | '수행';
    name: string;
    maxScore: number;
    ratio: number;
}

interface GradingPlan {
    id: string;
    subject: string;
    targetGrade: string;
    items: GradingItem[];
    academicYear?: string;
    semester?: string;
    createdAt?: any;
}

const isRegularExamItem = (type: string) => type === '정기' || type === '정기시험';
const isPerformanceItem = (type: string) => type === '수행' || type === '수행평가';
const initialIndexByKey: Record<string, number> = { r: 0, R: 1, s: 2, e: 3, E: 4, f: 5, a: 6, q: 7, Q: 8, t: 9, T: 10, d: 11, w: 12, W: 13, c: 14, z: 15, x: 16, v: 17, g: 18 };
const medialIndexByKey: Record<string, number> = { k: 0, o: 1, i: 2, O: 3, j: 4, p: 5, u: 6, P: 7, h: 8, y: 12, n: 13, b: 17, m: 18, l: 20 };
const medialComboIndexByKeys: Record<string, number> = { hk: 9, ho: 10, hl: 11, nj: 14, np: 15, nl: 16, ml: 19 };
const finalIndexByKey: Record<string, number> = { r: 1, R: 2, s: 4, e: 7, f: 8, a: 16, q: 17, t: 19, T: 20, d: 21, w: 22, c: 23, z: 24, x: 25, v: 26, g: 27 };
const finalComboIndexByKeys: Record<string, number> = { rt: 3, sw: 5, sg: 6, fr: 9, fa: 10, fq: 11, ft: 12, fx: 13, fv: 14, fg: 15, qt: 18 };
const jamoByKey: Record<string, string> = {
    r: 'ㄱ', R: 'ㄲ', s: 'ㄴ', e: 'ㄷ', E: 'ㄸ', f: 'ㄹ', a: 'ㅁ', q: 'ㅂ', Q: 'ㅃ', t: 'ㅅ', T: 'ㅆ', d: 'ㅇ', w: 'ㅈ', W: 'ㅉ', c: 'ㅊ', z: 'ㅋ', x: 'ㅌ', v: 'ㅍ', g: 'ㅎ',
    k: 'ㅏ', o: 'ㅐ', i: 'ㅑ', O: 'ㅒ', j: 'ㅓ', p: 'ㅔ', u: 'ㅕ', P: 'ㅖ', h: 'ㅗ', y: 'ㅛ', n: 'ㅜ', b: 'ㅠ', m: 'ㅡ', l: 'ㅣ'
};
const jamoByVowelComboKeys: Record<string, string> = { hk: 'ㅘ', ho: 'ㅙ', hl: 'ㅚ', nj: 'ㅝ', np: 'ㅞ', nl: 'ㅟ', ml: 'ㅢ' };

const isConsonantKey = (key: string) => key in initialIndexByKey;
const isVowelKey = (key: string) => key in medialIndexByKey;
const composeHangul = (initial: number, medial: number, final: number) =>
    String.fromCharCode(0xac00 + (initial * 21 + medial) * 28 + final);

const convertKeyboardKoreanSegment = (segment: string) => {
    let output = '';
    let i = 0;

    while (i < segment.length) {
        const ch = segment[i];

        if (isConsonantKey(ch) && i + 1 < segment.length && isVowelKey(segment[i + 1])) {
            const initial = initialIndexByKey[ch];
            i += 1;

            const firstVowel = segment[i];
            let medial = medialIndexByKey[firstVowel];
            i += 1;

            if (i < segment.length && isVowelKey(segment[i])) {
                const comboMedial = medialComboIndexByKeys[`${firstVowel}${segment[i]}`];
                if (comboMedial !== undefined) {
                    medial = comboMedial;
                    i += 1;
                }
            }

            let final = 0;
            if (i < segment.length && isConsonantKey(segment[i])) {
                if (!(i + 1 < segment.length && isVowelKey(segment[i + 1]))) {
                    const comboKey = i + 1 < segment.length ? `${segment[i]}${segment[i + 1]}` : '';
                    const comboFinal = finalComboIndexByKeys[comboKey];

                    if (comboFinal !== undefined && !(i + 2 < segment.length && isVowelKey(segment[i + 2]))) {
                        final = comboFinal;
                        i += 2;
                    } else {
                        final = finalIndexByKey[segment[i]] ?? 0;
                        i += 1;
                    }
                }
            }

            output += composeHangul(initial, medial, final);
            continue;
        }

        if (isVowelKey(ch)) {
            const next = i + 1 < segment.length ? segment[i + 1] : '';
            const combo = jamoByVowelComboKeys[`${ch}${next}`];
            if (combo) {
                output += combo;
                i += 2;
            } else {
                output += jamoByKey[ch] ?? ch;
                i += 1;
            }
            continue;
        }

        output += jamoByKey[ch] ?? ch;
        i += 1;
    }

    return output;
};

const normalizeKoreanKeyboardInput = (value: string) => {
    let output = '';
    let buffer = '';

    for (const char of value) {
        if (/[A-Za-z]/.test(char)) {
            buffer += char;
            continue;
        }
        if (buffer) {
            output += convertKeyboardKoreanSegment(buffer);
            buffer = '';
        }
        output += char;
    }

    if (buffer) {
        output += convertKeyboardKoreanSegment(buffer);
    }

    return output;
};

const ExamGradingPlan: React.FC = () => {
    const { userConfig } = useAuth();
    const [plans, setPlans] = useState<GradingPlan[]>([]);
    const [loading, setLoading] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewPlan, setPreviewPlan] = useState<Omit<GradingPlan, 'id'> | null>(null);
    const [previewScores, setPreviewScores] = useState<Record<string, string>>({});

    // Form State
    const [editId, setEditId] = useState<string | null>(null);
    const [grade, setGrade] = useState('3');
    const [subject, setSubject] = useState('');
    const [items, setItems] = useState<GradingItem[]>([{ type: '정기', name: '', maxScore: 0, ratio: 0 }]);
    const [sortMode, setSortMode] = useState('importance');
    const koreanInputProps = {
        lang: 'ko',
        inputMode: 'text' as const,
        autoCapitalize: 'off' as const,
        autoCorrect: 'off' as const,
        spellCheck: false
    };

    useEffect(() => {
        loadPlans();
    }, [userConfig]);

    const loadPlans = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(query(
                collection(db, getSemesterCollectionPath(userConfig, 'grading_plans')),
                orderBy('createdAt', 'desc')
            ));
            const list: GradingPlan[] = [];
            snap.forEach(d => list.push({ id: d.id, ...d.data() } as GradingPlan));
            setPlans(list);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAddItem = () => {
        setItems([...items, { type: '정기', name: '', maxScore: 0, ratio: 0 }]);
    };

    const handleRemoveItem = (idx: number) => {
        setItems(items.filter((_, i) => i !== idx));
    };

    const handleItemChange = (idx: number, field: keyof GradingItem, value: any) => {
        const newItems = [...items];
        // @ts-ignore
        newItems[idx][field] = value;
        setItems(newItems);
    };

    const handleSubjectChange = (value: string) => {
        setSubject(normalizeKoreanKeyboardInput(value));
    };

    const handleItemNameChange = (idx: number, value: string) => {
        handleItemChange(idx, 'name', normalizeKoreanKeyboardInput(value));
    };

    const handleSave = async () => {
        if (!subject) { alert("과목명을 입력하세요."); return; }

        const validItems = items.filter(i => i.name && i.maxScore > 0 && i.ratio > 0);
        if (validItems.length === 0) { alert("항목을 하나 이상 유효하게 입력하세요."); return; }

        const totalRatio = validItems.reduce((sum, i) => sum + i.ratio, 0);
        if (totalRatio !== 100) { alert(`비율 합계는 100%여야 합니다. (현재 ${totalRatio}%)`); return; }

        const data = {
            subject,
            targetGrade: grade,
            items: validItems,
            academicYear: userConfig?.year || '2025',
            semester: userConfig?.semester || '1',
            updatedAt: serverTimestamp()
        };

        try {
            if (editId) {
                await updateDoc(doc(db, getSemesterDocPath(userConfig, 'grading_plans', editId)), data);
                alert("수정되었습니다.");
            } else {
                await addDoc(collection(db, getSemesterCollectionPath(userConfig, 'grading_plans')), {
                    ...data,
                    createdAt: serverTimestamp()
                });
                alert("저장되었습니다.");
            }
            resetForm();
            loadPlans();
        } catch (e) {
            console.error(e);
            alert("저장 실패");
        }
    };

    const buildDraftPreviewPlan = (): Omit<GradingPlan, 'id'> => ({
        subject: subject.trim() || '미리보기 과목',
        targetGrade: grade,
        items: items.map((item, idx) => ({
            ...item,
            name: item.name.trim() || `${idx + 1}번 항목`,
            maxScore: Number(item.maxScore || 0),
            ratio: Number(item.ratio || 0),
        })),
        academicYear: userConfig?.year || '2025',
        semester: userConfig?.semester || '1',
    });

    const openPreview = (plan?: GradingPlan) => {
        const nextPlan = plan
            ? {
                subject: plan.subject,
                targetGrade: plan.targetGrade || grade,
                items: (plan.items || []).map((item, idx) => ({
                    ...item,
                    name: item.name || `${idx + 1}번 항목`,
                    maxScore: Number(item.maxScore || 0),
                    ratio: Number(item.ratio || 0),
                })),
                academicYear: plan.academicYear,
                semester: plan.semester,
            }
            : buildDraftPreviewPlan();
        setPreviewPlan(nextPlan);
        setPreviewScores({});
        setPreviewOpen(true);
    };

    const closePreview = () => {
        setPreviewOpen(false);
        setPreviewPlan(null);
        setPreviewScores({});
    };

    const resetForm = () => {
        setEditId(null);
        setGrade('3');
        setSubject('');
        setItems([{ type: '정기', name: '', maxScore: 0, ratio: 0 }]);
    };

    const handleEdit = (p: GradingPlan) => {
        setEditId(p.id);
        setSubject(p.subject);
        setGrade(p.targetGrade || '3');
        setItems(p.items.map(i => ({ ...i })));
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDelete = async (id: string) => {
        if (confirm("삭제하시겠습니까?")) {
            try {
                await deleteDoc(doc(db, getSemesterDocPath(userConfig, 'grading_plans', id)));
                setPlans(plans.filter(p => p.id !== id));
            } catch (e) {
                console.error(e);
            }
        }
    };

    const getSortedPlans = () => {
        let sorted = [...plans];
        if (sortMode === 'name') {
            sorted.sort((a, b) => a.subject.localeCompare(b.subject));
        } else if (sortMode === 'importance') {
            const order = ['국어', '영어', '수학', '사회', '역사', '도덕', '과학', '기술', '가정', '기술가정', '기가', '정보', '음악', '미술', '체육'];
            sorted.sort((a, b) => {
                const idxA = order.findIndex(k => a.subject.includes(k));
                const idxB = order.findIndex(k => b.subject.includes(k));
                const valA = idxA === -1 ? 999 : idxA;
                const valB = idxB === -1 ? 999 : idxB;
                if (valA !== valB) return valA - valB;
                return a.subject.localeCompare(b.subject);
            });
        }
        return sorted;
    };

    const filteredPlans = getSortedPlans().filter((plan) => (plan.targetGrade || '3') === grade);
    const previewValidItems = (previewPlan?.items || []).filter((item) => item.maxScore > 0 && item.ratio > 0);
    const previewRatioTotal = previewValidItems.reduce((sum, item) => sum + Number(item.ratio || 0), 0);
    const previewRows = previewPlan
        ? buildScoreRows([{
            id: 'preview-plan',
            ...previewPlan,
            items: previewValidItems,
        }], previewScores, { filterByGrade: false })
        : [];
    const previewRow = previewRows[0] || null;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-full">
            {previewOpen && previewPlan && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
                    <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
                            <div>
                                <h3 className="text-lg font-black text-slate-900">
                                    평가 반영 미리보기
                                </h3>
                                <p className="mt-1 text-sm font-semibold text-slate-500">
                                    {previewPlan.targetGrade || grade}학년 {previewPlan.subject} 기준으로 학생 입력 결과를 확인합니다.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closePreview}
                                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                                aria-label="미리보기 닫기"
                            >
                                <i className="fas fa-times text-sm" aria-hidden="true"></i>
                            </button>
                        </div>

                        <div className="overflow-y-auto px-5 py-5">
                            {previewValidItems.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                                    만점과 반영 비율이 입력된 평가 항목이 있어야 미리보기를 볼 수 있습니다.
                                </div>
                            ) : (
                                <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
                                    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <h4 className="text-sm font-black text-slate-800">
                                                학생 점수 입력 예시
                                            </h4>
                                            <span className={`rounded-full px-3 py-1 text-xs font-black ${previewRatioTotal === 100 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}>
                                                반영 합계 {previewRatioTotal}%
                                            </span>
                                        </div>
                                        <div className="space-y-3">
                                            {previewValidItems.map((item, idx) => {
                                                const key = getScoreKey('preview-plan', idx);
                                                const maxScore = Number(item.maxScore || 0);
                                                return (
                                                    <label key={`${item.name}-${idx}`} className="block rounded-lg border border-slate-200 bg-white px-3 py-3">
                                                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="truncate text-sm font-black text-slate-800">
                                                                    {item.name || `${idx + 1}번 항목`}
                                                                </div>
                                                                <div className="text-xs font-bold text-slate-400">
                                                                    {getTypeLabel(normalizePlanItemType(item.type, item.name))} · {maxScore}점 만점 · {item.ratio}% 반영
                                                                </div>
                                                            </div>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={maxScore}
                                                                value={previewScores[key] || ''}
                                                                onChange={(event) => {
                                                                    const raw = event.target.value;
                                                                    const numeric = Number(raw);
                                                                    const nextValue = raw === ''
                                                                        ? ''
                                                                        : String(Math.max(0, Math.min(maxScore, Number.isFinite(numeric) ? numeric : 0)));
                                                                    setPreviewScores((prev) => ({ ...prev, [key]: nextValue }));
                                                                }}
                                                                placeholder="점수"
                                                                className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-bold focus:border-blue-500 focus:outline-none"
                                                            />
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </section>

                                    <section className="rounded-xl border border-slate-200 bg-white p-4">
                                        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                                            <div>
                                                <h4 className="text-sm font-black text-slate-800">
                                                    실시간 반영 그래프
                                                </h4>
                                                <p className="mt-1 text-xs font-semibold text-slate-400">
                                                    입력한 점수가 항목별 반영 점수로 나뉘어 표시됩니다.
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-xs font-bold text-slate-400">환산 점수</div>
                                                <div className="text-3xl font-black text-blue-600">
                                                    {previewRow ? previewRow.total : 0}점
                                                </div>
                                            </div>
                                        </div>
                                        <SegmentedAchievementChart
                                            rows={previewRows}
                                            emptyMessage="점수를 입력하면 그래프가 표시됩니다."
                                        />
                                        {previewRatioTotal !== 100 && (
                                            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                                                저장하려면 반영 비율 합계가 100%가 되어야 합니다. 현재 미리보기는 입력된 비율 그대로 계산합니다.
                                            </div>
                                        )}
                                    </section>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Left: Form */}
            <div className="lg:col-span-5">
                <div className="bg-blue-50 p-6 rounded-xl border border-blue-100 sticky top-4">
                    <div className="flex justify-between items-center mb-4 border-b border-blue-200 pb-3">
                        <h3 className="font-bold text-lg text-blue-900">
                            {editId ? "🔄 평가 기준 수정" : "✏️ 평가 기준 등록"}
                        </h3>
                        <button onClick={resetForm} className="text-xs bg-white text-blue-600 border border-blue-200 px-2 py-1 rounded hover:bg-blue-100 transition">
                            <i className="fas fa-undo mr-1"></i>초기화
                        </button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-blue-800 mb-1">대상 학년</label>
                            <select
                                value={grade}
                                onChange={(e) => setGrade(e.target.value)}
                                className="w-full border border-blue-200 rounded p-2 text-sm bg-white focus:ring-2 focus:ring-blue-400 font-bold text-gray-700"
                            >
                                <option value="1">1학년</option>
                                <option value="2">2학년</option>
                                <option value="3">3학년</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-blue-800 mb-1">과목명</label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => handleSubjectChange(e.target.value)}
                                placeholder="예: 국어, 역사, 사회"
                                {...koreanInputProps}
                                className="w-full border border-blue-200 rounded p-2 text-sm focus:ring-2 focus:ring-blue-400"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-bold text-blue-800">평가 항목</label>
                                <span className="text-[10px] text-blue-600">* 합계 100% 필수</span>
                            </div>
                            <div className="space-y-2 bg-white p-2 rounded border border-blue-100 max-h-60 overflow-y-auto">
                                {items.map((item, idx) => (
                                    <div key={idx} className="flex gap-1 items-center bg-gray-50 p-1 rounded mb-1">
                                        <select
                                            value={item.type}
                                            onChange={(e) => handleItemChange(idx, 'type', e.target.value)}
                                            className="border border-gray-300 rounded px-1 py-1.5 text-xs w-[60px] bg-white"
                                        >
                                            <option value="정기">정기</option>
                                            <option value="수행">수행</option>
                                        </select>
                                        <input
                                            type="text"
                                            placeholder="예: 서술형, 발표, 포트폴리오"
                                            value={item.name}
                                            onChange={(e) => handleItemNameChange(idx, e.target.value)}
                                            {...koreanInputProps}
                                            className="border border-gray-300 rounded px-2 py-1.5 text-xs flex-1 min-w-0"
                                        />
                                        <input
                                            type="number"
                                            placeholder="만점"
                                            value={item.maxScore || ''}
                                            onChange={(e) => handleItemChange(idx, 'maxScore', Number(e.target.value))}
                                            className="border border-gray-300 rounded px-1 py-1.5 text-xs w-[45px] text-center"
                                        />
                                        <input
                                            type="number"
                                            placeholder="%"
                                            value={item.ratio || ''}
                                            onChange={(e) => handleItemChange(idx, 'ratio', Number(e.target.value))}
                                            className="border border-gray-300 rounded px-1 py-1.5 text-xs w-[40px] text-center font-bold text-blue-600"
                                        />
                                        <button onClick={() => handleRemoveItem(idx)} className="text-gray-300 hover:text-red-500 w-5 flex justify-center">
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button onClick={handleAddItem} className="w-full mt-2 border border-dashed border-blue-300 text-blue-500 text-xs py-2 rounded hover:bg-blue-50 font-bold transition">
                                + 항목 추가
                            </button>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[0.8fr_1.2fr]">
                            <button
                                type="button"
                                onClick={() => openPreview()}
                                className="w-full rounded-lg border border-blue-200 bg-white py-3 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 active:scale-95"
                            >
                                <i className="fas fa-chart-simple mr-2"></i>미리보기
                            </button>
                            <button
                                onClick={handleSave}
                                className={`w-full text-white font-bold py-3 rounded-lg shadow-md transition transform active:scale-95 ${editId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                            >
                                {editId ? "수정사항 저장" : "기준 저장하기"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: List */}
            <div className="lg:col-span-7">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-gray-700 text-lg">등록된 기준 목록</h3>
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 font-bold">정렬:</span>
                        <select
                            value={sortMode}
                            onChange={(e) => setSortMode(e.target.value)}
                            className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white font-bold text-gray-700 cursor-pointer"
                        >
                            <option value="latest">등록순 (최신)</option>
                            <option value="name">과목명 (가나다)</option>
                            <option value="importance">중요도순 (국영수...)</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-4 h-[calc(100vh-300px)] overflow-y-auto pr-2">
                    {loading ? <div className="text-center p-10 text-gray-400">데이터를 불러오는 중...</div> :
                        filteredPlans.length === 0 ? (
                            <div className="text-center py-20 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                                등록된 평가 기준이 없습니다.
                            </div>
                        ) : (
                            filteredPlans.map(p => (
                                <div key={p.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300 transition group relative overflow-hidden flex items-center justify-between">
                                    <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                                    <div className="pl-4 flex-1">
                                        <div className="flex items-center gap-3 mb-3">
                                            <span className="text-xs font-bold text-white bg-blue-500 px-2.5 py-1 rounded shadow-sm">
                                                {p.targetGrade || '3'}학년
                                            </span>
                                            <h4 className="font-bold text-xl text-gray-800">{p.subject}</h4>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex items-start gap-2">
                                                <span className="mt-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 whitespace-nowrap">
                                                    정기시험
                                                </span>
                                                <div className="flex flex-wrap gap-2">
                                                    {p.items.filter((i) => isRegularExamItem(i.type)).length === 0 ? (
                                                        <span className="text-xs text-gray-400 py-1">없음</span>
                                                    ) : (
                                                        p.items.filter((i) => isRegularExamItem(i.type)).map((i, idx) => (
                                                            <span key={`regular-${idx}`} className="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded border border-gray-200">
                                                                <span className="font-bold mr-1">{i.name}</span>
                                                                <span className="text-gray-300 mx-1">|</span>
                                                                <span className="text-blue-600 font-bold">{i.ratio}%</span>
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-start gap-2">
                                                <span className="mt-0.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 whitespace-nowrap">
                                                    수행평가
                                                </span>
                                                <div className="flex flex-wrap gap-2">
                                                    {p.items.filter((i) => isPerformanceItem(i.type)).length === 0 ? (
                                                        <span className="text-xs text-gray-400 py-1">없음</span>
                                                    ) : (
                                                        p.items.filter((i) => isPerformanceItem(i.type)).map((i, idx) => (
                                                            <span key={`performance-${idx}`} className="inline-flex items-center bg-gray-100 text-gray-600 text-xs px-3 py-1.5 rounded border border-gray-200">
                                                                <span className="font-bold mr-1">{i.name}</span>
                                                                <span className="text-gray-300 mx-1">|</span>
                                                                <span className="text-blue-600 font-bold">{i.ratio}%</span>
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition duration-200 border-l pl-4 border-gray-100 ml-4">
                                        <button onClick={() => openPreview(p)} className="text-emerald-600 hover:bg-emerald-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-emerald-100 shadow-sm">
                                            <i className="fas fa-chart-simple mr-1"></i>미리보기
                                        </button>
                                        <button onClick={() => handleEdit(p)} className="text-blue-500 hover:bg-blue-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-blue-100 shadow-sm">
                                            <i className="fas fa-pen mr-1"></i>수정
                                        </button>
                                        <button onClick={() => handleDelete(p.id)} className="text-red-500 hover:bg-red-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-red-100 shadow-sm">
                                            <i className="fas fa-trash mr-1"></i>삭제
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                </div>
            </div>
        </div>
    );
};

export default ExamGradingPlan;
