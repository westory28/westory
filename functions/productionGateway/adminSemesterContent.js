const { HttpsError } = require("firebase-functions/v2/https");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const sessionAuthority = require("./sessionAuthority");
const semesterCore = require("./semesterCore");

const TYPES = Object.freeze([
  "lessons", "think_cloud_sessions", "think_cloud_responses",
  "history_dictionary_terms", "history_dictionary_requests", "dictionary_words",
  "quiz_questions", "history_classrooms", "assessment_config", "exam_config", "grading_plans",
]);
const fail = (code, message) => { throw new HttpsError(code, message); };
const id = value => typeof value === "string" && value.length > 0 && value.length <= 160
  && !/[\x00-\x1f/]/.test(value) && value !== "." && value !== "..";
const keys = (data, allowed) => {
  if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).some(key => !allowed.includes(key))) fail("invalid-argument", "Invalid archive query.");
};
const normalizeQuery = data => {
  keys(data, ["semesterId", "contentType", "pageSize", "cursor", "itemId", "parentId", "_session"]);
  const semesterId = semesterCore.normalizeSemesterId(data.semesterId);
  if (!TYPES.includes(data.contentType)) fail("invalid-argument", "Unknown archive content type.");
  const pageSize = data.pageSize ?? 20;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 30) fail("invalid-argument", "Invalid page size.");
  const parentId = data.parentId ?? null, itemId = data.itemId ?? null;
  if (data.contentType === "think_cloud_responses" ? !id(parentId) : parentId !== null) fail("invalid-argument", "Invalid archive parent.");
  if (itemId !== null && (data.contentType === "dictionary_words"
    ? typeof itemId !== "string" || itemId.split("/").length !== 2 || !itemId.split("/").every(id)
    : !id(itemId))) fail("invalid-argument", "Invalid archive item.");
  let after = null;
  if (data.cursor != null) {
    if (itemId || typeof data.cursor !== "string" || data.cursor.length > 1600 || !/^[A-Za-z0-9_-]+$/.test(data.cursor)) fail("invalid-argument", "Invalid archive cursor.");
    try {
      const cursor = JSON.parse(Buffer.from(data.cursor, "base64url").toString());
      keys(cursor, ["v", "semesterId", "contentType", "parentId", "after"]);
      if (cursor.v !== 1 || cursor.semesterId !== semesterId || cursor.contentType !== data.contentType || cursor.parentId !== parentId
          || typeof cursor.after !== "string" || cursor.after.length > 700 || /[\x00-\x1f]/.test(cursor.after)) throw Error();
      after = cursor.after;
    } catch { fail("invalid-argument", "Archive cursor does not match this semester."); }
  }
  return { semesterId, contentType: data.contentType, pageSize, parentId, itemId, after };
};
const serialize = value => {
  if (value == null) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
  return value;
};
const rootFor = semesterId => `years/${semesterId.split("-")[0]}/semesters/${semesterId.split("-")[1]}`;
const listPath = query => query.contentType === "think_cloud_responses"
  ? `${rootFor(query.semesterId)}/think_cloud_sessions/${query.parentId}/responses`
  : `${rootFor(query.semesterId)}/${query.contentType}`;
const itemPath = query => query.contentType === "dictionary_words"
  ? `${rootFor(query.semesterId)}/dictionary_students/${query.itemId.split("/")[0]}/history_dictionary_words/${query.itemId.split("/")[1]}`
  : `${listPath(query)}/${query.itemId}`;
const rowFor = (document, type) => {
  const data = document.data || {}, parts = document.path.split("/");
  return {
    id: type === "dictionary_words" ? `${parts.at(-3)}/${parts.at(-1)}` : parts.at(-1),
    title: String(data.title || data.word || data.question || data.subject || data.studentName || data.text || parts.at(-1)).slice(0, 300),
    subtitle: String(data.definition || data.description || data.content || data.category || data.targetClassLabel || "").slice(0, 300),
    status: String(data.status || (data.isPublished === true ? "PUBLISHED" : "")).slice(0, 60),
  };
};

