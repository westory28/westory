const { HttpsError } = require("firebase-functions/v2/https");

const dictionaryRoot = ({ year, semester }) => {
  if (typeof year !== "string" || !/^\d{4}$/.test(year) || !["1", "2"].includes(semester))
    throw new HttpsError("invalid-argument", "사전의 학기 정보를 확인해 주세요.");
  return `years/${year}/semesters/${semester}`;
};
const dictionaryTermPath = (scope, termId) => `${dictionaryRoot(scope)}/history_dictionary_terms/${termId}`;
const dictionaryRequestPath = (scope, requestId) => `${dictionaryRoot(scope)}/history_dictionary_requests/${requestId}`;
const dictionaryWordPath = (scope, uid, termId) => `${dictionaryRoot(scope)}/dictionary_students/${uid}/history_dictionary_words/${termId}`;

// Both teacher and student commands may write only the active semester.
const assertDictionaryActiveSemester = async (transaction, scope) => {
  dictionaryRoot(scope);
  const semesterId = `${scope.year}-${scope.semester}`;
  const [pointer, manifest] = await transaction.getAll([
    "site_settings/semester_active", `semester_manifests/${semesterId}`,
  ]);
  if (!pointer.exists || !manifest.exists || pointer.data?.semesterId !== semesterId
    || !Number.isSafeInteger(pointer.data?.revision) || pointer.data.revision < 1
    || manifest.data?.semesterId !== semesterId
    || pointer.data?.revision !== manifest.data?.revision || manifest.data?.status !== "ACTIVE"
    || manifest.data?.readOnly === true)
    throw new HttpsError("failed-precondition", "지난 학기 자료는 조회만 가능합니다. 현재 학기를 확인해 주세요.", { reason: "HISTORY_DICTIONARY_SEMESTER_CHANGED" });
};

module.exports = { dictionaryRoot, dictionaryTermPath, dictionaryRequestPath, dictionaryWordPath, assertDictionaryActiveSemester };
