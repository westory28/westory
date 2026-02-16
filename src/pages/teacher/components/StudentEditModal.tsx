import React, { useEffect, useState } from 'react';
import { db } from '../../../../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface Student {
    id: string;
    grade: number;
    class: number;
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
        id: '', grade: 0, class: 0, number: 0, name: '', email: ''
    });

    useEffect(() => {
        if (student) {
            setFormData(student);
        }
    }, [student]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: name === 'name' || name === 'email' ? value : parseInt(value) || 0
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
                email: formData.email
            });
            onUpdate();
            onClose();
        } catch (error) {
            console.error("Failed to update student:", error);
            alert("저장 중 오류가 발생했습니다.");
        }
    };

    if (!isOpen || !student) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white p-6 rounded-xl w-96 shadow-xl animate-fadeScale">
                <h3 className="font-bold mb-4 text-lg border-b pb-2 text-gray-800">학생 정보 수정</h3>
                <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-xs text-gray-500 font-bold mb-1">학년</label>
                            <input
                                type="number"
                                name="grade"
                                value={formData.grade}
                                onChange={handleChange}
                                className="w-full border p-2 rounded text-sm text-center focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 font-bold mb-1">반</label>
                            <input
                                type="number"
                                name="class"
                                value={formData.class}
                                onChange={handleChange}
                                className="w-full border p-2 rounded text-sm text-center focus:outline-none focus:border-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 font-bold mb-1">번호</label>
                            <input
                                type="number"
                                name="number"
                                value={formData.number}
                                onChange={handleChange}
                                className="w-full border p-2 rounded text-sm text-center focus:outline-none focus:border-blue-500"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 font-bold mb-1">이름</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            className="w-full border p-2 rounded text-sm font-bold focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 font-bold mb-1">이메일 (로그인 ID)</label>
                        <input
                            type="text"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="w-full border p-2 rounded text-sm bg-gray-50 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                </div>
                <div className="flex gap-2 mt-6">
                    <button
                        onClick={onClose}
                        className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded font-bold hover:bg-gray-50 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 bg-blue-600 text-white py-2 rounded font-bold hover:bg-blue-700 shadow-md transition"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StudentEditModal;
