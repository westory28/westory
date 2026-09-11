// Actual callable HTTP and Firestore transactions in an isolated demo project.
// --expect-current-vulnerability explicitly expects the pre-PATCH15 behavior defect.
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

const projectId = "demo-westory-session-dictionary-origin";
const callableName = "updateStudentHistoryDictionaryWordByTeacher";
const deleteCallableName = "deleteStudentHistoryDictionaryWordByTeacher";
const callableNames = [
  "openApplicationSession",
  "saveStudentHistoryDictionaryEntry",
  "saveStudentHistoryDictionaryWord",
  "requestHistoryDictionaryTerm",
  callableName,
  deleteCallableName,
  "saveHistoryDictionaryTerm",
  "approveHistoryDictionaryTermForRequests",
];
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) =>
    ["--expect-current-vulnerability", "--prepare-only"].includes(arg),
  ),
);
assert.equal(new Set(args).size, args.length);
const expectVulnerability = args.includes("--expect-current-vulnerability");
const sha1 = (value) => createHash("sha1").update(value).digest("hex");
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const termIdFor = (word) => `term_${sha1(normalize(word))}`;
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
// Recorded baseline harness SHA256, before the post-PATCH15 regression cases:
// 474f16df0ebe2a7a2c25d786088399736144c8f9588d9203b9064a16f9282a50
const regressionReady = true;
if (args.includes("--prepare-only")) {
  assert.match(sourceHead, /^[a-f0-9]{40}$/);
  assert.equal(callableNames.length, 8);
  console.log(
    JSON.stringify({
      suite: "history-dictionary-request-origin-integration",
      baselinePrepared: true,
      regressionReady,
      projectId,
      sourceHead,
      localFunctionSha256,
      callableNames,
      baseline:
        "actual award A -> teacher rename B -> actual request B -> teacher rename C is UPDATE_UNVERIFIED with zero business writes; request writer omits origin",
      networkRequests: 0,
      firebaseInitialized: false,
    }),
  );
  process.exit(0);
}
assert.ok(
  expectVulnerability || regressionReady,
  "PATCH15 default regression is not frozen yet",
);
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
      callableNames.some(
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
  `origin-binding-${randomUUID()}`,
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
    `p15-${role}-${randomUUID()}@yongshin-ms.ms.kr`,
    "Synthetic-Only-Aa1!",
  );
  value.user = signedIn.user;
  value.uid = signedIn.user.uid;
  await set(`users/${value.uid}`, {
    uid: value.uid,
    email: value.user.email,
    role,
    name: "합성 요청 출처 검증",
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
const wordPath = (uid, termId) =>
  `users/${uid}/history_dictionary_words/${termId}`;
const requestPath = (requestId) => `history_dictionary_requests/${requestId}`;
const rewardPath = (uid, termId) =>
  `${semesterRoot}/point_transactions/${rewardId(uid, termId)}`;
const walletPath = (uid) => `${semesterRoot}/point_wallets/${uid}`;
const definition =
  "학생이 역사적 배경과 사건의 의미를 자기 말로 충분히 정리한 합성 뜻풀이입니다.";
const updatePayload = (uid, termId, word, extra = {}) => ({
  ...scope,
  uid,
  termId,
  word,
  definition,
  ...extra,
});
const rejectUnchanged = async (
  actor,
  name,
  data,
  reason,
  label,
  code = "functions/failed-precondition",
) => {
  const before = await businessSnapshot();
  let error;
  try {
    await call(actor, data, name);
  } catch (value) {
    error = value;
  }
  ok(error, `${label}: request must fail`);
  eq(error.code, code);
  if (reason) eq(error.details?.reason, reason);
  eq(await businessSnapshot(), before, `${label}: no business writes`);
  scenarios.push({
    label,
    passed: true,
    reason: error.details?.reason || null,
  });
};
const policySeed = async () => {
  // Actual loadPolicy/normalizePointPolicy read this exact demo semester path.
  // The reward ledger and wallet are deliberately created by the real writer.
  await set(`${semesterRoot}/point_policies/current`, {
    autoRewardEnabled: true,
    controlPolicy: { autoRewardEnabled: true },
    rewardPolicy: {
      historyDictionary: {
        enabled: true,
        amount: 7,
        maxDailyClaims: 4,
        minDefinitionLength: 20,
      },
    },
  });
};
const startDualOriginChain = async (teacher, student) => {
  const suffix = ++serial;
  const a = `P15-보상-A-${suffix}`,
    b = `P15-요청-B-${suffix}`,
    c = `P15-변경-C-${suffix}`;
  const aid = termIdFor(a),
    bid = termIdFor(b),
    cid = termIdFor(c);
  const beforeWallet = await read(walletPath(student.uid));
  const balance = beforeWallet?.balance || 0;
  const saved = await call(
    student,
    {
      ...scope,
      word: a,
      definition,
      requestOriginTermId: "caller_forged_origin",
    },
    "saveStudentHistoryDictionaryEntry",
  );
  eq(saved.saved, true);
  eq(saved.termId, aid);
  eq(saved.reward?.awarded, true);
  eq(saved.reward?.amount, 7);
  const actualReward = await read(rewardPath(student.uid, aid));
  eq(actualReward.uid, student.uid);
  eq(actualReward.type, "history_dictionary");
  eq(actualReward.sourceId, `history-dictionary:${keyPart(aid)}`);
  eq(actualReward.delta, 7);
  eq((await read(walletPath(student.uid))).balance, balance + 7);
  const direct = await read(wordPath(student.uid, aid));
  eq(direct.requestId, "");
  eq(direct.rewardTermId, aid);
  if (!expectVulnerability) eq(direct.requestOriginTermId, "");
  scenarios.push({
    label:
      "actual student writer creates A reward ledger and clears caller-supplied request origin",
    passed: true,
  });
  const beforeRename = await businessSnapshot();
  const renamed = await call(
    teacher,
    updatePayload(student.uid, aid, b, {
      requestOriginTermId: "caller_forged_origin",
    }),
  );
  eq(renamed, { previousTermId: aid, termId: bid, updated: true });
  eq(await read(wordPath(student.uid, aid)), null);
  const bBeforeRequest = await read(wordPath(student.uid, bid));
  eq(bBeforeRequest.rewardTermId, aid);
  eq(bBeforeRequest.requestId, "");
  eq(bBeforeRequest.definitionSource, "teacher_reviewed");
  eq(bBeforeRequest.reviewedBy, teacher.uid);
  if (!expectVulnerability) eq(bBeforeRequest.requestOriginTermId, "");
  eq(
    changedPaths(beforeRename, await businessSnapshot()).sort(),
    [wordPath(student.uid, aid), wordPath(student.uid, bid)].sort(),
  );
  scenarios.push({
    label:
      "actual teacher rename A to B keeps A reward origin and direct empty request origin",
    passed: true,
  });
  const requested = await call(
    student,
    {
      ...scope,
      word: b,
      memo: "새 단어 B의 실제 요청",
      warningAccepted: true,
      requestOriginTermId: "caller_forged_origin",
    },
    "requestHistoryDictionaryTerm",
  );
  eq(requested.termId, bid);
  eq(requested.created, true);
  eq(requested.status, "requested");
  const requestId = `req_${sha1(`${scope.year}:${scope.semester}:${student.uid}:${normalize(b)}`)}`;
  eq(requested.requestId, requestId);
  const req = await read(requestPath(requestId));
  eq(req.uid, student.uid);
  eq(req.word, b);
  eq(req.year, scope.year);
  eq(req.semester, scope.semester);
  const bRow = await read(wordPath(student.uid, bid));
  eq(bRow.requestId, requestId);
  eq(bRow.rewardTermId, aid);
  eq(bRow.status, "requested");
  eq(bRow.definition, "");
  eq(await read(rewardPath(student.uid, aid)), actualReward);
  if (expectVulnerability) {
    eq(
      Object.hasOwn(bRow, "requestOriginTermId"),
      false,
      "Baseline request writer does not create the new independent request origin field",
    );
    scenarios.push({
      label:
        "baseline actual request writer omits independent origin despite request B/reward A",
      gapReproduced: true,
    });
  } else {
    eq(
      bRow.requestOriginTermId,
      bid,
      "Request origin is server-calculated B despite forged caller input",
    );
    scenarios.push({
      label:
        "actual request writer records B independently from retained A reward",
      passed: true,
    });
  }
  return {
    a,
    b,
    c,
    aid,
    bid,
    cid,
    requestId,
    balance,
    actualReward,
    bRow,
    uid: student.uid,
  };
};
const state = async (uid, termId) => {
  const path = wordPath(uid, termId),
    row = await read(path);
  ok(row, `Actual student word ${termId} exists`);
  return {
    uid,
    termId,
    path,
    row,
    word: row.word,
    requestId: row.requestId || "",
  };
};
const originEdit = async (
  teacher,
  item,
  word,
  expectedOrigin,
  expectedReward,
  label,
) => {
  const before = await businessSnapshot();
  const result = await call(
    teacher,
    updatePayload(item.uid, item.termId, word, {
      requestOriginTermId: { caller: "must not control server origin" },
    }),
  );
  const nextTermId = termIdFor(word),
    nextPath = wordPath(item.uid, nextTermId);
  eq(result, {
    termId: nextTermId,
    previousTermId: item.termId,
    updated: true,
  });
  const next = await state(item.uid, nextTermId);
  eq(next.row.requestOriginTermId, expectedOrigin);
  eq(next.row.rewardTermId, expectedReward);
  eq(next.row.requestId || "", item.row.requestId || "");
  eq(next.row.definition, definition);
  eq(next.row.word, word);
  eq(next.row.normalizedWord, normalize(word));
  eq(next.row.status, "saved");
  eq(next.row.definitionSource, "teacher_reviewed");
  eq(next.row.reviewedBy, teacher.uid);
  if (item.path !== nextPath) eq(await read(item.path), null);
  const changed = changedPaths(before, await businessSnapshot());
  ok(
    changed.every((path) => [item.path, nextPath].includes(path)),
    `${label}: only the selected word moves/changes; request, reward, wallet, global term and notification remain unchanged`,
  );
  scenarios.push({ label, passed: true });
  return next;
};
const deleteData = (item) => ({
  ...scope,
  uid: item.uid,
  termId: item.termId,
  word: item.word,
  normalizedWord: normalize(item.word),
  requestId: item.requestId,
  requestOriginTermId: "caller_forged_origin",
  reason: "teacher_deleted_insufficient_history_dictionary_word",
});
const deleteAndReplay = async (teacher, item, label, expectedAmount = 0) => {
  const before = await businessSnapshot();
  const result = await call(teacher, deleteData(item), deleteCallableName);
  eq(result.deleted, true);
  eq(await read(item.path), null);
  eq(result.reward?.reclaimed, expectedAmount > 0);
  eq(result.reward?.amount, expectedAmount);
  const actualRewardPath = rewardPath(
    item.uid,
    item.row.rewardTermId || item.termId,
  );
  if (expectedAmount) {
    eq(
      (await read(walletPath(item.uid))).balance,
      before[walletPath(item.uid)].balance - expectedAmount,
    );
    eq((await read(actualRewardPath)).reclaimed, true);
    const reclaim = await read(`${actualRewardPath}_reclaim`);
    eq(reclaim.delta, -expectedAmount);
    eq(reclaim.uid, item.uid);
    eq(reclaim.sourceId, before[actualRewardPath].sourceId);
  } else {
    eq(await read(walletPath(item.uid)), before[walletPath(item.uid)] || null);
    eq(await read(actualRewardPath), before[actualRewardPath] || null);
  }
  if (item.requestId) {
    const rejected = await read(requestPath(item.requestId));
    eq(rejected.status, "rejected");
    for (const field of [
      "uid",
      "word",
      "normalizedWord",
      "year",
      "semester",
      "matchedTermId",
      "resolvedTermId",
      "createdAt",
    ])
      eq(rejected[field], before[requestPath(item.requestId)]?.[field]);
  }
  const after = await businessSnapshot();
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
  const allowed = new Set([
    item.path,
    requestPath(item.requestId),
    walletPath(item.uid),
    actualRewardPath,
    `${actualRewardPath}_reclaim`,
    `${semesterRoot}/point_public/hall_of_fame`,
    `${semesterRoot}/notification_inboxes/${item.uid}`,
  ]);
  ok(
    changedPaths(before, after).every(
      (path) =>
        allowed.has(path) ||
        path.startsWith(
          `${semesterRoot}/notification_inboxes/${item.uid}/items/`,
        ),
    ),
  );
  const replay = await call(teacher, deleteData(item), deleteCallableName);
  eq(replay.deleted, false);
  eq(replay.reward?.reclaimed, false);
  eq(
    await businessSnapshot(),
    after,
    "Repeated deletion makes no request, reward or notification writes",
  );
  scenarios.push({ label, passed: true });
};
const freshRequest = async (
  student,
  label,
  word = `P15-${label}-${++serial}`,
) => {
  const result = await call(
    student,
    {
      ...scope,
      word,
      memo: `합성 ${label}`,
      warningAccepted: true,
      requestOriginTermId: "caller_forged_origin",
    },
    "requestHistoryDictionaryTerm",
  );
  const item = await state(student.uid, result.termId);
  eq(item.row.requestOriginTermId, result.termId);
  eq(item.requestId, result.requestId);
  return { ...item, response: result };
};
const publish = async (teacher, word, extra = {}) =>
  call(
    teacher,
    {
      ...scope,
      word,
      definition,
      tags: ["합성"],
      requestOriginTermId: "caller_forged_origin",
      ...extra,
    },
    "saveHistoryDictionaryTerm",
  );
const approve = async (teacher, item) =>
  call(
    teacher,
    {
      ...scope,
      termId: item.termId,
      requestId: item.requestId,
      requestOriginTermId: "caller_forged_origin",
    },
    "approveHistoryDictionaryTermForRequests",
  );
const replaceForCheck = async (path, patch, fn, omitted = []) => {
  const original = await read(path);
  const changed = { ...original, ...patch };
  for (const key of omitted) delete changed[key];
  await set(path, changed);
  try {
    await fn();
  } finally {
    await set(path, original);
  }
};
const verifyOriginRejections = async (teacher, item, wrongOrigin) => {
  for (const [label, origin] of [
    ["another term", wrongOrigin],
    ["null", null],
    ["object", { forged: true }],
    ["number", 13],
    ["slash", "term_bad/nested/target"],
    ["backslash", "term_bad\\target"],
    ["padded", " term_bad"],
    ["overlong", "x".repeat(81)],
  ])
    await replaceForCheck(
      item.path,
      { requestOriginTermId: origin },
      async () => {
        await rejectUnchanged(
          teacher,
          callableName,
          updatePayload(item.uid, item.termId, item.word),
          "HISTORY_DICTIONARY_UPDATE_MISMATCH",
          `stored ${label} origin cannot authorize update`,
        );
        await rejectUnchanged(
          teacher,
          deleteCallableName,
          deleteData(item),
          "HISTORY_DICTIONARY_DELETE_MISMATCH",
          `stored ${label} origin cannot authorize delete`,
        );
      },
    );
  for (const patch of [
    { uid: "another-student" },
    { year: "2025" },
    { semester: "1" },
  ])
    await replaceForCheck(requestPath(item.requestId), patch, async () => {
      await rejectUnchanged(
        teacher,
        callableName,
        updatePayload(item.uid, item.termId, item.word),
        "HISTORY_DICTIONARY_UPDATE_MISMATCH",
        `valid origin does not bypass request ${Object.keys(patch)[0]} binding`,
      );
      await rejectUnchanged(
        teacher,
        deleteCallableName,
        deleteData(item),
        "HISTORY_DICTIONARY_DELETE_MISMATCH",
        `valid origin does not bypass delete request ${Object.keys(patch)[0]} binding`,
      );
    });
  for (const patch of [
    { definitionSource: "student" },
    { reviewedBy: "" },
    { reviewedAt: null },
  ])
    await replaceForCheck(item.path, patch, async () => {
      await rejectUnchanged(
        teacher,
        callableName,
        updatePayload(item.uid, item.termId, item.word),
        "HISTORY_DICTIONARY_UPDATE_MISMATCH",
        `explicit moved origin still requires ${Object.keys(patch)[0]} review proof`,
      );
      await rejectUnchanged(
        teacher,
        deleteCallableName,
        deleteData(item),
        "HISTORY_DICTIONARY_DELETE_MISMATCH",
        `delete explicit moved origin still requires ${Object.keys(patch)[0]} review proof`,
      );
    });
  await replaceForCheck(
    item.path,
    {},
    async () => {
      await rejectUnchanged(
        teacher,
        callableName,
        updatePayload(item.uid, item.termId, item.word),
        "HISTORY_DICTIONARY_UPDATE_MISMATCH",
        "ambiguous legacy C/request B/reward A without explicit origin cannot update",
      );
      await rejectUnchanged(
        teacher,
        deleteCallableName,
        deleteData(item),
        "HISTORY_DICTIONARY_DELETE_MISMATCH",
        "ambiguous legacy C/request B/reward A without explicit origin cannot delete",
      );
    },
    ["requestOriginTermId"],
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
  await policySeed();
  const chain = await startDualOriginChain(teacher, student);
  if (expectVulnerability) {
    await rejectUnchanged(
      teacher,
      callableName,
      updatePayload(student.uid, chain.bid, chain.c),
      "HISTORY_DICTIONARY_UPDATE_UNVERIFIED",
      "baseline actual A reward -> B request -> C rename is blocked despite valid writer history",
    );
  } else {
    let current = await state(student.uid, chain.bid);
    current = await originEdit(
      teacher,
      current,
      chain.c,
      chain.bid,
      chain.aid,
      "request B/reward A permits actual teacher rename to C with separate origin",
    );
    current = await originEdit(
      teacher,
      current,
      current.word,
      chain.bid,
      chain.aid,
      "renamed C supports further definition edit without changing either origin",
    );
    await verifyOriginRejections(teacher, current, chain.aid);
    await deleteAndReplay(
      teacher,
      current,
      "renamed C deletion rejects request B and reclaims real A reward exactly once",
      7,
    );
    eq((await read(walletPath(student.uid))).balance, chain.balance);

    // Reopen the real rejected B request. Old resolution references must be
    // reset while the prior rejection metadata is retained for history.
    const rejectedBefore = await read(requestPath(chain.requestId));
    await set(requestPath(chain.requestId), {
      ...rejectedBefore,
      matchedTermId: "legacy_stale_match",
      resolvedTermId: "legacy_stale_resolution",
      resolvedBy: "legacy_reviewer",
      resolvedAt: oldTime,
    });
    let reopened = await freshRequest(student, "reopen-rejected-B", chain.b);
    eq(reopened.response.status, "requested");
    const reopenedRequest = await read(requestPath(chain.requestId));
    eq(reopenedRequest.status, "requested");
    eq(reopenedRequest.matchedTermId, "");
    eq(reopenedRequest.resolvedTermId, "");
    eq(reopenedRequest.resolvedBy, "");
    eq(reopenedRequest.resolvedAt, null);
    for (const field of ["rejectedBy", "rejectedAt", "rejectionReason"])
      eq(reopenedRequest[field], rejectedBefore[field]);
    scenarios.push({
      label:
        "rejected actual request reopens with current origin, cleared resolution and preserved rejection history",
      passed: true,
    });

    // Pending re-request is a real writer merge and must preserve the pending
    // status, reset its independent origin to this current term, and bind refs.
    await set(reopened.path, {
      ...reopened.row,
      requestOriginTermId: "term_stale_origin",
    });
    reopened = await freshRequest(student, "pending-re-request", chain.b);
    eq(reopened.response.status, "requested");
    eq(reopened.row.requestOriginTermId, chain.bid);
    for (const field of ["matchedTermId", "resolvedTermId"])
      await replaceForCheck(
        requestPath(reopened.requestId),
        { [field]: "term_other_pending" },
        async () => {
          await rejectUnchanged(
            student,
            "requestHistoryDictionaryTerm",
            { ...scope, word: reopened.word, warningAccepted: true },
            "HISTORY_DICTIONARY_REQUEST_MISMATCH",
            `pending re-request refuses conflicting ${field}`,
          );
        },
      );
    scenarios.push({
      label:
        "pending re-request resets word origin from the actual current request",
      passed: true,
    });

    // Global save uses the real resolver and must write the resolved origin.
    const resolution = await publish(teacher, reopened.word);
    eq(resolution.resolvedCount, 1);
    reopened = await state(student.uid, reopened.termId);
    eq(reopened.row.status, "saved");
    eq(reopened.row.requestOriginTermId, reopened.termId);
    eq(reopened.requestId, chain.requestId);
    eq((await read(requestPath(reopened.requestId))).status, "resolved");
    scenarios.push({
      label:
        "global term save resolver sets the linked resolved request origin",
      passed: true,
    });

    // Official save clears both fields even on a word that had a resolved link.
    const requestBeforeOfficialSave = await read(
      requestPath(reopened.requestId),
    );
    const official = await call(
      student,
      { termId: reopened.termId, requestOriginTermId: "caller_forged_origin" },
      "saveStudentHistoryDictionaryWord",
    );
    eq(official.saved, true);
    const officialRow = await read(reopened.path);
    eq(officialRow.requestId, "");
    eq(officialRow.requestOriginTermId, "");
    eq(await read(requestPath(reopened.requestId)), requestBeforeOfficialSave);
    scenarios.push({
      label:
        "official save clears server requestId and request origin together",
      passed: true,
    });
    const beforeResolvedReplay = await businessSnapshot();
    const resolvedReplay = await call(
      student,
      {
        ...scope,
        word: reopened.word,
        warningAccepted: true,
        requestOriginTermId: "caller_forged_origin",
      },
      "requestHistoryDictionaryTerm",
    );
    eq(resolvedReplay.alreadyResolved, true);
    eq(
      await businessSnapshot(),
      beforeResolvedReplay,
      "Resolved request replay must not recreate origin on an explicitly cleared direct word",
    );
    scenarios.push({
      label:
        "resolved request replay stays a write-free no-op after origin clear",
      passed: true,
    });

    // Other student requests the published term, exercising needs_approval and
    // explicit approval. Existing origin must be checked before any mutation.
    let approvedItem = await freshRequest(
      other,
      "published-approval",
      reopened.word,
    );
    eq(approvedItem.response.status, "needs_approval");
    await replaceForCheck(
      approvedItem.path,
      { requestOriginTermId: "term_wrong_approval" },
      async () => {
        await rejectUnchanged(
          teacher,
          "approveHistoryDictionaryTermForRequests",
          {
            ...scope,
            termId: approvedItem.termId,
            requestId: approvedItem.requestId,
          },
          "HISTORY_DICTIONARY_REQUEST_MISMATCH",
          "explicit approval refuses forged origin without writes",
        );
      },
    );
    const approval = await approve(teacher, approvedItem);
    eq(approval.resolvedCount, 1);
    approvedItem = await state(other.uid, approvedItem.termId);
    eq(approvedItem.row.requestOriginTermId, approvedItem.termId);
    eq(approvedItem.row.status, "saved");
    scenarios.push({
      label:
        "explicit approval sets the resolved term as server request origin",
      passed: true,
    });
    const beforeApprovalReplay = await businessSnapshot();
    eq((await approve(teacher, approvedItem)).resolvedCount, 0);
    eq(await businessSnapshot(), beforeApprovalReplay);
    scenarios.push({
      label: "already-resolved approval preserves origin and makes no writes",
      passed: true,
    });

    // Direct entry must clear the resolved request origin as well. This short
    // valid definition is below reward quality threshold, avoiding extra reward.
    const beforeDirectRequest = await read(requestPath(approvedItem.requestId));
    const directEntry = await call(
      other,
      {
        ...scope,
        word: approvedItem.word,
        definition: "짧은 정의",
        requestOriginTermId: "caller_forged_origin",
      },
      "saveStudentHistoryDictionaryEntry",
    );
    eq(directEntry.saved, true);
    eq(directEntry.reward.awarded, false);
    const directRow = await read(approvedItem.path);
    eq(directRow.requestId, "");
    eq(directRow.requestOriginTermId, "");
    eq(await read(requestPath(approvedItem.requestId)), beforeDirectRequest);
    scenarios.push({
      label:
        "actual direct entry clears old request origin without rewriting the resolved request",
      passed: true,
    });
    // A stale valid origin on a direct row has no authority and is cleared by
    // teacher update; raw caller input cannot replace it with another origin.
    await set(approvedItem.path, {
      ...directRow,
      requestOriginTermId: "term_stale_direct",
    });
    let directState = await state(other.uid, approvedItem.termId);
    directState = await originEdit(
      teacher,
      directState,
      `P15-직접재변경-${++serial}`,
      "",
      directRow.rewardTermId,
      "direct no-request rename ignores and clears stale stored origin",
    );

    // A published unknown-state request is reopened to needs_approval. Both
    // resolution references and origin are recomputed, rejection audit retained.
    const publishedWord = `P15-공개재요청-${++serial}`;
    await publish(teacher, publishedWord);
    let unknown = await freshRequest(student, "unknown-state", publishedWord);
    const unknownBefore = await read(requestPath(unknown.requestId));
    await set(requestPath(unknown.requestId), {
      ...unknownBefore,
      status: "legacy_unknown",
      matchedTermId: "term_stale_match",
      resolvedTermId: "term_stale_resolution",
      resolvedBy: "old",
      resolvedAt: oldTime,
      rejectedBy: "prior-teacher",
      rejectedAt: oldTime,
      rejectionReason: "historical reason",
    });
    unknown = await freshRequest(
      student,
      "unknown-state-reopened",
      publishedWord,
    );
    const unknownAfter = await read(requestPath(unknown.requestId));
    eq(unknown.response.status, "needs_approval");
    eq(unknownAfter.matchedTermId, unknown.termId);
    eq(unknownAfter.resolvedTermId, "");
    eq(unknownAfter.resolvedBy, "");
    eq(unknownAfter.resolvedAt, null);
    eq(unknownAfter.rejectedBy, "prior-teacher");
    eq(unknownAfter.rejectedAt, oldTime);
    eq(unknownAfter.rejectionReason, "historical reason");
    scenarios.push({
      label:
        "unknown closed request reopens to published needs_approval with clean resolution and retained rejection history",
      passed: true,
    });

    // A real dual-origin writer output without the new field is a legacy row.
    // Its current B/request B connection proves request origin independently A.
    const legacyChain = await startDualOriginChain(teacher, student);
    let legacy = await state(student.uid, legacyChain.bid);
    const withoutOrigin = { ...legacy.row };
    delete withoutOrigin.requestOriginTermId;
    await set(legacy.path, withoutOrigin);
    legacy = await state(student.uid, legacy.termId);
    legacy = await originEdit(
      teacher,
      legacy,
      legacyChain.c,
      legacyChain.bid,
      legacyChain.aid,
      "legacy dual-origin current B proves request B without borrowing reward A",
    );
    const previousLegacyRequest = await read(requestPath(legacy.requestId));
    const previousLegacyRequestId = legacy.requestId;
    legacy = await freshRequest(student, "request-renamed-C", legacy.word);
    const cRequestOrigin = legacy.termId;
    eq(legacy.row.requestOriginTermId, cRequestOrigin);
    eq(legacy.row.rewardTermId, legacyChain.aid);
    eq(await read(requestPath(previousLegacyRequestId)), previousLegacyRequest);
    scenarios.push({
      label:
        "actual request after renamed C replaces B request origin with C and retains A reward",
      passed: true,
    });
    legacy = await originEdit(
      teacher,
      legacy,
      `P15-다시변경-D-${++serial}`,
      cRequestOrigin,
      legacyChain.aid,
      "teacher rename after actual C re-request keeps new C request origin independent from A reward",
    );
    await deleteAndReplay(
      teacher,
      legacy,
      "legacy dual-origin migrated row deletes and reclaims A once",
      7,
    );

    // Legacy reviewed rename where reward/request share the same original ID
    // retains the bounded old bridge after the new field is removed.
    let legacyReviewed = await freshRequest(other, "legacy-reviewed");
    const originalLegacyId = legacyReviewed.termId;
    legacyReviewed = await originEdit(
      teacher,
      legacyReviewed,
      `P15-레거시이동-${++serial}`,
      originalLegacyId,
      originalLegacyId,
      "new reviewed rename establishes an origin before legacy compatibility check",
    );
    const oldReviewedRow = { ...legacyReviewed.row };
    delete oldReviewedRow.requestOriginTermId;
    await set(legacyReviewed.path, oldReviewedRow);
    legacyReviewed = await state(other.uid, legacyReviewed.termId);
    legacyReviewed = await originEdit(
      teacher,
      legacyReviewed,
      `P15-레거시재이동-${++serial}`,
      originalLegacyId,
      originalLegacyId,
      "reviewed legacy reward bridge is accepted and migrated to explicit request origin",
    );
    await deleteAndReplay(
      teacher,
      legacyReviewed,
      "reviewed legacy migration deletes without inventing a missing reward",
    );

    // Existing fallback request: reject before first global term transaction.
    const badFallback = await freshRequest(student, "existing-fallback");
    await replaceForCheck(
      badFallback.path,
      { requestOriginTermId: "term_wrong_fallback" },
      async () => {
        await rejectUnchanged(
          teacher,
          "saveHistoryDictionaryTerm",
          {
            ...scope,
            word: badFallback.word,
            definition,
            fallbackRequestId: badFallback.requestId,
            fallbackUid: badFallback.uid,
          },
          "HISTORY_DICTIONARY_REQUEST_MISMATCH",
          "existing fallback forged origin aborts before global term write",
        );
        eq(await read(`history_dictionary_terms/${badFallback.termId}`), null);
      },
    );
    // Missing request fallback uses canonical current-word proof plus matching
    // origin. Simulate only the lost request; the word came from the real writer.
    const missingFallback = await freshRequest(student, "missing-fallback");
    await db.doc(requestPath(missingFallback.requestId)).delete();
    await replaceForCheck(
      missingFallback.path,
      { requestOriginTermId: "term_wrong_missing" },
      async () => {
        await rejectUnchanged(
          teacher,
          "saveHistoryDictionaryTerm",
          {
            ...scope,
            word: missingFallback.word,
            definition,
            fallbackRequestId: missingFallback.requestId,
            fallbackUid: missingFallback.uid,
          },
          "HISTORY_DICTIONARY_FALLBACK_UNVERIFIED",
          "missing fallback mismatched origin aborts before global term write",
        );
        eq(
          await read(`history_dictionary_terms/${missingFallback.termId}`),
          null,
        );
      },
    );
    const recovered = await publish(teacher, missingFallback.word, {
      fallbackRequestId: missingFallback.requestId,
      fallbackUid: missingFallback.uid,
    });
    eq(recovered.resolvedCount, 1);
    eq((await read(requestPath(missingFallback.requestId))).status, "resolved");
    eq(
      (await read(missingFallback.path)).requestOriginTermId,
      missingFallback.termId,
    );
    scenarios.push({
      label:
        "canonical missing-request fallback with matching origin recovers and resolves",
      passed: true,
    });

    const missingDelete = await freshRequest(student, "missing-delete");
    await db.doc(requestPath(missingDelete.requestId)).delete();
    await replaceForCheck(
      missingDelete.path,
      { requestOriginTermId: "term_wrong_missing" },
      async () => {
        await rejectUnchanged(
          teacher,
          deleteCallableName,
          deleteData(missingDelete),
          "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
          "missing request delete cannot borrow a different request origin",
        );
      },
    );
    const missingDeleteResult = await call(
      teacher,
      deleteData(missingDelete),
      deleteCallableName,
    );
    eq(missingDeleteResult.deleted, true);
    eq(missingDeleteResult.reward?.reclaimed, false);
    eq((await read(requestPath(missingDelete.requestId))).status, "rejected");
    eq(await read(missingDelete.path), null);
    const beforeMissingDeleteReplay = await businessSnapshot();
    eq(
      (await call(teacher, deleteData(missingDelete), deleteCallableName))
        .deleted,
      false,
    );
    eq(await businessSnapshot(), beforeMissingDeleteReplay);
    scenarios.push({
      label:
        "matching canonical origin authorizes missing-request deletion recovery and write-free repeat",
      passed: true,
    });

    const denied = await freshRequest(student, "role-boundary");
    for (const actor of [student, staff]) {
      await rejectUnchanged(
        actor,
        callableName,
        updatePayload(denied.uid, denied.termId, denied.word),
        null,
        `${actor.role} cannot use request origin to gain teacher update permission`,
        "functions/permission-denied",
      );
      await rejectUnchanged(
        actor,
        deleteCallableName,
        deleteData(denied),
        null,
        `${actor.role} cannot use request origin to gain teacher delete permission`,
        "functions/permission-denied",
      );
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
    suite: "history-dictionary-request-origin-integration",
    mode: expectVulnerability
      ? "pre-patch-request-origin-gap-reproduction"
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
      "Reward original-semester migration, Gateway/CAS and browser interaction",
      "Browser, Google login, production and staging",
    ],
  }),
);
