import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../../../contexts/AuthContext";
import RefreshButton from "../../../components/common/RefreshButton";
import InfoHelp from "../../../components/common/InfoHelp";
import { useAppToast } from "../../../components/common/AppToastProvider";
import { getAssessmentSemesterId } from "../../../lib/assessmentRelease";
import { isSemesterArchive } from "../../../lib/semesterArchive";
import {
  readWrittenExamInfoWorkbook,
  readWrittenExamResponsesWorkbook,
} from "../../../lib/writtenExamAnalysisWorkbook";
import { acquirePageScrollLock } from "../../../lib/pageScrollLock";
import {
  type WrittenExamQuestionInfo,
  type WrittenExamImportedStudent,
} from "../../../lib/writtenExamAnalysisImport";
import {
  processWrittenExamPaper,
  renderWrittenExamCrop,
  normalizeWrittenExamPaperRect,
  type WrittenExamPaperCrop,
  type WrittenExamPaperPage,
  type WrittenExamPaperRect,
} from "../../../lib/writtenExamPaperCrop";
import {
  listWrittenExamAnalyses,
  loadWrittenExamAnalysis,
  saveWrittenExamAnalysis,
  loadWrittenExamAnalysisAsset,
  type WrittenExamAnalysisMetadata,
} from "../../../lib/writtenExamAnalysisStore";
import {
  getQuizClassAchievement,
  type QuizClassAchievement,
} from "../../../lib/quizClassAnalysis";
import { projectWrittenExamAnalysis } from "../../../lib/writtenExamAnalysisProjection";
import type { AchievementAnalysis } from "../../../lib/achievementAnalysis";
import QuizAchievementAnalysis from "./QuizAchievementAnalysis";
import "./QuizClassAnalysis.css";
import "./writtenExamAnalysis.css";

const reports = [
  "전체 결과",
  "문항별 분석",
  "성취기준별 분석",
  "학생별 추정 수준",
  "S–P표",
  "추정 분할점수",
  "학급별 결과·비교",
];
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "자료를 처리하지 못했습니다. 다시 시도해 주세요.";
const today = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
const fmt = (value: number | null | undefined) =>
  value == null ? "—" : Number(value.toFixed(2));

