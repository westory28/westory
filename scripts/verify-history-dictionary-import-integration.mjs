import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
} from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  terminate,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";

const projectId = "demo-westory-session-dictionary-import";
const commandType = "saveHistoryDictionaryTermsBulk";
const firestoreHost = "127.0.0.1";
const firestorePort = 18080;
const authPort = 9099;
const functionsPort = 5001;
const region = "asia-northeast3";
const businessCollections = [
  "history_dictionary_terms",
  "command_receipts",
  "command_audit_events",
];
const reasons = {
  invalid: "HISTORY_DICTIONARY_IMPORT_INVALID",
  teacherRequired: "HISTORY_DICTIONARY_IMPORT_TEACHER_REQUIRED",
  conflict: "HISTORY_DICTIONARY_BULK_CONFLICT",
  retired: "LEGACY_DICTIONARY_IMPORT_RETIRED",
};

// These checks precede Rules upload, Auth account creation, and every SDK client.
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18080");
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, "127.0.0.1:9099");
for (const variable of ["GOOGLE_CLOUD_PROJECT", "WESTORY_TEST_PROJECT_ID"]) {
  if (process.env[variable]) assert.equal(process.env[variable], projectId);
}
if (process.env.FIREBASE_CONFIG) {
  assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId, projectId);
}
if (process.env.FUNCTIONS_EMULATOR_HOST) {
  assert.equal(process.env.FUNCTIONS_EMULATOR_HOST, "127.0.0.1:5001");
}
if (process.env.FIREBASE_EMULATOR_HUB) {
  assert.equal(process.env.FIREBASE_EMULATOR_HUB, "127.0.0.1:14400");
}

const allowedOrigins = new Set(
  [firestorePort, authPort, functionsPort].map(
    (port) => `http://127.0.0.1:${port}`,
  ),
);
const originalFetch = globalThis.fetch;
let blockedNetworkAttempts = 0;
let loopbackFetches = 0;
let hubDiscoveryFetches = 0;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const method = String(init?.method || input?.method || "GET").toUpperCase();
  // rules-unit-testing discoverEmulators() fetches precisely /emulators when
  // FIREBASE_EMULATOR_HUB is present; .lesson-test-emulators.json pins 14400.
  const isHubDiscovery =
    process.env.FIREBASE_EMULATOR_HUB === "127.0.0.1:14400" &&
    url.href === "http://127.0.0.1:14400/emulators" &&
    method === "GET" &&
    init?.body == null &&
    (!(input instanceof Request) || input.body === null);
  if (!allowedOrigins.has(url.origin) && !isHubDiscovery) {
    blockedNetworkAttempts++;
    throw new Error("Dictionary integration blocked a non-emulator request.");
  }
  if (isHubDiscovery) hubDiscoveryFetches++;
  loopbackFetches++;
  return originalFetch(input, { ...init, redirect: "error" });
};

const apps = [];
const clients = [];
const createdUsers = [];
const cleanupErrors = [];
const scenarios = [];
let testEnv;
let failure;
let checks = 0;
let deletedAuthUsers = 0;
let firestoreCleared = false;
let rulesReset = false;
let vmNetworkAttempts = 0;
let actualClientSourceHashes = {};
const runId = randomBytes(5).toString("hex");

const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  checks++;
};
const deepEqual = (actual, expected, message) => {
  assert.deepEqual(actual, expected, message);
  checks++;
};
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const adminDb = async (operation) => {
  let result;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    result = await operation(context.firestore());
  });
  return result;
};
const readDocument = (path) =>
  adminDb(async (db) => {
    const snapshot = await getDoc(doc(db, path));
    return snapshot.exists() ? snapshot.data() : null;
  });
const snapshotBusiness = () =>
  adminDb(async (db) => {
    const snapshot = {};
    for (const name of businessCollections) {
      const rows = await getDocs(collection(db, name));
      snapshot[name] = Object.fromEntries(
        rows.docs.map((row) => [row.id, row.data()]),
      );
    }
    return snapshot;
  });
