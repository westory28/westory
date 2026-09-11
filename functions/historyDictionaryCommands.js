const { createHash } = require("node:crypto");
const { HttpsError } = require("firebase-functions/v2/https");
const names = ["requestHistoryDictionaryTerm", "saveStudentHistoryDictionaryWord", "saveStudentHistoryDictionaryEntry", "deleteStudentHistoryDictionaryWord", "deleteStudentHistoryDictionaryWordByTeacher", "updateStudentHistoryDictionaryWordByTeacher", "saveHistoryDictionaryTerm", "approveHistoryDictionaryTermForRequests"];
const HISTORY_DICTIONARY_COMMAND_TYPES = Object.freeze(Object.fromEntries(names.map(name => [name, name])));
const STUDENT_COMMAND_TYPES = new Set(names.slice(0, 4));
const fail = (reason, message = "자료가 변경되었습니다. 입력 내용을 보관한 뒤 목록을 새로 고쳐 주세요.", code = "aborted") => { throw new HttpsError(code, message, { reason }); };
const invalid = () => fail("HISTORY_DICTIONARY_PAYLOAD_INVALID", "단어와 저장 대상 정보를 확인해 주세요.", "invalid-argument");
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) invalid();
  return value.trim();
};
const id = (value, max = 128, optional = false) => {
  if (optional && (value === undefined || value === "")) return "";
  const result = text(value, max, true);
  if (result !== value || /[/\\\x00-\x1f\x7f]/.test(result) || [".", ".."].includes(result)) invalid();
  return result;
};
const normalizeWord = value => value.trim().replace(/\s+/g, " ").toLowerCase();
const hash = value => createHash("sha1").update(value).digest("hex");
const termIdFor = word => `term_${hash(normalizeWord(word))}`;
const versionFor = data => {
  if (!data) return null;
  const value = data.updatedAt;
  if (!value) return "legacy";
  const seconds = value.seconds ?? value._seconds, nanos = value.nanoseconds ?? value._nanoseconds;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanos) || nanos < 0 || nanos >= 1e9)
    fail("HISTORY_DICTIONARY_VERSION_UNVERIFIED", "저장 버전을 확인할 수 없습니다. 자료를 다시 불러와 주세요.", "failed-precondition");
  return `${seconds}:${nanos}`;
};
const version = value => {
  if (value !== null && value !== "legacy" && !(typeof value === "string" && /^-?\d+:\d{1,9}$/.test(value))) invalid();
  return value;
};
const fields = {
  requestHistoryDictionaryTerm: ["word", "memo", "warningAccepted", "expectedWordVersion", "expectedRequestVersion"],
  saveStudentHistoryDictionaryWord: ["termId", "expectedWordVersion", "expectedTermVersion"],
  saveStudentHistoryDictionaryEntry: ["word", "definition", "expectedWordVersion"],
  deleteStudentHistoryDictionaryWord: ["termId", "expectedWordVersion"],
  deleteStudentHistoryDictionaryWordByTeacher: ["uid", "termId", "requestId", "word", "normalizedWord", "reason", "expectedWordVersion", "expectedRequestVersion"],
  updateStudentHistoryDictionaryWordByTeacher: ["uid", "termId", "word", "definition", "expectedWordVersion"],
  saveHistoryDictionaryTerm: ["word", "definition", "studentLevel", "relatedUnitId", "tags", "fallbackRequestId", "fallbackUid", "expectedTermVersion", "expectedRequestVersion"],
  approveHistoryDictionaryTermForRequests: ["termId", "requestId", "expectedTermVersion", "expectedRequestVersion"],
};
const normalizeHistoryDictionaryPayload = (commandType, input) => {
  if (!fields[commandType] || !input || typeof input !== "object" || Array.isArray(input)) invalid();
  const allowed = new Set(["year", "semester", ...fields[commandType]]);
  if (Object.keys(input).some(key => !allowed.has(key))) invalid();
  const payload = { year: text(input.year, 4, true), semester: text(input.semester, 1, true) };
  if (!/^\d{4}$/.test(payload.year) || !["1", "2"].includes(payload.semester)) invalid();
  for (const key of fields[commandType]) {
    if (key.startsWith("expected")) { if (Object.hasOwn(input, key)) payload[key] = version(input[key]); continue; }
    if (key === "tags") {
      const tags = input.tags ?? [];
      if (!Array.isArray(tags) || tags.length > 12) invalid();
      payload.tags = [...new Set(tags.map(tag => text(tag, 24, true)))]; continue;
    }
    if (key === "warningAccepted") { if (input[key] !== true) invalid(); payload[key] = true; continue; }
    if (["uid", "termId", "requestId", "fallbackRequestId", "fallbackUid"].includes(key)) {
      payload[key] = id(input[key], key === "termId" ? 80 : 128, ["requestId", "fallbackRequestId", "fallbackUid"].includes(key) || (key === "termId" && commandType === "deleteStudentHistoryDictionaryWordByTeacher")); continue;
    }
    const maxima = { word: 40, normalizedWord: 40, definition: 1200, memo: 240, reason: 160, studentLevel: 80, relatedUnitId: 120 };
    payload[key] = text(input[key] ?? "", maxima[key], ["word", "definition"].includes(key) && commandType !== "deleteStudentHistoryDictionaryWordByTeacher");
  }
  return payload;
};
const createHistoryDictionaryCommandAdapter = ({ db, operations, prepareContext }) => ({
  apply: async context => {
    const { transaction, payload, commandType, actor, receiptId, payloadHash } = context;
    const student = STUDENT_COMMAND_TYPES.has(commandType);
    if (!actor?.actorUid || (student ? actor.actorRole !== "student" : !["teacher", "admin"].includes(actor.actorRole)))
      fail("HISTORY_DICTIONARY_ROLE_REQUIRED", "이 작업을 할 수 있는 계정으로 로그인해 주세요.", "permission-denied");
    if (!transaction.native) throw new Error("Dictionary commands require the shared native transaction");
    const uid = student ? actor.actorUid : payload.uid || payload.fallbackUid || "";
    const termId = payload.termId || ((payload.word || payload.normalizedWord) ? termIdFor(payload.word || payload.normalizedWord) : "");
    const requestId = commandType === "requestHistoryDictionaryTerm"
      ? `req_${hash(`${payload.year}:${payload.semester}:${uid}:${normalizeWord(payload.word)}`)}`
      : payload.requestId || payload.fallbackRequestId || "";
    const refs = [];
    const check = async (key, path) => {
      if (!Object.hasOwn(payload, key)) invalid();
      const snapshot = await transaction.get(path); refs.push(path);
      if (versionFor(snapshot.exists ? snapshot.data : null) !== payload[key]) fail("HISTORY_DICTIONARY_VERSION_CONFLICT");
    };
    if (student || ["deleteStudentHistoryDictionaryWordByTeacher", "updateStudentHistoryDictionaryWordByTeacher"].includes(commandType)) {
      const targetTermId = termId || (payload.normalizedWord ? termIdFor(payload.normalizedWord) : "");
      if (!targetTermId) invalid();
      await check("expectedWordVersion", `users/${uid}/history_dictionary_words/${targetTermId}`);
    }
    if (["saveStudentHistoryDictionaryWord", "saveHistoryDictionaryTerm", "approveHistoryDictionaryTermForRequests"].includes(commandType))
      await check("expectedTermVersion", `history_dictionary_terms/${termId}`);
    if (requestId) await check("expectedRequestVersion", `history_dictionary_requests/${requestId}`);
    const prepared = await prepareContext({ ...context, uid, termId, requestId, student });
    const result = await operations[commandType]({ data: payload }, {
      ...context, ...prepared,
      identity: { uid: actor.actorUid, email: actor.actorEmail || "" },
      runTransaction: callback => callback(transaction.native),
    });
    return { target: { kind: "history-dictionary", id: termId || receiptId, refs }, sourceHash: payloadHash, result };
  },
});
module.exports = { HISTORY_DICTIONARY_COMMAND_TYPES, STUDENT_COMMAND_TYPES, normalizeHistoryDictionaryPayload, createHistoryDictionaryCommandAdapter, versionFor, termIdFor };
