import React from "react";
import { useLocation } from "react-router-dom";
import { getRouteMetadata } from "../../constants/routeMetadata";
import SemesterContextBar from "./SemesterContextBar";

const PageHeader: React.FC = () => {
  const location = useLocation();
  const metadata = getRouteMetadata(location.pathname);

  React.useEffect(() => {
    document.title = metadata ? `${metadata.title} | 위스토리` : "위스토리";
  }, [metadata]);

  if (!metadata) return null;
  const isRunner =
    metadata.id === "student-quiz-run" || metadata.id === "student-history-run";
  if (isRunner) return null;
  const isTeacherRoute = location.pathname.startsWith("/teacher");

  return (
    <header className="ws-page-header">
      <div className="ws-page-header__copy">
        <h1 className="ws-page-header__title">{metadata.title}</h1>
        <p>{metadata.description}</p>
      </div>
      <div className="ws-page-header__context">
        <SemesterContextBar />
        {isTeacherRoute && (
          <button
            type="button"
            className="ws-page-header__memo-button"
            aria-haspopup="dialog"
            aria-controls="teacher-patch-memo-panel"
            onClick={() =>
              window.dispatchEvent(new Event("westory:open-patch-memo"))
            }
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                d="m4 20 4.25-1 10.5-10.5a2.12 2.12 0 0 0-3-3L5.25 16 4 20Zm10.5-13.5 3 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.8"
              />
            </svg>
            패치 메모
          </button>
        )}
      </div>
    </header>
  );
};

export default PageHeader;
