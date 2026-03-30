import React, { useState, useEffect } from "react";
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
    <div className="relative h-full overflow-hidden bg-gray-50">
      <div className="mx-auto flex h-full max-w-7xl gap-3 px-3 py-4 md:gap-4 md:px-4 lg:px-6">
      <LessonSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onSelectUnit={handleSelectUnit}
        selectedUnitId={unitId}
      />

      <main className="relative flex h-[calc(100vh-64px)] min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-gray-200 bg-white shadow-sm">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scroll">
          <LessonContent unitId={unitId} fallbackTitle={title} />
        </div>

        {/* Mobile FAB to toggle sidebar */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="lg:hidden fixed bottom-6 right-6 w-12 h-12 bg-gray-800 text-white rounded-full shadow-lg flex items-center justify-center z-30 hover:bg-gray-700 transition"
        >
          <i className="fas fa-list"></i>
        </button>
      </main>
      </div>
    </div>
  );
};

export default Note;
