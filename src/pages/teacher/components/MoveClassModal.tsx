import React, { useState } from 'react';
import { db } from '../../../lib/firebase';
import { doc, writeBatch } from 'firebase/firestore';

interface MoveClassModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedIds: Set<string>;
    onComplete: () => void;
}

const MoveClassModal: React.FC<MoveClassModalProps> = ({ isOpen, onClose, selectedIds, onComplete }) => {
    const [targetClass, setTargetClass] = useState(1);

    const handleMove = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(`선택한 ${selectedIds.size}명을 ${targetClass}반으로 이동하시겠습니까?`)) return;

        try {
            const batch = writeBatch(db);
            selectedIds.forEach(id => {
                const ref = doc(db, 'users', id);
                batch.update(ref, { class: targetClass });
            });
            await batch.commit();
            onComplete();
            onClose();
        } catch (e) {
            console.error("Move failed:", e);
            alert("이동 중 오류가 발생했습니다.");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white p-6 rounded-lg w-80 shadow-xl z-10 text-center animate-fadeScale">
                <h3 className="font-bold text-lg mb-2 text-gray-800">반 이동</h3>
                <p className="text-sm text-gray-500 mb-6">선택한 {selectedIds.size}명의 학생을 이동할 반을 선택하세요.</p>

                <div className="relative mb-6">
                    <select
                        value={targetClass}
                        onChange={(e) => setTargetClass(parseInt(e.target.value))}
                        className="w-full appearance-none border border-gray-300 p-3 rounded-lg font-bold text-center text-gray-700 focus:outline-none focus:border-green-500 bg-white"
                    >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(c => (
                            <option key={c} value={c}>{c}반</option>
                        ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
                        <i className="fas fa-chevron-down text-xs"></i>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={onClose}
                        className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-200 transition"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleMove}
                        className="flex-1 bg-green-600 text-white font-bold py-2 rounded-lg hover:bg-green-700 transition shadow-md"
                    >
                        이동 확인
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MoveClassModal;