export default function WrittenExamAnalysis({
  navigation,
}: {
  navigation: ReactNode;
}) {
  const { config, currentUser, authGeneration } = useAuth();
  const { showToast } = useAppToast();
  const semesterId = getAssessmentSemesterId(config);
  const identity = `${currentUser?.uid}:${authGeneration}:${semesterId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const request = useRef(0);
  const [catalogRows, setCatalog] = useState<WrittenExamAnalysisMetadata[]>([]);
  const [catalogIdentity, setCatalogIdentity] = useState("");
  const catalog = catalogIdentity === identity ? catalogRows : [];
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [view, setView] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mockError, setMockError] = useState("");
  const [loaded, setLoaded] = useState<{
    metadata: WrittenExamAnalysisMetadata;
    students: WrittenExamImportedStudent[];
    mock: QuizClassAchievement | null;
    classId: string;
    identity: string;
  } | null>(null);
  const [upload, setUpload] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);
  const selected = catalog.find((exam) => exam.id === examId);

  const load = useCallback(
    async (target: string, room: string, refreshCatalog = false) => {
      const run = ++request.current;
      const current = identity;
      setLoading(true);
      setError("");
      setMockError("");
      try {
        const list = refreshCatalog
          ? await listWrittenExamAnalyses(config)
          : null;
        if (run !== request.current || identityRef.current !== current) return;
        if (list) {
          setCatalog(list);
          setCatalogIdentity(current);
        }
        if (!target) return;
        const result = await loadWrittenExamAnalysis(
          config,
          target,
          room ? { classId: room } : {},
        );
        if (run !== request.current || identityRef.current !== current) return;
        let mock: QuizClassAchievement | null = null;
        try {
          mock = await getQuizClassAchievement(
            {
              semesterId,
              unitId: "exam_prep",
              category: "exam_prep",
              examRound: "round_3",
              classIds: room ? [room] : [],
              ...(room ? {} : { grade: result.metadata.grade }),
            },
            current,
            true,
          );
          if (mock.semesterId !== semesterId || mock.complete === false)
            throw new Error("모의고사 분석 범위를 확인하지 못했습니다.");
        } catch {
          mock = null;
          if (run === request.current && identityRef.current === current)
            setMockError(
              "모의고사 자료를 불러오지 못해 정기시험 자료로만 추정했습니다. 새로고침으로 다시 시도해 주세요.",
            );
        }
        if (run !== request.current || identityRef.current !== current) return;
        setLoaded({ ...result, mock, classId: room, identity: current });
      } catch (failure) {
        if (run === request.current && identityRef.current === current)
          setError(message(failure));
      } finally {
        if (run === request.current && identityRef.current === current)
          setLoading(false);
      }
    },
    [identity, config, semesterId],
  );

  useEffect(() => {
    setCatalog([]);
    setExamId("");
    setClassId("");
    setLoaded(null);
    setUpload(false);
    setInspect(null);
    void load("", "", true);
    return () => {
      ++request.current;
    };
  }, [identity]);

  const projection = useMemo(
    () =>
      loaded?.identity === identity
        ? projectWrittenExamAnalysis({
            ...loaded.metadata,
            students: loaded.students,
            semesterId,
            mock: loaded.mock,
          })
        : null,
    [loaded, semesterId, identity],
  );
  const current =
    loaded &&
    loaded.identity === identity &&
    loaded.metadata.id === examId &&
    loaded.classId === classId;
  const help = (
    <InfoHelp
      label="정기시험 추정 수준 기준"
      sections={[
        {
          title: "추정 분할점수",
          items: [
            "문항정보표의 배점·목표 성취수준을 기존 추정 모형에 넣어 시험지별 분할점수를 계산합니다. 고정 90·80·70·60점은 사용하지 않습니다.",
            "목표 수준이 없으면 난이도 기반 가정값을 쓰므로 추정 근거 부족으로 표시합니다. 학교의 공식 성적·분할점수는 바뀌지 않습니다.",
          ],
        },
        {
          title: "모의고사 연결",
          items: [
            "같은 학기·학년·반·번호·이름이 일치하고 중복되지 않는 학생의 시험일 이전 모의고사 최초 유효 응시만 연결합니다. 모의고사와 정기시험 선택형의 점수·추정 분할점수를 각각 100점으로 환산하고 평가마다 같은 비중으로 평균합니다.",
            "유효한 모의고사 기록이 없으면 정기시험 자료만 사용합니다. 서로 다른 시험을 통계적으로 동등화한 점수나 공식 성취수준은 아닙니다.",
          ],
        },
      ]}
    />
  );

  return (
    <section className="written-exam-analysis">
      <div className="ws-page-header">
        <h2>정기시험 점수 관리</h2>
        <div className="written-exam-actions">
          <RefreshButton
            loading={loading}
            label="정기시험 분석 새로고침"
            onClick={() => load(examId, classId, true)}
          />
          {!isSemesterArchive && (
            <button
              type="button"
              className="qca-primary"
              onClick={() => setUpload(true)}
            >
              분석 자료 업로드
            </button>
          )}
        </div>
      </div>
      {navigation}
      <div className="written-exam-filters">
        <label>
          평가명
          <select
            value={examId}
            disabled={loading}
            onChange={(event) => {
              const id = event.target.value;
              setExamId(id);
              setClassId("");
              setLoaded(null);
              setInspect(null);
              if (id) void load(id, "");
            }}
          >
            <option value="">평가 선택</option>
            {catalog.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title} · {exam.grade}학년
              </option>
            ))}
          </select>
        </label>
        <label>
          학급
          <select
            value={classId}
            disabled={!selected || loading}
            onChange={(event) => {
              setClassId(event.target.value);
              setInspect(null);
              void load(examId, event.target.value);
            }}
          >
            <option value="">학년 전체</option>
            {selected?.classIds.map((id) => (
              <option key={id} value={id}>
                {id.split("-").at(-1)}반
              </option>
            ))}
          </select>
        </label>
        <label>
          분석 항목
          <select
            value={view}
            onChange={(event) => setView(Number(event.target.value))}
          >
            {reports.map((label, i) => (
              <option key={label} value={i}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="qca-error">
          {error}
        </p>
      )}
      {mockError && (
        <p role="alert" className="qca-error">
          {mockError}
        </p>
      )}
      {loading && <p role="status">분석 자료를 불러오는 중입니다.</p>}
      {!loading && !catalog.length && !error && (
        <p className="written-exam-empty">등록된 분석 자료가 없습니다.</p>
      )}
      {current && projection && (
        <div aria-busy={loading}>
          {view === 6 ? (
            <ClassComparison
              students={loaded.students}
              questions={loaded.metadata.questions}
            />
          ) : (
            <QuizAchievementAnalysis
              key={`${identity}:${examId}:${classId}`}
              scope={{
                semesterId,
                unitId: `written:${examId}`,
                category: "exam_prep",
                examRound: "round_4",
                classIds: classId ? [classId] : [],
                ...(classId ? {} : { grade: loaded.metadata.grade }),
              }}
              identityKey={identity}
              canEdit={false}
              suppliedData={projection.data}
              reportView={view}
              reportLabels={reports}
              suppliedHelp={help}
              onInspectQuestion={(id) => setInspect(Number(id))}
              renderEstimates={(analysis) => (
                <WrittenExamEstimates
                  analysis={analysis}
                  showCuts={view === 5}
                />
              )}
            />
          )}
        </div>
      )}
      {upload && catalogIdentity === identity && (
        <WrittenExamUpload
          key={identity}
          existing={selected}
          onClose={() => setUpload(false)}
          onSaved={async (saved) => {
            if (identityRef.current !== identity) return;
            setUpload(false);
            setExamId(saved.id);
            setClassId("");
            showToast({ tone: "success", title: "분석 자료를 저장했습니다." });
            await load(saved.id, "", true);
          }}
        />
      )}
      {inspect !== null && current && loaded && (
        <PaperPreview
          number={inspect}
          metadata={loaded.metadata}
          onClose={() => setInspect(null)}
        />
      )}
    </section>
  );
}

function WrittenExamEstimates({
  analysis,
  showCuts,
}: {
  analysis: AchievementAnalysis;
  showCuts: boolean;
}) {
  return (
    <div
      className="qca-table-scroll"
      tabIndex={0}
      role="region"
      aria-label="학생별 정기시험 추정 수준"
    >
      <table className="qca-table qaa-table">
        <thead>
          <tr>
            <th>학급·번호·이름</th>
            <th>정기시험 선택형 환산점수</th>
            <th>누적 환산점수</th>
            <th>추정 수준</th>
            {showCuts &&
              ["A/B", "B/C", "C/D", "D/E"].map((label) => (
                <th key={label}>{label}</th>
              ))}
            <th>분석 자료</th>
          </tr>
        </thead>
        <tbody>
          {analysis.cumulativeScores.map((row) => {
            const regular = row.rounds.find(
              (round) => round.examRound === "round_4",
            );
            const mocks = row.rounds.filter(
              (round) => round.examRound !== "round_4",
            );
            return (
              <tr key={row.student.uid}>
                <th>
                  {row.student.classId?.split("-").at(-1)}반{" "}
                  {row.student.number}번 {row.student.name}
                </th>
                <td>{fmt(regular?.scorePercent)}</td>
                <td>{fmt(row.scorePercent)}</td>
                <td>{row.level || "자료 부족"}</td>
                {showCuts &&
                  (["A", "B", "C", "D"] as const).map((level) => (
                    <td key={level}>{fmt(row.cutScores?.[level])}</td>
                  ))}
                <td>
                  {mocks.length
                    ? `모의고사 ${mocks.length}회 + 정기시험`
                    : "정기시험"}
                  {row.rounds.some((round) => round.assumedTargets > 0) &&
                    " · 목표 수준 일부 추정"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClassComparison({
  students,
  questions,
}: {
  students: WrittenExamImportedStudent[];
  questions: WrittenExamQuestionInfo[];
}) {
  const maximum = questions.reduce((sum, q) => sum + q.points, 0);
  const classes = [...new Set(students.map((student) => student.class))].sort(
    (a, b) => Number(a) - Number(b),
  );
  return (
    <>
      <h3>학급별 결과·비교</h3>
      <div className="qca-table-scroll" tabIndex={0}>
        <table className="qca-table">
          <thead>
            <tr>
              <th>학급</th>
              <th>인원</th>
              <th>평균</th>
              <th>표준편차</th>
              <th>최저</th>
              <th>최고</th>
              {questions.map((q) => (
                <th key={q.number}>{q.number}번 정답률</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...classes, "전체"].map((room) => {
              const rows = students.filter(
                (student) => room === "전체" || student.class === room,
              );
              const scores = rows.flatMap((student) =>
                student.totalScore === null
                  ? []
                  : [(student.totalScore / maximum) * 100],
              );
              const mean = scores.length
                ? scores.reduce((a, b) => a + b, 0) / scores.length
                : null;
              const sd =
                mean !== null && scores.length > 1
                  ? Math.sqrt(
                      scores.reduce(
                        (sum, value) => sum + (value - mean) ** 2,
                        0,
                      ) /
                        (scores.length - 1),
                    )
                  : null;
              return (
                <tr key={room}>
                  <th>{room === "전체" ? room : `${room}반`}</th>
                  <td>{scores.length}</td>
                  <td>{fmt(mean)}</td>
                  <td>{fmt(sd)}</td>
                  <td>{scores.length ? fmt(Math.min(...scores)) : "—"}</td>
                  <td>{scores.length ? fmt(Math.max(...scores)) : "—"}</td>
                  {questions.map((q) => {
                    const answers = rows
                      .map(
                        (student) =>
                          student.responses.find(
                            (r) => r.questionNumber === q.number,
                          )?.correct,
                      )
                      .filter((v) => typeof v === "boolean");
                    return (
                      <td key={q.number}>
                        {answers.length
                          ? `${fmt((answers.filter(Boolean).length / answers.length) * 100)}%`
                          : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement;
    const release = acquirePageScrollLock();
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      release();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`written-exam-dialog${wide ? " written-exam-dialog--wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="written-exam-dialog-heading">
        <h2>{title}</h2>
        <button className="qca-secondary" type="button" onClick={onClose}>
          닫기
        </button>
      </div>
      {children}
    </dialog>,
    document.body,
  );
}

