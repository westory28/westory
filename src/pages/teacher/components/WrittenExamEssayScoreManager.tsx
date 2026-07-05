import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  collection,
  type DocumentData,
  type DocumentReference,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type UpdateData,
  type WithFieldValue,
  where,
  writeBatch,
} from "firebase/firestore";
import { useAppDialog } from "../../../components/common/AppDialogProvider";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { useAuth } from "../../../contexts/AuthContext";
import { db } from "../../../lib/firebase";
import {
  getSemesterCollectionPath,
  getYearSemester,
} from "../../../lib/semesterScope";
import {
  PERFORMANCE_SCORE_ANSWER_SHEET_REQUESTS_COLLECTION,
  PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
  PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  PERFORMANCE_SCORE_USER_COLLECTION,
  WRITTEN_EXAM_SCORE_KIND,
  buildStudentLookupKey,
  buildStudentNameLookupKey,
  formatPerformanceScore,
  loadPerformanceScoreConfirmation,
  normalizePerformanceScoreKind,
  normalizeSchoolValue,
  normalizeStudentName,
  roundScore,
  toFiniteScore,
  type PerformanceScoreAnswerSheetRequest,
  type PerformanceScoreObjection,
  type PerformanceScoreRecord,
  type PerformanceScoreRoster,
  type PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
import {
  parseWrittenExamEssayScoreWorkbook,
  type ParsedWrittenExamEssayScoreRow,
  type ParsedWrittenExamEssayScoreUpload,
} from "../../../lib/writtenExamEssayScoreWorkbook";
import { reviewPerformanceScoreObjection } from "../../../lib/notifications";

interface StudentProfile {
  uid: string;
  name: string;
  grade: string;
  class: string;
  number: string;
  email: string;
}

interface StudentMatchIndexes {
  byNumber: Map<string, StudentProfile[]>;
  byName: Map<string, StudentProfile[]>;
}

type TeacherObjection = PerformanceScoreObjection & {
  studentName: string;
  grade: string;
  class: string;
  number: string;
  subject: string;
  scoreLabel: string;
  totalScore: number | null;
  totalMaxScore: number | null;
};

type TeacherAnswerSheetRequest = PerformanceScoreAnswerSheetRequest & {
  studentName: string;
  grade: string;
  class: string;
  number: string;
  subject: string;
  scoreLabel: string;
};

const DEFAULT_GRADE_OPTIONS = ["1", "2", "3"];
const DEFAULT_CLASS_OPTIONS = Array.from({ length: 12 }, (_, index) =>
  String(index + 1),
);
const FIRESTORE_BATCH_WRITE_LIMIT = 450;

const toText = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const getTimestampMillis = (value: unknown) => {
  if (!value) return 0;
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  const seconds = Number((value as { seconds?: number }).seconds || 0);
  return seconds > 0 ? seconds * 1000 : 0;
};

const formatDateTime = (value: unknown) => {
  const millis = getTimestampMillis(value);
  if (!millis) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(millis));
};

const normalizeStudentProfile = (
  id: string,
  data: Record<string, unknown>,
): StudentProfile => ({
  uid: id,
  name: toText(data.studentName || data.name || data.displayName || ""),
  grade: normalizeSchoolValue(data.studentGrade || data.grade || ""),
  class: normalizeSchoolValue(data.studentClass || data.class || ""),
  number: normalizeSchoolValue(data.studentNumber || data.number || ""),
  email: toText(data.email),
});

const buildStudentMatchIndexes = (
  students: StudentProfile[],
): StudentMatchIndexes => {
  const byNumber = new Map<string, StudentProfile[]>();
  const byName = new Map<string, StudentProfile[]>();

  students.forEach((student) => {
    const numberKey = buildStudentLookupKey(
      student.grade,
      student.class,
      student.number,
    );
    if (student.grade && student.class && student.number) {
      byNumber.set(numberKey, [...(byNumber.get(numberKey) || []), student]);
    }

    const nameKey = buildStudentNameLookupKey(
      student.grade,
      student.class,
      student.name,
    );
    if (student.grade && student.class && student.name) {
      byName.set(nameKey, [...(byName.get(nameKey) || []), student]);
    }
  });

  return { byNumber, byName };
};

const getUniqueStudentMatch = (
  values: StudentProfile[] | undefined,
): StudentProfile | null => (values && values.length === 1 ? values[0] : null);

const matchRowsToStudents = (
  rows: ParsedWrittenExamEssayScoreRow[],
  students: StudentProfile[],
) => {
  const { byNumber, byName } = buildStudentMatchIndexes(students);

  return rows.map((row) => {
    const numberMatch = getUniqueStudentMatch(
      byNumber.get(buildStudentLookupKey(row.grade, row.class, row.number)),
    );
    if (numberMatch) {
      const sameName =
        !row.studentName ||
        normalizeStudentName(row.studentName) ===
          normalizeStudentName(numberMatch.name);
      return {
        ...row,
        uid: numberMatch.uid,
        studentName: row.studentName || numberMatch.name,
        matchStatus: sameName ? "matched" : "name-mismatch",
        matchMessage: sameName
          ? "학년, 반, 번호, 이름이 일치합니다."
          : `번호로 연결했습니다. 등록 명단 이름은 ${numberMatch.name || "이름 없음"}입니다.`,
      } satisfies ParsedWrittenExamEssayScoreRow;
    }

    const nameMatch = getUniqueStudentMatch(
      byName.get(
        buildStudentNameLookupKey(row.grade, row.class, row.studentName),
      ),
    );
    if (nameMatch) {
      return {
        ...row,
        uid: nameMatch.uid,
        number: row.number || nameMatch.number,
        matchStatus: "name-mismatch",
        matchMessage: `이름으로 연결했습니다. 등록 명단 번호는 ${nameMatch.number || "-"}번입니다.`,
      } satisfies ParsedWrittenExamEssayScoreRow;
    }

    return {
      ...row,
      uid: "",
      matchStatus: "unmatched",
      matchMessage: "학생 명단에서 같은 학년, 반, 번호를 찾지 못했습니다.",
    } satisfies ParsedWrittenExamEssayScoreRow;
  });
};

