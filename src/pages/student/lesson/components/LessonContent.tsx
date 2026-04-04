import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAppToast } from "../../../../components/common/AppToastProvider";
import LessonFootnoteDialog from "../../../../components/common/LessonFootnoteDialog";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import LessonWorksheetStage from "../../../../components/common/LessonWorksheetStage";
import { useAuth } from "../../../../contexts/AuthContext";
import { notifyPointsUpdated } from "../../../../lib/appEvents";
import { db } from "../../../../lib/firebase";
import {
  getLessonFootnoteUsageEntries,
  getLessonFootnoteUsageMap,
  getLessonContentSections,
  normalizeLessonData,
  sanitizeLessonFootnoteAnchorKey,
  type LessonData,
  type LessonFootnote,
} from "../../../../lib/lessonData";
import { claimPointActivityReward } from "../../../../lib/points";
import { emitSessionActivity } from "../../../../lib/sessionActivity";
import { getSemesterCollectionPath } from "../../../../lib/semesterScope";

type AnswerStatus = "" | "correct" | "wrong";
type SaveCompletionPopupState = {
  title: string;
  message: string;
  detail?: string;
} | null;

interface LessonContentProps {
  unitId: string | null;
  fallbackTitle?: string | null;
  lessonOverride?: LessonData | null;
  disablePersistence?: boolean;
  fullscreenPreview?: boolean;
  onClosePreview?: () => void;
  allowHiddenAccess?: boolean;
}

const EMPTY_BLANK_LABEL = "빈칸";
const normalizeAnswer = (value: string) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "");
const getInputStatus = (value: string, answer: string): AnswerStatus =>
  !normalizeAnswer(value)
    ? ""
    : normalizeAnswer(value) === normalizeAnswer(answer)
      ? "correct"
      : "wrong";
const getInlineBlankWidth = (answer: string) =>
  Math.min(220, Math.max(76, answer.length * 14 + 24));
const getInlineBlankFontSize = (width: number, textLength: number) =>
  Math.max(11, Math.min(19, (width - 12) / (Math.max(1, textLength) * 0.92)));
