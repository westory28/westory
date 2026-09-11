// Actual callable HTTP and Firestore transactions in an isolated demo project.
// --expect-current-vulnerability explicitly expects the pre-PATCH13 defect.
// --prepare-only validates the local harness shape without opening emulators.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";

const projectId = "demo-westory-session-dictionary-delete";
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) =>
    ["--expect-current-vulnerability", "--prepare-only"].includes(arg),
  ),
);
assert.equal(new Set(args).size, args.length);
const expectVulnerability = args.includes("--expect-current-vulnerability");
const mismatchReason = "HISTORY_DICTIONARY_DELETE_MISMATCH";
const unverifiedReason = "HISTORY_DICTIONARY_DELETE_UNVERIFIED";
const negativeCases = [
  { name: "existing request UID mismatch", request: { uid: "OTHER_STUDENT" } },
  { name: "existing request year mismatch", request: { year: "2025" } },
  { name: "existing request semester mismatch", request: { semester: "1" } },
  {
    name: "existing request normalized word mismatch",
    request: { normalizedWord: "another-request-word" },
  },
  {
    name: "existing request displayed word mismatch",
    request: { word: "다른 요청 단어" },
  },
  {
    name: "existing request matched term mismatch",
    request: { matchedTermId: "term_other_request" },
  },
  {
    name: "existing request resolved term mismatch",
    request: { resolvedTermId: "term_other_request" },
  },
  { name: "existing word UID mismatch", word: { uid: "OTHER_STUDENT" } },
  {
    name: "existing word term ID mismatch",
    word: { termId: "term_other_word" },
  },
  { name: "existing word year mismatch", word: { year: "2025" } },
  { name: "existing word semester mismatch", word: { semester: "1" } },
  {
    name: "existing word normalized word mismatch",
    word: { normalizedWord: "another-student-word" },
  },
  {
    name: "existing word displayed word mismatch",
    word: { word: "다른 학생 단어" },
  },
  {
    name: "existing word newer request ID mismatch",
    word: { requestId: "req_newer_student_word" },
  },
  {
    name: "missing request and missing word cannot manufacture rejection or reclaim",
    noRequest: true,
    noWord: true,
    reason: unverifiedReason,
  },
  {
    name: "request ID with slash components is rejected before any write",
    slash: "request",
  },
  {
    name: "term ID with slash components is rejected before any write",
    slash: "term",
  },
  {
    name: "UID with slash components is rejected before any write",
    slash: "uid",
  },
];
// These cases run only against PATCH13. The 18-case baseline stays unchanged.
const proofCases = [
  ...["uid", "termId", "requestId"].map((field) => ({
    name: `missing request requires explicit current word ${field}`,
    noRequest: true,
    omitWord: [field],
    reason: unverifiedReason,
  })),
  {
    name: "missing request requires explicit current word scope",
    noRequest: true,
    omitWord: ["year", "semester"],
    reason: unverifiedReason,
  },
  {
    name: "missing request cannot use a partially scoped current word",
    noRequest: true,
    omitWord: ["semester"],
  },
  {
    name: "missing request requires canonical request ID as well as matching word pointer",
    noRequest: true,
    noncanonicalRequestId: true,
    reason: unverifiedReason,
  },
  {
    name: "missing request requires canonical current term ID",
    noRequest: true,
    noncanonicalTermId: true,
    reason: unverifiedReason,
  },
  {
    name: "missing request cannot infer an original rename binding",
    noRequest: true,
    rename: true,
    reason: unverifiedReason,
  },
  {
    name: "rename binding requires teacher reviewed source",
    rename: true,
    word: { definitionSource: "student" },
  },
  ...["reviewedBy", "reviewedAt"].map((field) => ({
    name: `rename binding requires ${field}`,
    rename: true,
    omitWord: [field],
  })),
  {
    name: "rename original reward term must match existing request links",
    rename: true,
    word: { rewardTermId: "legacy_other_original_term" },
  },
  {
    name: "rejected request with a current word cannot delete or reclaim again",
    requestStatus: "rejected",
  },
  {
    name: "unscoped legacy row with reward evidence cannot guess caller semester",
    noRequest: true,
    omitWord: ["year", "semester", "requestId"],
    payload: { requestId: "" },
    reason: unverifiedReason,
  },
];
const ledgerCases = [
  ...[
    ["UID", { uid: "OTHER_STUDENT" }],
    ["type", { type: "quiz" }],
    ["source ID", { sourceId: "history-dictionary:other_term" }],
    ["NaN delta", { delta: NaN }],
    ["infinite delta", { delta: Infinity }],
    ["string delta", { delta: "7" }],
  ].map(([name, reward]) => ({
    name: `reward ledger rejects ${name}`,
    reward,
  })),
  ...[
    ["UID", { uid: "OTHER_STUDENT" }],
    ["type", { type: "quiz_reclaim" }],
    ["source ID", { sourceId: "history-dictionary:other_term" }],
    ["amount differing from original reward", { delta: -6 }],
    ["nonnegative delta", { delta: 7 }],
    ["NaN delta", { delta: NaN }],
    ["infinite delta", { delta: -Infinity }],
    ["string delta", { delta: "-7" }],
  ].map(([name, reclaim]) => ({
    name: `reclaim ledger rejects ${name}`,
    reclaim,
  })),
];
const sha1 = (value) => createHash("sha1").update(value).digest("hex");
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const keyPart = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "empty";
const rewardId = (uid, termId) =>
  `activity_${keyPart(uid)}_history_dictionary_${keyPart(`history-dictionary:${keyPart(termId)}`)}`;
