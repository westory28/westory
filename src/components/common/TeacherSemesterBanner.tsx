import React from "react";
import { useTeacherSemester } from "../../contexts/TeacherSemesterContext";

const TeacherSemesterBanner: React.FC = () => {
  const { isViewingPast, viewConfig, activeConfig, selectSemester } =
    useTeacherSemester();
  if (!isViewingPast || !viewConfig || !activeConfig) return null;
  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="status"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-bold">
            {viewConfig.year}학년도 {viewConfig.semester}학기 자료 조회 중 ·
            읽기 전용
          </span>
          <p className="mt-1 text-xs">
            학생은 {activeConfig.year}학년도 {activeConfig.semester}학기를
            그대로 사용합니다. 학교·계정·인터페이스 설정과 사료 보관함은 학기
            공통 자료입니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => selectSemester(null)}
          className="rounded-lg border border-gray-300 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
        >
          현재 운영 학기로 돌아가기
        </button>
      </div>
    </div>
  );
};
export default TeacherSemesterBanner;
