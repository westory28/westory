import { auth } from "./firebase";
import { callWithApplicationSession } from "./applicationSession";

export interface QuizReviewNoteDraft {
  questionId: string;
  practiceAnswer: string;
  reason: string;
  note: string;
}
export interface QuizReviewNote extends QuizReviewNoteDraft {
  correct: boolean | null;
  updatedAt: string;
}
export interface QuizReviewNotes {
  revision: number;
  items: QuizReviewNote[];
  updatedAt: string;
}
export interface SaveQuizReviewNoteInput extends QuizReviewNoteDraft {
  semesterId: string;
  key: string;
  expectedRevision: number;
  saveId: string;
}
export interface SaveQuizReviewNoteResult {
  semesterId: string;
  key: string;
  reviewNotes: QuizReviewNotes;
  replayed: boolean;
}

/** Explicit save of one reflection. Never changes the submitted assessment. */
export async function saveMyQuizReviewNote(
  input: SaveQuizReviewNoteInput,
): Promise<SaveQuizReviewNoteResult> {
  const user = auth.currentUser;
  if (!user) throw new Error("로그인 후 오답 노트를 저장해 주세요.");
  const response = await callWithApplicationSession<
    Record<string, unknown>,
    SaveQuizReviewNoteResult
  >("saveMyQuizReviewNote", { ...input }, user);
  if (
    auth.currentUser !== user ||
    response.data.semesterId !== input.semesterId ||
    response.data.key !== input.key
  )
    throw new Error(
      "계정이나 학기가 변경되었습니다. 오답 노트를 다시 열어 주세요.",
    );
  return response.data;
}