const LessonContent: React.FC<LessonContentProps> = ({
  unitId,
  fallbackTitle,
  lessonOverride = null,
  disablePersistence = false,
  fullscreenPreview = false,
  onClosePreview,
  allowHiddenAccess = false,
}) => {
  const { config, currentUser } = useAuth();
  const { showToast } = useAppToast();
  const [lesson, setLesson] = useState<LessonData | null>(
    lessonOverride ? normalizeLessonData(lessonOverride) : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [studentAnswers, setStudentAnswers] = useState<
    Record<string, { value?: string; status?: AnswerStatus }>
  >({});
  const [worksheetScreenOpen, setWorksheetScreenOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveCompletionPopup, setSaveCompletionPopup] =
    useState<SaveCompletionPopupState>(null);
  const [activeFootnote, setActiveFootnote] = useState<LessonFootnote | null>(
    null,
  );
  const [footnotePanelOpen, setFootnotePanelOpen] = useState(false);
  const [activeWorksheetFootnoteAnchorId, setActiveWorksheetFootnoteAnchorId] =
    useState<string | null>(null);
  const [activeFootnoteAnchorKey, setActiveFootnoteAnchorKey] = useState("");
  const [highlightedFootnoteAnchorKey, setHighlightedFootnoteAnchorKey] =
    useState("");

  const contentRef = useRef<HTMLDivElement>(null);
  const footnoteTriggerElementsRef = useRef<
    Record<string, HTMLButtonElement[]>
  >({});
  const footnoteReferenceElementsRef = useRef<
    Record<string, HTMLButtonElement | null>
  >({});
  const highlightTimerRef = useRef<number | null>(null);
  const viewStartedAtRef = useRef(Date.now());
  const interactedRef = useRef(false);
  const canPersist = Boolean(!disablePersistence && currentUser?.uid && unitId);
  const interactiveFootnoteMap = useMemo(() => {
    if (!lesson) return new Map<string, LessonFootnote>();
    const normalized = normalizeLessonData(lesson, {
      title: fallbackTitle || "",
    });
    return new Map(
      normalized.footnotes.map((footnote) => [footnote.anchorKey, footnote]),
    );
  }, [fallbackTitle, lesson]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const normalized = lessonOverride
      ? normalizeLessonData(lessonOverride)
      : null;
    setLesson(normalized);
    setIsBlocked(
      Boolean(
        !allowHiddenAccess &&
        normalized &&
        normalized.isVisibleToStudents === false,
      ),
    );
    setError(false);
    setLoading(false);
    setStudentAnswers({});
    setHasUnsavedChanges(false);
    setSaveMessage("");
    setSaveCompletionPopup(null);
    setActiveFootnote(null);
    setFootnotePanelOpen(false);
    setActiveWorksheetFootnoteAnchorId(null);
    setActiveFootnoteAnchorKey("");
    setHighlightedFootnoteAnchorKey("");
    viewStartedAtRef.current = Date.now();
    interactedRef.current = false;
  }, [allowHiddenAccess, lessonOverride]);

  useEffect(() => {
    if (lessonOverride || !unitId) {
      if (!lessonOverride) setLesson(null);
      return;
    }
    const fetchLesson = async () => {
      setLoading(true);
      setError(false);
      setIsBlocked(false);
      try {
        const semesterQuery = query(
          collection(db, getSemesterCollectionPath(config, "lessons")),
          where("unitId", "==", unitId),
          limit(1),
        );
        let snap = await getDocs(semesterQuery);
        if (snap.empty)
          snap = await getDocs(
            query(
              collection(db, "lessons"),
              where("unitId", "==", unitId),
              limit(1),
            ),
          );
        if (!snap.empty) {
          const data = normalizeLessonData(snap.docs[0].data(), {
            unitId,
            title: fallbackTitle || "",
          });
          setLesson(data);
          setIsBlocked(
            !allowHiddenAccess && data.isVisibleToStudents === false,
          );
        } else {
          setLesson(null);
        }
        setStudentAnswers({});
        setHasUnsavedChanges(false);
        setSaveMessage("");
        setSaveCompletionPopup(null);
        setActiveFootnote(null);
        setFootnotePanelOpen(false);
        setActiveWorksheetFootnoteAnchorId(null);
        setActiveFootnoteAnchorKey("");
        setHighlightedFootnoteAnchorKey("");
        viewStartedAtRef.current = Date.now();
        interactedRef.current = false;
      } catch (fetchError) {
        console.error("Error fetching lesson:", fetchError);
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    void fetchLesson();
  }, [allowHiddenAccess, config, fallbackTitle, lessonOverride, unitId]);

  const getProgressRef = () => {
    if (!canPersist || !currentUser?.uid || !unitId) return null;
    return doc(
      db,
      `${getSemesterCollectionPath(config, "lesson_progress")}/${currentUser.uid}/units/${unitId}`,
    );
  };

  const getAnswerSnapshot = () => {
    const container = contentRef.current;
    if (!container) {
      return {
        answers: {} as Record<string, { value: string; status: AnswerStatus }>,
        totalCount: 0,
        filledCount: 0,
      };
    }
    const inputs = container.querySelectorAll(
      ".cloze-input, .worksheet-blank-input",
    ) as NodeListOf<HTMLInputElement>;
    const answers: Record<string, { value: string; status: AnswerStatus }> = {};
    let filledCount = 0;
    inputs.forEach((input, index) => {
      const key =
        input.dataset.blankId || input.dataset.blankIndex || String(index);
      const status: AnswerStatus = input.classList.contains("correct")
        ? "correct"
        : input.classList.contains("wrong")
          ? "wrong"
          : "";
      const value = input.value || "";
      if (value.trim()) {
        filledCount += 1;
      }
      answers[key] = { value, status };
    });
    return {
      answers,
      totalCount: inputs.length,
      filledCount,
    };
  };

  const saveProgressToFirestore = async () => {
    const progressRef = getProgressRef();
    if (!progressRef || !currentUser?.uid || !unitId) return;
    const answerSnapshot = getAnswerSnapshot();
    const isWorksheetCompleted =
      answerSnapshot.totalCount > 0 &&
      answerSnapshot.filledCount === answerSnapshot.totalCount;
    try {
      emitSessionActivity();
      setIsSaving(true);
      await setDoc(
        progressRef,
        {
          userId: currentUser.uid,
          unitId,
          answers: answerSnapshot.answers,
          annotations: deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setHasUnsavedChanges(false);
      setSaveMessage("저장됨");
      let toastTitle = "수업 자료 저장 완료";
      let toastMessage = isWorksheetCompleted
        ? "모든 빈칸 입력 내용이 저장되었습니다."
        : "현재 입력 내용이 저장되었습니다.";
      let awardedPointAmount = 0;
      if (lesson && interactedRef.current && unitId) {
        const elapsedMs = Date.now() - viewStartedAtRef.current;
        if (elapsedMs >= 30000) {
          try {
            const pointResult = await claimPointActivityReward({
              config,
              activityType: "lesson",
              sourceId: `lesson-${unitId}`,
              sourceLabel: lesson.title || "수업 자료 학습",
            });
            if (pointResult.awarded && pointResult.amount > 0) {
              awardedPointAmount =
                Number(pointResult.totalAwarded || pointResult.amount) || 0;
              notifyPointsUpdated();
              toastTitle = "수업 자료 저장 완료";
              toastMessage = `입력 내용이 저장되고 +${awardedPointAmount}위스가 지급되었습니다.`;
            }
          } catch (pointError) {
            console.error("Failed to claim lesson point reward:", pointError);
            toastTitle = "수업 자료 저장 완료";
            toastMessage =
              "입력 내용은 저장됐지만 위스 반영 상태를 바로 확인하지 못했습니다.";
          }
        }
      }
      setSaveCompletionPopup(null);
      showToast({
        tone: awardedPointAmount > 0 ? "success" : "info",
        title: toastTitle,
        message: toastMessage,
      });
    } catch (saveError) {
      console.error("Failed to save lesson progress:", saveError);
      setSaveMessage("저장 실패");
      setSaveCompletionPopup(null);
      showToast({
        tone: "error",
        title: "수업 자료 저장에 실패했습니다.",
        message: "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAction = () => {
    if (!isSaving && hasUnsavedChanges) {
      void saveProgressToFirestore();
    }
  };

  const applyHierarchySpacing = (html: string) =>
    html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
      const text = String(inner)
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;|&#160;/g, " ")
        .trim();
      let levelClass = "";
      if (/^\d+\.\s/.test(text)) levelClass = "lesson-level-1";
      else if (/^\d+\)\s/.test(text)) levelClass = "lesson-level-2";
      else if (/^[\u2460-\u2473]\s*/.test(text)) levelClass = "lesson-level-3";
      else if (
        /^[\u2022\u00b7\u25aa\u25e6-]\s/.test(text) ||
        /^\u2192\s*/.test(text)
      )
        levelClass = "lesson-level-4";
      if (!levelClass) return full;
      const classMatch = String(attrs).match(/\bclass=(['"])(.*?)\1/i);
      if (!classMatch) return `<p${attrs} class="${levelClass}">${inner}</p>`;
      const merged = new Set(
        `${classMatch[2]} ${levelClass}`.split(/\s+/).filter(Boolean),
      );
      return `<p${String(attrs).replace(classMatch[0], `class=${classMatch[1]}${Array.from(merged).join(" ")}${classMatch[1]}`)}>${inner}</p>`;
    });

  const renderContent = (
    html: string,
    footnoteNumberMap: Map<string, number>,
    footnoteMap: Map<string, LessonFootnote>,
  ) => {
    let blankIndex = 0;
    return applyHierarchySpacing(html).replace(
      /\[(.*?)\]/g,
      (_match, rawAnswer) => {
        const token = String(rawAnswer || "").trim();
        if (token.startsWith("fn:")) {
          const anchorKey = sanitizeLessonFootnoteAnchorKey(token.slice(3));
          const footnote = footnoteMap.get(anchorKey);
          if (!footnote) {
            return `<span class="lesson-footnote-missing" data-anchor-key="${anchorKey}"></span>`;
          }
          const footnoteNumber = footnoteNumberMap.get(anchorKey) || 0;
          const label =
            footnote.label?.trim() ||
            footnote.title?.trim() ||
            `참고 ${footnoteNumber || ""}`;
          return `<button type="button" class="lesson-footnote-trigger" data-anchor-key="${anchorKey}" aria-label="${label} 보기"><span class="lesson-footnote-trigger__badge">${footnoteNumber || "i"}</span><span class="lesson-footnote-trigger__label">${label}</span></button>`;
        }
        const answer = token;
        const width = getInlineBlankWidth(answer);
        const fontSize = getInlineBlankFontSize(
          width,
          EMPTY_BLANK_LABEL.length,
        );
        const index = blankIndex++;
        return `<input type="text" class="cloze-input" data-answer="${answer}" data-blank-index="${index}" placeholder="${EMPTY_BLANK_LABEL}" autocomplete="off" style="width:${width}px; --blank-font-size:${fontSize}px;" />`;
      },
    );
  };

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleInput = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (
        !target ||
        (!target.classList.contains("cloze-input") &&
          !target.classList.contains("worksheet-blank-input"))
      )
        return;
      const status = getInputStatus(target.value, target.dataset.answer || "");
      target.classList.toggle("correct", status === "correct");
      target.classList.toggle("wrong", status === "wrong");
      interactedRef.current = true;
      setHasUnsavedChanges(true);
      setSaveMessage("저장 필요");
    };
    container.addEventListener("input", handleInput);
    return () => container.removeEventListener("input", handleInput);
  }, [lesson?.contentHtml, lesson?.worksheetBlanks]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const handleClick = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const trigger = target?.closest(
        ".lesson-footnote-trigger",
      ) as HTMLElement | null;
      if (!trigger) return;
      const anchorKey = sanitizeLessonFootnoteAnchorKey(
        trigger.dataset.anchorKey || "",
      );
      if (!anchorKey) return;
      openFootnote(anchorKey, "trigger");
    };
    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [interactiveFootnoteMap]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const triggerMap: Record<string, HTMLButtonElement[]> = {};
    const triggers = Array.from(
      container.querySelectorAll(".lesson-footnote-trigger"),
    ) as HTMLButtonElement[];
    triggers.forEach((trigger) => {
      const anchorKey = sanitizeLessonFootnoteAnchorKey(
        trigger.dataset.anchorKey || "",
      );
      if (!anchorKey) return;
      triggerMap[anchorKey] = [...(triggerMap[anchorKey] || []), trigger];
      const isActive = anchorKey === activeFootnoteAnchorKey;
      const isHighlighted = anchorKey === highlightedFootnoteAnchorKey;
      trigger.classList.toggle("is-active", isActive);
      trigger.classList.toggle("is-highlighted", isHighlighted);
    });
    footnoteTriggerElementsRef.current = triggerMap;
  }, [activeFootnoteAnchorKey, highlightedFootnoteAnchorKey, lesson]);

  useEffect(() => {
    if (!canPersist || !lesson) return;
    const restoreProgress = async () => {
      const progressRef = getProgressRef();
      const container = contentRef.current;
      if (!progressRef || !container) return;
      try {
        const snap = await getDoc(progressRef);
        if (!snap.exists()) return;
        const data = snap.data() as {
          answers?: Record<string, { value?: string; status?: AnswerStatus }>;
        };
        const answers = data.answers || {};
        setStudentAnswers(answers);
        setHasUnsavedChanges(false);
        setSaveMessage("");
        const inputs = container.querySelectorAll(
          ".cloze-input, .worksheet-blank-input",
        ) as NodeListOf<HTMLInputElement>;
        inputs.forEach((input, index) => {
          const key =
            input.dataset.blankId || input.dataset.blankIndex || String(index);
          const saved = answers[key];
          if (!saved) return;
          input.value = saved.value || "";
          input.classList.remove("correct", "wrong");
          if (saved.status) input.classList.add(saved.status);
        });
      } catch (restoreError) {
        console.error("Failed to restore lesson progress:", restoreError);
      }
    };
    const { bodyHtml, worksheet } = getLessonContentSections(lesson);
    if ((!bodyHtml && !worksheet.blanks.length) || !unitId || !currentUser?.uid)
      return;
    void restoreProgress();
  }, [canPersist, currentUser?.uid, lesson, unitId]);

  const handleReset = () => {
    if (!contentRef.current) return;
    if (!window.confirm("입력 내용을 모두 지울까요?")) return;
    const inputs = contentRef.current.querySelectorAll(
      ".cloze-input, .worksheet-blank-input",
    ) as NodeListOf<HTMLInputElement>;
    const nextAnswers: Record<
      string,
      { value?: string; status?: AnswerStatus }
    > = {};
    inputs.forEach((input, index) => {
      const key =
        input.dataset.blankId || input.dataset.blankIndex || String(index);
      input.value = "";
      input.classList.remove("correct", "wrong");
      nextAnswers[key] = { value: "", status: "" };
    });
    setStudentAnswers(nextAnswers);
    setHasUnsavedChanges(true);
    setSaveMessage("저장 필요");
    setSaveCompletionPopup(null);
  };

  const handleWorksheetAnswerChange = (
    blankId: string,
    value: string,
    answer: string,
  ) => {
    setStudentAnswers((prev) => ({
      ...prev,
      [blankId]: { value, status: getInputStatus(value, answer) },
    }));
    interactedRef.current = true;
    setHasUnsavedChanges(true);
    setSaveMessage("저장 필요");
    setSaveCompletionPopup(null);
  };

  if (!unitId && !lessonOverride)
    return (
      <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
        <div className="mb-4 text-6xl">📚</div>
        <h2 className="text-xl font-bold text-gray-700">
          학습할 단원을 선택해 주세요.
        </h2>
      </div>
    );
  if (loading)
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 backdrop-blur-sm">
        <div className="rounded-2xl bg-white px-6 py-5 text-center shadow-2xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <i className="fas fa-spinner fa-spin text-xl"></i>
          </div>
          <div className="text-sm font-bold text-gray-800">
            수업 자료를 불러오는 중입니다.
          </div>
        </div>
      </div>
    );
  if (error || !lesson)
    return (
      <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
        <div className="mb-4 text-6xl text-gray-200">📄</div>
        <h2 className="text-xl font-bold text-gray-500">
          수업 자료를 찾을 수 없습니다.
        </h2>
      </div>
    );
  if (isBlocked)
    return (
      <div className="flex h-full flex-col items-center justify-center py-32 text-center animate-fadeIn">
        <div className="mb-4 text-6xl text-amber-400">🔒</div>
        <h2 className="text-xl font-bold text-gray-700">
          아직 학생에게 공개되지 않았습니다.
        </h2>
      </div>
    );

  const normalizedLesson = normalizeLessonData(lesson, {
    title: fallbackTitle || "",
  });
  const { bodyHtml, footnotes, worksheet } =
    getLessonContentSections(normalizedLesson);
  const footnoteUsageEntries = getLessonFootnoteUsageEntries(
    bodyHtml,
    footnotes,
  );
  const footnoteUsageMap = getLessonFootnoteUsageMap(bodyHtml, footnotes);
  const linkedFootnotes = footnoteUsageEntries.map((usage) => usage.footnote);
  const footnoteMap = new Map(
    footnotes.map((footnote) => [footnote.anchorKey, footnote]),
  );
  const footnoteByIdMap = new Map(
    footnotes.map((footnote) => [footnote.id, footnote]),
  );
  const footnoteNumberMap = new Map(
    linkedFootnotes.map((footnote, index) => [footnote.anchorKey, index + 1]),
  );
  const activeFootnoteBadgeLabel = activeFootnote
    ? footnoteNumberMap.get(activeFootnote.anchorKey)
      ? `#${footnoteNumberMap.get(activeFootnote.anchorKey)}`
      : worksheet.footnoteAnchors.some(
            (anchor) => anchor.footnoteId === activeFootnote.id,
          )
        ? "PDF"
        : null
    : null;
  const embedUrl = normalizedLesson.videoUrl
    ? normalizedLesson.videoUrl.match(
        /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/,
      ) && RegExp.$2.length === 11
      ? `https://www.youtube.com/embed/${RegExp.$2}`
      : null
    : null;
  const hasInteractiveBlanks = Boolean(
    worksheet.blanks.length || /\[(?!fn:)(.*?)\]/.test(bodyHtml),
  );

  const focusReferenceCard = (anchorKey: string) => {
    window.requestAnimationFrame(() => {
      footnoteReferenceElementsRef.current[anchorKey]?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    });
  };

  const focusTrigger = (anchorKey: string) => {
    window.requestAnimationFrame(() => {
      const trigger = footnoteTriggerElementsRef.current[anchorKey]?.[0];
      trigger?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    });
  };

  const pulseFootnote = (anchorKey: string) => {
    setHighlightedFootnoteAnchorKey(anchorKey);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedFootnoteAnchorKey("");
    }, 1800);
  };

  const openFootnote = (anchorKey: string, source: "trigger" | "reference") => {
    const footnote = interactiveFootnoteMap.get(anchorKey);
    if (!footnote) return;
    setActiveFootnote(footnote);
    setActiveFootnoteAnchorKey(anchorKey);
    setActiveWorksheetFootnoteAnchorId(null);
    setFootnotePanelOpen(true);
    pulseFootnote(anchorKey);
    if (source === "trigger") {
      focusReferenceCard(anchorKey);
      return;
    }
    focusTrigger(anchorKey);
  };

  const openWorksheetFootnoteAnchor = (anchorId: string) => {
    const anchor = worksheet.footnoteAnchors.find(
      (item) => item.id === anchorId,
    );
    if (!anchor) return;
    const footnote = footnoteByIdMap.get(anchor.footnoteId);
    if (!footnote) return;
    setActiveFootnote(footnote);
    setActiveWorksheetFootnoteAnchorId(anchorId);
    setActiveFootnoteAnchorKey(footnote.anchorKey || "");
    setFootnotePanelOpen(true);
    if (footnote.anchorKey) {
      pulseFootnote(footnote.anchorKey);
    }
  };
  const saveStatusToneClass = isSaving
    ? "bg-blue-50 text-blue-700"
    : hasUnsavedChanges
      ? "bg-amber-50 text-amber-700"
      : saveMessage === "저장됨"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-slate-100 text-slate-500";
  const saveStatusLabel = isSaving
    ? "저장 중..."
    : saveMessage || (hasUnsavedChanges ? "저장 필요" : "저장 대기");
  const floatingSaveButtonLabel = isSaving
    ? "저장 중..."
    : hasUnsavedChanges
      ? "저장"
      : "저장됨";
  const floatingSaveControls = canPersist ? (
    <div
      className={
        fullscreenPreview
          ? "pointer-events-none sticky top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-[70] mb-4 flex justify-end px-1"
          : "pointer-events-none fixed right-4 top-[calc(env(safe-area-inset-top,0px)+5rem)] z-[70] flex flex-col items-end gap-2 md:right-6 md:top-[5.5rem]"
      }
    >
      <div className="flex flex-col items-end gap-2">
        <div
          aria-live="polite"
          className={`pointer-events-auto rounded-full px-4 py-2 text-xs font-bold shadow-sm ${saveStatusToneClass}`}
        >
          {saveStatusLabel}
        </div>
        <button
          type="button"
          onClick={handleSaveAction}
          disabled={isSaving || !hasUnsavedChanges}
          data-session-action="true"
          className={`pointer-events-auto inline-flex min-h-14 items-center gap-3 rounded-full px-5 text-sm font-bold shadow-[0_18px_38px_rgba(15,23,42,0.18)] transition focus-visible:outline-none focus-visible:ring-4 ${
            isSaving
              ? "bg-blue-600 text-white focus-visible:ring-blue-100"
              : hasUnsavedChanges
                ? "bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-100"
                : "cursor-default border border-emerald-200 bg-white text-emerald-700 focus-visible:ring-emerald-100"
          }`}
          aria-label={floatingSaveButtonLabel}
        >
          <i
            className={`fas ${
              isSaving
                ? "fa-spinner fa-spin"
                : hasUnsavedChanges
                  ? "fa-floppy-disk"
                  : "fa-check"
            } text-sm`}
          ></i>
          <span>{floatingSaveButtonLabel}</span>
        </button>
      </div>
    </div>
  ) : null;

  const content = (
    <div
      className={
        fullscreenPreview
          ? "mx-auto w-full max-w-[min(100vw-1.5rem,1600px)] animate-fadeIn"
          : "mx-auto max-w-4xl animate-fadeIn"
      }
    >
      {floatingSaveControls}
      <div
        className={`rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur ${fullscreenPreview ? "p-4 md:p-5" : "mb-6 p-5 md:p-7"}`}
      >
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <h1 className="min-w-0 flex-1 text-2xl font-extrabold leading-tight text-slate-900 md:text-3xl">
            {normalizedLesson.title || fallbackTitle || "제목 없음"}
          </h1>
          {fullscreenPreview && onClosePreview && (
            <button
              type="button"
              onClick={onClosePreview}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <i className="fas fa-times text-xs"></i>닫기
            </button>
          )}
        </div>

        {embedUrl && (
          <div
            className="relative mb-6 h-0 overflow-hidden rounded-2xl bg-black shadow-md"
            style={{ paddingBottom: "56.25%" }}
          >
            <iframe
              className="absolute left-0 top-0 h-full w-full"
              src={embedUrl}
              frameBorder="0"
              allowFullScreen
              title="Lesson Video"
            />
          </div>
        )}

        <div
          ref={contentRef}
          className={canPersist ? "space-y-6 pt-16 md:pt-[4.5rem]" : "space-y-6"}
        >
          {!!worksheet.pageImages.length &&
            (fullscreenPreview ? (
              <LessonWorksheetStage
                pageImages={worksheet.pageImages}
                blanks={worksheet.blanks}
                textRegions={worksheet.textRegions}
                footnoteAnchors={worksheet.footnoteAnchors}
                selectedFootnoteAnchorId={activeWorksheetFootnoteAnchorId}
                footnoteTitles={Object.fromEntries(
                  footnotes.map((footnote) => [
                    footnote.id,
                    footnote.title || footnote.label || "각주",
                  ]),
                )}
                onActivateFootnoteAnchor={openWorksheetFootnoteAnchor}
                mode="student-solve"
                studentAnswers={studentAnswers}
                onStudentAnswerChange={handleWorksheetAnswerChange}
                annotationEnabled={false}
              />
            ) : (
              <button
                type="button"
                onClick={() => setWorksheetScreenOpen(true)}
                className="group block w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white text-left shadow-sm transition hover:border-blue-300 hover:shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <div className="text-sm font-bold text-slate-800">
                      PDF 학습지 열기
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      빈칸 풀이와 각주 확인은 전체 화면에서 이어집니다.
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-600">
                    <i className="fas fa-expand text-[11px]"></i>
                    {worksheet.pageImages.length} page
                  </div>
                </div>
                <div className="bg-[radial-gradient(circle_at_top,_rgba(239,246,255,0.96),_rgba(248,250,252,0.98)_58%,_rgba(241,245,249,1)_100%)] p-4">
                  <img
                    src={worksheet.pageImages[0]?.imageUrl}
                    alt="학습지 미리보기"
                    className="mx-auto max-h-[26rem] w-auto rounded-2xl border border-slate-200 bg-white shadow-sm transition group-hover:scale-[1.01]"
                  />
                </div>
              </button>
            ))}

          {!!bodyHtml && (
            <section
              className="note-content prose prose-blue max-w-none rounded-3xl border border-slate-200 bg-white p-6 leading-loose text-slate-700 shadow-sm md:p-10"
              dangerouslySetInnerHTML={{
                __html: renderContent(bodyHtml, footnoteNumberMap, footnoteMap),
              }}
            />
          )}
          {!!linkedFootnotes.length && (
            <section className="rounded-3xl border border-slate-200 bg-slate-50/80 p-6 shadow-sm">
              <div className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">
                References
              </div>
              <div className="mt-3 space-y-3">
                {linkedFootnotes.map((footnote) => (
                  <button
                    key={footnote.id}
                    type="button"
                    ref={(element) => {
                      footnoteReferenceElementsRef.current[footnote.anchorKey] =
                        element;
                    }}
                    onClick={() =>
                      openFootnote(footnote.anchorKey, "reference")
                    }
                    className={`block w-full rounded-2xl border px-4 py-4 text-left transition hover:shadow-sm ${
                      activeFootnoteAnchorKey === footnote.anchorKey
                        ? "border-blue-300 bg-blue-50 shadow-sm"
                        : highlightedFootnoteAnchorKey === footnote.anchorKey
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-200 bg-white hover:border-blue-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                          activeFootnoteAnchorKey === footnote.anchorKey
                            ? "bg-blue-600 text-white"
                            : "bg-blue-50 text-blue-700"
                        }`}
                      >
                        {footnoteNumberMap.get(footnote.anchorKey)}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-800">
                          {footnote.title ||
                            footnote.label ||
                            (footnoteNumberMap.get(footnote.anchorKey)
                              ? `각주 ${footnoteNumberMap.get(footnote.anchorKey)}`
                              : "각주")}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          눌러서 참고자료 보기
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-slate-200 pt-5">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-xl border-2 border-slate-200 bg-white px-6 py-3 font-bold text-slate-600 shadow-sm transition hover:bg-slate-50"
          >
            <i className="fas fa-undo mr-2"></i>다시 쓰기
          </button>
          {hasInteractiveBlanks && (
            <span className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
              빈칸 입력 시 정답 여부가 바로 표시됩니다.
            </span>
          )}
        </div>

        {saveCompletionPopup && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="lesson-save-completion-title"
              className="w-full max-w-sm rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.2)]"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <i className="fas fa-check text-lg"></i>
              </div>
              <h2
                id="lesson-save-completion-title"
                className="mt-4 text-center text-lg font-bold text-slate-900"
              >
                {saveCompletionPopup.title}
              </h2>
              <p className="mt-2 text-center text-sm leading-6 text-slate-600">
                {saveCompletionPopup.message}
              </p>
              {saveCompletionPopup.detail && (
                <p className="mt-1 text-center text-xs leading-5 text-slate-500">
                  {saveCompletionPopup.detail}
                </p>
              )}
              <button
                type="button"
                onClick={() => setSaveCompletionPopup(null)}
                className="mt-5 inline-flex w-full items-center justify-center rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
              >
                확인
              </button>
            </div>
          </div>
        )}

        <LessonFootnoteDialog
          open={footnotePanelOpen}
          footnote={activeFootnote}
          badgeLabel={activeFootnoteBadgeLabel}
          onClose={() => {
            setFootnotePanelOpen(false);
            setActiveWorksheetFootnoteAnchorId(null);
          }}
        />

        {worksheetScreenOpen && !fullscreenPreview && (
          <div className="fixed inset-0 z-[80] bg-slate-950/80 backdrop-blur-sm">
            <div className="h-full overflow-y-auto">
              <LessonContent
                unitId={unitId}
                fallbackTitle={fallbackTitle}
                lessonOverride={normalizedLesson}
                disablePersistence={disablePersistence}
                fullscreenPreview
                onClosePreview={() => setWorksheetScreenOpen(false)}
                allowHiddenAccess={allowHiddenAccess}
              />
            </div>
          </div>
        )}
      </div>

      <style>{`
                .cloze-input { border: none; border-bottom: 2px solid #334155; text-align: center; font-weight: 700; color: #2563eb; background: transparent; padding: 0 4px; margin: 0 4px; transition: all 0.2s ease; font-size: var(--blank-font-size, 1rem); line-height: 1.2; }
                .cloze-input::placeholder, .worksheet-blank-input::placeholder { color: #94a3b8; opacity: 1; }
                .cloze-input:focus { outline: none; border-bottom-color: #2563eb; background-color: #eff6ff; }
                .cloze-input.correct { border-bottom-color: #22c55e; color: #15803d; background-color: #dcfce7; }
                .cloze-input.wrong { border-bottom-color: #ef4444; color: #b91c1c; background-color: #fee2e2; }
                .worksheet-blank-input { border-radius: 0; }
                .worksheet-blank-input:focus { box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.2); }
                .note-content h1 { margin-top: 1em; margin-bottom: 0.5em; color: #111827; font-size: 1.5em; font-weight: 700; }
                .note-content h2 { margin-top: 1em; margin-bottom: 0.5em; border-left: 4px solid #2563eb; padding-left: 10px; color: #374151; font-size: 1.25em; font-weight: 700; }
                .note-content p { margin-bottom: 1em; white-space: pre-wrap; }
                .note-content p.lesson-level-1 { padding-left: 0.75rem; text-indent: -0.75rem; }
                 .note-content p.lesson-level-2 { padding-left: 2rem; text-indent: -1.2rem; }
                 .note-content p.lesson-level-3 { padding-left: 3.4rem; text-indent: -1.2rem; }
                 .note-content p.lesson-level-4 { padding-left: 4.8rem; text-indent: -1.2rem; }
                 .note-content img { margin: 10px 0; max-width: 100%; border-radius: 8px; }
                 .lesson-footnote-trigger { display: inline-flex; align-items: center; gap: 0.4rem; margin: 0 0.2rem; border: 1px solid #bfdbfe; background: #eff6ff; color: #1d4ed8; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.82rem; font-weight: 700; vertical-align: baseline; transition: transform 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease, border-color 0.18s ease; }
                 .lesson-footnote-trigger:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(37, 99, 235, 0.16); }
                 .lesson-footnote-trigger.is-active { border-color: #2563eb; background: #dbeafe; color: #1d4ed8; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14); }
                 .lesson-footnote-trigger.is-highlighted { border-color: #f59e0b; background: #fef3c7; color: #92400e; }
                 .lesson-footnote-trigger__badge { display: inline-flex; align-items: center; justify-content: center; min-width: 1.3rem; height: 1.3rem; border-radius: 999px; background: #2563eb; color: white; font-size: 0.72rem; }
                 .lesson-footnote-trigger.is-highlighted .lesson-footnote-trigger__badge { background: #f59e0b; }
                 .lesson-footnote-trigger__label { line-height: 1.2; }
                 .lesson-footnote-missing { display: none; }
             `}</style>
    </div>
  );

  return fullscreenPreview ? (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(219,234,254,0.9),_rgba(241,245,249,0.96)_38%,_rgba(226,232,240,1)_100%)] p-2 md:p-4">
      {content}
    </div>
  ) : (
    content
  );
};

export default LessonContent;
