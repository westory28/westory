const { HttpsError } = require("firebase-functions/v2/https");
const { FieldPath } = require("firebase-admin/firestore");
const { assertScoreWorkflowSession } = require("./scoreWorkflowGuard");
const { versionFor } = require("./productionGateway/historyDictionaryCommands");

const CATALOG_COLLECTION = "history_dictionary_catalog";
const PAGE_SIZE = 200;
const CATALOG_PAGE_SIZE = 500;
const ADMIN_EMAIL = "westoria28@gmail.com";
const id = value => typeof value === "string" && value.length > 0 && value.length <= 180 && value === value.trim()
  && !/[/\\\x00-\x1f\x7f]/.test(value) && ![".", ".."].includes(value);
const scope = (year, semester) => typeof year === "string" && /^\d{4}$/.test(year) && ["1", "2"].includes(semester);
const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
const timestampMs = value => typeof value?.toMillis === "function" ? value.toMillis() : Number(value?.seconds || value?._seconds || 0) * 1000;
const tags = value => Array.isArray(value) ? [...new Set(value.map(v => text(v, 24)).filter(Boolean))].slice(0, 12) : [];
const fail = (code, message) => { throw new HttpsError(code, message); };

// Validate path and stored ownership independently. Never infer a missing source
// semester from the current configuration or expose unrelated collection groups.
const sourceFor = (path, kind, data) => {
  const p = path.split("/");
  const collection = kind === "terms" ? "history_dictionary_terms" : "history_dictionary_words";
  if (p[0] === "years" && scope(p[1], p[3]) && p[2] === "semesters"
    && data.year === p[1] && data.semester === p[3]) {
    if (kind === "terms" && p.length === 6 && p[4] === collection && id(p[5]))
      return { year: p[1], semester: p[3], canonical: true };
    if (kind !== "terms" && p.length === 8 && p[4] === "dictionary_students"
      && p[6] === collection && id(p[5]) && id(p[7]) && data.uid === p[5])
      return { year: p[1], semester: p[3], uid: p[5], canonical: true };
  }
  // Legacy records are retained as read-only only when their original scope is
  // explicit and independently authorized by an archived semester manifest.
  if (scope(data.year, data.semester)) {
    if (kind === "terms" && p.length === 2 && p[0] === collection && id(p[1]))
      return { year: data.year, semester: data.semester, canonical: false };
    if (kind !== "terms" && p.length === 4 && p[0] === "users" && p[2] === collection
      && id(p[1]) && id(p[3]) && data.uid === p[1])
      return { year: data.year, semester: data.semester, uid: p[1], canonical: false };
  }
  return null;
};
const validCursor = (after, kind) => {
  if (after === undefined || after === "") return true;
  if (typeof after !== "string" || after.length > 1500) return false;
  const p = after.split("/");
  if (p.length % 2 !== 0 || p.some(part => !part || [".", ".."].includes(part) || /[\\\x00-\x1f\x7f]/.test(part))) return false;
  if (kind === "catalog") return p.length === 2 && p[0] === CATALOG_COLLECTION;
  // A cursor only sets the scan position. Accept even skipped legacy/malformed
  // records so a filtered page cannot strand the reader. The uid query and
  // sourceFor/manifest checks below independently authorize every returned item.
  return p.at(-2) === (kind === "terms" ? "history_dictionary_terms" : "history_dictionary_words");
};
const catalogItem = document => {
  const d = document.data();
  if (d.schemaVersion !== 1 || d.managedBy !== "westory-history-dictionary-catalog"
    || d.id !== document.id || !["history", "place"].includes(d.kind)
    || typeof d.word !== "string" || !d.word || typeof d.definition !== "string" || !d.definition
    || !Array.isArray(d.aliases) || !Array.isArray(d.facetIds) || !Array.isArray(d.attributions))
    fail("data-loss", "사전 자료의 형식을 확인해야 합니다. 잠시 후 다시 불러와 주세요.");
  const { schemaVersion, managedBy, contentHash, updatedAt, ...entry } = d;
  return entry;
};

