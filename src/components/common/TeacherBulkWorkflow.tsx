import React, { useId } from "react";

export interface TeacherBulkPreviewRow {
  id: string;
  label: string;
  description?: string;
  error?: string;
}

const TeacherBulkWorkflow: React.FC<{
  title: string;
  description: string;
  rows: TeacherBulkPreviewRow[];
  selectedIds: Set<string>;
  statusMessage?: string;
  busy?: boolean;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onRun: () => void;
}> = ({
  title,
  description,
  rows,
  selectedIds,
  statusMessage,
  busy,
  onToggle,
  onSelectAll,
  onClear,
  onRun,
}) => {
  const titleId = useId();
  const validRows = rows.filter((row) => !row.error);
  return (
    <section className="teacher-bulk-workflow" aria-labelledby={titleId}>
      <div className="teacher-bulk-workflow__heading">
        <div>
          <h3 id={titleId}>{title}</h3>
          <p>{description}</p>
        </div>
        <strong>{selectedIds.size}명 선택</strong>
      </div>
      <div className="teacher-bulk-workflow__toolbar">
        <button
          type="button"
          onClick={onSelectAll}
          disabled={!validRows.length}
        >
          현재 목록의 가능한 학생 전체 선택
        </button>
        <button type="button" onClick={onClear} disabled={!selectedIds.size}>
          선택 해제
        </button>
      </div>
      <ul className="teacher-bulk-workflow__list">
        {rows.map((row) => (
          <li key={row.id}>
            <label>
              <input
                type="checkbox"
                checked={selectedIds.has(row.id)}
                disabled={Boolean(row.error) || busy}
                onChange={() => onToggle(row.id)}
              />
              <span>
                <strong>{row.label}</strong>
                <span>{row.error || row.description}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="teacher-bulk-workflow__result" aria-live="polite">
        {statusMessage ||
          "선택한 대상과 영향을 확인한 뒤 실행해 주세요. 실행 전에는 출석 기록이 생기지 않습니다."}
      </div>
      <button
        type="button"
        className="w8-button"
        disabled={!selectedIds.size || busy}
        onClick={onRun}
      >
        {busy ? "일괄 기록 중" : `${selectedIds.size}명 출석 일괄 기록`}
      </button>
    </section>
  );
};

export default TeacherBulkWorkflow;
