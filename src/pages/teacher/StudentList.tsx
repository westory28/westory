import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import ResponsiveDataContainer from "../../components/common/ResponsiveDataContainer";
import StatePanel, {
  type CommonUiState,
} from "../../components/common/StatePanel";
import { useAppDialog } from "../../components/common/AppDialogProvider";
import { useAppToast } from "../../components/common/AppToastProvider";
import { useAuth } from "../../contexts/AuthContext";
import { db } from "../../lib/firebase";
import { canEditStudentList } from "../../lib/permissions";
import { deleteStudentData, updateStudentData } from "../../lib/studentData";
import MoveClassModal from "./components/MoveClassModal";
import StudentDetailModal from "./components/StudentDetailModal";
import "../w8Domains.css";

interface Student {
  id: string;
  userId: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
  isTeacherAccount: boolean;
}

interface SchoolClassOption {
  value: string;
  label: string;
}

interface SchoolGradeOption {
  value: string;
  label: string;
}

interface StudentPageGroup {
  key: string;
  label: string;
  students: Student[];
}

interface StudentListReadError {
  state: Extract<CommonUiState, "ERROR" | "PERMISSION">;
  message: string;
}

const normalizeOptionText = (value: unknown) => String(value ?? "").trim();

const findMatchingOption = <T extends SchoolGradeOption | SchoolClassOption>(
  rawValue: unknown,
  options: T[],
): T | undefined => {
  const normalized = normalizeOptionText(rawValue);
  if (!normalized) return undefined;

  return options.find(
    (option) =>
      normalizeOptionText(option.value) === normalized ||
      normalizeOptionText(option.label) === normalized,
  );
};

const toCanonicalOptionValue = <
  T extends SchoolGradeOption | SchoolClassOption,
>(
  rawValue: unknown,
  options: T[],
) => {
  const normalized = normalizeOptionText(rawValue);
  if (!normalized) return "";
  return findMatchingOption(normalized, options)?.value ?? normalized;
};

const ADMIN_EMAIL = "westoria28@gmail.com";
type StudentDetailInitialTab = "summary" | "profile" | "performance";

const parseGradeValue = (data: any) => {
  const direct = String(data?.studentGrade ?? data?.grade ?? "").trim();
  if (direct) return direct;
  const gradeClass = String(data?.gradeClass ?? "").trim();
  if (!gradeClass) return "";
  const match = gradeClass.match(/^(\S+)\s*학년/);
  return match?.[1] || "";
};

const parseClassValue = (data: any) => {
  const raw = String(data?.studentClass ?? data?.class ?? "").trim();
  if (raw) return raw;
  const gradeClass = String(data?.gradeClass ?? "").trim();
  if (!gradeClass) return "";
  const parts = gradeClass.split(/\s+/).filter(Boolean);
  return parts.find((part) => part.includes("반"))?.replace("반", "") || "";
};

const parseNumberValue = (data: any) => {
  const raw = String(data?.studentNumber ?? data?.number ?? "").trim();
  const parsed = parseInt(raw, 10);
  if (!Number.isNaN(parsed)) return parsed;
  const fromGradeClass = String(data?.gradeClass ?? "").match(/(\d+)\s*번/);
  if (fromGradeClass?.[1]) return parseInt(fromGradeClass[1], 10);
  return 0;
};

const classSortValue = (classValue: string) => {
  const parsed = parseInt(classValue, 10);
  if (!Number.isNaN(parsed)) return { numeric: true, value: parsed };
  return { numeric: false, value: classValue };
};

const getStudentIdentityLabel = (student: Pick<Student, "email" | "userId">) =>
  student.email || student.userId;

const normalizeBangTestIdentity = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\s._-]+/g, "")
    .trim();

const isBangTestStudent = (
  student: Pick<Student, "name" | "email" | "userId" | "id">,
) => {
  return [student.name, student.email, student.userId, student.id].some(
    (value) => {
      const raw = String(value ?? "").trim();
      const normalized = normalizeBangTestIdentity(raw);
      return raw.includes("방테스트") || normalized.includes("bangtest");
    },
  );
};

