// Actual callable HTTP and Firestore transactions in an isolated demo project.
// --expect-current-vulnerability explicitly expects the pre-PATCH14 defect.
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

const projectId = "demo-westory-session-dictionary-update";
const callableName = "updateStudentHistoryDictionaryWordByTeacher";
const deleteCallableName = "deleteStudentHistoryDictionaryWordByTeacher";
// Recorded pre-PATCH14 baseline harness, before the follow-up regression cases:
// e9b8127d0d49360673778c9b9c9e123acc57ebc4389271c5dbd4e4c78c998080
const mismatchReason = "HISTORY_DICTIONARY_UPDATE_MISMATCH";
const unverifiedReason = "HISTORY_DICTIONARY_UPDATE_UNVERIFIED";
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) =>
    ["--expect-current-vulnerability", "--prepare-only"].includes(arg),
  ),
);
assert.equal(new Set(args).size, args.length);
const expectVulnerability = args.includes("--expect-current-vulnerability");
const baselineCases = [
  {
    name: "current word explicit UID mismatch",
    word: { uid: "OTHER_STUDENT" },
  },
  {
    name: "current word explicit term ID mismatch",
    word: { termId: "term_other" },
  },
  { name: "current word year mismatch", word: { year: "2025" } },
  { name: "current word semester mismatch", word: { semester: "1" } },
  { name: "current word partial scope", omitWord: ["semester"] },
  {
    name: "current word normalized word contradicts displayed word",
    word: { normalizedWord: "another_word" },
  },
  {
    name: "current word displayed word contradicts normalized word",
    word: { word: "다른 저장 단어" },
  },
  { name: "current word closed status", word: { status: "rejected" } },
  { name: "linked request UID mismatch", request: { uid: "OTHER_STUDENT" } },
  { name: "linked request year mismatch", request: { year: "2025" } },
  { name: "linked request semester mismatch", request: { semester: "1" } },
  {
    name: "linked request normalized word mismatch",
    request: { normalizedWord: "another_request" },
  },
  {
    name: "linked request displayed word mismatch",
    request: { word: "다른 요청 단어" },
  },
  {
    name: "linked request matched term mismatch",
    request: { matchedTermId: "term_other" },
  },
  {
    name: "linked request resolved term mismatch",
    request: { resolvedTermId: "term_other" },
  },
  { name: "linked rejected request", request: { status: "rejected" } },
  {
    name: "missing linked request cannot be ignored or recovered",
    noRequest: true,
    reason: unverifiedReason,
  },
  {
    name: "raw UID slash path must not move nested student data",
    slash: "uid",
  },
  {
    name: "raw previous term slash path must not move nested word data",
    slash: "term",
  },
  {
    name: "stored linked request slash path must be rejected",
    slash: "request",
  },
  {
    name: "stored reward term slash path must be rejected",
    word: { rewardTermId: "term_reward/nested/target" },
  },
];
const sha1 = (value) => createHash("sha1").update(value).digest("hex");
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const termIdFor = (value) => `term_${sha1(normalize(value))}`;
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
if (args.includes("--prepare-only")) {
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.equal(baselineCases.length, 21);
  console.log(
    JSON.stringify({
      suite: "history-dictionary-update-binding-integration",
      prepared: true,
      projectId,
      sourceHead,
      localFunctionSha256,
      baselineCases: baselineCases.map((value) => value.name),
      regressionCoverage: [
        "exact mismatch/unverified reasons; full business snapshot unchanged on rejection",
        "saved/requested/direct/legacy UID and scope absent definition edit",
        "requested/needs_approval/resolved linked request preserved",
        "canonical and legacy original-ID repeated teacher rename preserves request/reward and metadata",
        "linked legacy same-word canonicalization and original-word restoration allow follow-up edit/delete",
        "unscoped legacy edit then delete never guesses reward from caller semester",
        "different-destination concurrent rename has one winner and one not-found",
        "request origin and reward origin may differ for same-ID edits; moving such a linked row is rejected",
        "destination collision; missing source; malformed raw path; forged rename bridge",
        "teacher-only role gate; request/ledger/global terms/notifications unchanged on success",
      ],
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
      ["openApplicationSession", callableName, deleteCallableName].some(
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
  `update-binding-${randomUUID()}`,
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
    `p14-${role}-${randomUUID()}@yongshin-ms.ms.kr`,
    "Synthetic-Only-Aa1!",
  );
  value.user = signedIn.user;
  value.uid = signedIn.user.uid;
  await set(`users/${value.uid}`, {
    uid: value.uid,
    email: value.user.email,
    role,
    name: "합성 수정 검증",
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
const fixture = async (student, other, teacher, options = {}) => {
  const suffix = ++serial;
  const originalWord = `P14-원본-${suffix}`;
  const word = options.renamed ? `P14-수정전-${suffix}` : originalWord;
  const normalizedWord = normalize(word);
  const originalTermId = options.legacyOriginalId
    ? `legacy_original_${suffix}`
    : termIdFor(originalWord);
  let termId = options.legacyCurrentId
    ? `legacy_current_${suffix}`
    : termIdFor(word);
  let uid = student.uid;
  if (options.slash === "uid") uid += "/nested/target";
  if (options.slash === "term") termId += "/nested/target";
  let requestId = `req_${sha1(`${scope.year}:${scope.semester}:${uid}:${normalize(originalWord)}`)}`;
  if (options.slash === "request") requestId += "/nested/target";
  const requestPath = `history_dictionary_requests/${requestId}`;
  const wordPath = `users/${uid}/history_dictionary_words/${termId}`;
  const rewardTermId = options.dualOrigin
    ? termIdFor(`P14-보상원본-${suffix}`)
    : options.renamed
      ? originalTermId
      : termId;
  const rewardPath = `${semesterRoot}/point_transactions/${rewardId(uid, rewardTermId)}`;
  const walletPath = `${semesterRoot}/point_wallets/${uid}`;
  const patch = (values = {}) =>
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        value === "OTHER_STUDENT" ? other.uid : value,
      ]),
    );
  const wordData = {
    ...scope,
    uid,
    termId,
    word,
    normalizedWord,
    definition: "기존에 저장한 학생의 충분한 합성 뜻풀이입니다.",
    studentLevel: "내가 정리한 뜻풀이",
    status: options.status || "saved",
    requestId: options.direct ? "" : requestId,
    rewardTermId,
    rewardTransactionId: rewardId(uid, rewardTermId),
    rewardAmount: 7,
    definitionSource:
      options.renamed || options.dualOrigin ? "teacher_reviewed" : "student",
    ...(options.renamed || options.dualOrigin
      ? { reviewedBy: teacher.uid, reviewedAt: oldTime }
      : {}),
    studentName: "학생 이름 보존",
    grade: "2",
    class: "3",
    number: "7",
    memo: "학생 메모 보존",
    tags: ["역사", "보존"],
    relatedUnitId: "unit-preserved",
    customMetadata: { marker: "retained", version: 3 },
    createdAt: oldTime,
    updatedAt: oldTime,
    ...patch(options.word),
  };
  if (options.legacy) {
    for (const key of [
      "uid",
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
  for (const key of options.omitWord || []) delete wordData[key];
  const requestData = {
    ...scope,
    uid,
    word: originalWord,
    normalizedWord: normalize(originalWord),
    status:
      options.requestStatus ||
      (options.status === "requested" ? "requested" : "resolved"),
    matchedTermId: options.renamed ? originalTermId : termId,
    resolvedTermId:
      options.status === "requested"
        ? ""
        : options.renamed
          ? originalTermId
          : termId,
    studentName: "요청 이름 보존",
    memo: "요청 메모 보존",
    grade: "2",
    class: "3",
    number: "7",
    customMetadata: { marker: "request-retained" },
    createdAt: oldTime,
    updatedAt: oldTime,
    ...patch(options.request),
  };
  if (options.slash === "uid")
    await set(`users/${uid}`, {
      uid,
      role: "student",
      name: "중첩 경로 합성 학생",
      grade: "2",
      class: "3",
      number: "7",
    });
  await set(wordPath, wordData);
  plans.add(requestPath);
  if (!options.direct && !options.legacy && !options.noRequest)
    await set(requestPath, requestData);
  await set(`history_dictionary_terms/${termIdFor(originalWord)}`, {
    word: originalWord,
    normalizedWord: normalize(originalWord),
    status: "published",
    definition: "전역 사전 자료는 학생 단어 수정으로 바뀌면 안 됩니다.",
    updatedAt: oldTime,
  });
  await set(walletPath, {
    uid,
    balance: 100,
    earnedTotal: 100,
    rankEarnedTotal: 100,
    updatedAt: oldTime,
  });
  await set(rewardPath, {
    uid,
    type: "history_dictionary",
    sourceId: `history-dictionary:${keyPart(rewardTermId)}`,
    delta: 7,
    balanceAfter: 100,
    createdAt: oldTime,
  });
  return {
    uid,
    termId,
    originalWord,
    word,
    normalizedWord,
    wordPath,
    requestId,
    requestPath,
    rewardTermId,
    rewardPath,
    walletPath,
    wordData,
    requestData,
    options,
    suffix,
  };
};
const payload = (item, extra = {}) => ({
  ...scope,
  uid: item.uid,
  termId: item.termId,
  word: item.word,
  definition: "선생님이 수정한 충분한 합성 뜻풀이입니다.",
  ...extra,
});
const rejectUnchanged = async (
  teacher,
  item,
  label,
  expectedReason = mismatchReason,
  extra = {},
  expectedCode = "functions/failed-precondition",
) => {
  const before = await businessSnapshot();
  let error;
  try {
    await call(teacher, payload(item, extra));
  } catch (value) {
    error = value;
  }
  ok(error, `${label}: request must be rejected`);
  eq(error.code, expectedCode, `${label}: error code`);
  if (expectedReason)
    eq(error.details?.reason, expectedReason, `${label}: reason`);
  eq(
    await businessSnapshot(),
    before,
    `${label}: rejected update has zero business writes`,
  );
  scenarios.push({
    label,
    passed: true,
    reason: error.details?.reason || null,
  });
};
const baseline = async (teacher, item, label) => {
  const before = await businessSnapshot();
  const result = await call(teacher, payload(item));
  const nextTermId = termIdFor(item.word);
  const nextPath = `users/${item.uid}/history_dictionary_words/${nextTermId}`;
  eq(result.updated, true);
  eq(result.previousTermId, item.termId);
  eq(result.termId, nextTermId);
  const updated = await read(nextPath);
  eq(updated.uid, item.uid);
  eq(updated.termId, nextTermId);
  eq(updated.definition, payload(item).definition);
  eq(updated.status, "saved");
  eq(updated.reviewedBy, teacher.uid);
  ok(
    changedPaths(before, await businessSnapshot()).length > 0,
    "Baseline must reproduce an actual persisted mutation",
  );
  if (item.wordPath !== nextPath) eq(await read(item.wordPath), null);
  eq(await read(item.requestPath), before[item.requestPath] || null);
  eq(await read(item.rewardPath), before[item.rewardPath]);
  eq(await read(item.walletPath), before[item.walletPath]);
  scenarios.push({
    label,
    vulnerabilityReproduced: true,
    changedWordPath: nextPath,
  });
};
const updateAndCheck = async (teacher, item, label, extra = {}) => {
  const before = await businessSnapshot();
  const input = payload(item, extra);
  const result = await call(teacher, input);
  const nextTermId = termIdFor(input.word);
  const nextPath = `users/${item.uid}/history_dictionary_words/${nextTermId}`;
  eq(result, {
    termId: nextTermId,
    previousTermId: item.termId,
    updated: true,
  });
  const updated = await read(nextPath);
  eq(updated.uid, item.uid);
  eq(updated.termId, nextTermId);
  eq(updated.word, input.word);
  eq(updated.normalizedWord, normalize(input.word));
  eq(updated.definition, input.definition);
  eq(updated.status, "saved");
  eq(updated.definitionSource, "teacher_reviewed");
  eq(updated.reviewedBy, teacher.uid);
  ok(updated.reviewedAt?.toMillis() > oldTime.toMillis());
  if (item.options.legacy) {
    eq(
      updated.year || "",
      "",
      "Unscoped legacy edit must not acquire caller year",
    );
    eq(
      updated.semester || "",
      "",
      "Unscoped legacy edit must not acquire caller semester",
    );
  } else {
    eq(updated.year, scope.year);
    eq(updated.semester, scope.semester);
  }
  for (const field of [
    "studentName",
    "grade",
    "class",
    "number",
    "memo",
    "tags",
    "relatedUnitId",
    "customMetadata",
    "createdAt",
  ])
    eq(updated[field], item.wordData[field], `${label}: preserved ${field}`);
  eq(updated.studentLevel, item.wordData.studentLevel || "내가 정리한 뜻풀이");
  eq(updated.requestId || "", item.wordData.requestId || "");
  if (item.options.legacy)
    eq(
      updated.rewardTermId || "",
      "",
      "Unscoped legacy edit must not invent reward provenance",
    );
  else eq(updated.rewardTermId, item.wordData.rewardTermId || item.termId);
  if (Object.hasOwn(item.wordData, "rewardTransactionId"))
    eq(updated.rewardTransactionId, item.wordData.rewardTransactionId);
  if (item.wordPath !== nextPath) eq(await read(item.wordPath), null);
  const after = await businessSnapshot();
  const changed = changedPaths(before, after);
  ok(changed.length > 0);
  ok(
    changed.every((path) => [item.wordPath, nextPath].includes(path)),
    `${label}: only selected source/destination word may change; request, ledger, notification and global terms remain unchanged`,
  );
  scenarios.push({ label, passed: true });
  return {
    ...item,
    termId: nextTermId,
    word: updated.word,
    normalizedWord: updated.normalizedWord,
    wordPath: nextPath,
    wordData: updated,
  };
};
const deleteAfterEdit = async (teacher, item, label) => {
  const before = await businessSnapshot();
  const data = {
    ...scope,
    uid: item.uid,
    termId: item.termId,
    word: item.word,
    normalizedWord: item.normalizedWord,
    requestId: item.wordData.requestId || "",
    reason: "teacher_deleted_insufficient_history_dictionary_word",
  };
  const result = await call(teacher, data, deleteCallableName);
  eq(result.deleted, true);
  eq(result.termId, item.termId);
  eq(await read(item.wordPath), null);
  const reclaimPath = `${item.rewardPath}_reclaim`;
  if (item.options.legacy) {
    // A real synthetic ledger exists in the caller semester. An unscoped edit
    // must not turn it into authorized provenance for this later deletion.
    eq(result.reward?.reclaimed, false);
    eq(result.reward?.amount, 0);
    eq(await read(item.walletPath), before[item.walletPath]);
    eq(await read(item.rewardPath), before[item.rewardPath]);
    eq(await read(reclaimPath), null);
    eq(await read(item.requestPath), before[item.requestPath] || null);
  } else {
    // These reviewed legacy-ID fixtures have an exact UID/source original
    // reward ledger worth seven points; only that ledger may be reclaimed.
    eq(result.reward?.reclaimed, true);
    eq(result.reward?.amount, 7);
    eq((await read(item.walletPath)).balance, 93);
    eq((await read(item.rewardPath)).reclaimed, true);
    const reclaimed = await read(reclaimPath);
    eq(reclaimed.delta, -7);
    eq(reclaimed.uid, item.uid);
    eq(reclaimed.type, "history_dictionary_reclaim");
    eq(reclaimed.sourceId, before[item.rewardPath].sourceId);
    const rejected = await read(item.requestPath);
    eq(rejected.status, "rejected");
    for (const [field, value] of Object.entries(before[item.requestPath]))
      if (
        ![
          "status",
          "updatedAt",
          "rejectedBy",
          "rejectedAt",
          "rejectionReason",
        ].includes(field)
      )
        eq(rejected[field], value, `${label}: preserve request ${field}`);
  }
  const after = await businessSnapshot();
  const expectedPaths = new Set([
    item.wordPath,
    `${semesterRoot}/notification_inboxes/${item.uid}`,
    ...(item.options.legacy
      ? []
      : [
          item.requestPath,
          item.walletPath,
          item.rewardPath,
          reclaimPath,
          `${semesterRoot}/point_public/hall_of_fame`,
        ]),
  ]);
  ok(
    changedPaths(before, after).every(
      (path) =>
        expectedPaths.has(path) ||
        path.startsWith(
          `${semesterRoot}/notification_inboxes/${item.uid}/items/`,
        ),
    ),
    `${label}: only the selected deletion, bound reward/request and notification may change`,
  );
  eq(
    Object.keys(after).filter(
      (path) =>
        after[path] &&
        !before[path] &&
        path.startsWith(
          `${semesterRoot}/notification_inboxes/${item.uid}/items/`,
        ),
    ).length,
    1,
  );
  scenarios.push({ label, passed: true });
  const replay = await call(teacher, data, deleteCallableName);
  eq(replay.deleted, false);
  eq(replay.reward?.reclaimed, false);
  eq(
    await businessSnapshot(),
    after,
    `${label}: repeated deletion has no writes or notification`,
  );
  scenarios.push({
    label: `${label}: repeated deletion is a pure no-op`,
    passed: true,
  });
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
  for (const options of baselineCases) {
    const item = await fixture(student, other, teacher, options);
    if (expectVulnerability) await baseline(teacher, item, options.name);
    else await rejectUnchanged(teacher, item, options.name, options.reason);
  }
  if (!expectVulnerability) {
    for (const options of [
      { name: "saved direct current word", direct: true },
      { name: "requested linked word", status: "requested" },
      {
        name: "needs_approval linked word",
        status: "requested",
        requestStatus: "needs_approval",
      },
      { name: "resolved linked word", requestStatus: "resolved" },
      {
        name: "legacy unscoped word without explicit UID or reward evidence",
        legacy: true,
      },
      {
        name: "legacy noncanonical current ID without UID/scope/reward evidence",
        legacy: true,
        legacyCurrentId: true,
      },
    ]) {
      const item = await fixture(student, other, teacher, options);
      const updated = await updateAndCheck(teacher, item, options.name);
      if (options.legacy) {
        const repeated = await updateAndCheck(
          teacher,
          updated,
          `${options.name}: repeated edit stays unscoped`,
          {
            definition:
              "학기와 보상 출처를 만들지 않는 레거시 반복 수정입니다.",
          },
        );
        await deleteAfterEdit(
          teacher,
          repeated,
          `${options.name}: deletion after edit never guesses reward`,
        );
      }
    }
    for (const options of [
      { name: "linked canonical original term", status: "requested" },
      {
        name: "linked legacy original term after prior review",
        renamed: true,
        legacyOriginalId: true,
      },
      { name: "direct saved original term", direct: true },
    ]) {
      let item = await fixture(student, other, teacher, options);
      const originalRequestId = item.wordData.requestId || "";
      const originalRewardTermId = item.wordData.rewardTermId;
      item = await updateAndCheck(
        teacher,
        item,
        `${options.name}: first rename`,
        { word: `P14-첫변경-${item.suffix}` },
      );
      item = await updateAndCheck(
        teacher,
        item,
        `${options.name}: second rename`,
        { word: `P14-재변경-${item.suffix}` },
      );
      item = await updateAndCheck(
        teacher,
        item,
        `${options.name}: definition edit after two renames`,
        {
          definition: "이름 변경 후 뜻풀이만 다시 수정한 합성 문장입니다.",
        },
      );
      eq(item.wordData.requestId || "", originalRequestId);
      eq(item.wordData.rewardTermId, originalRewardTermId);
    }
    let canonicalized = await fixture(student, other, teacher, {
      legacyCurrentId: true,
    });
    canonicalized = await updateAndCheck(
      teacher,
      canonicalized,
      "linked legacy current ID: same-word definition edit migrates to canonical ID",
    );
    canonicalized = await updateAndCheck(
      teacher,
      canonicalized,
      "linked legacy current ID: follow-up same-word edit remains authorized",
      { definition: "레거시 요청 연결을 유지하는 후속 뜻풀이 수정입니다." },
    );
    await deleteAfterEdit(
      teacher,
      canonicalized,
      "linked legacy current ID: delete after canonicalization reclaims original reward once",
    );

    let restored = await fixture(student, other, teacher, {
      renamed: true,
      legacyOriginalId: true,
    });
    restored = await updateAndCheck(
      teacher,
      restored,
      "reviewed legacy original: rename back to original word preserves legacy request binding",
      { word: restored.originalWord },
    );
    restored = await updateAndCheck(
      teacher,
      restored,
      "reviewed legacy original: edit after restoring original word remains authorized",
      {
        definition: "원래 단어로 돌아온 뒤에도 요청과 보상 연결을 보존합니다.",
      },
    );
    await deleteAfterEdit(
      teacher,
      restored,
      "reviewed legacy original: delete after restoring original word reclaims original reward once",
    );
    // Actual requestHistoryDictionaryTerm merge clears the draft text but keeps
    // a preceding teacher rename's reward origin. Published B gives a linked
    // needs_approval request for B while the original reward ledger remains A.
    let dualOrigin = await fixture(student, other, teacher, {
      dualOrigin: true,
      status: "requested",
      requestStatus: "needs_approval",
      word: { definition: "", studentLevel: "" },
    });
    ok(dualOrigin.rewardTermId !== dualOrigin.termId);
    eq(dualOrigin.requestData.matchedTermId, dualOrigin.termId);
    const dualRewardPath = dualOrigin.rewardPath;
    const dualRewardBefore = await read(dualRewardPath);
    dualOrigin = await updateAndCheck(
      teacher,
      dualOrigin,
      "separate request B/reward A origins: same-ID definition edit remains allowed",
    );
    eq(await read(dualRewardPath), dualRewardBefore);
    await rejectUnchanged(
      teacher,
      dualOrigin,
      "separate request B/reward A origins: rename to C is unverified and changes no business data",
      unverifiedReason,
      { word: `P14-새목적지-${dualOrigin.suffix}` },
    );
    for (const options of [
      {
        name: "unscoped word with reward evidence cannot take caller semester",
        direct: true,
        omitWord: ["year", "semester"],
        reason: unverifiedReason,
      },
      {
        name: "rename bridge requires teacher review",
        renamed: true,
        word: { definitionSource: "student" },
      },
      {
        name: "rename bridge requires reviewer",
        renamed: true,
        omitWord: ["reviewedBy"],
      },
      {
        name: "rename bridge requires review timestamp",
        renamed: true,
        omitWord: ["reviewedAt"],
      },
      {
        name: "rename bridge original reward must bind existing request",
        renamed: true,
        word: { rewardTermId: "term_wrong_original" },
      },
      {
        name: "explicit null request pointer is not an absent link",
        word: { requestId: null },
      },
      {
        name: "numeric request pointer is not a path",
        word: { requestId: 123 },
      },
      {
        name: "explicit null reward term is not absent provenance",
        word: { rewardTermId: null },
      },
      {
        name: "numeric reward term is not provenance",
        word: { rewardTermId: 123 },
      },
    ]) {
      const item = await fixture(student, other, teacher, options);
      await rejectUnchanged(teacher, item, options.name, options.reason);
    }
    const malformed = await fixture(student, other, teacher);
    for (const [label, extra] of [
      ["UID trim is not accepted", { uid: ` ${malformed.uid}` }],
      ["UID backslash is not accepted", { uid: `${malformed.uid}\\nested` }],
      ["UID control is not accepted", { uid: `${malformed.uid}\n` }],
      ["UID dot is not accepted", { uid: "." }],
      ["term trim is not accepted", { termId: `${malformed.termId} ` }],
      [
        "term backslash is not accepted",
        { termId: `${malformed.termId}\\nested` },
      ],
      ["term dot is not accepted", { termId: ".." }],
      ["UID length is bounded before lookup", { uid: "x".repeat(129) }],
      ["term ID length is bounded before lookup", { termId: "x".repeat(81) }],
    ])
      await rejectUnchanged(teacher, malformed, label, mismatchReason, extra);
    for (const [label, extra] of [
      ["word must be a string", { word: 123 }],
      ["definition must be a string", { definition: ["잘못된 형식"] }],
    ])
      await rejectUnchanged(
        teacher,
        malformed,
        label,
        null,
        extra,
        "functions/invalid-argument",
      );
    const collision = await fixture(student, other, teacher);
    const collisionWord = `P14-이미존재-${collision.suffix}`;
    const collisionPath = `users/${collision.uid}/history_dictionary_words/${termIdFor(collisionWord)}`;
    await set(collisionPath, {
      ...collision.wordData,
      termId: termIdFor(collisionWord),
      word: collisionWord,
      normalizedWord: normalize(collisionWord),
      memo: "이 대상은 덮어쓰면 안 됩니다.",
    });
    await rejectUnchanged(
      teacher,
      collision,
      "existing destination cannot be overwritten",
      null,
      { word: collisionWord },
      "functions/already-exists",
    );
    const missing = await fixture(student, other, teacher);
    await db.doc(missing.wordPath).delete();
    await rejectUnchanged(
      teacher,
      missing,
      "missing source cannot recreate or overwrite any row",
      null,
      {},
      "functions/not-found",
    );
    const concurrent = await fixture(student, other, teacher);
    const beforeConcurrent = await businessSnapshot();
    const concurrentInputs = ["가", "나"].map((suffix) =>
      payload(concurrent, {
        word: `P14-동시-${concurrent.suffix}-${suffix}`,
        definition: `동시 이름 변경 ${suffix}의 합성 뜻풀이입니다.`,
      }),
    );
    const concurrentResults = await Promise.allSettled(
      concurrentInputs.map((input) => call(teacher, input)),
    );
    eq(
      concurrentResults.filter((result) => result.status === "fulfilled")
        .length,
      1,
    );
    eq(
      concurrentResults.filter((result) => result.status === "rejected").length,
      1,
    );
    const winnerIndex = concurrentResults.findIndex(
      (result) => result.status === "fulfilled",
    );
    const loserIndex = 1 - winnerIndex;
    eq(concurrentResults[loserIndex].reason.code, "functions/not-found");
    const winningInput = concurrentInputs[winnerIndex];
    const winningTermId = termIdFor(winningInput.word);
    const winningPath = `users/${concurrent.uid}/history_dictionary_words/${winningTermId}`;
    const losingPath = `users/${concurrent.uid}/history_dictionary_words/${termIdFor(concurrentInputs[loserIndex].word)}`;
    eq(concurrentResults[winnerIndex].value, {
      termId: winningTermId,
      previousTermId: concurrent.termId,
      updated: true,
    });
    eq(await read(concurrent.wordPath), null);
    eq(await read(losingPath), null);
    const winningRow = await read(winningPath);
    eq(winningRow.word, winningInput.word);
    eq(winningRow.definition, winningInput.definition);
    eq(winningRow.requestId, concurrent.wordData.requestId);
    eq(winningRow.rewardTermId, concurrent.wordData.rewardTermId);
    const changedConcurrent = changedPaths(
      beforeConcurrent,
      await businessSnapshot(),
    );
    eq(
      changedConcurrent.sort(),
      [concurrent.wordPath, winningPath].sort(),
      "Different-destination concurrent rename only moves the winner; request, ledger, global terms and notifications stay unchanged",
    );
    scenarios.push({
      label:
        "two different destinations race for one source: one rename wins and one is not-found",
      passed: true,
    });
    const denied = await fixture(student, other, teacher);
    for (const actor of [student, staff])
      await rejectUnchanged(
        actor,
        denied,
        `${actor.role} cannot edit a student word`,
        null,
        {},
        "functions/permission-denied",
      );
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
    suite: "history-dictionary-update-binding-integration",
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
      "Gateway/CAS migration, real browser interaction and external staging verification",
      "Browser, Google login, production and staging",
    ],
  }),
);
