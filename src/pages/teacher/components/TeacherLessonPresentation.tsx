import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import LessonFootnoteDialog from "../../../components/common/LessonFootnoteDialog";
import LessonWorksheetStage, {
  type LessonWorksheetAnnotationState,
} from "../../../components/common/LessonWorksheetStage";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getLessonContentSections,
  type LessonFootnote,
  type LessonData,
} from "../../../lib/lessonData";
import { emitSessionActivity } from "../../../lib/sessionActivity";
import {
  formatTeacherPresentationSavedAt,
  getTeacherPresentationClassDocPath,
  getTeacherPresentationLegacyDocPath,
  getTeacherPresentationRuntimeBadge,
  getTeacherPresentationStatusText,
  getTeacherPresentationWarningState,
  normalizeTeacherPresentationClassContext,
  shouldUseLegacyTeacherPresentationFallback,
  writeRecentTeacherPresentationClass,
  type TeacherPresentationRuntimeStatus,
  type TeacherPresentationSaveState,
} from "../../../lib/teacherPresentation";

export interface TeacherLessonPresentationProps {
  lesson: LessonData;
  fallbackTitle?: string | null;
  fullscreenPreview?: boolean;
  onClosePreview?: () => void;
  classId?: string | null;
  classLabel?: string | null;
  onRuntimeStatusChange?: (status: TeacherPresentationRuntimeStatus) => void;
}

const EMPTY_ANNOTATION_STATE: LessonWorksheetAnnotationState = {
  strokes: [],
  boxes: [],
  textNotes: [],
};

const serializePresentationSnapshot = (
  annotations: LessonWorksheetAnnotationState,
) =>
  JSON.stringify({
    annotations,
  });

