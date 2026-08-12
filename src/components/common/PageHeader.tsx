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

  return (
    <header className="ws-page-header">
      <div className="ws-page-header__copy">
        <h1 className="ws-page-header__title">{metadata.title}</h1>
        <p>{metadata.description}</p>
      </div>
      <SemesterContextBar />
    </header>
  );
};

export default PageHeader;
