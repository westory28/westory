import React, { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import MoveClassModal from './components/MoveClassModal';
import StudentEditModal from './components/StudentEditModal';
import StudentHistoryModal from './components/StudentHistoryModal';
import { useAuth } from '../../contexts/AuthContext';
import { canEditStudentList } from '../../lib/permissions';

interface Student {
    id: string;
    userId: string;
    grade: string;
    class: string;
    number: number;
    name: string;
    email: string;
    isTeacherAccount: boolean;
}

interface SchoolClassOption {
    value: string;
    label: string;
}

interface SchoolGradeOption {
    value: string;
    label: string;
}

const normalizeOptionText = (value: unknown) => String(value ?? '').trim();

const findMatchingOption = <T extends SchoolGradeOption | SchoolClassOption>(
    rawValue: unknown,
    options: T[],
): T | undefined => {
    const normalized = normalizeOptionText(rawValue);
    if (!normalized) return undefined;

    return options.find((option) => (
        normalizeOptionText(option.value) === normalized ||
        normalizeOptionText(option.label) === normalized
    ));
};

const toCanonicalOptionValue = <T extends SchoolGradeOption | SchoolClassOption>(
    rawValue: unknown,
    options: T[],
) => {
    const normalized = normalizeOptionText(rawValue);
    if (!normalized) return '';
    return findMatchingOption(normalized, options)?.value ?? normalized;
};

const STUDENTS_PER_PAGE = 50;
const ADMIN_EMAIL = 'westoria28@gmail.com';
const KOREAN_NAME_PATTERN = /^[가-힣]{2,4}$/;

const parseGradeValue = (data: any) => {
    const direct = String(data?.studentGrade ?? data?.grade ?? '').trim();
    if (direct) return direct;
    const gradeClass = String(data?.gradeClass ?? '').trim();
    if (!gradeClass) return '';
    const match = gradeClass.match(/^(\S+)\s*학년/);
    return match?.[1] || '';
};

const parseClassValue = (data: any) => {
    const raw = String(data?.studentClass ?? data?.class ?? '').trim();
    if (raw) return raw;
    const gradeClass = String(data?.gradeClass ?? '').trim();
    if (!gradeClass) return '';
    const parts = gradeClass.split(/\s+/).filter(Boolean);
    return parts.find((part) => part.includes('반'))?.replace('반', '') || '';
};

const parseNumberValue = (data: any) => {
    const raw = String(data?.studentNumber ?? data?.number ?? '').trim();
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed)) return parsed;
    const fromGradeClass = String(data?.gradeClass ?? '').match(/(\d+)\s*번/);
    if (fromGradeClass?.[1]) return parseInt(fromGradeClass[1], 10);
    return 0;
};

const classSortValue = (classValue: string) => {
    const parsed = parseInt(classValue, 10);
    if (!Number.isNaN(parsed)) return { numeric: true, value: parsed };
    return { numeric: false, value: classValue };
};

const normalizeStudentName = (value: unknown) => String(value || '').trim();
const isValidKoreanStudentName = (value: unknown) => KOREAN_NAME_PATTERN.test(normalizeStudentName(value));

