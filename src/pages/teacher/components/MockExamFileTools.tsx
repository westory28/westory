import React, { useEffect, useRef, useState } from "react";
import { useAuth } from "../../../contexts/AuthContext";
import { executeAssessmentManagementCommand } from "../../../lib/assessmentLifecycle";
import {
  getAssessmentSemesterId,
  refreshPublishedQuizDefinitions,
} from "../../../lib/assessmentRelease";
import { formatMockExamRoundShortLabel } from "../../../lib/mockExamRounds";
import type { QuizQuestionDraft } from "./QuizEditor";
import type { QuizQuestionCatalogEntry } from "./quizQuestionPaging";
import {
  createMockExamFile,
  MOCK_EXAM_FILE_EXAMPLE,
  parseMockExamFile,
} from "./mockExamAuthoring";
import { useQuizDialog } from "./useQuizDialog";
import MockExamPaper from "../../../components/common/MockExamPaper";

const download = (name: string, contents: string) => {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

interface Props {
  canEdit: boolean;
  catalog: QuizQuestionCatalogEntry[];
  entries: QuizQuestionCatalogEntry[];
  loadQuestions: (
    entries: QuizQuestionCatalogEntry[],
  ) => Promise<QuizQuestionDraft[]>;
  onChanged: () => void;
}

export default function MockExamFileTools({
  canEdit,
  catalog,
  entries,
  loadQuestions,
  onChanged,
}: Props) {
  const { config } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<QuizQuestionDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [previewRound, setPreviewRound] = useState("round_1");
  const saved = useRef(new Set<number>());
  const locked = useRef(false);
  const active = useRef(true);
  const editable = useRef(canEdit);
  editable.current = canEdit;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const close = () => {
    if (locked.current) return;
    setDraft([]);
    if (saved.current.size) onChanged();
  };
  useQuizDialog(draft.length > 0, dialog, close);

  const openFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.size > 6000000)
        throw new Error("시험지 JSON은 6MB 이하로 준비해 주세요.");
      const questions = parseMockExamFile(await file.text());
      const importedIds = new Set(questions.map((q) => q.id));
      const occupied = new Set(
        catalog
          .filter((q) => !importedIds.has(q.id) && q.examRound)
          .map((q) => `${q.examRound}:${q.paperOrder}`),
      );
      for (const q of questions) {
        if (occupied.has(`${q.examRound}:${q.paperOrder}`))
          throw new Error(
            `${formatMockExamRoundShortLabel(q.examRound)} ${q.paperOrder}번은 이미 사용 중입니다.`,
          );
      }
      saved.current.clear();
      setSavedCount(0);
      setPreviewOnly(false);
      setPreviewRound(questions[0].examRound || "round_1");
      setDraft(questions);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "JSON 파일을 읽지 못했습니다.",
      );
    }
  };

  const save = async () => {
    if (!canEdit || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      for (const question of draft) {
        if (!active.current || !editable.current) return;
        if (saved.current.has(question.id)) continue;
        const existing = catalog.find((q) => q.id === question.id);
        await executeAssessmentManagementCommand("upsertQuizQuestion", {
          semesterId: getAssessmentSemesterId(config),
          questionId: String(question.id),
          question,
          expectedRevision: Number(existing?.contentRevision || 0),
          reason: "교사 시험지 JSON 등록",
        });
        saved.current.add(question.id);
        if (!active.current) return;
        setSavedCount(saved.current.size);
      }
      await refreshPublishedQuizDefinitions(config, "exam_prep", "exam_prep");
      if (!active.current) return;
      setDraft([]);
      onChanged();
    } catch (cause) {
      setError(
        `${saved.current.size}/${draft.length}문항 저장. ${cause instanceof Error ? cause.message : "저장하지 못했습니다."} 다시 저장하면 남은 문항부터 이어집니다.`,
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const exportFile = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const questions: QuizQuestionDraft[] = [];
      for (let start = 0; start < entries.length; start += 20)
        questions.push(
          ...(await loadQuestions(entries.slice(start, start + 20))),
        );
      download("westory-mock-exam.json", createMockExamFile(questions));
    } catch {
      setError("시험지 파일을 만들지 못했습니다. 다시 시도해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const previewFile = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const questions: QuizQuestionDraft[] = [];
      for (let start = 0; start < entries.length; start += 20)
        questions.push(
          ...(await loadQuestions(entries.slice(start, start + 20))),
        );
      saved.current.clear();
      setSavedCount(0);
      setPreviewOnly(true);
      setPreviewRound(questions[0]?.examRound || "round_1");
      setDraft(questions);
    } catch {
      setError("시험지를 불러오지 못했습니다. 다시 시도해 주세요.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const previewQuestions = draft
    .filter((q) => (q.examRound || "round_1") === previewRound)
    .sort(
      (a, b) => Number(a.paperOrder || a.id) - Number(b.paperOrder || b.id),
    );

  return (
    <>
      <button
        type="button"
        className="quiz-authoring-button"
        disabled={busy || !entries.length}
        onClick={() => void previewFile()}
      >
        시험지 미리보기
      </button>
      <button
        type="button"
        className="quiz-authoring-button"
        disabled={busy}
        onClick={() =>
          download(
            "westory-mock-exam-template.json",
            createMockExamFile(MOCK_EXAM_FILE_EXAMPLE),
          )
        }
      >
        JSON 양식
      </button>
      <button
        type="button"
        className="quiz-authoring-button"
        disabled={busy || !entries.length}
        onClick={() => void exportFile()}
      >
        JSON 내보내기
      </button>
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => void openFile(event)}
          />
          <button
            type="button"
            className="quiz-authoring-button"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            JSON 가져오기
          </button>
        </>
      )}
      {error && !draft.length && (
        <p role="alert" className="w-full text-sm text-red-700">
          {error}
        </p>
      )}
      {!!draft.length && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label={previewOnly ? "시험지 미리보기" : "시험지 JSON 확인"}
            tabIndex={-1}
            className="quiz-authoring-surface quiz-composer-dialog"
          >
            <div className="quiz-composer-header">
              <h3 className="text-lg font-bold">
                {previewOnly ? "시험지 미리보기" : "시험지 JSON 확인"} ·{" "}
                {draft.length}문항
              </h3>
              <button
                type="button"
                className="quiz-authoring-button"
                disabled={busy}
                onClick={close}
              >
                닫기
              </button>
            </div>
            <div className="quiz-composer-body">
              {!previewOnly && (
                <p className="text-sm">
                  같은 ID의 문항은 수정되며, 공개 중인 회차에도 반영됩니다.
                </p>
              )}
              <label className="mb-3 flex min-h-11 items-center gap-2 text-sm font-bold">
                회차
                <select
                  className="min-h-11 rounded border border-gray-300 px-3"
                  value={previewRound}
                  onChange={(event) => setPreviewRound(event.target.value)}
                >
                  {[...new Set(draft.map((q) => q.examRound || "round_1"))].map(
                    (round) => (
                      <option key={round} value={round}>
                        {formatMockExamRoundShortLabel(round)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <MockExamPaper
                questions={previewQuestions}
                round={previewRound}
              />
              <details className="py-3">
                <summary className="min-h-11 cursor-pointer text-sm font-bold">
                  정답·해설 확인
                </summary>
                {previewQuestions.map((q) => (
                  <section key={q.id} className="border-b border-gray-200 py-3">
                    <h4 className="font-bold">
                      {formatMockExamRoundShortLabel(q.examRound)} ·{" "}
                      {q.paperOrder}번 · {q.points}점
                      {catalog.some((row) => row.id === q.id)
                        ? " · 수정"
                        : " · 신규"}
                    </h4>
                    <p className="mt-2 text-sm text-blue-700">
                      정답: {q.answer}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {q.explanation}
                    </p>
                  </section>
                ))}
              </details>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
            <div className="quiz-composer-footer">
              <span role="status">
                {savedCount
                  ? `${savedCount}/${draft.length}문항 저장`
                  : `${previewQuestions.reduce((sum, q) => sum + (q.points || 0), 0)}점`}
              </span>
              {!previewOnly && (
                <button
                  type="button"
                  className="quiz-authoring-primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy
                    ? "저장 중…"
                    : savedCount
                      ? "남은 문항 저장"
                      : "문항 저장"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
