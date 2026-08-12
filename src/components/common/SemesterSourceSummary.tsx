import React from "react";
import type { ProvenanceKind } from "../../constants/routeMetadata";
import ProvenanceBadge from "./ProvenanceBadge";

interface SemesterSourceSummaryProps {
  label: string;
  semesterId?: string | null;
  provenance: ProvenanceKind;
  readOnly: boolean;
  status?: string | null;
  revision?: number | null;
  schemaVersion?: number | null;
  description?: string;
  audience?: "student" | "operator";
}

const SemesterSourceSummary: React.FC<SemesterSourceSummaryProps> = ({
  label,
  semesterId,
  provenance,
  readOnly,
  status,
  revision,
  schemaVersion,
  description,
  audience = "operator",
}) => (
  <section
    className={`ws-semester-source ws-semester-source--${provenance.toLowerCase()}`}
    aria-label={`${label} 학기 출처`}
  >
    <div className="ws-semester-source__heading">
      <div>
        <p className="ws-semester-source__label">{label}</p>
        <h2>{semesterId || "학기 정보 없음"}</h2>
      </div>
      <ProvenanceBadge value={provenance} readOnly={readOnly} />
    </div>

    {description && (
      <p className="ws-semester-source__description">{description}</p>
    )}

    {audience === "operator" && (
      <dl className="ws-semester-source__metadata">
        <div>
          <dt>상태</dt>
          <dd>{status || "확인되지 않음"}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{Number.isFinite(revision) ? revision : "확인되지 않음"}</dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd>
            {Number.isFinite(schemaVersion) ? schemaVersion : "확인되지 않음"}
          </dd>
        </div>
      </dl>
    )}
  </section>
);

export default SemesterSourceSummary;
