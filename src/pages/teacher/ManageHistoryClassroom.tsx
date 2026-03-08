import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { normalizeMapResource, type MapResource } from '../../lib/mapResources';
import {
    buildAnswerOptions,
    normalizeHistoryClassroomAssignment,
    type HistoryClassroomAssignment,
    type HistoryClassroomBlank,
} from '../../lib/historyClassroom';
import { getSemesterCollectionPath } from '../../lib/semesterScope';
import { cloneDefaultMenus, sanitizeMenuConfig } from '../../constants/menus';

interface StudentOption {
    uid: string;
    name: string;
    grade: string;
    className: string;
    number: string;
}

const createBlank = (page: number, left: number, top: number): HistoryClassroomBlank => ({
    id: `blank-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    page,
    left,
    top,
    width: 140,
    height: 52,
    answer: '',
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
    const [targetGrade, setTargetGrade] = useState('');
    const [targetClass, setTargetClass] = useState('');
    const [targetStudentUid, setTargetStudentUid] = useState('');
    const [blanks, setBlanks] = useState<HistoryClassroomBlank[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [saving, setSaving] = useState(false);
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
                const menuConfig = menuSnap.exists()
                    ? sanitizeMenuConfig(menuSnap.data())
                    : cloneDefaultMenus();
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

    const classFilteredStudents = useMemo(
        () => students.filter((student) =>
            (!targetGrade || student.grade === targetGrade)
            && (!targetClass || student.className === targetClass),
        ),
        [students, targetClass, targetGrade],
    );

    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!pageImage) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const left = event.clientX - rect.left;
        const top = event.clientY - rect.top;
        setBlanks((prev) => [...prev, createBlank(currentPage, left, top)]);
    };

    const handleBlankChange = (blankId: string, answer: string) => {
        setBlanks((prev) => prev.map((blank) => (
            blank.id === blankId ? { ...blank, answer } : blank
        )));
    };

    const removeBlank = (blankId: string) => {
        setBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
    };

    const handleSave = async () => {
        if (!selectedMap || !title.trim() || !targetStudentUid) {
            alert('지도, 제목, 학생 배정을 먼저 선택해 주세요.');
            return;
        }
        const student = students.find((item) => item.uid === targetStudentUid);
        if (!student) {
            alert('학생 정보가 없습니다.');
            return;
        }
        if (!blanks.length || blanks.some((blank) => !blank.answer.trim())) {
            alert('모든 빈칸의 정답을 입력해 주세요.');
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
            setBlanks([]);
            alert('역사교실을 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('역사교실 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-7xl px-4 py-8">
            <div className="mb-8 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                <div className="flex overflow-x-auto border-b border-gray-200 bg-white px-2">
                    <button
                        type="button"
                        onClick={() => navigate('/teacher/quiz')}
                        className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
                    >
                        {tabLabels.manage}
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/teacher/quiz?tab=log')}
                        className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
                    >
                        {tabLabels.log}
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/teacher/quiz?tab=bank')}
                        className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
                    >
                        {tabLabels.bank}
                    </button>
                    <button
                        type="button"
                        className="border-b-2 border-blue-500 bg-blue-50 px-6 py-3 text-sm font-bold text-blue-600 transition"
                    >
                        {tabLabels.historyClassroom}
                    </button>
                </div>
                <div className="p-6">
                    <h1 className="text-3xl font-black text-gray-900">역사교실 제작</h1>
                    <p className="mt-2 text-sm text-gray-600">PDF 지도 위 원하는 위치를 눌러 빈칸을 만들고, 특정 학생에게만 공개할 수 있습니다.</p>
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
                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">사용 제한 시간(분)</label>
                        <input type="number" min={0} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
                        <select value={targetGrade} onChange={(e) => { setTargetGrade(e.target.value); setTargetClass(''); setTargetStudentUid(''); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">학년 선택</option>
                            {Array.from(new Set(students.map((student) => student.grade).filter(Boolean))).map((grade) => (
                                <option key={grade} value={grade}>{grade}학년</option>
                            ))}
                        </select>
                        <select value={targetClass} onChange={(e) => { setTargetClass(e.target.value); setTargetStudentUid(''); }} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">반 선택</option>
                            {Array.from(new Set(students.filter((student) => !targetGrade || student.grade === targetGrade).map((student) => student.className).filter(Boolean))).map((className) => (
                                <option key={className} value={className}>{className}반</option>
                            ))}
                        </select>
                        <select value={targetStudentUid} onChange={(e) => setTargetStudentUid(e.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
                            <option value="">학생 선택</option>
                            {classFilteredStudents.map((student) => (
                                <option key={student.uid} value={student.uid}>
                                    {student.grade}-{student.className} {student.number}번 {student.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                        <div className="mb-2 text-sm font-bold text-gray-700">빈칸 목록</div>
                        <div className="space-y-2">
                            {blanks.map((blank, index) => (
                                <div key={blank.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                                    <div className="mb-2 text-xs font-bold text-gray-500">빈칸 {index + 1} / p.{blank.page}</div>
                                    <input
                                        value={blank.answer}
                                        onChange={(e) => handleBlankChange(blank.id, e.target.value)}
                                        placeholder="정답 입력"
                                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                                    />
                                    <button type="button" onClick={() => removeBlank(blank.id)} className="mt-2 text-xs font-bold text-red-500">
                                        빈칸 삭제
                                    </button>
                                </div>
                            ))}
                            {!blanks.length && <div className="text-sm text-gray-400">지도 위를 눌러 빈칸을 추가하세요.</div>}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60"
                    >
                        {saving ? '저장 중...' : '역사교실 저장'}
                    </button>
                </section>

                <section className="space-y-6">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-center justify-between">
                            <div className="text-sm font-bold text-gray-700">지도 편집 영역</div>
                            <div className="flex gap-2">
                                <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">이전</button>
                                <button type="button" disabled={currentPage >= (selectedMap?.pdfPageImages?.length || 1)} onClick={() => setCurrentPage((prev) => Math.min(selectedMap?.pdfPageImages?.length || 1, prev + 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">다음</button>
                            </div>
                        </div>
                        {pageImage ? (
                            <div className="overflow-auto rounded-3xl border border-gray-200 bg-gray-100 p-4">
                                <div className="relative inline-block" onClick={handleCanvasClick}>
                                    <img src={pageImage.imageUrl} alt={selectedMap?.title || 'map'} style={{ width: `${pageImage.width}px`, maxWidth: 'none' }} />
                                    {blanks.filter((blank) => blank.page === currentPage).map((blank, index) => (
                                        <div
                                            key={blank.id}
                                            className="absolute rounded-xl border-2 border-dashed border-orange-500 bg-white/90 px-3 py-2 text-sm font-bold text-gray-700 shadow-sm"
                                            style={{
                                                left: `${blank.left}px`,
                                                top: `${blank.top}px`,
                                                width: `${blank.width}px`,
                                                height: `${blank.height}px`,
                                            }}
                                        >
                                            {index + 1}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-400">
                                전처리된 PDF 지도를 먼저 선택해 주세요.
                            </div>
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
                                        </div>
                                        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                                            {assignment.targetStudentName || '학생 미지정'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {!assignments.length && <div className="text-sm text-gray-400">아직 생성된 역사교실이 없습니다.</div>}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default ManageHistoryClassroom;
