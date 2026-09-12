import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { PageDataLoading } from "../../../components/common/LoadingState";
import { useAuth } from "../../../contexts/AuthContext";
import { notifySystemConfigUpdated } from "../../../lib/appEvents";
import { executeWestoryCommand } from "../../../lib/commandGateway";
import { auth, db } from "../../../lib/firebase";
import { getDefaultSemesterDates } from "./semesterDates";
import {
  requestStepUpReauthentication,
  StepUpReauthError,
} from "../../../lib/stepUpReauth";
import { invalidateSiteSettingDocCache } from "../../../lib/siteSettings";
import {
  getServerSemesterCoreState,
  isReadinessCurrent,
  loadSemesterCoreSnapshot,
  resolveSemester,
  type SemesterCoreSnapshot,
  type SemesterReadinessReport,
} from "../../../lib/semesterCore";

type SettingsConfigState = {
  year: string;
  semester: string;
  showQuiz: boolean;
  showScore: boolean;
  showLesson: boolean;
};

type SemesterRegistryItem = {
  year: string;
  semester: string;
  label: string;
  shellReady?: boolean;
  createdBy?: string;
};

type SemesterSelectionState = Pick<SettingsConfigState, "year" | "semester">;
type SemesterReadinessStatus = "ready" | "partial" | "danger";
type ReadinessListItem = {
  key: string;
  label: string;
  ready: boolean;
};
type SemesterReadinessView = {
  status: SemesterReadinessStatus;
  requiredItems: ReadinessListItem[];
  advisoryItems: ReadinessListItem[];
};

const DEFAULT_YEAR = "2026";
const isReadinessReauthRequired = (error: unknown) =>
  (error as { details?: { reason?: string } })?.details?.reason ===
  "RECENT_AUTH_REQUIRED";
const DEFAULT_SEMESTER = "1";
const DEFAULT_CONFIG: SettingsConfigState = {
  year: DEFAULT_YEAR,
  semester: DEFAULT_SEMESTER,
  showQuiz: true,
  showScore: true,
  showLesson: true,
};
type SettingsReadinessDraft = {
  ownerUid: string;
  activeSemesterId: string;
  config: SettingsConfigState;
  newSemester: SemesterSelectionState;
  expiresAt: number;
  completed: Promise<void>;
};
// One in-memory recovery only: no browser persistence or cross-account draft.
const settingsReadinessRecovery: { draft: SettingsReadinessDraft | null } = {
  draft: null,
};
const getSettingsReadinessDraft = (ownerUid: string) => {
  const draft = settingsReadinessRecovery.draft;
  if (draft && (draft.ownerUid !== ownerUid || draft.expiresAt <= Date.now()))
    settingsReadinessRecovery.draft = null;
  return settingsReadinessRecovery.draft;
};

const normalizeYear = (value: unknown) => {
  const next = String(value || "").trim();
  return /^\d{4}$/.test(next) ? next : DEFAULT_YEAR;
};

const normalizeSemester = (value: unknown) =>
  String(value || "").trim() === "2" ? "2" : DEFAULT_SEMESTER;

const buildSemesterLabel = (year: string, semester: string) =>
  `${year}학년도 ${semester}학기`;

const isValidDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const sortSemesterRegistry = (items: SemesterRegistryItem[]) =>
  [...items].sort((a, b) => {
    const yearDiff = Number.parseInt(b.year, 10) - Number.parseInt(a.year, 10);
    if (yearDiff !== 0) return yearDiff;
    return Number.parseInt(a.semester, 10) - Number.parseInt(b.semester, 10);
  });

const buildSemesterRegistry = (
  rawItems: unknown,
  fallbackYear: string,
  fallbackSemester: string,
): SemesterRegistryItem[] => {
  const registry = new Map<string, SemesterRegistryItem>();

  if (Array.isArray(rawItems)) {
    rawItems.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const candidate = item as Partial<SemesterRegistryItem>;
      const year = normalizeYear(candidate.year);
      const semester = normalizeSemester(candidate.semester);
      const key = `${year}::${semester}`;
      registry.set(key, {
        year,
        semester,
        label: candidate.label?.trim() || buildSemesterLabel(year, semester),
        shellReady: candidate.shellReady !== false,
        createdBy: candidate.createdBy || "",
      });
    });
  }

  const fallbackKey = `${fallbackYear}::${fallbackSemester}`;
  if (!registry.has(fallbackKey)) {
    registry.set(fallbackKey, {
      year: fallbackYear,
      semester: fallbackSemester,
      label: buildSemesterLabel(fallbackYear, fallbackSemester),
      shellReady: true,
      createdBy: "",
    });
  }

  return sortSemesterRegistry(Array.from(registry.values()));
};

const STATUS_META: Record<
  SemesterReadinessStatus,
  { label: string; badgeClass: string; warningClass: string }
