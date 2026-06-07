import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { InlineLoading } from "../../../components/common/LoadingState";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  PERFORMANCE_SCORE_USER_COLLECTION,
  buildStudentLookupKey,
  buildStudentNameLookupKey,
  formatPerformanceScore,
  getPerformanceScorePercent,
  normalizeSchoolValue,
  normalizeStudentName,
  type PerformanceScoreRecord,
  type PerformanceScoreRoster,
  type PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
import {
  parsePerformanceScoreWorkbook,
  type ParsedPerformanceScoreRow,
  type ParsedPerformanceScoreUpload,
} from "../../../lib/performanceScoreWorkbook";

interface StudentProfile {
  uid: string;
  name: string;
  grade: string;
  class: string;
  number: string;
  email: string;
}

type ParsedScoreRow = ParsedPerformanceScoreRow;
type ParsedUpload = ParsedPerformanceScoreUpload;

const DEFAULT_GRADE_OPTIONS = ["1", "2", "3"];
const DEFAULT_CLASS_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1),
);

const toText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const readWorkbookRows = async (file: File) => {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const workbookRows = (await readXlsxFile(file)) as unknown;
  return Array.isArray(workbookRows) &&
    workbookRows.length === 1 &&
    typeof workbookRows[0] === "object" &&
    workbookRows[0] !== null &&
    Array.isArray((workbookRows[0] as { data?: unknown }).data)
    ? ((workbookRows[0] as { data: unknown[][] }).data as unknown[][])
    : (workbookRows as unknown[][]);
};

const normalizeStudentProfile = (
  id: string,
  data: Record<string, unknown>,
) => ({
  uid: id,
  name: toText(data.studentName || data.name || data.displayName || ""),
  grade: normalizeSchoolValue(data.studentGrade || data.grade || ""),
  class: normalizeSchoolValue(data.studentClass || data.class || ""),
  number: normalizeSchoolValue(data.studentNumber || data.number || ""),
  email: toText(data.email),
});

const matchRowsToStudents = (
  rows: ParsedScoreRow[],
  students: StudentProfile[],
): ParsedScoreRow[] => {
  const byNumber = new Map<string, StudentProfile[]>();
  const byName = new Map<string, StudentProfile[]>();

  students.forEach((student) => {
    const numberKey = buildStudentLookupKey(
      student.grade,
      student.class,
      student.number,
    );
    if (student.grade && student.class && student.number) {
      byNumber.set(numberKey, [...(byNumber.get(numberKey) || []), student]);
    }
    const nameKey = buildStudentNameLookupKey(
      student.grade,
      student.class,
      student.name,
    );
    if (student.grade && student.class && student.name) {
      byName.set(nameKey, [...(byName.get(nameKey) || []), student]);
    }
  });

  return rows.map((row) => {
    const numberMatches = byNumber.get(
      buildStudentLookupKey(row.grade, row.class, row.number),
    );
    const numberMatch =
      numberMatches && numberMatches.length === 1 ? numberMatches[0] : null;
    if (numberMatch) {
      const sameName =
        !row.studentName ||
        normalizeStudentName(row.studentName) ===
          normalizeStudentName(numberMatch.name);
      return {
        ...row,
        uid: numberMatch.uid,
        studentName: row.studentName || numberMatch.name,
        matchStatus: sameName ? "matched" : "name-mismatch",
        matchMessage: sameName
          ? "학년, 반, 번호, 이름이 일치합니다."
          : `번호로 연결했습니다. 등록 명단 이름은 ${numberMatch.name || "이름 없음"}입니다.`,
      };
    }

    const nameMatches = byName.get(
      buildStudentNameLookupKey(row.grade, row.class, row.studentName),
    );
    const nameMatch =
      nameMatches && nameMatches.length === 1 ? nameMatches[0] : null;
    if (nameMatch) {
      return {
        ...row,
        uid: nameMatch.uid,
        number: row.number || nameMatch.number,
        matchStatus: "name-mismatch",
        matchMessage: `이름으로 연결했습니다. 등록 명단 번호는 ${nameMatch.number || "-"}번입니다.`,
      };
    }

    return {
      ...row,
      uid: "",
      matchStatus: "unmatched",
      matchMessage: "학생 명단에서 같은 학년, 반, 번호를 찾지 못했습니다.",
    };
  });
};

