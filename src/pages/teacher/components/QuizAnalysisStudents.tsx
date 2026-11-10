import { useEffect, useState } from "react";
import "./QuizAnalysisStudents.css";

type StudentIdentity = {
  name?: string;
  number?: string | number;
  grade?: string | number;
  classNumber?: string | number;
  classId?: string;
};
const knownNumber = (value: unknown) => {
  const text = String(value ?? "");
  return /^\d+$/.test(text) && Number(text) > 0 ? String(Number(text)) : "";
};

export function analysisStudentLabel(
  student: StudentIdentity | undefined,
  classes: Array<{ id: string; label: string }>,
) {
  const name = student?.name || "이름 미등록";
  const label = classes.find((entry) => entry.id === student?.classId)?.label;
  const parsed = label?.match(/^(\d+)학년\s*(\d+)반$/);
  const grade = knownNumber(student?.grade) || knownNumber(parsed?.[1]);
  const classNumber =
    knownNumber(student?.classNumber) || knownNumber(parsed?.[2]);
  const number = knownNumber(student?.number);
  if (grade && classNumber && number)
    return `${name}(${grade}${classNumber.padStart(2, "0")}${number.padStart(2, "0")})`;
  const known = [
    grade ? `${grade}학년` : "",
    classNumber ? `${classNumber}반` : "",
    number ? `${number}번` : "",
  ].filter(Boolean);
  return known.length ? `${name}(${known.join(" ")})` : name;
}

/** Only the rendered student window changes; analysis always uses all rows. */
export function useAnalysisStudentWindow(resetKey: string) {
  const [window, setWindow] = useState({ key: resetKey, count: 30 });
  const count = window.key === resetKey ? window.count : 30;
  useEffect(() => {
    setWindow((current) =>
      current.key === resetKey ? current : { key: resetKey, count: 30 },
    );
  }, [resetKey]);
  return {
    count,
    onMore: () =>
      setWindow((current) => ({
        key: resetKey,
        count: (current.key === resetKey ? current.count : 30) + 30,
      })),
  };
}

export function AnalysisStudentsMore({
  count,
  total,
  onMore,
}: {
  count: number;
  total: number;
  onMore: () => void;
}) {
  if (count >= total) return null;
  return (
    <div className="qa-students-more">
      <button
        type="button"
        className="qca-secondary"
        onClick={onMore}
        aria-label={`학생 ${Math.min(30, total - count)}명 더 보기`}
      >
        더 보기{" "}
        <span>
          ({count}/{total}명)
        </span>
      </button>
    </div>
  );
}
