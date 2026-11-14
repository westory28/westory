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
import { readWrittenExamInfoWorkbook } from "../../../lib/writtenExamAnalysisWorkbook";
import {
  listWrittenExamScoreSources,
  loadWrittenExamScoreAnalysis,
  loadWrittenExamScoreRoster,
  loadWrittenExamMaterials,
  saveWrittenExamScoreMaterials,
  scoreSourceClasses,
  questionsFromScoreSource,
  mergeScoreSourceQuestions,
  type WrittenExamScoreSource,
} from "../../../lib/writtenExamScoreSource";
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
import WrittenExamEssayAnalysis from "./WrittenExamEssayAnalysis";
import type {
  PerformanceScoreRoster,
  PerformanceScoreRosterRow,
} from "../../../lib/performanceScores";
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
const essayReports = ["전체 결과", "문항별 점수", "학급별 비교", "학생별 결과"];
type LoadedExam = {
  metadata: WrittenExamAnalysisMetadata;
  students: WrittenExamImportedStudent[];
  scoreRows: PerformanceScoreRosterRow[];
  scoreItems: PerformanceScoreRoster["items"];
  mock: QuizClassAchievement | null;
  mockReady: boolean;
  loadKind: "objective" | "essay";
  classId: string;
  identity: string;
};
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "자료를 처리하지 못했습니다. 다시 시도해 주세요.";
const fmt = (value: number | null | undefined) =>
  value == null ? "—" : Number(value.toFixed(2));