const createHistoryDictionaryContinuityHandler = ({ db, assertSession = assertScoreWorkflowSession }) => async request => {
  await assertSession(request);
  const uid = request.auth?.uid;
  const email = String(request.auth?.token?.email || "").trim().toLowerCase();
  if (!id(uid) || (!/@yongshin-ms\.ms\.kr$/i.test(email) && email !== ADMIN_EMAIL))
    fail("permission-denied", "사전을 조회할 수 있는 계정으로 로그인해 주세요.");
  const input = request.data || {};
  if (Object.keys(input).some(key => !["kind", "year", "semester", "after", "_session"].includes(key))
    || !["catalog", "terms", "words", "studentWords"].includes(input.kind)
    || !scope(input.year, input.semester) || !validCursor(input.after, input.kind))
    fail("invalid-argument", "사전 조회 정보를 확인해 주세요.");
  const currentId = `${input.year}-${input.semester}`;
  const [user, pointer, manifest] = await db.getAll(db.doc(`users/${uid}`),
    db.doc("site_settings/semester_active"), db.doc(`semester_manifests/${currentId}`));
  const profile = user.data() || {}, p = pointer.data() || {}, m = manifest.data() || {};
  const administrator = email === ADMIN_EMAIL;
  const teacher = administrator || profile.role === "teacher";
  const staff = profile.teacherPortalEnabled === true && Array.isArray(profile.staffPermissions)
    && profile.staffPermissions.includes("lesson_read");
  if (!administrator && (!user.exists || !["student", "teacher"].includes(profile.role) && !staff))
    fail("permission-denied", "사전을 조회할 권한이 없습니다.");
  if (!pointer.exists || !manifest.exists || p.semesterId !== currentId || m.semesterId !== currentId
    || !Number.isSafeInteger(p.revision) || p.revision < 1 || p.revision !== m.revision
    || m.status !== "ACTIVE" || m.readOnly === true)
    fail("failed-precondition", "현재 학기가 변경되었습니다. 사전을 다시 열어 주세요.");
  if (input.kind === "words" && profile.role !== "student")
    fail("permission-denied", "학생 본인의 단어장만 조회할 수 있습니다.");
  if (input.kind === "studentWords" && !teacher && !staff)
    fail("permission-denied", "학생 단어장을 조회할 권한이 없습니다.");
  const pageSize = input.kind === "catalog" ? CATALOG_PAGE_SIZE : PAGE_SIZE;
  let query = input.kind === "catalog" ? db.collection(CATALOG_COLLECTION)
    : db.collectionGroup(input.kind === "terms" ? "history_dictionary_terms" : "history_dictionary_words");
  if (input.kind === "words") query = query.where("uid", "==", uid);
  query = query.orderBy(FieldPath.documentId());
  if (input.after) query = query.startAfter(db.doc(input.after));
  const snapshot = await query.limit(pageSize).get();
  const nextCursor = snapshot.size === pageSize ? snapshot.docs.at(-1).ref.path : "";
  if (input.kind === "catalog") {
    if (!snapshot.size && !input.after) fail("unavailable", "사전 자료를 준비하고 있습니다. 잠시 후 다시 불러와 주세요.");
    return { items: snapshot.docs.map(catalogItem), nextCursor };
  }
  const candidates = snapshot.docs.flatMap(document => {
    const data = document.data(), source = sourceFor(document.ref.path, input.kind, data);
    if (!source || `${source.year}-${source.semester}` > currentId
      || (input.kind === "words" && source.uid !== uid)) return [];
    const current = source.canonical && source.year === input.year && source.semester === input.semester;
    if (input.kind === "studentWords" && !teacher && !current) return [];
    if (input.kind === "studentWords" && !["student", "teacher_reviewed"].includes(data.definitionSource)) return [];
    if (input.kind === "terms" && !teacher && (!current || !staff) && data.status !== "published") return [];
    if (input.kind !== "terms" && (data.status !== "saved" && !(current && input.kind === "words" && data.status === "requested"))) return [];
    return [{ document, data, source, current }];
  });
  const previousIds = [...new Set(candidates.filter(item => !item.current).map(({ source }) => `${source.year}-${source.semester}`))];
  const previous = previousIds.length ? await db.getAll(...previousIds.map(value => db.doc(`semester_manifests/${value}`))) : [];
  const readable = new Set(previous.filter(item => item.exists && ["CLOSED", "ARCHIVED"].includes(item.data().status)
    && item.data().semesterId === item.id).map(item => item.id));
  const items = candidates.flatMap(({ document, data, source, current }) => {
    if (!current && !readable.has(`${source.year}-${source.semester}`)) return [];
    const common = {
      id: document.id, word: text(data.word, 40), normalizedWord: text(data.normalizedWord || data.word, 40).replace(/\s+/g, " ").toLowerCase(),
      definition: text(data.definition, 1200), studentLevel: text(data.studentLevel, 80), tags: tags(data.tags), status: data.status,
      sourcePath: document.ref.path, sourceYear: source.year, sourceSemester: source.semester,
      year: source.year, semester: source.semester, readOnly: !current,
      writeVersion: versionFor(data), createdAtMs: timestampMs(data.createdAt), updatedAtMs: timestampMs(data.updatedAt),
    };
    if (input.kind === "terms") return [{ ...common, relatedUnitId: text(data.relatedUnitId, 120) }];
    return [{ ...common, id: document.ref.path, uid: source.uid, termId: document.id,
      definitionSource: text(data.definitionSource, 40), requestId: text(data.requestId, 128), memo: text(data.memo, 240),
      studentName: text(data.studentName || data.name, 40) || "학생", grade: text(data.grade, 8), class: text(data.class, 8), number: text(data.number, 8),
      reviewedBy: text(data.reviewedBy, 128), rewardTermId: text(data.rewardTermId, 80),
      rewardTransactionId: text(data.rewardTransactionId, 180), rewardAmount: Number(data.rewardAmount || 0),
    }];
  });
  return { items, nextCursor };
};

module.exports = { createHistoryDictionaryContinuityHandler, CATALOG_COLLECTION, PAGE_SIZE, CATALOG_PAGE_SIZE, sourceFor };
