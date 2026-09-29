import React, { useEffect, useState } from "react";
import "./examGradingPlan.css";
import KoreanTextInput from "./KoreanTextInput";
import GradingScoreHelp from "./GradingScoreHelp";
import { db } from "../../../lib/firebase";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { useAuth } from "../../../contexts/AuthContext";
import { normalizeKoreanText } from "../../../lib/koreanText";
import {
  getSemesterCollectionPath,
  getSemesterDocPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  buildScoreRows,
  getScoreKey,
  getSubjectPriorityIndex,
  getTypeLabel,
  normalizePlanItemType,
  type ScoreItemType,
} from "../../../lib/studentScores";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import { useAppToast } from "../../../components/common/AppToastProvider";

interface GradingItem {
  type: "정기" | "수행";
  name: string;
  maxScore: number;
  ratio: number;
}

interface GradingPlan {
  id: string;
  subject: string;
  targetGrade: string;
  items: GradingItem[];
  academicYear?: string;
  semester?: string;
  createdAt?: any;
}

const isRegularExamItem = (type: string) =>
  type === "정기" || type === "정기시험";
const isPerformanceItem = (type: string) =>
  type === "수행" || type === "수행평가";
const previewScoreTypes: ScoreItemType[] = ["exam", "performance", "other"];
const previewCategoryMeta: Record<
  ScoreItemType,
  {
    label: string;
    shortLabel: string;
    dotClass: string;
    barClass: string;
    textClass: string;
  }
> = {
  exam: {
    label: "정기시험",
    shortLabel: "정기",
    dotClass: "bg-blue-600",
    barClass: "bg-blue-600",
    textClass: "text-blue-700",
  },
  performance: {
    label: "수행평가",
    shortLabel: "수행",
    dotClass: "bg-orange-500",
    barClass: "bg-orange-500",
    textClass: "text-orange-700",
  },
  other: {
    label: "기타",
    shortLabel: "기타",
    dotClass: "bg-slate-400",
    barClass: "bg-slate-400",
    textClass: "text-slate-600",
  },
};

