import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import LessonWorksheetStage from '../../components/common/LessonWorksheetStage';
import { useAuth } from '../../contexts/AuthContext';
import { cloneDefaultMenus, sanitizeMenuConfig } from '../../constants/menus';
import { db } from '../../lib/firebase';
import {
    buildAnswerOptions,
    normalizeHistoryClassroomAssignment,
    normalizeHistoryClassroomResult,
    type HistoryClassroomAssignment,
    type HistoryClassroomBlank,
    type HistoryClassroomResult,
} from '../../lib/historyClassroom';
import {
    clampRatio,
    getTightTextRegionBounds,
    type LessonWorksheetBlank,
    type LessonWorksheetPageImage,
    type LessonWorksheetTextRegion,
} from '../../lib/lessonWorksheet';
import { normalizeMapResource, type MapResource } from '../../lib/mapResources';
import { getSemesterCollectionPath } from '../../lib/semesterScope';

interface StudentOption {
    uid: string;
    name: string;
    grade: string;
    className: string;
    number: string;
}

const createWorksheetBlankFromRect = (
    page: number,
    rect: {
        leftRatio: number;
        topRatio: number;
        widthRatio: number;
        heightRatio: number;
    },
    source: 'ocr' | 'manual' = 'manual',
): LessonWorksheetBlank => ({
    id: `blank-${page}-${Date.now()}`,
    page,
    leftRatio: rect.leftRatio,
    topRatio: rect.topRatio,
    widthRatio: rect.widthRatio,
    heightRatio: rect.heightRatio,
    answer: '',
    prompt: '',
    source,
});

const getBlankAnswerFromRegions = (regions: LessonWorksheetTextRegion[]) => regions
    .map((region) => String(region.label || '').trim())
    .filter(Boolean)
    .join(' ');

const getBoundsFromRegions = (
    regions: LessonWorksheetTextRegion[],
    pageImage?: LessonWorksheetPageImage | null,
) => {
    if (!regions.length || !pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
        return null;
    }

    const tightened = regions
        .map((region) => getTightTextRegionBounds(region, pageImage))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (!tightened.length) {
        return null;
    }

    const left = Math.min(...tightened.map((region) => region.left));
    const top = Math.min(...tightened.map((region) => region.top));
    const right = Math.max(...tightened.map((region) => region.left + region.width));
    const bottom = Math.max(...tightened.map((region) => region.top + region.height));

    return {
        leftRatio: clampRatio(left / pageImage.width),
        topRatio: clampRatio(top / pageImage.height),
        widthRatio: clampRatio((right - left) / pageImage.width),
        heightRatio: clampRatio((bottom - top) / pageImage.height),
    };
};

const parseNumericLike = (value: string) => {
    const normalized = String(value || '').trim();
    if (!normalized) return Number.NaN;
    const direct = Number(normalized);
    if (Number.isFinite(direct)) return direct;
    const matched = normalized.match(/\d+/);
    return matched ? Number(matched[0]) : Number.NaN;
};

const compareSchoolValues = (a: string, b: string) => {
    const aNumber = parseNumericLike(a);
    const bNumber = parseNumericLike(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
        return aNumber - bNumber;
    }
    if (Number.isFinite(aNumber) && !Number.isFinite(bNumber)) return -1;
    if (!Number.isFinite(aNumber) && Number.isFinite(bNumber)) return 1;
    return a.localeCompare(b, 'ko');
};

const historyBlankToWorksheetBlank = (
    blank: HistoryClassroomBlank,
    pageImage?: LessonWorksheetPageImage | null,
): LessonWorksheetBlank | null => {
    if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
        return null;
    }

    return {
        id: blank.id,
        page: blank.page,
        leftRatio: clampRatio(blank.left / pageImage.width),
        topRatio: clampRatio(blank.top / pageImage.height),
        widthRatio: clampRatio(blank.width / pageImage.width),
        heightRatio: clampRatio(blank.height / pageImage.height),
        answer: blank.answer,
        prompt: '',
        source: 'manual',
    };
};

const worksheetBlankToHistoryBlank = (
    blank: LessonWorksheetBlank,
    pageImage?: LessonWorksheetPageImage | null,
): HistoryClassroomBlank | null => {
    if (!pageImage || pageImage.width <= 0 || pageImage.height <= 0) {
        return null;
    }

    return {
        id: blank.id,
        page: blank.page,
        left: Math.round(blank.leftRatio * pageImage.width),
        top: Math.round(blank.topRatio * pageImage.height),
        width: Math.max(1, Math.round(blank.widthRatio * pageImage.width)),
        height: Math.max(1, Math.round(blank.heightRatio * pageImage.height)),
        answer: blank.answer.trim(),
    };
};