const term = (label, overrides = {}) => ({
  word: `QA-${runId}-${label}`,
  definition: `합성 역사 용어 ${label}의 설명입니다.`,
  studentLevel: "중학생 수준",
  relatedUnitId: "synthetic-unit",
  tags: ["합성", "역사"],
  ...overrides,
});
const payloadFor = (terms, overrides = {}) => ({
  year: "2026",
  semester: "2",
  terms,
  ...overrides,
});
const normalizedWord = (word) => word.trim().replace(/\s+/g, " ").toLowerCase();
const termId = (word) =>
  `term_${createHash("sha1").update(normalizedWord(word)).digest("hex")}`;
const termPath = (word) => `history_dictionary_terms/${termId(word)}`;
const sessionPath = (owner) =>
  `application_sessions/${owner.uid}/sessions/${owner.session.authTime}`;
const callable = (owner, name, data) =>
  httpsCallable(owner.functions, name, { timeout: 60_000 })(data).then(
    (response) => response.data,
  );
const execute = (owner, payload, id = randomUUID(), overrides = {}) =>
  callable(owner, "executeCommand", {
    commandId: id,
    commandType,
    payload,
    _session: owner.proof,
    ...overrides,
  });
const status = (owner, commandId) =>
  callable(owner, "getCommandStatus", {
    commandId,
    commandType,
    _session: owner.proof,
  });
const expectReason = async (operation, reason, code) => {
  await assert.rejects(operation, (error) => {
    assert.equal(error.details?.reason, reason);
    if (code) assert.equal(error.code, `functions/${code}`);
    return true;
  });
  checks++;
};
const rejectWithoutWrites = async (
  owner,
  payload,
  reason,
  { id = randomUUID(), overrides = {}, code = "invalid-argument" } = {},
) => {
  const before = await snapshotBusiness();
  await expectReason(execute(owner, payload, id, overrides), reason, code);
  deepEqual(
    await snapshotBusiness(),
    before,
    `${reason} must retain all terms and leave no receipt or audit writes.`,
  );
};
const assertPersisted = async (owner, terms, response) => {
  equal(response.status, "SUCCEEDED");
  equal(response.result.savedCount, terms.length);
  deepEqual(
    [...response.result.termIds].sort(),
    terms.map((item) => termId(item.word)).sort(),
    "The result must identify every global SHA-1 term document.",
  );
  const storedTerms = await adminDb(async (db) => {
    const rows = await getDocs(collection(db, "history_dictionary_terms"));
    return new Map(rows.docs.map((row) => [row.id, row.data()]));
  });
  for (const item of terms) {
    const stored = storedTerms.get(termId(item.word));
    check(stored, `The complete import must include ${item.word}.`);
    equal(stored.normalizedWord, normalizedWord(item.word));
    equal(stored.definition, item.definition);
    equal(stored.status, "published");
    equal(stored.createdBy, owner.uid);
    equal(stored.updatedBy, owner.uid);
    for (const field of ["createdAt", "updatedAt", "publishedAt"]) {
      check(stored[field] instanceof Timestamp && stored[field].toMillis() > 0);
    }
  }
};
const assertReceipt = async (owner, commandId, expectedTermIds) => {
  const snapshot = await snapshotBusiness();
  const select = (name) =>
    Object.entries(snapshot[name]).filter(
      ([, row]) => row.commandId === commandId && row.actorUid === owner.uid,
    );
  const receipts = select("command_receipts");
  const audits = select("command_audit_events");
  equal(receipts.length, 1);
  equal(audits.length, 1);
  const [receiptId, receipt] = receipts[0];
  equal(receipt.commandType, commandType);
  equal(receipt.status, "SUCCEEDED");
  equal(receipt.checkpoint, "COMMITTED");
  equal(receipt.result.savedCount, expectedTermIds.length);
  deepEqual([...receipt.result.termIds].sort(), [...expectedTermIds].sort());
  equal(audits[0][0], receiptId);
  equal(audits[0][1].receiptRef, `command_receipts/${receiptId}`);
  equal(audits[0][1].payloadHash, receipt.payloadHash);
};
const client = async (label, role, email) => {
  const app = initializeApp(
    {
      projectId,
      apiKey: "demo-dictionary-import-key",
      authDomain: `${projectId}.firebaseapp.com`,
    },
    `${label}-${runId}`,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, {
    disableWarnings: true,
  });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreHost, firestorePort);
  const functions = getFunctions(app, region);
  connectFunctionsEmulator(functions, "127.0.0.1", functionsPort);
  const result = { app, auth, db, functions };
  clients.push(result);
  const userEmail = email || `${label}-${runId}@yongshin-ms.ms.kr`;
  const { user } = await createUserWithEmailAndPassword(
    auth,
    userEmail,
    `${randomBytes(24).toString("base64url")}Aa1!`,
  );
  createdUsers.push(user);
  result.uid = user.uid;
  await adminDb((store) =>
    setDoc(doc(store, "users", user.uid), {
      uid: user.uid,
      email: userEmail,
      role,
      name: "합성 사전 가져오기 검증",
      teacherPortalEnabled: role === "staff",
      staffPermissions: role === "staff" ? ["lesson_read", "lesson_write"] : [],
    }),
  );
  result.session = await callable(result, "openApplicationSession", {
    authorityGeneration: "w1r2-2026-08-09",
    protocolVersion: 2,
  });
  equal(result.session.status, "active");
  result.proof = {
    authorityGeneration: result.session.authorityGeneration,
    protocolVersion: result.session.protocolVersion,
    revision: result.session.revision,
  };
  return result;
};