const sourceHead = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
}).trim();
const localFunctionSha256 = createHash("sha256")
  .update(readFileSync("functions/index.js"))
  .digest("hex");
const callableName = "deleteStudentHistoryDictionaryWordByTeacher";
if (args.includes("--prepare-only")) {
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.equal(negativeCases.length, 18);
  console.log(
    JSON.stringify({
      suite: "history-dictionary-delete-binding-integration",
      prepared: true,
      projectId,
      negativeCases: negativeCases.map((item) => item.name),
      regressionAdditionalRejections: [...proofCases, ...ledgerCases].map(
        (item) => item.name,
      ),
      regressionPositiveCoverage: [
        "saved/requested/needs_approval deletion and repeat",
        "direct saved student word with empty request ID deletes/reclaims once",
        "reviewed canonical and legacy-ID rename with original reward and repeat",
        "canonical missing request recovery from saved/requested word and repeat",
        "legacy official word without guessed reward and bound legacy word",
        "no-word requested/needs_approval reject only; resolved/rejected no-op",
        "no-word/no-request/no-requestId no-op",
        "stored rewardTransactionId ignored; missing reward and prior reclaim",
        "concurrent actual callable transactions delete/reclaim/notify once",
        "student/staff denied",
      ],
      sourceHead,
      localFunctionSha256,
      networkRequests: 0,
      firebaseInitialized: false,
    }),
  );
  process.exit(0);
}

assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
if (process.env.FIREBASE_CONFIG)
  assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId, projectId);
for (const key of ["GOOGLE_CLOUD_PROJECT", "WESTORY_TEST_PROJECT_ID"])
  if (process.env[key]) assert.equal(process.env[key], projectId);
const nativeFetch = globalThis.fetch;
let blockedNetworkAttempts = 0,
  checks = 0,
  serial = 0;
const scenarios = [],
  clients = [],
  plans = new Set();
