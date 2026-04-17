import React, { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../contexts/AuthContext";
import {
  type AssessmentVisibilityGroup,
  type AssessmentVisibilityTarget,
  getAssessmentConfigKey,
  getAssessmentVisibilityOptionsFromSchoolConfig,
  normalizeAssessmentClassId,
  normalizeAssessmentConfigEntry,
  resetAssessmentAttemptsByClass,
} from "../../../lib/assessmentConfig";
import { getSemesterDocPath } from "../../../lib/semesterScope";

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
  questionCount: number;
  randomOrder: boolean;
  timeLimitMinutes: number;
  allowRetake: boolean;
  cooldown: number;
  hintLimit: number;
  visibleClassIds: string[];
}

const CATEGORY_LABELS: Record<string, string> = {
  diagnostic: "진단평가",
  formative: "형성평가",
  exam_prep: "학기 시험 대비",
};

const createDefaultFormState = (
  classIds: string[],
): QuizSettingsFormState => ({
  active: false,
  questionCount: 10,
  randomOrder: true,
  timeLimitMinutes: 1,
  allowRetake: true,
  cooldown: 0,
  hintLimit: 2,
  visibleClassIds: [...classIds],
});

const sectionCardClassName =
  "rounded-2xl border border-gray-200 bg-white p-4 shadow-sm";

const createEmptyVisibilityGroup = (): AssessmentVisibilityGroup => ({
  gradeValue: "3",
  gradeLabel: "3학년",
  isDefaultGrade: true,
  isTestGrade: false,
  targets: [],
});