const StudentList: React.FC = () => {
    const { userData, currentUser } = useAuth();
    const [students, setStudents] = useState<Student[]>([]);
    const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    const [gradeFilter, setGradeFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [gradeOptions, setGradeOptions] = useState<SchoolGradeOption[]>([
        { value: '1', label: '1학년' },
        { value: '2', label: '2학년' },
        { value: '3', label: '3학년' },
    ]);
    const [classOptions, setClassOptions] = useState<SchoolClassOption[]>(
        Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` })),
    );

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [moveClassModalOpen, setMoveClassModalOpen] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const readOnly = !canEditStudentList(userData, currentUser?.email || '');

    useEffect(() => {
        void fetchStudents();
        void loadSchoolConfig();
    }, []);

    const totalPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE));
    const pageStart = (currentPage - 1) * STUDENTS_PER_PAGE;
    const pagedStudents = filteredStudents.slice(pageStart, pageStart + STUDENTS_PER_PAGE);

    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);

    const gradeOrderMap = useMemo(() => {
        return gradeOptions.reduce<Record<string, number>>((acc, item, index) => {
            acc[item.value] = index;
            return acc;
        }, {});
    }, [gradeOptions]);

    const normalizedStudents = useMemo(() => {
        return students.map((student) => ({
            ...student,
            canonicalGrade: toCanonicalOptionValue(student.grade, gradeOptions),
            canonicalClass: toCanonicalOptionValue(student.class, classOptions),
        }));
    }, [students, gradeOptions, classOptions]);

    useEffect(() => {
        applyFilters();
    }, [normalizedStudents, gradeFilter, classFilter, searchQuery]);

    const fetchStudents = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users'));
            const list: Student[] = [];

            snap.forEach((item) => {
                const data = item.data();
                const email = String(data.email || '').trim();
                const isTeacherAccount = data.role === 'teacher' || email === ADMIN_EMAIL;
                const hasStudentProfile =
                    !!String(data.studentName || '').trim() ||
                    !!String(data.studentGrade || '').trim() ||
                    !!String(data.studentClass || '').trim() ||
                    !!String(data.studentNumber || '').trim() ||
                    !!String(data.grade || '').trim() ||
                    !!String(data.class || '').trim() ||
                    !!String(data.number || '').trim();
                const includeAsStudent = data.role !== 'teacher' || (email === ADMIN_EMAIL && hasStudentProfile);
                if (!includeAsStudent) return;

                const resolvedName = String(
                    data.studentName ||
                    data.name ||
                    data.displayName ||
                    data.nickname ||
                    data.customName ||
                    '',
                ).trim();
                const hasConfirmedKoreanName =
                    data.customNameConfirmed === true &&
                    isValidKoreanStudentName(resolvedName);
                const hasLegacyKoreanName =
                    !data.customNameConfirmed &&
                    isValidKoreanStudentName(resolvedName) &&
                    (
                        !!String(data.grade || '').trim() ||
                        !!String(data.class || '').trim() ||
                        !!String(data.number || '').trim() ||
                        !!String(data.studentGrade || '').trim() ||
                        !!String(data.studentClass || '').trim() ||
                        !!String(data.studentNumber || '').trim()
                    );

                if (!hasConfirmedKoreanName && !hasLegacyKoreanName) return;

                list.push({
                    id: item.id,
                    userId: item.id,
                    grade: parseGradeValue(data),
                    class: parseClassValue(data),
                    number: parseNumberValue(data),
                    name: resolvedName,
                    email,
                    isTeacherAccount,
                });
            });

            list.sort((a, b) => {
                const aCanonicalGrade = toCanonicalOptionValue(a.grade, gradeOptions);
                const bCanonicalGrade = toCanonicalOptionValue(b.grade, gradeOptions);
                const aGradeOrder = gradeOrderMap[aCanonicalGrade] ?? Number.MAX_SAFE_INTEGER;
                const bGradeOrder = gradeOrderMap[bCanonicalGrade] ?? Number.MAX_SAFE_INTEGER;
                if (aGradeOrder !== bGradeOrder) return aGradeOrder - bGradeOrder;

                if (aCanonicalGrade !== bCanonicalGrade) {
                    return aCanonicalGrade.localeCompare(bCanonicalGrade, 'ko');
                }

                const aClass = classSortValue(toCanonicalOptionValue(a.class, classOptions));
                const bClass = classSortValue(toCanonicalOptionValue(b.class, classOptions));
                if (aClass.numeric && bClass.numeric) {
                    const classGap = Number(aClass.value) - Number(bClass.value);
                    if (classGap !== 0) return classGap;
                } else {
                    const classGap = String(aClass.value).localeCompare(String(bClass.value), 'ko');
                    if (classGap !== 0) return classGap;
                }

                return a.number - b.number;
            });

            setStudents(list);
            setFilteredStudents(list);
        } catch (error) {
            console.error('Error fetching students:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadSchoolConfig = async () => {
        try {
            const snap = await getDoc(doc(db, 'site_settings', 'school_config'));
            if (!snap.exists()) return;
            const data = snap.data() as {
                grades?: Array<{ value?: string; label?: string }>;
                classes?: Array<{ value?: string; label?: string }>;
            };
            const loadedGrades = (data.grades || [])
                .map((item) => ({
                    value: String(item?.value ?? '').trim(),
                    label: String(item?.label ?? '').trim(),
                }))
                .filter((item) => item.value && item.label);
            const loadedClasses = (data.classes || [])
                .map((item) => ({
                    value: String(item?.value ?? '').trim(),
                    label: String(item?.label ?? '').trim(),
                }))
                .filter((item) => item.value && item.label);

            if (loadedGrades.length > 0) setGradeOptions(loadedGrades);
            if (loadedClasses.length > 0) setClassOptions(loadedClasses);
        } catch (error) {
            console.error('Failed to load school config:', error);
        }
    };

    const getGradeLabel = (gradeValue: string) => {
        const normalized = String(gradeValue || '').trim();
        if (!normalized) return '-';
        return findMatchingOption(normalized, gradeOptions)?.label || normalized;
    };

    const getClassLabel = (classValue: string) => {
        const normalized = String(classValue || '').trim();
        if (!normalized) return '-';
        return findMatchingOption(normalized, classOptions)?.label || normalized;
    };

    const applyFilters = () => {
        let result = normalizedStudents;
        if (gradeFilter !== 'all') result = result.filter((student) => student.canonicalGrade === gradeFilter);
        if (classFilter !== 'all') result = result.filter((student) => student.canonicalClass === classFilter);

        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((student) =>
                student.name.toLowerCase().includes(q) || student.email.toLowerCase().includes(q),
            );
        }

        setFilteredStudents(result);
        setCurrentPage(1);
    };

    const handleSelectAll = (checked: boolean) => {
        if (!checked) {
            setSelectedIds(new Set());
            return;
        }
        setSelectedIds(new Set(pagedStudents.map((student) => student.id)));
    };

    const handleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleDelete = async (id: string) => {
        if (readOnly) return;
        if (!window.confirm('정말 삭제하시겠습니까? (복구 불가)')) return;
        try {
            const target = students.find((student) => student.id === id);
            if (!target) return;

            if (target.isTeacherAccount) {
                await updateDoc(doc(db, 'users', target.userId), {
                    studentName: '',
                    studentGrade: '',
                    studentClass: '',
                    studentNumber: '',
                    grade: '',
                    class: '',
                    number: '',
                    updatedAt: serverTimestamp(),
                });
            } else {
                await deleteDoc(doc(db, 'users', target.userId));
            }
            void fetchStudents();
        } catch (error) {
            console.error('Delete failed', error);
        }
    };

    const handleBulkDelete = async () => {
        if (readOnly) return;
        if (!window.confirm(`선택한 ${selectedIds.size}명을 정말 삭제하시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach((id) => {
                const target = students.find((student) => student.id === id);
                if (!target) return;
                if (target.isTeacherAccount) {
                    batch.update(doc(db, 'users', target.userId), {
                        studentName: '',
                        studentGrade: '',
                        studentClass: '',
                        studentNumber: '',
                        grade: '',
                        class: '',
                        number: '',
                        updatedAt: serverTimestamp(),
                    });
                } else {
                    batch.delete(doc(db, 'users', target.userId));
                }
            });
            await batch.commit();
            setSelectedIds(new Set());
            void fetchStudents();
        } catch (error) {
            console.error('Bulk delete failed', error);
        }
    };

    const handleBulkPromote = async () => {
        if (readOnly) return;
        if (!window.confirm(`선택한 ${selectedIds.size}명의 학년을 1 올리시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach((id) => {
                const student = students.find((item) => item.id === id);
                if (!student) return;

                const parsedGrade = parseInt(toCanonicalOptionValue(student.grade, gradeOptions), 10);
                if (Number.isNaN(parsedGrade)) return;

                batch.update(doc(db, 'users', student.userId), { grade: String(parsedGrade + 1) });
            });
            await batch.commit();
            setSelectedIds(new Set());
            void fetchStudents();
        } catch (error) {
            console.error('Bulk promote failed', error);
        }
    };

    const handleRefreshList = async () => {
        setGradeFilter('all');
        setClassFilter('all');
        setSearchQuery('');
        setCurrentPage(1);
        setSelectedIds(new Set());
        await fetchStudents();
    };

    return (
        <div className="min-h-screen flex flex-col bg-gray-50">
            <div className="mx-auto flex w-full max-w-6xl flex-1 animate-fadeIn flex-col px-3 py-6">
                <div className="flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="flex flex-col items-start justify-between gap-3 border-b bg-gray-50 p-5 md:flex-row md:items-center">
                        <h2 className="whitespace-nowrap text-lg font-bold text-gray-800">
                            <i className="fas fa-users mr-2 text-blue-500"></i> 학생 명단
                            <span className="ml-2 text-sm font-normal text-gray-500">({filteredStudents.length}명)</span>
                        </h2>
                    </div>

                    <div className="flex flex-col items-center justify-between gap-3 border-b border-gray-100 p-5 md:flex-row">
                        {readOnly && (
                            <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                                읽기 전용 권한입니다. 학생 명단 조회만 가능합니다.
                            </div>
                        )}
                        <div className="flex w-full items-center gap-2 overflow-x-auto md:w-auto">
                            <select
                                value={gradeFilter}
                                onChange={(e) => setGradeFilter(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="all">전체 학년</option>
                                {gradeOptions.map((grade) => (
                                    <option key={grade.value} value={grade.value}>{grade.label}</option>
                                ))}
                            </select>
                            <select
                                value={classFilter}
                                onChange={(e) => setClassFilter(e.target.value)}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
                            >
                                <option value="all">전체 반</option>
                                {classOptions.map((cls) => (
                                    <option key={cls.value} value={cls.value}>{cls.label}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => void handleRefreshList()}
                                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:border-blue-500 hover:text-blue-600"
                                title="명단 새로고침 및 필터 초기화"
                            >
                                <i className={`fas fa-sync-alt ${loading ? 'animate-spin' : ''}`}></i>
                            </button>
                        </div>

                        <div className="flex w-full gap-2 md:w-auto">
                            <input
                                type="text"
                                placeholder="이름 검색"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none md:w-64"
                            />
                            <button
                                onClick={applyFilters}
                                className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                            >
                                <i className="fas fa-search mr-1"></i>검색
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-x-auto">
                        <table className="w-full min-w-[560px] text-left text-sm md:min-w-0">
                            <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                                <tr>
                                    <th className="w-10 p-4 text-center">
                                        <input
                                            type="checkbox"
                                            onChange={(e) => handleSelectAll(e.target.checked)}
                                            checked={pagedStudents.length > 0 && pagedStudents.every((student) => selectedIds.has(student.id))}
                                            className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                                        />
                                    </th>
                                    <th className="w-16 p-4 text-center">학년</th>
                                    <th className="w-16 p-4 text-center">반</th>
                                    <th className="w-16 p-4 text-center">번호</th>
                                    <th className="w-32 p-4">이름</th>
                                    <th className="hidden w-64 p-4 lg:table-cell">이메일</th>
                                    <th className="w-36 p-4 text-center">관리</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {loading ? (
                                    <tr><td colSpan={7} className="p-10 text-center text-gray-400">데이터를 불러오는 중...</td></tr>
                                ) : filteredStudents.length === 0 ? (
                                    <tr><td colSpan={7} className="p-10 text-center text-gray-400">학생 데이터가 없습니다.</td></tr>
                                ) : (
                                    pagedStudents.map((student) => (
                                        <tr key={student.id} className="group transition hover:bg-blue-50">
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(student.id)}
                                                    onChange={() => handleSelect(student.id)}
                                                    className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="p-4 text-center font-bold text-gray-700">{getGradeLabel(student.grade)}</td>
                                            <td className="p-4 text-center font-bold text-gray-600">{getClassLabel(student.class)}</td>
                                            <td className="p-4 text-center font-bold text-gray-600">{student.number}</td>
                                            <td className="whitespace-nowrap p-4">
                                                <button
                                                    onClick={() => {
                                                        setSelectedStudent(student);
                                                        setHistoryModalOpen(true);
                                                    }}
                                                    className="flex items-center font-bold text-gray-800 hover:text-blue-600 hover:underline group-hover:text-blue-600"
                                                >
                                                    {student.name || '(이름 없음)'}
                                                    <i className="fas fa-folder-open ml-2 text-xs text-gray-300 group-hover:text-blue-400"></i>
                                                </button>
                                            </td>
                                            <td className="hidden p-4 font-mono text-xs text-gray-500 lg:table-cell">{student.email}</td>
                                            <td className="p-4 text-center">
                                                <div className="flex justify-center gap-1">
                                                    {!readOnly && (
                                                        <>
                                                    <button
                                                        onClick={() => {
                                                            setSelectedStudent(student);
                                                            setEditModalOpen(true);
                                                        }}
                                                        className="flex items-center gap-1 rounded bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-100"
                                                        title="수정"
                                                    >
                                                        <i className="fas fa-edit"></i>
                                                        <span className="hidden lg:inline">수정</span>
                                                    </button>
                                                    <button
                                                        onClick={() => void handleDelete(student.id)}
                                                        className="flex items-center gap-1 rounded bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100"
                                                        title={student.isTeacherAccount ? '학생 정보만 삭제' : '삭제'}
                                                    >
                                                        <i className="fas fa-trash"></i>
                                                        <span className="hidden lg:inline">삭제</span>
                                                    </button>
                                                        </>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {!loading && filteredStudents.length > STUDENTS_PER_PAGE && (
                        <div className="flex items-center justify-center gap-1.5 border-t border-gray-100 bg-white px-5 py-3">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`min-w-8 h-8 rounded-md px-2 text-xs font-bold transition ${currentPage === page ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600'}`}
                                >
                                    {page}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {!readOnly && selectedIds.size > 0 && (
                    <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-[720px] -translate-x-1/2 animate-slideUp flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 shadow-2xl md:bottom-8 md:w-auto md:flex-nowrap md:gap-4 md:rounded-full md:px-6 md:py-3">
                        <div className="flex items-center justify-center gap-2 whitespace-nowrap leading-tight">
                            <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">{selectedIds.size}명</span>
                            <span className="text-xs font-bold text-gray-700">선택됨</span>
                        </div>
                        <div className="hidden h-4 w-px bg-gray-300 md:block"></div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => void handleBulkPromote()} className="flex items-center gap-1 rounded-lg px-3 py-2 text-blue-600 transition hover:bg-gray-100">
                                <i className="fas fa-level-up-alt"></i>
                                <span className="text-[11px] font-bold md:text-xs">진급</span>
                            </button>
                            <button onClick={() => setMoveClassModalOpen(true)} className="flex items-center gap-1 rounded-lg px-3 py-2 text-green-600 transition hover:bg-gray-100">
                                <i className="fas fa-exchange-alt"></i>
                                <span className="text-[11px] font-bold md:text-xs">반 이동</span>
                            </button>
                            <button onClick={() => void handleBulkDelete()} className="flex items-center gap-1 rounded-lg px-3 py-2 text-red-600 transition hover:bg-gray-100">
                                <i className="fas fa-trash"></i>
                                <span className="text-[11px] font-bold md:text-xs">삭제</span>
                            </button>
                        </div>
                        <div className="hidden h-4 w-px bg-gray-300 md:block"></div>
                        <button onClick={() => setSelectedIds(new Set())} className="p-1 text-gray-400 transition hover:text-gray-600">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                )}

                <StudentEditModal
                    isOpen={!readOnly && editModalOpen}
                    onClose={() => setEditModalOpen(false)}
                    student={selectedStudent}
                    onUpdate={fetchStudents}
                />

                <StudentHistoryModal
                    isOpen={historyModalOpen}
                    onClose={() => setHistoryModalOpen(false)}
                    studentId={selectedStudent?.id || ''}
                    studentName={selectedStudent?.name || ''}
                />

                <MoveClassModal
                    isOpen={!readOnly && moveClassModalOpen}
                    onClose={() => setMoveClassModalOpen(false)}
                    selectedIds={selectedIds}
                    onComplete={() => {
                        setSelectedIds(new Set());
                        void fetchStudents();
                    }}
                />
            </div>
        </div>
    );
};

export default StudentList;
