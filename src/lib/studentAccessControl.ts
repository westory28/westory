import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "./firebase";
import { ADMIN_EMAIL } from "./permissions";
import { getHistoryDictionaryCallable } from "./historyDictionarySession";
import { ensureSensitiveOperation } from "./sensitiveOperation";

export type StudentAccessConfig = {
  enabled: boolean;
  blockedRoles: string[];
  bypassUids: string[];
  title: string;
  message: string;
  revision: number;
  updatedBy: string;
};
const assertAdmin = () => {
  const user = auth.currentUser;
  if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL)
    throw new Error("관리자 계정으로만 변경할 수 있습니다.");
  return user;
};
export const readStudentAccessConfig =
  async (): Promise<StudentAccessConfig> => {
    const user = assertAdmin();
    const snapshot = await getDocFromServer(
      doc(db, "site_settings", "student_maintenance"),
    );
    if (auth.currentUser !== user)
      throw new Error("로그인 계정이 바뀌었습니다.");
    const data = snapshot.data();
    if (
      !data ||
      typeof data.enabled !== "boolean" ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0 ||
      !Array.isArray(data.blockedRoles) ||
      data.blockedRoles.length !== 1 ||
      data.blockedRoles[0] !== "student" ||
      !Array.isArray(data.bypassUids) ||
      data.bypassUids.length > 20 ||
      data.bypassUids.some((uid: unknown) => typeof uid !== "string" || !uid) ||
      typeof data.title !== "string" ||
      !data.title ||
      typeof data.message !== "string" ||
      !data.message
    )
      throw new Error("현재 학생 접속 설정을 확인하지 못했습니다.");
    return data as StudentAccessConfig;
  };

let inFlight = false;
export const setStudentAccessAllowed = async (
  allowed: boolean,
  expectedRevision: number,
  expectedSemesterId?: string,
) => {
  if (inFlight) throw new Error("학생 접속 설정을 저장하고 있습니다.");
  inFlight = true;
  try {
    const user = assertAdmin();
    if (allowed && !/^\d{4}-[12]$/.test(expectedSemesterId || ""))
      throw new Error("현재 학기 공개 상태를 먼저 점검해 주세요.");
    await ensureSensitiveOperation();
    if (auth.currentUser !== user)
      throw new Error("로그인 계정이 바뀌었습니다.");
    const current = await readStudentAccessConfig();
    if (current.revision !== expectedRevision)
      throw new Error(
        "접속 설정이 바뀌었습니다. 현재 상태를 다시 확인해 주세요.",
      );
    if (current.enabled === !allowed) return current;
    const call = await getHistoryDictionaryCallable(
      "updateStudentMaintenanceConfig",
    );
    let mutationError: unknown;
    try {
      await call({
        expectedRevision: current.revision,
        ...(allowed ? { expectedSemesterId } : {}),
        enabled: !allowed,
        blockedRoles: current.blockedRoles,
        bypassUids: current.bypassUids,
        title: current.title,
        message: current.message,
      });
    } catch (error) {
      mutationError = error;
    }
    // This mutation is deliberately not retried: its server contract has no
    // request key. Re-read after an ambiguous response before reporting it.
    const saved = await readStudentAccessConfig();
    if (
      saved.enabled === !allowed &&
      saved.revision === current.revision + 1 &&
      saved.updatedBy === user.uid &&
      saved.title === current.title &&
      saved.message === current.message &&
      JSON.stringify(saved.bypassUids) === JSON.stringify(current.bypassUids)
    )
      return saved;
    throw (
      mutationError ||
      new Error(
        "저장 결과를 확인하지 못했습니다. 현재 상태를 다시 확인해 주세요.",
      )
    );
  } finally {
    inFlight = false;
  }
};