const getMatchBadgeClass = (
  status: PerformanceScoreRosterRow["matchStatus"],
) => {
  if (status === "matched") return "bg-emerald-50 text-emerald-700";
  if (status === "name-mismatch") return "bg-amber-50 text-amber-700";
  return "bg-rose-50 text-rose-700";
};

const getMatchLabel = (status: PerformanceScoreRosterRow["matchStatus"]) => {
  if (status === "matched") return "연결";
  if (status === "name-mismatch") return "확인";
  return "미연결";
};

const PerformanceScoreManager: React.FC = () => {
  const { config, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const { year, semester } = getYearSemester(config);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [targetGrade, setTargetGrade] = useState("3");
  const [fallbackClass, setFallbackClass] = useState("");
  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentLoadError, setStudentLoadError] = useState("");
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rosters, setRosters] = useState<PerformanceScoreRoster[]>([]);
  const [rostersLoading, setRostersLoading] = useState(true);
  const [deletingRosterId, setDeletingRosterId] = useState("");

  useEffect(() => {
    setTitle(`${year}학년도 ${semester}학기 수행평가 점수`);
  }, [year, semester]);

  useEffect(() => {
    void loadStudents();
  }, []);

  useEffect(() => {
    void loadRosters();
  }, [year, semester]);

  useEffect(() => {
    if (!parsed || students.length === 0) return;
    setParsed((current) =>
      current
        ? {
            ...current,
            rows: matchRowsToStudents(current.rows, students),
          }
        : current,
    );
  }, [students.length]);

  const rosterCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  );

  const parsedSummary = useMemo(() => {
    const rows = parsed?.rows || [];
    const matchedCount = rows.filter((row) => row.uid).length;
    const scoredCount = rows.filter((row) => row.enteredScoreCount > 0).length;
    const saveableCount = rows.filter(
      (row) => row.uid && row.enteredScoreCount > 0,
    ).length;
    const blankScoreCount = rows.filter(
      (row) => row.enteredScoreCount === 0,
    ).length;
    const warningCount = rows.filter(
      (row) => row.matchStatus === "name-mismatch",
    ).length;
    return {
      rowCount: rows.length,
      matchedCount,
      scoredCount,
      saveableCount,
      blankScoreCount,
      unmatchedCount: rows.length - matchedCount,
      warningCount,
    };
  }, [parsed]);

  const loadStudents = async () => {
    setStudentsLoading(true);
    setStudentLoadError("");
    try {
      const snap = await getDocs(collection(db, "users"));
      const loaded: StudentProfile[] = [];
      snap.forEach((item) => {
        const data = item.data() as Record<string, unknown>;
        const profile = normalizeStudentProfile(item.id, data);
        if (!profile.name && !profile.number && !profile.class) return;
        if (data.role === "teacher" && !profile.number) return;
        loaded.push(profile);
      });
      setStudents(loaded);
    } catch (error) {
      console.error("Failed to load students for performance scores:", error);
      setStudentLoadError(
        "학생 명단을 불러오지 못했습니다. 학생 연결을 위해 학생 명단 조회 권한이 필요합니다.",
      );
    } finally {
      setStudentsLoading(false);
    }
  };

  const loadRosters = async () => {
    setRostersLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, rosterCollectionPath),
          orderBy("createdAt", "desc"),
        ),
      );
      const loaded = snap.docs.map((item) => {
        const data = item.data() as Omit<PerformanceScoreRoster, "id">;
        return {
          id: item.id,
          ...data,
          rows: Array.isArray(data.rows) ? data.rows : [],
          classes: Array.isArray(data.classes) ? data.classes : [],
          items: Array.isArray(data.items) ? data.items : [],
        };
      });
      setRosters(loaded);
    } catch (error) {
      console.error("Failed to load performance score rosters:", error);
    } finally {
      setRostersLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!targetGrade.trim()) {
      showToast({
        tone: "warning",
        title: "대상 학년을 선택해 주세요.",
        message: "파일에 학년 컬럼이 없을 때 학생 연결에 사용됩니다.",
      });
      return;
    }

    setParsing(true);
    try {
      const rows = await readWorkbookRows(file);
      const parsedUpload = parsePerformanceScoreWorkbook(rows, {
        fileName: file.name,
        targetGrade,
        fallbackClass,
      });
      const defaultTitle = `${year}학년도 ${semester}학기 수행평가 점수`;
      if (!title.trim() || title.trim() === defaultTitle) {
        setTitle(parsedUpload.title);
      }
      if (!subject.trim() && parsedUpload.subject) {
        setSubject(parsedUpload.subject);
      }
      const matchedRows = matchRowsToStudents(parsedUpload.rows, students);
      setParsed({
        ...parsedUpload,
        rows: matchedRows,
      });
      showToast({
        tone: "success",
        title: "수행평가 명단을 인식했습니다.",
        message: `${matchedRows.length}개 행을 확인했습니다. 저장 전 미연결 학생을 점검해 주세요.`,
      });
    } catch (error) {
      console.error("Failed to parse performance score workbook:", error);
      showToast({
        tone: "error",
        title: "파일 인식에 실패했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "엑셀 파일의 헤더와 점수 컬럼을 확인해 주세요.",
      });
    } finally {
      setParsing(false);
    }
  };

  const updateFeedback = (rowKey: string, feedback: string) => {
    setParsed((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((row) =>
              row.rowKey === rowKey
                ? {
                    ...row,
                    feedback: feedback.slice(0, 1000),
                    evidence: feedback.slice(0, 1000),
                  }
                : row,
            ),
          }
        : current,
    );
  };

  const saveParsedScores = async () => {
    if (!parsed || saving) return;
    const safeTitle = title.trim();
    if (!safeTitle) {
      showToast({
        tone: "warning",
        title: "평가명을 입력해 주세요.",
        message: "학생 화면에 표시될 수행평가 이름이 필요합니다.",
      });
      return;
    }

    const linkedRows = parsed.rows.filter((row) => row.uid);
    if (!linkedRows.length) {
      showToast({
        tone: "warning",
        title: "연결된 학생이 없습니다.",
        message: "학생 명단과 연결된 행이 있어야 저장할 수 있습니다.",
      });
      return;
    }

    const saveableRows = linkedRows.filter((row) => row.enteredScoreCount > 0);
    if (!saveableRows.length) {
      showToast({
        tone: "warning",
        title: "점수가 입력된 학생 행이 없습니다.",
        message: "점수 칸에 입력된 값이 있는 연결 학생만 저장할 수 있습니다.",
      });
      return;
    }

    const connectedBlankScoreCount = linkedRows.length - saveableRows.length;
    const skippedMessages = [
      parsedSummary.unmatchedCount > 0
        ? `미연결 학생 ${parsedSummary.unmatchedCount}명`
        : "",
      connectedBlankScoreCount > 0
        ? `점수가 비어 있는 연결 학생 ${connectedBlankScoreCount}명`
        : "",
      parsedSummary.warningCount > 0
        ? `이름 확인이 필요한 연결 학생 ${parsedSummary.warningCount}명`
        : "",
    ].filter(Boolean);
    if (
      skippedMessages.length > 0 &&
      !window.confirm(
        `확인 사항: ${skippedMessages.join(", ")}. 점수가 입력된 연결 학생 ${saveableRows.length}명만 저장됩니다. 계속할까요?`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const safeSubject = subject.trim() || parsed.subject;
      const rosterRef = doc(collection(db, rosterCollectionPath));
      const rosterId = rosterRef.id;
      const timestamp = serverTimestamp();
      const rosterRows: PerformanceScoreRosterRow[] = parsed.rows.map(
        ({ rowKey: _rowKey, enteredScoreCount: _enteredScoreCount, ...row }) =>
          row,
      );
      const classList = Array.from(
        new Set(parsed.rows.map((row) => row.class).filter(Boolean)),
      ).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));

      const batch = writeBatch(db);
      batch.set(rosterRef, {
        title: safeTitle,
        subject: safeSubject,
        ...(parsed.assessmentOrder
          ? { assessmentOrder: parsed.assessmentOrder }
          : {}),
        academicYear: year,
        semester,
        targetGrade,
        targetClass:
          classList.length === 1 ? classList[0] : fallbackClass.trim(),
        classes: classList,
        items: parsed.items,
        totalMaxScore: parsed.totalMaxScore,
        rowCount: parsed.rows.length,
        matchedCount: saveableRows.length,
        unmatchedCount: parsed.rows.length - saveableRows.length,
        sourceFileName: parsed.sourceFileName,
        rows: rosterRows,
        uploadedBy: currentUser?.uid || "",
        uploadedByEmail: currentUser?.email || "",
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies Omit<PerformanceScoreRoster, "id">);

      saveableRows.forEach((row) => {
        const userScoreRef = doc(
          db,
          "users",
          row.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          rosterId,
        );
        const payload: PerformanceScoreRecord = {
          rosterId,
          title: safeTitle,
          subject: safeSubject,
          ...(parsed.assessmentOrder
            ? { assessmentOrder: parsed.assessmentOrder }
            : {}),
          academicYear: year,
          semester,
          grade: row.grade,
          class: row.class,
          number: row.number,
          studentName: row.studentName,
          uid: row.uid,
          items: row.items,
          totalScore: row.totalScore,
          totalMaxScore: row.totalMaxScore,
          feedback: row.feedback,
          evidence: row.evidence || row.feedback,
          uploadedAt: timestamp,
          updatedAt: timestamp,
        };
        batch.set(userScoreRef, payload);
      });

      await batch.commit();
      setParsed(null);
      await loadRosters();
      showToast({
        tone: "success",
        title: "수행평가 점수를 저장했습니다.",
        message: `${saveableRows.length}명의 학생 화면에 본인 점수만 표시됩니다.`,
      });
    } catch (error) {
      console.error("Failed to save performance scores:", error);
      showToast({
        tone: "error",
        title: "점수 저장에 실패했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteRoster = async (roster: PerformanceScoreRoster) => {
    if (deletingRosterId) return;
    if (
      !window.confirm(
        `${roster.title} 업로드 기록과 학생별 점수 문서를 삭제할까요?`,
      )
    ) {
      return;
    }

    setDeletingRosterId(roster.id);
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, rosterCollectionPath, roster.id));
      (roster.rows || [])
        .filter((row) => row.uid)
        .forEach((row) => {
          batch.delete(
            doc(
              db,
              "users",
              row.uid,
              PERFORMANCE_SCORE_USER_COLLECTION,
              roster.id,
            ),
          );
        });
      await batch.commit();
      await loadRosters();
      showToast({
        tone: "success",
        title: "업로드 기록을 삭제했습니다.",
        message: "학생별 수행평가 점수 문서도 함께 삭제했습니다.",
      });
    } catch (error) {
      console.error("Failed to delete performance score roster:", error);
      showToast({
        tone: "error",
        title: "삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    } finally {
      setDeletingRosterId("");
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-900">
              수행평가 점수 관리
            </h2>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              최종 점수표를 업로드하면 총점, 평가요소별 점수, 감점 요인과 평가
              근거를 학생별 개인 점수 문서로 저장합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadStudents()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            <i
              className={`fas fa-sync-alt text-xs ${studentsLoading ? "animate-spin" : ""}`}
              aria-hidden="true"
            ></i>
            명단 새로고침
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr]">
          <label className="block">
            <span className="text-xs font-black text-slate-600">평가명</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-600">
              과목 또는 영역
            </span>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="예: 역사"
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            />
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-600">대상 학년</span>
            <select
              value={targetGrade}
              onChange={(event) => setTargetGrade(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            >
              {DEFAULT_GRADE_OPTIONS.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}학년
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-black text-slate-600">기본 반</span>
            <select
              value={fallbackClass}
              onChange={(event) => setFallbackClass(event.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-50"
            >
              <option value="">파일에서 인식</option>
              {DEFAULT_CLASS_OPTIONS.map((classValue) => (
                <option key={classValue} value={classValue}>
                  {classValue}반
                </option>
              ))}
            </select>
          </label>
        </div>

        {studentLoadError && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-800">
            {studentLoadError}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 rounded-xl border border-dashed border-blue-200 bg-blue-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-black text-blue-900">
              엑셀 파일 업로드
            </div>
            <p className="mt-1 text-xs font-bold leading-5 text-blue-700">
              학년, 반, 번호, 이름, 총점, 평가요소별 점수, 선생님 작성 피드백을
              자동으로 인식합니다.
            </p>
          </div>
          <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
            <i className="fas fa-file-arrow-up text-xs" aria-hidden="true"></i>
            {parsing ? "인식 중..." : "점수표 선택"}
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(event) => void handleUpload(event)}
              disabled={parsing}
            />
          </label>
        </div>
      </section>

      {parsed && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900">
                업로드 미리보기
              </h3>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {parsed.sourceFileName} · 헤더 {parsed.headerRowNumber}행 ·{" "}
                {parsed.detectedClasses.length
                  ? `${parsed.detectedClasses.join(", ")}반`
                  : "반 정보 없음"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-700">
                총 {parsedSummary.rowCount}명
              </span>
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                연결 {parsedSummary.matchedCount}명
              </span>
              <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">
                점수 입력 {parsedSummary.scoredCount}명
              </span>
              {parsedSummary.blankScoreCount > 0 && (
                <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600">
                  점수 빈칸 {parsedSummary.blankScoreCount}명
                </span>
              )}
              {parsedSummary.warningCount > 0 && (
                <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">
                  확인 {parsedSummary.warningCount}명
                </span>
              )}
              {parsedSummary.unmatchedCount > 0 && (
                <span className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700">
                  미연결 {parsedSummary.unmatchedCount}명
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {parsed.items.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="rounded-lg border border-slate-200 px-3 py-3"
              >
                <div className="truncate text-sm font-black text-slate-800">
                  {item.name}
                </div>
                <div className="mt-1 text-xs font-bold text-slate-500">
                  {formatPerformanceScore(item.maxScore)}점 만점
                  {item.ratio
                    ? ` · ${formatPerformanceScore(item.ratio)}%`
                    : ""}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[1120px] w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-black text-slate-500">
                <tr>
                  <th className="px-3 py-3 text-center">상태</th>
                  <th className="px-3 py-3 text-center">반</th>
                  <th className="px-3 py-3 text-center">번호</th>
                  <th className="px-3 py-3">이름</th>
                  {parsed.items.map((item, index) => (
                    <th
                      key={`${item.name}-${index}-head`}
                      className="px-3 py-3 text-right"
                    >
                      {item.name}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-right">총점</th>
                  <th className="w-80 px-3 py-3">감점 요인 및 평가 근거</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {parsed.rows.map((row) => (
                  <tr key={row.rowKey} className="align-top">
                    <td className="px-3 py-3 text-center">
                      <span
                        title={row.matchMessage}
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${getMatchBadgeClass(row.matchStatus)}`}
                      >
                        {getMatchLabel(row.matchStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-slate-700">
                      {row.class || "-"}
                    </td>
                    <td className="px-3 py-3 text-center font-bold text-slate-700">
                      {row.number || "-"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-black text-slate-900">
                        {row.studentName || "(이름 없음)"}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-slate-400">
                        {row.matchMessage}
                      </div>
                    </td>
                    {row.items.map((item, index) => (
                      <td
                        key={`${row.rowKey}-${item.name}-${index}`}
                        className="px-3 py-3 text-right font-bold text-slate-700"
                      >
                        {item.scoreEntered === false
                          ? "-"
                          : formatPerformanceScore(item.score)}
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right font-black text-blue-700">
                      {formatPerformanceScore(row.totalScore)} /{" "}
                      {formatPerformanceScore(row.totalMaxScore)}
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        value={row.feedback}
                        onChange={(event) =>
                          updateFeedback(row.rowKey, event.target.value)
                        }
                        rows={2}
                        className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold leading-5 text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                        placeholder="학생에게 보여줄 감점 요인 또는 평가 근거"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={() => setParsed(null)}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => void saveParsedScores()}
              disabled={saving || parsedSummary.saveableCount === 0}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <i className="fas fa-save text-xs" aria-hidden="true"></i>
              {saving ? "저장 중..." : "학생별 점수 저장"}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-slate-900">
              저장된 수행평가 점수
            </h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {year}학년도 {semester}학기 업로드 기록입니다.
            </p>
          </div>
        </div>

        {rostersLoading ? (
          <InlineLoading message="저장된 점수를 불러오는 중입니다." />
        ) : rosters.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm font-bold text-slate-400">
            아직 저장된 수행평가 점수 명단이 없습니다.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {rosters.map((roster) => (
              <div
                key={roster.id}
                className="flex flex-col gap-4 rounded-xl border border-slate-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-base font-black text-slate-900">
                      {roster.title}
                    </h4>
                    <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-black text-blue-700">
                      {roster.targetGrade}학년
                    </span>
                    {roster.classes?.length > 0 && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">
                        {roster.classes.join(", ")}반
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-slate-500">
                    <span>원본: {roster.sourceFileName}</span>
                    <span>
                      저장 {roster.matchedCount}명 / 전체 {roster.rowCount}명
                    </span>
                    <span>
                      만점 {formatPerformanceScore(roster.totalMaxScore)}점
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-500"
                      style={{
                        width: `${getPerformanceScorePercent(
                          roster.matchedCount,
                          roster.rowCount || 1,
                        )}%`,
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteRoster(roster)}
                    disabled={deletingRosterId === roster.id}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-3 text-xs font-black text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <i className="fas fa-trash" aria-hidden="true"></i>
                    {deletingRosterId === roster.id ? "삭제 중" : "삭제"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default PerformanceScoreManager;