// Run the actual helper, Gateway and session-risk coordinator. Only the callable
// factory is a bridge: it attaches the real demo session proof and rejects any
// unexpected owner before and after real emulator transport.
const actualClientBridge = (owner) => {
  const paths = [
    "src/lib/historyDictionary.ts",
    "src/lib/commandGateway.ts",
    "src/lib/stepUpReauth.ts",
    "src/lib/highRiskCommands.ts",
    "src/lib/semesterScope.ts",
  ];
  const code = {};
  for (const path of paths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    actualClientSourceHashes[path] = createHash("sha256")
      .update(source)
      .digest("hex");
    code[path] = transformSync(source, { loader: "ts", format: "cjs" }).code;
  }
  const denyVmNetwork = () => {
    vmNetworkAttempts++;
    throw new Error(
      "Actual helper VM must use only the callable emulator bridge.",
    );
  };
  const load = (path, dependencies = {}, globals = {}) => {
    const module = { exports: {} };
    runInNewContext(
      code[path],
      {
        module,
        exports: module.exports,
        crypto: webcrypto,
        TextEncoder,
        fetch: denyVmNetwork,
        XMLHttpRequest: denyVmNetwork,
        WebSocket: denyVmNetwork,
        require: (name) => {
          assert.ok(
            Object.hasOwn(dependencies, name),
            `Unexpected client dependency: ${name}`,
          );
          return dependencies[name];
        },
        ...globals,
      },
      { filename: path },
    );
    return module.exports;
  };
  const state = {
    storage: new Map(),
    requests: [],
    stepUps: [],
    dropNextExecuteResponse: true,
    statusUnavailable: true,
  };
  const stepUp = load("src/lib/stepUpReauth.ts");
  stepUp.registerStepUpReauthHandler(async (name) => {
    state.stepUps.push(name);
    throw new Error(
      "GENERAL dictionary import must not request step-up authentication.",
    );
  });
  const highRisk = load("src/lib/highRiskCommands.ts");
  const semester = load("src/lib/semesterScope.ts");
  const firebase = {
    auth: owner.auth,
    db: owner.db,
    getHttpsCallable: async (name, options) => {
      assert.ok(["executeCommand", "getCommandStatus"].includes(name));
      const assertOwner = () => {
        assert.equal(options?.expectedUid, owner.uid);
        assert.equal(owner.auth.currentUser?.uid, owner.uid);
      };
      assertOwner();
      return async (request) => {
        assertOwner();
        const wire = JSON.parse(JSON.stringify(request));
        const recorded = {
          name,
          request: wire,
          expectedUid: options.expectedUid,
        };
        state.requests.push(recorded);
        if (name === "getCommandStatus" && state.statusUnavailable) {
          throw Object.assign(
            new Error("Synthetic status transport unavailable."),
            {
              code: "functions/unavailable",
            },
          );
        }
        const drop = name === "executeCommand" && state.dropNextExecuteResponse;
        if (drop) state.dropNextExecuteResponse = false;
        const response = await httpsCallable(owner.functions, name, {
          timeout: 60_000,
        })({
          ...wire,
          _session: owner.proof,
          ...(drop ? { _testDropResponseAfterCommit: true } : {}),
        });
        assertOwner();
        recorded.response = response.data;
        return response;
      };
    },
  };
  const localStorage = {
    getItem: (key) => state.storage.get(key) ?? null,
    setItem: (key, value) => state.storage.set(key, value),
    removeItem: (key) => state.storage.delete(key),
  };
  state.reload = () => {
    const gateway = load(
      "src/lib/commandGateway.ts",
      {
        "./firebase": firebase,
        "./highRiskCommands": highRisk,
        "./stepUpReauth": stepUp,
      },
      { window: { localStorage } },
    );
    state.api = load("src/lib/historyDictionary.ts", {
      "./firebase": firebase,
      "./commandGateway": gateway,
      "./semesterScope": semester,
      "firebase/firestore": new Proxy(
        {},
        {
          get: (_target, name) => {
            throw new Error(
              `Import helper unexpectedly used Firestore directly: ${String(name)}`,
            );
          },
        },
      ),
    });
  };
  state.reload();
  return state;
};

