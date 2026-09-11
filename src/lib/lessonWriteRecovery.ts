import type { W2CommandPayloads } from "./commandGateway";

type ScopeFields = "semesterId" | "expectedSemesterRevision";
export type LessonDocumentWrite = Omit<
  W2CommandPayloads["saveLessonDocument"],
  ScopeFields
>;
export type LessonTreeWrite = Omit<
  W2CommandPayloads["saveLessonTree"],
  ScopeFields
>;
type Intent =
  | { kind: "document"; input: LessonDocumentWrite }
  | { kind: "tree"; input: LessonTreeWrite };
export type LessonWriteOutcome = { ok: true } | { ok: false; error: unknown };
export const lessonWriteFailureMessage = (error: unknown) => {
  const reason =
    error instanceof Error ? error.message : "저장을 완료하지 못했습니다.";
  const conflict = (error as { state?: string } | null)?.state === "conflict";
  return conflict
    ? `${reason} 저장하려던 내용을 복구했습니다. 다른 화면에서 저장한 내용과 충돌하므로, 필요한 편집 내용을 복사해 둔 뒤 자료를 다시 열어 최신 저장본에 반영해 주세요.`
    : `${reason} 저장하려던 내용을 복구했습니다. 확인 후 다시 저장해 주세요.`;
};
export type LessonWriteRecovery = Intent & {
  scope: string;
  pending: boolean;
  settled: Promise<LessonWriteOutcome>;
};

// Tab memory only: no draft content is written to browser storage. A remounted
// editor waits for the submitted write before reading its revision again.
export const createLessonWriteRecoveryStore = () => {
  const records = new Map<string, LessonWriteRecovery>();
  return {
    peek: (scope: string) => records.get(scope),
    acknowledge: (record: LessonWriteRecovery | undefined) => {
      if (record && records.get(record.scope) === record && !record.pending)
        records.delete(record.scope);
    },
    run: <T, I extends Intent>(
      scope: string,
      intent: I,
      execute: (snapshot: I) => Promise<T>,
    ): Promise<T> => {
      if (records.get(scope)?.pending)
        return Promise.reject(
          new Error(
            "앞선 수업자료 저장 결과를 확인하고 있습니다. 잠시만 기다려 주세요.",
          ),
        );
      const snapshot = structuredClone(intent);
      const task = Promise.resolve().then(() => execute(snapshot));
      const record: LessonWriteRecovery = {
        ...snapshot,
        scope,
        pending: true,
        settled: task.then(
          () => {
            record.pending = false;
            return { ok: true };
          },
          (error: unknown) => {
            record.pending = false;
            return { ok: false, error };
          },
        ),
      };
      records.set(scope, record);
      return task;
    },
  };
};

export const lessonWriteRecovery = createLessonWriteRecoveryStore();
