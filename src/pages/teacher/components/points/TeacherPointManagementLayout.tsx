import React, { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import PortalSubNavigation from "../../../../components/common/PortalSubNavigation";
import PortalWorkspace from "../../../../components/common/PortalWorkspace";
import TeacherNavigationIcon from "../../../../components/layout/TeacherNavigationIcon";
import { TEACHER_POINT_TAB_LABELS } from "../../../../constants/pointLabels";
import "./teacherPointManagement.css";

const managementSections = [
  { id: "overview", icon: "wis" },
  { id: "grant", icon: "students" },
  { id: "policy", icon: "sliders" },
  { id: "ranks", icon: "score" },
] as const;

const TeacherPointManagementLayout: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [params] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const activeSection =
    managementSections.find(({ id }) => id === params.get("tab")) ||
    managementSections[0];

  return (
    <PortalWorkspace
      className="teacher-sub-workspace teacher-sub-workspace--page teacher-wis-management-workspace"
      footerActive={
        activeSection.id !== "policy" && activeSection.id !== "ranks"
      }
    >
      <PortalSubNavigation
        title="위스 관리"
        activeLabel={TEACHER_POINT_TAB_LABELS[activeSection.id]}
        open={menuOpen}
        onOpenChange={setMenuOpen}
      >
        {managementSections.map(({ id, icon }) => (
          <Link
            key={id}
            to={
              id === "overview"
                ? "/teacher/points"
                : `/teacher/points?tab=${id}`
            }
            className={`teacher-settings-section${activeSection.id === id ? " is-active" : ""}`}
            aria-current={activeSection.id === id ? "page" : undefined}
            onClick={() => setMenuOpen(false)}
          >
            <TeacherNavigationIcon name={icon} />
            <span>{TEACHER_POINT_TAB_LABELS[id]}</span>
          </Link>
        ))}
      </PortalSubNavigation>
      <section
        className="teacher-sub-content"
        aria-label={TEACHER_POINT_TAB_LABELS[activeSection.id]}
      >
        {children}
      </section>
    </PortalWorkspace>
  );
};

export default TeacherPointManagementLayout;
