import { useState } from "react";
import "./QuizAnalysisSort.css";

export type AnalysisSortDirection = "ascending" | "descending";
export interface AnalysisTableSort {
  key: string;
  direction: AnalysisSortDirection;
}
type SortValue = string | number | null | undefined;

export function sortAnalysisRows<T>(
  rows: readonly T[],
  sort: AnalysisTableSort,
  value: (row: T, key: string) => SortValue,
): T[] {
  return [...rows].sort((left, right) => {
    const a = value(left, sort.key);
    const b = value(right, sort.key);
    const missingA =
      a == null || (typeof a === "number" && !Number.isFinite(a));
    const missingB =
      b == null || (typeof b === "number" && !Number.isFinite(b));
    // Missing statistics stay last in either direction; they are never zeroes.
    if (missingA || missingB) return Number(missingA) - Number(missingB);
    const order =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), "ko", { numeric: true });
    return sort.direction === "ascending" ? order : -order;
  });
}

export function useAnalysisTableSort(initial: AnalysisTableSort) {
  const [sort, setSort] = useState(initial);
  return {
    sort,
    resetSort: setSort,
    onSort: (key: string, defaultDirection: AnalysisSortDirection) =>
      setSort((current) => ({
        key,
        direction:
          current.key === key
            ? current.direction === "ascending"
              ? "descending"
              : "ascending"
            : defaultDirection,
      })),
  };
}

export function AnalysisSortHeader({
  column,
  label,
  sort,
  onSort,
  defaultDirection = "descending",
  colSpan,
  className,
  as = "th",
  children,
}: {
  column: string;
  label: string;
  sort: AnalysisTableSort;
  onSort: (key: string, direction: AnalysisSortDirection) => void;
  defaultDirection?: AnalysisSortDirection;
  colSpan?: number;
  className?: string;
  as?: "th" | "span";
  children?: React.ReactNode;
}) {
  const active = sort.key === column;
  const nextDirection = active
    ? sort.direction === "ascending"
      ? "descending"
      : "ascending"
    : defaultDirection;
  const content = (
    <>
      <button
        type="button"
        className="qaa-sort-button"
        onClick={() => onSort(column, defaultDirection)}
        aria-label={`${label} ${nextDirection === "ascending" ? "오름차순" : "내림차순"} 정렬`}
      >
        {label}
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="m4 6 4-4 4 4"
            className={
              active && sort.direction === "ascending" ? "qaa-sort-active" : ""
            }
          />
          <path
            d="m4 10 4 4 4-4"
            className={
              active && sort.direction === "descending" ? "qaa-sort-active" : ""
            }
          />
        </svg>
      </button>
      {children}
    </>
  );
  return as === "span" ? (
    <span
      role="columnheader"
      className={className}
      aria-sort={active ? sort.direction : "none"}
    >
      {content}
    </span>
  ) : (
    <th
      scope="col"
      colSpan={colSpan}
      className={className}
      aria-sort={active ? sort.direction : "none"}
    >
      {content}
    </th>
  );
}
