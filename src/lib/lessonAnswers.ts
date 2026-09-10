import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { executeWestoryCommand } from "./commandGateway";
import { getSemesterCollectionPath } from "./semesterScope";
import type { SystemConfig } from "../types";

export const saveLessonAnswers = async (params: {
  config: Pick<SystemConfig, "year" | "semester"> | null | undefined;
  studentUid: string;
  unitId: string;
  expectedContentRevision: number;
  expectedAnswerRevision: number;
  answers: Record<string, string>;
}) => {
  const path = getSemesterCollectionPath(params.config, "lessons");
  const scope = path.match(/^years\/(\d{4})\/semesters\/([12])\/lessons$/);
  if (!scope) throw new Error("수업자료의 학기를 확인할 수 없습니다.");
  const semesterId = `${scope[1]}-${scope[2]}`;
  const pointer = await getDoc(doc(db, "site_settings/semester_active"));
  const active = pointer.data();
  if (
    !pointer.exists() ||
    active?.semesterId !== semesterId ||
    !Number.isSafeInteger(active.revision)
  ) {
    throw new Error("현재 학기가 변경되었습니다. 화면을 새로 열어 주세요.");
  }
  if (auth.currentUser?.uid !== params.studentUid)
    throw new Error("로그인 사용자가 바뀌었습니다. 화면을 다시 열어 주세요.");
  const response = await executeWestoryCommand("saveLessonAnswers", {
    semesterId,
    unitId: params.unitId,
    expectedSemesterRevision: active.revision,
    expectedContentRevision: params.expectedContentRevision,
    expectedAnswerRevision: params.expectedAnswerRevision,
    answers: params.answers,
  });
  return response.result;
};
