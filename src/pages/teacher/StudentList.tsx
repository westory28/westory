import React, { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import MoveClassModal from './components/MoveClassModal';
import StudentEditModal from './components/StudentEditModal';
import StudentHistoryModal from './components/StudentHistoryModal';

interface Student {
    id: string;
    userId: string;
    grade: number;
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

const STUDENTS_PER_PAGE = 50;
const ADMIN_EMAIL = 'westoria28@gmail.com';

const parseGradeValue = (data: any) => {
    const raw = String(data?.grade ?? '').trim();
    const fromGrade = parseInt(raw, 10);
    if (!Number.isNaN(fromGrade)) return fromGrade;
    const fromGradeClass = String(data?.gradeClass ?? '').match(/(\d+)\s*학년/);
    if (fromGradeClass?.[1]) return parseInt(fromGradeClass[1], 10);
    return 0;
};

const parseClassValue = (data: any) => {
    const raw = String(data?.class ?? '').trim();
    if (raw) return raw;
    const gradeClass = String(data?.gradeClass ?? '').trim();
    if (!gradeClass) return '';
    const parts = gradeClass.split(/\s+/).filter(Boolean);
    return parts.find((part) => part.includes('반'))?.replace('반', '') || '';
};

const parseNumberValue = (data: any) => {
    const raw = String(data?.number ?? '').trim();
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

const StudentList: React.FC = () => {
    const [students, setStudents] = useState<Student[]>([]);
    const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);

    const [gradeFilter, setGradeFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [classOptions, setClassOptions] = useState<SchoolClassOption[]>(
        Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}반` })),
    );

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const [editModalOpen, setEditModalOpen] = useState(false);
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [moveClassModalOpen, setMoveClassModalOpen] = useState(false);
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

    useEffect(() => {
        void fetchStudents();
        void loadSchoolConfig();
    }, []);

    useEffect(() => {
        applyFilters();
    }, [students, gradeFilter, classFilter, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE));
    const pageStart = (currentPage - 1) * STUDENTS_PER_PAGE;
    const pagedStudents = filteredStudents.slice(pageStart, pageStart + STUDENTS_PER_PAGE);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const fetchStudents = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users'));
            const list: Student[] = [];
            snap.forEach((d) => {
                const data = d.data();
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
                if (includeAsStudent) {
                    const resolvedName =
                        String(
                            data.studentName ||
                            data.name ||
                            data.displayName ||
                            data.nickname ||
                            data.customName ||
                            '',
                        ).trim();
                    list.push({
                        id: d.id,
                        userId: d.id,
                        grade: parseInt(String(data.studentGrade ?? ''), 10) || parseGradeValue(data),
                        class: String(data.studentClass ?? '').trim() || parseClassValue(data),
                        number: parseInt(String(data.studentNumber ?? ''), 10) || parseNumberValue(data),
                        name: resolvedName,
                        email,
                        isTeacherAccount,
                    });
                }
            });

            list.sort((a, b) => {
                const gradeGap = a.grade - b.grade;
                if (gradeGap !== 0) return gradeGap;

                const aClass = classSortValue(a.class);
                const bClass = classSortValue(b.class);
                if (aClass.numeric && bClass.numeric) {
                    const classGap = Number(aClass.value) - Number(bClass.value);
                    if (classGap !== 0) return classGap;
                } else {
                    const classGap = String(a.class).localeCompare(String(b.class), 'ko');
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
            const data = snap.data() as { classes?: Array<{ value?: string; label?: string }> };
            const loaded = (data.classes || [])
                .map((item) => ({
                    value: String(item?.value ?? '').trim(),
                    label: String(item?.label ?? '').trim(),
                }))
                .filter((item) => item.value && item.label);
            if (loaded.length > 0) setClassOptions(loaded);
        } catch (error) {
            console.error('Failed to load class options:', error);
        }
    };

    const getClassLabel = (classValue: string) => {
        const normalized = String(classValue || '').trim();
        if (!normalized) return '-';
        return classOptions.find((opt) => opt.value === normalized)?.label || normalized;
    };

    const applyFilters = () => {
        let result = students;
        if (gradeFilter !== 'all') result = result.filter((s) => String(s.grade) === gradeFilter);
        if (classFilter !== 'all') result = result.filter((s) => String(s.class) === classFilter);
        const q = searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((s) =>
                s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
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
        setSelectedIds(new Set(pagedStudents.map((s) => s.id)));
    };

    const handleSelect = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm('정말 삭제하시겠습니까? (복구 불가)')) return;
        try {
            const target = students.find((s) => s.id === id);
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
        if (!window.confirm(`선택한 ${selectedIds.size}명을 정말 삭제하시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach((id) => {
                const target = students.find((s) => s.id === id);
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
        if (!window.confirm(`선택한 ${selectedIds.size}명의 학년을 1 올리시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach((id) => {
                const student = students.find((x) => x.id === id);
                if (student) {
                    batch.update(doc(db, 'users', student.userId), { grade: student.grade + 1 });
                }
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
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="max-w-6xl mx-auto px-3 py-6 animate-fadeIn w-full flex-1">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px] flex flex-col">
                    <div className="p-5 border-b bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
                        <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap">
                            <i className="fas fa-users text-blue-500 mr-2"></i> 학생 명단
                            <span className="text-sm font-normal text-gray-500 ml-2">({filteredStudents.length}명)</span>
                        </h2>
                    </div>

                    <div className="flex flex-col md:flex-row justify-between items-center p-5 gap-3 border-b border-gray-100">
                        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
                            <select
                                value={gradeFilter}
                                onChange={(e) => setGradeFilter(e.target.value)}
                                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500"
                            >
                                <option value="all">전체 학년</option>
                                <option value="1">1학년</option>
                                <option value="2">2학년</option>
                                <option value="3">3학년</option>
                            </select>
                            <select
                                value={classFilter}
                                onChange={(e) => setClassFilter(e.target.value)}
                                className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500"
                            >
                                <option value="all">전체 반</option>
                                {classOptions.map((cls) => (
                                    <option key={cls.value} value={cls.value}>{cls.label}</option>
                                ))}
                            </select>
                            <button
                                onClick={() => void handleRefreshList()}
                                className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                                title="명단 새로고침 및 필터 초기화"
                            >
                                <i className={`fas fa-sync-alt ${loading ? 'animate-spin' : ''}`}></i>
                            </button>
                        </div>

                        <div className="flex gap-2 w-full md:w-auto">
                            <input
                                type="text"
                                placeholder="이름 검색"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="border border-gray-300 rounded-lg px-4 py-2 text-sm flex-1 md:w-64 focus:outline-none focus:border-blue-500"
                            />
                            <button
                                onClick={applyFilters}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition whitespace-nowrap"
                            >
                                <i className="fas fa-search mr-1"></i>검색
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto flex-1">
                        <table className="w-full min-w-[560px] md:min-w-0 text-sm text-left">
                            <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-xs">
                                <tr>
                                    <th className="p-4 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            onChange={(e) => handleSelectAll(e.target.checked)}
                                            checked={pagedStudents.length > 0 && pagedStudents.every((s) => selectedIds.has(s.id))}
                                            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                        />
                                    </th>
                                    <th className="p-4 w-16 text-center">학년</th>
                                    <th className="p-4 w-16 text-center">반</th>
                                    <th className="p-4 w-16 text-center">번호</th>
                                    <th className="p-4 w-32">이름</th>
                                    <th className="p-4 w-64 hidden lg:table-cell">이메일</th>
                                    <th className="p-4 text-center w-36">관리</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {loading ? (
                                    <tr><td colSpan={7} className="p-10 text-center text-gray-400">데이터를 불러오는 중...</td></tr>
                                ) : filteredStudents.length === 0 ? (
                                    <tr><td colSpan={7} className="p-10 text-center text-gray-400">학생 데이터가 없습니다.</td></tr>
                                ) : (
                                    pagedStudents.map((student) => (
                                        <tr key={student.id} className="hover:bg-blue-50 transition group">
                                            <td className="p-4 text-center">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(student.id)}
                                                    onChange={() => handleSelect(student.id)}
                                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="p-4 text-center text-gray-700 font-bold">{student.grade}</td>
                                            <td className="p-4 text-center font-bold text-gray-600">{getClassLabel(student.class)}</td>
                                            <td className="p-4 text-center font-bold text-gray-600">{student.number}</td>
                                            <td className="p-4 whitespace-nowrap">
                                                <button
                                                    onClick={() => {
                                                        setSelectedStudent(student);
                                                        setHistoryModalOpen(true);
                                                    }}
                                                    className="font-bold text-gray-800 hover:text-blue-600 hover:underline flex items-center group-hover:text-blue-600"
                                                >
                                                    {student.name || '(이름 없음)'}
                                                    <i className="fas fa-folder-open text-xs text-gray-300 group-hover:text-blue-400 ml-2"></i>
                                                </button>
                                            </td>
                                            <td className="p-4 text-gray-500 text-xs font-mono hidden lg:table-cell">{student.email}</td>
                                            <td className="p-4 text-center">
                                                <div className="flex gap-1 justify-center">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedStudent(student);
                                                            setEditModalOpen(true);
                                                        }}
                                                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-2.5 py-1.5 rounded text-xs font-bold transition flex items-center gap-1"
                                                        title="수정"
                                                    >
                                                        <i className="fas fa-edit"></i>
                                                        <span className="hidden lg:inline">수정</span>
                                                    </button>
                                                    <button
                                                        onClick={() => void handleDelete(student.id)}
                                                        className="bg-red-50 text-red-600 hover:bg-red-100 px-2.5 py-1.5 rounded text-xs font-bold transition flex items-center gap-1"
                                                        title={student.isTeacherAccount ? '학생 정보만 삭제' : '삭제'}
                                                    >
                                                        <i className="fas fa-trash"></i>
                                                        <span className="hidden lg:inline">삭제</span>
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    {!loading && filteredStudents.length > STUDENTS_PER_PAGE && (
                        <div className="px-5 py-3 border-t border-gray-100 bg-white flex items-center justify-center gap-1.5">
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                                <button
                                    key={page}
                                    onClick={() => setCurrentPage(page)}
                                    className={`min-w-8 h-8 px-2 rounded-md text-xs font-bold transition ${currentPage === page ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600'}`}
                                >
                                    {page}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {selectedIds.size > 0 && (
                    <div className="fixed bottom-4 md:bottom-8 left-1/2 transform -translate-x-1/2 bg-white rounded-2xl md:rounded-full shadow-2xl border border-gray-200 py-2.5 md:py-3 px-3 md:px-6 w-[calc(100%-1rem)] max-w-[720px] md:w-auto flex flex-wrap md:flex-nowrap items-center justify-center gap-2 md:gap-4 z-40 animate-slideUp">
                        <div className="flex items-center justify-center leading-tight whitespace-nowrap gap-2">
                            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                                {selectedIds.size}명
                            </span>
                            <span className="text-xs font-bold text-gray-700">선택됨</span>
                        </div>
                        <div className="hidden md:block h-4 w-px bg-gray-300"></div>
                        <div className="flex items-center gap-2">
                            <button onClick={() => void handleBulkPromote()} className="hover:bg-gray-100 px-3 py-2 rounded-lg text-blue-600 transition flex items-center gap-1">
                                <i className="fas fa-level-up-alt"></i>
                                <span className="text-[11px] md:text-xs font-bold">진급</span>
                            </button>
                            <button onClick={() => setMoveClassModalOpen(true)} className="hover:bg-gray-100 px-3 py-2 rounded-lg text-green-600 transition flex items-center gap-1">
                                <i className="fas fa-exchange-alt"></i>
                                <span className="text-[11px] md:text-xs font-bold">반 이동</span>
                            </button>
                            <button onClick={() => void handleBulkDelete()} className="hover:bg-gray-100 px-3 py-2 rounded-lg text-red-600 transition flex items-center gap-1">
                                <i className="fas fa-trash"></i>
                                <span className="text-[11px] md:text-xs font-bold">삭제</span>
                            </button>
                        </div>
                        <div className="hidden md:block h-4 w-px bg-gray-300"></div>
                        <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600 transition p-1">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                )}

                <StudentEditModal
                    isOpen={editModalOpen}
                    onClose={() => setEditModalOpen(false)}
                    student={selectedStudent ? { ...selectedStudent, class: parseInt(selectedStudent.class, 10) || 0 } : null}
                    onUpdate={fetchStudents}
                />

                <StudentHistoryModal
                    isOpen={historyModalOpen}
                    onClose={() => setHistoryModalOpen(false)}
                    studentId={selectedStudent?.id || ''}
                    studentName={selectedStudent?.name || ''}
                />

                <MoveClassModal
                    isOpen={moveClassModalOpen}
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



