import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { cloneDefaultMenus, sanitizeMenuConfig } from '../../constants/menus';
import { db } from '../../lib/firebase';
import {
    buildAnswerOptions,
    normalizeHistoryClassroomAssignment,
    type HistoryClassroomAssignment,
    type HistoryClassroomBlank,
} from '../../lib/historyClassroom';
import { normalizeMapResource, type MapResource } from '../../lib/mapResources';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

interface StudentOption {
    uid: string;
    name: string;
    grade: string;
    className: string;
    number: string;
}

interface DraftSelectionState {
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

const MIN_BOX_SIZE = 16;
const DEFAULT_BLANK_WIDTH = 140;
const DEFAULT_BLANK_HEIGHT = 52;

const createBlank = (
    page: number,
    left: number,
    top: number,
    answer = '',
    width = DEFAULT_BLANK_WIDTH,
    height = DEFAULT_BLANK_HEIGHT,
): HistoryClassroomBlank => ({
    id: `blank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    left,
    top,
    width,
    height,
    answer,
});

const ManageHistoryClassroom: React.FC = () => {
    const { config } = useAuth();
    const navigate = useNavigate();

    const [maps, setMaps] = useState<MapResource[]>([]);
    const [assignments, setAssignments] = useState<HistoryClassroomAssignment[]>([]);
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [selectedMapId, setSelectedMapId] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [cooldownMinutes, setCooldownMinutes] = useState(0);
    const [passThresholdPercent, setPassThresholdPercent] = useState(80);
    const [targetGrade, setTargetGrade] = useState('');
    const [targetClass, setTargetClass] = useState('');
    const [targetNumber, setTargetNumber] = useState('');
    const [targetStudentUid, setTargetStudentUid] = useState('');
    const [blanks, setBlanks] = useState<HistoryClassroomBlank[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [saving, setSaving] = useState(false);
    const [selectedBlankId, setSelectedBlankId] = useState('');
    const [draftSelection, setDraftSelection] = useState<DraftSelectionState | null>(null);
    const [tabLabels, setTabLabels] = useState({
        manage: '문제 등록',
        log: '제출 현황',
        bank: '문제 은행',
        historyClassroom: '역사교실',
    });

    useEffect(() => {
        const loadData = async () => {
            const mapPath = getSemesterCollectionPath(config, 'map_resources');
            let mapSnap = await getDocs(query(collection(db, mapPath), orderBy('sortOrder', 'asc')));
            if (mapSnap.empty) {
                mapSnap = await getDocs(query(collection(db, 'map_resources'), orderBy('sortOrder', 'asc')));
            }
            const loadedMaps = mapSnap.docs
                .map((docSnap) => normalizeMapResource(docSnap.id, docSnap.data()))
                .filter((item) => item.type === 'pdf' && (item.pdfPageImages?.length || 0) > 0);
            setMaps(loadedMaps);
            if (loadedMaps[0]) {
                setSelectedMapId((prev) => prev || loadedMaps[0].id);
                setCurrentPage(loadedMaps[0].pdfPageImages?.[0]?.page || 1);
            }

            const studentSnap = await getDocs(collection(db, 'users'));
            const loadedStudents = studentSnap.docs
                .map((docSnap) => {
                    const data = docSnap.data() as Record<string, unknown>;
                    if (data.role === 'teacher') return null;
                    return {
                        uid: docSnap.id,
                        name: String(data.name || '').trim(),
                        grade: String(data.grade || '').trim(),
                        className: String(data.class || '').trim(),
                        number: String(data.number || '').trim(),
                    } as StudentOption;
                })
                .filter((item): item is StudentOption => !!item && !!item.uid);
            setStudents(loadedStudents);

            const assignmentPath = getSemesterCollectionPath(config, 'history_classrooms');
            let assignmentSnap = await getDocs(query(collection(db, assignmentPath), orderBy('updatedAt', 'desc')));
            if (assignmentSnap.empty) {
                assignmentSnap = await getDocs(query(collection(db, 'history_classrooms'), orderBy('updatedAt', 'desc')));
            }
            setAssignments(assignmentSnap.docs.map((docSnap) => normalizeHistoryClassroomAssignment(docSnap.id, docSnap.data())));
        };

        void loadData();
    }, [config]);

    useEffect(() => {
        const resolveMenuLabels = async () => {
            try {
                const menuSnap = await getDoc(doc(db, 'site_settings', 'menu_config'));
                const menuConfig = menuSnap.exists() ? sanitizeMenuConfig(menuSnap.data()) : cloneDefaultMenus();
                const teacherQuizMenu = (menuConfig.teacher || []).find((menu) => menu.url === '/teacher/quiz');
                const children = teacherQuizMenu?.children || [];
                setTabLabels({
                    manage: children.find((child) => child.url === '/teacher/quiz')?.name || '문제 등록',
                    log: children.find((child) => child.url === '/teacher/quiz?tab=log')?.name || '제출 현황',
                    bank: children.find((child) => child.url === '/teacher/quiz?tab=bank')?.name || '문제 은행',
                    historyClassroom: children.find((child) => child.url === '/teacher/quiz/history-classroom')?.name || '역사교실',
                });
            } catch (error) {
                console.error('Failed to load quiz menu labels:', error);
            }
        };
        void resolveMenuLabels();
    }, []);

    const selectedMap = useMemo(
        () => maps.find((item) => item.id === selectedMapId) || null,
        [maps, selectedMapId],
    );

    const pageImage = useMemo(
        () => selectedMap?.pdfPageImages?.find((page) => page.page === currentPage) || null,
        [currentPage, selectedMap],
    );

    const currentPageBlanks = useMemo(
        () => blanks.filter((blank) => blank.page === currentPage),
        [blanks, currentPage],
    );

    const classFilteredStudents = useMemo(
        () => students.filter((student) => (!targetGrade || student.grade === targetGrade) && (!targetClass || student.className === targetClass)),
        [students, targetClass, targetGrade],
    );

    const numberFilteredStudents = useMemo(
        () => classFilteredStudents.filter((student) => !targetNumber || student.number === targetNumber),
        [classFilteredStudents, targetNumber],
    );

    const handleCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pageImage || event.button !== 0) return;
        if ((event.target as HTMLElement).closest('[data-history-blank="true"]')) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setDraftSelection({
            page: currentPage,
            startX: event.clientX - rect.left,
            startY: event.clientY - rect.top,
            currentX: event.clientX - rect.left,
            currentY: event.clientY - rect.top,
        });
    };

    const handleCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!draftSelection || draftSelection.page !== currentPage) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setDraftSelection((prev) => prev ? {
            ...prev,
            currentX: event.clientX - rect.left,
            currentY: event.clientY - rect.top,
        } : null);
    };

    const handleCanvasPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!pageImage || !draftSelection || draftSelection.page !== currentPage) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const currentX = event.clientX - rect.left;
        const currentY = event.clientY - rect.top;
        const left = Math.min(draftSelection.startX, currentX);
        const top = Math.min(draftSelection.startY, currentY);
        const width = Math.abs(currentX - draftSelection.startX);
        const height = Math.abs(currentY - draftSelection.startY);
        setDraftSelection(null);

        if (width < MIN_BOX_SIZE || height < MIN_BOX_SIZE) {
            const created = createBlank(currentPage, left, top);
            setBlanks((prev) => [...prev, created]);
            setSelectedBlankId(created.id);
            return;
        }

        const created = createBlank(currentPage, left, top, '', width, height);
        setBlanks((prev) => [...prev, created]);
        setSelectedBlankId(created.id);
    };

    const handleBlankChange = (blankId: string, answer: string) => {
        setBlanks((prev) => prev.map((blank) => (blank.id === blankId ? { ...blank, answer } : blank)));
    };

    const removeBlank = (blankId: string) => {
        setBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
        if (selectedBlankId === blankId) setSelectedBlankId('');
    };

    const handleSave = async () => {
        if (!selectedMap || !title.trim() || !targetStudentUid) {
            alert('지도, 제목, 대상 학생을 먼저 선택해 주세요.');
            return;
        }
        const student = students.find((item) => item.uid === targetStudentUid);
        if (!student) {
            alert('학생 정보를 찾을 수 없습니다.');
            return;
        }
        if (!blanks.length || blanks.some((blank) => !blank.answer.trim())) {
            alert('모든 텍스트 박스에 정답을 입력해 주세요.');
            return;
        }

        setSaving(true);
        try {
            const assignmentId = `history-classroom-${Date.now()}`;
            const payload: Omit<HistoryClassroomAssignment, 'id'> = {
                title: title.trim(),
                description: description.trim(),
                mapResourceId: selectedMap.id,
                mapTitle: selectedMap.title,
                pdfPageImages: selectedMap.pdfPageImages || [],
                blanks,
                answerOptions: buildAnswerOptions(blanks),
                cooldownMinutes,
                passThresholdPercent,
                targetGrade: student.grade,
                targetClass: student.className,
                targetStudentUid: student.uid,
                targetStudentName: student.name,
                targetStudentNumber: student.number,
                isPublished: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            await setDoc(doc(db, getSemesterCollectionPath(config, 'history_classrooms'), assignmentId), payload);
            setAssignments((prev) => [normalizeHistoryClassroomAssignment(assignmentId, payload), ...prev]);
            setTitle('');
            setDescription('');
            setCooldownMinutes(0);
            setPassThresholdPercent(80);
            setTargetGrade('');
            setTargetClass('');
            setTargetNumber('');
            setTargetStudentUid('');
            setBlanks([]);
            setSelectedBlankId('');
            alert('역사교실 과제를 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('역사교실 과제 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    const liveRect = draftSelection && draftSelection.page === currentPage ? {
        left: Math.min(draftSelection.startX, draftSelection.currentX),
        top: Math.min(draftSelection.startY, draftSelection.currentY),
        width: Math.abs(draftSelection.currentX - draftSelection.startX),
        height: Math.abs(draftSelection.currentY - draftSelection.startY),
    } : null;

    return (
        <div className="mx-auto max-w-[96rem] px-4 py-8">
            <div className="mb-8 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                <div className="flex overflow-x-auto border-b border-gray-200 bg-white px-2">
                    <button type="button" onClick={() => navigate('/teacher/quiz')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.manage}
                    </button>
                    <button type="button" onClick={() => navigate('/teacher/quiz?tab=log')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.log}
                    </button>
                    <button type="button" onClick={() => navigate('/teacher/quiz?tab=bank')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.bank}
                    </button>
                    <button type="button" className="border-b-2 border-blue-500 bg-blue-50 px-6 py-3 text-sm font-bold text-blue-600 transition">
                        {tabLabels.historyClassroom}
                    </button>
                </div>
                <div className="p-6">
                    <h1 className="text-3xl font-black text-gray-900">역사교실 제작</h1>
                    <p className="mt-2 text-sm text-gray-600">지도를 직접 드래그해서 텍스트 박스를 만들고, 원하는 학생에게 개별 과제를 배정합니다.</p>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[24rem_minmax(0,1fr)]">
                <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">PDF 지도 선택</label>
                        <select
                            value={selectedMapId}
                            onChange={(e) => {
                                setSelectedMapId(e.target.value);
                                setCurrentPage(1);
                                setBlanks([]);
                                setSelectedBlankId('');
                            }}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        >
                            {maps.map((map) => (
                                <option key={map.id} value={map.id}>{map.title}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">제목</label>
                        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">설명</label>
                        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">재응시 제한 시간(분)</label>
                            <input type="number" min={0} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">통과 기준 (%)</label>
                            <input type="number" min={0} max={100} value={passThresholdPercent} onChange={(e) => setPassThresholdPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-1">
                        <select value={targetGrade} onChange={(e) => { setTargetGrade(e.target.value); setTargetClass(''); setTargetNumber(''); setTargetStudentUid(''); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">학년 선택</option>
                            {Array.from(new Set(students.map((student) => student.grade).filter(Boolean))).map((grade) => (
                                <option key={grade} value={grade}>{grade}</option>
                            ))}
                        </select>
                        <select value={targetClass} onChange={(e) => { setTargetClass(e.target.value); setTargetNumber(''); setTargetStudentUid(''); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">반 선택</option>
                            {Array.from(new Set(students.filter((student) => !targetGrade || student.grade === targetGrade).map((student) => student.className).filter(Boolean))).map((className) => (
                                <option key={className} value={className}>{className}</option>
                            ))}
                        </select>
                        <select value={targetNumber} onChange={(e) => { setTargetNumber(e.target.value); setTargetStudentUid(''); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">번호 선택</option>
                            {Array.from(new Set(classFilteredStudents.map((student) => student.number).filter(Boolean))).map((number) => (
                                <option key={number} value={number}>{number}</option>
                            ))}
                        </select>
                        <select value={targetStudentUid} onChange={(e) => setTargetStudentUid(e.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">학생 선택</option>
                            {numberFilteredStudents.map((student) => (
                                <option key={student.uid} value={student.uid}>{student.grade}-{student.className} {student.number}번 {student.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                                <div className="text-sm font-bold text-gray-700">텍스트 박스 목록</div>
                                <div className="mt-1 text-xs text-gray-500">지도에서 드래그한 박스마다 정답을 입력하세요.</div>
                            </div>
                            <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">{blanks.length}개</div>
                        </div>
                        <div className="space-y-2">
                            {blanks.map((blank, index) => (
                                <div
                                    key={blank.id}
                                    className={`rounded-2xl border bg-white p-3 transition ${blank.id === selectedBlankId ? 'border-blue-300 shadow-md shadow-blue-100' : 'border-gray-200'}`}
                                    onClick={() => setSelectedBlankId(blank.id)}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-gray-500">
                                        <span>박스 {index + 1} / p.{blank.page}</span>
                                        <button type="button" onClick={() => removeBlank(blank.id)} className="text-red-500">삭제</button>
                                    </div>
                                    <input
                                        value={blank.answer}
                                        onChange={(e) => handleBlankChange(blank.id, e.target.value)}
                                        placeholder="정답 입력"
                                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                                    />
                                </div>
                            ))}
                            {!blanks.length && <div className="text-sm text-gray-400">지도를 드래그해서 텍스트 박스를 추가하세요.</div>}
                        </div>
                    </div>

                    <button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                        {saving ? '저장 중...' : '역사교실 저장'}
                    </button>
                </section>

                <section className="space-y-6">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-bold text-gray-700">지도 선택 영역</div>
                                <div className="mt-1 text-xs text-gray-500">원하는 위치를 드래그하면 형광 박스가 미리 보이고, 놓으면 텍스트 박스가 생성됩니다.</div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">이전</button>
                                <div className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700">{currentPage} / {selectedMap?.pdfPageImages?.length || 1}</div>
                                <button type="button" disabled={currentPage >= (selectedMap?.pdfPageImages?.length || 1)} onClick={() => setCurrentPage((prev) => Math.min(selectedMap?.pdfPageImages?.length || 1, prev + 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">다음</button>
                            </div>
                        </div>

                        {pageImage ? (
                            <div className="overflow-auto rounded-3xl border border-gray-200 bg-gray-100 p-4">
                                <div
                                    className="relative inline-block select-none"
                                    onPointerDown={handleCanvasPointerDown}
                                    onPointerMove={handleCanvasPointerMove}
                                    onPointerUp={handleCanvasPointerUp}
                                    onPointerLeave={() => setDraftSelection(null)}
                                >
                                    <img src={pageImage.imageUrl} alt={selectedMap?.title || 'map'} style={{ width: `${pageImage.width}px`, maxWidth: 'none' }} />
                                    {liveRect && (
                                        <div
                                            className="pointer-events-none absolute border-2 border-lime-500 bg-lime-300/25 shadow-[0_0_0_9999px_rgba(163,230,53,0.10)]"
                                            style={{ left: liveRect.left, top: liveRect.top, width: liveRect.width, height: liveRect.height }}
                                        />
                                    )}
                                    {currentPageBlanks.map((blank, index) => (
                                        <div
                                            key={blank.id}
                                            data-history-blank="true"
                                            className={`absolute rounded-xl border-2 border-dashed bg-white/95 px-3 py-2 text-sm font-bold text-gray-700 shadow-sm ${blank.id === selectedBlankId ? 'border-orange-600 ring-4 ring-orange-200' : 'border-orange-500'}`}
                                            style={{ left: blank.left, top: blank.top, width: blank.width, height: blank.height }}
                                        >
                                            <div className="line-clamp-2">{blank.answer || `박스 ${index + 1}`}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-400">PDF 지도를 먼저 선택해 주세요.</div>
                        )}
                    </div>

                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="text-sm font-bold text-gray-700">생성된 역사교실</div>
                        <div className="mt-4 space-y-3">
                            {assignments.map((assignment) => (
                                <div key={assignment.id} className="rounded-2xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-bold text-orange-500">{assignment.mapTitle}</div>
                                            <div className="text-lg font-black text-gray-900">{assignment.title}</div>
                                            <div className="mt-1 text-xs text-gray-500">통과 기준 {assignment.passThresholdPercent}% · 재응시 제한 {assignment.cooldownMinutes}분</div>
                                        </div>
                                        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                                            {assignment.targetStudentName || '학생 미지정'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {!assignments.length && <div className="text-sm text-gray-400">아직 생성된 역사교실 과제가 없습니다.</div>}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ManageHistoryClassroom;
