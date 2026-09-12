import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db, getHttpsCallable } from "./firebase";
import { ADMIN_EMAIL } from "./permissions";
import {
  normalizeStudentMaintenanceConfig,
  STUDENT_MAINTENANCE_CONFIG_DOC_ID,
} from "./studentMaintenance";

export async function readStudentAccessSettings() {
  const snapshot = await getDocFromServer(
    doc(db, "site_settings", STUDENT_MAINTENANCE_CONFIG_DOC_ID),
  );
  if (!snapshot.exists()) throw new Error("접속 설정을 찾을 수 없습니다.");
  return normalizeStudentMaintenanceConfig(snapshot.data());
}

// Only an explicit, confirmed administrator action may invoke this command.
export async function changeStudentAccess(closed: boolean) {
  const owner = auth.currentUser;
  if (owner?.email?.trim().toLowerCase() !== ADMIN_EMAIL) {
    throw new Error("관리자만 학생 접속을 변경할 수 있습니다.");
  }
  const current = await readStudentAccessSettings();
  const update = await getHttpsCallable("updateStudentMaintenanceConfig", {
    expectedUid: owner.uid,
  });
  await update({
    enabled: closed,
    blockedRoles: ["student"],
    bypassUids: [],
    title: current.title,
    message: current.message,
  });
  const saved = await readStudentAccessSettings();
  if (saved.enabled !== closed || saved.bypassUids.length !== 0) {
    throw new Error(
      "접속 상태가 다른 곳에서 변경되었습니다. 새로 확인해 주세요.",
    );
  }
  return saved;
}
