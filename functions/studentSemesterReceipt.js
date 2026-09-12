const { HttpsError } = require("firebase-functions/v2/https");
const semesterCore = require("./semesterCore");

// A replay must not reveal an old answer or result after the active semester changes.
const assertStudentReceiptSemester = async (store, actor, receipt) => {
  if (actor.actorRole !== "student") return;
  const refs = Array.isArray(receipt.target?.refs) ? receipt.target.refs : [];
  const scopes = new Set();
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const scoped = /^years\/(\d{4})\/semesters\/([12])\//.exec(ref);
    if (scoped) scopes.add(`${scoped[1]}-${scoped[2]}`);
    else if (/^semester_(assessment_(attempts|definitions|submissions|results)|grade_(records|requests|attestations)|learning_(contents|progress|exemptions|exemption_requests))\/[^/]+$/.test(ref)) {
      const document = await store.get(ref);
      if (document.exists && /^\d{4}-[12]$/.test(document.data?.semesterId || "")) scopes.add(document.data.semesterId);
    }
  }
  const academic = /assessment|lesson|dictionary|grade|thinkcloud|learning|exemption/i.test(receipt.commandType || "");
  if (!academic && !scopes.size) return;
  const [pointer, config] = await Promise.all([
    store.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH), store.get(semesterCore.SITE_CONFIG_PATH),
  ]);
  const active = pointer.data?.semesterId;
  if (scopes.size !== 1 || !scopes.has(active) || !pointer.exists || !config.exists
      || config.data?.activeSemesterId !== active || `${config.data?.year}-${config.data?.semester}` !== active) {
    throw new HttpsError("permission-denied", "현재 학기의 작업 결과만 확인할 수 있습니다.", { reason: "STUDENT_RECEIPT_SEMESTER_DENIED" });
  }
  const manifest = await store.get(`semester_manifests/${active}`);
  if (!manifest.exists || manifest.data?.semesterId !== active || manifest.data.status !== "ACTIVE"
      || manifest.data.revision !== pointer.data.revision) {
    throw new HttpsError("permission-denied", "현재 학기를 다시 확인해 주세요.", { reason: "STUDENT_RECEIPT_SEMESTER_DENIED" });
  }
};
module.exports = { assertStudentReceiptSemester };