const getStudentDeleteErrorMessage = (error: unknown) => {
  const code = String((error as { code?: string })?.code || "");
  if (code.includes("permission-denied")) {
    return "학생 삭제 권한이 없습니다. 교사 또는 관리자 권한으로 다시 확인해 주세요.";
  }
  if (code.includes("not-found")) {
    return "삭제할 학생 정보를 찾지 못했습니다. 명단을 새로고침해 주세요.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "삭제 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "학생 삭제에 실패했습니다. 잠시 후 다시 시도해 주세요.";
};

const getCorePointResetErrorMessage = (error: unknown) => {
  const code = String((error as { code?: string })?.code || "");
  if (code.includes("permission-denied")) {
    return "핵심포인트 초기화 권한이 없습니다. 관리자 권한으로 다시 확인해 주세요.";
  }
  if (code.includes("failed-precondition")) {
    return "방테스트 계정만 핵심포인트 기록을 초기화할 수 있습니다.";
  }
  if (code.includes("not-found")) {
    return "초기화할 학생 계정을 찾지 못했습니다. 명단을 새로고침해 주세요.";
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return "초기화 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "핵심포인트 초기화에 실패했습니다. 잠시 후 다시 시도해 주세요.";
};

const getStudentListReadError = (error: unknown): StudentListReadError => {
  const code = String((error as { code?: string })?.code || "");
  if (code.includes("permission-denied")) {
    return {
      state: "PERMISSION",
      message:
        "학생 명단을 볼 권한이 없습니다. 담당 관리자에게 명단 조회 권한을 확인해 주세요.",
    };
  }
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) {
    return {
      state: "ERROR",
      message:
        "네트워크 연결이 불안정해 학생 명단을 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
    };
  }
  return {
    state: "ERROR",
    message: "학생 명단을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
};

const StudentList: React.FC = () => {
  const { userData, currentUser, config } = useAuth();
  const { confirm: confirmAction } = useAppDialog();
  const { showToast } = useAppToast();
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<StudentListReadError | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const [gradeFilter, setGradeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [gradeOptions, setGradeOptions] = useState<SchoolGradeOption[]>([
    { value: "1", label: "1학년" },
    { value: "2", label: "2학년" },
    { value: "3", label: "3학년" },
  ]);
  const [classOptions, setClassOptions] = useState<SchoolClassOption[]>(
    Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1}반`,
    })),
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailInitialTab, setDetailInitialTab] =
    useState<StudentDetailInitialTab>("summary");
  const [moveClassModalOpen, setMoveClassModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [deletingStudentIds, setDeletingStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [resettingCorePointStudentIds, setResettingCorePointStudentIds] =
    useState<Set<string>>(new Set());
  const readOnly = !canEditStudentList(userData, currentUser?.email || "");

  useEffect(() => {
    void fetchStudents();
    void loadSchoolConfig();
  }, []);

  const gradeOrderMap = useMemo(() => {
    return gradeOptions.reduce<Record<string, number>>((acc, item, index) => {
      acc[item.value] = index;
      return acc;
    }, {});
  }, [gradeOptions]);

  const normalizedStudents = useMemo(() => {
    return students.map((student) => ({
      ...student,
      canonicalGrade: toCanonicalOptionValue(student.grade, gradeOptions),
      canonicalClass: toCanonicalOptionValue(student.class, classOptions),
    }));
  }, [students, gradeOptions, classOptions]);

  useEffect(() => {
    applyFilters();
  }, [normalizedStudents, gradeFilter, classFilter, searchQuery]);

  const fetchStudents = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setReadError(null);
    try {
      const snap = await getDocs(collection(db, "users"));
      const list: Student[] = [];

      snap.forEach((item) => {
        const data = item.data();
        const email = String(data.email || "").trim();
        const isTeacherAccount =
          data.role === "teacher" || email === ADMIN_EMAIL;
        const hasStudentProfile =
          !!String(data.studentName || "").trim() ||
          !!String(data.studentGrade || "").trim() ||
          !!String(data.studentClass || "").trim() ||
          !!String(data.studentNumber || "").trim() ||
          !!String(data.grade || "").trim() ||
          !!String(data.class || "").trim() ||
          !!String(data.number || "").trim();
        const includeAsStudent =
          data.role !== "teacher" ||
          (email === ADMIN_EMAIL && hasStudentProfile);
        if (!includeAsStudent) return;

        const resolvedName = String(
          data.studentName ||
            data.name ||
            data.displayName ||
            data.nickname ||
            data.customName ||
            "",
        ).trim();

        list.push({
          id: item.id,
          userId: item.id,
          grade: parseGradeValue(data),
          class: parseClassValue(data),
          number: parseNumberValue(data),
          name: resolvedName,
          email,
          isTeacherAccount,
        });
      });

      list.sort((a, b) => {
        const aCanonicalGrade = toCanonicalOptionValue(a.grade, gradeOptions);
        const bCanonicalGrade = toCanonicalOptionValue(b.grade, gradeOptions);
        const aGradeOrder =
          gradeOrderMap[aCanonicalGrade] ?? Number.MAX_SAFE_INTEGER;
        const bGradeOrder =
          gradeOrderMap[bCanonicalGrade] ?? Number.MAX_SAFE_INTEGER;
        if (aGradeOrder !== bGradeOrder) return aGradeOrder - bGradeOrder;

        if (aCanonicalGrade !== bCanonicalGrade) {
          return aCanonicalGrade.localeCompare(bCanonicalGrade, "ko");
        }

        const aClass = classSortValue(
          toCanonicalOptionValue(a.class, classOptions),
        );
        const bClass = classSortValue(
          toCanonicalOptionValue(b.class, classOptions),
        );
        if (aClass.numeric && bClass.numeric) {
          const classGap = Number(aClass.value) - Number(bClass.value);
          if (classGap !== 0) return classGap;
        } else {
          const classGap = String(aClass.value).localeCompare(
            String(bClass.value),
            "ko",
          );
          if (classGap !== 0) return classGap;
        }

        return a.number - b.number;
      });

      setStudents(list);
      setFilteredStudents(list);
    } catch (error) {
      console.error("Error fetching students:", error);
      setReadError(getStudentListReadError(error));
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  const loadSchoolConfig = async () => {
    try {
      const snap = await getDoc(doc(db, "site_settings", "school_config"));
      if (!snap.exists()) return;
      const data = snap.data() as {
        grades?: Array<{ value?: string; label?: string }>;
        classes?: Array<{ value?: string; label?: string }>;
      };
      const loadedGrades = (data.grades || [])
        .map((item) => ({
          value: String(item?.value ?? "").trim(),
          label: String(item?.label ?? "").trim(),
        }))
        .filter((item) => item.value && item.label);
      const loadedClasses = (data.classes || [])
        .map((item) => ({
          value: String(item?.value ?? "").trim(),
          label: String(item?.label ?? "").trim(),
        }))
        .filter((item) => item.value && item.label);

      if (loadedGrades.length > 0) setGradeOptions(loadedGrades);
      if (loadedClasses.length > 0) setClassOptions(loadedClasses);
    } catch (error) {
      console.error("Failed to load school config:", error);
    }
  };

  const getGradeLabel = (gradeValue: string) => {
    const normalized = String(gradeValue || "").trim();
    if (!normalized) return "-";
    return findMatchingOption(normalized, gradeOptions)?.label || normalized;
  };

  const getClassLabel = (classValue: string) => {
    const normalized = String(classValue || "").trim();
    if (!normalized) return "-";
    return findMatchingOption(normalized, classOptions)?.label || normalized;
  };

  const studentPageGroups = useMemo<StudentPageGroup[]>(() => {
    const groups: StudentPageGroup[] = [];
    const groupByClass = new Map<string, StudentPageGroup>();

    filteredStudents.forEach((student) => {
      const gradeValue = toCanonicalOptionValue(student.grade, gradeOptions);
      const classValue = toCanonicalOptionValue(student.class, classOptions);
      const key = `${gradeValue || "unknown-grade"}::${classValue || "unknown-class"}`;
      const classLabel = getClassLabel(student.class);
      const gradeLabel = getGradeLabel(student.grade);
      const label =
        gradeFilter === "all" && gradeLabel !== "-" && classLabel !== "-"
          ? `${gradeLabel} ${classLabel}`
          : classLabel !== "-"
            ? classLabel
            : gradeLabel !== "-"
              ? `${gradeLabel} 반 미지정`
              : "반 미지정";

      const existing = groupByClass.get(key);
      if (existing) {
        existing.students.push(student);
        return;
      }

      const nextGroup = { key, label, students: [student] };
      groupByClass.set(key, nextGroup);
      groups.push(nextGroup);
    });

    return groups;
  }, [filteredStudents, gradeOptions, classOptions, gradeFilter]);

  const totalPages = Math.max(1, studentPageGroups.length);
  const currentPageGroup = studentPageGroups[currentPage - 1] ?? null;
  const pagedStudents = currentPageGroup?.students ?? [];

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const applyFilters = () => {
    let result = normalizedStudents;
    if (gradeFilter !== "all")
      result = result.filter(
        (student) => student.canonicalGrade === gradeFilter,
      );
    if (classFilter !== "all")
      result = result.filter(
        (student) => student.canonicalClass === classFilter,
      );

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (student) =>
          student.name.toLowerCase().includes(q) ||
          student.email.toLowerCase().includes(q),
      );
    }

    setFilteredStudents(result);
    setCurrentPage(1);
  };

  const handleSelectAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(pagedStudents.map((student) => student.id)));
  };

  const handleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const removeStudentsLocally = (ids: Set<string>) => {
    setStudents((current) => current.filter((student) => !ids.has(student.id)));
    setFilteredStudents((current) =>
      current.filter((student) => !ids.has(student.id)),
    );
    setSelectedIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (readOnly) return;
    const target = students.find((student) => student.id === id);
    if (!target) return;
    const confirmed = await confirmAction({
      title: `${target.name} 학생을 삭제할까요?`,
      message:
        "학생 정보와 연결된 계정 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.",
      confirmLabel: "학생 삭제",
      tone: "danger",
    });
    if (!confirmed) return;
    const previousStudents = students;
    const previousFilteredStudents = filteredStudents;
    setDeletingStudentIds((current) => new Set(current).add(id));
    removeStudentsLocally(new Set([id]));
    try {
      const result = await deleteStudentData(config, target.userId);
      if (result.authUserDeleteError) {
        console.warn("Student auth account cleanup failed", result);
      }
      void fetchStudents({ silent: true });
    } catch (error) {
      console.error("Delete failed", error);
      setStudents(previousStudents);
      setFilteredStudents(previousFilteredStudents);
      void fetchStudents({ silent: true });
      showToast({
        tone: "error",
        title: "학생을 삭제하지 못했습니다.",
        message: getStudentDeleteErrorMessage(error),
      });
    } finally {
      setDeletingStudentIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  const handleBulkDelete = async () => {
    if (readOnly) return;
    const confirmed = await confirmAction({
      title: `선택한 학생 ${selectedIds.size}명을 삭제할까요?`,
      message:
        "선택한 학생 정보와 연결된 계정 데이터를 차례로 삭제합니다. 이 작업은 되돌릴 수 없습니다.",
      confirmLabel: `${selectedIds.size}명 삭제`,
      tone: "danger",
    });
    if (!confirmed) return;
    const targets = Array.from(selectedIds)
      .map((id) => students.find((student) => student.id === id))
      .filter((student): student is Student => Boolean(student));
    if (!targets.length) return;
    const targetIds = new Set(targets.map((student) => student.id));
    const previousStudents = students;
    const previousFilteredStudents = filteredStudents;
    setDeletingStudentIds(targetIds);
    removeStudentsLocally(targetIds);
    try {
      for (const target of targets) {
        const result = await deleteStudentData(config, target.userId);
        if (result.authUserDeleteError) {
          console.warn("Student auth account cleanup failed", result);
        }
      }
      void fetchStudents({ silent: true });
    } catch (error) {
      console.error("Bulk delete failed", error);
      setStudents(previousStudents);
      setFilteredStudents(previousFilteredStudents);
      void fetchStudents({ silent: true });
      showToast({
        tone: "error",
        title: "선택한 학생을 모두 삭제하지 못했습니다.",
        message: getStudentDeleteErrorMessage(error),
      });
    } finally {
      setDeletingStudentIds(new Set());
    }
  };

  const handleBulkPromote = async () => {
    if (readOnly) return;
    const confirmed = await confirmAction({
      title: `선택한 학생 ${selectedIds.size}명을 진급 처리할까요?`,
      message: "선택한 학생의 학년을 각각 1학년씩 올립니다.",
      confirmLabel: "진급 처리",
      tone: "warning",
    });
    if (!confirmed) return;
    const targets = Array.from(selectedIds)
      .map((id) => students.find((student) => student.id === id))
      .filter((student): student is Student => Boolean(student))
      .map((student) => {
        const parsedGrade = parseInt(
          toCanonicalOptionValue(student.grade, gradeOptions),
          10,
        );
        if (Number.isNaN(parsedGrade)) return null;
        return {
          student,
          nextGrade: String(parsedGrade + 1),
        };
      })
      .filter(
        (item): item is { student: Student; nextGrade: string } =>
          item !== null,
      );
    if (!targets.length) return;
    const previousStudents = students;
    const previousFilteredStudents = filteredStudents;
    try {
      const nextGradeById = new Map(
        targets.map(({ student, nextGrade }) => [student.id, nextGrade]),
      );
      setStudents((current) =>
        current.map((student) =>
          nextGradeById.has(student.id)
            ? {
                ...student,
                grade: nextGradeById.get(student.id) || student.grade,
              }
            : student,
        ),
      );
      setFilteredStudents((current) =>
        current.map((student) =>
          nextGradeById.has(student.id)
            ? {
                ...student,
                grade: nextGradeById.get(student.id) || student.grade,
              }
            : student,
        ),
      );
      for (const { student, nextGrade } of targets) {
        await updateStudentData(config, {
          uid: student.userId,
          grade: nextGrade,
          class: student.class,
          number: student.number,
          name: student.name,
          email: student.email,
        });
      }
      setSelectedIds(new Set());
      void fetchStudents({ silent: true });
    } catch (error) {
      console.error("Bulk promote failed", error);
      setStudents(previousStudents);
      setFilteredStudents(previousFilteredStudents);
      void fetchStudents({ silent: true });
      showToast({
        tone: "error",
        title: "진급 처리를 완료하지 못했습니다.",
        message: "학생 명단을 새로고침한 뒤 다시 시도해 주세요.",
      });
    }
  };

  const handleResetCorePoints = async (student: Student) => {
    if (readOnly || !isBangTestStudent(student)) return;
    showToast({
      tone: "info",
      title: "핵심포인트 초기화 기능이 종료되었습니다.",
      message: "학습 운영 화면에서 학생의 학습 진행 기록을 확인해 주세요.",
    });
  };

  const handleRefreshList = async () => {
    setGradeFilter("all");
    setClassFilter("all");
    setSearchQuery("");
    setCurrentPage(1);
    setSelectedIds(new Set());
    await fetchStudents();
  };

  const allPagedStudentsSelected =
    pagedStudents.length > 0 &&
    pagedStudents.every((student) => selectedIds.has(student.id));
  const showRoster = !readError || students.length > 0;

  return (
    <section
      className="w8-domain-page student-roster"
      aria-label="학생과 학급 명단"
    >
      {readOnly && (
        <p className="student-roster__notice" role="status">
          읽기 전용 권한입니다. 학생 정보는 확인할 수 있지만 수정하거나 삭제할
          수 없습니다.
        </p>
      )}

      <section
        className="student-roster__controls"
        aria-labelledby="student-roster-filter-title"
      >
        <div className="student-roster__section-heading">
          <div>
            <h2 id="student-roster-filter-title">학생 찾기</h2>
            <p>학년과 반을 고르거나 이름·이메일로 검색하세요.</p>
          </div>
          <span className="student-roster__count" aria-live="polite">
            {filteredStudents.length.toLocaleString("ko-KR")}명
          </span>
        </div>

        <form
          className="student-roster__filter-form"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters();
          }}
        >
          <label className="student-roster__field">
            <span>학년</span>
            <select
              value={gradeFilter}
              onChange={(event) => setGradeFilter(event.target.value)}
            >
              <option value="all">전체 학년</option>
              {gradeOptions.map((grade) => (
                <option key={grade.value} value={grade.value}>
                  {grade.label}
                </option>
              ))}
            </select>
          </label>
          <label className="student-roster__field">
            <span>반</span>
            <select
              value={classFilter}
              onChange={(event) => setClassFilter(event.target.value)}
            >
              <option value="all">전체 반</option>
              {classOptions.map((cls) => (
                <option key={cls.value} value={cls.value}>
                  {cls.label}
                </option>
              ))}
            </select>
          </label>
          <label className="student-roster__field student-roster__field--search">
            <span>이름 또는 이메일</span>
            <input
              type="search"
              placeholder="검색어 입력"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <button type="submit" className="w8-button">
            검색
          </button>
          <button
            type="button"
            className="w8-button w8-button--secondary"
            onClick={() => void handleRefreshList()}
            disabled={loading}
          >
            {loading ? "새로고침 중" : "초기화·새로고침"}
          </button>
        </form>
      </section>

      {readError && (
        <StatePanel
          state={readError.state}
          compact
          headingLevel={2}
          title={
            students.length > 0 ? "명단을 새로고침하지 못했습니다." : undefined
          }
          description={readError.message}
          action={
            readError.state === "ERROR"
              ? { label: "다시 불러오기", onClick: () => void fetchStudents() }
              : undefined
          }
          retryable={readError.state === "ERROR"}
          contactAdmin={readError.state === "PERMISSION"}
        />
      )}

      {!readOnly && selectedIds.size > 0 && (
        <section
          className="student-roster__bulk"
          aria-label={`선택한 학생 ${selectedIds.size}명 일괄 작업`}
        >
          <div className="student-roster__bulk-copy">
            <strong>{selectedIds.size.toLocaleString("ko-KR")}명 선택됨</strong>
            <span>선택한 학생에게 적용할 작업을 고르세요.</span>
          </div>
          <div className="student-roster__bulk-actions">
            <button
              type="button"
              className="w8-button"
              onClick={() => void handleBulkPromote()}
            >
              1학년 진급
            </button>
            <button
              type="button"
              className="w8-button w8-button--secondary"
              onClick={() => setMoveClassModalOpen(true)}
            >
              반 이동
            </button>
            <button
              type="button"
              className="w8-button w8-button--danger"
              onClick={() => void handleBulkDelete()}
              disabled={deletingStudentIds.size > 0}
            >
              {deletingStudentIds.size > 0 ? "학생 삭제 중" : "학생 삭제"}
            </button>
            <button
              type="button"
              className="w8-button w8-button--secondary"
              onClick={() => setSelectedIds(new Set())}
            >
              선택 해제
            </button>
          </div>
        </section>
      )}

      {showRoster && (
        <section
          className="student-roster__table-section"
          aria-labelledby="student-roster-result-title"
          aria-busy={loading}
        >
          <div className="student-roster__section-heading">
            <div>
              <h2 id="student-roster-result-title">조회 결과</h2>
              <p>
                {currentPageGroup
                  ? `${currentPageGroup.label} 학생을 표시하고 있습니다.`
                  : "현재 조건에 맞는 학생을 표시합니다."}
              </p>
            </div>
          </div>

          <ResponsiveDataContainer
            className="student-roster__table-shell"
            label="학생 명단과 관리 작업"
            description="좁은 화면에서는 표를 좌우로 이동해 모든 항목을 확인할 수 있습니다."
          >
            <table className="student-roster__table">
              <caption className="w8-visually-hidden">
                현재 필터에 맞는 학생 명단
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="student-roster__select-column">
                    <label className="student-roster__checkbox">
                      <input
                        type="checkbox"
                        aria-label="현재 페이지 학생 전체 선택"
                        onChange={(event) =>
                          handleSelectAll(event.target.checked)
                        }
                        checked={allPagedStudentsSelected}
                        disabled={readOnly || pagedStudents.length === 0}
                      />
                    </label>
                  </th>
                  <th scope="col" className="student-roster__short-column">
                    학년
                  </th>
                  <th scope="col" className="student-roster__short-column">
                    반
                  </th>
                  <th scope="col" className="student-roster__short-column">
                    번호
                  </th>
                  <th scope="col" className="student-roster__name-column">
                    이름
                  </th>
                  <th scope="col" className="student-roster__email-column">
                    이메일
                  </th>
                  <th scope="col" className="student-roster__actions-column">
                    관리
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="student-roster__table-state">
                      학생 명단을 불러오고 있습니다.
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="student-roster__table-state">
                      {students.length === 0
                        ? "아직 등록된 학생이 없습니다."
                        : "검색 조건에 맞는 학생이 없습니다. 필터를 바꿔 보세요."}
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((student) => (
                    <tr key={student.id}>
                      <td className="student-roster__select-column">
                        <label className="student-roster__checkbox">
                          <input
                            type="checkbox"
                            aria-label={`${student.name || "이름 없음"} 학생 선택`}
                            checked={selectedIds.has(student.id)}
                            onChange={() => handleSelect(student.id)}
                            disabled={readOnly}
                          />
                        </label>
                      </td>
                      <td className="student-roster__short-column">
                        {getGradeLabel(student.grade)}
                      </td>
                      <td className="student-roster__short-column">
                        {getClassLabel(student.class)}
                      </td>
                      <td className="student-roster__short-column">
                        {student.number}
                      </td>
                      <td className="student-roster__name-column">
                        <button
                          type="button"
                          className="student-roster__name-button"
                          onClick={() => {
                            setSelectedStudent(student);
                            setDetailInitialTab("summary");
                            setDetailModalOpen(true);
                          }}
                          title="학생 학습 현황 보기"
                        >
                          <strong>{student.name || "(이름 없음)"}</strong>
                          {!student.name && (
                            <span>{getStudentIdentityLabel(student)}</span>
                          )}
                          <span className="student-roster__email-inline">
                            {student.email || "이메일 없음"}
                          </span>
                        </button>
                      </td>
                      <td className="student-roster__email-column">
                        <span className="student-roster__email">
                          {student.email || "-"}
                        </span>
                      </td>
                      <td className="student-roster__actions-column">
                        {readOnly ? (
                          <span className="student-roster__readonly-label">
                            조회 전용
                          </span>
                        ) : (
                          <div className="student-roster__row-actions">
                            <button
                              type="button"
                              className="student-roster__action"
                              onClick={() => {
                                setSelectedStudent(student);
                                setDetailInitialTab("profile");
                                setDetailModalOpen(true);
                              }}
                              aria-label={`${student.name || "이름 없음"} 학생 정보 수정`}
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              className="student-roster__action student-roster__action--danger"
                              onClick={() => void handleDelete(student.id)}
                              disabled={deletingStudentIds.has(student.id)}
                              aria-label={`${student.name || "이름 없음"} 학생 정보 삭제`}
                              title={
                                student.isTeacherAccount
                                  ? "학생 정보만 삭제"
                                  : "학생 정보 삭제"
                              }
                            >
                              {deletingStudentIds.has(student.id)
                                ? "삭제 중"
                                : "삭제"}
                            </button>
                            {isBangTestStudent(student) && (
                              <button
                                type="button"
                                className="student-roster__action student-roster__action--accent"
                                onClick={() =>
                                  void handleResetCorePoints(student)
                                }
                                disabled={resettingCorePointStudentIds.has(
                                  student.id,
                                )}
                              >
                                학습 기록 안내
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveDataContainer>

          {!loading && studentPageGroups.length > 1 && (
            <nav
              className="student-roster__pagination"
              aria-label="학급별 학생 명단 페이지"
            >
              {currentPageGroup && <span>현재 {currentPageGroup.label}</span>}
              <div className="student-roster__pages">
                {studentPageGroups.map((group, index) => {
                  const page = index + 1;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      title={`${page}페이지: ${group.label}`}
                      aria-label={`${page}페이지, ${group.label}`}
                      aria-current={currentPage === page ? "page" : undefined}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
            </nav>
          )}
        </section>
      )}

      <StudentDetailModal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        student={selectedStudent}
        onUpdate={fetchStudents}
        readOnly={readOnly}
        initialTab={detailInitialTab}
      />

      <MoveClassModal
        isOpen={!readOnly && moveClassModalOpen}
        onClose={() => setMoveClassModalOpen(false)}
        selectedIds={selectedIds}
        students={students}
        onComplete={() => {
          setSelectedIds(new Set());
          void fetchStudents({ silent: true });
        }}
      />
    </section>
  );
};

export default StudentList;
