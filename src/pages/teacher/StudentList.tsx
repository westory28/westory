import React, { useEffect, useState } from 'react';
import { db } from '../../../lib/firebase';
import { collection, getDocs, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import StudentEditModal from './components/StudentEditModal';
import StudentHistoryModal from './components/StudentHistoryModal';
import MoveClassModal from './components/MoveClassModal';

interface Student {
    id: string;
    grade: number;
    class: number;
    number: number;
    name: string;
    email: string;
}

const StudentList: React.FC = () => {
    const [students, setStudents] = useState<Student[]>([]);
    const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [gradeFilter, setGradeFilter] = useState('all');
    const [classFilter, setClassFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');

    // Selection
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Modals
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [historyModalOpen, setHistoryModalOpen] = useState(false);
    const [moveClassModalOpen, setMoveClassModalOpen] = useState(false);

    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

    useEffect(() => {
        fetchStudents();
    }, []);

    useEffect(() => {
        applyFilters();
    }, [students, gradeFilter, classFilter, searchQuery]);

    const fetchStudents = async () => {
        setLoading(true);
        try {
            const snap = await getDocs(collection(db, 'users'));
            const list: Student[] = [];
            snap.forEach(d => {
                const data = d.data();
                if (data.role !== 'teacher') { // Exclude teachers usually
                    list.push({
                        id: d.id,
                        grade: parseInt(data.grade) || 0,
                        class: parseInt(data.class) || 0,
                        number: parseInt(data.number) || 0,
                        name: data.name || '',
                        email: data.email || ''
                    });
                }
            });
            // Sort
            list.sort((a, b) => (a.grade - b.grade) || (a.class - b.class) || (a.number - b.number));
            setStudents(list);
            setFilteredStudents(list);
        } catch (error) {
            console.error("Error fetching students:", error);
        } finally {
            setLoading(false);
        }
    };

    const applyFilters = () => {
        let res = students;
        if (gradeFilter !== 'all') res = res.filter(s => String(s.grade) === gradeFilter);
        if (classFilter !== 'all') res = res.filter(s => String(s.class) === classFilter);
        if (searchQuery) res = res.filter(s => s.name.includes(searchQuery));
        setFilteredStudents(res);
    };

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const ids = new Set(filteredStudents.map(s => s.id));
            setSelectedIds(ids);
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    // Actions
    const handleDelete = async (id: string) => {
        if (!confirm("정말 삭제하시겠습니까? (복구 불가)")) return;
        try {
            await deleteDoc(doc(db, 'users', id));
            fetchStudents(); // Refresh
        } catch (e) {
            console.error("Delete failed", e);
        }
    };

    const handleBulkDelete = async () => {
        if (!confirm(`선택한 ${selectedIds.size}명을 정말 삭제하시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach(id => {
                batch.delete(doc(db, 'users', id));
            });
            await batch.commit();
            setSelectedIds(new Set());
            fetchStudents();
        } catch (e) {
            console.error("Bulk delete failed", e);
        }
    };

    const handleBulkPromote = async () => {
        if (!confirm(`선택한 ${selectedIds.size}명의 학년을 1씩 올리시겠습니까?`)) return;
        try {
            const batch = writeBatch(db);
            selectedIds.forEach(id => {
                const s = students.find(x => x.id === id);
                if (s) {
                    batch.update(doc(db, 'users', id), { grade: s.grade + 1 });
                }
            });
            await batch.commit();
            setSelectedIds(new Set());
            fetchStudents();
        } catch (e) {
            console.error("Bulk promote failed", e);
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 animate-fadeIn">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px] flex flex-col">
                {/* Header */}
                <div className="p-6 border-b bg-gray-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <h2 className="text-lg font-bold text-gray-800 whitespace-nowrap">
                        <i className="fas fa-users text-blue-500 mr-2"></i> 학생 명단
                        <span className="text-sm font-normal text-gray-500 ml-2">({filteredStudents.length}명)</span>
                    </h2>
                </div>

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row justify-between items-center p-6 gap-4 border-b border-gray-100">
                    <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto">
                        <select
                            value={gradeFilter}
                            onChange={(e) => setGradeFilter(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500"
                        >
                            <option value="all">전학년</option>
                            <option value="1">1학년</option>
                            <option value="2">2학년</option>
                            <option value="3">3학년</option>
                        </select>
                        <select
                            value={classFilter}
                            onChange={(e) => setClassFilter(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm font-bold text-gray-700 focus:outline-none focus:border-blue-500"
                        >
                            <option value="all">전체반</option>
                            {[...Array(12)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}반</option>)}
                        </select>
                    </div>

                    <div className="flex gap-2 w-full md:w-auto">
                        <input
                            type="text"
                            placeholder="이름 검색"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="border border-gray-300 rounded-lg px-4 py-2 text-sm flex-1 md:w-64 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto flex-1">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-xs">
                            <tr>
                                <th className="p-4 w-10 text-center">
                                    <input
                                        type="checkbox"
                                        onChange={(e) => handleSelectAll(e.target.checked)}
                                        checked={filteredStudents.length > 0 && selectedIds.size === filteredStudents.length}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                </th>
                                <th className="p-4 w-16 text-center">학년</th>
                                <th className="p-4 w-16 text-center">반</th>
                                <th className="p-4 w-16 text-center">번호</th>
                                <th className="p-4 w-32">이름</th>
                                <th className="p-4 hidden md:table-cell">이메일</th>
                                <th className="p-4 text-center w-24">관리</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                            {loading ? (
                                <tr><td colSpan={7} className="p-10 text-center text-gray-400">데이터를 불러오는 중...</td></tr>
                            ) : filteredStudents.length === 0 ? (
                                <tr><td colSpan={7} className="p-10 text-center text-gray-400">학생 데이터가 없습니다.</td></tr>
                            ) : (
                                filteredStudents.map(s => (
                                    <tr key={s.id} className="hover:bg-blue-50 transition group">
                                        <td className="p-4 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(s.id)}
                                                onChange={() => handleSelect(s.id)}
                                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                            />
                                        </td>
                                        <td className="p-4 text-center text-gray-700 font-bold">{s.grade}</td>
                                        <td className="p-4 text-center font-bold text-gray-600">{s.class}</td>
                                        <td className="p-4 text-center font-bold text-gray-600">{s.number}</td>
                                        <td className="p-4 whitespace-nowrap">
                                            <button
                                                onClick={() => { setSelectedStudent(s); setHistoryModalOpen(true); }}
                                                className="font-bold text-gray-800 hover:text-blue-600 hover:underline flex items-center group-hover:text-blue-600"
                                            >
                                                {s.name} <i className="fas fa-folder-open text-xs text-gray-300 group-hover:text-blue-400 ml-2"></i>
                                            </button>
                                        </td>
                                        <td className="p-4 text-gray-500 text-xs font-mono hidden md:table-cell">{s.email}</td>
                                        <td className="p-4 text-center">
                                            <div className="flex gap-1 justify-center">
                                                <button
                                                    onClick={() => { setSelectedStudent(s); setEditModalOpen(true); }}
                                                    className="bg-blue-50 text-blue-600 hover:bg-blue-100 p-1.5 rounded text-xs transition"
                                                    title="수정"
                                                >
                                                    <i className="fas fa-edit"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(s.id)}
                                                    className="bg-red-50 text-red-600 hover:bg-red-100 p-1.5 rounded text-xs transition"
                                                    title="삭제"
                                                >
                                                    <i className="fas fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Floating Bulk Action Bar */}
            {selectedIds.size > 0 && (
                <div className="fixed bottom-8 left-1/2 transform -translate-x-1/2 bg-white rounded-full shadow-2xl border border-gray-200 py-3 px-6 flex items-center gap-4 z-40 animate-slideUp">
                    <div className="flex flex-col items-center justify-center leading-tight whitespace-nowrap">
                        <span className="bg-blue-600 text-white text-xs font-bold px-2 py-0.5 rounded-full mb-0.5">
                            {selectedIds.size}명
                        </span>
                        <span className="text-[10px] font-bold text-gray-700">선택됨</span>
                    </div>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleBulkPromote} className="hover:bg-gray-100 p-2 rounded-lg text-blue-600 transition flex items-center gap-1">
                            <i className="fas fa-level-up-alt"></i> <span className="text-xs font-bold hidden sm:inline">진급</span>
                        </button>
                        <button onClick={() => setMoveClassModalOpen(true)} className="hover:bg-gray-100 p-2 rounded-lg text-green-600 transition flex items-center gap-1">
                            <i className="fas fa-exchange-alt"></i> <span className="text-xs font-bold hidden sm:inline">이동</span>
                        </button>
                        <button onClick={handleBulkDelete} className="hover:bg-gray-100 p-2 rounded-lg text-red-600 transition flex items-center gap-1">
                            <i className="fas fa-trash"></i> <span className="text-xs font-bold hidden sm:inline">삭제</span>
                        </button>
                    </div>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600 transition">
                        <i className="fas fa-times"></i>
                    </button>
                </div>
            )}

            {/* Modals */}
            <StudentEditModal
                isOpen={editModalOpen}
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
                isOpen={moveClassModalOpen}
                onClose={() => setMoveClassModalOpen(false)}
                selectedIds={selectedIds}
                onComplete={() => {
                    setSelectedIds(new Set());
                    fetchStudents();
                }}
            />

        </div>
    );
};

export default StudentList;
