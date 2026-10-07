import React, { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";
import MoveClassModal from "./components/MoveClassModal";
import StudentDetailModal from "./components/StudentDetailModal";
import StudentRosterModal from "./components/StudentRosterModal";
import { buildStudentPagination } from "./components/studentPagination";
import "./components/teacher-list-controls.css";
import { useAuth } from "../../contexts/AuthContext";
import { canEditStudentList } from "../../lib/permissions";
import {
  resetLessonCorePointProgress,
  updateStudentData,
} from "../../lib/studentData";
import {
  getStudentEnrollmentLabel,
  getStudentEnrollmentStatus,
  isStudentRosterProfile,
  isActiveRosterStudent,
  isStudentRegistrationPending,
  StudentEnrollmentStatus,
  STUDENT_ENROLLMENT_OPTIONS,
} from "../../lib/studentRoster";

interface Student {
  id: string;
  userId: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
  isTeacherAccount: boolean;
  enrollmentStatus: StudentEnrollmentStatus;
  enrollmentReason: string;
  registrationApprovalStatus?: unknown;
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
  const direct = String(data?.studentGrade || data?.grade || "").trim();
  if (direct) return direct;
  const gradeClass = String(data?.gradeClass ?? "").trim();
  if (!gradeClass) return "";
  const match = gradeClass.match(/^(\S+)\s*학년/);
  return match?.[1] || "";
};

const parseClassValue = (data: any) => {
  const raw = String(data?.studentClass || data?.class || "").trim();
  if (raw) return raw;
  const gradeClass = String(data?.gradeClass ?? "").trim();
  if (!gradeClass) return "";
  const parts = gradeClass.split(/\s+/).filter(Boolean);
  return parts.find((part) => part.includes("반"))?.replace("반", "") || "";
};

const parseNumberValue = (data: any) => {
  const raw = String(data?.studentNumber || data?.number || "").trim();
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

const StudentList: React.FC = () => {
  const { userData, currentUser, config } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [registrationNotice, setRegistrationNotice] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [gradeFilter, setGradeFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [enrollmentFilter, setEnrollmentFilter] = useState("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
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
  const [rosterModalMode, setRosterModalMode] = useState<
    "create" | "enrollment" | "registration" | null
  >(null);
  const [enrollmentTargets, setEnrollmentTargets] = useState<Student[]>([]);
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
  }, [
    normalizedStudents,
    gradeFilter,
    classFilter,
    enrollmentFilter,
    searchQuery,
  ]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [gradeFilter, classFilter, enrollmentFilter, searchQuery]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const fetchStudents = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setLoadError("");
    try {
      const snap = await getDocs(collection(db, "users"));
      const list: Student[] = [];

      snap.forEach((item) => {
        const data = item.data();
        const email = String(data.email || "").trim();
        const isTeacherAccount =
          data.role === "teacher" || email === ADMIN_EMAIL;
        if (!isStudentRosterProfile(data)) return;

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
          enrollmentStatus: getStudentEnrollmentStatus(data),
          enrollmentReason: String(data.enrollmentReason || "").trim(),
          ...(Object.prototype.hasOwnProperty.call(
            data,
            "registrationApprovalStatus",
          )
            ? { registrationApprovalStatus: data.registrationApprovalStatus }
            : {}),
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
    } catch (error) {
      console.error("Error fetching students:", error);
      setLoadError("학생 명단을 불러오지 못했습니다. 새로고침해 주세요.");
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
    if (enrollmentFilter !== "all") {
      result = result.filter((student) =>
        enrollmentFilter === "pending"
          ? isStudentRegistrationPending(student)
          : enrollmentFilter === "active"
            ? isActiveRosterStudent(student)
            : !isStudentRegistrationPending(student) &&
              (enrollmentFilter === "excluded"
                ? student.enrollmentStatus !== "active"
                : student.enrollmentStatus === enrollmentFilter),
      );
    }
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
    setSelectedIds(
      new Set(
        pagedStudents
          .filter((student) => !isStudentRegistrationPending(student))
          .map((student) => student.id),
      ),
    );
  };

  const handleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulkPromote = async () => {
    if (readOnly) return;
    if (
      !window.confirm(`선택한 ${selectedIds.size}명의 학년을 1 올리시겠습니까?`)
    )
      return;
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
          operation: "PROMOTE_GRADE",
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
      alert(
        error instanceof Error
          ? error.message
          : "진급 처리 중 오류가 발생했습니다.",
      );
    }
  };

  const handleResetCorePoints = async (student: Student) => {
    if (readOnly || !isBangTestStudent(student)) return;
    if (
      !window.confirm(
        `${student.name || getStudentIdentityLabel(student)} 학생의 핵심포인트 클릭 기록을 초기화하시겠습니까?\n수업자료 저장 답안은 유지하고, 핵심포인트 발견 기록과 완주 표시만 초기화합니다.`,
      )
    ) {
      return;
    }

    setResettingCorePointStudentIds((current) =>
      new Set(current).add(student.id),
    );
    try {
      const result = await resetLessonCorePointProgress(config, student.userId);
      alert(
        `핵심포인트 기록을 초기화했습니다.\n초기화한 수업자료: ${result.resetUnitCount}개\n삭제한 발견 기록: ${result.removedCorePointFindCount}개`,
      );
    } catch (error) {
      console.error("Failed to reset lesson core point progress:", error);
      alert(getCorePointResetErrorMessage(error));
    } finally {
      setResettingCorePointStudentIds((current) => {
        const next = new Set(current);
        next.delete(student.id);
        return next;
      });
    }
  };

  const handleRefreshList = async () => {
    setGradeFilter("all");
    setClassFilter("all");
    setEnrollmentFilter("active");
    setSearchQuery("");
    setCurrentPage(1);
    setSelectedIds(new Set());
    await fetchStudents();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div
        className={`mx-auto flex w-full max-w-6xl flex-1 animate-fadeIn flex-col px-3 py-6 ${!readOnly && selectedIds.size > 0 ? "teacher-floating-bar-space" : ""}`}
      >
        <div className="flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col items-start justify-between gap-3 border-b bg-gray-50 p-5 md:flex-row md:items-center">
            <h2 className="whitespace-nowrap text-lg font-bold text-gray-800">
              <i className="fas fa-users mr-2 text-blue-500"></i> 학생 명단
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filteredStudents.length}명)
              </span>
            </h2>
            {!readOnly && (
              <button
                type="button"
                onClick={() => {
                  setEnrollmentTargets([]);
                  setRosterModalMode("create");
                }}
                className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
              >
                <i className="fas fa-user-plus mr-2" aria-hidden="true"></i>학생
                등록
              </button>
            )}
          </div>

          <div className="student-list-controls flex flex-col items-center gap-3 border-b border-gray-100">
            {readOnly && (
              <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                읽기 전용 권한입니다. 학생 명단 조회만 가능합니다.
              </div>
            )}
            <div className="student-list-toolbar flex-wrap">
              <div className="w-full md:w-auto">
                <select
                  aria-label="학적 상태 필터"
                  value={enrollmentFilter}
                  onChange={(event) => setEnrollmentFilter(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
                >
                  <option value="active">재학생</option>
                  <option value="pending">등록 대기</option>
                  <option value="excluded">제외 명단 전체</option>
                  {STUDENT_ENROLLMENT_OPTIONS.filter(
                    (option) => option.value !== "active",
                  ).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  <option value="all">전체 학생</option>
                </select>
              </div>
              <select
                aria-label="학년 필터"
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">전체 학년</option>
                {gradeOptions.map((grade) => (
                  <option key={grade.value} value={grade.value}>
                    {grade.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="반 필터"
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="min-h-11 rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">전체 반</option>
                {classOptions.map((cls) => (
                  <option key={cls.value} value={cls.value}>
                    {cls.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleRefreshList()}
                className="student-list-toolbar__action min-h-11 min-w-11 rounded-lg border border-gray-300 text-sm text-gray-600 transition hover:border-blue-500 hover:text-blue-600"
                title="명단 새로고침 및 필터 초기화"
                aria-label="명단 새로고침 및 필터 초기화"
              >
                <i
                  className={`fas fa-sync-alt ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                ></i>
              </button>
              <button
                ref={searchButtonRef}
                type="button"
                onClick={() => {
                  setSearchOpen(!searchOpen);
                  if (searchOpen) setSearchQuery("");
                }}
                aria-expanded={searchOpen}
                aria-controls="student-list-search"
                aria-label={searchOpen ? "학생 검색 닫기" : "학생 검색 열기"}
                title={searchOpen ? "검색 닫기" : "검색"}
                className="student-list-toolbar__action min-h-11 min-w-11 rounded-lg border border-gray-300 text-sm font-bold text-gray-600 transition hover:border-blue-500 hover:text-blue-600"
              >
                <i className="fas fa-search" aria-hidden="true"></i>
              </button>
            </div>
            {searchOpen && (
              <form
                id="student-list-search"
                role="search"
                className="student-list-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  applyFilters();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || event.nativeEvent.isComposing)
                    return;
                  setSearchOpen(false);
                  setSearchQuery("");
                  searchButtonRef.current?.focus();
                }}
              >
                <input
                  lang="ko"
                  inputMode="text"
                  ref={searchInputRef}
                  type="search"
                  aria-label="이름 또는 이메일 검색"
                  placeholder="이름 또는 이메일 검색"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </form>
            )}
          </div>

          {loadError && (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <span>{loadError}</span>
              <button
                type="button"
                onClick={() => void fetchStudents()}
                className="min-h-11 rounded-lg border border-red-200 px-3 font-bold"
              >
                다시 시도
              </button>
            </div>
          )}

          {registrationNotice && (
            <p
              role="status"
              className="border-b border-blue-100 bg-blue-50 p-4 text-sm text-blue-800"
            >
              {registrationNotice}
            </p>
          )}

          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm md:min-w-0">
              <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                <tr>
                  <th className="w-10 p-4 text-center">
                    <input
                      type="checkbox"
                      aria-label="현재 명단 전체 선택"
                      disabled={
                        readOnly ||
                        !pagedStudents.some(
                          (student) => !isStudentRegistrationPending(student),
                        )
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      checked={
                        pagedStudents.some(
                          (student) => !isStudentRegistrationPending(student),
                        ) &&
                        pagedStudents
                          .filter(
                            (student) => !isStudentRegistrationPending(student),
                          )
                          .every((student) => selectedIds.has(student.id))
                      }
                      className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="w-16 p-4 text-center">학년</th>
                  <th className="w-16 p-4 text-center">반</th>
                  <th className="w-16 p-4 text-center">번호</th>
                  <th className="w-32 p-4">이름</th>
                  <th className="p-4">학적 상태</th>
                  <th className="hidden w-64 p-4 lg:table-cell">이메일</th>
                  <th className="w-64 p-4 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-gray-400">
                      데이터를 불러오는 중...
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-gray-400">
                      학생 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((student) => (
                    <tr
                      key={student.id}
                      className="student-list-row group transition hover:bg-blue-50"
                    >
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${student.name || "학생"} 선택`}
                          disabled={
                            readOnly || isStudentRegistrationPending(student)
                          }
                          checked={selectedIds.has(student.id)}
                          onChange={() => handleSelect(student.id)}
                          className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="whitespace-nowrap p-4 text-center font-bold text-gray-700">
                        {getGradeLabel(student.grade)}
                      </td>
                      <td className="whitespace-nowrap p-4 text-center font-bold text-gray-600">
                        {getClassLabel(student.class)}
                      </td>
                      <td className="p-4 text-center font-bold text-gray-600">
                        {student.number}
                      </td>
                      <td className="whitespace-nowrap p-4">
                        <button
                          onClick={() => {
                            setSelectedStudent(student);
                            setDetailInitialTab("summary");
                            setDetailModalOpen(true);
                          }}
                          title="학생 학습 현황 보기"
                          className="w-full text-left font-bold text-gray-800 hover:text-blue-600 hover:underline group-hover:text-blue-600"
                        >
                          <span className="flex items-center">
                            <span>{student.name || "(이름 없음)"}</span>
                            <i className="fas fa-folder-open ml-2 text-xs text-gray-300 group-hover:text-blue-400"></i>
                          </span>
                          {!student.name && (
                            <span className="mt-1 font-mono text-xs font-normal text-gray-500 group-hover:text-blue-500">
                              {getStudentIdentityLabel(student)}
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="p-4 text-sm text-gray-600">
                        <span className="whitespace-nowrap font-bold">
                          {isStudentRegistrationPending(student)
                            ? "등록 대기"
                            : getStudentEnrollmentLabel(
                                student.enrollmentStatus,
                              )}
                        </span>
                        {student.enrollmentReason && (
                          <span className="mt-1 block text-xs">
                            {student.enrollmentReason}
                          </span>
                        )}
                      </td>
                      <td className="hidden p-4 font-mono text-xs text-gray-500 lg:table-cell">
                        {student.email}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {!readOnly &&
                            (isStudentRegistrationPending(student) ? (
                              <button
                                onClick={() => {
                                  setEnrollmentTargets([student]);
                                  setRosterModalMode("registration");
                                }}
                                className="student-list-row__action min-h-11 rounded-lg bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100"
                                aria-label={`${student.name || "학생"} 등록 승인`}
                              >
                                등록 승인
                              </button>
                            ) : (
                              <>
                                <button
                                  onClick={() => {
                                    setSelectedStudent(student);
                                    setDetailInitialTab("profile");
                                    setDetailModalOpen(true);
                                  }}
                                  className="student-list-row__action flex min-h-11 min-w-11 items-center justify-center gap-1 rounded bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-100"
                                  aria-label={`${student.name || "학생"} 정보 수정`}
                                  title="수정"
                                >
                                  <i className="fas fa-edit"></i>
                                  <span className="hidden lg:inline">수정</span>
                                </button>
                                <button
                                  onClick={() => {
                                    setEnrollmentTargets([student]);
                                    setRosterModalMode("enrollment");
                                  }}
                                  className="student-list-row__action flex min-h-11 min-w-11 items-center justify-center gap-1 rounded bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-700 transition hover:bg-gray-200"
                                  title="학적 상태 변경"
                                  aria-label={`${student.name || "학생"} 학적 상태 변경`}
                                >
                                  <i
                                    className="fas fa-user-check"
                                    aria-hidden="true"
                                  ></i>
                                  <span className="hidden lg:inline">학적</span>
                                </button>
                                {isBangTestStudent(student) && (
                                  <button
                                    onClick={() =>
                                      void handleResetCorePoints(student)
                                    }
                                    disabled={resettingCorePointStudentIds.has(
                                      student.id,
                                    )}
                                    className="flex items-center gap-1 rounded bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    title="방테스트 핵심포인트 클릭 기록 초기화"
                                  >
                                    <i
                                      className={`fas ${
                                        resettingCorePointStudentIds.has(
                                          student.id,
                                        )
                                          ? "fa-spinner fa-spin"
                                          : "fa-undo"
                                      }`}
                                    ></i>
                                    <span className="hidden lg:inline">
                                      핵심초기화
                                    </span>
                                  </button>
                                )}
                              </>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && studentPageGroups.length > 1 && (
            <nav
              aria-label="학생 명단 페이지"
              className="student-list-pagination border-t border-gray-100 bg-white"
            >
              {currentPageGroup && (
                <span className="hidden whitespace-nowrap text-xs font-bold text-gray-500 md:inline">
                  현재 {currentPageGroup.label}
                </span>
              )}
              {buildStudentPagination(currentPage, totalPages).map(
                (page, index) => {
                  if (page === "ellipsis") {
                    return (
                      <span
                        key={`gap-${index}`}
                        className="student-list-pagination__gap text-xs text-gray-500"
                        aria-hidden="true"
                      >
                        …
                      </span>
                    );
                  }
                  const group = studentPageGroups[page - 1];
                  return (
                    <button
                      key={group.key}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      title={`${page}페이지: ${group.label}`}
                      aria-label={`${page}페이지, ${group.label}`}
                      aria-current={currentPage === page ? "page" : undefined}
                      className={`rounded-md text-xs font-bold transition ${currentPage === page ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"}`}
                    >
                      {page}
                    </button>
                  );
                },
              )}
            </nav>
          )}
        </div>

        {!readOnly && selectedIds.size > 0 && (
          <div className="teacher-floating-bar-above-patch fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-[720px] -translate-x-1/2 animate-slideUp flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 shadow-2xl md:bottom-8 md:w-auto md:flex-nowrap md:gap-4 md:rounded-full md:px-6 md:py-3">
            <div className="flex items-center justify-center gap-2 whitespace-nowrap leading-tight">
              <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
                {selectedIds.size}명
              </span>
              <span className="text-xs font-bold text-gray-700">선택됨</span>
            </div>
            <div className="hidden h-4 w-px bg-gray-300 md:block"></div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleBulkPromote()}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-blue-600 transition hover:bg-gray-100"
              >
                <i className="fas fa-level-up-alt"></i>
                <span className="text-[11px] font-bold md:text-xs">진급</span>
              </button>
              <button
                onClick={() => setMoveClassModalOpen(true)}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-green-600 transition hover:bg-gray-100"
              >
                <i className="fas fa-exchange-alt"></i>
                <span className="text-[11px] font-bold md:text-xs">
                  반 이동
                </span>
              </button>
              <button
                onClick={() => {
                  setEnrollmentTargets(
                    students.filter((student) => selectedIds.has(student.id)),
                  );
                  setRosterModalMode("enrollment");
                }}
                className="flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-gray-700 transition hover:bg-gray-100"
              >
                <i className="fas fa-user-check" aria-hidden="true"></i>
                <span className="text-[11px] font-bold md:text-xs">
                  학적 변경
                </span>
              </button>
            </div>
            <div className="hidden h-4 w-px bg-gray-300 md:block"></div>
            <button
              onClick={() => setSelectedIds(new Set())}
              aria-label="학생 선택 취소"
              className="min-h-11 min-w-11 p-1 text-gray-400 transition hover:text-gray-600"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}

        <StudentDetailModal
          isOpen={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          student={selectedStudent}
          onUpdate={fetchStudents}
          readOnly={readOnly || isStudentRegistrationPending(selectedStudent)}
          initialTab={detailInitialTab}
        />

        <StudentRosterModal
          mode={readOnly ? null : rosterModalMode}
          targets={enrollmentTargets}
          students={normalizedStudents.map((student) => ({
            ...student,
            grade: student.canonicalGrade,
            class: student.canonicalClass,
          }))}
          gradeOptions={gradeOptions}
          classOptions={classOptions}
          defaultGrade={gradeFilter}
          defaultClass={classFilter}
          onClose={() => setRosterModalMode(null)}
          onComplete={(result) => {
            setRegistrationNotice(
              result?.registrationPending
                ? result.requiresFirstSignIn
                  ? "등록 정보를 저장했습니다. 학생이 학교 계정으로 처음 로그인한 뒤 ‘등록 대기’에서 등록 승인을 진행해 주세요."
                  : "등록 정보를 저장했습니다. ‘등록 대기’에서 학급·번호·이름을 확인하고 등록 승인을 진행해 주세요."
                : result?.registrationApproved
                  ? "학생 등록 승인을 완료했습니다."
                  : "",
            );
            if (result?.registrationPending) setEnrollmentFilter("pending");
            if (result?.registrationApproved) setEnrollmentFilter("active");
            setSelectedIds(new Set());
            void fetchStudents({ silent: true });
          }}
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
      </div>
    </div>
  );
};

export default StudentList;
