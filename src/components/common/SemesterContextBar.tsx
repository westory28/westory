import React from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import type { ProvenanceKind } from "../../constants/routeMetadata";
import ProvenanceBadge from "./ProvenanceBadge";

interface TrustedSemesterContext {
  provenance: ProvenanceKind;
  acceptsSemester: boolean;
  semesterParam: "semesterId" | "target";
  readOnly: boolean;
}

const getTrustedContext = (
  pathname: string,
  search: string,
): TrustedSemesterContext => {
  const params = new URLSearchParams(search);
  if (pathname === "/student/mypage/archive") {
    return {
      provenance: "ARCHIVE",
      acceptsSemester: true,
      semesterParam: "semesterId",
      readOnly: true,
    };
  }
  if (pathname === "/teacher/settings/cutover") {
    return {
      provenance: "PREPARING" as ProvenanceKind,
      acceptsSemester: true,
      semesterParam: "target",
      readOnly: true,
    };
  }
  if (pathname === "/teacher/settings") {
    const tab = params.get("tab");
    if (tab === "archive-enrollment" || tab === "archive-records") {
      return {
        provenance: "ARCHIVE" as ProvenanceKind,
        acceptsSemester: true,
        semesterParam: "semesterId",
        readOnly: true,
      };
    }
    if (tab === "semester") {
      return {
        provenance: "PREPARING" as ProvenanceKind,
        acceptsSemester: true,
        semesterParam: "semesterId",
        readOnly: false,
      };
    }
  }
  return {
    provenance: "CURRENT" as ProvenanceKind,
    acceptsSemester: false,
    semesterParam: "semesterId",
    readOnly: false,
  };
};

const SemesterContextBar: React.FC = () => {
  const { config } = useAuth();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const context = getTrustedContext(location.pathname, location.search);
  const requestedSemesterId = params.get(context.semesterParam) || "";
  const explicitSemesterId =
    context.acceptsSemester && /^\d{4}-[12]$/u.test(requestedSemesterId)
      ? requestedSemesterId
      : "";
  const currentSemesterId =
    config?.year && config?.semester
      ? `${config.year}학년도 ${config.semester}학기`
      : "학기 확인 중";
  const semesterLabel = explicitSemesterId
    ? explicitSemesterId.replace(/^(\d{4})-(\d)$/u, "$1학년도 $2학기")
    : context.provenance === "ARCHIVE"
      ? "지난 학기"
      : context.provenance === "PREPARING"
        ? "준비 학기"
        : currentSemesterId;
  const readOnly = context.provenance === "ARCHIVE" || context.readOnly;

  return (
    <div className="ws-semester-context" aria-label="학기와 자료 출처">
      <span className="ws-semester-context__label">{semesterLabel}</span>
      <ProvenanceBadge value={context.provenance} readOnly={readOnly} />
    </div>
  );
};

export default SemesterContextBar;
