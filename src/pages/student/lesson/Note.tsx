import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import LessonSidebar from "./components/LessonSidebar";
import LessonContent from "./components/LessonContent";

const Note: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const unitId = searchParams.get("id");
  const title = searchParams.get("title");

  const handleSelectUnit = (newUnitId: string, newTitle: string) => {
    setSearchParams({ id: newUnitId, title: newTitle });
    setIsSidebarOpen(false);
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-gray-50">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-3 py-4 md:px-5 lg:flex-row lg:items-start lg:px-8 xl:px-10">
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
            type="button"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-label={isSidebarOpen ? "수업 목차 닫기" : "수업 목차 열기"}
            className="fixed bottom-6 left-6 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800 text-white shadow-lg transition hover:bg-gray-700 lg:hidden"
          >
            <i className="fas fa-list"></i>
          </button>
        </main>
      </div>
    </div>
  );
};

export default Note;
