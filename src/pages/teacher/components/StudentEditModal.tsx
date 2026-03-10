import React, { useEffect, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

interface Student {
    id: string;
    grade: string;
    class: string;
    number: number;
    name: string;
    email: string;
}

interface StudentEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    student: Student | null;
    onUpdate: () => void;
}

const StudentEditModal: React.FC<StudentEditModalProps> = ({ isOpen, onClose, student, onUpdate }) => {
    const [formData, setFormData] = useState<Student>({
        id: '',
        grade: '',
        class: '',
        number: 0,
        name: '',
        email: '',
    });

    useEffect(() => {
        if (student) setFormData(student);
    }, [student]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: name === 'number' ? parseInt(value, 10) || 0 : value,
        }));
    };

    const handleSave = async () => {
        if (!formData.id) return;
        try {
            await updateDoc(doc(db, 'users', formData.id), {
                grade: formData.grade,
                class: formData.class,
                number: formData.number,
                name: formData.name,
                email: formData.email,
            });
            onUpdate();
            onClose();
        } catch (error) {
            console.error('Failed to update student:', error);
            alert('학생 정보 저장 중 오류가 발생했습니다.');
        }
    };

    if (!isOpen || !student) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="w-96 rounded-xl bg-white p-6 shadow-xl animate-fadeScale">
                <h3 className="mb-4 border-b pb-2 text-lg font-bold text-gray-800">학생 정보 수정</h3>
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">학년</label>
                            <input
                                type="text"
                                name="grade"
                                value={formData.grade}
                                onChange={handleChange}
                                className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">반</label>
                            <input
                                type="text"
                                name="class"
                                value={formData.class}
                                onChange={handleChange}
                                className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-bold text-gray-500">번호</label>
                            <input
                                type="number"
                                name="number"
                                value={formData.number}
                                onChange={handleChange}
                                className="w-full rounded border p-2 text-center text-sm focus:border-blue-500 focus:outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">이름</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="w-full rounded border p-2 text-sm font-bold focus:border-blue-500 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="mb-1 block text-xs font-bold text-gray-500">이메일 (로그인 ID)</label>
                        <input
                            type="text"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="w-full rounded border bg-gray-50 p-2 text-sm focus:border-blue-500 focus:outline-none"
                        />
                    </div>
                </div>
                <div className="mt-6 flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 rounded border border-gray-300 bg-white py-2 font-bold text-gray-700 transition hover:bg-gray-50"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 rounded bg-blue-600 py-2 font-bold text-white shadow-md transition hover:bg-blue-700"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StudentEditModal;
