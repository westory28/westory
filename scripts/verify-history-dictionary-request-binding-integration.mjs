// Actual callable + Firestore transactions in one explicitly fenced demo project.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
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

const projectId = "demo-westory-session-dictionary-binding";
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
  if (
    ![
      "http://127.0.0.1:9099",
      "http://127.0.0.1:5001",
      "http://127.0.0.1:18080",
    ].includes(url.origin)
  ) {
    blockedNetworkAttempts++;
    throw Error("Non-demo network request blocked");
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
  `binding-${randomUUID()}`,
);
const db = getFirestore(adminApp);
const sha1 = (value) => createHash("sha1").update(value).digest("hex");
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const scope = { year: "2026", semester: "2" };
const oldTime = Timestamp.fromMillis(1000);
const plannedRef = (path) => {
  plans.add(path);
  return db.doc(path);
};
const set = (path, data) => plannedRef(path).set(data);
const read = async (path) => {
  const snap = await db.doc(path).get();
  return snap.exists ? snap.data() : null;
};
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const call = async (client, name, data) =>
  (
    await httpsCallable(client.functions, name, { timeout: 60000 })({
      ...data,
      _session: client.proof,
    })
  ).data;
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
    `${role}-${randomUUID()}@yongshin-ms.ms.kr`,
    "Synthetic-Only-Aa1!",
  );
  value.user = signedIn.user;
  value.uid = signedIn.user.uid;
  await set(`users/${value.uid}`, {
    uid: value.uid,
    email: value.user.email,
    role,
    name: "합성 검증",
    teacherPortalEnabled: role === "teacher",
  });
  const session = await call(value, "openApplicationSession", {
    authorityGeneration: "w1r2-2026-08-09",
    protocolVersion: 2,
  });
  value.proof = {
    authorityGeneration: session.authorityGeneration,
    protocolVersion: session.protocolVersion,
    revision: session.revision,
  };
  return value;
};
const fixture = async (student, requestOverrides = {}, label = "요청") => {
  const word = `P11-${++serial}-${label}`,
    normalizedWord = normalize(word);
  const termId = `term_${sha1(normalizedWord)}`;
  const requestId = `req_${sha1(`${scope.year}:${scope.semester}:${student.uid}:${normalizedWord}`)}`;
  const termPath = `history_dictionary_terms/${termId}`,
    requestPath = `history_dictionary_requests/${requestId}`;
  const wordPath = `users/${student.uid}/history_dictionary_words/${termId}`;
  const term = {
    word,
    normalizedWord,
    definition: "원래 공개된 역사 풀이입니다.",
    studentLevel: "중학생 수준",
    relatedUnitId: "",
    tags: [],
    status: "published",
    createdBy: "seed",
    updatedBy: "seed",
    createdAt: oldTime,
    updatedAt: oldTime,
  };
  const request = {
    ...scope,
    uid: student.uid,
    word,
    normalizedWord,
    status: "requested",
    studentName: "이름 보존",
    grade: "2",
    class: "3",
    number: "7",
    memo: "메모 보존",
    createdAt: oldTime,
    updatedAt: oldTime,
    ...requestOverrides,
  };
  const studentWord = {
    ...scope,
    uid: student.uid,
    termId,
    word,
    normalizedWord,
    status: "requested",
    requestId,
    definition: "",
    createdAt: oldTime,
  };
  await set(termPath, term);
  await set(requestPath, request);
  await set(wordPath, studentWord);
  return {
    word,
    normalizedWord,
    termId,
    requestId,
    termPath,
    requestPath,
    wordPath,
    term,
    request,
    studentWord,
  };
};
const savePayload = (f, uid, extra = {}) => ({
  ...scope,
  word: f.word,
  definition: "새로 작성한 역사 풀이입니다.",
  studentLevel: "중학생 수준",
  relatedUnitId: "",
  tags: [],
  fallbackRequestId: f.requestId,
  fallbackUid: uid,
  ...extra,
});
const approvePayload = (f, extra = {}) => ({
  ...scope,
  termId: f.termId,
  requestId: f.requestId,
  ...extra,
});
const snapshot = async () => {
  const values = {};
  for (const path of [...plans].sort()) values[path] = await read(path);
  for (const user of clients.filter((item) => item.uid)) {
    const inbox = `years/${scope.year}/semesters/${scope.semester}/notification_inboxes/${user.uid}`;
    values[inbox] = await read(inbox);
    const notifications = await db.collection(`${inbox}/items`).get();
    values[`${inbox}/items`] = notifications.docs
      .map((doc) => [doc.id, doc.data()])
      .sort(([a], [b]) => a.localeCompare(b));
  }
  return values;
};
const rejectUnchanged = async (operation, label, reasonRequired = true) => {
  const before = await snapshot();
  await assert.rejects(operation, (error) => {
    assert.ok(
      [
        "functions/failed-precondition",
        "functions/invalid-argument",
        "functions/not-found",
        "functions/permission-denied",
      ].includes(error.code),
      `${label}: ${error.code}`,
    );
    if (reasonRequired)
      assert.match(
        error.details?.reason || "",
        /^HISTORY_DICTIONARY_(REQUEST|FALLBACK)_/,
      );
    else assert.equal(error.code, "functions/permission-denied");
    return true;
  });
  checks++;
  eq(await snapshot(), before);
  scenarios.push(label);
};
let failure,
  deletedUsers = 0,
  cleared = false;
