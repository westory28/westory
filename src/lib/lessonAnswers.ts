import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  executeWestoryCommand,
  WestoryCommandError,
  type W2CommandPayloads,
  type W2CommandResults,
} from "./commandGateway";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";

type LessonAnswerSaveParams = {
  config: Pick<SystemConfig, "year" | "semester"> | null | undefined;
  studentUid: string;
  unitId: string;
  expectedContentRevision: number;
  expectedAnswerRevision: number;
  answers: Record<string, string>;
};
type LessonAnswerSaveOperation = {
  readonly ownerUid: string;
  readonly draft: Omit<
    W2CommandPayloads["saveLessonAnswers"],
    "expectedSemesterRevision"
  >;
  payload: W2CommandPayloads["saveLessonAnswers"] | null;
  result: W2CommandResults["saveLessonAnswers"] | null;
  pending: Promise<W2CommandResults["saveLessonAnswers"]> | null;
};

export const isLessonAnswerSaveUncertain = (error: unknown) =>
  error instanceof WestoryCommandError && error.retryable;

export const isLessonAnswerSaveConflict = (error: unknown) =>
  error instanceof WestoryCommandError &&
  error.outcomeConfirmed &&
  error.reason === "LESSON_ANSWER_CONFLICT";

// Keep the original Gateway key, including semester revision, across retries.
// The owning answer session holds this operation separately from newer input.
export const createLessonAnswerSave = (
  params: LessonAnswerSaveParams,
): LessonAnswerSaveOperation => {
  const path = getSemesterCollectionPath(params.config, "lessons");
  const scope = path.match(/^years\/(\d{4})\/semesters\/([12])\/lessons$/);
  if (!scope) throw new Error("수업자료의 학기를 확인할 수 없습니다.");
  const semesterId = `${scope[1]}-${scope[2]}`;
  const ownerUid = params.studentUid;
  const draft = Object.freeze({
    semesterId,
    unitId: params.unitId,
    expectedContentRevision: params.expectedContentRevision,
    expectedAnswerRevision: params.expectedAnswerRevision,
    answers: Object.freeze({ ...params.answers }),
  });
  return { ownerUid, draft, payload: null, result: null, pending: null };
};

const assertOwner = (operation: LessonAnswerSaveOperation) => {
  if (!operation.ownerUid || auth.currentUser?.uid !== operation.ownerUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.");
};

const performLessonAnswerSave = async (
  operation: LessonAnswerSaveOperation,
) => {
  if (!operation.payload) {
    const pointer = await getDocFromServer(
      doc(db, "site_settings/semester_active"),
    );
    assertOwner(operation);
    const active = pointer.data();
    if (
      !pointer.exists() ||
      active?.semesterId !== operation.draft.semesterId ||
      !Number.isSafeInteger(active.revision)
    )
      throw new Error("현재 학기가 변경되었습니다. 화면을 새로 열어 주세요.");
    operation.payload = Object.freeze({
      ...operation.draft,
      expectedSemesterRevision: active.revision,
    });
  }
  const response = await executeWestoryCommand(
    "saveLessonAnswers",
    operation.payload,
    { expectedUid: operation.ownerUid },
  );
  assertOwner(operation);
  operation.result = response.result;
  return operation.result;
};

export const executeLessonAnswerSave = async (
  operation: LessonAnswerSaveOperation,
) => {
  assertOwner(operation);
  if (operation.result) return operation.result;
  if (operation.pending) return operation.pending;
  operation.pending = performLessonAnswerSave(operation);
  try {
    return await operation.pending;
  } finally {
    operation.pending = null;
  }
};

export const saveLessonAnswers = (params: LessonAnswerSaveParams) =>
  executeLessonAnswerSave(createLessonAnswerSave(params));
