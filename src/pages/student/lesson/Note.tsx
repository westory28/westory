import React, { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import LessonSidebar from "./components/LessonSidebar";
import LessonContent from "./components/LessonContent";

const Note: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const unitId = searchParams.get("id");
  const title = searchParams.get("title");

  const handleSelectUnit = useCallback(
    (newUnitId: string, newTitle: string) => {
      setSearchParams({ id: newUnitId, title: newTitle });
      setIsSidebarOpen(false);
    },
    [setSearchParams],
  );

  return (
    <div className="student-lesson-page bg-gray-50">
      <div className="student-lesson-workspace mx-auto flex flex-col gap-4 lg:flex-row lg:items-start">
        <LessonSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          onSelectUnit={handleSelectUnit}
          selectedUnitId={unitId}
        />

        <main className="relative min-w-0 flex-1 rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="p-4 md:p-6">
            <LessonContent unitId={unitId} fallbackTitle={title} />
          </div>

          <button
            id="student-lesson-toggle"
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label={isSidebarOpen ? "수업 목차 닫기" : "수업 목차 열기"}
            className={`fixed right-[calc(env(safe-area-inset-right,0px)+1rem)] z-[75] flex h-14 w-14 items-center justify-center rounded-full bg-gray-800 text-white shadow-lg transition hover:bg-gray-700 lg:hidden ${
              unitId
                ? "bottom-[calc(env(safe-area-inset-bottom,0px)+13rem)]"
                : "bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)]"
            }`}
          >
            <i className="fas fa-list"></i>
          </button>
        </main>
      </div>
    </div>
  );
};

export default Note;
