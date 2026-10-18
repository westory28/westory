import { useAppToast } from "../../../components/common/AppToastProvider";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import NumericInput from "../../../components/common/NumericInput";
import InfoHelp from "../../../components/common/InfoHelp";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import {
  type AssessmentQuestionOrder,
  type AssessmentVisibilityGroup,
  type AssessmentVisibilityTarget,
  getAssessmentConfigKey,
  getAssessmentVisibilityOptionsFromSchoolConfig,
  normalizeAssessmentClassId,
  normalizeAssessmentConfigEntry,
} from "../../../lib/assessmentConfig";
import {
  DEFAULT_MOCK_EXAM_ROUND,
  MOCK_EXAM_ROUNDS,
  formatMockExamRoundLabel,
  getMockExamRoundsFromAssessmentConfig,
  getNextMockExamRound,
  isAdditionalMockExamRound,
  isMockExamCategory,
  sortMockExamRounds,
  type MockExamRound,
} from "../../../lib/mockExamRounds";
import {
  getSemesterDocPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  getAssessmentSemesterId,
  saveQuizAssessmentSettings,
} from "../../../lib/assessmentRelease";
import {
  buildAssessmentDefinitionId,
  executeAssessmentManagementCommand,
} from "../../../lib/assessmentLifecycle";
import { useQuizDialog } from "./useQuizDialog";
import "./QuizWorkspace.css";

interface QuizSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  nodeId: string;
  nodeTitle?: string;
  category: string;
  canEdit: boolean;
}
interface QuizSettingsFormState {
  active: boolean;
  questionCount: number | "";
  questionOrder: AssessmentQuestionOrder;
  timeLimitMinutes: number | "";
  allowRetake: boolean;
  cooldown: number | "";
  hintLimit: number | "";
  visibleClassIds: string[];
}
const CATEGORY_LABELS: Record<string, string> = {
  diagnostic: "진단평가",
  formative: "형성평가",
  exam_prep: "모의고사",
};
const QUESTION_ORDER_OPTIONS: Array<{
  value: AssessmentQuestionOrder;
  label: string;
}> = [
  { value: "random", label: "랜덤 순서" },
  { value: "created", label: "등록 순서" },
  { value: "unit", label: "단원 순서" },
];
const createDefaultFormState = (): QuizSettingsFormState => ({
  active: false,
  questionCount: 20,
  questionOrder: "unit",
  timeLimitMinutes: 15,
  allowRetake: true,
  cooldown: 5,
  hintLimit: 3,
  visibleClassIds: [],
});
const createEmptyVisibilityGroup = (): AssessmentVisibilityGroup => ({
  gradeValue: "3",
  gradeLabel: "3학년",
  isDefaultGrade: true,
  isTestGrade: false,
  targets: [],
});
const formFingerprint = (state: QuizSettingsFormState) =>
  JSON.stringify({
    ...state,
    visibleClassIds: [...state.visibleClassIds].sort(),
  });
const validInteger = (value: number | "", min: number, max: number) =>
  value !== "" && Number.isInteger(value) && value >= min && value <= max;

