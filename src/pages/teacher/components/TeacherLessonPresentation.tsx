import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import LessonWorksheetStage, {
  type LessonWorksheetAnnotationState,
} from "../../../components/common/LessonWorksheetStage";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getLessonContentSections,
  type LessonData,
} from "../../../lib/lessonData";
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

// TeacherLessonPresentation assumes class-scoped launch context.
// Future entry points should pass the same lesson/class/runtime contract.
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
  currentPage: number | null,
) =>
  JSON.stringify({
    annotations,
    currentPage: currentPage ?? null,
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

  const [annotationState, setAnnotationState] =
    useState<LessonWorksheetAnnotationState>(EMPTY_ANNOTATION_STATE);
  const [currentPage, setCurrentPage] = useState<number | null>(null);
  const [saveState, setSaveState] =
    useState<TeacherPresentationSaveState>("restoring");
  const [statusMessage, setStatusMessage] = useState(
    `${classContext.classLabel} 판서를 불러오는 중입니다.`,
  );
  const [restoreMessage, setRestoreMessage] = useState("");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const saveTimerRef = useRef<number | null>(null);
  const latestAnnotationRef = useRef(EMPTY_ANNOTATION_STATE);
  const latestPageRef = useRef<number | null>(null);
  const lastSavedSnapshotRef = useRef(
    serializePresentationSnapshot(EMPTY_ANNOTATION_STATE, null),
  );
  const currentClassLabelRef = useRef(classContext.classLabel);

  const { bodyHtml, worksheet } = getLessonContentSections(lesson);
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

  const hasUnsavedChanges = useMemo(
    () =>
      serializePresentationSnapshot(annotationState, currentPage) !==
      lastSavedSnapshotRef.current,
    [annotationState, currentPage],
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
        setStatusMessage("학급 정보가 아직 정해지지 않아 저장하지 않습니다.");
        return;
      }
      setStatusMessage(
        getTeacherPresentationStatusText({
          state: nextState,
          classLabel: nextClassLabel,
          savedAt: savedAt ?? lastSavedAt,
        }),
      );
    },
    [lastSavedAt, presentationDocPath],
  );

  const persistPresentation = useCallback(
    async (params?: {
      annotationState?: LessonWorksheetAnnotationState;
      currentPage?: number | null;
      silent?: boolean;
    }) => {
      if (!presentationDocPath || !currentUser?.uid || !lesson.unitId) {
        return false;
      }

      const nextAnnotations =
        params?.annotationState ?? latestAnnotationRef.current;
      const nextPage =
        params?.currentPage === undefined
          ? latestPageRef.current
          : params.currentPage;
      const nextSnapshot = serializePresentationSnapshot(
        nextAnnotations,
        nextPage,
      );

      if (nextSnapshot === lastSavedSnapshotRef.current) {
        updateStatus(
          lastSavedAt ? "saved" : "idle",
          currentClassLabelRef.current,
          lastSavedAt,
        );
        return true;
      }

      if (!params?.silent) {
        updateStatus("saving", currentClassLabelRef.current);
      }

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
        setLastSavedAt(savedAt);
        writeRecentTeacherPresentationClass({
          teacherUid: currentUser.uid,
          lessonId: lesson.unitId,
          summary: {
            classId: classContext.classId,
            classLabel: classContext.classLabel,
            currentPage: nextPage,
            updatedAt: savedAt,
            lastUsedAt: savedAt,
            hasSavedState: true,
            runtimeState: "saved",
            hasUnsavedChanges: false,
            statusText: getTeacherPresentationStatusText({
              state: "saved",
              classLabel: classContext.classLabel,
              savedAt,
            }),
          },
        });
        updateStatus("saved", currentClassLabelRef.current, savedAt);
        return true;
      } catch (error) {
        console.error(
          "Failed to save teacher presentation annotations:",
          error,
        );
        updateStatus("error", currentClassLabelRef.current);
        return false;
      }
    },
    [
      classContext.classId,
      classContext.classLabel,
      currentUser?.uid,
      lastSavedAt,
      lesson.unitId,
      presentationDocPath,
      updateStatus,
    ],
  );

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
    latestAnnotationRef.current = annotationState;
  }, [annotationState]);

  useEffect(() => {
    latestPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    currentClassLabelRef.current = classContext.classLabel;
  }, [classContext.classLabel]);

  useEffect(() => {
    let cancelled = false;

    const loadPresentation = async () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (!presentationDocPath) {
        const fallbackPage = worksheet.pageImages[0]?.page ?? null;
        setAnnotationState(EMPTY_ANNOTATION_STATE);
        latestAnnotationRef.current = EMPTY_ANNOTATION_STATE;
        setCurrentPage(fallbackPage);
        latestPageRef.current = fallbackPage;
        setLastSavedAt(null);
        setRestoreMessage("");
        lastSavedSnapshotRef.current = serializePresentationSnapshot(
          EMPTY_ANNOTATION_STATE,
          fallbackPage,
        );
        updateStatus("idle", classContext.classLabel);
        return;
      }

      updateStatus("restoring", classContext.classLabel);
      setRestoreMessage("");

      try {
        const snapshot = await getDoc(doc(db, presentationDocPath));
        if (cancelled) return;

        if (snapshot.exists()) {
          const data = snapshot.data() as {
            annotations?: LessonWorksheetAnnotationState;
            currentPage?: number;
            updatedAt?: { toDate?: () => Date };
          };
          const restoredAnnotations =
            data.annotations || EMPTY_ANNOTATION_STATE;
          const restoredPage =
            data.currentPage &&
            worksheet.pageImages.some((page) => page.page === data.currentPage)
              ? data.currentPage
              : (worksheet.pageImages[0]?.page ?? null);
          const restoredAt = data.updatedAt?.toDate?.() || null;

          setAnnotationState(restoredAnnotations);
          latestAnnotationRef.current = restoredAnnotations;
          setCurrentPage(restoredPage);
          latestPageRef.current = restoredPage;
          setLastSavedAt(restoredAt);
          lastSavedSnapshotRef.current = serializePresentationSnapshot(
            restoredAnnotations,
            restoredPage,
          );
          setRestoreMessage(
            `${classContext.classLabel}의 마지막 판서를 불러왔습니다.`,
          );
          updateStatus(
            restoredAt ? "saved" : "idle",
            classContext.classLabel,
            restoredAt,
          );
          return;
        }

        if (
          legacyPresentationDocPath &&
          shouldUseLegacyTeacherPresentationFallback({
            hasClassDocument: false,
          })
        ) {
          const legacySnapshot = await getDoc(
            doc(db, legacyPresentationDocPath),
          );
          if (cancelled) return;
          if (legacySnapshot.exists()) {
            const legacyData = legacySnapshot.data() as {
              annotations?: LessonWorksheetAnnotationState;
              currentPage?: number;
              updatedAt?: { toDate?: () => Date };
            };
            const restoredAnnotations =
              legacyData.annotations || EMPTY_ANNOTATION_STATE;
            const restoredPage =
              legacyData.currentPage &&
              worksheet.pageImages.some(
                (page) => page.page === legacyData.currentPage,
              )
                ? legacyData.currentPage
                : (worksheet.pageImages[0]?.page ?? null);
            const restoredAt = legacyData.updatedAt?.toDate?.() || null;

            setAnnotationState(restoredAnnotations);
            latestAnnotationRef.current = restoredAnnotations;
            setCurrentPage(restoredPage);
            latestPageRef.current = restoredPage;
            setLastSavedAt(restoredAt);
            lastSavedSnapshotRef.current = serializePresentationSnapshot(
              restoredAnnotations,
              restoredPage,
            );
            setRestoreMessage(
              `${classContext.classLabel}에는 아직 학급별 기록이 없어 이전 개인 판서를 임시로 불러왔습니다.`,
            );
            updateStatus("dirty", classContext.classLabel, restoredAt);
            return;
          }
        }

        const emptyPage = worksheet.pageImages[0]?.page ?? null;
        setAnnotationState(EMPTY_ANNOTATION_STATE);
        latestAnnotationRef.current = EMPTY_ANNOTATION_STATE;
        setCurrentPage(emptyPage);
        latestPageRef.current = emptyPage;
        setLastSavedAt(null);
        lastSavedSnapshotRef.current = serializePresentationSnapshot(
          EMPTY_ANNOTATION_STATE,
          emptyPage,
        );
        setRestoreMessage(
          `${classContext.classLabel}에는 아직 저장된 판서가 없어 빈 상태로 시작합니다.`,
        );
        updateStatus("idle", classContext.classLabel);
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
    updateStatus,
    worksheet.pageImages,
  ]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      const nextSnapshot = serializePresentationSnapshot(
        latestAnnotationRef.current,
        latestPageRef.current,
      );
      if (
        presentationDocPath &&
        nextSnapshot !== lastSavedSnapshotRef.current
      ) {
        void persistPresentation({ silent: true });
      }
    },
    [persistPresentation, presentationDocPath],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!warningState.shouldWarnOnClose) return;
      void persistPresentation({ silent: true });
      event.preventDefault();
      event.returnValue = warningState.unloadMessage;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [persistPresentation, warningState]);

  const scheduleAutosave = (
    nextAnnotations: LessonWorksheetAnnotationState,
    nextPage: number | null,
  ) => {
    if (!presentationDocPath) {
      updateStatus("idle", classContext.classLabel);
      return;
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    updateStatus("dirty", classContext.classLabel);
    saveTimerRef.current = window.setTimeout(() => {
      void persistPresentation({
        annotationState: nextAnnotations,
        currentPage: nextPage,
      });
    }, 1400);
  };

  const handleAnnotationChange = (
    nextState: LessonWorksheetAnnotationState,
  ) => {
    const nextSnapshot = serializePresentationSnapshot(
      nextState,
      latestPageRef.current,
    );
    const currentSnapshot = serializePresentationSnapshot(
      latestAnnotationRef.current,
      latestPageRef.current,
    );
    if (nextSnapshot === currentSnapshot) return;

    latestAnnotationRef.current = nextState;
    setAnnotationState(nextState);
    setRestoreMessage("");
    scheduleAutosave(nextState, latestPageRef.current);
  };

  const handleTeacherCurrentPageChange = (page: number) => {
    latestPageRef.current = page;
    setCurrentPage((prev) => (prev === page ? prev : page));
    const nextSnapshot = serializePresentationSnapshot(
      latestAnnotationRef.current,
      page,
    );
    if (nextSnapshot === lastSavedSnapshotRef.current) return;
    scheduleAutosave(latestAnnotationRef.current, page);
  };

  const handleRetrySave = async () => {
    await persistPresentation({
      annotationState: latestAnnotationRef.current,
      currentPage: latestPageRef.current,
    });
  };

  const handleClosePreview = async () => {
    if (
      warningState.shouldWarnOnClose &&
      !window.confirm(warningState.closeMessage)
    ) {
      return;
    }
    await persistPresentation({ silent: true });
    onClosePreview?.();
  };

  const handleResetAnnotations = async () => {
    if (
      !window.confirm(
        `${classContext.classLabel} 판서를 모두 지울까요? 다른 반 판서에는 영향이 없습니다.`,
      )
    ) {
      return;
    }

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const resetPage = worksheet.pageImages[0]?.page ?? null;
    setAnnotationState(EMPTY_ANNOTATION_STATE);
    latestAnnotationRef.current = EMPTY_ANNOTATION_STATE;
    setCurrentPage(resetPage);
    latestPageRef.current = resetPage;
    setRestoreMessage("");

    if (!presentationDocPath || !currentUser?.uid || !lesson.unitId) {
      lastSavedSnapshotRef.current = serializePresentationSnapshot(
        EMPTY_ANNOTATION_STATE,
        resetPage,
      );
      setLastSavedAt(null);
      updateStatus("idle", classContext.classLabel);
      return;
    }

    updateStatus("saving", classContext.classLabel);
    try {
      await setDoc(
        doc(db, presentationDocPath),
        {
          lessonId: lesson.unitId,
          teacherUid: currentUser.uid,
          classId: classContext.classId,
          classLabel: classContext.classLabel,
          currentPage: resetPage,
          annotations: EMPTY_ANNOTATION_STATE,
          updatedAt: serverTimestamp(),
          lastUsedAt: serverTimestamp(),
          clearedAt: serverTimestamp(),
          restoreHint: deleteField(),
        },
        { merge: true },
      );

      const savedAt = new Date();
      lastSavedSnapshotRef.current = serializePresentationSnapshot(
        EMPTY_ANNOTATION_STATE,
        resetPage,
      );
      setLastSavedAt(savedAt);
      writeRecentTeacherPresentationClass({
        teacherUid: currentUser.uid,
        lessonId: lesson.unitId,
        summary: {
          classId: classContext.classId,
          classLabel: classContext.classLabel,
          currentPage: resetPage,
          updatedAt: savedAt,
          lastUsedAt: savedAt,
          hasSavedState: true,
          runtimeState: "saved",
          hasUnsavedChanges: false,
          statusText: getTeacherPresentationStatusText({
            state: "saved",
            classLabel: classContext.classLabel,
            savedAt,
          }),
        },
      });
      setRestoreMessage(
        `${classContext.classLabel} 판서를 초기화했습니다. 다른 반 판서에는 영향이 없습니다.`,
      );
      updateStatus("saved", classContext.classLabel, savedAt);
    } catch (error) {
      console.error("Failed to reset teacher presentation annotations:", error);
      updateStatus("error", classContext.classLabel);
    }
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
                현재 페이지{" "}
                {currentPage ?? worksheet.pageImages[0]?.page ?? "-"}
              </div>
              {lastSavedAt && (
                <div className="inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  마지막 저장 {formatTeacherPresentationSavedAt(lastSavedAt)}
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              학생에게는 보이지 않는 개인 메모이며, 이 반의 마지막 상태로 자동
              저장됩니다.
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
              {saveState === "error" && (
                <button
                  type="button"
                  onClick={() => void handleRetrySave()}
                  className="inline-flex h-8 items-center gap-2 rounded-full border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                >
                  <i className="fas fa-rotate-right text-[11px]"></i>
                  다시 저장
                </button>
              )}
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
              onClick={() => void handleResetAnnotations()}
              className="inline-flex h-8 items-center gap-2 rounded-full border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-600 transition hover:bg-rose-50"
            >
              <i className="fas fa-eraser text-xs"></i>
              현재 학급 판서 초기화
            </button>
            {fullscreenPreview && onClosePreview && (
              <button
                type="button"
                onClick={() => void handleClosePreview()}
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
              mode="teacher-present"
              annotationUiMode="always"
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