> = {
  ready: {
    label: "\uc900\ube44 \uc644\ub8cc",
    badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
    warningClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  partial: {
    label: "\uc77c\ubd80 \ube44\uc5b4 \uc788\uc74c",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-800",
    warningClass: "border-amber-200 bg-amber-50 text-amber-800",
  },
  danger: {
    label: "\uc804\ud658 \ube44\uad8c\uc7a5",
    badgeClass: "border-red-200 bg-red-50 text-red-700",
    warningClass: "border-red-200 bg-red-50 text-red-700",
  },
};

const READINESS_ITEM_META: Partial<
  Record<
    ReadinessListItem["key"],
    { readyHint: string; missingHint: string; actionHint: string }
  >
> = {
  curriculumTree: {
    readyHint:
      "단원·차시 기준이 있어 수업자료와 평가 연결을 시작할 수 있습니다.",
    missingHint:
      "교육과정 트리가 비어 있으면 수업자료와 문제은행 기준이 없어 실제 운영 준비가 끝난 상태가 아닙니다.",
    actionHint: "수업자료에서 교육과정 트리부터 채워 주세요.",
  },
  assessmentSettings: {
    readyHint: "평가 기본 설정을 확인할 수 있습니다.",
    missingHint:
      "평가 설정이 비어 있어 학기 운영 기준이 아직 고정되지 않았습니다.",
    actionHint: "평가 설정의 기본 항목을 먼저 확인해 주세요.",
  },
  finalExam: {
    readyHint: "시험 구성 초안 또는 기본 틀이 있습니다.",
    missingHint: "시험 구성이 비어 있어 평가 운영 준비가 아직 부족합니다.",
    actionHint: "시험 구성에서 객관식 또는 서술형 틀을 먼저 잡아 주세요.",
  },
  gradingPlans: {
    readyHint: "채점 계획 기준을 이어서 설정할 수 있습니다.",
    missingHint: "채점 계획이 없어 점수 운영 기준이 바로 보이지 않습니다.",
    actionHint: "채점 계획을 최소 1개 준비해 주세요.",
  },
  calendar: {
    readyHint: "학사 일정 기준을 이어서 채울 수 있습니다.",
    missingHint:
      "학사 일정이 비어 있으면 학기 운영 리듬을 공유하기 어렵습니다.",
    actionHint: "학사 일정을 먼저 채워 주세요.",
  },
  notices: {
    readyHint: "공지 기준 문서가 준비되어 있습니다.",
    missingHint: "공지 영역이 비어 있으면 첫 안내 전달 창구가 약합니다.",
    actionHint: "필수 공지를 한 건 이상 준비해 주세요.",
  },
  pointProducts: {
    readyHint: "위스 활용을 바로 이어갈 수 있습니다.",
    missingHint: "위스 상품이 없으면 위스를 지급해도 바로 쓰기 어렵습니다.",
    actionHint: "기본 위스 상품을 먼저 등록해 주세요.",
  },
  quizQuestions: {
    readyHint: "문제은행을 이어서 운영할 수 있습니다.",
    missingHint: "문제은행이 비어 있어 퀴즈 운영은 추가 준비가 필요합니다.",
    actionHint: "자주 쓰는 문항부터 채워 주세요.",
  },
  historyClassrooms: {
    readyHint: "히스토리 클래스룸 자료가 준비되어 있습니다.",
    missingHint:
      "히스토리 클래스룸 자료가 없어 해당 활동은 바로 운영하기 어렵습니다.",
    actionHint: "필요한 활동만 우선 등록해 주세요.",
  },
  mapResources: {
    readyHint: "지도 자료를 이어서 활용할 수 있습니다.",
    missingHint: "지도 자료가 비어 있으면 관련 수업 준비가 늦어질 수 있습니다.",
    actionHint: "필요한 지도 자료를 먼저 올려 주세요.",
  },
};

const CORE_READINESS_LABELS: Record<string, string> = {
  manifest_schema: "학기 기본 정보",
  identity_unique: "학년도·학기 중복 여부",
  semester_identity_unique: "학년도·학기 중복 여부",
  date_range: "학기 운영 기간",
  required_settings: "필수 학기 설정",
  status_transition: "학기 전환 가능 여부",
  schema_version: "학기 자료 형식",
  policy_version: "준비 기준",
  readiness_policy_version: "준비 기준",
  active_conflict: "현재 학기 중복 여부",
  active_semester_conflict: "현재 학기 중복 여부",
  revision_freshness: "최신 학기 정보",
  blocking_issues: "미해결 준비 항목",
  trusted_shell_complete: "학기 기본 자료",
  semester_duration: "학기 운영 기간",
  semester_duration_advisory: "학기 운영 기간",
  point_policy: "위스 운영 기준",
  assessment_settings: "평가 기본 설정",
  final_exam_config: "시험 구성",
  grading_plans_meta: "채점 계획",
  calendar_meta: "학사 일정",
  notices_meta: "공지 준비",
  archive_readiness: "이전 학기 보관 준비",
  class_readiness: "학급 편성 준비",
  enrollment_readiness: "학생 학적 준비",
  assessment_readiness: "평가 운영 준비",
  grade_evidence_readiness: "성적 근거 준비",
  wis_economy_readiness: "위스 운영 준비",
  learning_domain_readiness: "수업자료 운영 준비",
  schedule_domain_readiness: "일정 운영 준비",
  attendance_domain_readiness: "출결 운영 준비",
  communication_domain_readiness: "공지·알림 운영 준비",
  teacher_operations_readiness: "교사 작업 정리",
  semester_cutover_readiness: "학기 전환 준비",
};

const getReadinessItemMeta = (item: ReadinessListItem) =>
  READINESS_ITEM_META[item.key] || {
    readyHint: `${item.label} 항목을 확인했습니다.`,
    missingHint: `${item.label} 항목을 확인해 주세요.`,
    actionHint: `${item.label} 항목을 먼저 확인해 주세요.`,
  };

const buildReadinessView = (
  report: SemesterReadinessReport | null | undefined,
  canonicalCurrent: boolean,
): SemesterReadinessView | null => {
  if (!report) return null;
  const items = report.checks.map<ReadinessListItem>((check) => ({
    key: check.checkId,
    label:
      CORE_READINESS_LABELS[check.checkId] ||
      String(check.label || "학기 준비 항목")
        .replace(/Manifest/gi, "학기 정보")
        .replace(/schema/gi, "자료 형식")
        .replace(/revision/gi, "최신 정보")
        .replace(/policy/gi, "준비 기준"),
    ready: check.status === "PASS" || check.status === "NOT_APPLICABLE",
  }));
  const requiredItems = items.filter(
    (_, index) => report.checks[index]?.required !== false,
  );
  const advisoryItems = items.filter(
    (_, index) => report.checks[index]?.required === false,
  );
  const missingRequired = requiredItems.filter((item) => !item.ready).length;
  const missingAdvisory = advisoryItems.filter((item) => !item.ready).length;
  return {
    status:
      missingRequired > 0
        ? "danger"
        : !canonicalCurrent || missingAdvisory > 0
          ? "partial"
          : "ready",
    requiredItems,
    advisoryItems,
  };
};

const getSemesterCommandErrorMessage = (error: unknown) => {
  const reason = String(
    (error as { reason?: unknown })?.reason ||
      (error as { message?: unknown })?.message ||
      "",
  );
  if (/IDENTITY_CONFLICT/u.test(reason)) {
    return "같은 학년도와 학기가 이미 등록되어 있습니다. 등록된 학기를 선택해 주세요.";
  }
  if (/REVISION|CONFLICT/u.test(reason)) {
    return "다른 관리자가 학기 정보를 먼저 변경했습니다. 최신 상태를 다시 불러온 뒤 시도해 주세요.";
  }
  if (/READINESS|REQUIRED_CHECKS/u.test(reason)) {
    return "필수 준비 항목을 다시 확인한 뒤 시도해 주세요.";
  }
  if (/PERMISSION|ADMIN|AUTH|REAUTH/u.test(reason)) {
    return "이 작업을 진행할 권한 또는 최근 로그인 확인이 필요합니다.";
  }
  if (/TRANSITION|STATUS/u.test(reason)) {
    return "현재 학기 상태에서는 이 작업을 진행할 수 없습니다. 준비 현황을 다시 확인해 주세요.";
  }
  if (/[가-힣]/u.test(reason) && !/[A-Z]{3,}_[A-Z_]+/u.test(reason)) {
    return reason;
  }
  return "서버가 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
};

const SettingsGeneral: React.FC = () => {
  const { refreshConfig, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const [config, setConfig] = useState<SettingsConfigState>(DEFAULT_CONFIG);
  const [activeSemester, setActiveSemester] = useState<SemesterSelectionState>({
    year: DEFAULT_YEAR,
    semester: DEFAULT_SEMESTER,
  });
  const [availableSemesters, setAvailableSemesters] = useState<
    SemesterRegistryItem[]
  >([
    {
      year: DEFAULT_YEAR,
      semester: DEFAULT_SEMESTER,
      label: buildSemesterLabel(DEFAULT_YEAR, DEFAULT_SEMESTER),
      shellReady: true,
      createdBy: "",
    },
  ]);
  const [newSemester, setNewSemester] = useState({
    year: DEFAULT_YEAR,
    semester: DEFAULT_SEMESTER,
  });
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [semesterStateError, setSemesterStateError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [coreSnapshot, setCoreSnapshot] = useState<SemesterCoreSnapshot>({
    manifests: [],
    readinessReports: {},
    activePointer: null,
  });
  const [readiness, setReadiness] = useState<SemesterReadinessView | null>(
    null,
  );
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState("");
  const [readinessNeedsReauth, setReadinessNeedsReauth] = useState(false);
  const [readinessReauthBusy, setReadinessReauthBusy] = useState(false);
  const readinessContext = useRef({
    ownerUid: "",
    selection: "",
    mounted: true,
  });
  const readinessReauthFlight = useRef(false);
  const configLoadFlight = useRef(false);
  readinessContext.current.ownerUid = currentUser?.uid || "";
  readinessContext.current.selection = `${config.year}-${config.semester}`;
  useEffect(() => {
    readinessContext.current.mounted = true;
    return () => {
      readinessContext.current.mounted = false;
    };
  }, []);

  const handleReadinessReauthentication = async () => {
    if (readinessReauthFlight.current) return;
    const { ownerUid, selection } = readinessContext.current;
    if (!ownerUid || auth.currentUser?.uid !== ownerUid) return;
    const isCurrent = () =>
      readinessContext.current.mounted &&
      readinessContext.current.ownerUid === ownerUid &&
      auth.currentUser?.uid === ownerUid &&
      readinessContext.current.selection === selection;
    readinessReauthFlight.current = true;
    setReadinessReauthBusy(true);
    let completeRecovery = () => {};
    const retained: SettingsReadinessDraft = {
      ownerUid,
      activeSemesterId:
        coreSnapshot.activePointer?.semesterId ||
        `${activeSemester.year}-${activeSemester.semester}`,
      config: { ...config },
      newSemester: { ...newSemester },
      expiresAt: Date.now() + 10 * 60 * 1000,
      completed: new Promise<void>((resolve) => {
        completeRecovery = resolve;
      }),
    };
    settingsReadinessRecovery.draft = retained;
    try {
      await requestStepUpReauthentication("getSemesterCoreState", {
        force: true,
      });
      if (!isCurrent()) return;
      const snapshot = await loadSemesterCoreSnapshot();
      if (!isCurrent()) return;
      // Refresh server evidence without replacing the unsaved settings form.
      setCoreSnapshot(snapshot);
    } catch (error) {
      if (!isCurrent()) return;
      setReadinessNeedsReauth(true);
      setReadinessError(
        error instanceof StepUpReauthError
          ? `${error.message} 본인 확인을 마친 뒤 준비 현황을 다시 조회해 주세요.`
          : "본인 확인 후 준비 현황을 다시 불러오지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      completeRecovery();
      if (
        settingsReadinessRecovery.draft === retained &&
        (readinessContext.current.mounted || auth.currentUser?.uid !== ownerUid)
      )
        settingsReadinessRecovery.draft = null;
      readinessReauthFlight.current = false;
      if (readinessContext.current.mounted) setReadinessReauthBusy(false);
    }
  };

  const syncSemesterPresentation = (
    snapshot: SemesterCoreSnapshot,
    fallbackActive: SemesterSelectionState,
    preferredSelection?: SemesterSelectionState,
  ) => {
    const activeResult = resolveSemester(snapshot, { mode: "ACTIVE" });
    const nextActive = activeResult.ok
      ? {
          year: normalizeYear(activeResult.manifest.schoolYear),
          semester: normalizeSemester(activeResult.manifest.term),
        }
      : fallbackActive;
    const registry = buildSemesterRegistry(
      snapshot.manifests
        .filter(
          (manifest) =>
            !["CLOSED", "ARCHIVED", "QUARANTINED"].includes(manifest.status),
        )
        .map((manifest) => ({
          year: manifest.schoolYear,
          semester: manifest.term,
          label: manifest.displayName,
          shellReady: !["DRAFT", "FAILED"].includes(manifest.status),
          createdBy: manifest.createdBy || "",
        })),
      nextActive.year,
      nextActive.semester,
    );
    const preferred = preferredSelection || nextActive;
    const nextSelection = registry.some(
      (item) =>
        item.year === preferred.year && item.semester === preferred.semester,
    )
      ? preferred
      : nextActive;

    setCoreSnapshot(snapshot);
    setActiveSemester(nextActive);
    setAvailableSemesters(registry);
    setConfig((current) => ({
      ...current,
      year: nextSelection.year,
      semester: nextSelection.semester,
    }));
    setSemesterStateError(
      !activeResult.ok && activeResult.reason === "CONFLICTING_ACTIVE_SEMESTER"
        ? "현재 학기 상태가 서로 맞지 않습니다. 학기 전환 준비 화면에서 상태를 확인해 주세요."
        : "",
    );
  };

  const loadConfig = async () => {
    if (configLoadFlight.current) return;
    configLoadFlight.current = true;
    const ownerUid = auth.currentUser?.uid || "";
    const isCurrent = () =>
      readinessContext.current.mounted && auth.currentUser?.uid === ownerUid;
    setLoading(true);
    setLoadError("");
    try {
      const recovery = getSettingsReadinessDraft(ownerUid);
      if (recovery) await recovery.completed;
      if (!isCurrent()) return;
      const [docSnap, snapshot] = await Promise.all([
        getDoc(doc(db, "site_settings", "config")),
        loadSemesterCoreSnapshot(),
      ]);
      if (!isCurrent()) return;
      const data = docSnap.exists() ? docSnap.data() : {};
      const fallbackActive = {
        year: normalizeYear(data.year),
        semester: normalizeSemester(data.semester),
      };

      const serverConfig = {
        ...fallbackActive,
        showQuiz: data.showQuiz !== false,
        showScore: data.showScore !== false,
        showLesson: data.showLesson !== false,
      };
      const retained = getSettingsReadinessDraft(ownerUid);
      const restore =
        retained === recovery &&
        retained &&
        retained.activeSemesterId ===
          (snapshot.activePointer?.semesterId ||
            `${fallbackActive.year}-${fallbackActive.semester}`) &&
        snapshot.manifests.some(
          (manifest) =>
            manifest.schoolYear === retained.config.year &&
            manifest.term === retained.config.semester &&
            !["CLOSED", "ARCHIVED", "QUARANTINED"].includes(manifest.status),
        );
      const restoredConfig = restore ? retained.config : serverConfig;
      setConfig(restoredConfig);
      setNewSemester(restore ? retained.newSemester : fallbackActive);
      syncSemesterPresentation(snapshot, fallbackActive, restoredConfig);
      if (restore)
        setFeedback(
          "본인 확인 전 입력을 복원했습니다. 학기 준비 현황을 다시 확인합니다.",
        );
      else if (recovery)
        setFeedback(
          "학기 상태가 바뀌었거나 보관 시간이 지나 이전 입력을 자동 복원하지 않았습니다. 설정을 다시 확인해 주세요.",
        );
      if (settingsReadinessRecovery.draft === recovery)
        settingsReadinessRecovery.draft = null;
    } catch (error) {
      if (!isCurrent()) return;
      console.error("Failed to load config:", error);
      setLoadError(
        "기본 설정을 불러오지 못했습니다. 네트워크와 접근 권한을 확인한 뒤 다시 시도해 주세요.",
      );
      showToast({
        tone: "error",
        title: "설정을 불러오지 못했습니다.",
        message: "네트워크와 접근 권한을 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      configLoadFlight.current = false;
      if (isCurrent()) setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    if (loading) return;

    let isMounted = true;
    const year = normalizeYear(config.year);
    const semester = normalizeSemester(config.semester);

    setReadiness(null);
    setReadinessLoading(true);
    setReadinessError("");
    setReadinessNeedsReauth(false);
    const queryOwnerUid = currentUser?.uid || "";

    const manifest = coreSnapshot.manifests.find(
      (item) => item.schoolYear === year && item.term === semester,
    );
    if (!manifest) {
      setReadinessLoading(false);
      setReadinessError(
        "이 학기의 준비 정보를 아직 확인할 수 없습니다. 학기를 먼저 생성해 주세요.",
      );
      return;
    }
    const report = coreSnapshot.readinessReports[manifest.semesterId];

    void getServerSemesterCoreState(manifest.semesterId)
      .then((serverState) => {
        if (!isMounted || auth.currentUser?.uid !== queryOwnerUid) return;
        const canonicalCurrent =
          isReadinessCurrent(manifest, report) &&
          serverState.error === null &&
          serverState.requested?.semesterId === manifest.semesterId &&
          serverState.readiness?.current === true;
        setReadiness(buildReadinessView(report, canonicalCurrent));
        if (serverState.error) {
          setReadinessError(
            "서버의 최신 학기 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          );
        } else if (!report) {
          setReadinessError(
            "아직 준비 상태를 확인하지 않았습니다. 설정을 저장하기 전에 필수 항목을 확인해 주세요.",
          );
        }
      })
      .catch((error) => {
        console.error("Failed to load semester readiness:", error);
        if (!isMounted || auth.currentUser?.uid !== queryOwnerUid) return;
        setReadiness(buildReadinessView(report, false));
        const needsReauth = isReadinessReauthRequired(error);
        setReadinessNeedsReauth(needsReauth);
        setReadinessError(
          needsReauth
            ? "준비 현황을 확인하려면 본인 확인이 필요합니다. 다시 인증한 뒤 조회해 주세요."
            : "준비 현황을 불러오지 못했습니다. 네트워크와 접근 권한을 확인해 주세요.",
        );
      })
      .finally(() => {
        if (!isMounted) return;
        setReadinessLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [loading, config.year, config.semester, coreSnapshot, currentUser?.uid]);

  const yearOptions = useMemo(() => {
    const years = new Set(availableSemesters.map((item) => item.year));
    years.add(config.year);
    return Array.from(years).sort(
      (a, b) => Number.parseInt(b, 10) - Number.parseInt(a, 10),
    );
  }, [availableSemesters, config.year]);

  const semesterOptions = useMemo(() => {
    const filtered = availableSemesters.filter(
      (item) => item.year === config.year,
    );
    if (filtered.length > 0) return sortSemesterRegistry(filtered);
    return [
      {
        year: config.year,
        semester: config.semester,
        label: buildSemesterLabel(config.year, config.semester),
        shellReady: true,
        createdBy: "",
      },
    ];
  }, [availableSemesters, config.year, config.semester]);

  const activeSemesterLabel = buildSemesterLabel(
    activeSemester.year,
    activeSemester.semester,
  );
  const selectedSemesterLabel = buildSemesterLabel(
    config.year,
    config.semester,
  );
  const hasPendingSemesterSwitch =
    activeSemester.year !== config.year ||
    activeSemester.semester !== config.semester;
  const requiredReadyCount =
    readiness?.requiredItems.filter((item) => item.ready).length || 0;
  const advisoryReadyCount =
    readiness?.advisoryItems.filter((item) => item.ready).length || 0;
  const missingRequiredItems =
    readiness?.requiredItems.filter((item) => !item.ready) || [];
  const missingAdvisoryItems =
    readiness?.advisoryItems.filter((item) => !item.ready) || [];
  const curriculumTreeMissing = missingRequiredItems.some(
    (item) => item.key === "curriculumTree" || item.label.includes("교육과정"),
  );
  const readinessStatusMeta = readiness ? STATUS_META[readiness.status] : null;
  const readinessStatusClass =
    readinessStatusMeta?.badgeClass ||
    "border-gray-200 bg-gray-50 text-gray-700";
  const readinessWarningClass =
    readinessStatusMeta?.warningClass ||
    "border-amber-200 bg-amber-50 text-amber-800";
  const readinessSummaryTitle = readiness
    ? readiness.status === "ready"
      ? "전환 기준 충족"
      : readiness.status === "danger"
        ? "지금 전환하면 운영 공백 위험이 큽니다"
        : "기본 운영은 가능하지만 확인이 더 필요합니다"
    : "";
  const readinessSummaryDescription = readiness
    ? readiness.status === "ready"
      ? missingAdvisoryItems.length > 0
        ? "핵심 운영 항목은 준비되었습니다. 참고 항목은 필요에 따라 이어서 채우면 됩니다."
        : "핵심 운영 항목과 참고 항목이 모두 준비되어 있습니다."
      : readiness.status === "danger"
        ? "핵심 준비 항목이 비어 있어 현재 학기 전환은 비권장입니다."
        : missingRequiredItems.length > 0
          ? "필수 항목 일부가 비어 있어 저장은 가능하지만 전환 전 확인을 권장합니다."
          : "핵심 운영은 가능하지만 참고 항목이 일부 비어 있습니다."
    : "";
  const priorityActionItems = [
    ...missingRequiredItems,
    ...missingAdvisoryItems,
  ].slice(0, 3);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    if (type === "checkbox") {
      const key = name as keyof SettingsConfigState;
      setConfig(
        (prev) =>
          ({
            ...prev,
            [key]: checked,
          }) as SettingsConfigState,
      );
      return;
    }

    if (name === "year") {
      const nextYear = value;
      const nextSemesterOptions = availableSemesters.filter(
        (item) => item.year === nextYear,
      );
      setConfig((prev) => ({
        ...prev,
        year: nextYear,
        semester: nextSemesterOptions.some(
          (item) => item.semester === prev.semester,
        )
          ? prev.semester
          : nextSemesterOptions[0]?.semester || DEFAULT_SEMESTER,
      }));
      return;
    }

    const key = name as keyof SettingsConfigState;
    setConfig(
      (prev) =>
        ({
          ...prev,
          [key]: value,
        }) as SettingsConfigState,
    );
  };

  const handleNewSemesterChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setNewSemester((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const getFreshSemester = async (year: string, semester: string) => {
    const snapshot = await loadSemesterCoreSnapshot();
    const manifest = snapshot.manifests.find(
      (item) => item.schoolYear === year && item.term === semester,
    );
    if (!manifest) {
      throw new Error(
        "선택한 학기 정보를 찾지 못했습니다. 최신 상태를 다시 불러온 뒤 시도해 주세요.",
      );
    }
    return { snapshot, manifest };
  };

  const prepareSemesterForActivation = async (
    year: string,
    semester: string,
  ) => {
    let fresh = await getFreshSemester(year, semester);

    if (fresh.manifest.status === "ACTIVE") return fresh.snapshot;

    if (["DRAFT", "FAILED"].includes(fresh.manifest.status)) {
      await executeWestoryCommand("transitionSemesterStatus", {
        semesterId: fresh.manifest.semesterId,
        expectedRevision: fresh.manifest.revision,
        targetStatus: "PREPARING",
        reason: "관리자 기본 설정에서 학기 전환 준비 시작",
      });
      fresh = await getFreshSemester(year, semester);
    }

    if (["PREPARING", "VALIDATING"].includes(fresh.manifest.status)) {
      await executeWestoryCommand("validateSemesterReadiness", {
        semesterId: fresh.manifest.semesterId,
        expectedRevision: fresh.manifest.revision,
      });
      fresh = await getFreshSemester(year, semester);
    } else if (fresh.manifest.status === "READY") {
      const report = fresh.snapshot.readinessReports[fresh.manifest.semesterId];
      const serverState = await getServerSemesterCoreState(
        fresh.manifest.semesterId,
      );
      const readinessIsCurrent =
        isReadinessCurrent(fresh.manifest, report) &&
        serverState.error === null &&
        serverState.readiness?.current === true;
      if (!readinessIsCurrent) {
        await executeWestoryCommand("validateSemesterReadiness", {
          semesterId: fresh.manifest.semesterId,
          expectedRevision: fresh.manifest.revision,
        });
        fresh = await getFreshSemester(year, semester);
      }
    }

    if (fresh.manifest.status === "VALIDATING") {
      const report = fresh.snapshot.readinessReports[fresh.manifest.semesterId];
      const serverState = await getServerSemesterCoreState(
        fresh.manifest.semesterId,
      );
      const readinessIsCurrent =
        isReadinessCurrent(fresh.manifest, report) &&
        serverState.error === null &&
        serverState.requested?.semesterId === fresh.manifest.semesterId &&
        serverState.readiness?.current === true;
      if (!readinessIsCurrent) {
        throw new Error(
          "필수 준비 항목이 남아 있어 학기를 전환하지 않았습니다. 준비 현황을 확인해 주세요.",
        );
      }
      await executeWestoryCommand("transitionSemesterStatus", {
        semesterId: fresh.manifest.semesterId,
        expectedRevision: fresh.manifest.revision,
        targetStatus: "READY",
        reason: "관리자 기본 설정에서 필수 준비 항목 확인 완료",
      });
      fresh = await getFreshSemester(year, semester);
    }

    if (fresh.manifest.status !== "READY") {
      throw new Error(
        "현재 학기 상태에서는 전환할 수 없습니다. 학기 전환 준비 화면에서 상태를 확인해 주세요.",
      );
    }

    const report = fresh.snapshot.readinessReports[fresh.manifest.semesterId];
    const serverState = await getServerSemesterCoreState(
      fresh.manifest.semesterId,
    );
    if (
      !isReadinessCurrent(fresh.manifest, report) ||
      serverState.error !== null ||
      serverState.requested?.semesterId !== fresh.manifest.semesterId ||
      serverState.readiness?.current !== true
    ) {
      throw new Error(
        "최신 준비 상태를 확인할 수 없어 학기를 전환하지 않았습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    await executeWestoryCommand("activateSemester", {
      semesterId: fresh.manifest.semesterId,
      expectedRevision: fresh.manifest.revision,
      readinessPolicyVersion: fresh.manifest.readinessPolicyVersion,
      expectedActiveSemesterId:
        fresh.snapshot.activePointer?.semesterId || null,
    });

    const activatedSnapshot = await loadSemesterCoreSnapshot();
    const activeResult = resolveSemester(activatedSnapshot, { mode: "ACTIVE" });
    if (
      !activeResult.ok ||
      activeResult.manifest.semesterId !== fresh.manifest.semesterId
    ) {
      throw new Error(
        "학기 전환 결과를 확인하지 못했습니다. 최신 상태를 다시 불러와 주세요.",
      );
    }
    return activatedSnapshot;
  };

  const handleCreateSemester = async () => {
    const year = String(newSemester.year || "").trim();
    const semester = normalizeSemester(newSemester.semester);

    if (!/^\d{4}$/.test(year)) {
      showToast({
        tone: "warning",
        title: "학년도 입력 형식을 확인해 주세요.",
        message: "학년도는 4자리 숫자로 입력해야 합니다.",
      });
      return;
    }

    if (
      availableSemesters.some(
        (item) => item.year === year && item.semester === semester,
      )
    ) {
      setConfig((prev) => ({ ...prev, year, semester }));
      setFeedback(
        `${buildSemesterLabel(year, semester)}는 이미 등록되어 있습니다. 위 설정 저장을 누르면 준비 상태를 확인합니다.`,
      );
      return;
    }

    const defaultDates = getDefaultSemesterDates(year, semester);
    const startInput = window.prompt(
      `${buildSemesterLabel(year, semester)} 시작일을 YYYY-MM-DD 형식으로 입력해 주세요.`,
      defaultDates.startAt,
    );
    if (startInput === null) return;
    const endInput = window.prompt(
      `${buildSemesterLabel(year, semester)} 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.`,
      defaultDates.endAt,
    );
    if (endInput === null) return;
    const startDate = startInput.trim();
    const endDate = endInput.trim();
    if (
      !isValidDateInput(startDate) ||
      !isValidDateInput(endDate) ||
      Date.parse(startDate) >= Date.parse(endDate)
    ) {
      showToast({
        tone: "warning",
        title: "학기 운영 기간을 확인해 주세요.",
        message:
          "시작일과 종료일을 YYYY-MM-DD 형식으로 입력하고 종료일을 시작일보다 뒤로 지정해 주세요.",
      });
      return;
    }

    setCreating(true);
    setFeedback("");
    let semesterCreated = false;
    try {
      await executeWestoryCommand("createSemesterManifest", {
        schoolYear: year,
        term: semester,
        displayName: buildSemesterLabel(year, semester),
        startDate,
        endDate,
      });
      semesterCreated = true;
      let fresh = await getFreshSemester(year, semester);
      if (fresh.manifest.status === "DRAFT") {
        await executeWestoryCommand("transitionSemesterStatus", {
          semesterId: fresh.manifest.semesterId,
          expectedRevision: fresh.manifest.revision,
          targetStatus: "PREPARING",
          reason: "관리자 기본 설정에서 새 학기 준비 시작",
        });
        fresh = await getFreshSemester(year, semester);
      }
      if (fresh.manifest.status === "PREPARING") {
        await executeWestoryCommand("validateSemesterReadiness", {
          semesterId: fresh.manifest.semesterId,
          expectedRevision: fresh.manifest.revision,
        });
        fresh = await getFreshSemester(year, semester);
      }
      syncSemesterPresentation(fresh.snapshot, activeSemester, {
        year,
        semester,
      });
      setFeedback(
        `${buildSemesterLabel(year, semester)}를 만들었습니다. 준비 현황을 확인한 뒤 설정을 저장해 주세요.`,
      );
    } catch (error) {
      console.error("Failed to create semester:", error);
      if (semesterCreated) {
        try {
          const fresh = await getFreshSemester(year, semester);
          syncSemesterPresentation(fresh.snapshot, activeSemester, {
            year,
            semester,
          });
          setFeedback(
            `${buildSemesterLabel(year, semester)}는 등록되었습니다. 준비 상태를 다시 확인해 주세요.`,
          );
        } catch (refreshError) {
          console.error(
            "Failed to refresh semester after partial creation:",
            refreshError,
          );
        }
      }
      showToast({
        tone: "error",
        title: semesterCreated
          ? "학기는 생성했지만 준비 상태를 확인하지 못했습니다."
          : "새 학기 생성에 실패했습니다.",
        message: getSemesterCommandErrorMessage(error),
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    let operationalSettingsSaved = false;
    let semesterSwitchConfirmed = !hasPendingSemesterSwitch;
    try {
      const year = normalizeYear(config.year);
      const semester = normalizeSemester(config.semester);
      await executeWestoryCommand("updateOperationalSettings", {
        showQuiz: config.showQuiz,
        showScore: config.showScore,
        showLesson: config.showLesson,
      });
      operationalSettingsSaved = true;

      let latestSnapshot = coreSnapshot;
      if (hasPendingSemesterSwitch) {
        if (semesterStateError) {
          throw new Error(semesterStateError);
        }
        latestSnapshot = await prepareSemesterForActivation(year, semester);
        semesterSwitchConfirmed = true;
      } else {
        latestSnapshot = await loadSemesterCoreSnapshot();
      }

      invalidateSiteSettingDocCache("config");
      await refreshConfig();
      notifySystemConfigUpdated();
      syncSemesterPresentation(
        latestSnapshot,
        { year, semester },
        {
          year,
          semester,
        },
      );
      showToast({
        tone: "success",
        title: "기본 설정이 저장되었습니다.",
        message: hasPendingSemesterSwitch
          ? `${buildSemesterLabel(year, semester)} 기준으로 최신 설정을 반영했습니다.`
          : "학생 메뉴 표시 기준에 최신 설정을 반영했습니다.",
      });
    } catch (error) {
      console.error("Failed to save config:", error);
      if (operationalSettingsSaved) {
        invalidateSiteSettingDocCache("config");
        try {
          await refreshConfig();
          notifySystemConfigUpdated();
          const latestSnapshot = await loadSemesterCoreSnapshot();
          syncSemesterPresentation(latestSnapshot, activeSemester, {
            year: normalizeYear(config.year),
            semester: normalizeSemester(config.semester),
          });
        } catch (refreshError) {
          console.error(
            "Failed to refresh settings after partial save:",
            refreshError,
          );
        }
      }
      showToast({
        tone: "error",
        title:
          operationalSettingsSaved && !semesterSwitchConfirmed
            ? "메뉴 설정은 저장했지만 학기 전환 결과를 확인하지 못했습니다."
            : operationalSettingsSaved
              ? "설정은 반영했지만 화면을 새로고침하지 못했습니다."
              : "기본 설정 저장에 실패했습니다.",
        message:
          operationalSettingsSaved && semesterSwitchConfirmed
            ? "서버에는 반영되었습니다. 잠시 후 화면을 새로고침해 주세요."
            : getSemesterCommandErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageDataLoading />;

  if (loadError) {
    return (
      <div className="max-w-3xl rounded-xl border border-red-200 bg-white p-6 shadow-sm lg:p-8">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"
        >
          {loadError}
          <button
            type="button"
            onClick={() => void loadConfig()}
            className="ml-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-bold"
          >
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 lg:p-8 shadow-sm max-w-3xl">
      <div className="border-b border-gray-100 pb-4 mb-6">
        <h3 className="text-lg font-bold text-gray-900">시스템 기본 설정</h3>
        <p className="text-sm text-gray-500 mt-1">
          학년도와 학기, 메뉴 표시 여부를 제어합니다.
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-blue-200 bg-white/80 p-4">
              <div className="text-xs font-bold text-blue-700">
                현재 활성 학기
              </div>
              <div className="mt-1 text-lg font-extrabold text-blue-900">
                {activeSemesterLabel}
              </div>
              <p className="mt-2 text-xs font-semibold text-blue-700">
                학생과 교사 화면에 실제 적용 중인 기준입니다.
              </p>
            </div>
            <div
              className={`rounded-xl border p-4 ${hasPendingSemesterSwitch ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={`text-xs font-bold ${hasPendingSemesterSwitch ? "text-amber-800" : "text-emerald-700"}`}
                >
                  {hasPendingSemesterSwitch
                    ? "저장 시 전환 대상"
                    : "현재 선택된 학기"}
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${hasPendingSemesterSwitch ? "border-amber-300 bg-white text-amber-800" : "border-emerald-300 bg-white text-emerald-700"}`}
                >
                  {hasPendingSemesterSwitch ? "변경 예정" : "현재와 동일"}
                </span>
              </div>
              <div
                className={`mt-1 text-lg font-extrabold ${hasPendingSemesterSwitch ? "text-amber-900" : "text-emerald-900"}`}
              >
                {selectedSemesterLabel}
              </div>
              <p
                className={`mt-2 text-xs font-semibold ${hasPendingSemesterSwitch ? "text-amber-800" : "text-emerald-700"}`}
              >
                {hasPendingSemesterSwitch
                  ? `${activeSemesterLabel}는 저장 전까지 그대로 유지됩니다.`
                  : "저장해도 현재 운영 학기와 같은 값이 유지됩니다."}
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-blue-100 bg-white/70 p-3">
            <div className="text-xs font-bold text-blue-700">
              준비된 학기 목록
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableSemesters.map((item) =>
                (() => {
                  const isActive =
                    item.year === activeSemester.year &&
                    item.semester === activeSemester.semester;
                  const isSelected =
                    item.year === config.year &&
                    item.semester === config.semester;

                  return (
                    <span
                      key={`${item.year}-${item.semester}`}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${
                        isActive
                          ? "border-blue-600 bg-blue-600 text-white"
                          : isSelected
                            ? "border-amber-300 bg-amber-50 text-amber-900"
                            : "border-blue-200 bg-white text-blue-700"
                      }`}
                    >
                      <span>{item.label}</span>
                      {isActive && (
                        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-extrabold text-white">
                          현재
                        </span>
                      )}
                      {isSelected && !isActive && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">
                          전환 대상
                        </span>
                      )}
                    </span>
                  );
                })(),
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              학년도
            </label>
            <select
              name="year"
              aria-label="학년도"
              value={config.year}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
            >
              {yearOptions.map((year) => (
                <option key={year} value={year}>
                  {year}학년도
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2">
              학기
            </label>
            <select
              name="semester"
              aria-label="학기"
              value={config.semester}
              onChange={handleChange}
              className="w-full border border-gray-300 rounded-lg p-3 bg-gray-50 focus:ring-2 focus:ring-blue-500 font-bold text-gray-800 outline-none"
            >
              {semesterOptions.map((item) => (
                <option
                  key={`${item.year}-${item.semester}`}
                  value={item.semester}
                >
                  {item.semester}학기
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="bg-amber-50 text-amber-800 text-xs p-3 rounded-lg border border-amber-200 font-bold flex items-start gap-2">
          <i className="fas fa-exclamation-triangle mt-0.5"></i>
          <span>
            학년도와 학기를 고르면 전환 대상만 먼저 바뀝니다. 실제 운영 학기는
            저장 전까지 유지되며, 저장 후 해당 기간 데이터 기준으로 전환됩니다.
          </span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="text-xs font-bold text-gray-500">
                {hasPendingSemesterSwitch
                  ? "저장 시 전환 대상 준비 현황"
                  : "현재 활성 학기 준비 현황"}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${readinessStatusClass}`}
                >
                  {readinessLoading
                    ? "\ud655\uc778 \uc911..."
                    : readinessStatusMeta?.label || "\ud655\uc778 \ud544\uc694"}
                </span>
                <span className="text-xs font-bold text-gray-500">
                  {selectedSemesterLabel}
                </span>
              </div>
              {!readinessLoading && readiness && (
                <>
                  <div className="mt-3 text-sm font-bold text-gray-900">
                    {readinessSummaryTitle}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-600">
                    {readinessSummaryDescription}
                  </p>
                </>
              )}
            </div>
            {!readinessLoading && readiness && (
              <div className="grid grid-cols-2 gap-2 text-xs font-bold text-gray-600 md:text-right">
                <span>
                  필수 {requiredReadyCount}/{readiness.requiredItems.length}
                </span>
                <span>
                  참고 {advisoryReadyCount}/{readiness.advisoryItems.length}
                </span>
              </div>
            )}
          </div>

          {(semesterStateError || readinessError) && (
            <div
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
            >
              {semesterStateError || readinessError}
            </div>
          )}
          {readinessNeedsReauth && (
            <button
              type="button"
              onClick={() => void handleReadinessReauthentication()}
              disabled={readinessReauthBusy || readinessLoading}
              className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {readinessReauthBusy ? "본인 확인 중..." : "다시 인증 후 조회"}
            </button>
          )}

          {!readinessLoading && readiness && (
            <>
              <div
                className={`mt-4 rounded-xl border p-3 text-xs ${curriculumTreeMissing ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}
              >
                <div className="font-bold">
                  {curriculumTreeMissing
                    ? "교육과정 트리 확인 필요"
                    : "기본 자료와 실제 운영 준비는 다릅니다"}
                </div>
                <div className="mt-1 leading-5">
                  기본 자료가 있어도 교육과정의 단원·차시가 비어 있으면 실제
                  운영 준비는 완료되지 않습니다. 수업자료와 문제은행을
                  연결하려면 교육과정 구성을 먼저 채워 주세요.
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-gray-700">
                      필수 운영 항목
                    </div>
                    <span className="text-xs font-bold text-gray-500">
                      {requiredReadyCount}/{readiness.requiredItems.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {readiness.requiredItems.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-lg border px-3 py-2 ${
                          item.ready
                            ? "border-emerald-200 bg-white"
                            : "border-amber-200 bg-amber-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-gray-800">
                              {item.label}
                            </div>
                            <div
                              className={`mt-1 text-xs leading-5 ${item.ready ? "text-gray-500" : "text-amber-900"}`}
                            >
                              {item.ready
                                ? getReadinessItemMeta(item).readyHint
                                : getReadinessItemMeta(item).missingHint}
                            </div>
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-bold ${
                              item.ready
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-amber-200 bg-white text-amber-800"
                            }`}
                          >
                            {item.ready ? "준비됨" : "확인 필요"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold text-gray-700">
                      운영 참고 항목
                    </div>
                    <span className="text-xs font-bold text-gray-500">
                      {advisoryReadyCount}/{readiness.advisoryItems.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {readiness.advisoryItems.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-lg border px-3 py-2 ${
                          item.ready
                            ? "border-emerald-200 bg-white"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-gray-800">
                              {item.label}
                            </div>
                            <div
                              className={`mt-1 text-xs leading-5 ${item.ready ? "text-gray-500" : "text-slate-600"}`}
                            >
                              {item.ready
                                ? getReadinessItemMeta(item).readyHint
                                : getReadinessItemMeta(item).missingHint}
                            </div>
                          </div>
                          <span
                            className={`inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-bold ${
                              item.ready
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {item.ready ? "준비됨" : "추가 준비"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h4 className="text-sm font-bold text-gray-900">
                새로운 학기 준비
              </h4>
              <p className="text-xs text-gray-500 mt-1">
                새로운 학년/학기를 만들고 기본 자료만 준비합니다. 콘텐츠 복제나
                데이터 이월은 하지 않으며, 교육과정 구성이 비어 있으면 실제 운영
                준비는 아직 끝난 상태가 아닙니다.
              </p>
            </div>
            {feedback && (
              <div
                role="status"
                aria-live="polite"
                className="text-xs font-bold text-blue-700"
              >
                {feedback}
              </div>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,160px)_auto] gap-3">
            <input
              type="text"
              name="year"
              aria-label="새 학기 학년도"
              value={newSemester.year}
              onChange={handleNewSemesterChange}
              inputMode="numeric"
              placeholder="2027"
              className="w-full border border-gray-300 rounded-lg p-3 bg-white font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              name="semester"
              aria-label="새 학기"
              value={newSemester.semester}
              onChange={handleNewSemesterChange}
              className="w-full border border-gray-300 rounded-lg p-3 bg-white font-bold text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1">1학기</option>
              <option value="2">2학기</option>
            </select>
            <button
              type="button"
              onClick={handleCreateSemester}
              disabled={creating}
              className="bg-white hover:bg-gray-100 disabled:opacity-60 text-gray-800 font-bold py-3 px-5 rounded-xl border border-gray-300 shadow-sm transition"
            >
              {creating ? "생성 중..." : "학기 생성"}
            </button>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-6">
          <label className="block text-sm font-bold text-gray-700 mb-4">
            학생 메뉴 표시 제어
          </label>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                  <i className="fas fa-gamepad"></i>
                </div>
                <span className="font-bold text-gray-700">평가(Quiz)</span>
              </div>
              <input
                type="checkbox"
                name="showQuiz"
                checked={config.showQuiz}
                onChange={handleChange}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center">
                  <i className="fas fa-chart-bar"></i>
                </div>
                <span className="font-bold text-gray-700">점수(Score)</span>
              </div>
              <input
                type="checkbox"
                name="showScore"
                checked={config.showScore}
                onChange={handleChange}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
            <label className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center">
                  <i className="fas fa-book-reader"></i>
                </div>
                <span className="font-bold text-gray-700">
                  수업자료(Lesson)
                </span>
              </div>
              <input
                type="checkbox"
                name="showLesson"
                checked={config.showLesson}
                onChange={handleChange}
                className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
              />
            </label>
          </div>
        </div>

        <div className="pt-4 text-right">
          {!readinessLoading && readiness && readiness.status !== "ready" && (
            <div
              className={`mb-4 rounded-xl border p-4 text-left text-sm font-bold flex items-start gap-3 ${readinessWarningClass}`}
            >
              <i className="fas fa-exclamation-triangle mt-0.5"></i>
              <div className="flex-1">
                <div>
                  {readiness.status === "danger"
                    ? "왜 전환 비권장인지 먼저 확인해 주세요."
                    : "전환 전 먼저 채우면 좋은 항목입니다."}
                </div>
                <div className="mt-1 text-xs font-semibold leading-5">
                  {missingRequiredItems.length > 0
                    ? `우선 ${missingRequiredItems.map((item) => item.label).join(", ")}부터 확인해 주세요.`
                    : "핵심 운영 항목은 준비되었고, 아래 참고 항목을 채우면 운영 여유가 더 생깁니다."}
                </div>
                {priorityActionItems.length > 0 && (
                  <div className="mt-3 space-y-1.5 text-xs font-semibold">
                    {priorityActionItems.map((item, index) => (
                      <div
                        key={item.key}
                      >{`${index + 1}. ${getReadinessItemMeta(item).actionHint}`}</div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition transform active:scale-95"
          >
            {saving ? "저장 중..." : "설정 저장"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsGeneral;
