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
import { normalizeMapResource, type MapResource, type PdfMapRegion } from '../../lib/mapResources';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

interface StudentOption {
    uid: string;
    name: string;
    grade: string;
    className: string;
    number: string;
}

interface DragKeywordState {
    text: string;
    x: number;
    y: number;
}

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

const regionKey = (region: PdfMapRegion) => `${region.page}-${region.left}-${region.top}-${region.label}`;
const isSuspiciousKeyword = (value: string) => /[?\uFFFD]/u.test(value) || !/[가-힣A-Za-z0-9]/u.test(value);

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
    const [selectedBlankId, setSelectedBlankId] = useState('');
    const [highlightedRegionKey, setHighlightedRegionKey] = useState('');
    const [dragKeyword, setDragKeyword] = useState<DragKeywordState | null>(null);
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
                setCurrentPage((prev) => prev || loadedMaps[0].pdfPageImages?.[0]?.page || 1);
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

    useEffect(() => {
        if (!dragKeyword) return undefined;

        const handleDragOver = (event: DragEvent) => {
            setDragKeyword((prev) => (
                prev
                    ? {
                        ...prev,
                        x: event.clientX,
                        y: event.clientY,
                    }
                    : null
            ));
        };
        const handleDragEnd = () => {
            setDragKeyword(null);
        };

        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('drop', handleDragEnd);
        window.addEventListener('dragend', handleDragEnd);
        return () => {
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('drop', handleDragEnd);
            window.removeEventListener('dragend', handleDragEnd);
        };
    }, [dragKeyword]);

    const selectedMap = useMemo(
        () => maps.find((item) => item.id === selectedMapId) || null,
        [maps, selectedMapId],
    );

    const pageImage = useMemo(
        () => selectedMap?.pdfPageImages?.find((page) => page.page === currentPage) || null,
        [currentPage, selectedMap],
    );

    const allOcrRegions = useMemo(
        () => (selectedMap?.pdfRegions || []).filter((region) => String(region.label || '').trim()),
        [selectedMap],
    );

    const currentPageRegions = useMemo(
        () => allOcrRegions.filter((region) => region.page === currentPage),
        [allOcrRegions, currentPage],
    );

    const readableOcrRegions = useMemo(
        () => allOcrRegions.filter((region) => !isSuspiciousKeyword(region.label)),
        [allOcrRegions],
    );

    const suspiciousOcrRegions = useMemo(
        () => allOcrRegions.filter((region) => isSuspiciousKeyword(region.label)),
        [allOcrRegions],
    );

    const classFilteredStudents = useMemo(
        () => students.filter((student) =>
            (!targetGrade || student.grade === targetGrade)
            && (!targetClass || student.className === targetClass),
        ),
        [students, targetClass, targetGrade],
    );

    const currentPageBlanks = useMemo(
        () => blanks.filter((blank) => blank.page === currentPage),
        [blanks, currentPage],
    );

    const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!pageImage) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const left = event.clientX - rect.left;
        const top = event.clientY - rect.top;
        const created = createBlank(currentPage, left, top);
        setBlanks((prev) => [...prev, created]);
        setSelectedBlankId(created.id);
    };

    const handleBlankChange = (blankId: string, answer: string) => {
        setBlanks((prev) => prev.map((blank) => (
            blank.id === blankId ? { ...blank, answer } : blank
        )));
    };

    const handleBlankKeywordDrop = (blankId: string, text: string) => {
        if (!text.trim()) return;
        setBlanks((prev) => prev.map((blank) => (
            blank.id === blankId ? { ...blank, answer: text.trim() } : blank
        )));
        setSelectedBlankId(blankId);
    };

    const removeBlank = (blankId: string) => {
        setBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
        if (selectedBlankId === blankId) {
            setSelectedBlankId('');
        }
    };

    const createBlankFromRegion = (region: PdfMapRegion) => {
        const created = createBlank(
            region.page,
            region.left,
            region.top,
            region.label,
            Math.max(DEFAULT_BLANK_WIDTH, region.width),
            Math.max(DEFAULT_BLANK_HEIGHT, region.height),
        );
        setCurrentPage(region.page);
        setBlanks((prev) => [...prev, created]);
        setSelectedBlankId(created.id);
        setHighlightedRegionKey(regionKey(region));
    };

    const applyRegionToSelectedBlank = (region: PdfMapRegion) => {
        if (!selectedBlankId) {
            createBlankFromRegion(region);
            return;
        }
        setBlanks((prev) => prev.map((blank) => (
            blank.id === selectedBlankId
                ? {
                    ...blank,
                    page: region.page,
                    left: region.left,
                    top: region.top,
                    width: Math.max(blank.width, region.width),
                    height: Math.max(blank.height, region.height),
                    answer: region.label,
                }
                : blank
        )));
        setCurrentPage(region.page);
        setHighlightedRegionKey(regionKey(region));
    };

    const handleSave = async () => {
        if (!selectedMap || !title.trim() || !targetStudentUid) {
            alert('지도 제목과 대상 학생을 먼저 선택해 주세요.');
            return;
        }
        const student = students.find((item) => item.uid === targetStudentUid);
        if (!student) {
            alert('학생 정보를 찾을 수 없습니다.');
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
            setSelectedBlankId('');
            alert('역사교실 과제를 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('역사교실 과제 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

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
                    <p className="mt-2 text-sm text-gray-600">
                        OCR 박스를 바로 확인하면서 빈칸을 만들고, 우측 키워드 배너에서 정답을 드래그해 배치할 수 있습니다.
                    </p>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[23rem_minmax(0,1fr)_18rem]">
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
                                setHighlightedRegionKey('');
                            }}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                        >
                            {maps.map((map) => (
                                <option key={map.id} value={map.id}>{map.title}</option>
                            ))}
                        </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs font-bold text-gray-600">
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3">
                            <div className="text-[11px] text-gray-400">페이지</div>
                            <div className="mt-1 text-xl text-gray-900">{selectedMap?.pdfPageImages?.length || 0}</div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3">
                            <div className="text-[11px] text-gray-400">OCR 박스</div>
                            <div className="mt-1 text-xl text-gray-900">{allOcrRegions.length}</div>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-3 py-3">
                            <div className="text-[11px] text-gray-400">읽기 오류</div>
                            <div className="mt-1 text-xl text-amber-600">{suspiciousOcrRegions.length}</div>
                        </div>
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
                        <label className="mb-1 block text-xs font-bold text-gray-500">재응시 제한 시간(분)</label>
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
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                                <div className="text-sm font-bold text-gray-700">빈칸 목록</div>
                                <div className="mt-1 text-xs text-gray-500">우측 키워드를 드래그하거나 OCR 박스를 클릭해 채울 수 있습니다.</div>
                            </div>
                            <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">{blanks.length}개</div>
                        </div>
                        <div className="space-y-2">
                            {blanks.map((blank, index) => {
                                const isSelected = blank.id === selectedBlankId;
                                return (
                                    <div
                                        key={blank.id}
                                        className={`rounded-2xl border bg-white p-3 transition ${isSelected ? 'border-blue-300 shadow-md shadow-blue-100' : 'border-gray-200'}`}
                                        onClick={() => setSelectedBlankId(blank.id)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            handleBlankKeywordDrop(blank.id, event.dataTransfer.getData('text/plain'));
                                            setDragKeyword(null);
                                        }}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-gray-500">
                                            <span>빈칸 {index + 1} / p.{blank.page}</span>
                                            {isSelected && <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] text-blue-700">선택됨</span>}
                                        </div>
                                        <input
                                            value={blank.answer}
                                            onChange={(e) => handleBlankChange(blank.id, e.target.value)}
                                            placeholder="정답 입력 또는 키워드 드롭"
                                            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
                                        />
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <button type="button" onClick={() => setCurrentPage(blank.page)} className="text-xs font-bold text-blue-600">
                                                위치 보기
                                            </button>
                                            <button type="button" onClick={() => removeBlank(blank.id)} className="text-xs font-bold text-red-500">
                                                빈칸 삭제
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                            {!blanks.length && <div className="text-sm text-gray-400">지도 위를 누르거나 우측 OCR 키워드를 눌러 빈칸을 추가하세요.</div>}
                        </div>
                    </div>

                    <button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                        {saving ? '저장 중...' : '역사교실 저장'}
                    </button>
                </section>

                <section className="space-y-6">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-bold text-gray-700">PDF 편집 영역</div>
                                <div className="mt-1 text-xs text-gray-500">파란 박스는 OCR 결과입니다. 클릭하면 해당 위치로 빈칸이 생성되거나 선택한 빈칸에 적용됩니다.</div>
                            </div>
                            <div className="flex gap-2">
                                <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">이전</button>
                                <div className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700">{currentPage} / {selectedMap?.pdfPageImages?.length || 1}</div>
                                <button type="button" disabled={currentPage >= (selectedMap?.pdfPageImages?.length || 1)} onClick={() => setCurrentPage((prev) => Math.min(selectedMap?.pdfPageImages?.length || 1, prev + 1))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-700 disabled:opacity-40">다음</button>
                            </div>
                        </div>
                        {pageImage ? (
                            <div className="overflow-auto rounded-3xl border border-gray-200 bg-gray-100 p-4">
                                <div className="relative inline-block" onClick={handleCanvasClick}>
                                    <img src={pageImage.imageUrl} alt={selectedMap?.title || 'map'} style={{ width: `${pageImage.width}px`, maxWidth: 'none' }} />
                                    {currentPageRegions.map((region) => {
                                        const key = regionKey(region);
                                        const suspicious = isSuspiciousKeyword(region.label);
                                        const isActive = highlightedRegionKey === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    applyRegionToSelectedBlank(region);
                                                }}
                                                className={`absolute overflow-hidden rounded-xl border text-left transition ${suspicious ? 'border-amber-400 bg-amber-100/55' : 'border-sky-400 bg-sky-100/45 hover:bg-sky-100/70'} ${isActive ? 'ring-4 ring-blue-300' : ''}`}
                                                style={{
                                                    left: `${region.left}px`,
                                                    top: `${region.top}px`,
                                                    width: `${Math.max(region.width, 90)}px`,
                                                    height: `${Math.max(region.height, 34)}px`,
                                                }}
                                                title={region.label}
                                            >
                                                <span className="block truncate bg-white/80 px-2 py-1 text-[11px] font-bold text-gray-700">{region.label}</span>
                                            </button>
                                        );
                                    })}
                                    {currentPageBlanks.map((blank, index) => (
                                        <div
                                            key={blank.id}
                                            className={`absolute rounded-xl border-2 border-dashed bg-white/95 px-3 py-2 text-sm font-bold text-gray-700 shadow-sm ${blank.id === selectedBlankId ? 'border-orange-600 ring-4 ring-orange-200' : 'border-orange-500'}`}
                                            style={{
                                                left: `${blank.left}px`,
                                                top: `${blank.top}px`,
                                                width: `${blank.width}px`,
                                                height: `${blank.height}px`,
                                            }}
                                        >
                                            <div className="line-clamp-2">{blank.answer || `빈칸 ${index + 1}`}</div>
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
                            {!assignments.length && <div className="text-sm text-gray-400">아직 생성된 역사교실 과제가 없습니다.</div>}
                        </div>
                    </div>
                </section>

                <aside className="xl:sticky xl:top-24 xl:self-start">
                    <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-start justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold uppercase tracking-[0.18em] text-gray-400">OCR Keywords</div>
                                <h2 className="mt-1 text-lg font-extrabold text-gray-900">우측 플로팅 배너</h2>
                            </div>
                            <div className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{readableOcrRegions.length}</div>
                        </div>
                        <p className="mb-4 text-xs leading-5 text-gray-500">
                            한 줄씩 드래그해 빈칸 정답에 떨어뜨리거나 클릭해서 해당 OCR 위치를 바로 확인합니다.
                        </p>
                        <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
                            {readableOcrRegions.map((region) => (
                                <button
                                    key={regionKey(region)}
                                    type="button"
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = 'copy';
                                        event.dataTransfer.setData('text/plain', region.label);
                                        const ghost = document.createElement('div');
                                        ghost.style.position = 'absolute';
                                        ghost.style.left = '-9999px';
                                        ghost.style.top = '-9999px';
                                        ghost.textContent = '';
                                        document.body.appendChild(ghost);
                                        event.dataTransfer.setDragImage(ghost, 0, 0);
                                        window.setTimeout(() => document.body.removeChild(ghost), 0);
                                        setDragKeyword({
                                            text: region.label,
                                            x: event.clientX,
                                            y: event.clientY,
                                        });
                                        setHighlightedRegionKey(regionKey(region));
                                    }}
                                    onDragEnd={() => setDragKeyword(null)}
                                    onClick={() => {
                                        setCurrentPage(region.page);
                                        setHighlightedRegionKey(regionKey(region));
                                        applyRegionToSelectedBlank(region);
                                    }}
                                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-3 text-left text-sm font-bold text-gray-700 transition hover:border-blue-200 hover:bg-blue-50"
                                >
                                    <span className="truncate">{region.label}</span>
                                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500">p.{region.page}</span>
                                </button>
                            ))}
                            {suspiciousOcrRegions.length > 0 && (
                                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                                    <div className="text-xs font-bold text-amber-700">확인이 필요한 OCR</div>
                                    <div className="mt-2 space-y-2">
                                        {suspiciousOcrRegions.map((region) => (
                                            <button
                                                key={regionKey(region)}
                                                type="button"
                                                onClick={() => {
                                                    setCurrentPage(region.page);
                                                    setHighlightedRegionKey(regionKey(region));
                                                }}
                                                className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-xs font-bold text-amber-700"
                                            >
                                                <span className="truncate">{region.label}</span>
                                                <span className="shrink-0">p.{region.page}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {!allOcrRegions.length && (
                                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-center text-sm text-gray-400">
                                    OCR 키워드가 없습니다. 먼저 PDF 지도에서 OCR 추출이 완료된 자료를 선택해 주세요.
                                </div>
                            )}
                        </div>
                    </div>
                </aside>
            </div>

            {dragKeyword && (
                <div
                    className="pointer-events-none fixed z-[100] rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-2xl"
                    style={{
                        left: dragKeyword.x + 18,
                        top: dragKeyword.y + 18,
                        transform: 'translate3d(0, 0, 0)',
                    }}
                >
                    {dragKeyword.text}
                </div>
            )}
        </div>
    );
};

export default ManageHistoryClassroom;