const QuizSettingsModal: React.FC<QuizSettingsModalProps> = ({
  isOpen,
  onClose,
  nodeId,
  nodeTitle,
  category,
  canEdit,
}) => {
  const { config } = useAuth();
  const [settings, setSettings] = useState<QuizSettingsFormState>(
    createDefaultFormState([]),
  );
  const [defaultVisibilityGroup, setDefaultVisibilityGroup] =
    useState<AssessmentVisibilityGroup>(createEmptyVisibilityGroup);
  const [extraVisibilityGroups, setExtraVisibilityGroups] = useState<
    AssessmentVisibilityGroup[]
  >([]);
  const [expandedExtraGrades, setExpandedExtraGrades] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resettingClassId, setResettingClassId] = useState("");
  const [confirmResetClassId, setConfirmResetClassId] = useState("");

  const categoryLabel = CATEGORY_LABELS[category] || "평가";
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
  const visibilityTargetMap = useMemo(
    () =>
      new Map(
        allVisibilityTargets.map((target) => [target.id, target] as const),
      ),
    [allVisibilityTargets],
  );
  const normalizedSelectedClassIds = useMemo(
    () =>
      Array.from(
        new Set(
          settings.visibleClassIds
            .map((classId) => normalizeAssessmentClassId(classId, "3"))
            .filter(Boolean),
        ),
      ),
    [settings.visibleClassIds],
  );
  const selectedKnownClassIdSet = useMemo(
    () =>
      new Set(
        normalizedSelectedClassIds.filter((classId) =>
          availableTargetIdSet.has(classId),
        ),
      ),
    [availableTargetIdSet, normalizedSelectedClassIds],
  );
  const hasVisibleClassSelection = normalizedSelectedClassIds.length > 0;

  const buildOrderedVisibleClassIds = (selectedIds: Iterable<string>) => {
    const selectedSet = new Set(
      Array.from(selectedIds)
        .map((classId) => normalizeAssessmentClassId(classId, "3"))
        .filter(Boolean),
    );
    const hiddenIds = Array.from(selectedSet)
      .filter((classId) => !availableTargetIdSet.has(classId))
      .sort();
    return [
      ...availableTargetIds.filter((classId) => selectedSet.has(classId)),
      ...hiddenIds,
    ];
  };

  useEffect(() => {
    if (!isOpen || !nodeId) return;
    void loadSettings();
  }, [config, isOpen, nodeId, category]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const key = getAssessmentConfigKey(nodeId, category);
      const [visibilityOptions, settingsSnap, legacyStatusSnap] =
        await Promise.all([
          getAssessmentVisibilityOptionsFromSchoolConfig(),
          getDoc(
            doc(db, getSemesterDocPath(config, "assessment_config", "settings")),
          ),
          getDoc(
            doc(db, getSemesterDocPath(config, "assessment_config", "status")),
          ),
        ]);

      const legacyStatus = legacyStatusSnap.exists()
        ? (legacyStatusSnap.data() as Record<string, unknown>)
        : {};
      const settingsMap = settingsSnap.exists()
        ? (settingsSnap.data() as Record<string, unknown>)
        : {};
      const defaultClassIds = visibilityOptions.defaultGroup.targets.map(
        (target) => target.id,
      );
      const normalizedEntry = normalizeAssessmentConfigEntry(
        settingsMap[key] ?? { active: legacyStatus[key] === true },
        defaultClassIds,
      );

      setDefaultVisibilityGroup(visibilityOptions.defaultGroup);
      setExtraVisibilityGroups(visibilityOptions.extraGroups);
      setExpandedExtraGrades(new Set());
      setSettings({
        active: normalizedEntry.active,
        questionCount: normalizedEntry.questionCount,
        randomOrder: normalizedEntry.randomOrder,
        timeLimitMinutes: Math.max(
          1,
          Math.round(normalizedEntry.timeLimit / 60),
        ),
        allowRetake: normalizedEntry.allowRetake,
        cooldown: normalizedEntry.cooldown,
        hintLimit: normalizedEntry.hintLimit,
        visibleClassIds: normalizedEntry.hasExplicitClassVisibility
          ? normalizedEntry.visibleClassIds
          : [...defaultClassIds],
      });
      setConfirmResetClassId("");
    } catch (error) {
      console.error("Failed to load assessment settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleClass = (classId: string) => {
    if (!canEdit) return;
    setSettings((prev) => {
      const nextSet = new Set(
        prev.visibleClassIds
          .map((selectedClassId) =>
            normalizeAssessmentClassId(selectedClassId, "3"),
          )
          .filter(Boolean),
      );
      if (nextSet.has(classId)) {
        nextSet.delete(classId);
      } else {
        nextSet.add(classId);
      }
      return {
        ...prev,
        visibleClassIds: buildOrderedVisibleClassIds(nextSet),
      };
    });
  };

  const handleSave = async () => {
    if (!canEdit || !nodeId) return;
    setSaving(true);
    try {
      const key = getAssessmentConfigKey(nodeId, category);
      await setDoc(
        doc(db, getSemesterDocPath(config, "assessment_config", "settings")),
        {
          [key]: {
            active: settings.active,
            questionCount: Math.max(1, settings.questionCount),
            randomOrder: settings.randomOrder,
            timeLimit: Math.max(1, settings.timeLimitMinutes) * 60,
            allowRetake: settings.allowRetake,
            cooldown: Math.max(0, settings.cooldown),
            hintLimit: Math.max(0, settings.hintLimit),
            visibleTargetGrade: "3",
            visibleClassIds: normalizedSelectedClassIds,
            visibilityVersion: 2,
          },
        },
        { merge: true },
      );
      alert("설정을 저장했습니다.");
      onClose();
    } catch (error) {
      console.error("Failed to save assessment settings:", error);
      alert("설정 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetAttempts = async (classId: string) => {
    if (!canEdit || !nodeId) return;
    setResettingClassId(classId);
    try {
      const result = await resetAssessmentAttemptsByClass({
        config,
        unitId: nodeId,
        category,
        classId,
      });
      const classLabel = visibilityTargetMap.get(classId)?.fullLabel || classId;
      setConfirmResetClassId("");
      alert(
        `${classLabel} 응시 초기화를 완료했습니다.\n응시 기록 ${result.deletedQuizResultCount}건, 포인트 거래 ${result.deletedPointTransactionCount}건을 정리했습니다.`,
      );
    } catch (error) {
      console.error("Failed to reset assessment attempts by class:", error);
      alert("학급별 응시 초기화에 실패했습니다.");
    } finally {
      setResettingClassId("");
    }
  };

  const toggleExtraGrade = (gradeValue: string) => {
    setExpandedExtraGrades((prev) => {
      const next = new Set(prev);
      if (next.has(gradeValue)) {
        next.delete(gradeValue);
      } else {
        next.add(gradeValue);
      }
      return next;
    });
  };

  const renderVisibilityTargetCard = (target: AssessmentVisibilityTarget) => {
    const checked = selectedKnownClassIdSet.has(target.id);
    const toggleEnabled = canEdit && settings.active;
    const toggleClassName = checked
      ? settings.active
        ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
        : "border-blue-200 bg-blue-50 text-blue-700"
      : settings.active
        ? "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
        : "border-gray-200 bg-gray-50 text-gray-400";

    return (
      <div
        key={target.id}
        className={`rounded-lg border px-2 py-1 transition ${
          checked
            ? settings.active
              ? "border-blue-200 bg-blue-50/80"
              : "border-blue-100 bg-blue-50/50"
            : "border-gray-200 bg-white"
        }`}
      >
        <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
          <div className="min-w-0 truncate text-[12px] font-extrabold text-gray-900">
            {target.shortLabel}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={`${target.fullLabel} 공개 전환`}
            title={checked ? `${target.fullLabel} 공개 중` : `${target.fullLabel} 비공개`}
            onClick={() => handleToggleClass(target.id)}
            disabled={!toggleEnabled}
            className={`inline-flex h-7 w-12 shrink-0 box-border items-center rounded-full border p-0.5 transition ${toggleClassName} disabled:cursor-not-allowed disabled:opacity-70`}
          >
            <span
              className={`flex h-full w-full items-center rounded-full ${
                checked ? "justify-end bg-white/25" : "justify-start bg-gray-200"
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
            </span>
          </button>
          <button
            type="button"
            onClick={() =>
              setConfirmResetClassId((prev) => (prev === target.id ? "" : target.id))
            }
            disabled={!canEdit || Boolean(resettingClassId) || Boolean(saving)}
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-bold leading-none text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            초기화
          </button>
        </div>

        {confirmResetClassId === target.id && (
          <div className="mt-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-2">
            <div className="text-[11px] font-bold text-rose-800">
              {target.fullLabel} 응시 기록을 초기화합니다.
            </div>
            <p className="mt-1 text-[10px] leading-4 text-rose-700">
              응시 기록, 제출 상태, 사용한 힌트, 해당 평가 포인트 거래를 정리합니다.
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setConfirmResetClassId("")}
                disabled={resettingClassId === target.id}
                className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleResetAttempts(target.id)}
                disabled={resettingClassId === target.id}
                className="rounded-lg bg-rose-600 px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-rose-300"
              >
                {resettingClassId === target.id
                  ? "초기화 중..."
                  : `${target.shortLabel} 초기화 실행`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-gray-200 bg-gray-50 shadow-2xl">
        <div className="border-b border-gray-200 bg-white px-5 py-3.5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-bold text-blue-600">
                <i className="fas fa-sliders-h"></i>
                <span>평가 상세 설정</span>
              </div>
              <h3 className="mt-1.5 text-lg font-extrabold text-gray-900 sm:text-xl">
                {nodeTitle || "선택한 단원"} - {categoryLabel}
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                공개와 응시 조건을 빠르게 조정합니다.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              aria-label="설정 모달 닫기"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="rounded-2xl border border-gray-200 bg-white px-6 py-14 text-center text-sm font-semibold text-gray-400">
              설정을 불러오는 중입니다...
            </div>
          ) : (
            <div className="space-y-4">
              <section className={`${sectionCardClassName} space-y-3 p-2.5`}>
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div>
                    <h4 className="text-sm font-extrabold text-gray-900">
                      학급별 공개 / 초기화
                    </h4>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      공개 반과 응시 초기화를 빠르게 조정합니다.
                    </p>
                  </div>
                  <div className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                    공개 학급 {selectedKnownClassIdSet.size}/
                    {allVisibilityTargets.length || 0}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 px-1.5 py-1">
                  <div className="text-[10px] font-semibold text-gray-600">
                    공개를 꺼도 선택한 반 상태는 유지됩니다.
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.active}
                    aria-label="전체 공개 전환"
                    title={settings.active ? "전체 공개 켜짐" : "전체 공개 꺼짐"}
                    onClick={() =>
                      canEdit &&
                      setSettings((prev) => ({
                        ...prev,
                        active: !prev.active,
                      }))
                    }
                    disabled={!canEdit}
                    className={`ml-auto inline-flex h-7 w-12 shrink-0 box-border items-center rounded-full border p-0.5 transition ${
                      settings.active
                        ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
                        : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <span
                      className={`flex h-full w-full items-center rounded-full ${
                        settings.active
                          ? "justify-end bg-white/25"
                          : "justify-start bg-gray-200"
                      }`}
                    >
                      <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-gray-700">
                      공개 학급 빠른 선택
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          visibleClassIds: buildOrderedVisibleClassIds(
                            availableTargetIds,
                          ),
                        }))
                      }
                      disabled={!canEdit || allVisibilityTargets.length === 0}
                      className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      전체 공개
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSettings((prev) => ({
                          ...prev,
                          visibleClassIds: [],
                        }))
                      }
                      disabled={!canEdit || allVisibilityTargets.length === 0}
                      className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      전체 비공개
                    </button>
                  </div>
                  <div className="text-[10px] font-semibold text-rose-600">
                    초기화는 선택한 반 기록만 정리합니다.
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="rounded-xl border border-gray-200 bg-white p-2">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <div className="text-[11px] font-extrabold text-gray-800">
                        {defaultVisibilityGroup.gradeLabel}
                      </div>
                      <div className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                        {
                          defaultVisibilityGroup.targets.filter((target) =>
                            selectedKnownClassIdSet.has(target.id),
                          ).length
                        }
                        /{defaultVisibilityGroup.targets.length}
                      </div>
                    </div>
                    {defaultVisibilityGroup.targets.length > 0 ? (
                      <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                        {defaultVisibilityGroup.targets.map(
                          renderVisibilityTargetCard,
                        )}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-sm text-gray-500">
                        3학년 학급 목록을 아직 불러오지 못했습니다.
                      </div>
                    )}
                  </div>

                  {extraVisibilityGroups.map((group) => {
                    const expanded = expandedExtraGrades.has(group.gradeValue);
                    const selectedCount = group.targets.filter((target) =>
                      selectedKnownClassIdSet.has(target.id),
                    ).length;

                    return (
                      <div
                        key={group.gradeValue}
                        className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                      >
                        <button
                          type="button"
                          onClick={() => toggleExtraGrade(group.gradeValue)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-gray-50"
                        >
                          <div>
                            <div className="text-[11px] font-extrabold text-gray-800">
                              {group.gradeLabel}
                            </div>
                            <div className="mt-0.5 text-[10px] font-medium text-gray-500">
                              클릭하면 이 학년의 모든 반을 펼칩니다.
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600">
                              {selectedCount}/{group.targets.length}
                            </div>
                            <i
                              className={`fas fa-chevron-${expanded ? "up" : "down"} text-[11px] text-gray-400`}
                            ></i>
                          </div>
                        </button>
                        {expanded && (
                          <div className="border-t border-gray-100 px-2 pb-2 pt-2">
                            <div className="grid gap-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
                              {group.targets.map(renderVisibilityTargetCard)}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {settings.active && !hasVisibleClassSelection && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    공개는 켜져 있지만 선택된 학급이 없습니다.
                  </div>
                )}

                {!settings.active && allVisibilityTargets.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                    전체 공개를 켜면 현재 저장된 학급 선택 상태가 그대로 반영됩니다.
                  </div>
                )}
              </section>

              <div className="grid gap-4 xl:grid-cols-2">
                <section className={sectionCardClassName}>
                  <div className="mb-3">
                    <h4 className="text-base font-extrabold text-gray-900">
                      출제/응시 설정
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">
                      문항 수와 제한 시간을 조정합니다.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                      <span className="text-xs font-bold text-gray-500">
                        한 번에 출제할 문항 수
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={settings.questionCount}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            questionCount: Math.max(
                              1,
                              parseInt(event.target.value, 10) || 1,
                            ),
                          }))
                        }
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-center text-base font-extrabold text-blue-700"
                      />
                    </label>

                    <label className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                      <span className="text-xs font-bold text-gray-500">
                        제한 시간 (분)
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={settings.timeLimitMinutes}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            timeLimitMinutes: Math.max(
                              1,
                              parseInt(event.target.value, 10) || 1,
                            ),
                          }))
                        }
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-center text-base font-extrabold text-gray-800"
                      />
                    </label>
                  </div>

                  <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                    <div className="text-xs font-bold text-gray-500">
                      문항 출제 순서
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            randomOrder: true,
                          }))
                        }
                        className={`rounded-lg border px-3 py-2.5 text-xs font-bold transition ${
                          settings.randomOrder
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
                        }`}
                      >
                        랜덤 순서
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSettings((prev) => ({
                            ...prev,
                            randomOrder: false,
                          }))
                        }
                        className={`rounded-lg border px-3 py-2.5 text-xs font-bold transition ${
                          !settings.randomOrder
                            ? "border-blue-200 bg-blue-50 text-blue-700"
                            : "border-gray-200 bg-white text-gray-600 hover:border-blue-200 hover:text-blue-700"
                        }`}
                      >
                        등록 순서
                      </button>
                    </div>
                  </div>
                </section>

                <section className={sectionCardClassName}>
                  <div className="mb-3">
                    <h4 className="text-base font-extrabold text-gray-900">
                      힌트/재응시 설정
                    </h4>
                    <p className="mt-1 text-xs text-gray-500">
                      힌트 횟수와 재응시 규칙을 조정합니다.
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                      <span className="text-xs font-bold text-gray-500">
                        힌트 사용 가능 횟수
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={settings.hintLimit}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            hintLimit: Math.max(
                              0,
                              parseInt(event.target.value, 10) || 0,
                            ),
                          }))
                        }
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-center text-base font-extrabold text-gray-800"
                      />
                    </label>

                    <label className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3">
                      <span className="text-xs font-bold text-gray-500">
                        재응시 대기 시간 (분)
                      </span>
                      <input
                        type="number"
                        min={0}
                        value={settings.cooldown}
                        disabled={!settings.allowRetake}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            cooldown: Math.max(
                              0,
                              parseInt(event.target.value, 10) || 0,
                            ),
                          }))
                        }
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-center text-base font-extrabold text-gray-800 disabled:cursor-not-allowed disabled:bg-gray-100"
                      />
                    </label>
                  </div>

                  <label className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-3.5 py-3">
                    <div>
                      <div className="text-sm font-bold text-gray-800">
                        재응시 허용
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        허용을 끄면 이미 응시한 학생은 다시 시작할 수 없습니다.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.allowRetake}
                      onChange={(event) =>
                        setSettings((prev) => ({
                          ...prev,
                          allowRetake: event.target.checked,
                          cooldown: event.target.checked ? prev.cooldown : 0,
                        }))
                      }
                      className="h-5 w-5 rounded border-gray-300 text-blue-600"
                    />
                  </label>
                </section>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 bg-white px-5 py-3 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-gray-100"
            >
              닫기
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={loading || saving || Boolean(resettingClassId)}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? "저장 중..." : "설정 저장하기"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuizSettingsModal;
