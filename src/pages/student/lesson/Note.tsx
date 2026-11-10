import PortalWorkspace from "../../../components/common/PortalWorkspace";
import { getStudentMenuLabel } from "../../../constants/menus";
import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { lazyWithRetry } from "../../../lib/lazyWithRetry";
import { getYearSemester } from "../../../lib/semesterScope";
import {
  readStudentVisibleCurriculumTree,
  type StudentCurriculumTreeItem,
} from "../../../lib/studentLessonReadCache";
import LessonSidebar from "./components/LessonSidebar";
const LessonContent = lazyWithRetry(
  () => import("./components/LessonContent"),
  "student-lesson-content",
);

function LessonWorkspace({
  year,
  semester,
  outlineTitle,
}: {
  year: string;
  semester: string;
  outlineTitle: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [tree, setTree] = useState<StudentCurriculumTreeItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const firstGroupRef = useRef<HTMLButtonElement>(null);

  const unitId = searchParams.get("id");
  const title = searchParams.get("title");
  const requestedPage = Number(searchParams.get("page"));

  useEffect(() => {
    let active = true;
    readStudentVisibleCurriculumTree({ year, semester }).then(
      (items) => {
        if (active) setTree(items);
      },
      (error) => {
        if (active) {
          console.error("Error fetching curriculum:", error);
          setLoadError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [year, semester, retry]);

  const outlineStatus = loadError ? (
    <div role="alert" className="px-4 py-4 text-sm text-red-700">
      목차를 불러오지 못했습니다.
      <button
        type="button"
        className="ml-2 min-h-11 rounded-lg border px-3 font-bold"
        onClick={() => {
          setLoadError(false);
          setRetry((value) => value + 1);
        }}
      >
        다시 불러오기
      </button>
    </div>
  ) : !tree ? (
    <InlineLoading message="목차를 불러오는 중입니다." />
  ) : !tree.length ? (
    <p className="px-4 py-4 text-gray-500">공개된 수업 자료가 없습니다.</p>
  ) : null;

  return (
    <div className="student-lesson-page bg-gray-50">
      <PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--page teacher-sub-workspace--lesson">
        <LessonSidebar
          title={outlineTitle}
          tree={tree ?? []}
          status={unitId ? outlineStatus : null}
          firstGroupRef={firstGroupRef}
          isOpen={isSidebarOpen}
          onOpenChange={setIsSidebarOpen}
          selectedUnitTitle={title}
          onSelectUnit={(id, title) => setSearchParams({ id, title })}
          selectedUnitId={unitId}
        />

        <main className="teacher-sub-content">
          {unitId ? (
            <React.Suspense
              fallback={
                <InlineLoading message="수업 자료를 준비하는 중입니다." />
              }
            >
              <LessonContent
                unitId={unitId}
                fallbackTitle={title}
                initialWorksheetPage={
                  Number.isInteger(requestedPage) && requestedPage > 0
                    ? requestedPage
                    : undefined
                }
              />
            </React.Suspense>
          ) : (
            <div className="student-lesson-selection">
              {outlineStatus ?? (
                <button
                  type="button"
                  onClick={() => {
                    setIsSidebarOpen(true);
                    requestAnimationFrame(() => firstGroupRef.current?.focus());
                  }}
                >
                  <svg
                    aria-hidden="true"
                    width="36"
                    height="36"
                    viewBox="0 0 32 32"
                    fill="currentColor"
                  >
                    <path d="M6 2.8a1 1 0 0 1 1.7-.7l19 19a1 1 0 0 1-.7 1.7h-8l3.5 7.1-3.5 1.7-3.6-7.4-6.7 5.6A1 1 0 0 1 6 29Z" />
                  </svg>
                  수업 목차에서 학습할 단원을 선택해 주세요.
                </button>
              )}
            </div>
          )}
        </main>
      </PortalWorkspace>
    </div>
  );
}

const Note: React.FC = () => {
  const { config, currentUser, menuConfig } = useAuth();
  const { year, semester } = getYearSemester(config);
  return (
    <LessonWorkspace
      key={`${currentUser?.uid}:${year}:${semester}`}
      year={year}
      semester={semester}
      outlineTitle={getStudentMenuLabel(
        menuConfig,
        "/student/lesson/note",
        "수업 목차",
      )}
    />
  );
};

export default Note;