globalThis.fetch = (input, init = {}) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method = String(
    init.method || (typeof input === "object" && input.method) || "GET",
  ).toUpperCase();
  let allowed = false;
  if (url.origin === "http://127.0.0.1:5001")
    allowed =
      method === "POST" &&
      ["openApplicationSession", callableName].some(
        (name) => url.pathname === `/${projectId}/asia-northeast3/${name}`,
      ) &&
      !url.search;
  if (url.origin === "http://127.0.0.1:9099")
    allowed =
      method === "POST" &&
      [
        "/identitytoolkit.googleapis.com/v1/accounts:signUp",
        "/identitytoolkit.googleapis.com/v1/accounts:lookup",
        "/identitytoolkit.googleapis.com/v1/accounts:delete",
        "/securetoken.googleapis.com/v1/token",
      ].includes(url.pathname) &&
      url.searchParams.size === 1 &&
      url.searchParams.get("key") === "demo-key";
  if (url.origin === "http://127.0.0.1:18080")
    allowed =
      method === "DELETE" &&
      url.pathname ===
        `/emulator/v1/projects/${projectId}/databases/(default)/documents` &&
      !url.search;
  if (!allowed || url.username || url.password || url.hash) {
    blockedNetworkAttempts++;
    throw Error("Non-demo or unplanned emulator request blocked");
  }
  return nativeFetch(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
};
const adminRequire = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const adminApps = adminRequire("firebase-admin/app");
const { getFirestore, Timestamp } = adminRequire("firebase-admin/firestore");
const adminApp = adminApps.initializeApp(
  { projectId },
  `delete-binding-${randomUUID()}`,
);
const db = getFirestore(adminApp);
const scope = { year: "2026", semester: "2" };
const semesterRoot = `years/${scope.year}/semesters/${scope.semester}`;
const oldTime = Timestamp.fromMillis(1000);
const eq = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const ok = (actual, message) => {
  assert.ok(actual, message);
  checks++;
};
const set = async (path, data) => {
  plans.add(path);
  await db.doc(path).set(data);
};
const read = async (path) => {
  const snapshot = await db.doc(path).get();
  return snapshot.exists ? snapshot.data() : null;
};
const call = async (actor, data, name = callableName) =>
  (
    await httpsCallable(actor.functions, name, { timeout: 60000 })({
      ...data,
      ...(actor.proof ? { _session: actor.proof } : {}),
    })
  ).data;
const clearFirestore = async () => {
  const response = await fetch(
    `http://127.0.0.1:18080/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  eq(response.status, 200);
};
const client = async (role) => {
  const app = initializeApp(
    {
      projectId,
      apiKey: "demo-key",
      authDomain: `${projectId}.firebaseapp.com`,
    },
    `${role}-${randomUUID()}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const functions = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const value = { app, auth, functions, role };
  clients.push(value);
  const signedIn = await createUserWithEmailAndPassword(
    auth,
    `p13-${role}-${randomUUID()}@yongshin-ms.ms.kr`,
    "Synthetic-Only-Aa1!",
  );
  value.user = signedIn.user;
  value.uid = signedIn.user.uid;
  await set(`users/${value.uid}`, {
    uid: value.uid,
    email: value.user.email,
    role,
    name: "합성 삭제 검증",
    grade: "2",
    class: "3",
    number: "7",
    teacherPortalEnabled: role === "teacher",
  });
  const session = await call(
    value,
    { authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2 },
    "openApplicationSession",
  );
  value.proof = {
    authorityGeneration: session.authorityGeneration,
    protocolVersion: session.protocolVersion,
    revision: session.revision,
  };
  return value;
};

// Snapshot the entire demo business database, including missing ancestor docs,
// wallet/reclaim ledgers, hall-of-fame dirtiness and notification subcollections.
// Session lease bookkeeping is excluded because the callable gate may update it.
const businessSnapshot = async () => {
  const result = {};
  let visited = 0;
  const visit = async (collection) => {
    const references = await collection.listDocuments();
    for (const ref of references.sort((a, b) => a.path.localeCompare(b.path))) {
      assert.ok(++visited <= 1200, "Unexpected demo snapshot size");
      const snapshot = await ref.get();
      result[ref.path] = snapshot.exists ? snapshot.data() : null;
      for (const child of await ref.listCollections()) await visit(child);
    }
  };
  for (const collection of await db.listCollections())
    if (
      !["application_sessions", "application_session_transitions"].includes(
        collection.id,
      )
    )
      await visit(collection);
  return result;
};
const changedPaths = (before, after) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (path) => JSON.stringify(before[path]) !== JSON.stringify(after[path]),
    )
    .sort();
