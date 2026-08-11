import React from "react";
import type { ProvenanceKind } from "../../constants/routeMetadata";

const LABELS: Record<ProvenanceKind, string> = {
  CURRENT: "현재 학기",
  PREPARING: "준비 학기",
  ARCHIVE: "지난 학기",
  LEGACY: "이전 자료",
  EXPLICIT: "지정 학기",
};

const ICONS: Record<ProvenanceKind, string> = {
  CURRENT: "m5 12 4 4L19 6",
  PREPARING: "M12 7v5l3 2m6-2a9 9 0 1 1-9-9",
  ARCHIVE: "M4 5h16v4H4V5Zm2 4h12v11H6V9Zm4 4h4",
  LEGACY: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5",
  EXPLICIT: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v4l3 2",
};

const ProvenanceBadge: React.FC<{
  value: ProvenanceKind;
  readOnly?: boolean;
}> = ({ value, readOnly = false }) => (
  <span
    className={`ws-provenance-badge ws-provenance-badge--${value.toLowerCase()}`}
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <path
        d={ICONS[value]}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
    <span>{LABELS[value]}</span>
    {readOnly && (
      <span className="ws-provenance-badge__readonly">읽기 전용</span>
    )}
  </span>
);

export default ProvenanceBadge;