const TeacherLessonPresentation: React.FC<TeacherLessonPresentationProps> = ({
  lesson,
  fallbackTitle,
  fullscreenPreview = false,
  onClosePreview,
  classId,
  classLabel,
  onRuntimeStatusChange,
}) => {
  const { config, currentUser } = useAuth();
  const classContext = useMemo(
    () =>
      normalizeTeacherPresentationClassContext({
        classId,
        classLabel,
      }),
    [classId, classLabel],
  );
  const { bodyHtml, footnotes, worksheet } = useMemo(
    () => getLessonContentSections(lesson),
    [lesson],
  );

  const [annotationState, setAnnotationState] =
    useState<LessonWorksheetAnnotationState>(EMPTY_ANNOTATION_STATE);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [saveState, setSaveState] =
    useState<TeacherPresentationSaveState>("restoring");
  const [statusMessage, setStatusMessage] = useState("");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [activeWorksheetFootnote, setActiveWorksheetFootnote] =
    useState<LessonFootnote | null>(null);
  const [activeWorksheetFootnoteAnchorId, setActiveWorksheetFootnoteAnchorId] =
    useState<string | null>(null);
  const [worksheetFootnoteOpen, setWorksheetFootnoteOpen] = useState(false);

  const latestAnnotationRef = useRef(EMPTY_ANNOTATION_STATE);
  const latestPageRef = useRef<number | null>(null);
  const lastSavedAtRef = useRef<Date | null>(null);
  const lastSavedPageRef = useRef<number | null>(null);
  const currentClassLabelRef = useRef(classContext.classLabel);
  const localInteractionSinceRestoreRef = useRef(false);
  const lastSavedSnapshotRef = useRef(
    serializePresentationSnapshot(EMPTY_ANNOTATION_STATE),
  );

  const presentationDocPath = useMemo(() => {
    if (!currentUser?.uid || !lesson.unitId || !classContext.classId) {
      return null;
    }
    return getTeacherPresentationClassDocPath(
      config,
      lesson.unitId,
      currentUser.uid,
      classContext.classId,
    );
  }, [classContext.classId, config, currentUser?.uid, lesson.unitId]);

  const legacyPresentationDocPath = useMemo(() => {
    if (!currentUser?.uid || !lesson.unitId) return null;
    return getTeacherPresentationLegacyDocPath(
      config,
      lesson.unitId,
      currentUser.uid,
    );
  }, [config, currentUser?.uid, lesson.unitId]);

  const hasUnsavedChanges =
    serializePresentationSnapshot(annotationState) !==
    lastSavedSnapshotRef.current;

  const canPersistPresentation = Boolean(
    presentationDocPath && currentUser?.uid && lesson.unitId,
  );
  const footnoteByIdMap = useMemo(
    () => new Map(footnotes.map((footnote) => [footnote.id, footnote])),
    [footnotes],
  );
  const footnoteTitles = useMemo(
    () =>
      footnotes.reduce<Record<string, string>>((accumulator, footnote) => {
        accumulator[footnote.id] =
          footnote.title?.trim() || footnote.label?.trim() || "각주";
        return accumulator;
      }, {}),
    [footnotes],
  );

  const warningState = useMemo(
    () =>
      getTeacherPresentationWarningState({
        saveState,
        hasUnsavedChanges,
        classLabel: classContext.classLabel,
      }),
    [classContext.classLabel, hasUnsavedChanges, saveState],
  );

  const updateStatus = useCallback(
    (
      nextState: TeacherPresentationSaveState,
      nextClassLabel: string,
      savedAt?: Date | null,
    ) => {
      setSaveState(nextState);
      if (!presentationDocPath) {
        setStatusMessage("저장 경로를 확인할 수 없습니다.");
        return;
      }
      setStatusMessage(
        getTeacherPresentationStatusText({
          state: nextState,
          classLabel: nextClassLabel,
          savedAt: savedAt ?? lastSavedAtRef.current,
        }),
      );
    },
    [presentationDocPath],
  );

  const syncRuntimeSummary = useCallback(
    (
      nextState: TeacherPresentationSaveState,
      nextSavedAt: Date | null,
      nextPage: number | null,
      nextHasUnsavedChanges: boolean,
    ) => {
      if (!currentUser?.uid || !lesson.unitId) return;
      writeRecentTeacherPresentationClass({
        teacherUid: currentUser.uid,
        lessonId: lesson.unitId,
        summary: {
          classId: classContext.classId,
          classLabel: classContext.classLabel,
          currentPage: nextPage,
          updatedAt: nextSavedAt,
          lastUsedAt: nextSavedAt,
          hasSavedState: Boolean(nextSavedAt),
          runtimeState: nextState,
          hasUnsavedChanges: nextHasUnsavedChanges,
          statusText: getTeacherPresentationStatusText({
            state: nextState,
            classLabel: classContext.classLabel,
            savedAt: nextSavedAt,
          }),
        },
      });
    },
    [
      classContext.classId,
      classContext.classLabel,
      currentUser?.uid,
      lesson.unitId,
    ],
  );

  const persistPresentation = useCallback(
    async (params?: {
      annotationState?: LessonWorksheetAnnotationState;
      currentPage?: number | null;
    }) => {
      if (!presentationDocPath || !currentUser?.uid || !lesson.unitId) {
        updateStatus("error", currentClassLabelRef.current);
        return false;
      }

      const nextAnnotations =
        params?.annotationState ?? latestAnnotationRef.current;
      const nextPage =
        params?.currentPage === undefined
          ? latestPageRef.current
          : params.currentPage;
      const nextSnapshot = serializePresentationSnapshot(nextAnnotations);

      if (
        nextSnapshot === lastSavedSnapshotRef.current &&
        nextPage === lastSavedPageRef.current
      ) {
        updateStatus(
          lastSavedAtRef.current ? "saved" : "idle",
          currentClassLabelRef.current,
          lastSavedAtRef.current,
        );
        return true;
      }

      updateStatus("saving", currentClassLabelRef.current);

      try {
        await setDoc(
          doc(db, presentationDocPath),
          {
            lessonId: lesson.unitId,
            teacherUid: currentUser.uid,
            classId: classContext.classId,
            classLabel: classContext.classLabel,
            currentPage: nextPage,
            annotations: nextAnnotations,
            updatedAt: serverTimestamp(),
            lastUsedAt: serverTimestamp(),
          },
          { merge: true },
        );

        const savedAt = new Date();
        lastSavedSnapshotRef.current = nextSnapshot;
        lastSavedAtRef.current = savedAt;
        lastSavedPageRef.current = nextPage;
        setLastSavedAt(savedAt);
        syncRuntimeSummary("saved", savedAt, nextPage, false);
        updateStatus("saved", currentClassLabelRef.current, savedAt);
        return true;
      } catch (error) {
        console.error(
          "Failed to save teacher presentation annotations:",
          error,
        );
        syncRuntimeSummary(
          "error",
          lastSavedAtRef.current,
          nextPage,
          true,
        );
        updateStatus("error", currentClassLabelRef.current);
        return false;
      }
    },
    [
      classContext.classId,
      classContext.classLabel,
      currentUser?.uid,
      lesson.unitId,
      presentationDocPath,
      syncRuntimeSummary,
      updateStatus,
    ],
  );

  useEffect(() => {
    currentClassLabelRef.current = classContext.classLabel;
  }, [classContext.classLabel]);

  useEffect(() => {
    latestAnnotationRef.current = annotationState;
  }, [annotationState]);

  useEffect(() => {
    latestPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    lastSavedAtRef.current = lastSavedAt;
  }, [lastSavedAt]);

  useEffect(() => {
    setActiveWorksheetFootnote(null);
    setActiveWorksheetFootnoteAnchorId(null);
    setWorksheetFootnoteOpen(false);
  }, [classContext.classId, lesson.unitId]);

  useEffect(() => {
    onRuntimeStatusChange?.({
      classId: classContext.classId,
      classLabel: classContext.classLabel,
      saveState,
      currentPage,
      lastSavedAt,
      hasUnsavedChanges,
      statusText: statusMessage,
    });
  }, [
    classContext.classId,
    classContext.classLabel,
    currentPage,
    hasUnsavedChanges,
    lastSavedAt,
    onRuntimeStatusChange,
    saveState,
    statusMessage,
  ]);

  useEffect(() => {
    let cancelled = false;

    const applyRestoredState = (
      restoredAnnotations: LessonWorksheetAnnotationState,
      restoredPage: number | null,
      restoredAt: Date | null,
      nextState: TeacherPresentationSaveState,
      nextMessage: string,
    ) => {
      setAnnotationState(restoredAnnotations);
      latestAnnotationRef.current = restoredAnnotations;
      setCurrentPage(restoredPage);
      latestPageRef.current = restoredPage;
      lastSavedAtRef.current = restoredAt;
      lastSavedPageRef.current = restoredPage;
      setLastSavedAt(restoredAt);
      lastSavedSnapshotRef.current = serializePresentationSnapshot(
        restoredAnnotations,
      );
      setRestoreMessage(nextMessage);
      updateStatus(nextState, classContext.classLabel, restoredAt);
      syncRuntimeSummary(
        nextState,
        restoredAt,
        restoredPage,
        nextState === "dirty" || nextState === "error",
      );
    };

    const loadPresentation = async () => {
      localInteractionSinceRestoreRef.current = false;
      const fallbackPage = worksheet.pageImages[0]?.page ?? null;

      if (!presentationDocPath) {
        applyRestoredState(
          EMPTY_ANNOTATION_STATE,
          fallbackPage,
          null,
          "idle",
          "",
        );
        return;
      }

      updateStatus("restoring", classContext.classLabel);
      setRestoreMessage("");

      try {
        const snapshot = await getDoc(doc(db, presentationDocPath));
        if (cancelled || localInteractionSinceRestoreRef.current) return;

        if (snapshot.exists()) {
          const data = snapshot.data() as {
            annotations?: LessonWorksheetAnnotationState;
            currentPage?: number;
            updatedAt?: { toDate?: () => Date };
          };
          const restoredPage =
            data.currentPage &&
            worksheet.pageImages.some((page) => page.page === data.currentPage)
              ? data.currentPage
              : fallbackPage;
          applyRestoredState(
            data.annotations || EMPTY_ANNOTATION_STATE,
            restoredPage,
            data.updatedAt?.toDate?.() || null,
            data.updatedAt?.toDate?.() ? "saved" : "idle",
            `${classContext.classLabel}의 마지막 저장 상태를 불러왔습니다.`,
          );
          return;
        }

        if (
          legacyPresentationDocPath &&
          shouldUseLegacyTeacherPresentationFallback({
            hasClassDocument: false,
          })
        ) {
          const legacySnapshot = await getDoc(doc(db, legacyPresentationDocPath));
          if (cancelled || localInteractionSinceRestoreRef.current) return;
          if (legacySnapshot.exists()) {
            const legacyData = legacySnapshot.data() as {
              annotations?: LessonWorksheetAnnotationState;
              currentPage?: number;
              updatedAt?: { toDate?: () => Date };
            };
            const restoredPage =
              legacyData.currentPage &&
              worksheet.pageImages.some(
                (page) => page.page === legacyData.currentPage,
              )
                ? legacyData.currentPage
                : fallbackPage;
            applyRestoredState(
              legacyData.annotations || EMPTY_ANNOTATION_STATE,
              restoredPage,
              legacyData.updatedAt?.toDate?.() || null,
              "dirty",
              `${classContext.classLabel}에는 저장 기록이 없어 이전 개인 메모를 임시로 불러왔습니다. 저장 버튼을 눌러 현재 반에 보관하세요.`,
            );
            return;
          }
        }

        applyRestoredState(
          EMPTY_ANNOTATION_STATE,
          fallbackPage,
          null,
          "idle",
          `${classContext.classLabel}에는 아직 저장된 수업 메모가 없습니다.`,
        );
      } catch (error) {
        console.error(
          "Failed to restore teacher presentation annotations:",
          error,
        );
        if (cancelled) return;
        setRestoreMessage("");
        updateStatus("error", classContext.classLabel);
      }
    };

    void loadPresentation();

    return () => {
      cancelled = true;
    };
  }, [
    classContext.classLabel,
    legacyPresentationDocPath,
    presentationDocPath,
    syncRuntimeSummary,
    updateStatus,
    worksheet.pageImages,
  ]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!warningState.shouldWarnOnClose) return;
      event.preventDefault();
      event.returnValue = warningState.unloadMessage;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [warningState]);

  const reflectLocalChange = useCallback(
    (
      nextAnnotations: LessonWorksheetAnnotationState,
      nextPage: number | null,
      options?: { clearRestoreMessage?: boolean; markInteraction?: boolean },
    ) => {
      if (options?.markInteraction !== false) {
        localInteractionSinceRestoreRef.current = true;
      }
      latestAnnotationRef.current = nextAnnotations;
      latestPageRef.current = nextPage;
      setAnnotationState(nextAnnotations);
      setCurrentPage(nextPage);

      if (options?.clearRestoreMessage) {
        setRestoreMessage("");
      }

      const nextSnapshot = serializePresentationSnapshot(nextAnnotations);
      const nextState =
        nextSnapshot === lastSavedSnapshotRef.current
          ? lastSavedAtRef.current
            ? "saved"
            : "idle"
          : "dirty";

      updateStatus(
        nextState,
        classContext.classLabel,
        lastSavedAtRef.current,
      );
      syncRuntimeSummary(
        nextState,
        lastSavedAtRef.current,
        nextPage,
        nextState === "dirty",
      );
    },
    [classContext.classLabel, syncRuntimeSummary, updateStatus],
  );

  const handleAnnotationChange = (
    nextState: LessonWorksheetAnnotationState,
  ) => {
    const nextSnapshot = serializePresentationSnapshot(nextState);
    const currentSnapshot = serializePresentationSnapshot(
      latestAnnotationRef.current,
    );
    if (nextSnapshot === currentSnapshot) return;

    reflectLocalChange(nextState, latestPageRef.current, {
      clearRestoreMessage: true,
    });
  };

  const handleTeacherCurrentPageChange = (page: number) => {
    if (latestPageRef.current === page) return;
    reflectLocalChange(latestAnnotationRef.current, page, {
      markInteraction: false,
    });
  };

  const handleManualSave = async () => {
    emitSessionActivity();
    await persistPresentation({
      annotationState: latestAnnotationRef.current,
      currentPage: latestPageRef.current,
    });
  };

  const handleClosePresentation = () => {
    if (
      warningState.shouldWarnOnClose &&
      !window.confirm(warningState.closeMessage)
    ) {
      return;
    }
    onClosePreview?.();
  };

  const handleResetAnnotations = () => {
    if (
      !window.confirm(
        `${classContext.classLabel}의 메모를 모두 지울까요? 저장 버튼을 누르기 전까지는 현재 화면에만 반영됩니다.`,
      )
    ) {
      return;
    }

    reflectLocalChange(
      EMPTY_ANNOTATION_STATE,
      worksheet.pageImages[0]?.page ?? null,
      { clearRestoreMessage: true },
    );
  };

  const handleOpenWorksheetFootnoteAnchor = (anchorId: string) => {
    const anchor = worksheet.footnoteAnchors.find((item) => item.id === anchorId);
    if (!anchor) return;
    const footnote = footnoteByIdMap.get(anchor.footnoteId);
    if (!footnote) return;
    setActiveWorksheetFootnote(footnote);
    setActiveWorksheetFootnoteAnchorId(anchorId);
    setWorksheetFootnoteOpen(true);
  };

  const getVideoEmbedUrl = (url?: string) => {
    if (!url) return null;
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11
      ? `https://www.youtube.com/embed/${match[2]}`
      : null;
  };

  const embedUrl = getVideoEmbedUrl(lesson.videoUrl);
  const lastSavedAtLabel = useMemo(
    () => formatTeacherPresentationSavedAt(lastSavedAt),
    [lastSavedAt],
  );
  const statusBadge = getTeacherPresentationRuntimeBadge({
    runtimeState: saveState,
    hasUnsavedChanges,
    hasSavedState: Boolean(lastSavedAt),
  });
  const statusToneClass =
    statusBadge.tone === "rose"
      ? "bg-rose-50 text-rose-700"
      : statusBadge.tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : statusBadge.tone === "blue"
          ? "bg-blue-50 text-blue-700"
          : "bg-slate-100 text-slate-600";

  const content = (
    <div
      className={
        fullscreenPreview
          ? "mx-auto w-full max-w-[min(100vw-1.5rem,1600px)] animate-fadeIn"
          : "mx-auto max-w-6xl animate-fadeIn"
      }
    >
      <div
        className={`rounded-[28px] border border-white/70 bg-white/95 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur ${
          fullscreenPreview ? "p-4 md:p-4" : "mb-5 p-4 md:p-5"
        }`}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="min-w-0 flex-1">
            <div className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
              교사용 수업 화면
            </div>
            <h1 className="mt-2 text-xl font-extrabold leading-tight text-slate-900 md:text-2xl">
              {lesson.title || fallbackTitle || "제목 없음"}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                현재 반 {classContext.classLabel}
              </div>
              <div className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                현재 페이지 {currentPage ?? worksheet.pageImages[0]?.page ?? "-"}
              </div>
              {lastSavedAt && (
                <div className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  마지막 저장 {lastSavedAtLabel}
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              학생에게 보이지 않는 개인 수업 메모입니다. 변경 후 저장 버튼을 눌러
              보관하세요. 현재 반 기준으로 저장됩니다.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusToneClass}`}
              >
                <i
                  className={`${
                    statusBadge.tone === "rose"
                      ? "fas fa-triangle-exclamation"
                      : statusBadge.tone === "amber"
                        ? "fas fa-pen"
                        : statusBadge.tone === "blue"
                          ? "fas fa-check"
                          : "fas fa-clock"
                  } text-[11px]`}
                ></i>
                {statusMessage}
              </div>
            </div>
            {!!restoreMessage && (
              <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {restoreMessage}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleManualSave()}
              disabled={!canPersistPresentation || saveState === "saving"}
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-semibold transition ${
                !canPersistPresentation || saveState === "saving"
                  ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                  : "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              <i className="fas fa-save text-xs"></i>
              {saveState === "saving" ? "저장 중" : "저장"}
            </button>
            <button
              type="button"
              onClick={handleResetAnnotations}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              <i className="fas fa-eraser text-xs"></i>
              메모 초기화
            </button>
            {fullscreenPreview && onClosePreview && (
              <button
                type="button"
                onClick={handleClosePresentation}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <i className="fas fa-times text-xs"></i>
                닫기
              </button>
            )}
          </div>
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

        {!!worksheet.pageImages.length && (
          <div className="space-y-4">
            <LessonWorksheetStage
              pageImages={worksheet.pageImages}
              blanks={worksheet.blanks}
              textRegions={worksheet.textRegions}
              footnoteAnchors={worksheet.footnoteAnchors}
              selectedFootnoteAnchorId={activeWorksheetFootnoteAnchorId}
              footnoteTitles={footnoteTitles}
              onActivateFootnoteAnchor={handleOpenWorksheetFootnoteAnchor}
              mode="teacher-present"
              annotationUiMode="always"
              annotationPersistenceKey={`${lesson.unitId || "lesson"}:${classContext.classId}`}
              annotationState={annotationState}
              onAnnotationChange={handleAnnotationChange}
              teacherCurrentPage={currentPage}
              onTeacherCurrentPageChange={handleTeacherCurrentPageChange}
            />
          </div>
        )}

        {!!bodyHtml && (
          <div
            className="note-content mt-6 rounded-3xl border border-slate-200 bg-white p-6 leading-loose text-slate-700 shadow-sm md:p-10"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
        <LessonFootnoteDialog
          open={worksheetFootnoteOpen}
          footnote={activeWorksheetFootnote}
          badgeLabel="PDF"
          onClose={() => {
            setWorksheetFootnoteOpen(false);
            setActiveWorksheetFootnoteAnchorId(null);
          }}
        />
      </div>
    </div>
  );

  if (!fullscreenPreview) {
    return content;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(254,243,199,0.78),_rgba(241,245,249,0.96)_38%,_rgba(226,232,240,1)_100%)] p-2 md:p-4">
      {content}
    </div>
  );
};

export default TeacherLessonPresentation;
