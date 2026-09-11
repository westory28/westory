import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAppDialog } from "../../components/common/AppDialogProvider";
import { db } from "../../lib/firebase";
import MoveClassModal from "./components/MoveClassModal";
import StudentRegistrationApprovalPanel from "./components/StudentRegistrationApprovalPanel";
import StudentDetailModal from "./components/StudentDetailModal";
import { useAuth } from "../../contexts/AuthContext";
import { canEditStudentList, canManageW8Domains } from "../../lib/permissions";
import {
  getArchiveEnrollmentState,
  type ArchiveEnrollmentState,
} from "../../lib/archiveEnrollment";
import { readSiteSettingDoc } from "../../lib/siteSettings";
import {
  deleteStudentData,
  updateStudentData,
  loadStudentProfileEditStates,
  hasPendingStudentProfileUpdate,
  retryStudentProfileUpdate,
  studentProfileUpdateError,
  type StudentProfileEditState,
} from "../../lib/studentData";
import {
  W8DomainError,
  getW8DomainState,
  resetLearningProgress,
} from "../../lib/w8Domains";

interface Student {
  id: string;
  userId: string;
  grade: string;
  class: string;
  number: number;
  name: string;
  email: string;
  isTeacherAccount: boolean;
  editState?: StudentProfileEditState;
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
  if (error instanceof W8DomainError) return error.message;
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

const loadScopedStudentProfiles = async (studentUids: string[]) => {
  const profiles = new Map<string, Record<string, any>>();
  const uniqueUids = Array.from(
    new Set(studentUids.map((uid) => uid.trim()).filter(Boolean)),
  );
  for (let index = 0; index < uniqueUids.length; index += 25) {
    const chunk = uniqueUids.slice(index, index + 25);
    const snapshots = await Promise.all(
      chunk.map((uid) => getDoc(doc(db, "users", uid))),
    );
    snapshots.forEach((snapshot, snapshotIndex) => {
      if (snapshot.exists()) {
        profiles.set(chunk[snapshotIndex], snapshot.data());
      }
    });
  }
  return profiles;
};

const toStudentList = async (
  state: ArchiveEnrollmentState,
): Promise<Student[]> => {
  const activeEnrollments = state.enrollments.filter(
    (enrollment) => enrollment.enrollmentStatus === "ACTIVE",
  );
  const profileByUid = await loadScopedStudentProfiles(
    activeEnrollments.map((enrollment) => enrollment.studentUid),
  );
  const classById = new Map(
    state.classes.map((schoolClass) => [schoolClass.classId, schoolClass]),
  );

  return activeEnrollments.map((enrollment) => {
    const profile = profileByUid.get(enrollment.studentUid) || {};
    const semesterClass = enrollment.classId
      ? classById.get(enrollment.classId)
      : undefined;
    const email = String(profile.email || "").trim();
    const snapshot = enrollment.snapshot || {};
    return {
      id: enrollment.studentUid,
      userId: enrollment.studentUid,
      grade:
        parseGradeValue(profile) ||
        String(
          snapshot.grade || enrollment.grade || semesterClass?.grade || "",
        ),
      class:
        parseClassValue(profile) ||
        String(
          snapshot.classNumber ||
            enrollment.classNumber ||
            semesterClass?.classNumber ||
            "",
        ),
      number:
        parseNumberValue(profile) ||
        parseNumberValue({
          studentNumber:
            snapshot.studentNumber || enrollment.studentNumber || "",
        }),
      name: String(
        profile.studentName ||
          profile.name ||
          profile.displayName ||
          profile.nickname ||
          profile.customName ||
          snapshot.displayName ||
          enrollment.displayName ||
          "",
      ).trim(),
      email,
      isTeacherAccount:
        profile.role === "teacher" || email.toLowerCase() === ADMIN_EMAIL,
    };
  });
};

const scopedConfigFromSemesterId = (
  semesterId: string,
  fallback: Parameters<typeof deleteStudentData>[0],
) => {
  const match = semesterId.match(/^(\d{4})-([12])$/u);
  return match ? { year: match[1], semester: match[2] } : fallback;
};

const StudentList: React.FC = () => {
  const { userData, currentUser, config } = useAuth();
  const { confirm } = useAppDialog();
  const [students, setStudents] = useState<Student[]>([]);
  const [filteredStudents, setFilteredStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [promoting, setPromoting] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [deletingStudentIds, setDeletingStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [resettingCorePointStudentIds, setResettingCorePointStudentIds] =
    useState<Set<string>>(new Set());
  const [semesterId, setSemesterId] = useState("");
  const [scopeReadOnly, setScopeReadOnly] = useState(false);
  const [loadError, setLoadError] = useState("");
  const readOnly =
    scopeReadOnly || !canEditStudentList(userData, currentUser?.email || "");
  const canResetCorePoints =
    !readOnly && canManageW8Domains(userData, currentUser?.email || "");
  const mutationConfig = scopedConfigFromSemesterId(semesterId, config);

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
    setLoadError("");
    try {
      const state = await getArchiveEnrollmentState({
        source: "CURRENT",
        callSite: "StudentList.fetchStudents",
      });
      let list = await toStudentList(state);
      if (canEditStudentList(userData, currentUser?.email || "")) {
        const editStates = await loadStudentProfileEditStates(
          scopedConfigFromSemesterId(state.semesterId, config),
          list.map((student) => student.userId),
        );
        list = list.map((student) => {
          const editState = editStates.get(student.userId),
            profile = editState?.profile;
          return {
            ...student,
            ...(profile
              ? { ...profile, number: Number(profile.number) || 0 }
              : {}),
            editState,
          };
        });
      }
      setSemesterId(state.semesterId);
      const configuredSemesterId =
        config?.year && config?.semester
          ? `${config.year}-${config.semester}`
          : state.semesterId;
      setScopeReadOnly(
        state.readOnly || configuredSemesterId !== state.semesterId,
      );

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
      setStudents([]);
      setFilteredStudents([]);
      setScopeReadOnly(true);
      setLoadError(
        "현재 학기 학생 명단을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  const loadSchoolConfig = async () => {
    try {
      const data = await readSiteSettingDoc<{
        grades?: Array<{ value?: string; label?: string }>;
        classes?: Array<{ value?: string; label?: string }>;
      }>("school_config");
      if (!data) return;
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

  useEffect(() => {
    if (!currentUser?.uid) return;
    void fetchStudents();
  }, [currentUser?.uid, config?.year, config?.semester]);

  useEffect(() => {
    void loadSchoolConfig();
  }, []);

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
    const confirmed = await confirm({
      title: "학생 정보를 삭제하시겠습니까?",
      message: "삭제한 학생 정보는 복구할 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;
    const previousStudents = students;
    const previousFilteredStudents = filteredStudents;
    setDeletingStudentIds((current) => new Set(current).add(id));
    removeStudentsLocally(new Set([id]));
    try {
      const result = await deleteStudentData(mutationConfig, target.userId);
      if (result.authUserDeleteError) {
        console.warn("Student auth account cleanup failed", result);
      }
      void fetchStudents({ silent: true });
    } catch (error) {
      console.error("Delete failed", error);
      setStudents(previousStudents);
      setFilteredStudents(previousFilteredStudents);
      void fetchStudents({ silent: true });
      alert(getStudentDeleteErrorMessage(error));
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
    const confirmed = await confirm({
      title: `선택한 ${selectedIds.size}명을 삭제하시겠습니까?`,
      message: "삭제한 학생 정보는 복구할 수 없습니다.",
      confirmLabel: "모두 삭제",
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
        const result = await deleteStudentData(mutationConfig, target.userId);
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
      alert(getStudentDeleteErrorMessage(error));
    } finally {
      setDeletingStudentIds(new Set());
    }
  };

  const handleBulkPromote = async () => {
    if (readOnly || promoting) return;
    const confirmed = await confirm({
      title: `선택한 ${selectedIds.size}명을 진급 처리하시겠습니까?`,
      message: "선택한 학생의 학년을 1학년씩 올립니다.",
      confirmLabel: "진급",
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
    setPromoting(true);
    let completed = 0;
    try {
      for (const { student, nextGrade } of targets) {
        if (
          student.editState &&
          hasPendingStudentProfileUpdate(student.editState)
        )
          await retryStudentProfileUpdate(student.editState);
        else
          await updateStudentData(mutationConfig, {
            uid: student.userId,
            grade: nextGrade,
            class: student.class,
            number: student.number,
            name: student.name,
            email: student.email,
            editState: student.editState,
            operation: "PROMOTE_GRADE",
          });
        completed++;
        setSelectedIds((current) => {
          const next = new Set(current);
          next.delete(student.id);
          return next;
        });
      }
      void fetchStudents({ silent: true });
    } catch (error) {
      console.error("Bulk promote failed", error);
      void fetchStudents({ silent: true });
      alert(
        `${completed}명 처리 완료. ${studentProfileUpdateError(error)} 완료하지 못한 학생의 선택을 유지했습니다.`,
      );
    } finally {
      setPromoting(false);
    }
  };

  const handleResetCorePoints = async (student: Student) => {
    if (!canResetCorePoints || !isBangTestStudent(student)) return;
    const confirmed = await confirm({
      title: "핵심포인트 기록을 초기화하시겠습니까?",
      message: `${student.name || getStudentIdentityLabel(student)} 학생의 현재 학기 학습 진행 기록을 초기화합니다. 저장한 답안은 유지됩니다.`,
      confirmLabel: "초기화",
      tone: "warning",
    });
    if (!confirmed) return;

    setResettingCorePointStudentIds((current) =>
      new Set(current).add(student.id),
    );
    try {
      const state = await getW8DomainState({
        config: mutationConfig,
        domain: "LEARNING",
        audience: "teacher",
        studentUid: student.userId,
        source: "CURRENT",
      });
      if (state.readOnly || state.semesterId !== semesterId) {
        throw new W8DomainError(
          "CONFLICT",
          "현재 학기 범위가 바뀌었습니다. 명단을 새로고침해 주세요.",
        );
      }
      const progress = state.learningProgress.filter(
        (item) =>
          item.studentUid === student.userId && item.status !== "NOT_STARTED",
      );
      if (progress.length === 0) {
        alert("초기화할 현재 학기 학습 진행 기록이 없습니다.");
        return;
      }

      const progressByEnrollment = new Map<string, typeof progress>();
      progress.forEach((item) => {
        const entries = progressByEnrollment.get(item.enrollmentId) || [];
        entries.push(item);
        progressByEnrollment.set(item.enrollmentId, entries);
      });
      let resetCount = 0;
      for (const [enrollmentId, entries] of progressByEnrollment) {
        for (let index = 0; index < entries.length; index += 100) {
          const chunk = entries.slice(index, index + 100);
          const response = await resetLearningProgress({
            semesterId: state.semesterId,
            expectedSemesterRevision: state.manifestRevision,
            studentUid: student.userId,
            enrollmentId,
            entries: chunk.map((item) => ({
              contentId: item.contentId,
              expectedProgressRevision: item.revision,
            })),
            reason:
              "교사가 학생 명단에서 방테스트 계정 학습 진행 초기화를 확인함",
          });
          resetCount += Number(response.result.resetCount || chunk.length);
        }
      }
      alert(`현재 학기 학습 진행 기록 ${resetCount}건을 초기화했습니다.`);
    } catch (error) {
      console.error("Failed to reset learning progress:", error);
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
    setSearchQuery("");
    setCurrentPage(1);
    setSelectedIds(new Set());
    await fetchStudents();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <div className="mx-auto flex w-full max-w-6xl flex-1 animate-fadeIn flex-col px-3 py-6">
        <div className="flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-col items-start justify-between gap-3 border-b bg-gray-50 p-5 md:flex-row md:items-center">
            <h2 className="whitespace-nowrap text-lg font-bold text-gray-800">
              <i className="fas fa-users mr-2 text-blue-500"></i> 학생 명단
              <span className="ml-2 text-sm font-normal text-gray-500">
                ({filteredStudents.length}명)
              </span>
            </h2>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-b border-gray-100 p-5 md:flex-row">
            {readOnly && (
              <div className="w-full rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-700">
                읽기 전용 권한입니다. 학생 명단 조회만 가능합니다.
              </div>
            )}
            <div className="flex w-full items-center gap-2 overflow-x-auto md:w-auto">
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">전체 학년</option>
                {gradeOptions.map((grade) => (
                  <option key={grade.value} value={grade.value}>
                    {grade.label}
                  </option>
                ))}
              </select>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-bold text-gray-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="all">전체 반</option>
                {classOptions.map((cls) => (
                  <option key={cls.value} value={cls.value}>
                    {cls.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void handleRefreshList()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 transition hover:border-blue-500 hover:text-blue-600"
                title="명단 새로고침 및 필터 초기화"
              >
                <i
                  className={`fas fa-sync-alt ${loading ? "animate-spin" : ""}`}
                ></i>
              </button>
            </div>

            <div className="flex w-full gap-2 md:w-auto">
              <input
                type="text"
                placeholder="이름 또는 이메일 검색"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none md:w-64"
              />
              <button
                onClick={applyFilters}
                className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                <i className="fas fa-search mr-1"></i>검색
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm md:min-w-0">
              <thead className="bg-gray-100 text-xs font-bold uppercase text-gray-600">
                <tr>
                  <th className="w-10 p-4 text-center">
                    <input
                      type="checkbox"
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      checked={
                        pagedStudents.length > 0 &&
                        pagedStudents.every((student) =>
                          selectedIds.has(student.id),
                        )
                      }
                      className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                  <th className="w-16 p-4 text-center">학년</th>
                  <th className="w-16 p-4 text-center">반</th>
                  <th className="w-16 p-4 text-center">번호</th>
                  <th className="w-32 p-4">이름</th>
                  <th className="hidden w-64 p-4 lg:table-cell">이메일</th>
                  <th className="w-64 p-4 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-gray-400">
                      데이터를 불러오는 중...
                    </td>
                  </tr>
                ) : loadError ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-red-500">
                      {loadError}
                    </td>
                  </tr>
                ) : filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-10 text-center text-gray-400">
                      학생 데이터가 없습니다.
                    </td>
                  </tr>
                ) : (
                  pagedStudents.map((student) => (
                    <tr
                      key={student.id}
                      className="group transition hover:bg-blue-50"
                    >
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(student.id)}
                          onChange={() => handleSelect(student.id)}
                          className="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
                        />
                      </td>
                      <td className="p-4 text-center font-bold text-gray-700">
                        {getGradeLabel(student.grade)}
                      </td>
                      <td className="p-4 text-center font-bold text-gray-600">
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
                      <td className="hidden p-4 font-mono text-xs text-gray-500 lg:table-cell">
                        {student.email}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex flex-wrap justify-center gap-1">
                          {!readOnly && (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedStudent(student);
                                  setDetailInitialTab("profile");
                                  setDetailModalOpen(true);
                                }}
                                className="flex items-center gap-1 rounded bg-blue-50 px-2.5 py-1.5 text-xs font-bold text-blue-600 transition hover:bg-blue-100"
                                title="수정"
                              >
                                <i className="fas fa-edit"></i>
                                <span className="hidden lg:inline">수정</span>
                              </button>
                              <button
                                onClick={() => void handleDelete(student.id)}
                                disabled={deletingStudentIds.has(student.id)}
                                className="flex items-center gap-1 rounded bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title={
                                  student.isTeacherAccount
                                    ? "학생 정보만 삭제"
                                    : "삭제"
                                }
                              >
                                <i className="fas fa-trash"></i>
                                <span className="hidden lg:inline">삭제</span>
                              </button>
                              {canResetCorePoints &&
                                isBangTestStudent(student) && (
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
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && studentPageGroups.length > 1 && (
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-gray-100 bg-white px-5 py-3">
              {currentPageGroup && (
                <span className="mr-1 text-xs font-bold text-gray-500">
                  현재 {currentPageGroup.label}
                </span>
              )}
              <div className="flex flex-wrap justify-center gap-1.5">
                {studentPageGroups.map((group, index) => {
                  const page = index + 1;
                  return (
                    <button
                      key={group.key}
                      onClick={() => setCurrentPage(page)}
                      title={`${page}페이지: ${group.label}`}
                      aria-label={`${page}페이지, ${group.label}`}
                      className={`min-w-8 h-8 rounded-md px-2 text-xs font-bold transition ${currentPage === page ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600"}`}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {!readOnly && selectedIds.size > 0 && (
          <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-1rem)] max-w-[720px] -translate-x-1/2 animate-slideUp flex-wrap items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2.5 shadow-2xl md:bottom-8 md:w-auto md:flex-nowrap md:gap-4 md:rounded-full md:px-6 md:py-3">
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
                disabled={promoting}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-blue-600 transition hover:bg-gray-100"
              >
                <i className="fas fa-level-up-alt"></i>
                <span className="text-[11px] font-bold md:text-xs">
                  {promoting ? "처리 중..." : "진급"}
                </span>
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
                onClick={() => void handleBulkDelete()}
                disabled={deletingStudentIds.size > 0}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-red-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <i className="fas fa-trash"></i>
                <span className="text-[11px] font-bold md:text-xs">
                  {deletingStudentIds.size > 0 ? "삭제 중" : "삭제"}
                </span>
              </button>
            </div>
            <div className="hidden h-4 w-px bg-gray-300 md:block"></div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1 text-gray-400 transition hover:text-gray-600"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}

        {!readOnly && semesterId && (
          <StudentRegistrationApprovalPanel
            semesterId={semesterId}
            onApproved={() => {
              void fetchStudents({ silent: true });
            }}
          />
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
      </div>
    </div>
  );
};

export default StudentList;