const createAdminSemesterContentCore = ({ store, queryDictionaryWords,
  assertSession = sessionAuthority.assertActiveApplicationSession } = {}) => {
  if (!store || typeof queryDictionaryWords !== "function") throw new TypeError("Archive stores are required.");
  const assertArchived = async semesterId => {
    const [manifest, pointer, config] = await Promise.all([
      store.get(`semester_manifests/${semesterId}`), store.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH), store.get(semesterCore.SITE_CONFIG_PATH),
    ]);
    if (!manifest.exists || manifest.data?.semesterId !== semesterId || !["CLOSED", "ARCHIVED"].includes(manifest.data.status)
        || !pointer.exists || !config.exists || !pointer.data?.semesterId
        || pointer.data.semesterId !== config.data?.activeSemesterId
        || pointer.data.semesterId !== `${config.data.year}-${config.data.semester}`
        || pointer.data.semesterId === semesterId) fail("failed-precondition", "종료한 학기만 보관 자료로 조회할 수 있습니다.");
  };
  const getAdminSemesterContent = async request => {
    if (!request.app) fail("unauthenticated", "App Check is required.");
    const identity = await assertSession(request, { highRisk: false, recentAuth: false });
    if (!identity?.uid || identity.uid !== request.auth?.uid
        || String(identity.email || "").toLowerCase() !== "westoria28@gmail.com"
        || String(request.auth?.token?.email || "").toLowerCase() !== "westoria28@gmail.com") fail("permission-denied", "관리자만 지난 학기 자료를 확인할 수 있습니다.");
    const query = normalizeQuery(request.data);
    await assertArchived(query.semesterId);
    let rows = [], detail = null, nextCursor = null;
    if (query.itemId) {
      const document = await store.get(itemPath(query));
      if (!document.exists) fail("not-found", "보관 자료를 찾지 못했습니다.");
      detail = serialize(document.data);
    } else {
      if (query.after && query.contentType !== "dictionary_words" && !id(query.after)) fail("invalid-argument", "Invalid archive cursor.");
      if (query.contentType === "dictionary_words" && query.after && !/^users\/[^/]+\/history_dictionary_words\/[^/]+$/.test(query.after)
          && !new RegExp(`^${rootFor(query.semesterId)}/dictionary_students/[^/]+/history_dictionary_words/[^/]+$`).test(query.after)) fail("invalid-argument", "Invalid dictionary cursor.");
      const documents = query.contentType === "dictionary_words"
        ? await queryDictionaryWords(query)
        : await store.query(listPath(query), { documentIdOrder: "asc", limit: query.pageSize + 1, ...(query.after ? { startAfterId: query.after } : {}) });
      const scanned = documents.slice(0, query.pageSize);
      rows = scanned.filter(document => query.contentType !== "dictionary_words"
        || document.path.startsWith(`${rootFor(query.semesterId)}/dictionary_students/`)).map(document => rowFor(document, query.contentType));
      if (documents.length > query.pageSize) nextCursor = Buffer.from(JSON.stringify({v: 1, semesterId: query.semesterId, contentType: query.contentType,
        parentId: query.parentId, after: query.contentType === "dictionary_words" ? scanned.at(-1).path : scanned.at(-1).path.split("/").at(-1)})).toString("base64url");
    }
    await assertArchived(query.semesterId);
    return { semesterId: query.semesterId, contentType: query.contentType, provenance: "ARCHIVE", readOnly: true, rows, nextCursor, detail };
  };
  return { getAdminSemesterContent };
};
const createAdminSemesterContentCallableExports = ({ core }) => ({
  getAdminSemesterContent: onCall({ region: "asia-northeast3", enforceAppCheck: true, timeoutSeconds: 60 }, request => core.getAdminSemesterContent(request)),
});
module.exports = { TYPES, normalizeQuery, rowFor, createAdminSemesterContentCore, createAdminSemesterContentCallableExports };