try {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: firestoreHost,
      port: firestorePort,
      rules: readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
  await testEnv.clearFirestore();
  const teacher = await client("dictionary-teacher", "teacher");
  const student = await client("dictionary-student", "student");
  const staff = await client("dictionary-staff", "staff");
  const admin = await client(
    "dictionary-admin",
    "teacher",
    "westoria28@gmail.com",
  );

  await adminDb((db) =>
    updateDoc(doc(db, sessionPath(teacher)), {
      highRiskExpiresAt: Timestamp.fromMillis(0),
    }),
  );
  const firstTerms = [term("첫용어"), term("둘째용어")];
  const firstPayload = payloadFor(firstTerms);
  const firstCommandId = randomUUID();
  const first = await execute(teacher, firstPayload, firstCommandId);
  equal(first.replayed, false);
  await assertPersisted(teacher, firstTerms, first);
  await assertReceipt(teacher, firstCommandId, first.result.termIds);
  equal(
    (await readDocument(sessionPath(teacher))).highRiskExpiresAt.toMillis(),
    0,
  );
  scenarios.push("teacher-general-session-after-high-risk-expiry");

  const beforeReplay = await snapshotBusiness();
  const replay = await execute(teacher, firstPayload, firstCommandId);
  equal(replay.replayed, true);
  deepEqual(replay.result, first.result);
  deepEqual(await snapshotBusiness(), beforeReplay);
  const firstStatus = await status(teacher, firstCommandId);
  equal(firstStatus.status, "SUCCEEDED");
  deepEqual(firstStatus.result, first.result);
  equal((await status(admin, firstCommandId)).status, "NOT_FOUND");
  await rejectWithoutWrites(
    teacher,
    payloadFor([term("再利用ID")]),
    "COMMAND_ID_CONFLICT",
    { id: firstCommandId, code: "already-exists" },
  );
  scenarios.push(
    "receipt-replay-retains-data-and-rejects-payload-substitution",
  );

  // A new command and even a different semester cannot overwrite global terms.
  await rejectWithoutWrites(
    teacher,
    payloadFor([term("충돌시새용어"), ...firstTerms], {
      year: "2027",
      semester: "1",
    }),
    reasons.conflict,
    { code: "already-exists" },
  );
  scenarios.push("global-create-only-conflict-aborts-whole-import");

  const adminTerms = [term("관리자용어")];
  await assertPersisted(
    admin,
    adminTerms,
    await execute(admin, payloadFor(adminTerms)),
  );
  for (const owner of [student, staff]) {
    await rejectWithoutWrites(
      owner,
      payloadFor([term("권한거부")]),
      reasons.teacherRequired,
      {
        code: "permission-denied",
      },
    );
  }
  scenarios.push("admin-allowed-student-and-permissioned-staff-denied");

  const published = await assertSucceeds(
    getDoc(doc(student.db, termPath(firstTerms[0].word))),
  );
  equal(published.data().status, "published");
  equal(published.data().definition, firstTerms[0].definition);
  const beforeDirectWrites = await snapshotBusiness();
  for (const owner of [teacher, student]) {
    await assertFails(
      setDoc(doc(owner.db, termPath(term("直接作成").word)), {
        ...term("直接作成"),
        status: "published",
        createdBy: owner.uid,
      }),
    );
    checks++;
    await assertFails(
      updateDoc(doc(owner.db, termPath(firstTerms[0].word)), {
        definition: "直接書き換えは禁止です。",
      }),
    );
    checks++;
    await assertFails(deleteDoc(doc(owner.db, termPath(firstTerms[0].word))));
    checks++;
  }
  deepEqual(await snapshotBusiness(), beforeDirectWrites);
  scenarios.push(
    "student-published-read-and-both-roles-direct-sdk-write-denial",
  );

  const raceTerms = [
    [
      term("共通", { definition: "첫 번째 원자적 묶음의 공통 설명입니다." }),
      term("A1"),
      term("A2"),
    ],
    [
      term("共通", { definition: "두 번째 원자적 묶음의 공통 설명입니다." }),
      term("B1"),
      term("B2"),
    ],
  ];
  const raceOwners = [teacher, admin];
  const raceIds = [randomUUID(), randomUUID()];
  const beforeRace = await snapshotBusiness();
  const raced = await Promise.allSettled(
    raceOwners.map((owner, index) =>
      execute(owner, payloadFor(raceTerms[index]), raceIds[index]),
    ),
  );
  equal(raced.filter((result) => result.status === "fulfilled").length, 1);
  equal(raced.filter((result) => result.status === "rejected").length, 1);
  const winner = raced.findIndex((result) => result.status === "fulfilled");
  const loser = 1 - winner;
  equal(raced[loser].reason.code, "functions/already-exists");
  equal(raced[loser].reason.details?.reason, reasons.conflict);
  await assertPersisted(
    raceOwners[winner],
    raceTerms[winner],
    raced[winner].value,
  );
  for (const item of raceTerms[loser].slice(1))
    equal(await readDocument(termPath(item.word)), null);
  equal((await status(raceOwners[loser], raceIds[loser])).status, "NOT_FOUND");
  const afterRace = await snapshotBusiness();
  equal(
    Object.keys(afterRace.history_dictionary_terms).length -
      Object.keys(beforeRace.history_dictionary_terms).length,
    3,
  );
  equal(
    Object.keys(afterRace.command_receipts).length -
      Object.keys(beforeRace.command_receipts).length,
    1,
  );
  equal(
    Object.keys(afterRace.command_audit_events).length -
      Object.keys(beforeRace.command_audit_events).length,
    1,
  );
  await assertReceipt(
    raceOwners[winner],
    raceIds[winner],
    raced[winner].value.result.termIds,
  );
  scenarios.push(
    "real-server-concurrent-overlap-one-winner-no-loser-partial-write",
  );

  const invalidRows = [
    ["empty-list", payloadFor([])],
    [
      "201-rows",
      payloadFor(
        Array.from({ length: 201 }, (_, index) => term(`上限超過${index}`)),
      ),
    ],
    [
      "unknown-payload-key",
      payloadFor([term("不正上位")], { studentUid: student.uid }),
    ],
    [
      "unknown-row-key",
      payloadFor([term("不正項目", { createdBy: admin.uid })]),
    ],
    ["null-row-after-valid-row", payloadFor([term("null前"), null])],
    [
      "short-definition-after-valid-row",
      payloadFor([term("説明前"), term("短説明", { definition: "짧음" })]),
    ],
    ["word-type", payloadFor([term("数値", { word: 123 })])],
    ["word-length", payloadFor([term("長単語", { word: "가".repeat(41) })])],
    [
      "definition-length",
      payloadFor([term("長説明", { definition: "가".repeat(1201) })]),
    ],
    ["tags-type", payloadFor([term("태그형식", { tags: { tag: "합성" } })])],
    ["normalized-duplicate", payloadFor([term("DUP WORD"), term("dup  word")])],
    ["invalid-semester", payloadFor([term("不正学期")], { semester: "3" })],
  ];
  for (const [label, payload] of invalidRows) {
    await rejectWithoutWrites(teacher, payload, reasons.invalid);
    scenarios.push(`strict-payload-${label}`);
  }

  const sessionPayload = payloadFor([term("세션거부")]);
  await rejectWithoutWrites(teacher, sessionPayload, "SESSION_PROOF_INVALID", {
    overrides: { _session: null },
    code: "unauthenticated",
  });
  await rejectWithoutWrites(teacher, sessionPayload, "SESSION_PROOF_INVALID", {
    overrides: { _session: { ...teacher.proof, revision: "0".repeat(64) } },
    code: "unauthenticated",
  });
  scenarios.push("missing-and-wrong-session-proof-denied");

  for (const owner of [teacher, admin]) {
    const before = await snapshotBusiness();
    await expectReason(
      callable(owner, commandType, {
        ...payloadFor([term("退役経路")]),
        _session: owner.proof,
      }),
      reasons.retired,
      "failed-precondition",
    );
    deepEqual(await snapshotBusiness(), before);
  }
  scenarios.push("retired-direct-callable-cannot-bypass-gateway");

  const lossTerms = [term("応答喪失1"), term("応答喪失2")];
  const lossPayload = payloadFor(lossTerms);
  const lossId = randomUUID();
  await expectReason(
    execute(teacher, lossPayload, lossId, {
      _testDropResponseAfterCommit: true,
    }),
    "TEST_RESPONSE_LOSS",
    "unavailable",
  );
  const lostStatus = await status(teacher, lossId);
  await assertPersisted(teacher, lossTerms, lostStatus);
  await assertReceipt(teacher, lossId, lostStatus.result.termIds);
  const beforeLossReplay = await snapshotBusiness();
  const recovered = await execute(teacher, lossPayload, lossId);
  equal(recovered.replayed, true);
  deepEqual(recovered.result, lostStatus.result);
  deepEqual(await snapshotBusiness(), beforeLossReplay);
  scenarios.push("committed-response-loss-recovers-through-receipt-replay");

  const bridge = actualClientBridge(teacher);
  const clientTerms = [term("클라이언트재시도1"), term("클라이언트재시도2")];
  const clientConfig = { year: "2026", semester: "2" };
  await assert.rejects(
    bridge.api.saveHistoryDictionaryTermsBulk(
      clientConfig,
      { terms: clientTerms },
      teacher.uid,
    ),
    (error) => {
      equal(error.reason, "COMMAND_OUTCOME_UNCONFIRMED");
      equal(bridge.api.isHistoryDictionaryImportUncertain(error), true);
      equal(error.outcomeConfirmed, false);
      return true;
    },
  );
  checks++;
  equal(
    bridge.requests.filter((item) => item.name === "executeCommand").length,
    1,
  );
  equal(
    bridge.requests.filter((item) => item.name === "getCommandStatus").length,
    1,
  );
  const clientCommandId = bridge.requests[0].request.commandId;
  equal(bridge.storage.size, 1);
  const pendingHandle = JSON.parse([...bridge.storage.values()][0]);
  equal(pendingHandle.commandId, clientCommandId);
  equal(pendingHandle.ownerUid, teacher.uid);
  equal(pendingHandle.projectId, projectId);
  equal(Object.hasOwn(pendingHandle, "payload"), false);
  await assertReceipt(
    teacher,
    clientCommandId,
    clientTerms.map((item) => termId(item.word)),
  );
  const beforeClientReplay = await snapshotBusiness();
  bridge.statusUnavailable = false;
  bridge.reload();
  const beforePendingLookup = bridge.requests.length;
  equal(
    await bridge.api.hasPendingHistoryDictionaryImport(
      clientConfig,
      { terms: clientTerms },
      teacher.uid,
    ),
    true,
  );
  equal(
    await bridge.api.hasPendingHistoryDictionaryImport(
      { ...clientConfig, semester: "1" },
      { terms: clientTerms },
      teacher.uid,
    ),
    false,
  );
  equal(
    await bridge.api.hasPendingHistoryDictionaryImport(
      clientConfig,
      { terms: [term("다른파일")] },
      teacher.uid,
    ),
    false,
  );
  const otherOwnerBridge = actualClientBridge(student);
  for (const [key, value] of bridge.storage)
    otherOwnerBridge.storage.set(key, value);
  equal(
    await otherOwnerBridge.api.hasPendingHistoryDictionaryImport(
      clientConfig,
      { terms: clientTerms },
      student.uid,
    ),
    false,
  );
  equal(otherOwnerBridge.requests.length, 0);
  equal(bridge.requests.length, beforePendingLookup);
  const clientRecovered = await bridge.api.saveHistoryDictionaryTermsBulk(
    clientConfig,
    { terms: clientTerms },
    teacher.uid,
  );
  const actualExecutions = bridge.requests.filter(
    (item) => item.name === "executeCommand",
  );
  equal(actualExecutions.length, 2);
  equal(actualExecutions[1].request.commandId, clientCommandId);
  deepEqual(actualExecutions[1].request.payload, payloadFor(clientTerms));
  equal(actualExecutions[1].response.replayed, true);
  equal(clientRecovered.savedCount, 2);
  deepEqual(await snapshotBusiness(), beforeClientReplay);
  equal(bridge.storage.size, 0);
  equal(
    await bridge.api.hasPendingHistoryDictionaryImport(
      clientConfig,
      { terms: clientTerms },
      teacher.uid,
    ),
    false,
  );
  equal(bridge.stepUps.length, 0);
  scenarios.push(
    "actual-client-helper-reload-reuses-id-after-server-commit-and-unavailable-status",
  );

  await assert.rejects(
    bridge.api.saveHistoryDictionaryTermsBulk(
      clientConfig,
      { terms: clientTerms },
      teacher.uid,
    ),
    (error) => {
      equal(bridge.api.isHistoryDictionaryImportConflict(error), true);
      equal(bridge.api.isHistoryDictionaryImportUncertain(error), false);
      return true;
    },
  );
  checks++;
  equal(bridge.storage.size, 0);
  deepEqual(await snapshotBusiness(), beforeClientReplay);
  const beforeWrongOwner = bridge.requests.length;
  await assert.rejects(
    bridge.api.saveHistoryDictionaryTermsBulk(
      clientConfig,
      { terms: [term("다른사용자")] },
      student.uid,
    ),
  );
  checks++;
  equal(bridge.requests.length, beforeWrongOwner);
  equal(vmNetworkAttempts, 0);
  scenarios.push(
    "actual-client-helper-confirms-global-conflict-and-rejects-wrong-owner",
  );

  const unicodeTerms = Array.from({ length: 200 }, (_, index) =>
    term(`UTF8-${index}`, {
      definition: "가".repeat(1200),
      studentLevel: "중".repeat(80),
      relatedUnitId: "단".repeat(120),
      tags: Array.from(
        { length: 12 },
        (_, tagIndex) => `태그${tagIndex}${"가".repeat(18)}`,
      ),
    }),
  );
  const unicodePayload = payloadFor(unicodeTerms);
  const unicodeJson = JSON.stringify(unicodePayload);
  check(
    unicodeJson.length < 750_000,
    "The case must distinguish characters from UTF-8 bytes.",
  );
  check(Buffer.byteLength(unicodeJson, "utf8") > 750_000);
  await rejectWithoutWrites(
    teacher,
    unicodePayload,
    "COMMAND_PAYLOAD_TOO_LARGE",
  );
  scenarios.push("unicode-utf8-payload-byte-cap-aborts-whole-import");

  const maximumTerms = Array.from({ length: 200 }, (_, index) =>
    term(`MAX-${index}`),
  );
  const maximumId = randomUUID();
  const maximum = await execute(teacher, payloadFor(maximumTerms), maximumId);
  await assertPersisted(teacher, maximumTerms, maximum);
  await assertReceipt(teacher, maximumId, maximum.result.termIds);
  scenarios.push(
    "maximum-200-row-import-commits-all-documents-and-one-receipt",
  );

  await adminDb((db) =>
    updateDoc(doc(db, sessionPath(teacher)), {
      generalExpiresAt: Timestamp.fromMillis(0),
    }),
  );
  await rejectWithoutWrites(teacher, sessionPayload, "SESSION_EXPIRED", {
    code: "unauthenticated",
  });
  await adminDb((db) => deleteDoc(doc(db, sessionPath(teacher))));
  await rejectWithoutWrites(teacher, sessionPayload, "SESSION_MISSING", {
    code: "unauthenticated",
  });
  scenarios.push("expired-and-absent-general-session-denied");
  equal(blockedNetworkAttempts, 0);
} catch (error) {
  failure = error;
} finally {
  // Keep all cleanup within this dedicated demo namespace, including on failure.
  for (const user of createdUsers) {
    try {
      await deleteUser(user);
      deletedAuthUsers++;
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const owner of clients) {
    try {
      await terminate(owner.db);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  for (const app of apps) {
    try {
      await deleteApp(app);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (testEnv) {
    try {
      await testEnv.clearFirestore();
      equal((await adminDb((db) => getDocs(collection(db, "users")))).size, 0);
      for (const rows of Object.values(await snapshotBusiness()))
        equal(Object.keys(rows).length, 0);
      firestoreCleared = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      const closedEnvironment = await initializeTestEnvironment({
        projectId,
        firestore: {
          host: firestoreHost,
          port: firestorePort,
          rules:
            "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }",
        },
      });
      await closedEnvironment.cleanup();
      rulesReset = true;
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await testEnv.cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  globalThis.fetch = originalFetch;
}

if (failure || cleanupErrors.length) {
  throw new AggregateError(
    [failure, ...cleanupErrors].filter(Boolean),
    "Dictionary import integration or demo cleanup failed.",
  );
}
equal(deletedAuthUsers, 4);
equal(firestoreCleared, true);
equal(rulesReset, true);
equal(blockedNetworkAttempts, 0);
console.log(
  JSON.stringify({
    suite: "history-dictionary-import-integration",
    passed: true,
    checks,
    scenarios,
    projectId,
    transport: {
      firestore: "127.0.0.1:18080",
      auth: "127.0.0.1:9099",
      functions: "127.0.0.1:5001",
    },
    loopbackFetches,
    hubDiscoveryFetches,
    blockedNetworkAttempts,
    vmNetworkAttempts,
    actualClientSourceHashes,
    externalAccess: 0,
    productionAccess: 0,
    stagingAccess: 0,
    cleanup: { deletedAuthUsers, firestoreCleared, rulesReset },
    appCheck: "DISABLED_BY_DEMO_CONTRACT",
  }),
);