try {
  const teacher = await client("teacher"),
    student = await client("student"),
    other = await client("student"),
    staff = await client("staff");
  const mismatch = await fixture(student, {
    normalizedWord: "다른 단어",
    word: "다른 단어",
  });
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "approveHistoryDictionaryTermForRequests",
        approvePayload(mismatch),
      ),
    "explicit different word rejected without any write",
  );
  const otherScope = await fixture(student, { semester: "1" });
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "approveHistoryDictionaryTermForRequests",
        approvePayload(otherScope),
      ),
    "explicit different semester rejected without any write",
  );
  const slash = await fixture(student);
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "approveHistoryDictionaryTermForRequests",
        approvePayload(slash, { requestId: "nested/request/path" }),
      ),
    "request path segments rejected",
  );
  const missing = await fixture(student);
  await db.doc(missing.requestPath).delete();
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "approveHistoryDictionaryTermForRequests",
        approvePayload(missing),
      ),
    "explicit missing request rejected",
  );
  for (const [label, overrides] of [
    ["word", { normalizedWord: "다른 단어" }],
    ["uid", { uid: other.uid }],
    ["semester", { semester: "1" }],
    ["closed", { status: "rejected" }],
  ]) {
    const f = await fixture(student, overrides);
    await rejectUnchanged(
      () =>
        call(teacher, "saveHistoryDictionaryTerm", savePayload(f, student.uid)),
      `fallback existing ${label} mismatch rejected before global term write`,
    );
  }
  const incomplete = await fixture(student);
  await rejectUnchanged(
    () =>
      call(teacher, "saveHistoryDictionaryTerm", savePayload(incomplete, "")),
    "fallback pair is required before global term write",
  );
  for (const [label, override] of [
    ["uid", { uid: other.uid }],
    ["term", { termId: "another-term" }],
    ["normalizedWord", { normalizedWord: "다른 단어" }],
    ["year", { year: "2027" }],
    ["semester", { semester: "1" }],
    ["request", { requestId: "newer-request-id" }],
  ]) {
    const f = await fixture(student);
    await db.doc(f.wordPath).update(override);
    for (const name of [
      "saveHistoryDictionaryTerm",
      "approveHistoryDictionaryTermForRequests",
    ])
      await rejectUnchanged(
        () =>
          call(
            teacher,
            name,
            name.startsWith("save")
              ? savePayload(f, student.uid)
              : approvePayload(f),
          ),
        `existing student word ${label} mismatch blocks ${name}`,
      );
  }
  for (const [label, override] of [
    ["absent", null],
    ["saved", { status: "saved" }],
    ["word", { normalizedWord: "다른 단어" }],
    ["word text", { word: "다른 표시 단어" }],
    ["scope", { semester: "1" }],
    ["request", { requestId: "different-id" }],
    ["uid", { uid: other.uid }],
  ]) {
    const f = await fixture(student);
    await db.doc(f.requestPath).delete();
    if (!override) await db.doc(f.wordPath).delete();
    else await db.doc(f.wordPath).update(override);
    await rejectUnchanged(
      () =>
        call(teacher, "saveHistoryDictionaryTerm", savePayload(f, student.uid)),
      `missing fallback ${label} proof rejected`,
    );
  }
  const forged = await fixture(student);
  await db.doc(forged.requestPath).delete();
  const inventedRequestId = "invented-request-id";
  plans.add(`history_dictionary_requests/${inventedRequestId}`);
  await db.doc(forged.wordPath).update({ requestId: inventedRequestId });
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "saveHistoryDictionaryTerm",
        savePayload(forged, student.uid, {
          fallbackRequestId: inventedRequestId,
        }),
      ),
    "missing fallback canonical request ID required",
  );
  const wrongRole = await fixture(staff);
  await db.doc(wrongRole.requestPath).delete();
  await rejectUnchanged(
    () =>
      call(
        teacher,
        "saveHistoryDictionaryTerm",
        savePayload(wrongRole, staff.uid),
      ),
    "missing fallback student profile required",
  );

  const valid = await fixture(student, { status: "needs_approval" });
  const resolved = await call(
    teacher,
    "approveHistoryDictionaryTermForRequests",
    approvePayload(valid),
  );
  eq(resolved.resolvedCount, 1);
  const savedRequest = await read(valid.requestPath);
  for (const field of [
    "uid",
    "word",
    "normalizedWord",
    "studentName",
    "grade",
    "class",
    "number",
    "memo",
    "createdAt",
  ])
    eq(savedRequest[field], valid.request[field]);
  eq(savedRequest.status, "resolved");
  eq((await read(valid.wordPath)).definition, valid.term.definition);
  const beforeReplay = await snapshot();
  eq(
    (
      await call(
        teacher,
        "approveHistoryDictionaryTermForRequests",
        approvePayload(valid),
      )
    ).resolvedCount,
    0,
  );
  eq(await snapshot(), beforeReplay);
  scenarios.push(
    "valid explicit request preserves metadata; replay has no writes",
  );

  const existing = await fixture(student);
  eq(
    (
      await call(
        teacher,
        "saveHistoryDictionaryTerm",
        savePayload(existing, student.uid),
      )
    ).resolvedCount,
    1,
  );
  const preserved = await read(existing.requestPath);
  for (const field of [
    "studentName",
    "grade",
    "class",
    "number",
    "memo",
    "createdAt",
  ])
    eq(preserved[field], existing.request[field]);
  eq(preserved.status, "resolved");
  scenarios.push("valid existing fallback preserves original request fields");
  const beforeFallbackReplay = await snapshot();
  eq(
    (
      await call(
        teacher,
        "saveHistoryDictionaryTerm",
        savePayload(existing, student.uid),
      )
    ).resolvedCount,
    0,
  );
  eq(await snapshot(), beforeFallbackReplay);
  scenarios.push(
    "resolved fallback replay does not rewrite term, request, student word or notifications",
  );

  const recovery = await fixture(student);
  await db.doc(recovery.requestPath).delete();
  eq(
    (
      await call(
        teacher,
        "saveHistoryDictionaryTerm",
        savePayload(recovery, student.uid),
      )
    ).resolvedCount,
    1,
  );
  const recovered = await read(recovery.requestPath);
  eq(recovered.uid, student.uid);
  eq(recovered.normalizedWord, recovery.normalizedWord);
  eq(recovered.year, scope.year);
  eq(recovered.semester, scope.semester);
  eq(recovered.status, "resolved");
  eq((await read(recovery.wordPath)).status, "saved");
  scenarios.push(
    "missing request restored only from current bound requested student word",
  );

  const race = await fixture(other);
  const results = await Promise.all([
    call(
      teacher,
      "approveHistoryDictionaryTermForRequests",
      approvePayload(race),
    ),
    call(
      teacher,
      "approveHistoryDictionaryTermForRequests",
      approvePayload(race),
    ),
  ]);
  eq(results.map((result) => result.resolvedCount).sort(), [0, 1]);
  eq((await read(race.requestPath)).status, "resolved");
  scenarios.push("concurrent approval resolves once");
  const denied = await fixture(student);
  for (const actor of [student, staff])
    for (const name of [
      "saveHistoryDictionaryTerm",
      "approveHistoryDictionaryTermForRequests",
    ])
      await rejectUnchanged(
        () =>
          call(
            actor,
            name,
            name.startsWith("save")
              ? savePayload(denied, student.uid)
              : approvePayload(denied),
          ),
        `${actor.role} cannot ${name}`,
        false,
      );
  eq(blockedNetworkAttempts, 0);
} catch (error) {
  failure = error;
} finally {
  const cleanupErrors = [];
  for (const value of clients) {
    if (value.user)
      try {
        await deleteUser(value.user);
        deletedUsers++;
      } catch (error) {
        cleanupErrors.push(error);
      }
    try {
      await deleteApp(value.app);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:18080/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: "DELETE" },
    );
    assert.equal(response.status, 200);
    cleared = true;
    eq((await db.collection("history_dictionary_terms").get()).empty, true);
    eq((await db.collection("history_dictionary_requests").get()).empty, true);
  } catch (error) {
    cleanupErrors.push(error);
  }
  await adminApps.deleteApp(adminApp);
  globalThis.fetch = nativeFetch;
  if (failure || cleanupErrors.length)
    throw new AggregateError(
      [failure, ...cleanupErrors].filter(Boolean),
      "Dictionary binding integration or cleanup failed",
    );
}
eq(deletedUsers, 4);
eq(cleared, true);
console.log(
  JSON.stringify({
    suite: "history-dictionary-request-binding-integration",
    passed: true,
    checks,
    scenarios,
    projectId,
    blockedNetworkAttempts,
    externalAccess: 0,
    productionAccess: 0,
    stagingAccess: 0,
    cleanup: { deletedUsers, cleared },
    appCheck: "DISABLED_BY_DEMO_CONTRACT",
    exclusions: [
      "Gateway/CAS migration",
      "single-save global term plus fanout atomicity",
      "browser and Google login",
    ],
  }),
);
