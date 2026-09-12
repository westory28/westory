const { HttpsError } = require("firebase-functions/v2/https");
const { onCallWithStudentMaintenance: onCall } = require("./studentMaintenance");
const sessionAuthority = require("./sessionAuthority");
const semesterCore = require("./semesterCore");

const ADMIN_EMAIL = "westoria28@gmail.com";
const COLLECTIONS = Object.freeze({
  wis_wallets: "point_wallets",
  wis_transactions: "point_transactions",
  wis_orders: "point_orders",
  grade_students: "point_wallets",
  quiz_results: "quiz_results",
  history_results: "history_classroom_results",
});
const RECORD_TYPES = Object.freeze([...Object.keys(COLLECTIONS), "grades"]);
const fail = (code, message) => { throw new HttpsError(code, message); };
const text = (value, max = 200) =>
  typeof value === "string" || typeof value === "number"
    ? String(value).slice(0, max) : "";
const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const documentId = (value) => typeof value === "string" && value.length > 0
  && value.length <= 160 && !/[\x00-\x1f/]/.test(value) && value !== "." && value !== "..";
const date = (value) => {
  const milliseconds = typeof value?.toMillis === "function" ? value.toMillis()
    : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};
const allowedKeys = (data, keys) => {
  if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).some((key) => !keys.includes(key))) {
    fail("invalid-argument", "Unsupported archive query fields.");
  }
};

const normalizeQuery = (data) => {
  allowedKeys(data, ["semesterId", "recordType", "studentUid", "pageSize", "cursor", "_session"]);
  const semesterId = semesterCore.normalizeSemesterId(data.semesterId);
  if (!RECORD_TYPES.includes(data.recordType)) fail("invalid-argument", "Unsupported archive record type.");
  const studentUid = data.studentUid ?? null;
  if (studentUid !== null && !documentId(studentUid)) fail("invalid-argument", "Invalid student identifier.");
  if (data.recordType === "grades" && !studentUid) fail("invalid-argument", "Select a student for archived grades.");
  const pageSize = data.pageSize ?? 30;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) fail("invalid-argument", "Page size must be between 1 and 50.");
  let after = null;
  if (data.cursor !== undefined && data.cursor !== null) {
    try {
      if (typeof data.cursor !== "string" || data.cursor.length > 1500
          || !/^[A-Za-z0-9_-]+$/.test(data.cursor)) throw new Error();
      const cursor = JSON.parse(Buffer.from(data.cursor, "base64url").toString("utf8"));
      allowedKeys(cursor, ["v", "semesterId", "recordType", "studentUid", "after"]);
      if (cursor.v !== 1 || cursor.semesterId !== semesterId || cursor.recordType !== data.recordType
          || cursor.studentUid !== studentUid || !documentId(cursor.after)) throw new Error();
      after = cursor.after;
    } catch { fail("invalid-argument", "Invalid cursor for this archive query."); }
  }
  return { semesterId, recordType: data.recordType, studentUid, pageSize, after };
};

// Return text and selected values only: never signature images, email addresses,
// storage URLs, complete answers, or the source document itself.
const projectRow = (document, type, studentUid) => {
  const data = document.data || {};
  const row = {
    id: document.path.split("/").at(-1),
    studentUid: text(data.uid || data.studentUid || data.studentId || studentUid, 160),
    studentName: text(data.studentName || data.name || data.student?.name, 100),
    grade: text(data.grade || data.studentGrade || /([0-9]+)\s*학년/.exec(text(data.gradeClass))?.[1], 20),
    className: text(data.class || data.className || data.classOnly || data.studentClass, 40),
    number: text(data.number || data.studentNumber, 20),
    title: "", status: "", amount: null, balance: null, score: null, maxScore: null,
    occurredAt: null, detail: "",
  };
  if (type === "wis_wallets" || type === "grade_students") {
    row.studentUid = text(data.uid || row.id, 160);
    row.title = "학기 위스 잔액";
    row.balance = number(data.balance);
    row.occurredAt = date(data.lastTransactionAt);
    row.detail = `누적 적립 ${number(data.earnedTotal) ?? "—"} · 사용 ${number(data.spentTotal) ?? "—"}`;
  } else if (type === "wis_transactions") {
    row.title = text(data.sourceLabel || data.type);
    row.status = data.reclaimed === true ? "회수됨" : "";
    row.amount = number(data.delta);
    row.balance = number(data.balanceAfter);
    row.occurredAt = date(data.createdAt);
  } else if (type === "wis_orders") {
    row.title = text(data.productName);
    row.status = text(data.status, 50);
    row.amount = number(data.priceSnapshot);
    row.occurredAt = date(data.requestedAt);
    row.detail = text(data.memo, 1000);
  } else if (type === "grades") {
    row.title = text(data.title);
    row.score = number(data.totalScore);
    row.maxScore = number(data.totalMaxScore);
    row.status = data.signedAt ? "확인됨" : "";
    row.occurredAt = date(data.updatedAt || data.uploadedAt);
    const items = Array.isArray(data.items) ? data.items.slice(0, 100).map((item) =>
      `${text(item?.name, 80)}: ${item?.scoreEntered === false ? "미입력" : number(item?.score) ?? "—"}/${number(item?.maxScore) ?? "—"}`) : [];
    row.detail = [text(data.subject, 80), ...items, text(data.feedback, 1000)].filter(Boolean).join("\n");
  } else {
    row.title = text(data.assignmentTitle || data.unitTitle || data.title || data.unitName || data.unitId || data.category);
    // Legacy quiz_results.score is already a percentage (the quiz writer
    // calculates correctCount / totalCount * 100). History results instead
    // store both raw score/total and a separate percent; do not confuse them.
    if (type === "history_results") {
      const percent = number(data.percent);
      row.score = percent ?? number(data.score);
      row.maxScore = percent !== null ? 100 : number(data.total);
      row.detail = [number(data.score) !== null && number(data.total) !== null
        ? `정답 ${data.score}/${data.total}` : "",
      number(data.passThresholdPercent) !== null ? `통과 기준 ${data.passThresholdPercent}%` : ""].filter(Boolean).join(" · ");
    } else {
      row.score = number(data.score);
      row.maxScore = row.score !== null ? number(data.maxScore) ?? 100 : null;
      const details = Array.isArray(data.details) ? data.details : [];
      row.detail = details.length ? `정답 ${details.filter((item) => item?.correct === true).length}/${details.length}` : "";
    }
    row.status = text(data.status || (data.passed === true ? "통과" : ""), 50);
    row.occurredAt = date(data.timestamp || data.submittedAt || data.updatedAt || data.createdAt);
  }
  return row;
};