const sortSchoolValues = (values: string[]) =>
  values.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b, "ko"));

const normalizeRoster = (
  id: string,
  data: Omit<PerformanceScoreRoster, "id">,
): PerformanceScoreRoster => ({
  id,
  ...data,
  scoreKind: normalizePerformanceScoreKind(data.scoreKind),
  rows: Array.isArray(data.rows) ? data.rows : [],
  classes: Array.isArray(data.classes) ? data.classes : [],
  items: Array.isArray(data.items) ? data.items : [],
});

const sortRosters = (items: PerformanceScoreRoster[]) =>
  [...items].sort(
    (a, b) =>
      getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt) ||
      String(a.title || "").localeCompare(String(b.title || ""), "ko"),
  );

const readWorkbookRows = async (file: File) => {
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const workbookRows = (await readXlsxFile(file)) as unknown;
  return Array.isArray(workbookRows) &&
    workbookRows.length === 1 &&
    typeof workbookRows[0] === "object" &&
    workbookRows[0] !== null &&
    Array.isArray((workbookRows[0] as { data?: unknown }).data)
    ? ((workbookRows[0] as { data: unknown[][] }).data as unknown[][])
    : (workbookRows as unknown[][]);
};

const createBatchQueue = () => {
  const batches: Array<ReturnType<typeof writeBatch>> = [];
  let activeBatch = writeBatch(db);
  let activeWriteCount = 0;

  const rotateIfFull = () => {
    if (activeWriteCount < FIRESTORE_BATCH_WRITE_LIMIT) return;
    batches.push(activeBatch);
    activeBatch = writeBatch(db);
    activeWriteCount = 0;
  };

  const queueWrite = () => {
    activeWriteCount += 1;
  };

  return {
    set(
      ref: DocumentReference<DocumentData>,
      data: WithFieldValue<DocumentData>,
    ) {
      rotateIfFull();
      activeBatch.set(ref, data);
      queueWrite();
    },
    update(
      ref: DocumentReference<DocumentData>,
      data: UpdateData<DocumentData>,
    ) {
      rotateIfFull();
      activeBatch.update(ref, data);
      queueWrite();
    },
    delete(ref: DocumentReference<DocumentData>) {
      rotateIfFull();
      activeBatch.delete(ref);
      queueWrite();
    },
    async commit() {
      if (activeWriteCount > 0) batches.push(activeBatch);
      for (const batch of batches) {
        await batch.commit();
      }
    },
  };
};

const getRosterRowHasScore = (row: PerformanceScoreRosterRow) =>
  row.enteredScoreCount !== 0 && toFiniteScore(row.totalScore) !== null;

const buildStudentScorePayload = (
  roster: PerformanceScoreRoster,
  row: PerformanceScoreRosterRow,
  timestamp: ReturnType<typeof serverTimestamp>,
): PerformanceScoreRecord | null => {
  if (!row.uid || !getRosterRowHasScore(row)) return null;
  return {
    scoreKind: WRITTEN_EXAM_SCORE_KIND,
    rosterId: roster.id,
    title: roster.title,
    subject: roster.subject,
    academicYear: roster.academicYear,
    semester: roster.semester,
    grade: row.grade,
    class: row.class,
    number: row.number,
    studentName: row.studentName,
    uid: row.uid,
    items: Array.isArray(row.items) ? row.items : [],
    enteredScoreCount: row.enteredScoreCount || 1,
    totalScore: roundScore(Number(row.totalScore || 0)),
    totalMaxScore: row.totalMaxScore || roster.totalMaxScore || 0,
    feedback: String(row.feedback || "").slice(0, 1000),
    evidence: String(row.evidence || row.feedback || "").slice(0, 1000),
    sourceFileName: roster.sourceFileName,
    uploadedBy: roster.uploadedBy || "",
    uploadedByEmail: roster.uploadedByEmail || "",
    uploadedAt: roster.createdAt || timestamp,
    updatedAt: timestamp,
  };
};

const normalizeTeacherObjection = (
  id: string,
  data: Record<string, unknown>,
): TeacherObjection => ({
  id,
  scoreKind: normalizePerformanceScoreKind(data.scoreKind),
  uid: toText(data.uid),
  scoreId: toText(data.scoreId),
  rosterId: toText(data.rosterId),
  scoreTitle: toText(data.scoreTitle),
  status:
    data.status === "accepted" || data.status === "rejected"
      ? data.status
      : "pending",
  reason: toText(data.reason),
  requestedAt: data.requestedAt,
  reviewedAt: data.reviewedAt,
  changedScoreLabel: toText(data.changedScoreLabel),
  reviewMemo: toText(data.reviewMemo),
  studentName: toText(data.studentName) || "학생",
  grade: toText(data.grade),
  class: toText(data.class),
  number: toText(data.number),
  subject: toText(data.subject),
  scoreLabel: toText(data.scoreLabel),
  totalScore: toFiniteScore(data.totalScore),
  totalMaxScore: toFiniteScore(data.totalMaxScore),
});

