import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  updateStudentData,
  hasPendingStudentProfileUpdate,
  retryStudentProfileUpdate,
  studentProfileUpdateError,
  type StudentProfileEditState,
} from "../../../lib/studentData";

interface Student {
  id: string;
  userId: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
  editState?: StudentProfileEditState;
}

interface MoveClassModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: Set<string>;
  students: Student[];
  onComplete: () => void;
}

const MoveClassModal: React.FC<MoveClassModalProps> = ({
  isOpen,
  onClose,
  selectedIds,
  students,
  onComplete,
}) => {
  const { config } = useAuth();
  const [targetClass, setTargetClass] = useState(1);
  const [moving, setMoving] = useState(false);
  const completed = useRef(new Set<string>());
  const sessionKey = useRef("");
  const [completedCount, setCompletedCount] = useState(0);
  const targets = students.filter((student) => selectedIds.has(student.id));
  const pending = targets.some((student) =>
    hasPendingStudentProfileUpdate(student.editState),
  );
  const selectionKey = targets
    .map(
      (student) =>
        `${student.id}:${student.editState?.expectedVersion || "legacy"}`,
    )
    .sort()
    .join("|");
  useEffect(() => {
    if (sessionKey.current !== selectionKey) {
      sessionKey.current = selectionKey;
      completed.current.clear();
      setCompletedCount(0);
    }
  }, [selectionKey]);

  const handleMove = async () => {
    if (moving || selectedIds.size === 0) return;
    if (
      !confirm(
        `선택한 ${selectedIds.size}명을 ${targetClass}반으로 이동하시겠습니까?`,
      )
    )
      return;

    if (!targets.length) return;
    setMoving(true);
    try {
      for (const student of targets) {
        if (completed.current.has(student.id)) continue;
        if (
          student.editState &&
          hasPendingStudentProfileUpdate(student.editState)
        )
          await retryStudentProfileUpdate(student.editState);
        else
          await updateStudentData(config, {
            uid: student.userId,
            grade: student.grade,
            class: String(targetClass),
            number: student.number,
            name: student.name,
            email: student.email,
            editState: student.editState,
            operation: "MOVE_CLASS",
          });
        completed.current.add(student.id);
        setCompletedCount(completed.current.size);
      }
      completed.current.clear();
      setCompletedCount(0);
      onComplete();
      onClose();
    } catch (e) {
      console.error("Move failed:", e);
      alert(
        `${completed.current.size}명 이동 완료. ${studentProfileUpdateError(e)}`,
      );
    } finally {
      setMoving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white p-6 rounded-lg w-80 shadow-xl z-10 text-center animate-fadeScale">
        <h3 className="font-bold text-lg mb-2 text-gray-800">반 이동</h3>
        <p className="text-sm text-gray-500 mb-6">
          선택한 {selectedIds.size}명의 학생을 이동할 반을 선택하세요.
        </p>

        <div className="relative mb-6">
          <select
            value={targetClass}
            disabled={moving || pending || completedCount > 0}
            onChange={(e) => setTargetClass(parseInt(e.target.value))}
            className="w-full appearance-none border border-gray-300 p-3 rounded-lg font-bold text-center text-gray-700 focus:outline-none focus:border-green-500 bg-white"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((c) => (
              <option key={c} value={c}>
                {c}반
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
            <i className="fas fa-chevron-down text-xs"></i>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={moving}
            className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-200 transition"
          >
            취소
          </button>
          <button
            onClick={handleMove}
            disabled={moving}
            className="flex-1 bg-green-600 text-white font-bold py-2 rounded-lg hover:bg-green-700 transition shadow-md disabled:cursor-not-allowed disabled:bg-green-300"
          >
            {moving
              ? "이동 중..."
              : pending
                ? "이전 요청 결과 확인"
                : "이동 확인"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveClassModal;