const createAdminSemesterRecordsCore = ({ store,
  assertSession = sessionAuthority.assertActiveApplicationSession } = {}) => {
  if (!store) throw new TypeError("store is required.");
  const getAdminSemesterLegacyRecords = async (request) => {
    if (!request.app) fail("unauthenticated", "App Check is required.");
    const identity = await assertSession(request, { highRisk: false, recentAuth: false });
    if (!identity?.uid || identity.uid !== request.auth?.uid
        || String(identity.email || "").trim().toLowerCase() !== ADMIN_EMAIL
        || String(request.auth?.token?.email || "").trim().toLowerCase() !== ADMIN_EMAIL) {
      fail("permission-denied", "Only the administrator can read historical semester records.");
    }
    const query = normalizeQuery(request.data);
    const assertClosed = async () => {
      const [manifest, pointer, config] = await Promise.all([
        store.get(`semester_manifests/${query.semesterId}`),
        store.get(semesterCore.ACTIVE_SEMESTER_POINTER_PATH),
        store.get(semesterCore.SITE_CONFIG_PATH),
      ]);
      if (!manifest.exists || manifest.data?.semesterId !== query.semesterId
          || !["CLOSED", "ARCHIVED"].includes(manifest.data.status)
          || !pointer.exists || !config.exists
          || !pointer.data?.semesterId || !config.data?.activeSemesterId
          || pointer.data.semesterId !== config.data.activeSemesterId
          || pointer.data.semesterId === query.semesterId
          || `${config.data.year}-${config.data.semester}` === query.semesterId) {
        fail("failed-precondition", "Only closed historical semesters can be read here.");
      }
    };
    await assertClosed();
    const [year, term] = query.semesterId.split("-");
    const path = query.recordType === "grades"
      ? `users/${query.studentUid}/performance_scores`
      : `years/${year}/semesters/${term}/${COLLECTIONS[query.recordType]}`;
    const filter = { documentIdOrder: "asc", limit: query.pageSize + 1 };
    if (query.after) filter.startAfterId = query.after;
    if (query.studentUid && query.recordType !== "grades") {
      filter.field = "uid"; filter.operator = "=="; filter.value = query.studentUid;
    }
    const documents = await store.query(path, filter);
    const scanned = documents.slice(0, query.pageSize);
    const hasMore = documents.length > query.pageSize;
    const visible = query.recordType === "grades" ? scanned.filter(({ data }) =>
      String(data?.academicYear || "") === year && String(data?.semester || "") === term
      && (!data?.uid || data.uid === query.studentUid)) : scanned;
    const rows = visible.map((document) => projectRow(document, query.recordType, query.studentUid));
    const walletUids = [...new Set(rows.filter((row) => !row.studentName && documentId(row.studentUid))
      .map((row) => row.studentUid))];
    const wallets = new Map(await Promise.all(walletUids.map(async (uid) => {
      const wallet = await store.get(`years/${year}/semesters/${term}/point_wallets/${uid}`);
      return [uid, wallet.exists ? wallet.data : null];
    })));
    rows.forEach((row) => {
      const wallet = wallets.get(row.studentUid);
      if (!wallet) return;
      row.studentName = text(wallet.studentName, 100);
      row.grade ||= text(wallet.grade, 20);
      row.className ||= text(wallet.class, 40);
      row.number ||= text(wallet.number, 20);
    });
    // Check again after reading, so a semester reopened during the query is not
    // returned under the closed-semester contract.
    await assertClosed();
    return {
      semesterId: query.semesterId, recordType: query.recordType,
      rows, provenance: "LEGACY",
      hasMore, nextCursor: hasMore ? Buffer.from(JSON.stringify({
        v: 1, semesterId: query.semesterId, recordType: query.recordType,
        studentUid: query.studentUid, after: scanned.at(-1).path.split("/").at(-1),
      })).toString("base64url") : null,
      readOnly: true,
    };
  };
  return { getAdminSemesterLegacyRecords };
};

const createAdminSemesterRecordsCallableExports = ({ core } = {}) => ({
  getAdminSemesterLegacyRecords: onCall(
    { region: "asia-northeast3", enforceAppCheck: true, timeoutSeconds: 60 },
    (request) => core.getAdminSemesterLegacyRecords(request),
  ),
});

module.exports = { RECORD_TYPES, normalizeQuery, projectRow,
  createAdminSemesterRecordsCore, createAdminSemesterRecordsCallableExports };