const formatPreviewNumber = (value: number) => {
  const rounded = Number(value.toFixed(1));
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const formatPreviewScore = (value: number) => `${formatPreviewNumber(value)}점`;

const formatPreviewPercent = (value: number) =>
  `${formatPreviewNumber(value)}%`;

const ExamGradingPlan: React.FC = () => {
  const { userConfig } = useAuth();
  const { confirm } = useAppDialog();
  const { showToast } = useAppToast();
  const [plans, setPlans] = useState<GradingPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPlan, setPreviewPlan] = useState<Omit<
    GradingPlan,
    "id"
  > | null>(null);
  const [previewScores, setPreviewScores] = useState<Record<string, string>>(
    {},
  );
  const [previewActiveType, setPreviewActiveType] =
    useState<ScoreItemType | null>(null);

  // Form State
  const [editId, setEditId] = useState<string | null>(null);
  const [grade, setGrade] = useState("3");
  const [subject, setSubject] = useState("");
  const [items, setItems] = useState<GradingItem[]>([
    { type: "정기", name: "", maxScore: 0, ratio: 0 },
  ]);
  const [sortMode, setSortMode] = useState("importance");
  const koreanInputProps = {
    lang: "ko",
    inputMode: "text" as const,
    autoCapitalize: "off" as const,
    autoCorrect: "off" as const,
    spellCheck: false,
  };

  useEffect(() => {
    loadPlans();
  }, [userConfig]);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(
            db,
            getSemesterCollectionPath(userConfig, "grading_plans"),
          ),
          orderBy("createdAt", "desc"),
        ),
      );
      const list: GradingPlan[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() } as GradingPlan));
      setPlans(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = () => {
    setItems([...items, { type: "정기", name: "", maxScore: 0, ratio: 0 }]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleItemChange = <K extends keyof GradingItem>(
    idx: number,
    field: K,
    value: GradingItem[K],
  ) => {
    setItems((current) =>
      current.map((item, index) =>
        index === idx ? { ...item, [field]: value } : item,
      ),
    );
  };

  const handleSave = async () => {
    if (saving) return;
    if (!subject.trim()) {
      showToast({
        tone: "warning",
        title: "과목명을 입력해 주세요.",
        message: "평가 반영 비율을 저장하려면 과목명이 필요합니다.",
      });
      return;
    }

    const validItems = items.map((item) => ({
      ...item,
      name: normalizeKoreanText(item.name).trim(),
    }));
    if (
      validItems.length === 0 ||
      validItems.some(
        (item) =>
          !item.name ||
          !Number.isFinite(item.maxScore) ||
          item.maxScore <= 0 ||
          !Number.isFinite(item.ratio) ||
          item.ratio <= 0,
      )
    ) {
      showToast({
        tone: "warning",
        title: "평가 항목을 확인해 주세요.",
        message: "모든 평가 항목의 이름, 만점, 반영 비율을 입력해 주세요.",
      });
      return;
    }

    const totalRatio = validItems.reduce((sum, i) => sum + i.ratio, 0);
    if (Math.abs(totalRatio - 100) > 0.000001) {
      showToast({
        tone: "warning",
        title: "비율 합계를 확인해 주세요.",
        message: `비율 합계는 100%여야 합니다. 현재 ${totalRatio}%입니다.`,
      });
      return;
    }

    const scope = getYearSemester(userConfig);
    const data = {
      subject: normalizeKoreanText(subject).trim(),
      targetGrade: grade,
      items: validItems,
      academicYear: scope.year,
      semester: scope.semester,
      updatedAt: serverTimestamp(),
    };

    setSaving(true);
    try {
      if (editId) {
        await updateDoc(
          doc(db, getSemesterDocPath(userConfig, "grading_plans", editId)),
          data,
        );
        showToast({
          tone: "success",
          title: "수정되었습니다.",
          message: "평가 반영 비율을 업데이트했습니다.",
        });
      } else {
        await addDoc(
          collection(
            db,
            getSemesterCollectionPath(userConfig, "grading_plans"),
          ),
          {
            ...data,
            createdAt: serverTimestamp(),
          },
        );
        showToast({
          tone: "success",
          title: "저장되었습니다.",
          message: "평가 반영 비율을 추가했습니다.",
        });
      }
      resetForm();
      await loadPlans();
    } catch (e) {
      console.error(e);
      showToast({
        tone: "error",
        title: "저장에 실패했습니다.",
        message:
          (e as { code?: string }).code === "permission-denied"
            ? "평가 기준을 저장할 교사 권한을 확인해 주세요. 입력 내용은 유지됩니다."
            : "입력 내용은 유지됩니다. 연결 상태를 확인한 뒤 다시 저장해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const buildDraftPreviewPlan = (): Omit<GradingPlan, "id"> => ({
    subject: normalizeKoreanText(subject).trim() || "미리보기 과목",
    targetGrade: grade,
    items: items.map((item, idx) => ({
      ...item,
      name: normalizeKoreanText(item.name).trim() || `${idx + 1}번 항목`,
      maxScore: Number(item.maxScore || 0),
      ratio: Number(item.ratio || 0),
    })),
    academicYear: getYearSemester(userConfig).year,
    semester: getYearSemester(userConfig).semester,
  });

  const openPreview = (plan?: GradingPlan) => {
    const nextPlan = plan
      ? {
          subject: plan.subject,
          targetGrade: plan.targetGrade || grade,
          items: (plan.items || []).map((item, idx) => ({
            ...item,
            name: item.name || `${idx + 1}번 항목`,
            maxScore: Number(item.maxScore || 0),
            ratio: Number(item.ratio || 0),
          })),
          academicYear: plan.academicYear,
          semester: plan.semester,
        }
      : buildDraftPreviewPlan();
    setPreviewPlan(nextPlan);
    setPreviewScores({});
    setPreviewActiveType(null);
    setPreviewOpen(true);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewPlan(null);
    setPreviewScores({});
    setPreviewActiveType(null);
  };

  const resetForm = () => {
    setEditId(null);
    setGrade("3");
    setSubject("");
    setItems([{ type: "정기", name: "", maxScore: 0, ratio: 0 }]);
  };

  const handleEdit = (p: GradingPlan) => {
    if (saving) return;
    setEditId(p.id);
    setSubject(normalizeKoreanText(p.subject));
    setGrade(p.targetGrade || "3");
    setItems(p.items.map((i) => ({ ...i, name: normalizeKoreanText(i.name) })));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      title: "평가 반영 비율을 삭제할까요?",
      message: "삭제한 항목은 다시 불러올 수 없습니다.",
      confirmLabel: "삭제",
      tone: "danger",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(
        doc(db, getSemesterDocPath(userConfig, "grading_plans", id)),
      );
      setPlans(plans.filter((p) => p.id !== id));
      showToast({
        tone: "success",
        title: "삭제되었습니다.",
        message: "평가 반영 비율 항목을 삭제했습니다.",
      });
    } catch (e) {
      console.error(e);
      showToast({
        tone: "error",
        title: "삭제에 실패했습니다.",
        message: "잠시 후 다시 시도해 주세요.",
      });
    }
  };

  const getSortedPlans = () => {
    let sorted = [...plans];
    if (sortMode === "name") {
      sorted.sort((a, b) => a.subject.localeCompare(b.subject));
    } else if (sortMode === "importance") {
      sorted.sort(
        (a, b) =>
          getSubjectPriorityIndex(a.subject) -
            getSubjectPriorityIndex(b.subject) ||
          a.subject.localeCompare(b.subject),
      );
    }
    return sorted;
  };

  const filteredPlans = getSortedPlans().filter(
    (plan) => (plan.targetGrade || "3") === grade,
  );
  const previewValidItems = (previewPlan?.items || []).filter(
    (item) => item.maxScore > 0 && item.ratio > 0,
  );
  const previewRatioTotal = previewValidItems.reduce(
    (sum, item) => sum + Number(item.ratio || 0),
    0,
  );
  const previewRows = previewPlan
    ? buildScoreRows(
        [
          {
            id: "preview-plan",
            ...previewPlan,
            items: previewValidItems,
          },
        ],
        previewScores,
        { filterByGrade: false },
      )
    : [];
  const previewRow = previewRows[0] || null;
  const previewContribution = previewScoreTypes.reduce(
    (acc, type) => {
      acc[type] =
        previewRow?.breakdown
          .filter((item) => item.entered && item.type === type)
          .reduce((sum, item) => sum + Number(item.weighted || 0), 0) || 0;
      return acc;
    },
    { exam: 0, performance: 0, other: 0 } as Record<ScoreItemType, number>,
  );
  const previewTotalScore = Number(previewRow?.total || 0);
  const previewRemainingWidth = Math.max(0, 100 - previewTotalScore);
  const previewEnteredItems =
    previewRow?.breakdown.filter((item) => item.entered) || [];
  const previewActiveMeta = previewActiveType
    ? previewCategoryMeta[previewActiveType]
    : null;

  const draftRatioTotal = items.reduce(
    (sum, item) => sum + (Number.isFinite(item.ratio) ? item.ratio : 0),
    0,
  );
  const draftRatioReady = Math.abs(draftRatioTotal - 100) < 0.000001;
  const draftRatioColors = [
    "var(--ws-primary)",
    "var(--ws-accent)",
    "var(--ws-success)",
    "var(--ws-text-muted)",
    "var(--ws-ring)",
    "var(--ws-accent-text)",
  ];

  return (
    <div className="grading-workspace">
      {previewOpen && previewPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="grading-preview-dialog flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  평가 반영 미리보기
                </h3>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
                aria-label="미리보기 닫기"
              >
                <i className="fas fa-times text-sm" aria-hidden="true"></i>
              </button>
            </div>

            <div className="overflow-y-auto px-5 py-5">
              {previewValidItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-400">
                  만점과 반영 비율을 입력해 주세요.
                </div>
              ) : (
                <div className="grading-preview-columns">
                  <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="text-sm font-black text-slate-800">
                        학생 점수 입력 예시
                      </h4>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-black ${previewRatioTotal === 100 ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-800"}`}
                      >
                        반영 합계 {previewRatioTotal}%
                      </span>
                    </div>
                    <div className="space-y-3">
                      {previewValidItems.map((item, idx) => {
                        const key = getScoreKey("preview-plan", idx);
                        const maxScore = Number(item.maxScore || 0);
                        return (
                          <label
                            key={`${item.name}-${idx}`}
                            className="grading-preview-item block rounded-lg border border-slate-200 bg-white px-3 py-3"
                          >
                            <div className="grading-preview-score-row">
                              <div className="grading-preview-description">
                                <div className="grading-preview-name text-sm font-black text-slate-800">
                                  {item.name || `${idx + 1}번 항목`}
                                </div>
                                <div className="grading-preview-meta text-xs font-bold text-slate-400">
                                  <span>
                                    {getTypeLabel(
                                      normalizePlanItemType(
                                        item.type,
                                        item.name,
                                      ),
                                    )}
                                  </span>
                                  <span>{maxScore}점 만점</span>
                                  <span>{item.ratio}% 반영</span>
                                </div>
                              </div>
                              <input
                                type="number"
                                min={0}
                                max={maxScore}
                                value={previewScores[key] || ""}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  const numeric = Number(raw);
                                  const nextValue =
                                    raw === ""
                                      ? ""
                                      : String(
                                          Math.max(
                                            0,
                                            Math.min(
                                              maxScore,
                                              Number.isFinite(numeric)
                                                ? numeric
                                                : 0,
                                            ),
                                          ),
                                        );
                                  setPreviewScores((prev) => ({
                                    ...prev,
                                    [key]: nextValue,
                                  }));
                                }}
                                placeholder="점수"
                                aria-label={
                                  (item.name || `${idx + 1}번 항목`) + " 점수"
                                }
                                className="grading-preview-score-input rounded-lg border border-slate-300 px-3 py-2 text-center text-sm font-bold focus:border-blue-500 focus:outline-none"
                              />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </section>

                  <section className="rounded-xl border border-slate-200 bg-white p-4">
                    <div className="grading-preview-graph-heading mb-4">
                      <div>
                        <h4 className="text-sm font-black text-slate-800">
                          실시간 반영 그래프
                        </h4>
                      </div>
                      <div className="text-right">
                        <div className="grading-score-help-label text-xs font-bold text-slate-400">
                          환산 점수
                          <GradingScoreHelp subject={previewPlan.subject} />
                        </div>
                        <div className="text-3xl font-black text-blue-600">
                          {formatPreviewScore(previewTotalScore)}
                        </div>
                      </div>
                    </div>
                    <div className="mb-4 flex flex-wrap gap-3">
                      {previewScoreTypes.map((type) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-2 text-xs font-bold text-slate-600"
                        >
                          <span
                            className={`h-3 w-3 rounded-full ${previewCategoryMeta[type].dotClass}`}
                          />
                          {previewCategoryMeta[type].label}
                        </span>
                      ))}
                    </div>

                    <div className="rounded-xl border border-slate-100 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate text-base font-black text-slate-900">
                          {previewPlan.subject}
                        </span>
                        <span className="shrink-0 text-xl font-black text-blue-600">
                          {formatPreviewScore(previewTotalScore)}
                        </span>
                      </div>

                      <div
                        className="relative"
                        onMouseLeave={() => setPreviewActiveType(null)}
                      >
                        <div className="flex h-6 w-full overflow-hidden rounded-full bg-slate-200">
                          {previewScoreTypes.map((type) => {
                            const value = previewContribution[type];
                            if (value <= 0) return null;
                            return (
                              <span
                                key={type}
                                role="button"
                                tabIndex={0}
                                aria-label={`${previewCategoryMeta[type].label} ${formatPreviewScore(value)}`}
                                onMouseEnter={() => setPreviewActiveType(type)}
                                onFocus={() => setPreviewActiveType(type)}
                                onClick={() => setPreviewActiveType(type)}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === " "
                                  ) {
                                    event.preventDefault();
                                    setPreviewActiveType(type);
                                  }
                                }}
                                className={`${previewCategoryMeta[type].barClass} min-w-[3px] border-r-2 border-white outline-none transition hover:brightness-105 focus:ring-2 focus:ring-blue-300`}
                                style={{ width: `${Math.min(100, value)}%` }}
                              />
                            );
                          })}
                          {previewRemainingWidth > 0 && (
                            <span
                              className="bg-slate-200"
                              style={{ width: `${previewRemainingWidth}%` }}
                            />
                          )}
                        </div>

                        {previewActiveType && (
                          <div className="absolute left-1/2 top-8 z-20 w-60 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-2 font-bold text-slate-700">
                                <span
                                  className={`h-2.5 w-2.5 rounded-full ${previewCategoryMeta[previewActiveType].dotClass}`}
                                />
                                {previewCategoryMeta[previewActiveType].label}
                              </span>
                              <span className="font-black text-slate-900">
                                {formatPreviewScore(
                                  previewContribution[previewActiveType],
                                )}
                              </span>
                            </div>
                            <div className="mt-3 flex items-end justify-between border-t border-slate-100 pt-3">
                              <span className="font-bold text-slate-500">
                                현재 점수
                              </span>
                              <span className="text-xl font-black text-slate-900">
                                {formatPreviewScore(previewTotalScore)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        {previewScoreTypes.map((type) => {
                          const value = previewContribution[type];
                          const percent =
                            previewTotalScore > 0
                              ? (value / previewTotalScore) * 100
                              : 0;
                          return (
                            <div
                              key={type}
                              className="rounded-lg bg-slate-50 px-3 py-2"
                            >
                              <div
                                className={`text-xs font-black ${previewCategoryMeta[type].textClass}`}
                              >
                                {previewCategoryMeta[type].label}
                              </div>
                              <div className="mt-1 flex items-end justify-between gap-2">
                                <span className="text-sm font-black text-slate-900">
                                  {formatPreviewScore(value)}
                                </span>
                                <span className="text-[11px] font-extrabold text-slate-500">
                                  {formatPreviewPercent(percent)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {previewEnteredItems.map((item) => (
                          <span
                            key={item.key}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600"
                          >
                            {previewCategoryMeta[item.type].shortLabel} ·{" "}
                            {item.name} · {formatPreviewScore(item.weighted)}{" "}
                            반영
                          </span>
                        ))}
                      </div>
                    </div>

                    {previewRatioTotal !== 100 && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">
                        저장하려면 반영 비율 합계가 100%여야 합니다.
                      </div>
                    )}
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <section
        className="grading-editor"
        aria-labelledby="grading-editor-title"
      >
        <div className="grading-editor__header">
          <div>
            <h3 id="grading-editor-title">
              {editId ? "평가 기준 수정" : "평가 기준 등록"}
            </h3>
          </div>
          <button
            type="button"
            onClick={resetForm}
            disabled={saving}
            className="grading-editor__reset"
          >
            초기화
          </button>
        </div>
        <fieldset disabled={saving} className="grading-editor__fields">
          <legend className="sr-only">평가 기준 입력</legend>
          <div className="grading-editor__identity">
            <label className="grading-editor__field">
              <span>대상 학년</span>
              <select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
              </select>
            </label>
            <label className="grading-editor__field">
              <span>과목명</span>
              <KoreanTextInput
                type="text"
                value={subject}
                onValueChange={setSubject}
                placeholder="예: 국어, 역사, 사회"
                {...koreanInputProps}
              />
            </label>
          </div>
          <div className="grading-editor__items-heading">
            <h4>평가 항목</h4>
            <span>{items.length}개 항목</span>
          </div>
          <div className="grading-editor__ratio" data-ready={draftRatioReady}>
            <div className="grading-editor__ratio-text" aria-live="polite">
              <span>
                반영 비율 합계{" "}
                <strong>{formatPreviewNumber(draftRatioTotal)}%</strong>
              </span>
              <span>
                {draftRatioReady
                  ? "100% 설정 완료"
                  : draftRatioTotal > 100
                    ? formatPreviewNumber(draftRatioTotal - 100) + "% 초과"
                    : formatPreviewNumber(100 - draftRatioTotal) + "% 남음"}
              </span>
            </div>
            <div className="grading-editor__ratio-track" aria-hidden="true">
              {items.map((item, idx) => (
                <span
                  key={idx}
                  style={{
                    width:
                      Math.max(0, Math.min(100, Number(item.ratio) || 0)) + "%",
                    background: draftRatioColors[idx % draftRatioColors.length],
                  }}
                />
              ))}
            </div>
          </div>
          <div className="grading-editor__items">
            {items.map((item, idx) => (
              <div
                key={idx}
                className="grading-editor__item"
                role="group"
                aria-label={"평가 항목 " + (idx + 1)}
              >
                <div className="grading-editor__item-heading">
                  <span>
                    <i
                      style={{
                        background:
                          draftRatioColors[idx % draftRatioColors.length],
                      }}
                      aria-hidden="true"
                    />
                    {"항목 " + (idx + 1)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(idx)}
                    aria-label={"평가 항목 " + (idx + 1) + " 삭제"}
                    className="grading-editor__remove"
                  >
                    삭제
                  </button>
                </div>
                <label className="grading-editor__field">
                  <span>영역명</span>
                  <KoreanTextInput
                    type="text"
                    placeholder="예: 서술형, 발표, 포트폴리오"
                    value={item.name}
                    onValueChange={(value) =>
                      handleItemChange(idx, "name", value)
                    }
                    {...koreanInputProps}
                  />
                </label>
                <div className="grading-editor__item-values">
                  <label className="grading-editor__field grading-editor__type">
                    <span>평가 유형</span>
                    <select
                      value={item.type}
                      onChange={(e) =>
                        handleItemChange(
                          idx,
                          "type",
                          e.target.value as GradingItem["type"],
                        )
                      }
                    >
                      <option value="정기">정기시험</option>
                      <option value="수행">수행평가</option>
                    </select>
                  </label>
                  <label className="grading-editor__field">
                    <span>만점</span>
                    <span className="grading-editor__number">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        placeholder="만점"
                        value={item.maxScore || ""}
                        onChange={(e) =>
                          handleItemChange(
                            idx,
                            "maxScore",
                            Number(e.target.value),
                          )
                        }
                      />
                      <span aria-hidden="true">점</span>
                    </span>
                  </label>
                  <label className="grading-editor__field">
                    <span>반영 비율</span>
                    <span className="grading-editor__number">
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        max="100"
                        step="any"
                        placeholder="%"
                        value={item.ratio || ""}
                        onChange={(e) =>
                          handleItemChange(idx, "ratio", Number(e.target.value))
                        }
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAddItem}
            className="grading-editor__add"
          >
            + 항목 추가
          </button>
          <div className="grading-editor__actions">
            <button
              type="button"
              onClick={() => openPreview()}
              className="grading-editor__preview"
            >
              미리보기
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="grading-editor__save"
            >
              {saving ? "저장 중…" : editId ? "수정사항 저장" : "기준 저장하기"}
            </button>
          </div>
        </fieldset>
      </section>

      {/* Right: List */}
      <div className="grading-editor-list">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="font-bold text-gray-700 text-lg">등록된 기준 목록</h3>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-bold">정렬:</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white font-bold text-gray-700 cursor-pointer"
            >
              <option value="latest">등록순 (최신)</option>
              <option value="name">과목명 (가나다)</option>
              <option value="importance">나이스순</option>
            </select>
          </div>
        </div>

        <div
          className="grading-plan-scroll space-y-4"
          role="region"
          aria-label="등록된 평가 기준"
          tabIndex={0}
        >
          {loading ? (
            <div className="text-center p-10 text-gray-400">
              데이터를 불러오는 중...
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="text-center py-20 text-gray-400 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
              등록된 평가 기준이 없습니다.
            </div>
          ) : (
            filteredPlans.map((p) => (
              <div
                key={p.id}
                className="grading-plan-card group relative flex flex-col gap-4 overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md lg:p-5"
              >
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                <div className="min-w-0 flex-1 pl-4">
                  <div className="grading-plan-heading mb-3">
                    <div className="grading-plan-identity">
                      <span className="text-xs font-bold text-white bg-blue-500 px-2.5 py-1 rounded shadow-sm">
                        {p.targetGrade || "3"}학년
                      </span>
                      <h4
                        title={p.subject}
                        className="min-w-0 truncate text-xl font-bold text-gray-800"
                      >
                        {p.subject}
                      </h4>
                    </div>
                    <div className="grading-plan-actions">
                      <button
                        aria-label={`${p.subject} 미리보기`}
                        title="미리보기"
                        onClick={() => openPreview(p)}
                        className="text-emerald-600 hover:bg-emerald-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-emerald-100 shadow-sm"
                      >
                        <i
                          className="fas fa-chart-simple"
                          aria-hidden="true"
                        ></i>
                        <span>미리보기</span>
                      </button>
                      <button
                        aria-label={`${p.subject} 수정`}
                        title="수정"
                        onClick={() => handleEdit(p)}
                        className="text-blue-500 hover:bg-blue-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-blue-100 shadow-sm"
                      >
                        <i className="fas fa-pen" aria-hidden="true"></i>
                        <span>수정</span>
                      </button>
                      <button
                        aria-label={`${p.subject} 삭제`}
                        title="삭제"
                        onClick={() => handleDelete(p.id)}
                        className="text-red-500 hover:bg-red-50 p-2 rounded flex items-center text-xs font-bold bg-white border border-red-100 shadow-sm"
                      >
                        <i className="fas fa-trash" aria-hidden="true"></i>
                        <span>삭제</span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="grading-plan-category">
                      <span className="mt-0.5 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-2 py-1 whitespace-nowrap">
                        정기시험
                      </span>
                      <div className="grading-plan-items">
                        {p.items.filter((i) => isRegularExamItem(i.type))
                          .length === 0 ? (
                          <span className="text-xs text-gray-400 py-1">
                            없음
                          </span>
                        ) : (
                          p.items
                            .filter((i) => isRegularExamItem(i.type))
                            .map((i, idx) => (
                              <span
                                key={`regular-${idx}`}
                                className="grading-plan-chip rounded border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs text-gray-600"
                              >
                                <span className="grading-plan-name font-bold">
                                  {i.name}
                                </span>
                                <span className="text-gray-300 mx-1">|</span>
                                <span className="grading-plan-percent text-blue-600 font-bold">
                                  {i.ratio}%
                                </span>
                              </span>
                            ))
                        )}
                      </div>
                    </div>
                    <div className="grading-plan-category">
                      <span className="mt-0.5 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 whitespace-nowrap">
                        수행평가
                      </span>
                      <div className="grading-plan-items">
                        {p.items.filter((i) => isPerformanceItem(i.type))
                          .length === 0 ? (
                          <span className="text-xs text-gray-400 py-1">
                            없음
                          </span>
                        ) : (
                          p.items
                            .filter((i) => isPerformanceItem(i.type))
                            .map((i, idx) => (
                              <span
                                key={`performance-${idx}`}
                                className="grading-plan-chip rounded border border-gray-200 bg-gray-100 px-3 py-1.5 text-xs text-gray-600"
                              >
                                <span className="grading-plan-name font-bold">
                                  {i.name}
                                </span>
                                <span className="text-gray-300 mx-1">|</span>
                                <span className="grading-plan-percent text-blue-600 font-bold">
                                  {i.ratio}%
                                </span>
                              </span>
                            ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default ExamGradingPlan;