function useBlobUrl(blob: Blob | null | undefined) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) {
      setUrl("");
      return;
    }
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}

function PaperPreview({
  number,
  metadata,
  onClose,
}: {
  number: number;
  metadata: WrittenExamAnalysisMetadata;
  onClose: () => void;
}) {
  const { config } = useAuth();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const url = useBlobUrl(blob);
  const crop = metadata.crops.find((entry) => entry.questionNumber === number);
  useEffect(() => {
    let active = true;
    setBlob(null);
    setError("");
    const file = metadata.files.find(
      (entry) => entry.kind === "page" && entry.page === crop?.page,
    );
    if (!crop || !file) {
      setError("등록된 원안지 이미지가 없습니다.");
      return;
    }
    if (crop.status !== "ready") {
      setError(
        "문항 영역 확인이 필요합니다. 분석 자료 업로드에서 영역을 확인해 주세요.",
      );
      return;
    }
    void loadWrittenExamAnalysisAsset(
      config,
      metadata.id,
      metadata.revision,
      file.fileName,
    )
      .then((page) => renderWrittenExamCrop(page, crop))
      .then((result) => {
        if (active) setBlob(result);
      })
      .catch((failure) => {
        if (active) setError(message(failure));
      });
    return () => {
      active = false;
    };
  }, [metadata.id, metadata.revision, number, retry]);
  return (
    <Dialog title={`${number}번 문항`} onClose={onClose}>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            className="qca-secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            다시 시도
          </button>
        </div>
      ) : url ? (
        <img
          className="written-exam-question-image"
          src={url}
          alt={`${number}번 원안지 문항, 정답 선지 강조`}
        />
      ) : (
        <p role="status">문항을 불러오는 중입니다.</p>
      )}
    </Dialog>
  );
}