const fixture = async (student, other, options = {}) => {
  const suffix = ++serial;
  const originalWord = `P13-원본-${suffix}`;
  const word = options.rename ? `P13-수정-${suffix}` : originalWord;
  const normalizedWord = normalize(word);
  const originalNormalizedWord = normalize(originalWord);
  const originalTermId = options.legacyOriginalTermId
    ? `legacy_original_${suffix}`
    : `term_${sha1(originalNormalizedWord)}`;
  let termId = options.noncanonicalTermId
    ? `legacy_current_${suffix}`
    : `term_${sha1(normalizedWord)}`;
  let uid = student.uid;
  if (options.slash === "uid") uid = `${uid}/nested/target`;
  if (options.slash === "term") termId += "/nested/target";
  let requestId = `req_${sha1(`${scope.year}:${scope.semester}:${uid}:${originalNormalizedWord}`)}`;
  if (options.noncanonicalRequestId) requestId = `req_noncanonical_${suffix}`;
  if (options.slash === "request") requestId += "/nested/target";
  const rewardTermId = options.rename ? originalTermId : termId;
  const patch = (values = {}) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === "OTHER_STUDENT" ? other.uid : value,
      ]),
    );
  const termPath = `history_dictionary_terms/${termId}`;
  const requestPath = `history_dictionary_requests/${requestId}`;
  const wordPath = `users/${uid}/history_dictionary_words/${termId}`;
  const walletPath = `${semesterRoot}/point_wallets/${uid}`;
  const transactionId = rewardId(uid, rewardTermId);
  const rewardPath = `${semesterRoot}/point_transactions/${transactionId}`;
  const reclaimPath = `${rewardPath}_reclaim`;
  const wordData = {
    ...scope,
    uid,
    termId,
    word,
    normalizedWord,
    definition: "보존해야 하는 합성 학생 풀이입니다.",
    status: options.status || "saved",
    requestId,
    rewardTermId,
    rewardTransactionId: transactionId,
    rewardAmount: 7,
    definitionSource: options.rename ? "teacher_reviewed" : "student",
    ...(options.rename
      ? { reviewedBy: options.reviewedBy, reviewedAt: oldTime }
      : {}),
    studentName: "이름 보존",
    grade: "2",
    class: "3",
    number: "7",
    memo: "메모 보존",
    tags: ["보존태그"],
    createdAt: oldTime,
    updatedAt: oldTime,
    ...patch(options.word),
  };
  const requestData = {
    ...scope,
    uid,
    word: originalWord,
    normalizedWord: originalNormalizedWord,
    status:
      options.requestStatus ||
      (options.status === "requested" ? "requested" : "resolved"),
    matchedTermId: options.rename ? originalTermId : termId,
    resolvedTermId:
      options.status === "requested"
        ? ""
        : options.rename
          ? originalTermId
          : termId,
    studentName: "요청 이름 보존",
    grade: "2",
    class: "3",
    number: "7",
    memo: "요청 메모 보존",
    createdAt: oldTime,
    updatedAt: oldTime,
    ...patch(options.request),
  };
  if (options.legacy) {
    for (const key of [
      "year",
      "semester",
      "requestId",
      "rewardTermId",
      "rewardTransactionId",
      "rewardAmount",
    ])
      delete wordData[key];
    wordData.definitionSource = "official";
  }
  for (const field of options.omitWord || []) delete wordData[field];
  if (options.slash === "uid")
    await set(`users/${uid}`, {
      uid,
      role: "student",
      name: "합성 경로 검증",
      grade: "2",
      class: "3",
      number: "7",
    });
  const term = {
    word,
    normalizedWord,
    definition: "변경되면 안 되는 전역 사전 풀이입니다.",
    status: "published",
    createdAt: oldTime,
    updatedAt: oldTime,
  };
  await set(termPath, term);
  plans.add(wordPath);
  plans.add(requestPath);
  plans.add(reclaimPath);
  if (!options.noWord) await set(wordPath, wordData);
  if (!options.noRequest) await set(requestPath, requestData);
  await set(walletPath, {
    uid,
    balance: 100,
    earnedTotal: 100,
    rankEarnedTotal: 100,
    spentTotal: 0,
    adjustedTotal: 0,
    lastTransactionAt: oldTime,
  });
  const rewardData = {
    uid,
    type: "history_dictionary",
    activityType: "history_dictionary",
    sourceId: `history-dictionary:${keyPart(rewardTermId)}`,
    delta: 7,
    balanceAfter: 100,
    policyId: "current",
    targetDate: "2026-09-11",
    createdBy: "system:auto",
    createdAt: oldTime,
    ...patch(options.reward),
  };
  plans.add(rewardPath);
  if (!options.noReward) await set(rewardPath, rewardData);
  if (options.reclaim)
    await set(reclaimPath, {
      uid,
      type: "history_dictionary_reclaim",
      sourceId: rewardData.sourceId,
      delta: -7,
      balanceAfter: 93,
      createdAt: oldTime,
      ...patch(options.reclaim),
    });
  return {
    uid,
    word,
    normalizedWord,
    termId,
    requestId,
    originalTermId,
    rewardTermId,
    termPath,
    requestPath,
    wordPath,
    walletPath,
    rewardPath,
    reclaimPath,
    term,
    wordData,
    requestData,
    options,
  };
};
const payload = (item, extra = {}) => ({
  ...scope,
  uid: item.uid,
  termId: item.termId,
  requestId: item.options.legacy ? "" : item.requestId,
  word: item.word,
  normalizedWord: item.normalizedWord,
  reason: "teacher_deleted_insufficient_history_dictionary_word",
  ...item.options.payload,
  ...extra,
});
const negative = async (
  teacher,
  item,
  label,
  expectedReason = mismatchReason,
) => {
  const before = await businessSnapshot();
  let result, error;
  try {
    result = await call(teacher, payload(item));
  } catch (value) {
    error = value;
  }
  const after = await businessSnapshot();
  const changed = changedPaths(before, after);
  if (expectVulnerability) {
    eq(
      error,
      undefined,
      `${label}: the pre-patch handler should accept the forged binding`,
    );
    ok(
      changed.length > 0,
      `${label}: baseline mode must reproduce an actual business write`,
    );
    eq(
      (await read(item.rewardPath)).reclaimed,
      true,
      "The incorrect binding reclaims the seeded real ledger reward",
    );
    eq((await read(item.walletPath)).balance, 93);
    eq(await read(item.wordPath), null);
    eq((await read(item.requestPath)).status, "rejected");
    ok(
      changed.some(
        (path) =>
          path.includes("/notification_inboxes/") && path.includes("/items/"),
      ),
      "The incorrect binding creates a real notification",
    );
    eq(
      await read(item.termPath),
      item.term,
      "The independent global term remains unchanged",
    );
    scenarios.push({
      label,
      vulnerabilityReproduced: true,
      result: { deleted: result.deleted, reclaimed: result.reward?.reclaimed },
      changedPaths: changed,
    });
  } else {
    ok(error, `${label}: contradictory or unverified binding must be rejected`);
    eq(error.code, "functions/failed-precondition", `${label}: failure code`);
    eq(error.details?.reason, expectedReason, `${label}: failure reason`);
    eq(
      after,
      before,
      `${label}: no deletion, reclaim, rejection, ledger, hall-of-fame or notification writes`,
    );
    scenarios.push({
      label,
      passed: true,
      reason: error?.details?.reason || null,
      outcome: "rejected",
    });
  }
};
const unchangedNoOp = async (teacher, item, label, extra = {}) => {
  const before = await businessSnapshot();
  const result = await call(teacher, payload(item, extra));
  eq(result.deleted, false, `${label}: deleted`);
  eq(result.reward?.reclaimed, false, `${label}: reclaimed`);
  eq(result.reward?.amount, 0, `${label}: reclaim amount`);
  eq(
    await businessSnapshot(),
    before,
    `${label}: no request, wallet, ledger, hall-of-fame or notification writes`,
  );
  scenarios.push({ label, passed: true });
};
const verifyReclaimedDeletion = async (item, result) => {
  eq(result.termId, item.termId);
  eq(result.requestId, payload(item).requestId);
  eq(result.deleted, true);
  eq(result.reward.reclaimed, true);
  eq(result.reward.amount, 7);
  eq(await read(item.wordPath), null);
  eq((await read(item.walletPath)).balance, 93);
  eq((await read(item.rewardPath)).reclaimed, true);
  const reclaim = await read(item.reclaimPath);
  eq(reclaim.uid, item.uid);
  eq(reclaim.type, "history_dictionary_reclaim");
  eq(reclaim.sourceId, `history-dictionary:${keyPart(item.rewardTermId)}`);
  eq(reclaim.delta, -7);
  eq(await read(item.termPath), item.term);
};
const verifyExistingRequestPreserved = async (item) => {
  const rejected = await read(item.requestPath);
  eq(rejected.status, "rejected");
  for (const field of [
    "uid",
    "word",
    "normalizedWord",
    "year",
    "semester",
    "studentName",
    "grade",
    "class",
    "number",
    "memo",
    "matchedTermId",
    "resolvedTermId",
    "createdAt",
  ])
    eq(
      rejected[field],
      item.requestData[field],
      `${field}: original request preserved`,
    );
};
let failure,
  cleared = false,
  deletedUsers = 0;