export default function WrittenExamAnalysis({
  navigation,
}: {
  navigation: ReactNode;
}) {
  const { config, currentUser, authGeneration } = useAuth();
  const semesterId = getAssessmentSemesterId(config);
  const identity = `${currentUser?.uid}:${authGeneration}:${semesterId}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const request = useRef(0);
  const [catalogRows, setCatalog] = useState<WrittenExamScoreSource[]>([]);
  const [catalogIdentity, setCatalogIdentity] = useState("");
  const catalog = catalogIdentity === identity ? catalogRows : [];
  const [examId, setExamId] = useState("");
  const [classId, setClassId] = useState("");
  const [view, setView] = useState(0);
  const [analysisKind, setAnalysisKind] = useState<"objective" | "essay">(
    "objective",
  );
  const [essayView, setEssayView] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mockError, setMockError] = useState("");
  const [loaded, setLoaded] = useState<LoadedExam | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const selected = catalog.find((exam) => exam.id === examId);

  const load = useCallback(
    async (
      target: string,
      room: string,
      refreshCatalog = false,
      reuse?: LoadedExam,
      kind = analysisKind,
    ) => {
      const run = ++request.current;
      const current = identity;
      setLoading(true);
      setError("");
      setMockError("");
      try {
        const list = refreshCatalog
          ? await listWrittenExamScoreSources(config)
          : null;
        if (run !== request.current || identityRef.current !== current) return;
        if (list) {
          setCatalog(list);
          setCatalogIdentity(current);
        }
        if (!target) return;
        const result =
          reuse ||
          (await loadWrittenExamScoreAnalysis(config, target, {
            ...(room ? { classId: room } : {}),
            analysisKind: kind,
          }));
        if (run !== request.current || identityRef.current !== current) return;
        let mock: QuizClassAchievement | null = null;
        if (kind === "objective" && result.students.length > 0) {
          try {
            if (!result.metadata.examDate) throw new Error("시험일 미등록");
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
                result.metadata.examDate
                  ? "모의고사 자료를 불러오지 못해 정기시험 자료로만 추정했습니다. 새로고침으로 다시 시도해 주세요."
                  : "모의고사 누적 추정에는 시험일이 필요합니다. 점수 등록 및 확인의 업로드 창에서 시험일을 등록해 주세요.",
              );
          }
        }
        if (run !== request.current || identityRef.current !== current) return;
        setLoaded({
          ...result,
          mock,
          mockReady: kind === "objective",
          loadKind: kind,
          classId: room,
          identity: current,
        });
      } catch (failure) {
        if (run === request.current && identityRef.current === current)
          setError(message(failure));
      } finally {
        if (run === request.current && identityRef.current === current)
          setLoading(false);
      }
    },
    [identity, config, semesterId, analysisKind],
  );

  useEffect(() => {
    setCatalog([]);
    setExamId("");
    setClassId("");
    setLoaded(null);
    setInspect(null);
    void load("", "", true);
    return () => {
      ++request.current;
    };
  }, [identity]);

  const projection = useMemo(
    () =>
      loaded?.identity === identity &&
      loaded.metadata.questions.length &&
      loaded.students.length
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
      </div>
      {navigation}
      <div className="written-exam-tab-toolbar">
        <div
          className="written-exam-kind-tabs"
          role="tablist"
          aria-label="분석 유형"
        >
          {(
            [
              ["objective", "선택형"],
              ["essay", "논술형"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              id={`written-exam-kind-${kind}`}
              role="tab"
              aria-controls="written-exam-analysis-panel"
              tabIndex={analysisKind === kind ? 0 : -1}
              onKeyDown={(event) => {
                if (loading) return;
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? "objective"
                    : event.key === "End"
                      ? "essay"
                      : kind === "objective"
                        ? "essay"
                        : "objective";
                const button = document.getElementById(
                  `written-exam-kind-${next}`,
                );
                button?.focus();
                button?.click();
              }}
              aria-selected={analysisKind === kind}
              className={analysisKind === kind ? "is-active" : ""}
              aria-disabled={loading}
              onClick={() => {
                if (loading) return;
                setAnalysisKind(kind);
                setInspect(null);
                if (
                  current &&
                  loaded &&
                  kind === "objective" &&
                  loaded.loadKind === "essay"
                ) {
                  void load(examId, classId, false, undefined, kind);
                } else if (
                  kind === "objective" &&
                  current &&
                  loaded &&
                  !loaded.mockReady
                ) {
                  void load(examId, classId, false, loaded, "objective");
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <RefreshButton
          loading={loading}
          label="정기시험 분석 새로고침"
          onClick={() => load(examId, classId, true)}
        />
      </div>
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
                {exam.title} · {exam.targetGrade}학년
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
            {selected &&
              scoreSourceClasses(selected).map((id) => (
                <option key={id} value={id}>
                  {id.split("-").at(-1)}반
                </option>
              ))}
          </select>
        </label>
        <label>
          분석 항목
          <select
            value={analysisKind === "objective" ? view : essayView}
            onChange={(event) =>
              analysisKind === "objective"
                ? setView(Number(event.target.value))
                : setEssayView(Number(event.target.value))
            }
          >
            {(analysisKind === "objective" ? reports : essayReports).map(
              (label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <div
        id="written-exam-analysis-panel"
        role="tabpanel"
        aria-labelledby={`written-exam-kind-${analysisKind}`}
        aria-busy={loading}
      >
        {error && (
          <p role="alert" className="qca-error">
            {error}
          </p>
        )}
        {analysisKind === "objective" && mockError && (
          <p role="alert" className="qca-error">
            {mockError}
          </p>
        )}
        {loading && <p role="status">분석 자료를 불러오는 중입니다.</p>}
        {!loading && !catalog.length && !error && (
          <p className="written-exam-empty">
            등록된 정기시험 점수표가 없습니다.
          </p>
        )}
        {analysisKind === "objective" && current && !projection && !loading && (
          <p className="written-exam-empty">
            정오 분석에 필요한 서답형 답안이 아직 등록되지 않았습니다. 등록된
            논술형 점수와 피드백은 논술형 탭에서 확인할 수 있습니다.
          </p>
        )}
        {analysisKind === "essay" && current && loaded && (
          <WrittenExamEssayAnalysis
            key={`${identity}:${examId}:${classId}`}
            rows={loaded.scoreRows || []}
            items={loaded.scoreItems || []}
            view={essayView}
          />
        )}
        {analysisKind === "objective" && current && projection && (
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
      </div>
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
        "문항 영역 확인이 필요합니다. 점수 등록 및 확인의 업로드 창에서 원안지를 확인해 주세요.",
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

export function WrittenExamMaterials() {
  const { config, currentUser, authGeneration } = useAuth();
  return (
    <WrittenExamMaterialEditor
      key={`${currentUser?.uid}:${authGeneration}:${getAssessmentSemesterId(config)}`}
    />
  );
}

function WrittenExamMaterialEditor() {
  const { config, currentUser, authGeneration } = useAuth();
  const { showToast } = useAppToast();
  const identity = `${currentUser?.uid}:${authGeneration}:${getAssessmentSemesterId(config)}`;
  const owner = useRef(identity);
  owner.current = identity;
  const run = useRef(0);
  const [sources, setSources] = useState<WrittenExamScoreSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [examDate, setExamDate] = useState("");
  const [infoFile, setInfoFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [existing, setExisting] = useState<WrittenExamAnalysisMetadata | null>(
    null,
  );
  const [questions, setQuestions] = useState<WrittenExamQuestionInfo[]>([]);
  const [pages, setPages] = useState<WrittenExamPaperPage[]>([]);
  const [crops, setCrops] = useState<WrittenExamPaperCrop[]>([]);
  const [files, setFiles] = useState<
    Array<{ fileName: string; kind: "pdf" | "page"; page?: number; blob: Blob }>
  >([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [preview, setPreview] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const source = sources.find((item) => item.id === sourceId);
  const reload = async () => {
    const sequence = ++run.current,
      expected = identity;
    setBusy(true);
    setError("");
    try {
      const list = await listWrittenExamScoreSources(config);
      if (sequence === run.current && owner.current === expected)
        setSources(list);
    } catch (failure) {
      if (sequence === run.current && owner.current === expected)
        setError(message(failure));
    } finally {
      if (sequence === run.current && owner.current === expected)
        setBusy(false);
    }
  };
  useEffect(() => {
    setSources([]);
    setSourceId("");
    setPreview(false);
    setExisting(null);
    void reload();
    return () => {
      ++run.current;
      controller.current?.abort();
    };
  }, [identity]);
  const select = async (id: string) => {
    const sequence = ++run.current,
      expected = identity;
    setSourceId(id);
    setPreview(false);
    setExisting(null);
    setExamDate("");
    setInfoFile(null);
    setPdfFile(null);
    setFiles([]);
    setCrops([]);
    setPages([]);
    setQuestions([]);
    setWarnings([]);
    setError("");
    if (!id) return;
    setBusy(true);
    try {
      const saved = await loadWrittenExamMaterials(config, id);
      if (sequence !== run.current || owner.current !== expected) return;
      setExisting(saved);
      setExamDate(saved?.examDate || "");
    } catch (failure) {
      if (sequence === run.current && owner.current === expected)
        setError(message(failure));
    } finally {
      if (sequence === run.current && owner.current === expected)
        setBusy(false);
    }
  };
  const prepare = async () => {
    if (!source || !examDate) {
      setError("점수표와 시험일을 선택해 주세요.");
      return;
    }
    const sequence = ++run.current,
      expected = identity;
    setBusy(true);
    setError("");
    setProgress("등록 자료 확인 중");
    controller.current = new AbortController();
    try {
      const roster = await loadWrittenExamScoreRoster(config, source.id);
      const info = infoFile
        ? await readWrittenExamInfoWorkbook(infoFile)
        : { questions: existing?.questions || [], warnings: [] };
      const nextQuestions = mergeScoreSourceQuestions(
        questionsFromScoreSource(roster),
        info.questions,
      );
      if (!nextQuestions.length)
        throw new Error(
          "원안지 문항을 구분할 문항정보표 또는 서답형 정오답 명렬표가 필요합니다.",
        );
      let paper: {
        pages: WrittenExamPaperPage[];
        crops: WrittenExamPaperCrop[];
        warnings: string[];
      };
      let nextFiles: typeof files;
      if (pdfFile) {
        paper = await processWrittenExamPaper(pdfFile, nextQuestions, {
          signal: controller.current.signal,
          onProgress: (page, total) => {
            if (owner.current === expected && sequence === run.current)
              setProgress(`PDF ${page}/${total}쪽 처리 중`);
          },
        });
        nextFiles = [
          { fileName: "paper.pdf", blob: pdfFile, kind: "pdf" },
          ...paper.pages.map((page) => ({
            fileName: `page-${page.page}.webp`,
            blob: page.blob,
            kind: "page" as const,
            page: page.page,
          })),
        ];
      } else if (existing?.files.length) {
        // Keep an existing paper when only its item metadata/date is updated.
        nextFiles = await Promise.all(
          existing.files.map(async (file) => ({
            ...file,
            blob: await loadWrittenExamAnalysisAsset(
              config,
              source.id,
              existing.revision,
              file.fileName,
            ),
          })),
        );
        const oldPages: WrittenExamPaperPage[] = [];
        for (const file of nextFiles.filter((file) => file.kind === "page")) {
          const bitmap = await createImageBitmap(file.blob);
          oldPages.push({
            page: file.page!,
            width: bitmap.width,
            height: bitmap.height,
            blob: file.blob,
          });
          bitmap.close();
        }
        paper = { pages: oldPages, crops: existing.crops, warnings: [] };
      } else {
        paper = { pages: [], crops: [], warnings: [] };
        nextFiles = [];
      }
      if (sequence !== run.current || owner.current !== expected) return;
      setQuestions(nextQuestions);
      setPages(paper.pages);
      setCrops(paper.crops);
      setFiles(nextFiles);
      setWarnings([...info.warnings, ...paper.warnings]);
      setPreview(true);
    } catch (failure) {
      if (sequence === run.current && owner.current === expected)
        setError(message(failure));
    } finally {
      if (sequence === run.current && owner.current === expected) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  const save = async () => {
    if (!source) return;
    const sequence = ++run.current,
      expected = identity;
    setBusy(true);
    setError("");
    setProgress("원안지·문항정보 저장 중");
    try {
      const saved = await saveWrittenExamScoreMaterials(config, {
        examId: source.id,
        expectedRevision: existing?.revision || null,
        examDate,
        questions,
        crops,
        files,
      });
      if (sequence !== run.current || owner.current !== expected) return;
      setExisting(saved);
      setPreview(false);
      setInfoFile(null);
      setPdfFile(null);
      showToast({ tone: "success", title: "원안지·문항정보를 저장했습니다." });
    } catch (failure) {
      if (sequence === run.current && owner.current === expected)
        setError(message(failure));
    } finally {
      if (sequence === run.current && owner.current === expected) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  return (
    <section
      className="written-exam-materials"
      aria-label="원안지·문항정보 등록"
    >
      {!preview ? (
        <>
          <div className="written-exam-material-fields">
            <label>
              등록된 점수표
              <select
                value={sourceId}
                disabled={busy}
                onChange={(event) => void select(event.target.value)}
              >
                <option value="">점수표 선택</option>
                {sources.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.targetGrade}학년
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
                onChange={(event) => setExamDate(event.target.value)}
              />
            </label>
          </div>
          <div className="written-exam-material-files">
            <div>
              <div className="written-exam-file-label">
                <label htmlFor="written-exam-info-file">문항정보표 엑셀</label>
                <InfoHelp label="문항정보표 안내">
                  <p>
                    성취기준·목표 성취수준·난이도를 보완합니다.
                    문항번호·정답·배점은 등록된 서답형 점수표와 같아야 합니다.
                    기존 문항정보를 유지하려면 파일을 다시 선택하지 않아도
                    됩니다.
                  </p>
                </InfoHelp>
              </div>
              <input
                id="written-exam-info-file"
                key={`info:${sourceId}:${existing?.revision}`}
                type="file"
                accept=".xlsx"
                disabled={busy}
                onChange={(event) =>
                  setInfoFile(event.target.files?.[0] || null)
                }
              />
            </div>
            <div>
              <div className="written-exam-file-label">
                <label htmlFor="written-exam-paper-file">원안지 PDF</label>
                <InfoHelp label="원안지 PDF 안내">
                  <p>
                    문항별 영역을 자동으로 나누고 정답 선지만 강조합니다. 인식이
                    불명확한 문항은 미리보기에서 확인합니다. 파일을 다시
                    선택하지 않으면 기존 원안지를 유지합니다.
                  </p>
                </InfoHelp>
              </div>
              <input
                id="written-exam-paper-file"
                key={`pdf:${sourceId}:${existing?.revision}`}
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                onChange={(event) =>
                  setPdfFile(event.target.files?.[0] || null)
                }
              />
            </div>
          </div>
          {existing && (
            <p className="written-exam-material-status">
              등록됨 · {existing.questions.length}문항 · 원안지{" "}
              {existing.files.filter((file) => file.kind === "page").length}쪽
            </p>
          )}
          {!busy && !sources.length && !error && (
            <p>먼저 서답형 또는 논술형 점수표를 등록해 주세요.</p>
          )}
        </>
      ) : (
        <>
          <div className="written-exam-import-summary">
            <strong>{source?.title}</strong>
            <span>
              {questions.length}문항 · PDF {pages.length}쪽
            </span>
          </div>
          {warnings.length > 0 && (
            <details>
              <summary>확인할 항목 {warnings.length}개</summary>
              <ul>
                {warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
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
      {busy && (
        <p role="status">{progress || "점수표 목록을 불러오는 중입니다."}</p>
      )}
      <div className="written-exam-dialog-actions">
        {error && !sourceId && (
          <RefreshButton
            label="점수표 목록 새로고침"
            loading={busy}
            onClick={reload}
          />
        )}
        {preview && (
          <button
            type="button"
            className="qca-secondary"
            disabled={busy}
            onClick={() => setPreview(false)}
          >
            파일 다시 선택
          </button>
        )}
        <button
          type="button"
          className="qca-primary"
          disabled={
            busy ||
            !sourceId ||
            (preview && crops.some((crop) => crop.status !== "ready"))
          }
          onClick={() => void (preview ? save() : prepare())}
        >
          {preview ? "원안지·문항정보 저장" : "자료 확인"}
        </button>
      </div>
    </section>
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