function WrittenExamUpload({
  existing,
  onClose,
  onSaved,
}: {
  existing?: WrittenExamAnalysisMetadata;
  onClose: () => void;
  onSaved: (metadata: WrittenExamAnalysisMetadata) => Promise<void>;
}) {
  const { config } = useAuth();
  const [title, setTitle] = useState(existing?.title || "");
  const [replaceExisting, setReplaceExisting] = useState(Boolean(existing));
  const [grade, setGrade] = useState(existing?.grade || "3");
  const [examDate, setExamDate] = useState(existing?.examDate || today());
  const [infoFile, setInfoFile] = useState<File | null>(null);
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [questions, setQuestions] = useState<WrittenExamQuestionInfo[]>([]);
  const [students, setStudents] = useState<WrittenExamImportedStudent[]>([]);
  const [pages, setPages] = useState<WrittenExamPaperPage[]>([]);
  const [crops, setCrops] = useState<WrittenExamPaperCrop[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const close = () => {
    if (!busy) onClose();
  };
  const prepare = async () => {
    if (
      !infoFile ||
      !answerFile ||
      !title.trim() ||
      !/^\d+$/.test(grade) ||
      !examDate
    ) {
      setError("평가명·학년·시험일과 두 엑셀 파일을 확인해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setProgress("엑셀 자료 확인 중");
    controller.current = new AbortController();
    try {
      const info = await readWrittenExamInfoWorkbook(infoFile);
      const answer = await readWrittenExamResponsesWorkbook(answerFile, {
        targetGrade: grade,
        questions: info.questions,
      });
      setQuestions(info.questions);
      setStudents(answer.students);
      const paper = pdfFile
        ? await processWrittenExamPaper(pdfFile, info.questions, {
            signal: controller.current.signal,
            onProgress: (page, total) =>
              setProgress(`PDF ${page}/${total}쪽 처리 중`),
          })
        : { pages: [], crops: [], warnings: [] };
      setPages(paper.pages);
      setCrops(paper.crops);
      setWarnings([...info.warnings, ...answer.warnings, ...paper.warnings]);
      setPreview(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    setProgress("분석 자료 저장 중");
    try {
      const saved = await saveWrittenExamAnalysis(config, {
        examId: replaceExisting ? existing?.id : undefined,
        expectedRevision: replaceExisting ? existing?.revision || null : null,
        title: title.trim(),
        grade,
        examDate,
        questions,
        students,
        crops,
        files: [
          ...(pdfFile
            ? [
                {
                  fileName: "paper.pdf",
                  blob: pdfFile as Blob,
                  kind: "pdf" as const,
                },
              ]
            : []),
          ...pages.map((page) => ({
            fileName: `page-${page.page}.webp`,
            blob: page.blob,
            kind: "page" as const,
            page: page.page,
          })),
        ],
      });
      await onSaved(saved);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };
  return (
    <Dialog title="정기시험 분석 자료 업로드" onClose={close} wide>
      {!preview && existing && (
        <label className="written-exam-save-target">
          저장 대상
          <select
            disabled={busy}
            value={replaceExisting ? "replace" : "new"}
            onChange={(event) =>
              setReplaceExisting(event.target.value === "replace")
            }
          >
            <option value="replace">선택한 평가 자료 교체</option>
            <option value="new">새 평가로 등록</option>
          </select>
        </label>
      )}
      {!preview ? (
        <div className="written-exam-upload-fields">
          <label>
            평가명
            <input
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </label>
          <label>
            학년
            <select
              value={grade}
              disabled={busy}
              onChange={(e) => setGrade(e.target.value)}
            >
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}학년
                </option>
              ))}
            </select>
          </label>
          <label>
            시험일
            <input
              type="date"
              value={examDate}
              disabled={busy}
              onChange={(e) => setExamDate(e.target.value)}
            />
          </label>
          <label>
            문항정보표 엑셀
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(e) => setInfoFile(e.target.files?.[0] || null)}
            />
          </label>
          <label>
            학생답 정오표 엑셀
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(e) => setAnswerFile(e.target.files?.[0] || null)}
            />
          </label>
          <label>
            원안지 PDF
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            />
          </label>
          <InfoHelp label="분석 자료 파일 형식">
            <p>
              문항정보표에는 문항번호·정답·배점을, 학생답 정오표에는
              반·번호·이름과 문항별 답 또는 정오를 넣어 주세요. 성취기준·목표
              성취수준·난이도를 함께 넣으면 해당 분석에 반영합니다. 서술형
              통계는 이번 분석에 포함하지 않습니다.
            </p>
          </InfoHelp>
        </div>
      ) : (
        <>
          <div className="written-exam-import-summary">
            <strong>{title}</strong>
            <span>
              {grade}학년 · {students.length}명 · 선택형 {questions.length}문항
              · PDF {pages.length}쪽
            </span>
          </div>
          {warnings.length > 0 && (
            <details>
              <summary>확인할 항목 {warnings.length}개</summary>
              <ul>
                {warnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          {pages.length > 0 && (
            <CropReview
              pages={pages}
              crops={crops}
              setCrops={setCrops}
              disabled={busy}
            />
          )}
        </>
      )}
      {error && (
        <p role="alert" className="qca-error">
          {error}
        </p>
      )}
      {busy && <p role="status">{progress}</p>}
      <div className="written-exam-dialog-actions">
        {preview && (
          <button
            className="qca-secondary"
            disabled={busy}
            onClick={() => setPreview(false)}
          >
            파일 다시 선택
          </button>
        )}
        <button
          className="qca-primary"
          disabled={
            busy || (preview && crops.some((crop) => crop.status !== "ready"))
          }
          onClick={() => void (preview ? save() : prepare())}
        >
          {preview
            ? replaceExisting
              ? "분석 자료 교체 저장"
              : "분석 자료 저장"
            : "자료 확인"}
        </button>
      </div>
    </Dialog>
  );
}

function CropReview({
  pages,
  crops,
  setCrops,
  disabled,
}: {
  pages: WrittenExamPaperPage[];
  crops: WrittenExamPaperCrop[];
  setCrops: (crops: WrittenExamPaperCrop[]) => void;
  disabled: boolean;
}) {
  const [number, setNumber] = useState(crops[0]?.questionNumber || 1);
  const [mode, setMode] = useState<"crop" | "highlight">("crop");
  const [highlightRect, setHighlightRect] = useState<WrittenExamPaperRect>({
    x: 0.1,
    y: 0.1,
    width: 0.3,
    height: 0.02,
  });
  const crop = crops.find((entry) => entry.questionNumber === number);
  const page = pages.find((entry) => entry.page === crop?.page) || pages[0];
  const url = useBlobUrl(page?.blob);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<WrittenExamPaperRect | null>(null);
  const update = (change: Partial<WrittenExamPaperCrop>) =>
    setCrops(
      crops.map((entry) =>
        entry.questionNumber === number ? { ...entry, ...change } : entry,
      ),
    );
  if (!crop) return null;
  const position = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    };
  };
  const style = (rect: WrittenExamPaperRect) => ({
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
  });
  return (
    <div className="written-exam-crop-review">
      <div className="written-exam-filters">
        <label>
          문항
          <select
            value={number}
            disabled={disabled}
            onChange={(e) => setNumber(Number(e.target.value))}
          >
            {crops.map((entry) => (
              <option key={entry.questionNumber} value={entry.questionNumber}>
                {entry.questionNumber}번 ·{" "}
                {entry.status === "ready" ? "확인됨" : "영역 확인 필요"}
              </option>
            ))}
          </select>
        </label>
        <label>
          페이지
          <select
            value={crop.page}
            disabled={disabled}
            onChange={(e) =>
              update({
                page: Number(e.target.value),
                status: "review",
                highlights: [],
              })
            }
          >
            {pages.map((entry) => (
              <option key={entry.page} value={entry.page}>
                {entry.page}쪽
              </option>
            ))}
          </select>
        </label>
        <label>
          드래그할 영역
          <select
            value={mode}
            disabled={disabled}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="crop">문항 전체</option>
            <option value="highlight">정답 선지 형광펜</option>
          </select>
        </label>
      </div>
      <div className="written-exam-crop-numbers">
        {(["x", "y", "width", "height"] as const).map((key, i) => (
          <label key={key}>
            {["왼쪽", "위", "너비", "높이"][i]} %
            <input
              type="number"
              min={key === "width" || key === "height" ? 0.1 : 0}
              max={100}
              step="0.1"
              value={Number(
                (
                  (mode === "crop" ? crop.rect : highlightRect)[key] * 100
                ).toFixed(1),
              )}
              disabled={disabled}
              onChange={(e) => {
                const value = Number(e.target.value) / 100;
                try {
                  if (mode === "highlight") {
                    setHighlightRect(
                      normalizeWrittenExamPaperRect({
                        ...highlightRect,
                        [key]: value,
                      }),
                    );
                    return;
                  }
                  update({
                    rect: normalizeWrittenExamPaperRect({
                      ...crop.rect,
                      [key]: value,
                    }),
                    status: "review",
                  });
                } catch {
                  /* Keep the last valid rectangle. */
                }
              }}
            />
          </label>
        ))}
      </div>
      {mode === "highlight" && (
        <button
          className="qca-secondary"
          type="button"
          disabled={disabled}
          onClick={() =>
            update({
              highlights: [...crop.highlights, highlightRect],
              status: "review",
            })
          }
        >
          입력한 영역에 형광펜 추가
        </button>
      )}
      <div
        className="written-exam-crop-page"
        onPointerDown={(event) => {
          if (disabled) return;
          start.current = position(event);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const end = position(event);
          setDrag({
            x: Math.min(start.current.x, end.x),
            y: Math.min(start.current.y, end.y),
            width: Math.abs(end.x - start.current.x),
            height: Math.abs(end.y - start.current.y),
          });
        }}
        onPointerUp={(event) => {
          if (!start.current) return;
          const end = position(event);
          const rect = {
            x: Math.min(start.current.x, end.x),
            y: Math.min(start.current.y, end.y),
            width: Math.abs(end.x - start.current.x),
            height: Math.abs(end.y - start.current.y),
          };
          start.current = null;
          setDrag(null);
          if (rect.width > 0.002 && rect.height > 0.002)
            update(
              mode === "crop"
                ? { rect, status: "review" }
                : { highlights: [...crop.highlights, rect], status: "review" },
            );
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(null);
        }}
      >
        {url && (
          <img
            src={url}
            alt={`${page.page}쪽 원안지. 문항 영역과 정답 강조 영역`}
            draggable={false}
          />
        )}
        <span className="written-exam-crop-outline" style={style(crop.rect)} />
        {crop.highlights.map((rect, i) => (
          <span
            key={i}
            className="written-exam-highlight"
            style={style(rect)}
          />
        ))}
        {drag && (
          <span
            className={
              mode === "crop"
                ? "written-exam-crop-outline"
                : "written-exam-highlight"
            }
            style={style(drag)}
          />
        )}
      </div>
      <div className="written-exam-dialog-actions">
        <button
          className="qca-secondary"
          disabled={disabled}
          onClick={() => update({ highlights: [], status: "review" })}
        >
          형광펜 지우기
        </button>
        <button
          className="qca-primary"
          disabled={disabled || !crop.highlights.length}
          onClick={() => update({ status: "ready", warnings: [] })}
        >
          이 문항 영역 확인
        </button>
      </div>
    </div>
  );
}