const ManageHistoryClassroom: React.FC = () => {
    const { config } = useAuth();
    const navigate = useNavigate();

    const [maps, setMaps] = useState<MapResource[]>([]);
    const [assignments, setAssignments] = useState<HistoryClassroomAssignment[]>([]);
    const [resultsByAssignment, setResultsByAssignment] = useState<Record<string, HistoryClassroomResult[]>>({});
    const [students, setStudents] = useState<StudentOption[]>([]);
    const [selectedMapId, setSelectedMapId] = useState('');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [timeLimitMinutes, setTimeLimitMinutes] = useState(0);
    const [cooldownMinutes, setCooldownMinutes] = useState(0);
    const [passThresholdPercent, setPassThresholdPercent] = useState(80);
    const [targetGrade, setTargetGrade] = useState('');
    const [targetClass, setTargetClass] = useState('');
    const [targetNumber, setTargetNumber] = useState('');
    const [targetStudentUid, setTargetStudentUid] = useState('');
    const [selectedStudentUids, setSelectedStudentUids] = useState<string[]>([]);
    const [blanks, setBlanks] = useState<HistoryClassroomBlank[]>([]);
    const [saving, setSaving] = useState(false);
    const [selectedBlankId, setSelectedBlankId] = useState('');
    const [draftBlank, setDraftBlank] = useState<any>(null);
    const [draftBlankAnswer, setDraftBlankAnswer] = useState('');
    const [worksheetTool, setWorksheetTool] = useState<'ocr' | 'box'>('box');
    const [showAllBlankTags, setShowAllBlankTags] = useState(false);
    const [floatingPanelOpen, setFloatingPanelOpen] = useState(false);
    const [editingAssignmentId, setEditingAssignmentId] = useState('');
    const [editingTitle, setEditingTitle] = useState('');
    const [editingDescription, setEditingDescription] = useState('');
    const [editingTimeLimitMinutes, setEditingTimeLimitMinutes] = useState(0);
    const [editingCooldownMinutes, setEditingCooldownMinutes] = useState(0);
    const [editingPassThresholdPercent, setEditingPassThresholdPercent] = useState(80);
    const [editingStudentUids, setEditingStudentUids] = useState<string[]>([]);
    const [savingEdit, setSavingEdit] = useState(false);
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
                .filter((item): item is StudentOption => !!item && !!item.uid)
                .sort((a, b) => (
                    compareSchoolValues(a.grade, b.grade)
                    || compareSchoolValues(a.className, b.className)
                    || compareSchoolValues(a.number, b.number)
                    || a.name.localeCompare(b.name, 'ko')
                ));
            setStudents(loadedStudents);

            const assignmentPath = getSemesterCollectionPath(config, 'history_classrooms');
            let assignmentSnap = await getDocs(query(collection(db, assignmentPath), orderBy('updatedAt', 'desc')));
            if (assignmentSnap.empty) {
                assignmentSnap = await getDocs(query(collection(db, 'history_classrooms'), orderBy('updatedAt', 'desc')));
            }
            setAssignments(assignmentSnap.docs.map((docSnap) => normalizeHistoryClassroomAssignment(docSnap.id, docSnap.data())));

            const resultPath = getSemesterCollectionPath(config, 'history_classroom_results');
            let resultSnap = await getDocs(query(collection(db, resultPath), orderBy('createdAt', 'desc')));
            if (resultSnap.empty) {
                resultSnap = await getDocs(query(collection(db, 'history_classroom_results'), orderBy('createdAt', 'desc')));
            }
            const groupedResults: Record<string, HistoryClassroomResult[]> = {};
            resultSnap.docs.forEach((docSnap) => {
                const result = normalizeHistoryClassroomResult(docSnap.id, docSnap.data());
                groupedResults[result.assignmentId] = [...(groupedResults[result.assignmentId] || []), result];
            });
            setResultsByAssignment(groupedResults);
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

    useEffect(() => {
        setBlanks([]);
        setSelectedBlankId('');
        setDraftBlank(null);
        setDraftBlankAnswer('');
        setShowAllBlankTags(false);
    }, [selectedMapId]);

    const selectedMap = useMemo(
        () => maps.find((item) => item.id === selectedMapId) || null,
        [maps, selectedMapId],
    );

    const worksheetPageImages = useMemo(
        () => (selectedMap?.pdfPageImages || []).map((page) => ({
            page: page.page,
            imageUrl: page.imageUrl,
            width: page.width,
            height: page.height,
        })),
        [selectedMap],
    );

    const worksheetTextRegions = useMemo(
        () => (selectedMap?.pdfRegions || []).map((region) => ({
            label: region.label,
            page: region.page,
            left: region.left,
            top: region.top,
            width: region.width,
            height: region.height,
        })),
        [selectedMap],
    );

    const worksheetBlanks = useMemo(
        () => blanks
            .map((blank) => {
                const pageImage = worksheetPageImages.find((page) => page.page === blank.page) || null;
                return historyBlankToWorksheetBlank(blank, pageImage);
            })
            .filter((item): item is LessonWorksheetBlank => Boolean(item)),
        [blanks, worksheetPageImages],
    );

    const sortedBlanks = useMemo(
        () => [...blanks].sort((a, b) => (a.page - b.page) || (a.top - b.top) || (a.left - b.left)),
        [blanks],
    );

    const visibleBlankTags = useMemo(
        () => (showAllBlankTags ? sortedBlanks : sortedBlanks.slice(0, 6)),
        [showAllBlankTags, sortedBlanks],
    );

    const classFilteredStudents = useMemo(
        () => students.filter((student) => (!targetGrade || student.grade === targetGrade) && (!targetClass || student.className === targetClass)),
        [students, targetClass, targetGrade],
    );

    const numberFilteredStudents = useMemo(
        () => classFilteredStudents.filter((student) => !targetNumber || student.number === targetNumber),
        [classFilteredStudents, targetNumber],
    );

    const selectedStudents = useMemo(
        () => selectedStudentUids
            .map((uid) => students.find((student) => student.uid === uid))
            .filter((student): student is StudentOption => !!student),
        [selectedStudentUids, students],
    );

    const gradeOptions = useMemo(
        () => Array.from(new Set(students.map((student) => student.grade).filter(Boolean))).sort(compareSchoolValues),
        [students],
    );

    const classOptions = useMemo(
        () => Array.from(new Set(
            students
                .filter((student) => !targetGrade || student.grade === targetGrade)
                .map((student) => student.className)
                .filter(Boolean),
        )).sort(compareSchoolValues),
        [students, targetGrade],
    );

    const numberOptions = useMemo(
        () => Array.from(new Set(classFilteredStudents.map((student) => student.number).filter(Boolean))).sort(compareSchoolValues),
        [classFilteredStudents],
    );

    const targetStudentPreview = useMemo(
        () => (
            numberFilteredStudents.find((student) => student.uid === targetStudentUid)
            || (targetNumber && numberFilteredStudents.length === 1 ? numberFilteredStudents[0] : null)
        ),
        [numberFilteredStudents, targetNumber, targetStudentUid],
    );

    const editingAssignment = useMemo(
        () => assignments.find((assignment) => assignment.id === editingAssignmentId) || null,
        [assignments, editingAssignmentId],
    );

    const editingStudents = useMemo(
        () => editingStudentUids
            .map((uid) => students.find((student) => student.uid === uid))
            .filter((student): student is StudentOption => !!student),
        [editingStudentUids, students],
    );

    const editingResults = useMemo(
        () => resultsByAssignment[editingAssignmentId] || [],
        [editingAssignmentId, resultsByAssignment],
    );

    const selectedBlank = useMemo<any>(
        () => blanks.find((blank) => blank.id === selectedBlankId) || null,
        [blanks, selectedBlankId],
    );

    useEffect(() => {
        if (sortedBlanks.length <= 6 && showAllBlankTags) {
            setShowAllBlankTags(false);
        }
    }, [showAllBlankTags, sortedBlanks.length]);

    useEffect(() => {
        if (!numberFilteredStudents.length) {
            setTargetStudentUid('');
            return;
        }

        if (numberFilteredStudents.some((student) => student.uid === targetStudentUid)) {
            return;
        }

        if (numberFilteredStudents.length === 1) {
            setTargetStudentUid(numberFilteredStudents[0].uid);
            return;
        }

        setTargetStudentUid('');
    }, [numberFilteredStudents, targetStudentUid]);

    const handleCreateBlankFromSelection = (
        page: number,
        rect: {
            leftRatio: number;
            topRatio: number;
            widthRatio: number;
            heightRatio: number;
        },
        matchedRegions: LessonWorksheetTextRegion[],
        source: 'ocr' | 'manual',
    ) => {
        const pageImage = worksheetPageImages.find((item) => item.page === page) || null;
        const regionBounds = getBoundsFromRegions(matchedRegions, pageImage);
        const blank = createWorksheetBlankFromRect(page, regionBounds || rect, matchedRegions.length ? 'ocr' : source);
        setDraftBlank(blank);
        setDraftBlankAnswer(getBlankAnswerFromRegions(matchedRegions));
        setSelectedBlankId('');
    };

    const handleConfirmDraftBlank = () => {
        if (!draftBlank) return;

        const answer = draftBlankAnswer.trim();
        if (!answer) {
            alert('빈칸 정답을 입력해 주세요.');
            return;
        }

        const pageImage = worksheetPageImages.find((item) => item.page === draftBlank.page) || null;
        const nextBlank = worksheetBlankToHistoryBlank({ ...draftBlank, answer }, pageImage);
        if (!nextBlank) return;

        setBlanks((prev) => [...prev, nextBlank]);
        setSelectedBlankId(nextBlank.id);
        setDraftBlank(null);
        setDraftBlankAnswer('');
    };

    const handleCancelDraftBlank = () => {
        setDraftBlank(null);
        setDraftBlankAnswer('');
    };

    const handleSelectBlank = (blankId: string) => {
        setSelectedBlankId(blankId);
        setDraftBlank(null);
        setDraftBlankAnswer('');
    };

    const handleBlankChange = (blankId: string, answer: string) => {
        setBlanks((prev) => prev.map((blank) => (blank.id === blankId ? { ...blank, answer } : blank)));
    };

    const removeBlank = (blankId: string) => {
        setBlanks((prev) => prev.filter((blank) => blank.id !== blankId));
        if (selectedBlankId === blankId) setSelectedBlankId('');
    };

    const openAssignmentEditor = (assignment: HistoryClassroomAssignment) => {
        setEditingAssignmentId(assignment.id);
        setEditingTitle(assignment.title);
        setEditingDescription(assignment.description);
        setEditingTimeLimitMinutes(assignment.timeLimitMinutes);
        setEditingCooldownMinutes(assignment.cooldownMinutes);
        setEditingPassThresholdPercent(assignment.passThresholdPercent);
        setEditingStudentUids(assignment.targetStudentUids.length ? assignment.targetStudentUids : (assignment.targetStudentUid ? [assignment.targetStudentUid] : []));
    };

    const closeAssignmentEditor = () => {
        setEditingAssignmentId('');
        setEditingTitle('');
        setEditingDescription('');
        setEditingTimeLimitMinutes(0);
        setEditingCooldownMinutes(0);
        setEditingPassThresholdPercent(80);
        setEditingStudentUids([]);
        setSavingEdit(false);
    };

    const handleSaveAssignmentEdit = async () => {
        const targetAssignment = assignments.find((assignment) => assignment.id === editingAssignmentId);
        if (!targetAssignment) return;
        const updatedStudents = students.filter((student) => editingStudentUids.includes(student.uid));
        if (!editingTitle.trim() || !updatedStudents.length) {
            alert('제목과 배정 학생을 확인해주세요.');
            return;
        }

        setSavingEdit(true);
        try {
            const payload: Omit<HistoryClassroomAssignment, 'id'> = {
                ...targetAssignment,
                title: editingTitle.trim(),
                description: editingDescription.trim(),
                timeLimitMinutes: Math.max(0, editingTimeLimitMinutes),
                cooldownMinutes: Math.max(0, editingCooldownMinutes),
                passThresholdPercent: Math.min(100, Math.max(0, editingPassThresholdPercent)),
                targetGrade: updatedStudents[0]?.grade || '',
                targetClass: updatedStudents[0]?.className || '',
                targetStudentUid: updatedStudents[0]?.uid || '',
                targetStudentUids: updatedStudents.map((student) => student.uid),
                targetStudentName: updatedStudents.map((student) => student.name).join(', '),
                targetStudentNames: updatedStudents.map((student) => student.name),
                targetStudentNumber: updatedStudents.map((student) => student.number).filter(Boolean).join(', '),
                updatedAt: serverTimestamp(),
            };

            await setDoc(doc(db, getSemesterCollectionPath(config, 'history_classrooms'), targetAssignment.id), payload, { merge: true });
            setAssignments((prev) => prev.map((assignment) => (
                assignment.id === targetAssignment.id
                    ? normalizeHistoryClassroomAssignment(targetAssignment.id, payload)
                    : assignment
            )));
            closeAssignmentEditor();
        } catch (error) {
            console.error(error);
            alert('역사교실 수정에 실패했습니다.');
            setSavingEdit(false);
        }
    };

    const handleSave = async () => {
        if (!selectedMap || !title.trim() || !selectedStudentUids.length) {
            alert('지도, 제목, 대상 학생을 먼저 선택해 주세요.');
            return;
        }
        if (!selectedStudents.length) {
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
                timeLimitMinutes,
                cooldownMinutes,
                passThresholdPercent,
                targetGrade: targetGrade || selectedStudents[0]?.grade || '',
                targetClass: targetClass || selectedStudents[0]?.className || '',
                targetStudentUid: selectedStudents[0]?.uid || '',
                targetStudentUids: selectedStudents.map((student) => student.uid),
                targetStudentName: selectedStudents.map((student) => student.name).join(', '),
                targetStudentNames: selectedStudents.map((student) => student.name),
                targetStudentNumber: selectedStudents.map((student) => student.number).filter(Boolean).join(', '),
                isPublished: true,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            };
            await setDoc(doc(db, getSemesterCollectionPath(config, 'history_classrooms'), assignmentId), payload);
            setAssignments((prev) => [normalizeHistoryClassroomAssignment(assignmentId, payload), ...prev]);
            setTitle('');
            setDescription('');
            setTimeLimitMinutes(0);
            setCooldownMinutes(0);
            setPassThresholdPercent(80);
            setTargetGrade('');
            setTargetClass('');
            setTargetNumber('');
            setTargetStudentUid('');
            setSelectedStudentUids([]);
            setBlanks([]);
            setSelectedBlankId('');
            setDraftBlank(null);
            setDraftBlankAnswer('');
            setShowAllBlankTags(false);
            alert('역사교실 과제를 저장했습니다.');
        } catch (error) {
            console.error(error);
            alert('역사교실 과제 저장에 실패했습니다.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="mx-auto max-w-[96rem] px-4 py-5 sm:py-8">
            <div className="mb-4 flex shrink-0 overflow-x-auto rounded-t-lg border-b border-gray-200 bg-white px-2">
                    <button type="button" onClick={() => navigate('/teacher/quiz')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.manage}
                    </button>
                    <button type="button" onClick={() => navigate('/teacher/quiz?tab=log')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.log}
                    </button>
                    <button type="button" onClick={() => navigate('/teacher/quiz?tab=bank')} className="border-b-2 border-transparent px-6 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-50">
                        {tabLabels.bank}
                    </button>
                    <button type="button" className="border-b-2 border-blue-500 px-6 py-3 text-sm font-bold text-blue-600 transition">
                        {tabLabels.historyClassroom}
                    </button>
            </div>
            <div className="mb-8 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
                <div className="p-4 sm:p-6">
                    <h1 className="text-2xl font-black text-gray-900 sm:text-3xl">역사교실 제작</h1>
                    <p className="mt-2 text-sm text-gray-600">텍스트 박스 또는 OCR 선택으로 빈칸을 만들고, 원하는 학생에게 개별 과제를 배정합니다.</p>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
                <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">PDF 지도 선택</label>
                        <select
                            value={selectedMapId}
                            onChange={(e) => {
                                setSelectedMapId(e.target.value);
                                setTargetStudentUid('');
                                setSelectedStudentUids([]);
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
                            <label className="mb-1 block text-xs font-bold text-gray-500">제한 시간(분)</label>
                            <input type="number" min={0} value={timeLimitMinutes} onChange={(e) => setTimeLimitMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">재도전 제한 시간(분)</label>
                            <input type="number" min={0} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">통과 기준 (%)</label>
                            <input type="number" min={0} max={100} value={passThresholdPercent} onChange={(e) => setPassThresholdPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <div className="grid gap-3 lg:grid-cols-4">
                            <select value={targetGrade} onChange={(e) => { setTargetGrade(e.target.value); setTargetClass(''); setTargetNumber(''); setTargetStudentUid(''); }} className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm">
                                <option value="">학년 선택</option>
                                {gradeOptions.map((grade) => (
                                    <option key={grade} value={grade}>{grade}</option>
                                ))}
                            </select>
                            <select value={targetClass} onChange={(e) => { setTargetClass(e.target.value); setTargetNumber(''); setTargetStudentUid(''); }} className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm">
                                <option value="">학급 선택</option>
                                {classOptions.map((className) => (
                                    <option key={className} value={className}>{className}</option>
                                ))}
                            </select>
                            <select value={targetNumber} onChange={(e) => { setTargetNumber(e.target.value); setTargetStudentUid(''); }} className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm">
                                <option value="">번호 선택</option>
                                {numberOptions.map((number) => (
                                    <option key={number} value={number}>{number}</option>
                                ))}
                            </select>
                            <div className="flex min-h-[42px] items-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-700">
                                {targetStudentPreview?.name || '학생 이름'}
                            </div>
                        </div>
                        <select
                            value={targetStudentUid}
                            onChange={(e) => setTargetStudentUid(e.target.value)}
                            className="w-full min-w-0 rounded-xl border border-gray-300 px-3 py-2 text-sm"
                            title={targetStudentPreview ? `${targetStudentPreview.grade}-${targetStudentPreview.className} ${targetStudentPreview.number}번 ${targetStudentPreview.name}` : '학생 선택'}
                        >
                            <option value="">학생 선택</option>
                            {numberFilteredStudents.map((student) => (
                                <option key={student.uid} value={student.uid}>{student.grade}-{student.className} {student.number}번 {student.name}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => {
                                if (!targetStudentUid || selectedStudentUids.includes(targetStudentUid)) return;
                                setSelectedStudentUids((prev) => [...prev, targetStudentUid]);
                                setTargetStudentUid('');
                            }}
                            disabled={!targetStudentUid || selectedStudentUids.includes(targetStudentUid)}
                            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            학생 추가
                        </button>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-sm font-bold text-gray-700">배정 학생</div>
                            <div className="inline-flex shrink-0 items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700 whitespace-nowrap">
                                {selectedStudents.length}명
                            </div>
                        </div>
                        <div className="space-y-2">
                            {selectedStudents.map((student) => (
                                <div key={student.uid} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                                    <div className="min-w-0 text-gray-700">
                                        <span className="font-bold">{student.grade}-{student.className}</span>{' '}
                                        <span>{student.number}번</span>{' '}
                                        <span className="font-bold text-gray-900">{student.name}</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedStudentUids((prev) => prev.filter((uid) => uid !== student.uid))}
                                        className="shrink-0 text-xs font-bold text-red-500"
                                    >
                                        제거
                                    </button>
                                </div>
                            ))}
                            {!selectedStudents.length && <div className="text-sm text-gray-400">학생을 선택해서 추가하면 여기에 여러 명이 목록으로 표시됩니다.</div>}
                        </div>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                                <div className="text-sm font-bold text-gray-700">역사교실 목록</div>
                                <div className="mt-1 text-xs text-gray-500">생성한 역사교실 과제를 여기에서 빠르게 확인할 수 있습니다.</div>
                            </div>
                            <div className="inline-flex shrink-0 items-center rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">{assignments.length}개</div>
                        </div>
                        <div className="space-y-3">
                            {assignments.slice(0, 5).map((assignment) => (
                                <button
                                    key={assignment.id}
                                    type="button"
                                    onClick={() => openAssignmentEditor(assignment)}
                                    className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-orange-200 hover:shadow-sm"
                                >
                                    <div className="text-xs font-bold text-orange-500">{assignment.mapTitle}</div>
                                    <div className="mt-1 text-base font-black text-gray-900 break-words">{assignment.title}</div>
                                    <div className="mt-2 inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 whitespace-nowrap">
                                        {(assignment.targetStudentNames.length
                                            ? `${assignment.targetStudentNames[0]}${assignment.targetStudentNames.length > 1 ? ` 외 ${assignment.targetStudentNames.length - 1}명` : ''}`
                                            : assignment.targetStudentName) || '학생 미지정'}
                                    </div>
                                    <div className="mt-2 text-xs text-gray-500">통과 기준 {assignment.passThresholdPercent}% · 제한 시간 {assignment.timeLimitMinutes > 0 ? `${assignment.timeLimitMinutes}분` : '없음'} · 재도전 제한 {assignment.cooldownMinutes}분</div>
                                </button>
                            ))}
                            {!assignments.length && <div className="text-sm text-gray-400">아직 생성된 역사교실 과제가 없습니다.</div>}
                        </div>
                    </div>

                    {false && (
                    <div className="rounded-2xl bg-gray-50 p-4">
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div>
                                <div className="text-sm font-bold text-gray-700">빈칸 목록</div>
                                <div className="mt-1 text-xs text-gray-500">추가한 단어는 우측 하단 패널에서도 빠르게 선택할 수 있습니다.</div>
                            </div>
                            <div className="inline-flex shrink-0 items-center rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600 whitespace-nowrap">{blanks.length}개</div>
                        </div>
                        <div className="space-y-2">
                            {sortedBlanks.map((blank, index) => (
                                <div
                                    key={blank.id}
                                    className={`rounded-2xl border bg-white p-3 transition ${blank.id === selectedBlankId ? 'border-blue-300 shadow-md shadow-blue-100' : 'border-gray-200'}`}
                                    onClick={() => handleSelectBlank(blank.id)}
                                >
                                    <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-gray-500">
                                        <span>빈칸 {index + 1} / p.{blank.page}</span>
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
                            {!blanks.length && <div className="text-sm text-gray-400">지도에서 영역을 드래그하거나 OCR 단어를 선택해 빈칸을 추가하세요.</div>}
                        </div>
                    </div>
                    )}

                    <button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                        {saving ? '저장 중...' : '역사교실 저장'}
                    </button>
                </section>

                <section className="space-y-6">
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <div className="text-sm font-bold text-gray-700">지도 선택 영역</div>
                                <div className="mt-1 text-xs text-gray-500">텍스트 박스는 자유 드래그, OCR 선택은 글자를 따라 빈칸을 잡습니다.</div>
                            </div>
                        </div>

                        {false && <div className="mb-4 space-y-3 lg:hidden">
                            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Tool</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setWorksheetTool('box')}
                                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                            worksheetTool === 'box'
                                                ? 'bg-blue-600 text-white shadow-sm'
                                                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        텍스트 박스
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setWorksheetTool('ocr')}
                                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                                            worksheetTool === 'ocr'
                                                ? 'bg-blue-600 text-white shadow-sm'
                                                : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        OCR 선택
                                    </button>
                                </div>
                            </div>

                            {(draftBlank || selectedBlank || sortedBlanks.length > 0) && (
                                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Words</div>
                                        <div className="text-[11px] font-semibold text-gray-500">{sortedBlanks.length}개</div>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                        {visibleBlankTags.map((blank, index) => (
                                            <button
                                                key={blank.id}
                                                type="button"
                                                onClick={() => handleSelectBlank(blank.id)}
                                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                                    selectedBlankId === blank.id
                                                        ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                                }`}
                                            >
                                                {blank.answer || `빈칸 ${index + 1}`}
                                            </button>
                                        ))}
                                        {sortedBlanks.length > 6 && (
                                            <button
                                                type="button"
                                                onClick={() => setShowAllBlankTags((prev) => !prev)}
                                                className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                                            >
                                                {showAllBlankTags ? '숨기기' : `더보기 +${sortedBlanks.length - visibleBlankTags.length}`}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>}

                        {worksheetPageImages.length > 0 ? (
                            <div className="mx-auto max-w-[56rem]">
                                <LessonWorksheetStage
                                    pageImages={worksheetPageImages}
                                    blanks={worksheetBlanks}
                                    textRegions={worksheetTextRegions}
                                    mode="teacher"
                                    teacherTool={worksheetTool}
                                    selectedBlankId={selectedBlankId || null}
                                    pendingBlank={draftBlank}
                                    onSelectBlank={handleSelectBlank}
                                    onDeleteBlank={removeBlank}
                                    onCreateBlankFromSelection={handleCreateBlankFromSelection}
                                />
                            </div>
                        ) : (
                            <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center text-gray-400">PDF 지도를 먼저 선택해 주세요.</div>
                        )}
                    </div>

                    {false && (
                    <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
                        <div className="text-sm font-bold text-gray-700">생성된 역사교실</div>
                        <div className="mt-4 space-y-3">
                            {assignments.map((assignment) => (
                                <div key={assignment.id} className="rounded-2xl border border-gray-200 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-bold text-orange-500">{assignment.mapTitle}</div>
                                            <div className="text-lg font-black text-gray-900">{assignment.title}</div>
                                            <div className="mt-1 text-xs text-gray-500">통과 기준 {assignment.passThresholdPercent}% · 재도전 제한 {assignment.cooldownMinutes}분</div>
                                        </div>
                                        <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700 whitespace-nowrap">
                                            {(assignment.targetStudentNames.length
                                                ? `${assignment.targetStudentNames[0]}${assignment.targetStudentNames.length > 1 ? ` 외 ${assignment.targetStudentNames.length - 1}명` : ''}`
                                                : assignment.targetStudentName) || '학생 미지정'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                            {!assignments.length && <div className="text-sm text-gray-400">아직 생성된 역사교실 과제가 없습니다.</div>}
                        </div>
                    </div>
                    )}
                </section>
            </div>

            {editingAssignment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6">
                    <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
                            <div>
                                <div className="text-xs font-bold text-orange-500">{editingAssignment.mapTitle}</div>
                                <div className="text-xl font-black text-gray-900">역사교실 설정 수정</div>
                            </div>
                            <button type="button" onClick={closeAssignmentEditor} className="text-sm font-bold text-gray-500 hover:text-gray-700">
                                닫기
                            </button>
                        </div>

                        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
                            <div className="max-h-[calc(90vh-73px)] overflow-y-auto px-6 py-5">
                                <div className="space-y-4">
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">제목</label>
                                        <input value={editingTitle} onChange={(e) => setEditingTitle(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-gray-500">설명</label>
                                        <textarea value={editingDescription} onChange={(e) => setEditingDescription(e.target.value)} rows={3} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                    </div>
                                    <div className="grid gap-3 md:grid-cols-3">
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-gray-500">제한 시간(분)</label>
                                            <input type="number" min={0} value={editingTimeLimitMinutes} onChange={(e) => setEditingTimeLimitMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-gray-500">재도전 제한(분)</label>
                                            <input type="number" min={0} value={editingCooldownMinutes} onChange={(e) => setEditingCooldownMinutes(Number(e.target.value) || 0)} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                        </div>
                                        <div>
                                            <label className="mb-1 block text-xs font-bold text-gray-500">통과 기준(%)</label>
                                            <input type="number" min={0} max={100} value={editingPassThresholdPercent} onChange={(e) => setEditingPassThresholdPercent(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
                                        </div>
                                    </div>

                                    <div className="rounded-2xl bg-gray-50 p-4">
                                        <div className="mb-3 flex items-center justify-between gap-2">
                                            <div className="text-sm font-bold text-gray-700">배정 학생</div>
                                            <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">{editingStudents.length}명</div>
                                        </div>
                                        <div className="space-y-2">
                                            {editingStudents.map((student) => (
                                                <div key={student.uid} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm">
                                                    <div className="min-w-0 text-gray-700">
                                                        <span className="font-bold">{student.grade}-{student.className}</span>{' '}
                                                        <span>{student.number}번</span>{' '}
                                                        <span className="font-bold text-gray-900">{student.name}</span>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditingStudentUids((prev) => prev.filter((uid) => uid !== student.uid))}
                                                        className="shrink-0 text-xs font-bold text-red-500"
                                                    >
                                                        삭제
                                                    </button>
                                                </div>
                                            ))}
                                            {!editingStudents.length && <div className="text-sm text-gray-400">배정 학생이 없습니다.</div>}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="max-h-[calc(90vh-73px)] overflow-y-auto border-t border-gray-200 bg-gray-50 px-6 py-5 lg:border-l lg:border-t-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-bold text-gray-700">결과</div>
                                    <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-gray-600">{editingResults.length}건</div>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {editingResults.map((result) => (
                                        <div key={result.id} className="rounded-2xl border border-gray-200 bg-white p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-bold text-gray-900">{result.studentName}</div>
                                                    <div className="text-xs text-gray-500">{[result.studentGrade, result.studentClass, result.studentNumber].filter(Boolean).join('-')}</div>
                                                </div>
                                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                                    result.status === 'passed'
                                                        ? 'bg-emerald-50 text-emerald-700'
                                                        : result.status === 'failed'
                                                            ? 'bg-rose-50 text-rose-700'
                                                            : 'bg-amber-50 text-amber-700'
                                                }`}>
                                                    {result.status === 'passed' ? '통과' : result.status === 'failed' ? '미통과' : '취소'}
                                                </span>
                                            </div>
                                            <div className="mt-2 text-xs text-gray-500">{result.score}/{result.total} · {result.percent}% · 기준 {result.passThresholdPercent}%</div>
                                        </div>
                                    ))}
                                    {!editingResults.length && <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-400">아직 결과가 없습니다.</div>}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
                            <button type="button" onClick={closeAssignmentEditor} className="rounded-2xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50">
                                취소
                            </button>
                            <button type="button" onClick={() => void handleSaveAssignmentEdit()} disabled={savingEdit} className="rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-60">
                                {savingEdit ? '저장 중...' : '설정 저장'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {false && (draftBlank || selectedBlank || sortedBlanks.length > 0) && (
                <div className="fixed bottom-5 right-5 z-40 hidden w-[min(18rem,calc(100vw-2.5rem))] space-y-2.5 lg:block">
                    <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Tool</div>
                            <div className="text-[11px] font-semibold text-gray-500">
                                {worksheetTool === 'box' ? '텍스트 박스' : 'OCR 선택'}
                            </div>
                        </div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <button
                                type="button"
                                onClick={() => setWorksheetTool('box')}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                    worksheetTool === 'box'
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                텍스트 박스
                            </button>
                            <button
                                type="button"
                                onClick={() => setWorksheetTool('ocr')}
                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                    worksheetTool === 'ocr'
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                            >
                                OCR 선택
                            </button>
                        </div>
                        <div className="mt-2 text-[11px] leading-4 text-gray-500">
                            {worksheetTool === 'box'
                                ? '드래그한 크기 그대로 빈칸 상자를 만듭니다.'
                                : '글자 위를 클릭하거나 드래그하면 OCR 단어를 기준으로 빈칸이 잡힙니다.'}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Words</div>
                            <div className="text-[11px] font-semibold text-gray-500">{sortedBlanks.length}개</div>
                        </div>
                        <div className="mt-2.5 flex max-h-28 flex-wrap gap-1.5 overflow-hidden">
                            {visibleBlankTags.map((blank, index) => (
                                <button
                                    key={blank.id}
                                    type="button"
                                    onClick={() => handleSelectBlank(blank.id)}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                        selectedBlankId === blank.id
                                            ? 'border-blue-300 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    {blank.answer || `빈칸 ${index + 1}`}
                                </button>
                            ))}
                            {sortedBlanks.length > 6 && (
                                <button
                                    type="button"
                                    onClick={() => setShowAllBlankTags((prev) => !prev)}
                                    className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                                >
                                    {showAllBlankTags ? '숨기기' : `더보기 +${sortedBlanks.length - visibleBlankTags.length}`}
                                </button>
                            )}
                        </div>
                    </div>

                    {draftBlank ? (
                        <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-white/98 p-3 shadow-2xl backdrop-blur">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-bold text-amber-900">새 빈칸 초안</div>
                                <button type="button" onClick={handleCancelDraftBlank} className="text-xs font-bold text-gray-500">
                                    취소
                                </button>
                            </div>
                            <div className="text-xs text-gray-500">p.{draftBlank.page} 영역을 선택했습니다.</div>
                            <input
                                type="text"
                                value={draftBlankAnswer}
                                onChange={(e) => setDraftBlankAnswer(e.target.value)}
                                className="w-full rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm"
                                placeholder="정답을 입력해 주세요"
                                autoFocus
                            />
                            <button
                                type="button"
                                onClick={handleConfirmDraftBlank}
                                className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600"
                            >
                                빈칸 추가
                            </button>
                        </div>
                    ) : selectedBlank ? (
                        <div className="space-y-2.5 rounded-2xl border border-blue-100 bg-white/98 p-3 shadow-2xl backdrop-blur">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-sm font-bold text-blue-900">선택한 빈칸</div>
                                <button type="button" onClick={() => removeBlank(selectedBlank.id)} className="text-xs font-bold text-red-600">
                                    삭제
                                </button>
                            </div>
                            <div className="text-xs text-gray-500">p.{selectedBlank.page}</div>
                            <input
                                type="text"
                                value={selectedBlank.answer}
                                onChange={(e) => handleBlankChange(selectedBlank.id, e.target.value)}
                                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                                placeholder="정답"
                            />
                        </div>
                    ) : null}
                </div>
            )}

            <div className="fixed bottom-5 right-5 z-40 flex max-w-[calc(100vw-2.5rem)] flex-col items-end gap-3">
                {floatingPanelOpen && (
                    <div className="w-[min(18rem,calc(100vw-2.5rem))] space-y-2.5">
                        <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Tool</div>
                                <div className="text-[11px] font-semibold text-gray-500">
                                    {worksheetTool === 'box' ? '텍스트 박스' : 'OCR 선택'}
                                </div>
                            </div>
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setWorksheetTool('box')}
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                        worksheetTool === 'box'
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    텍스트 박스
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setWorksheetTool('ocr')}
                                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                                        worksheetTool === 'ocr'
                                            ? 'bg-blue-600 text-white shadow-sm'
                                            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    OCR 선택
                                </button>
                            </div>
                            <div className="mt-2 text-[11px] leading-4 text-gray-500">
                                {worksheetTool === 'box'
                                    ? '드래그한 크기 그대로 빈칸 상자를 만듭니다.'
                                    : '글자를 클릭하거나 드래그하면 OCR 단어를 기준으로 빈칸을 잡습니다.'}
                            </div>
                        </div>

                        <div className="rounded-2xl border border-gray-200 bg-white/96 p-3 shadow-2xl backdrop-blur">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-gray-400">Words</div>
                                <div className="text-[11px] font-semibold text-gray-500">{sortedBlanks.length}개</div>
                            </div>
                            <div className="mt-2.5 flex max-h-28 flex-wrap gap-1.5 overflow-hidden">
                                {visibleBlankTags.map((blank, index) => (
                                    <button
                                        key={blank.id}
                                        type="button"
                                        onClick={() => handleSelectBlank(blank.id)}
                                        className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                            selectedBlankId === blank.id
                                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                                        }`}
                                    >
                                        {blank.answer || `빈칸 ${index + 1}`}
                                    </button>
                                ))}
                                {sortedBlanks.length > 6 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowAllBlankTags((prev) => !prev)}
                                        className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition hover:bg-blue-100"
                                    >
                                        {showAllBlankTags ? '숨기기' : `더보기 +${sortedBlanks.length - visibleBlankTags.length}`}
                                    </button>
                                )}
                            </div>
                        </div>

                        {draftBlank ? (
                            <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-white/98 p-3 shadow-2xl backdrop-blur">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-bold text-amber-900">새 빈칸 초안</div>
                                    <button type="button" onClick={handleCancelDraftBlank} className="text-xs font-bold text-gray-500">
                                        취소
                                    </button>
                                </div>
                                <div className="text-xs text-gray-500">p.{draftBlank!.page} 영역이 선택되었습니다.</div>
                                <input
                                    type="text"
                                    value={draftBlankAnswer}
                                    onChange={(e) => setDraftBlankAnswer(e.target.value)}
                                    className="w-full rounded-lg border border-amber-300 px-2.5 py-1.5 text-sm"
                                    placeholder="정답을 입력해 주세요."
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={handleConfirmDraftBlank}
                                    className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-bold text-white hover:bg-amber-600"
                                >
                                    빈칸 추가
                                </button>
                            </div>
                        ) : selectedBlank ? (
                            <div className="space-y-2.5 rounded-2xl border border-blue-100 bg-white/98 p-3 shadow-2xl backdrop-blur">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-bold text-blue-900">선택한 빈칸</div>
                                    <button type="button" onClick={() => removeBlank(selectedBlank!.id)} className="text-xs font-bold text-red-600">
                                        삭제
                                    </button>
                                </div>
                                <div className="text-xs text-gray-500">p.{selectedBlank!.page}</div>
                                <input
                                    type="text"
                                    value={selectedBlank!.answer}
                                    onChange={(e) => handleBlankChange(selectedBlank!.id, e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm"
                                    placeholder="정답"
                                />
                            </div>
                        ) : null}
                    </div>
                )}

                <button
                    type="button"
                    onClick={() => setFloatingPanelOpen((prev) => !prev)}
                    aria-label={floatingPanelOpen ? '플로팅 도구 닫기' : '플로팅 도구 열기'}
                    className={`flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl transition duration-200 hover:bg-blue-700 ${
                        floatingPanelOpen ? 'scale-90' : 'scale-100'
                    }`}
                >
                    <i className={`fas ${floatingPanelOpen ? 'fa-times' : 'fa-layer-group'} text-lg`}></i>
                </button>
            </div>
        </div>
    );
};

export default ManageHistoryClassroom;