const cleanupErrors = [];
try {
  await clearFirestore();
  const teacher = await client("teacher"),
    student = await client("student"),
    other = await client("student"),
    staff = await client("staff");
  for (const options of negativeCases) {
    const item = await fixture(student, other, options);
    await negative(teacher, item, options.name, options.reason);
  }
  if (!expectVulnerability) {
    for (const options of [...proofCases, ...ledgerCases]) {
      const item = await fixture(student, other, {
        ...options,
        reviewedBy: teacher.uid,
      });
      await negative(teacher, item, options.name, options.reason);
    }
    for (const options of [
      { name: "saved", status: "saved" },
      { name: "requested", status: "requested" },
      {
        name: "needs_approval",
        status: "requested",
        requestStatus: "needs_approval",
      },
      {
        name: "teacher reviewed canonical rename",
        status: "saved",
        rename: true,
      },
      {
        name: "teacher reviewed legacy original ID rename",
        status: "saved",
        rename: true,
        legacyOriginalTermId: true,
      },
      {
        name: "official legacy word with a bound existing request",
        omitWord: ["uid", "year", "semester"],
        word: { definitionSource: "official" },
      },
    ]) {
      const item = await fixture(student, other, {
        ...options,
        reviewedBy: teacher.uid,
      });
      const result = await call(teacher, payload(item));
      await verifyReclaimedDeletion(item, result);
      await verifyExistingRequestPreserved(item);
      scenarios.push({
        label: `normal ${options.name} deletion preserves original request and reward binding`,
        passed: true,
      });
      await unchangedNoOp(teacher, item, `${options.name}: repeated deletion`);
    }
    for (const status of ["saved", "requested"]) {
      const item = await fixture(student, other, { noRequest: true, status });
      eq(await read(item.requestPath), null);
      const result = await call(teacher, payload(item));
      await verifyReclaimedDeletion(item, result);
      const recovered = await read(item.requestPath);
      for (const [field, value] of Object.entries({
        ...scope,
        uid: item.uid,
        word: item.word,
        normalizedWord: item.normalizedWord,
        status: "rejected",
        matchedTermId: item.termId,
        resolvedTermId: "",
        rejectedBy: teacher.uid,
        memo: item.wordData.memo,
        createdAt: oldTime,
      }))
        eq(recovered[field], value, `recovered ${field}`);
      for (const field of ["grade", "class", "number"])
        eq(recovered[field], (await read(`users/${item.uid}`))[field]);
      scenarios.push({
        label: `canonical missing request recovery from current ${status} word`,
        passed: true,
      });
      await unchangedNoOp(
        teacher,
        item,
        `recovered ${status} request: repeated deletion`,
      );
    }
    const direct = await fixture(student, other, {
      noRequest: true,
      status: "saved",
      word: { requestId: "", definitionSource: "student" },
      payload: { requestId: "" },
    });
    const beforeDirect = await businessSnapshot();
    await verifyReclaimedDeletion(direct, await call(teacher, payload(direct)));
    eq(await read(direct.requestPath), null);
    eq(
      changedPaths(beforeDirect, await businessSnapshot()).filter((path) =>
        path.startsWith("history_dictionary_requests/"),
      ),
      [],
      "Direct saved word deletion does not manufacture a request",
    );
    scenarios.push({
      label:
        "direct saved student word with empty request ID reclaims bound reward and deletes",
      passed: true,
    });
    await unchangedNoOp(
      teacher,
      direct,
      "direct saved empty-request deletion repeat",
    );
    const legacy = await fixture(student, other, {
      legacy: true,
      noRequest: true,
      omitWord: ["uid", "termId"],
    });
    const legacyReward = await read(legacy.rewardPath),
      legacyWallet = await read(legacy.walletPath);
    const legacyResult = await call(teacher, payload(legacy));
    eq(legacyResult.deleted, true);
    eq(legacyResult.reward?.reclaimed, false);
    eq(await read(legacy.wordPath), null);
    eq(await read(legacy.rewardPath), legacyReward);
    eq(await read(legacy.walletPath), legacyWallet);
    eq(await read(legacy.reclaimPath), null);
    eq(await read(legacy.requestPath), null);
    eq(await read(legacy.termPath), legacy.term);
    scenarios.push({
      label:
        "official saved legacy row without scope/reward proof deletes without guessing reward from caller semester",
      passed: true,
    });
    await unchangedNoOp(
      teacher,
      legacy,
      "legacy deletion repeated with no request ID",
    );
    for (const requestStatus of ["requested", "needs_approval"]) {
      const openOnly = await fixture(student, other, {
        noWord: true,
        status: "requested",
        requestStatus,
        // No current word means that even an unrelated malformed reward ledger
        // must not be used to infer a reclaim or block request-only rejection.
        reward: { uid: other.uid, type: "unrelated_activity" },
      });
      const before = await businessSnapshot();
      const result = await call(teacher, payload(openOnly));
      eq(result.deleted, false);
      eq(result.reward?.reclaimed, false);
      eq(result.reward?.amount, 0);
      await verifyExistingRequestPreserved(openOnly);
      const after = await businessSnapshot();
      const changed = changedPaths(before, after);
      ok(changed.includes(openOnly.requestPath));
      ok(
        changed.every(
          (path) =>
            path === openOnly.requestPath ||
            path.includes("/notification_inboxes/"),
        ),
        "Request-only rejection changes only the request and notification inbox",
      );
      eq(await read(openOnly.rewardPath), before[openOnly.rewardPath]);
      eq(await read(openOnly.walletPath), before[openOnly.walletPath]);
      eq(await read(openOnly.reclaimPath), null);
      scenarios.push({
        label: `no-word ${requestStatus} rejects request without guessed reward`,
        passed: true,
      });
      await unchangedNoOp(
        teacher,
        openOnly,
        `no-word ${requestStatus}: rejection repeat`,
      );
    }
    for (const requestStatus of ["resolved", "rejected"]) {
      for (const rename of [false, true]) {
        const closed = await fixture(student, other, {
          noWord: true,
          requestStatus,
          rename,
          reviewedBy: teacher.uid,
        });
        await unchangedNoOp(
          teacher,
          closed,
          `no-word ${requestStatus}${rename ? " renamed" : ""} request remains unchanged`,
        );
      }
    }
    const absent = await fixture(student, other, {
      noWord: true,
      noRequest: true,
    });
    await unchangedNoOp(
      teacher,
      absent,
      "no word and no requested request ID does not manufacture any writes",
      { requestId: "" },
    );

    const storedPointer = await fixture(student, other, {
      word: { rewardTransactionId: "untrusted_stored_reward_pointer" },
    });
    const decoyPath = `${semesterRoot}/point_transactions/untrusted_stored_reward_pointer`;
    await set(decoyPath, {
      uid: other.uid,
      type: "quiz",
      sourceId: "unrelated",
      delta: 99,
      createdAt: oldTime,
    });
    const decoy = await read(decoyPath);
    await verifyReclaimedDeletion(
      storedPointer,
      await call(teacher, payload(storedPointer)),
    );
    eq(
      await read(decoyPath),
      decoy,
      "Stored transaction ID cannot redirect ledger lookup",
    );
    scenarios.push({
      label:
        "derived original reward ledger is used instead of stored rewardTransactionId",
      passed: true,
    });
    await unchangedNoOp(
      teacher,
      storedPointer,
      "stored-pointer deletion repeat",
    );

    for (const options of [
      { name: "missing reward", noReward: true },
      { name: "valid existing reclaim", reclaim: {} },
      {
        name: "already reclaimed reward",
        reward: { reclaimed: true },
        reclaim: {},
      },
    ]) {
      const item = await fixture(student, other, options);
      const originalWallet = await read(item.walletPath),
        originalReclaim = await read(item.reclaimPath);
      const result = await call(teacher, payload(item));
      eq(result.deleted, true);
      eq(result.reward?.reclaimed, false);
      eq(result.reward?.amount, 0);
      eq(await read(item.wordPath), null);
      await verifyExistingRequestPreserved(item);
      eq(await read(item.walletPath), originalWallet);
      eq(await read(item.reclaimPath), originalReclaim);
      eq(await read(item.termPath), item.term);
      scenarios.push({
        label: `${options.name} does not debit wallet again`,
        passed: true,
      });
      await unchangedNoOp(teacher, item, `${options.name}: deletion repeat`);
    }

    const concurrent = await fixture(student, other);
    const beforeConcurrent = await businessSnapshot();
    const concurrentResults = await Promise.all([
      call(teacher, payload(concurrent)),
      call(teacher, payload(concurrent)),
    ]);
    eq(concurrentResults.filter((result) => result.deleted).length, 1);
    eq(
      concurrentResults.filter((result) => result.deleted === false).length,
      1,
    );
    eq(
      concurrentResults.filter((result) => result.reward?.reclaimed).length,
      1,
    );
    await verifyReclaimedDeletion(
      concurrent,
      concurrentResults.find((result) => result.deleted),
    );
    await verifyExistingRequestPreserved(concurrent);
    const loser = concurrentResults.find((result) => !result.deleted);
    eq(loser.reward?.reclaimed, false);
    eq(loser.reward?.amount, 0);
    const afterConcurrent = await businessSnapshot();
    const addedConcurrent = Object.keys(afterConcurrent).filter(
      (path) => afterConcurrent[path] && !beforeConcurrent[path],
    );
    eq(
      addedConcurrent.filter((path) => path.endsWith("_reclaim")),
      [concurrent.reclaimPath],
    );
    eq(
      addedConcurrent.filter(
        (path) =>
          path.includes("/notification_inboxes/") && path.includes("/items/"),
      ).length,
      1,
    );
    scenarios.push({
      label:
        "two simultaneous actual callable transactions delete/reclaim/notify once",
      passed: true,
    });
    await unchangedNoOp(
      teacher,
      concurrent,
      "concurrent winner and loser are followed by a write-free repeat",
    );

    const denied = await fixture(student, other);
    for (const actor of [student, staff]) {
      const before = await businessSnapshot();
      await assert.rejects(
        () => call(actor, payload(denied)),
        (error) => error.code === "functions/permission-denied",
      );
      checks++;
      eq(await businessSnapshot(), before);
      scenarios.push({
        label: `${actor.role} cannot delete dictionary words`,
        passed: true,
      });
    }
  }
  eq(blockedNetworkAttempts, 0);
} catch (error) {
  failure = {
    name: error.name,
    message: error.message,
    code: error.code,
    reason: error.details?.reason,
    stack: error.stack,
  };
} finally {
  for (const value of clients) {
    if (value.user)
      try {
        await deleteUser(value.user);
        deletedUsers++;
      } catch (error) {
        cleanupErrors.push({
          phase: "delete-auth-user",
          code: error.code,
          message: error.message,
        });
      }
    try {
      await deleteApp(value.app);
    } catch (error) {
      cleanupErrors.push({
        phase: "delete-client-app",
        message: error.message,
      });
    }
  }
  try {
    await clearFirestore();
    eq(await businessSnapshot(), {});
    eq((await db.collection("application_sessions").listDocuments()).length, 0);
    eq(
      (await db.collection("application_session_transitions").listDocuments())
        .length,
      0,
    );
    cleared = true;
  } catch (error) {
    cleanupErrors.push({
      phase: "clear-exact-demo-firestore",
      message: error.message,
    });
  }
  try {
    await adminApps.deleteApp(adminApp);
  } catch (error) {
    cleanupErrors.push({ phase: "close-admin", message: error.message });
  }
  globalThis.fetch = nativeFetch;
}
const passed =
  !failure &&
  cleanupErrors.length === 0 &&
  cleared &&
  deletedUsers === 4 &&
  blockedNetworkAttempts === 0;
if (!passed) process.exitCode = 1;
console.log(
  JSON.stringify({
    suite: "history-dictionary-delete-binding-integration",
    mode: expectVulnerability
      ? "pre-patch-vulnerability-reproduction"
      : "regression",
    passed,
    checks,
    scenarios,
    projectId,
    sourceHead,
    localFunctionSha256,
    failure,
    cleanupErrors,
    blockedNetworkAttempts,
    externalAccess: 0,
    productionAccess: 0,
    stagingAccess: 0,
    cleanup: { deletedUsers, cleared, rulesChanged: false },
    appCheck: "DISABLED_BY_DEMO_CONTRACT",
    exclusions: [
      "The source hash describes the local file, not independent emulator deployment attestation",
      "Gateway/CAS migration and server delete atomicity across notification fanout",
      "Browser, Google login, production and staging",
    ],
  }),
);