const QuizSettingsModal: React.FC<QuizSettingsModalProps> = ({
  isOpen,
  onClose,
  nodeId,
  nodeTitle,
  category,
  canEdit,
}) => {
  const { config } = useAuth();
  const { showToast } = useAppToast();
  const { year, semester } = getYearSemester(config);
  const scope = useMemo(() => ({ year, semester }), [year, semester]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const saveLock = useRef(false);
  const [settings, setSettings] = useState<QuizSettingsFormState>(
    createDefaultFormState,
  );
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const [defaultVisibilityGroup, setDefaultVisibilityGroup] = useState(
    createEmptyVisibilityGroup,
  );
  const [extraVisibilityGroups, setExtraVisibilityGroups] = useState<
    AssessmentVisibilityGroup[]
  >([]);
  const [expandedExtraGrades, setExpandedExtraGrades] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [resettingClassId, setResettingClassId] = useState("");
  const [confirmResetClassId, setConfirmResetClassId] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<
    "close" | MockExamRound | null
  >(null);
  const [selectedExamRound, setSelectedExamRound] = useState<MockExamRound>(
    DEFAULT_MOCK_EXAM_ROUND,
  );
  const [mockExamRounds, setMockExamRounds] =
    useState<MockExamRound[]>(MOCK_EXAM_ROUNDS);
  const [assessmentSettingsMap, setAssessmentSettingsMap] = useState<
    Record<string, unknown>
  >({});
  const [legacyStatusMap, setLegacyStatusMap] = useState<
    Record<string, unknown>
  >({});
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [hasStoredSettings, setHasStoredSettings] = useState(false);
  const [definitionState, setDefinitionState] = useState<{
    id: string;
    revision: number;
    settings?: Record<string, unknown>;
  } | null>(null);
  const [definitionLoading, setDefinitionLoading] = useState(true);
  const isMockExam = isMockExamCategory(category);
  const isRetakableMockExam =
    isMockExam && isAdditionalMockExamRound(selectedExamRound);
  const categoryLabel = CATEGORY_LABELS[category] || "평가";
  const definitionId = buildAssessmentDefinitionId(
    getAssessmentSemesterId(scope),
    "QUIZ",
    nodeId,
    category,
    isMockExam ? selectedExamRound : "",
  );
  const ready =
    settingsLoaded &&
    !loading &&
    !definitionLoading &&
    definitionState?.id === definitionId &&
    !loadError;
  const settingsTitle = isMockExam
    ? formatMockExamRoundLabel(selectedExamRound)
    : `${nodeTitle || "선택한 단원"} · ${categoryLabel}`;
  const busy = saving || Boolean(resettingClassId);
  const dirty = ready && savedFingerprint !== formFingerprint(settings);
  const requestNavigation = (target: "close" | MockExamRound) => {
    if (busy) return;
    if (dirty) {
      setPendingNavigation(target);
      return;
    }
    if (target === "close") onClose();
    else setSelectedExamRound(target);
  };
  useQuizDialog(isOpen, dialogRef, () => requestNavigation("close"));
  useEffect(() => {
    if (pendingNavigation) resultRef.current?.focus();
  }, [pendingNavigation]);
  const allVisibilityTargets = useMemo(
    () => [
      ...defaultVisibilityGroup.targets,
      ...extraVisibilityGroups.flatMap((group) => group.targets),
    ],
    [defaultVisibilityGroup.targets, extraVisibilityGroups],
  );
  const availableTargetIds = useMemo(
    () => allVisibilityTargets.map((target) => target.id),
    [allVisibilityTargets],
  );
  const availableTargetIdSet = useMemo(
    () => new Set(availableTargetIds),
    [availableTargetIds],
  );
  const normalizedSelectedClassIds = useMemo(
    () =>
      Array.from(
        new Set(
          settings.visibleClassIds
            .map((id) => normalizeAssessmentClassId(id, "3"))
            .filter(Boolean),
        ),
      ),
    [settings.visibleClassIds],
  );
  const selectedClassIdSet = useMemo(
    () => new Set(normalizedSelectedClassIds),
    [normalizedSelectedClassIds],
  );
  const unknownSelectedClassIds = normalizedSelectedClassIds.filter(
    (id) => !availableTargetIdSet.has(id),
  );
  const defaultClassIds = useMemo(
    () => defaultVisibilityGroup.targets.map((target) => target.id),
    [defaultVisibilityGroup.targets],
  );
  const hintsEnabled = !isMockExam && settings.hintLimit !== 0;
  const fieldErrors = {
    questionCount: validInteger(settings.questionCount, 1, 200)
      ? ""
      : "문항 수는 1~200 사이의 정수로 입력해 주세요.",
    timeLimitMinutes:
      settings.timeLimitMinutes !== "" &&
      Number.isFinite(settings.timeLimitMinutes) &&
      settings.timeLimitMinutes >= 1 &&
      settings.timeLimitMinutes <= 360 &&
      Number.isInteger(settings.timeLimitMinutes * 60)
        ? ""
        : "제한 시간은 1~360분으로 입력해 주세요. 초 단위까지 설정할 수 있습니다.",
    cooldown:
      (!settings.allowRetake && !isRetakableMockExam) ||
      validInteger(settings.cooldown, 0, 43200)
        ? ""
        : "대기 시간은 0~43200 사이의 정수로 입력해 주세요.",
    hintLimit:
      isMockExam || validInteger(settings.hintLimit, 0, 200)
        ? ""
        : "힌트 횟수는 0~200 사이의 정수로 입력해 주세요.",
    visibility:
      settings.active && !normalizedSelectedClassIds.length
        ? "공개할 학급을 한 곳 이상 선택해 주세요."
        : "",
  };
  const hasValidationError = Object.values(fieldErrors).some(Boolean);

  useEffect(() => {
    if (!isOpen || !nodeId) return;
    let cancelled = false;
    setLoading(true);
    setSettingsLoaded(false);
    setLoadError("");
    setPendingNavigation(null);
    setSelectedExamRound(DEFAULT_MOCK_EXAM_ROUND);
    setMockExamRounds(MOCK_EXAM_ROUNDS);
    const loadSettings = async () => {
      try {
        const [visibilityOptions, settingsSnap, legacyStatusSnap] =
          await Promise.all([
            getAssessmentVisibilityOptionsFromSchoolConfig(),
            getDoc(
              doc(
                db,
                getSemesterDocPath(scope, "assessment_config", "settings"),
              ),
            ),
            getDoc(
              doc(db, getSemesterDocPath(scope, "assessment_config", "status")),
            ),
          ]);
        if (cancelled) return;
        const settingsMap = settingsSnap.exists() ? settingsSnap.data() : {};
        setDefaultVisibilityGroup(visibilityOptions.defaultGroup);
        setExtraVisibilityGroups(visibilityOptions.extraGroups);
        setExpandedExtraGrades(new Set());
        setAssessmentSettingsMap(settingsMap);
        setLegacyStatusMap(
          legacyStatusSnap.exists() ? legacyStatusSnap.data() : {},
        );
        if (isMockExam)
          setMockExamRounds(
            sortMockExamRounds([
              ...MOCK_EXAM_ROUNDS,
              ...getMockExamRoundsFromAssessmentConfig(
                settingsMap,
                nodeId,
                category,
              ),
            ]),
          );
        setSettingsLoaded(true);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load assessment settings:", error);
        setLoadError(
          "평가 설정을 불러오지 못했습니다. 다시 불러온 뒤 변경해 주세요.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, [scope, isOpen, nodeId, category, isMockExam, retryKey]);

  useEffect(() => {
    if (!isOpen || !settingsLoaded || loading) return;
    let cancelled = false;
    setDefinitionLoading(true);
    void getDoc(doc(db, "semester_assessment_definitions", definitionId))
      .then((snapshot) => {
        if (cancelled) return;
        const data = snapshot.exists() ? snapshot.data() : undefined;
        setDefinitionState({
          id: definitionId,
          revision: Number(data?.revision || 0),
          ...(data
            ? {
                settings: {
                  ...(data.presentationSettings || {}),
                  active: data.status === "PUBLISHED",
                  questionCount: data.questionCount,
                  timeLimit: data.durationSeconds,
                  allowRetake: Number(data.maxAttempts || 1) > 1,
                  cooldown: data.cooldownMinutes,
                  // Canonical class_ IDs identify enrollment records; the form
                  // uses the grade-class labels preserved with its settings.
                  visibleClassIds:
                    data.presentationSettings?.visibleClassIds || [],
                  visibilityVersion: 2,
                },
              }
            : {}),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load assessment publication:", error);
        setLoadError(
          "학생 공개 상태를 불러오지 못했습니다. 다시 불러온 뒤 변경해 주세요.",
        );
      })
      .finally(() => {
        if (!cancelled) setDefinitionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, settingsLoaded, loading, definitionId, retryKey]);

  useEffect(() => {
    if (!isOpen || !settingsLoaded || definitionState?.id !== definitionId)
      return;
    const key = getAssessmentConfigKey(
      nodeId,
      category,
      isMockExam ? selectedExamRound : undefined,
    );
    const legacyKey = getAssessmentConfigKey(nodeId, category);
    const useLegacyRound =
      isMockExam && selectedExamRound === DEFAULT_MOCK_EXAM_ROUND;
    const stored =
      assessmentSettingsMap[key] ??
      (useLegacyRound ? assessmentSettingsMap[legacyKey] : undefined);
    const legacyActive =
      legacyStatusMap[key] === true ||
      (useLegacyRound && legacyStatusMap[legacyKey] === true);
    const defaults = createDefaultFormState();
    setHasStoredSettings(
      Boolean(definitionState.settings || stored || legacyActive),
    );
    const raw = definitionState.settings ??
      stored ?? {
        active: legacyActive,
        // Preserve legacy active assessments; new settings start private.
        ...(!legacyActive
          ? {
              visibleClassIds: [],
              visibilityVersion: 2,
              ...(!isMockExam
                ? {
                    questionCount: defaults.questionCount,
                    questionOrder: defaults.questionOrder,
                    allowRetake: defaults.allowRetake,
                    cooldown: defaults.cooldown,
                    hintLimit: defaults.hintLimit,
                  }
                : {}),
              timeLimit: isMockExam
                ? 2400
                : Number(defaults.timeLimitMinutes) * 60,
            }
          : {}),
        ...(isMockExam
          ? {
              allowRetake: isRetakableMockExam,
              questionOrder: "unit",
              randomOrder: false,
              hintLimit: 0,
            }
          : {}),
      };
    const entry = normalizeAssessmentConfigEntry(raw, defaultClassIds);
    const next: QuizSettingsFormState = {
      active: entry.active,
      questionCount: entry.questionCount,
      questionOrder: entry.questionOrder,
      timeLimitMinutes: entry.timeLimit / 60,
      allowRetake: isMockExam ? isRetakableMockExam : entry.allowRetake,
      cooldown: entry.cooldown,
      hintLimit: isMockExam ? 0 : entry.hintLimit,
      visibleClassIds: entry.visibleClassIds,
    };
    setSettings(next);
    setSavedFingerprint(formFingerprint(next));
    setConfirmResetClassId("");
    setPendingNavigation(null);
  }, [
    assessmentSettingsMap,
    definitionState,
    definitionId,
    category,
    defaultClassIds,
    isMockExam,
    isOpen,
    isRetakableMockExam,
    legacyStatusMap,
    nodeId,
    selectedExamRound,
    settingsLoaded,
  ]);

  const updateSettings = (patch: Partial<QuizSettingsFormState>) => {
    if (!canEdit || busy) return;
    setSettings((prev) => ({ ...prev, ...patch }));
    setPendingNavigation(null);
  };
  const handleToggleClass = (classId: string) => {
    const next = new Set(normalizedSelectedClassIds);
    if (next.has(classId)) next.delete(classId);
    else next.add(classId);
    updateSettings({ visibleClassIds: Array.from(next) });
  };
  const handleSave = async () => {
    if (
      !canEdit ||
      !nodeId ||
      !settingsLoaded ||
      !ready ||
      loading ||
      busy ||
      saveLock.current ||
      hasValidationError
    )
      return;
    saveLock.current = true;
    setSaving(true);
    setPendingNavigation(null);
    const key = getAssessmentConfigKey(
      nodeId,
      category,
      isMockExam ? selectedExamRound : undefined,
    );
    const payload = {
      active: settings.active,
      questionCount: Number(settings.questionCount),
      randomOrder: settings.questionOrder === "random",
      questionOrder: settings.questionOrder,
      timeLimit: Number(settings.timeLimitMinutes) * 60,
      allowRetake: isMockExam ? isRetakableMockExam : settings.allowRetake,
      cooldown: settings.allowRetake ? Number(settings.cooldown) : 0,
      hintLimit: isMockExam ? 0 : Number(settings.hintLimit),
      visibleTargetGrade: "3",
      visibleClassIds: normalizedSelectedClassIds,
      visibilityVersion: 2,
    };
    try {
      const saved = await saveQuizAssessmentSettings(
        scope,
        nodeId,
        category,
        isMockExam ? selectedExamRound : "",
        nodeTitle || categoryLabel,
        key,
        payload,
        definitionState!.revision,
      );
      const published = saved.status === "PUBLISHED";
      const savedPayload = { ...payload, active: published };
      setDefinitionState({
        id: definitionId,
        revision: Number(saved.revision),
        settings: savedPayload,
      });
      setSavedFingerprint(formFingerprint({ ...settings, active: published }));
      // Round changes use the returned local state without fetching all settings again.
      setAssessmentSettingsMap((prev) => ({ ...prev, [key]: savedPayload }));
      showToast({
        tone: "success",
        title: "평가 설정 저장",
        message: published
          ? `선택한 ${normalizedSelectedClassIds.length}개 학급의 학생에게 공개하고 응시 설정을 저장했습니다.`
          : "모든 학생에게 비공개로 저장했습니다. 선택한 학급은 유지됩니다.",
      });
      onClose();
    } catch (error) {
      console.error("Failed to save assessment settings:", error);
      showToast({
        tone: "error",
        title: "평가 설정 저장 실패",
        message:
          error instanceof Error
            ? error.message
            : "설정 저장에 실패했습니다. 다시 시도해 주세요.",
      });
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };
  const handleResetAttempts = async (classId: string) => {
    if (!canEdit || !nodeId || busy || dirty || saveLock.current) return;
    saveLock.current = true;
    setResettingClassId(classId);
    try {
      const result = await executeAssessmentManagementCommand<{
        resetCount: number;
      }>("resetAssessmentAttemptsByClassV2", {
        definitionId: buildAssessmentDefinitionId(
          getAssessmentSemesterId(scope),
          "QUIZ",
          nodeId,
          category,
          isMockExam ? selectedExamRound : "",
        ),
        classId,
        reason: "교사 학급별 응시 초기화",
      });
      const label =
        allVisibilityTargets.find((target) => target.id === classId)
          ?.fullLabel || classId;
      setConfirmResetClassId("");
      showToast({
        tone: "success",
        title: "응시 초기화 완료",
        message: `${label} 응시 ${result.resetCount}건을 초기화했습니다. 기존 제출 결과와 위스는 유지됩니다.`,
      });
    } catch (error) {
      console.error("Failed to reset assessment attempts by class:", error);
      showToast({
        tone: "error",
        title: "응시 초기화 실패",
        message:
          error instanceof Error
            ? error.message
            : "학급별 응시 초기화에 실패했습니다.",
      });
    } finally {
      saveLock.current = false;
      setResettingClassId("");
    }
  };
  const renderVisibilityTarget = (target: AssessmentVisibilityTarget) => {
    const checked = selectedClassIdSet.has(target.id);
    return (
      <div
        key={target.id}
        className={`quiz-settings-class${checked ? " is-selected" : ""}`}
      >
        <div className="quiz-settings-class-row">
          <label>
            <input
              type="checkbox"
              checked={checked}
              disabled={!canEdit || busy}
              onChange={() => handleToggleClass(target.id)}
              aria-label={`${target.fullLabel} 공개 대상`}
            />
            <span>{target.shortLabel}</span>
          </label>
          <button
            type="button"
            className="quiz-settings-reset"
            disabled={!canEdit || busy || dirty}
            onClick={() =>
              setConfirmResetClassId((prev) =>
                prev === target.id ? "" : target.id,
              )
            }
            aria-label={`${target.fullLabel} 응시 초기화`}
          >
            응시 초기화
          </button>
        </div>
        {confirmResetClassId === target.id && (
          <div className="quiz-settings-reset-confirm">
            <strong>{target.fullLabel} 응시를 초기화할까요?</strong>
            <p>
              학생이 다시 응시할 수 있습니다. 기존 제출 결과와 위스는
              유지됩니다.
            </p>
            <div className="quiz-settings-actions">
              <button
                type="button"
                className="quiz-authoring-button"
                disabled={busy}
                onClick={() => setConfirmResetClassId("")}
              >
                취소
              </button>
              <button
                type="button"
                className="quiz-authoring-button quiz-authoring-danger"
                disabled={busy || dirty}
                onClick={() => void handleResetAttempts(target.id)}
              >
                {resettingClassId === target.id ? "초기화 중…" : "초기화 실행"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };
  const renderNumberField = (
    name: "questionCount" | "timeLimitMinutes" | "cooldown" | "hintLimit",
    label: string,
    min: number,
    max: number,
    disabled = false,
  ) => (
    <label className="quiz-settings-field">
      <span>{label}</span>
      <NumericInput
        allowEmpty
        min={min}
        max={max}
        step={name === "timeLimitMinutes" ? "any" : 1}
        aria-label={label}
        value={settings[name]}
        disabled={!canEdit || busy || disabled}
        aria-invalid={Boolean(fieldErrors[name])}
        aria-describedby={
          fieldErrors[name] ? `quiz-settings-${name}-error` : undefined
        }
        onChange={(event) =>
          updateSettings({
            [name]: event.target.value === "" ? "" : Number(event.target.value),
          })
        }
      />
      {fieldErrors[name] && (
        <span
          id={`quiz-settings-${name}-error`}
          className="quiz-settings-error"
        >
          {fieldErrors[name]}
        </span>
      )}
    </label>
  );
  if (!isOpen) return null;
  return (
    <div className="quiz-settings-backdrop">
      <div
        ref={dialogRef}
        className="quiz-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quiz-settings-title"
        tabIndex={-1}
        aria-busy={loading || definitionLoading || busy}
      >
        <header className="quiz-settings-header">
          <div>
            <div className="quiz-settings-eyebrow">평가 공개·응시 설정</div>
            <h2 id="quiz-settings-title">{settingsTitle}</h2>
          </div>
          <button
            type="button"
            className="quiz-authoring-button"
            onClick={() => requestNavigation("close")}
            disabled={busy}
            aria-label="평가 설정 닫기"
          >
            닫기
          </button>
        </header>
        <div className="quiz-settings-body">
          {loading ? (
            <p role="status">설정을 불러오는 중…</p>
          ) : loadError ? (
            <div className="quiz-settings-error" role="alert">
              <p>{loadError}</p>
              <button
                type="button"
                className="quiz-authoring-button"
                onClick={() => setRetryKey((key) => key + 1)}
              >
                다시 불러오기
              </button>
            </div>
          ) : !ready ? (
            <p role="status">학생 공개 상태를 불러오는 중…</p>
          ) : (
            settingsLoaded && (
              <>
                {isMockExam && (
                  <section className="quiz-settings-section">
                    <div className="quiz-settings-section-heading">
                      <h3>모의고사 회차</h3>
                      <InfoHelp label="모의고사 회차 도움말">
                        회차마다 공개 대상과 응시 조건을 따로 저장합니다. 기본
                        1~3회는 한 번만 응시할 수 있고, 추가 회차는 재응시를
                        허용합니다. 모의고사에는 힌트가 없습니다.
                      </InfoHelp>
                    </div>
                    <div className="quiz-settings-rounds">
                      {mockExamRounds.map((round) => (
                        <button
                          key={round}
                          type="button"
                          className={
                            selectedExamRound === round
                              ? "quiz-authoring-primary"
                              : "quiz-authoring-button"
                          }
                          aria-pressed={selectedExamRound === round}
                          disabled={busy}
                          onClick={() => {
                            if (selectedExamRound !== round) {
                              requestNavigation(round);
                            }
                          }}
                        >
                          {formatMockExamRoundLabel(round)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="quiz-authoring-button"
                        disabled={!canEdit || busy}
                        onClick={() => {
                          const next = getNextMockExamRound(mockExamRounds);
                          setMockExamRounds((prev) =>
                            sortMockExamRounds([...prev, next]),
                          );
                          requestNavigation(next);
                        }}
                      >
                        회차 추가
                      </button>
                    </div>
                  </section>
                )}
                <section className="quiz-settings-section">
                  <div className="quiz-settings-section-heading">
                    <h3>학생 공개</h3>
                    <InfoHelp label="학생 공개 도움말">
                      변경한 내용은 저장 후 학생에게 반영됩니다. 비공개로
                      전환해도 학급 선택은 유지됩니다. 응시 중인 학생의 처리에는
                      기존 평가 규칙이 적용됩니다.
                    </InfoHelp>
                  </div>
                  <div
                    className="quiz-settings-visibility"
                    role="radiogroup"
                    aria-label="학생 공개"
                    aria-describedby="quiz-settings-visibility-summary"
                  >
                    <label className="quiz-settings-switch">
                      <input
                        type="radio"
                        name="quiz-settings-visibility"
                        checked={settings.active}
                        disabled={!canEdit || busy}
                        onChange={() => updateSettings({ active: true })}
                      />
                      <span>선택 학급 학생에게 공개</span>
                    </label>
                    <label className="quiz-settings-switch">
                      <input
                        type="radio"
                        name="quiz-settings-visibility"
                        checked={!settings.active}
                        disabled={!canEdit || busy}
                        onChange={() => updateSettings({ active: false })}
                      />
                      <span>모든 학생에게 비공개</span>
                    </label>
                  </div>
                  <p
                    id="quiz-settings-visibility-summary"
                    className="quiz-settings-summary"
                  >
                    {settings.active
                      ? `저장하면 선택한 ${normalizedSelectedClassIds.length}개 학급의 학생이 응시할 수 있습니다.`
                      : "저장하면 모든 학생에게 평가가 비공개됩니다. 학급 선택은 유지됩니다."}
                  </p>
                  <div className="quiz-settings-section-heading quiz-settings-target-heading">
                    <h4>공개 대상 학급</h4>
                    <InfoHelp label="응시 초기화 도움말">
                      응시 초기화는 저장된 평가의 선택 학급에 즉시 적용됩니다.
                      설정을 변경했다면 먼저 저장해 주세요. 기존 제출 결과와
                      위스는 유지됩니다.
                    </InfoHelp>
                    <div className="quiz-settings-actions">
                      <button
                        type="button"
                        className="quiz-authoring-button"
                        disabled={
                          !canEdit || busy || !availableTargetIds.length
                        }
                        onClick={() =>
                          updateSettings({
                            visibleClassIds: [
                              ...new Set([
                                ...availableTargetIds,
                                ...unknownSelectedClassIds,
                              ]),
                            ],
                          })
                        }
                      >
                        모두 선택
                      </button>
                      <button
                        type="button"
                        className="quiz-authoring-button"
                        disabled={
                          !canEdit || busy || !normalizedSelectedClassIds.length
                        }
                        onClick={() => updateSettings({ visibleClassIds: [] })}
                      >
                        선택 해제
                      </button>
                    </div>
                  </div>
                  <h4 className="quiz-settings-grade">
                    {defaultVisibilityGroup.gradeLabel}{" "}
                    <span>
                      {
                        defaultVisibilityGroup.targets.filter((target) =>
                          selectedClassIdSet.has(target.id),
                        ).length
                      }
                      /{defaultVisibilityGroup.targets.length}
                    </span>
                  </h4>
                  {defaultVisibilityGroup.targets.length ? (
                    <div className="quiz-settings-classes">
                      {defaultVisibilityGroup.targets.map(
                        renderVisibilityTarget,
                      )}
                    </div>
                  ) : (
                    <p className="quiz-settings-summary">
                      등록된 3학년 학급이 없습니다.
                    </p>
                  )}
                  {extraVisibilityGroups.map((group) => {
                    const expanded = expandedExtraGrades.has(group.gradeValue);
                    return (
                      <div
                        key={group.gradeValue}
                        className="quiz-settings-extra-grade"
                      >
                        <button
                          type="button"
                          className="quiz-settings-grade-toggle"
                          aria-expanded={expanded}
                          onClick={() =>
                            setExpandedExtraGrades((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.gradeValue))
                                next.delete(group.gradeValue);
                              else next.add(group.gradeValue);
                              return next;
                            })
                          }
                        >
                          <span>
                            {group.gradeLabel} ·{" "}
                            {
                              group.targets.filter((target) =>
                                selectedClassIdSet.has(target.id),
                              ).length
                            }
                            /{group.targets.length}
                          </span>
                          <span>{expanded ? "접기" : "펼치기"}</span>
                        </button>
                        {expanded && (
                          <div className="quiz-settings-classes">
                            {group.targets.map(renderVisibilityTarget)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {unknownSelectedClassIds.length > 0 && (
                    <p className="quiz-settings-error">
                      현재 학급 목록에 없는 선택:{" "}
                      {unknownSelectedClassIds.join(", ")}{" "}
                      <button
                        type="button"
                        className="quiz-authoring-button"
                        disabled={!canEdit || busy}
                        onClick={() =>
                          updateSettings({
                            visibleClassIds: normalizedSelectedClassIds.filter(
                              (id) => availableTargetIdSet.has(id),
                            ),
                          })
                        }
                      >
                        해당 선택 해제
                      </button>
                    </p>
                  )}
                  {fieldErrors.visibility && (
                    <p className="quiz-settings-error" role="alert">
                      {fieldErrors.visibility}
                    </p>
                  )}
                </section>
                <div className="quiz-settings-columns">
                  <section className="quiz-settings-section">
                    <h3>출제·제한 시간</h3>
                    <div className="quiz-settings-option">
                      {renderNumberField(
                        "questionCount",
                        "출제 문항 수",
                        1,
                        200,
                      )}
                    </div>
                    <div className="quiz-settings-option">
                      {renderNumberField(
                        "timeLimitMinutes",
                        "제한 시간 (분)",
                        1,
                        360,
                      )}
                      <div
                        className="quiz-settings-presets"
                        aria-label="제한 시간 빠른 선택"
                      >
                        {[5, 10, 15, 20, 45].map((minutes) => (
                          <button
                            key={minutes}
                            type="button"
                            className="quiz-authoring-button"
                            disabled={!canEdit || busy}
                            aria-pressed={settings.timeLimitMinutes === minutes}
                            onClick={() =>
                              updateSettings({ timeLimitMinutes: minutes })
                            }
                          >
                            {minutes}분
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="quiz-settings-option">
                      <label className="quiz-settings-field">
                        <span>문항 출제 순서</span>
                        <select
                          value={settings.questionOrder}
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updateSettings({
                              questionOrder: event.target
                                .value as AssessmentQuestionOrder,
                            })
                          }
                        >
                          {QUESTION_ORDER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {isMockExam && option.value === "unit"
                                ? "단원 균형 랜덤"
                                : option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </section>
                  <section className="quiz-settings-section">
                    <h3>{isMockExam ? "재응시" : "힌트·재응시"}</h3>
                    {!isMockExam && (
                      <div className="quiz-settings-option">
                        <label className="quiz-settings-switch">
                          <input
                            type="checkbox"
                            checked={hintsEnabled}
                            disabled={!canEdit || busy}
                            onChange={(event) =>
                              updateSettings({
                                hintLimit: event.target.checked ? 3 : 0,
                              })
                            }
                          />
                          <span>힌트 사용</span>
                        </label>
                        {renderNumberField(
                          "hintLimit",
                          "힌트 사용 가능 횟수",
                          0,
                          200,
                          !hintsEnabled,
                        )}
                      </div>
                    )}
                    <div className="quiz-settings-option">
                      {!isMockExam && (
                        <label className="quiz-settings-switch">
                          <input
                            type="checkbox"
                            checked={settings.allowRetake}
                            disabled={!canEdit || busy}
                            onChange={(event) =>
                              updateSettings({
                                allowRetake: event.target.checked,
                              })
                            }
                          />
                          <span>재응시 허용</span>
                        </label>
                      )}
                      {isMockExam && (
                        <p className="quiz-settings-summary">
                          {isRetakableMockExam
                            ? "추가 회차 · 재응시 허용"
                            : "기본 회차 · 1회만 응시 가능"}
                        </p>
                      )}
                      {(!isMockExam || isRetakableMockExam) &&
                        renderNumberField(
                          "cooldown",
                          "재응시 대기 시간 (분)",
                          0,
                          43200,
                          !settings.allowRetake,
                        )}
                    </div>
                  </section>
                </div>
              </>
            )
          )}
        </div>
        <footer className="quiz-settings-footer">
          <div ref={resultRef} tabIndex={-1}>
            {pendingNavigation && (
              <div className="quiz-settings-discard" role="alert">
                <p>저장하지 않은 변경 사항이 있습니다.</p>
                <div className="quiz-settings-actions">
                  <button
                    type="button"
                    className="quiz-authoring-button"
                    onClick={() => setPendingNavigation(null)}
                  >
                    계속 편집
                  </button>
                  <button
                    type="button"
                    className="quiz-authoring-button quiz-authoring-danger"
                    onClick={() => {
                      const next = pendingNavigation;
                      setPendingNavigation(null);
                      if (next === "close") onClose();
                      else setSelectedExamRound(next);
                    }}
                  >
                    변경 취소 후{" "}
                    {pendingNavigation === "close" ? "닫기" : "이동"}
                  </button>
                </div>
              </div>
            )}
            <div className="quiz-settings-footer-row">
              <p role="status" aria-live="polite">
                {saving
                  ? "학생 공개 상태를 저장하는 중…"
                  : resettingClassId
                    ? "응시를 초기화하는 중…"
                    : dirty
                      ? "저장하지 않은 변경 사항"
                      : ready
                        ? !hasStoredSettings
                          ? "아직 저장하지 않은 기본 설정"
                          : settings.active
                            ? `저장된 공개 대상 · ${normalizedSelectedClassIds.length}개 학급`
                            : "저장된 상태 · 학생 비공개"
                        : ""}
              </p>
              {canEdit && (
                <button
                  type="button"
                  className="quiz-authoring-primary"
                  onClick={() => void handleSave()}
                  disabled={
                    loading ||
                    busy ||
                    !settingsLoaded ||
                    !ready ||
                    hasValidationError ||
                    (!dirty && hasStoredSettings)
                  }
                >
                  {saving ? "저장 중…" : "설정 저장"}
                </button>
              )}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default QuizSettingsModal;
