import PortalWorkspace from "../../../components/common/PortalWorkspace";
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
      <PortalWorkspace className="teacher-sub-workspace teacher-sub-workspace--page teacher-sub-workspace--lesson">
        <LessonSidebar
          isOpen={isSidebarOpen}
          onOpenChange={setIsSidebarOpen}
          selectedUnitTitle={title}
          onSelectUnit={handleSelectUnit}
          selectedUnitId={unitId}
        />

        <main className="teacher-sub-content">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 md:p-6">
            <LessonContent unitId={unitId} fallbackTitle={title} />
          </div>
        </main>
      </PortalWorkspace>
    </div>
  );
};

export default Note;