const normalizeAnswerSheetRequest = (
  id: string,
  data: Record<string, unknown>,
): TeacherAnswerSheetRequest => ({
  id,
  scoreKind: normalizePerformanceScoreKind(data.scoreKind),
  uid: toText(data.uid),
  scoreId: toText(data.scoreId),
  rosterId: toText(data.rosterId),
  scoreTitle: toText(data.scoreTitle),
  status: data.status === "reviewed" ? "reviewed" : "pending",
  reason: toText(data.reason),
  requestedAt: data.requestedAt,
  reviewedAt: data.reviewedAt,
  reviewMemo: toText(data.reviewMemo),
  studentName: toText(data.studentName) || "학생",
  grade: toText(data.grade),
  class: toText(data.class),
  number: toText(data.number),
  subject: toText(data.subject),
  scoreLabel: toText(data.scoreLabel),
});

const getStatusClassName = (status: string) => {
  if (status === "accepted" || status === "reviewed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "rejected") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-amber-200 bg-amber-50 text-amber-700";
};

const WrittenExamEssayScoreManager: React.FC = () => {
  const { currentUser, config } = useAuth();
  const { showToast } = useAppToast();
  const { confirm, prompt: promptDialog } = useAppDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const { year, semester } = getYearSemester(config);
  const rosterCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_ROSTERS_COLLECTION,
  );
  const objectionCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_OBJECTIONS_COLLECTION,
  );
  const requestCollectionPath = getSemesterCollectionPath(
    { year, semester },
    PERFORMANCE_SCORE_ANSWER_SHEET_REQUESTS_COLLECTION,
  );

  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [rosters, setRosters] = useState<PerformanceScoreRoster[]>([]);
  const [rostersLoading, setRostersLoading] = useState(true);
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [parsed, setParsed] =
    useState<ParsedWrittenExamEssayScoreUpload | null>(null);
  const [targetGrade, setTargetGrade] = useState("2");
  const [fallbackClass, setFallbackClass] = useState("1");
  const [title, setTitle] = useState("정기시험 논술형 점수");
  const [subject, setSubject] = useState("역사");
  const [itemName, setItemName] = useState("논술형 점수");
  const [maxScore, setMaxScore] = useState("10");
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftRows, setDraftRows] = useState<PerformanceScoreRosterRow[]>([]);
  const [savingEdits, setSavingEdits] = useState(false);
  const [objections, setObjections] = useState<TeacherObjection[]>([]);
  const [objectionsLoading, setObjectionsLoading] = useState(false);
  const [objectionModalOpen, setObjectionModalOpen] = useState(false);
  const [reviewingObjectionId, setReviewingObjectionId] = useState("");
  const [answerSheetRequests, setAnswerSheetRequests] = useState<
    TeacherAnswerSheetRequest[]
  >([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reviewingRequestId, setReviewingRequestId] = useState("");
  const [signatureStatusByUid, setSignatureStatusByUid] = useState<
    Record<string, boolean>
  >({});
  const [signaturesLoading, setSignaturesLoading] = useState(false);

  const selectedRoster = useMemo(
    () => rosters.find((roster) => roster.id === selectedRosterId) || null,
    [rosters, selectedRosterId],
  );
  const visibleRows = editing ? draftRows : selectedRoster?.rows || [];
  const pendingObjectionCount = objections.filter(
    (item) => item.status === "pending",
  ).length;
  const pendingRequestCount = answerSheetRequests.filter(
    (item) => item.status === "pending",
  ).length;
  const parsedSummary = useMemo(() => {
    const rows = parsed?.rows || [];
    return {
      rowCount: rows.length,
      matchedCount: rows.filter((row) => row.uid).length,
      saveableCount: rows.filter((row) => row.uid && row.enteredScoreCount > 0)
        .length,
      unmatchedCount: rows.filter((row) => !row.uid).length,
    };
  }, [parsed]);

  const loadStudents = async () => {
    setStudentsLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, "users"), where("role", "==", "student")),
      );
      const loaded = snap.docs
        .map((item) =>
          normalizeStudentProfile(
            item.id,
            item.data() as Record<string, unknown>,
          ),
        )
        .filter((student) => student.uid);
      setStudents(loaded);
      return loaded;
    } catch (error) {
      console.error("Failed to load students for written exam scores:", error);
      showToast({
        tone: "error",
        title: "학생 명단을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
      return [];
    } finally {
      setStudentsLoading(false);
    }
  };

  const loadRosters = async () => {
    setRostersLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, rosterCollectionPath),
          orderBy("createdAt", "desc"),
        ),
      );
      const loaded = snap.docs
        .map((item) =>
          normalizeRoster(
            item.id,
            item.data() as Omit<PerformanceScoreRoster, "id">,
          ),
        )
        .filter(
          (roster) =>
            normalizePerformanceScoreKind(roster.scoreKind) ===
            WRITTEN_EXAM_SCORE_KIND,
        );
      const sorted = sortRosters(loaded);
      setRosters(sorted);
      setSelectedRosterId((current) =>
        sorted.some((roster) => roster.id === current)
          ? current
          : sorted[0]?.id || "",
      );
    } catch (error) {
      console.error("Failed to load written exam essay score rosters:", error);
      setRosters([]);
      showToast({
        tone: "error",
        title: "논술형 점수표를 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setRostersLoading(false);
    }
  };

  const loadObjections = async () => {
    if (objectionsLoading) return;
    setObjectionsLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, objectionCollectionPath),
          orderBy("requestedAt", "desc"),
        ),
      );
      setObjections(
        snap.docs
          .map((item) =>
            normalizeTeacherObjection(
              item.id,
              item.data() as Record<string, unknown>,
            ),
          )
          .filter(
            (item) =>
              normalizePerformanceScoreKind(item.scoreKind) ===
              WRITTEN_EXAM_SCORE_KIND,
          ),
      );
    } catch (error) {
      console.error("Failed to load written exam essay objections:", error);
      showToast({
        tone: "error",
        title: "이의 목록을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인해 주세요.",
      });
    } finally {
      setObjectionsLoading(false);
    }
  };

  const loadAnswerSheetRequests = async () => {
    if (requestsLoading) return;
    setRequestsLoading(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, requestCollectionPath),
          orderBy("requestedAt", "desc"),
        ),
      );
      setAnswerSheetRequests(
        snap.docs
          .map((item) =>
            normalizeAnswerSheetRequest(
              item.id,
              item.data() as Record<string, unknown>,
            ),
          )
          .filter(
            (item) =>
              normalizePerformanceScoreKind(item.scoreKind) ===
              WRITTEN_EXAM_SCORE_KIND,
          ),
      );
    } catch (error) {
      console.error("Failed to load answer sheet requests:", error);
      showToast({
        tone: "error",
        title: "답안지 확인 요청을 불러오지 못했습니다.",
        message: "권한과 네트워크 상태를 확인해 주세요.",
      });
    } finally {
      setRequestsLoading(false);
    }
  };

  useEffect(() => {
    void loadStudents();
    void loadRosters();
    void loadObjections();
    void loadAnswerSheetRequests();
  }, [year, semester]);

  useEffect(() => {
    const panel = searchParams.get("panel");
    if (panel === "answer-sheet-requests") {
      setRequestModalOpen(true);
      void loadAnswerSheetRequests();
    }
    if (panel === "objections") {
      setObjectionModalOpen(true);
      void loadObjections();
    }
  }, [searchParams]);

  useEffect(() => {
    let canceled = false;
    const loadSignatures = async () => {
      if (!selectedRoster) {
        setSignatureStatusByUid({});
        return;
      }
      const rowsWithUid = selectedRoster.rows.filter((row) => row.uid);
      if (rowsWithUid.length === 0) {
        setSignatureStatusByUid({});
        return;
      }
      setSignaturesLoading(true);
      try {
        const entries = await Promise.all(
          rowsWithUid.map(async (row) => {
            const confirmation = await loadPerformanceScoreConfirmation(
              row.uid || "",
              selectedRoster.id,
            );
            return [
              row.uid || "",
              Boolean(confirmation?.signatureImage),
            ] as const;
          }),
        );
        if (!canceled) {
          setSignatureStatusByUid(Object.fromEntries(entries));
        }
      } finally {
        if (!canceled) {
          setSignaturesLoading(false);
        }
      }
    };

    void loadSignatures();
    return () => {
      canceled = true;
    };
  }, [selectedRoster]);

  const closePanelParam = () => {
    if (!searchParams.get("panel")) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("panel");
    setSearchParams(nextParams, { replace: true });
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setParsing(true);
    try {
      const studentsForMatch = students.length
        ? students
        : await loadStudents();
      const rows = await readWorkbookRows(file);
      const parsedUpload = parseWrittenExamEssayScoreWorkbook(rows, {
        fileName: file.name,
        targetGrade,
        fallbackClass,
        title,
        subject,
        itemName,
        maxScore: Number(maxScore),
      });
      const matchedRows = matchRowsToStudents(
        parsedUpload.rows,
        studentsForMatch,
      );
      setParsed({
        ...parsedUpload,
        rows: matchedRows,
      });
      setTitle(parsedUpload.title);
      setSubject(parsedUpload.subject);
      setItemName(parsedUpload.itemName);
      showToast({
        tone: "success",
        title: "엑셀 파일을 읽었습니다.",
        message: `${matchedRows.length}행 중 ${matchedRows.filter((row) => row.uid).length}행이 학생 명단과 연결되었습니다.`,
      });
    } catch (error) {
      console.error("Failed to parse written exam essay workbook:", error);
      showToast({
        tone: "error",
        title: "엑셀 파일을 읽지 못했습니다.",
        message:
          error instanceof Error
            ? error.message
            : "양식의 번호, 이름, 점수, 피드백 컬럼을 확인해 주세요.",
      });
      setParsed(null);
    } finally {
      setParsing(false);
    }
  };

  const saveParsedScores = async () => {
    if (!parsed || saving) return;
    const safeTitle = toText(title) || parsed.title;
    const safeSubject = toText(subject) || parsed.subject || "역사";
    const safeItemName = toText(itemName) || parsed.itemName || "논술형 점수";
    const safeMaxScore = roundScore(Number(maxScore || parsed.totalMaxScore));
    if (!safeTitle || safeMaxScore <= 0) {
      showToast({
        tone: "warning",
        title: "시험명과 만점을 확인해 주세요.",
        message: "정기시험 논술형 점수표 이름과 만점은 반드시 필요합니다.",
      });
      return;
    }

    const saveableRows = parsed.rows.filter(
      (row) => row.uid && row.enteredScoreCount > 0,
    );
    if (!saveableRows.length) {
      showToast({
        tone: "warning",
        title: "저장할 학생 점수가 없습니다.",
        message: "학생 명단과 연결되고 점수가 입력된 행만 저장할 수 있습니다.",
      });
      return;
    }

    const confirmed = await confirm({
      title: "논술형 점수를 저장할까요?",
      message: `${safeTitle} 점수를 ${saveableRows.length}명 학생 화면에 공개합니다.`,
      confirmLabel: "저장하기",
      tone: "info",
    });
    if (!confirmed) return;

    setSaving(true);
    try {
      const timestamp = serverTimestamp();
      const rosterRef = doc(collection(db, rosterCollectionPath));
      const rosterId = rosterRef.id;
      const classList = sortSchoolValues(
        Array.from(
          new Set(parsed.rows.map((row) => row.class).filter(Boolean)),
        ),
      );
      const rosterRows: PerformanceScoreRosterRow[] = parsed.rows.map((row) => {
        const score = roundScore(Number(row.totalScore || 0));
        return {
          rowNumber: row.rowNumber,
          uid: row.uid,
          grade: row.grade,
          class: row.class,
          number: row.number,
          studentName: row.studentName,
          items: [
            {
              name: safeItemName,
              shortName: "논술형",
              score,
              maxScore: safeMaxScore,
              scoreEntered: row.enteredScoreCount > 0,
            },
          ],
          enteredScoreCount: row.enteredScoreCount,
          totalScore: score,
          totalMaxScore: safeMaxScore,
          feedback: String(row.feedback || "").slice(0, 1000),
          evidence: String(row.evidence || row.feedback || "").slice(0, 1000),
          matchStatus: row.matchStatus,
          matchMessage: row.matchMessage,
        };
      });

      const rosterPayload: Omit<PerformanceScoreRoster, "id"> = {
        scoreKind: WRITTEN_EXAM_SCORE_KIND,
        title: safeTitle,
        subject: safeSubject,
        academicYear: year,
        semester,
        targetGrade,
        targetClass: classList.length === 1 ? classList[0] : fallbackClass,
        classes: classList,
        items: [
          {
            name: safeItemName,
            shortName: "논술형",
            maxScore: safeMaxScore,
          },
        ],
        totalMaxScore: safeMaxScore,
        rowCount: parsed.rows.length,
        matchedCount: saveableRows.length,
        unmatchedCount: parsed.rows.length - saveableRows.length,
        sourceFileName: parsed.sourceFileName,
        rows: rosterRows,
        uploadedBy: currentUser?.uid || "",
        uploadedByEmail: currentUser?.email || "",
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      const batchQueue = createBatchQueue();
      batchQueue.set(rosterRef, rosterPayload);
      rosterRows.forEach((row) => {
        const payload = buildStudentScorePayload(
          { id: rosterId, ...rosterPayload },
          row,
          timestamp,
        );
        if (!payload) return;
        batchQueue.set(
          doc(
            db,
            "users",
            row.uid,
            PERFORMANCE_SCORE_USER_COLLECTION,
            rosterId,
          ),
          payload,
        );
      });
      await batchQueue.commit();
      setParsed(null);
      await loadRosters();
      setSelectedRosterId(rosterId);
      showToast({
        tone: "success",
        title: "논술형 점수를 저장했습니다.",
        message: `${saveableRows.length}명의 학생 화면에 점수가 표시됩니다.`,
      });
    } catch (error) {
      console.error("Failed to save written exam essay scores:", error);
      showToast({
        tone: "error",
        title: "논술형 점수 저장에 실패했습니다.",
        message:
          "권한, 네트워크 상태, Firestore rules 배포 상태를 확인해 주세요.",
      });
    } finally {
      setSaving(false);
    }
  };

  const startEditing = () => {
    if (!selectedRoster) return;
    setDraftRows((selectedRoster.rows || []).map((row) => ({ ...row })));
    setEditing(true);
  };

  const updateDraftScore = (rowIndex: number, value: string) => {
    const score = toFiniteScore(value);
    setDraftRows((current) =>
      current.map((row, index) => {
        if (index !== rowIndex) return row;
        const max = row.totalMaxScore || selectedRoster?.totalMaxScore || 0;
        const safeScore = score === null ? 0 : roundScore(score);
        return {
          ...row,
          items: [
            {
              name: selectedRoster?.items?.[0]?.name || "논술형 점수",
              shortName: "논술형",
              score: safeScore,
              maxScore: max,
              scoreEntered: score !== null,
            },
          ],
          enteredScoreCount: score === null ? 0 : 1,
          totalScore: safeScore,
          totalMaxScore: max,
        };
      }),
    );
  };

  const updateDraftFeedback = (rowIndex: number, value: string) => {
    setDraftRows((current) =>
      current.map((row, index) =>
        index === rowIndex
          ? {
              ...row,
              feedback: value.slice(0, 1000),
              evidence: value.slice(0, 1000),
            }
          : row,
      ),
    );
  };

  const saveRosterEdits = async () => {
    if (!selectedRoster || savingEdits) return;
    setSavingEdits(true);
    try {
      const timestamp = serverTimestamp();
      const nextRows = draftRows.map((row) => ({
        ...row,
        feedback: String(row.feedback || "").slice(0, 1000),
        evidence: String(row.evidence || row.feedback || "").slice(0, 1000),
      }));
      const scoredRows = nextRows.filter((row) => getRosterRowHasScore(row));
      const batchQueue = createBatchQueue();
      batchQueue.update(doc(db, rosterCollectionPath, selectedRoster.id), {
        rows: nextRows,
        rowCount: nextRows.length,
        matchedCount: scoredRows.filter((row) => row.uid).length,
        unmatchedCount:
          nextRows.length - scoredRows.filter((row) => row.uid).length,
        updatedAt: timestamp,
      });
      nextRows.forEach((row) => {
        if (!row.uid) return;
        const userScoreRef = doc(
          db,
          "users",
          row.uid,
          PERFORMANCE_SCORE_USER_COLLECTION,
          selectedRoster.id,
        );
        const payload = buildStudentScorePayload(
          selectedRoster,
          row,
          timestamp,
        );
        if (payload) {
          batchQueue.set(userScoreRef, payload);
        } else {
          batchQueue.delete(userScoreRef);
        }
      });
      await batchQueue.commit();
      setEditing(false);
      await loadRosters();
      showToast({
        tone: "success",
        title: "점수 수정을 저장했습니다.",
        message: "학생 화면의 논술형 점수도 함께 갱신되었습니다.",
      });
    } catch (error) {
      console.error("Failed to save written exam essay edits:", error);
      showToast({
        tone: "error",
        title: "점수 수정 저장에 실패했습니다.",
        message: "권한과 네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      });
    } finally {
      setSavingEdits(false);
    }
  };

  const handleReviewObjection = async (
    objection: TeacherObjection,
    status: "accepted" | "rejected",
  ) => {
    if (reviewingObjectionId) return;
    let changedTotalScore: number | null = null;
    let reviewMemo = "";
    if (status === "accepted") {
      const rawScore = await promptDialog({
        title: "변경 후 점수 입력",
        message:
          "점수표에서 실제 점수를 먼저 수정·저장한 뒤, 학생 화면에 반영된 변경 후 총점을 입력해 주세요.",
        inputLabel: "변경 후 총점",
        initialValue: String(objection.totalScore ?? ""),
        inputMode: "decimal",
        confirmLabel: "점수 확인",
        required: true,
        requiredMessage: "변경 후 총점을 입력해 주세요.",
        tone: "info",
      });
      if (rawScore === null) return;
      changedTotalScore = toFiniteScore(rawScore);
      if (changedTotalScore === null) {
        showToast({
          tone: "warning",
          title: "변경 후 점수를 확인해 주세요.",
          message: "수용 처리에는 변경 후 총점이 필요합니다.",
        });
        return;
      }
    }
    const memo = await promptDialog({
      title: status === "accepted" ? "처리 메모 입력" : "반려 사유 입력",
      message:
        status === "accepted"
          ? "학생에게 함께 보낼 처리 메모가 있으면 입력해 주세요."
          : "학생에게 전달할 반려 사유를 입력해 주세요.",
      inputLabel: status === "accepted" ? "처리 메모" : "반려 사유",
      initialValue: objection.reviewMemo || "",
      multiline: true,
      maxLength: 240,
      required: status === "rejected",
      requiredMessage: "반려 사유를 입력해 주세요.",
      confirmLabel: "확인",
      tone: status === "accepted" ? "info" : "danger",
    });
    if (memo === null) return;
    reviewMemo = memo.trim().slice(0, 240);

    setReviewingObjectionId(objection.id);
    try {
      await reviewPerformanceScoreObjection(config, {
        objectionId: objection.id,
        status,
        changedTotalScore,
        reviewMemo,
      });
      await loadObjections();
      showToast({
        tone: "success",
        title:
          status === "accepted"
            ? "이의 제기를 수용했습니다."
            : "이의 제기를 반려했습니다.",
        message: "학생에게 처리 결과 알림을 보냈습니다.",
      });
    } catch (error) {
      console.error("Failed to review written exam essay objection:", error);
      showToast({
        tone: "error",
        title: "이의 처리에 실패했습니다.",
        message:
          "수용 처리라면 점수표 수정 저장이 먼저 완료되었는지 확인해 주세요.",
      });
    } finally {
      setReviewingObjectionId("");
    }
  };

  const markRequestReviewed = async (item: TeacherAnswerSheetRequest) => {
    if (reviewingRequestId) return;
    const memo = await promptDialog({
      title: "답안지 확인 요청 처리",
      message: `${item.studentName} 학생의 답안지 확인 요청을 확인 완료로 표시합니다. 남길 메모가 있으면 입력해 주세요.`,
      inputLabel: "처리 메모",
      initialValue: item.reviewMemo || "",
      multiline: true,
      maxLength: 240,
      confirmLabel: "확인 완료",
      tone: "info",
    });
    if (memo === null) return;
    setReviewingRequestId(item.id);
    try {
      await updateDoc(doc(db, requestCollectionPath, item.id), {
        status: "reviewed",
        reviewedAt: serverTimestamp(),
        reviewedBy: currentUser?.uid || "",
        reviewMemo: memo.trim().slice(0, 240),
        updatedAt: serverTimestamp(),
      });
      await loadAnswerSheetRequests();
      showToast({
        tone: "success",
        title: "답안지 확인 요청을 처리했습니다.",
        message: "요청 목록 상태가 갱신되었습니다.",
      });
    } catch (error) {
      console.error("Failed to mark answer sheet request reviewed:", error);
      showToast({
        tone: "error",
        title: "요청 처리에 실패했습니다.",
        message: "권한과 네트워크 상태를 확인해 주세요.",
      });
    } finally {
      setReviewingRequestId("");
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 break-keep">
            <h2 className="text-2xl font-black text-slate-900">
              정기시험 논술형 점수 관리
            </h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-500">
              학급별 엑셀 파일에서 번호, 이름, 점수, 피드백을 읽어 학생별 점수
              확인 화면에 반영합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setObjectionModalOpen(true);
                void loadObjections();
              }}
              className="relative inline-flex min-h-10 items-center justify-center rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-700 transition hover:bg-rose-50"
            >
              이의 제기
              {pendingObjectionCount > 0 && (
                <span className="ml-2 rounded-full bg-rose-600 px-2 py-0.5 text-xs text-white">
                  {pendingObjectionCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setRequestModalOpen(true);
                void loadAnswerSheetRequests();
              }}
              className="relative inline-flex min-h-10 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50"
            >
              답안지 요청
              {pendingRequestCount > 0 && (
                <span className="ml-2 rounded-full bg-blue-600 px-2 py-0.5 text-xs text-white">
                  {pendingRequestCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-base font-black text-slate-900">엑셀 업로드</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <label className="text-xs font-black text-slate-600">
                학년
                <select
                  value={targetGrade}
                  onChange={(event) => setTargetGrade(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                >
                  {DEFAULT_GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}학년
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black text-slate-600">
                기본 반
                <select
                  value={fallbackClass}
                  onChange={(event) => setFallbackClass(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                >
                  {DEFAULT_CLASS_OPTIONS.map((classValue) => (
                    <option key={classValue} value={classValue}>
                      {classValue}반
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black text-slate-600">
                점수표 이름
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                />
              </label>
              <label className="text-xs font-black text-slate-600">
                과목
                <input
                  type="text"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                />
              </label>
              <label className="text-xs font-black text-slate-600">
                점수 항목
                <input
                  type="text"
                  value={itemName}
                  onChange={(event) => setItemName(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                />
              </label>
              <label className="text-xs font-black text-slate-600">
                만점
                <input
                  type="number"
                  min="1"
                  step="0.5"
                  value={maxScore}
                  onChange={(event) => setMaxScore(event.target.value)}
                  className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                />
              </label>
            </div>
            <label className="mt-4 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-blue-200 bg-blue-50 px-4 py-5 text-center text-sm font-black text-blue-700 transition hover:bg-blue-100">
              <i
                className="fas fa-file-excel mb-2 text-xl"
                aria-hidden="true"
              />
              {parsing ? "파일 읽는 중..." : "엑셀 파일 선택"}
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => void handleUpload(event)}
                disabled={parsing || saving || studentsLoading}
                className="sr-only"
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-black text-slate-900">
                저장된 점수표
              </h3>
              <button
                type="button"
                onClick={() => void loadRosters()}
                disabled={rostersLoading}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                새로고침
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {rostersLoading ? (
                <div className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm font-bold text-slate-400">
                  불러오는 중입니다.
                </div>
              ) : rosters.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-sm font-bold text-slate-400">
                  저장된 논술형 점수표가 없습니다.
                </div>
              ) : (
                rosters.map((roster) => (
                  <button
                    key={roster.id}
                    type="button"
                    onClick={() => {
                      setSelectedRosterId(roster.id);
                      setEditing(false);
                    }}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                      selectedRosterId === roster.id
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-black text-slate-900">
                      {roster.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
                      <span>{roster.subject || "과목 없음"}</span>
                      <span>{roster.rowCount || 0}행</span>
                      <span>
                        {formatPerformanceScore(roster.totalMaxScore)}점 만점
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          {parsed && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-base font-black text-blue-950">
                    업로드 미리보기
                  </h3>
                  <p className="mt-1 text-sm font-bold text-blue-800">
                    전체 {parsedSummary.rowCount}행, 연결{" "}
                    {parsedSummary.matchedCount}행, 저장 가능{" "}
                    {parsedSummary.saveableCount}행
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setParsed(null)}
                    disabled={saving}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50 disabled:opacity-50"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveParsedScores()}
                    disabled={saving || parsedSummary.saveableCount === 0}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                  >
                    {saving ? "저장 중..." : "학생 화면에 저장"}
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto rounded-lg border border-blue-100 bg-white">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th className="px-3 py-3 text-left">학생</th>
                      <th className="px-3 py-3 text-right">점수</th>
                      <th className="px-3 py-3 text-left">피드백</th>
                      <th className="px-3 py-3 text-center">연결</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.rows.slice(0, 30).map((row) => (
                      <tr key={row.rowKey}>
                        <td className="px-3 py-3 font-bold text-slate-800">
                          {row.grade}학년 {row.class}반 {row.number}번{" "}
                          {row.studentName}
                        </td>
                        <td className="px-3 py-3 text-right font-black text-blue-700">
                          {formatPerformanceScore(row.totalScore)} /{" "}
                          {formatPerformanceScore(row.totalMaxScore)}
                        </td>
                        <td className="max-w-xs px-3 py-3 text-slate-600">
                          <span className="line-clamp-2">
                            {row.feedback || "-"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                              row.uid
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-rose-50 text-rose-700"
                            }`}
                          >
                            {row.uid ? "연결" : "미연결"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {selectedRoster?.title || "점수표를 선택해 주세요."}
                </h3>
                {selectedRoster && (
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {selectedRoster.subject || "과목 없음"} ·{" "}
                    {formatPerformanceScore(selectedRoster.totalMaxScore)}점
                    만점
                  </p>
                )}
              </div>
              {selectedRoster && (
                <div className="flex flex-wrap gap-2">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(false);
                          setDraftRows([]);
                        }}
                        disabled={savingEdits}
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveRosterEdits()}
                        disabled={savingEdits}
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:bg-slate-300"
                      >
                        {savingEdits ? "저장 중..." : "수정 저장"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-blue-200 bg-white px-4 text-sm font-black text-blue-700 transition hover:bg-blue-50"
                    >
                      점수 수정
                    </button>
                  )}
                </div>
              )}
            </div>

            {!selectedRoster ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-12 text-center text-sm font-bold text-slate-400">
                왼쪽에서 점수표를 선택하거나 새 엑셀 파일을 업로드해 주세요.
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th className="px-3 py-3 text-left">학생</th>
                      <th className="px-3 py-3 text-right">점수</th>
                      <th className="px-3 py-3 text-left">피드백</th>
                      <th className="px-3 py-3 text-center">서명</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.map((row, index) => {
                      const signatureComplete = row.uid
                        ? Boolean(signatureStatusByUid[row.uid])
                        : false;
                      return (
                        <tr key={`${row.rowNumber}-${row.uid || index}`}>
                          <td className="px-3 py-3 font-bold text-slate-800">
                            {row.grade}학년 {row.class}반 {row.number}번{" "}
                            {row.studentName || "(이름 없음)"}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {editing ? (
                              <input
                                type="number"
                                step="0.5"
                                value={
                                  row.enteredScoreCount === 0
                                    ? ""
                                    : String(row.totalScore ?? "")
                                }
                                onChange={(event) =>
                                  updateDraftScore(index, event.target.value)
                                }
                                className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-right text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                              />
                            ) : (
                              <span className="font-black text-blue-700">
                                {formatPerformanceScore(row.totalScore)} /{" "}
                                {formatPerformanceScore(row.totalMaxScore)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {editing ? (
                              <textarea
                                value={String(row.feedback || "")}
                                onChange={(event) =>
                                  updateDraftFeedback(index, event.target.value)
                                }
                                rows={2}
                                className="w-full min-w-64 resize-none rounded-lg border border-slate-200 px-2 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50"
                              />
                            ) : (
                              <span className="whitespace-pre-wrap break-keep text-slate-600">
                                {row.feedback || "-"}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${
                                signatureComplete
                                  ? "border-blue-200 bg-blue-50 text-blue-700"
                                  : signaturesLoading
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500"
                              }`}
                            >
                              {signatureComplete
                                ? "완료"
                                : signaturesLoading
                                  ? "확인 중"
                                  : "대기"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>

      {objectionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  정기시험 논술형 이의 제기
                </h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  학생이 보낸 이의 신청을 확인하고 수용 또는 반려 처리합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setObjectionModalOpen(false);
                  closePanelParam();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                aria-label="이의 목록 닫기"
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-auto px-5 py-4">
              {objectionsLoading ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  불러오는 중입니다.
                </div>
              ) : objections.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm font-bold text-slate-400">
                  접수된 이의 제기가 없습니다.
                </div>
              ) : (
                <table className="min-w-[920px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th className="px-3 py-3 text-left">학생</th>
                      <th className="px-3 py-3 text-left">점수</th>
                      <th className="px-3 py-3 text-left">사유</th>
                      <th className="px-3 py-3 text-center">상태</th>
                      <th className="px-3 py-3 text-right">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {objections.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-bold text-slate-800">
                          {item.studentName}
                          <div className="text-xs text-slate-500">
                            {item.grade}학년 {item.class}반 {item.number}번
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-black text-slate-900">
                            {item.scoreTitle}
                          </div>
                          <div className="text-xs font-bold text-blue-700">
                            {item.scoreLabel}
                          </div>
                        </td>
                        <td className="max-w-sm px-3 py-3 text-slate-700">
                          <p className="whitespace-pre-wrap break-keep">
                            {item.reason || "사유 없음"}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${getStatusClassName(item.status)}`}
                          >
                            {item.status === "accepted"
                              ? "수용"
                              : item.status === "rejected"
                                ? "반려"
                                : "대기"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.status === "pending" ? (
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleReviewObjection(item, "accepted")
                                }
                                disabled={Boolean(reviewingObjectionId)}
                                className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                수용
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleReviewObjection(item, "rejected")
                                }
                                disabled={Boolean(reviewingObjectionId)}
                                className="inline-flex h-9 items-center rounded-lg border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                반려
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">
                              {formatDateTime(item.reviewedAt) || "처리 완료"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      {requestModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 px-4 py-6">
          <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  답안지 확인 요청
                </h3>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  학생이 답안지 확인을 요청한 사유를 확인합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRequestModalOpen(false);
                  closePanelParam();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                aria-label="답안지 확인 요청 목록 닫기"
              >
                <i className="fas fa-times" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-auto px-5 py-4">
              {requestsLoading ? (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  불러오는 중입니다.
                </div>
              ) : answerSheetRequests.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm font-bold text-slate-400">
                  접수된 답안지 확인 요청이 없습니다.
                </div>
              ) : (
                <table className="min-w-[900px] w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-black text-slate-500">
                    <tr>
                      <th className="px-3 py-3 text-left">학생</th>
                      <th className="px-3 py-3 text-left">점수</th>
                      <th className="px-3 py-3 text-left">요청 사유</th>
                      <th className="px-3 py-3 text-center">상태</th>
                      <th className="px-3 py-3 text-right">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {answerSheetRequests.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-3 font-bold text-slate-800">
                          {item.studentName}
                          <div className="text-xs text-slate-500">
                            {item.grade}학년 {item.class}반 {item.number}번
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-black text-slate-900">
                            {item.scoreTitle}
                          </div>
                          <div className="text-xs font-bold text-blue-700">
                            {item.scoreLabel}
                          </div>
                        </td>
                        <td className="max-w-sm px-3 py-3 text-slate-700">
                          <p className="whitespace-pre-wrap break-keep">
                            {item.reason || "사유 없음"}
                          </p>
                          <div className="mt-1 text-xs font-bold text-slate-400">
                            {formatDateTime(item.requestedAt)}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${getStatusClassName(item.status)}`}
                          >
                            {item.status === "reviewed" ? "확인 완료" : "대기"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          {item.status === "pending" ? (
                            <button
                              type="button"
                              onClick={() => void markRequestReviewed(item)}
                              disabled={Boolean(reviewingRequestId)}
                              className="inline-flex h-9 items-center rounded-lg border border-blue-200 bg-white px-3 text-xs font-black text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                            >
                              확인 완료
                            </button>
                          ) : (
                            <span className="text-xs font-bold text-slate-400">
                              {formatDateTime(item.reviewedAt) || "처리 완료"}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};

export default WrittenExamEssayScoreManager;
