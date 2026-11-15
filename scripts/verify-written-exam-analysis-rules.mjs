// Synthetic-only integration verification; never connect to production.
// firebase emulators:exec --only firestore,storage --config firebase.written-exam-analysis-test.json --project demo-westory-written-analysis "node scripts/verify-written-exam-analysis-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { createMockUserToken } from "@firebase/util";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  deleteDoc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  runTransaction,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getMetadata, ref, uploadBytes } from "firebase/storage";

const projectId = "demo-westory-written-analysis";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18228");
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9298");
setLogLevel("silent");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18228,
    rules: readFileSync("firestore.rules", "utf8"),
  },
  storage: {
    host: "127.0.0.1",
    port: 9298,
    rules: readFileSync("storage.rules", "utf8"),
  },
});
const root = "years/2026/semesters/2/written_exam_analyses";
const authTime = Math.floor(Date.now() / 1000) - 30;
const bucket = `gs://${projectId}.firebasestorage.app`;
const requireFunctions = createRequire(resolve("functions/package.json"));
const { initializeApp, deleteApp } = requireFunctions("firebase-admin/app");
const { getFirestore } = requireFunctions("firebase-admin/firestore");
const { getStorage } = requireFunctions("firebase-admin/storage");
const adminApp = initializeApp({
  projectId,
  storageBucket: `${projectId}.firebasestorage.app`,
});
const adminDb = getFirestore(adminApp),
  adminBucket = getStorage(adminApp).bucket();
const proof = {
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const requestFor = (actor, data) => ({
  auth:
    actor === "anon"
      ? undefined
      : {
          uid: actor,
          token: {
            auth_time: authTime,
            email:
              actor === "admin"
                ? "westoria28@gmail.com"
                : actor === "external"
                  ? "someone@example.com"
                  : `${actor}@yongshin-ms.ms.kr`,
          },
        },
  data: { ...data, _session: proof },
});
// This demo project is deliberately outside the production session allowlist.
// Keep the fixture guard strict and backed by actual emulator session records;
// production session-authority behavior has its own independent regression suite.
const assertFixtureSession = async (request) => {
  const uid = request.auth?.uid,
    email = request.auth?.token?.email;
  assert.ok(uid, "Authentication required");
  assert.ok(
    email === "westoria28@gmail.com" || email.endsWith("@yongshin-ms.ms.kr"),
    "School account required",
  );
  const snap = await adminDb
    .doc(`application_sessions/${uid}/sessions/${request.auth.token.auth_time}`)
    .get();
  const session = snap.data();
  assert.ok(
    session &&
      session.status === "active" &&
      session.authTime === request.auth.token.auth_time,
    "Active session required",
  );
  assert.ok(
    session.generalExpiresAt.toMillis() > Date.now(),
    "Session expired",
  );
  assert.equal(
    session.authorityGeneration,
    request.data._session?.authorityGeneration,
  );
  assert.equal(session.protocolVersion, request.data._session?.protocolVersion);
  assert.equal(session.sessionRevision, request.data._session?.revision);
  return { uid, email, authTime: request.auth.token.auth_time };
};
const { createWrittenExamAssetHandler } = requireFunctions(
  resolve("functions/writtenExamAssets.js"),
);
const assetHandler = createWrittenExamAssetHandler({
  db: adminDb,
  bucket: adminBucket,
  assertSession: assertFixtureSession,
});
const checks = [];
const clients = {};
const check = async (label, run) => {
  await run();
  checks.push(label);
};
const privileged = (run) => env.withSecurityRulesDisabled(run);
const tempDir = resolve("node_modules/.cache/written-exam-analysis-rules");
const tempFile = resolve(tempDir, `store-${process.pid}.mjs`);
const config = { year: "2026", semester: "2" };
const question = {
  number: 1,
  answer: "2",
  points: 4,
  options: ["1", "2", "3", "4", "5"],
  achievementStandardCodes: [],
  targetAchievementLevel: "C",
  intendedDifficulty: "medium",
  concepts: [],
};
const student = (id, classNumber) => ({
  key: id,
  uid: id,
  grade: "3",
  class: classNumber,
  number: "1",
  name: "합성 학생",
  responses: [{ questionNumber: 1, answer: "2", correct: true, score: 4 }],
  totalScore: 4,
});
const input = {
  expectedRevision: null,
  title: "합성 정기시험",
  examDate: "2026-11-14",
  grade: "3",
  questions: [question],
  students: [student("student-a", "1"), student("student-b", "2")],
  crops: [],
  files: [],
};
const hooks = {
  calls: [],
  uploads: [],
  assetCalls: [],
  assetFailures: [],
  beforeTransaction: null,
  failClassCommit: false,
  failAfterCommit: false,
  failAfterUpload: false,
};

try {
  await env.clearFirestore();
  await env.clearStorage();
  await privileged(async (context) => {
    await setDoc(doc(context.firestore(), "site_settings/semester_active"), {
      semesterId: "2026-2",
      revision: 1,
    });
    await setDoc(doc(context.firestore(), "site_settings/config"), {
      year: "2026",
      semester: "2",
    });
    await setDoc(doc(context.firestore(), "semester_manifests/2026-2"), {
      semesterId: "2026-2",
      revision: 1,
      status: "ACTIVE",
      readOnly: false,
    });
    for (const [uid, role] of Object.entries({
      teacher: "teacher",
      admin: "teacher",
      staff: "staff",
      "student-a": "student",
      "student-b": "student",
      expired: "teacher",
      revoked: "teacher",
      pending: "teacher",
      missing: "teacher",
      external: "teacher",
    })) {
      const email =
        uid === "admin"
          ? "westoria28@gmail.com"
          : uid === "external"
            ? "someone@example.com"
            : `${uid}@yongshin-ms.ms.kr`;
      const ctx = env.authenticatedContext(uid, { email, auth_time: authTime });
      clients[uid] = { db: ctx.firestore(), storage: ctx.storage(bucket) };
      await setDoc(doc(context.firestore(), "users", uid), {
        role,
        teacherPortalEnabled: true,
        staffPermissions: ["score_manage", "quiz_read", "lesson_read"],
        registrationApprovalStatus: uid === "pending" ? "PENDING" : "APPROVED",
      });
      if (uid !== "missing")
        await setDoc(
          doc(
            context.firestore(),
            `application_sessions/${uid}/sessions/${authTime}`,
          ),
          {
            schemaVersion: 2,
            status: uid === "revoked" ? "revoked" : "active",
            authTime,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            sessionRevision: "a".repeat(64),
            authorityModeAtOpen: "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(
              Date.now() + (uid === "expired" ? -60_000 : 3_600_000),
            ),
          },
        );
    }
  });
  const anonymous = env.unauthenticatedContext();
  clients.anon = {
    db: anonymous.firestore(),
    storage: anonymous.storage(bucket),
  };

  // Run the real store with only the Firebase singleton wired to synthetic clients.
  // Wrap SDK calls to measure actual requests and inject transport failures.
  globalThis.__writtenExamStore = {
    db: clients.teacher.db,
    auth: {
      currentUser: {
        uid: "teacher",
        getIdToken: async () =>
          createMockUserToken(
            {
              sub: "teacher",
              email: "teacher@yongshin-ms.ms.kr",
              auth_time: authTime,
            },
            projectId,
          ),
      },
    },
    storage: clients.teacher.storage,
    hooks,
    call: async (name, data, user, options) => {
      assert.equal(name, "manageWrittenExamAsset");
      options?.beforeDispatch?.();
      assert.equal(user, globalThis.__writtenExamStore.auth.currentUser);
      hooks.assetCalls.push({
        action: data.action,
        storagePath: data.storagePath,
        chunkIndex: data.chunkIndex,
      });
      let result;
      try {
        result = await assetHandler(requestFor(user.uid, data));
      } catch (failure) {
        hooks.assetFailures.push({
          action: data.action,
          storagePath: data.storagePath,
          code: failure.code,
          message: failure.message,
        });
        throw failure;
      }
      if (data.action === "upload" && result.complete) {
        hooks.uploads.push(data.storagePath);
        if (hooks.failAfterUpload) {
          hooks.failAfterUpload = false;
          throw new Error("injected lost upload acknowledgement");
        }
      }
      return { data: result };
    },
  };
  mkdirSync(tempDir, { recursive: true });
  const result = await build({
    stdin: {
      contents:
        'export * from "./src/lib/writtenExamAnalysisStore"; export * from "./src/lib/writtenExamScoreSource";',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    packages: "external",
    define: {
      "import.meta.env": JSON.stringify({
        VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1",
        VITE_FIRESTORE_EMULATOR_PORT: "18228",
      }),
    },
    plugins: [
      {
        name: "synthetic-store",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({
            path: "singleton",
            namespace: "synthetic",
          }));
          builder.onResolve({ filter: /^\.\/semesterArchive$/ }, () => ({
            path: "archive",
            namespace: "synthetic",
          }));
          builder.onResolve({ filter: /^\.\/applicationSession$/ }, () => ({
            path: "session",
            namespace: "synthetic",
          }));
          builder.onResolve({ filter: /^firebase\/firestore$/ }, (args) =>
            args.namespace === "instrument"
              ? { path: args.path, external: true }
              : { path: args.path, namespace: "instrument" },
          );
          builder.onLoad(
            { filter: /.*/, namespace: "synthetic" },
            ({ path }) => ({
              contents:
                path === "session"
                  ? "export const callWithApplicationSession = (...args) => globalThis.__writtenExamStore.call(...args);"
                  : path === "singleton"
                    ? "export const db = globalThis.__writtenExamStore.db; export const auth = globalThis.__writtenExamStore.auth; export const readWrittenExamAssetChunk = () => { throw Error('Archive mode is covered by the asset client suite'); };"
                    : "export const isSemesterArchive = false; export const archiveScope = null; export const assertArchiveWritable = () => {};",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "instrument" }, () => ({
            contents: `
        export * from "firebase/firestore";
        import * as sdk from "firebase/firestore";
        const h = globalThis.__writtenExamStore.hooks;
        const path = value => value.path || value._query?.path?.canonicalString();
        export const getDocFromServer = async value => { const result = await sdk.getDocFromServer(value); h.calls.push({kind:"get",path:path(value),documents:result.exists()?1:0}); return result; };
        export const getDocsFromServer = async value => { const result = await sdk.getDocsFromServer(value); h.calls.push({kind:"list",path:path(value),documents:result.size}); return result; };
        export const writeBatch = value => { const batch = sdk.writeBatch(value); const commit = batch.commit.bind(batch); batch.commit = async () => { if(h.failClassCommit) { h.failClassCommit=false; throw new Error("injected class write failure"); } return commit(); }; return batch; };
        export const runTransaction = async (...args) => { if(h.beforeTransaction) {const run=h.beforeTransaction;h.beforeTransaction=null;await run();} const result = await sdk.runTransaction(...args); if(h.failAfterCommit) { h.failAfterCommit=false; throw new Error("injected lost commit acknowledgement"); } return result; };
      `,
          }));
        },
      },
    ],
  });
  writeFileSync(tempFile, result.outputFiles[0].contents);
  const store = await import(pathToFileURL(tempFile).href);
  let saved;
  await check("teacher: publish real store revision", async () => {
    saved = await store.saveWrittenExamAnalysis(config, input);
    assert.deepEqual(saved.classIds, ["3-1", "3-2"]);
  });
  await check(
    "metadata list: one server query, no student-response reads",
    async () => {
      hooks.calls = [];
      const list = await store.listWrittenExamAnalyses(config, { grade: "3" });
      assert.equal(list.length, 1);
      assert.equal("students" in list[0], false);
      assert.deepEqual(hooks.calls, [
        { kind: "list", path: root, documents: 1 },
      ]);
    },
  );
  await check(
    "selected class: exactly one metadata + one class server read",
    async () => {
      hooks.calls = [];
      const data = await store.loadWrittenExamAnalysis(config, saved.id, {
        classId: "3-1",
      });
      assert.deepEqual(
        data.students.map((value) => value.key),
        ["student-a"],
      );
      assert.deepEqual(data.readCounts, { metadata: 1, classes: 1 });
      assert.equal(hooks.calls.length, 2);
      assert.deepEqual(
        hooks.calls.map((value) => value.documents),
        [1, 1],
      );
    },
  );
  await check(
    "grade aggregate: complete classes, one metadata + one scoped query",
    async () => {
      hooks.calls = [];
      const data = await store.loadWrittenExamAnalysis(config, saved.id);
      assert.equal(data.students.length, 2);
      assert.deepEqual(data.readCounts, { metadata: 1, classes: 2 });
      assert.deepEqual(
        hooks.calls.map((value) => [value.kind, value.documents]),
        [
          ["get", 1],
          ["list", 2],
        ],
      );
      assert.equal(
        hooks.calls[1].path,
        `${root}/${saved.id}/revisions/${saved.revision}/classes`,
      );
    },
  );
  await check(
    "refresh: repeats only the selected metadata and class reads",
    async () => {
      hooks.calls = [];
      await store.loadWrittenExamAnalysis(config, saved.id, { classId: "3-2" });
      await store.loadWrittenExamAnalysis(config, saved.id, { classId: "3-2" });
      assert.equal(hooks.calls.length, 4);
      assert.equal(
        hooks.calls.filter((value) => value.path.endsWith("/3-2")).length,
        2,
      );
    },
  );
  await check(
    "failed class write: previous revision survives; retry publishes whole revision",
    async () => {
      hooks.failClassCommit = true;
      await assert.rejects(
        () =>
          store.saveWrittenExamAnalysis(config, {
            ...input,
            examId: saved.id,
            expectedRevision: saved.revision,
          }),
        /injected class/,
      );
      assert.equal(
        (await store.loadWrittenExamAnalysis(config, saved.id)).metadata
          .revision,
        saved.revision,
      );
      saved = await store.saveWrittenExamAnalysis(config, {
        ...input,
        examId: saved.id,
        expectedRevision: saved.revision,
      });
    },
  );
  await check(
    "optimistic concurrency: stale expected revision cannot overwrite",
    async () => {
      const before = saved.revision;
      await assert.rejects(
        () =>
          store.saveWrittenExamAnalysis(config, {
            ...input,
            examId: saved.id,
            expectedRevision: "stale-revision",
          }),
        /변경되었습니다/,
      );
      assert.equal(
        (await store.loadWrittenExamAnalysis(config, saved.id)).metadata
          .revision,
        before,
      );
    },
  );
  await check(
    "lost commit response: committed revision retained and recovered",
    async () => {
      hooks.failAfterCommit = true;
      saved = await store.saveWrittenExamAnalysis(config, {
        ...input,
        examId: saved.id,
        expectedRevision: saved.revision,
      });
      assert.equal(
        (await store.loadWrittenExamAnalysis(config, saved.id)).students.length,
        2,
      );
    },
  );

  await check(
    "failed PDF upload response: previous revision survives and retry publishes",
    async () => {
      const files = [
        {
          fileName: "paper.pdf",
          kind: "pdf",
          blob: new Blob(["%PDF-1.4\n% synthetic test\n%%EOF "], {
            type: "application/pdf",
          }),
        },
      ];
      hooks.failAfterUpload = true;
      await assert.rejects(
        () =>
          store.saveWrittenExamAnalysis(config, {
            ...input,
            files,
            examId: saved.id,
            expectedRevision: saved.revision,
          }),
        /injected lost upload/,
      );
      assert.equal(
        (await store.loadWrittenExamAnalysis(config, saved.id)).metadata
          .revision,
        saved.revision,
      );
      saved = await store.saveWrittenExamAnalysis(config, {
        ...input,
        files,
        examId: saved.id,
        expectedRevision: saved.revision,
      });
      assert.equal(saved.files[0].fileName, "paper.pdf");
      assert.equal(
        (
          await store.loadWrittenExamAnalysisAsset(
            config,
            saved.id,
            saved.revision,
            "paper.pdf",
          )
        ).size,
        32,
      );
    },
  );
  await check("asset loader never generates a public token URL", async () => {
    const source = readFileSync("src/lib/writtenExamAnalysisStore.ts", "utf8");
    assert.equal(source.includes("getDownloadURL"), false);
    assert.match(source, /return readWrittenExamAsset\(/);
    assert.equal(source.includes('from "firebase/storage"'), false);
  });
  await check(
    "multi-chunk PDF uses real server upload/read and preserves every byte without public tokens or leftover chunks",
    async () => {
      const bytes = Buffer.alloc(4 * 1024 * 1024 + 51, 32);
      bytes.write("%PDF-1.4\n% synthetic multi-chunk fixture\n", 0);
      bytes.write("%%EOF", bytes.length - 5);
      const before = hooks.assetCalls.length;
      const chunked = await store.saveWrittenExamAnalysis(config, {
        ...input,
        examId: "synthetic-chunked-transport",
        files: [
          {
            fileName: "paper.pdf",
            kind: "pdf",
            blob: new Blob([bytes], { type: "application/pdf" }),
          },
        ],
      });
      const blob = await store.loadWrittenExamAnalysisAsset(
        config,
        chunked.id,
        chunked.revision,
        "paper.pdf",
      );
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
      assert.deepEqual(
        hooks.assetCalls
          .slice(before)
          .map(({ action, chunkIndex }) => [action, chunkIndex]),
        [
          ["upload", 0],
          ["upload", 1],
          ["read", 0],
          ["read", 1],
        ],
      );
      const prefix = `${root}/${chunked.id}/${chunked.revision}/`;
      const [stored] = await adminBucket.getFiles({ prefix });
      assert.deepEqual(
        stored.map((file) => file.name),
        [`${prefix}paper.pdf`],
      );
      const [metadata] = await stored[0].getMetadata();
      assert.equal(metadata.metadata?.firebaseStorageDownloadTokens, undefined);
      assert.equal(
        metadata.metadata.sha256,
        createHash("sha256").update(bytes).digest("hex"),
      );
    },
  );

  const manifestPath = `${root}/${saved.id}`;
  const classPath = `${manifestPath}/revisions/${saved.revision}/classes/3-1`;
  for (const actor of ["admin", "teacher"])
    await check(`${actor}: metadata and class read allowed`, async () => {
      await assertSucceeds(
        getDocFromServer(doc(clients[actor].db, manifestPath)),
      );
      await assertSucceeds(getDocFromServer(doc(clients[actor].db, classPath)));
    });
  for (const actor of [
    "student-a",
    "student-b",
    "staff",
    "anon",
    "expired",
    "revoked",
    "pending",
    "missing",
    "external",
  ])
    await check(`${actor}: list, own/other class, write denied`, async () => {
      await assertFails(getDocsFromServer(collection(clients[actor].db, root)));
      await assertFails(getDocFromServer(doc(clients[actor].db, classPath)));
      await assertFails(
        setDoc(doc(clients[actor].db, manifestPath), {
          ...saved,
          updatedBy: actor,
          updatedAt: serverTimestamp(),
        }),
      );
    });
  await check(
    "published class and manifest are immutable without a new staged revision",
    async () => {
      await assertFails(
        updateDoc(doc(clients.teacher.db, classPath), { students: [] }),
      );
      await assertFails(
        updateDoc(doc(clients.teacher.db, manifestPath), {
          title: "overwrite",
          updatedAt: serverTimestamp(),
        }),
      );
    },
  );
  await check(
    "cleanup tombstone blocks publication, ready transition and class writes; only its owner can delete",
    async () => {
      const revision = "cleanup-race-fixture";
      const revisionPath = `${manifestPath}/revisions/${revision}`;
      const responsePath = `${revisionPath}/classes/3-1`;
      const classData = {
        schemaVersion: 1,
        year: "2026",
        semester: "2",
        examId: saved.id,
        revision,
        classId: "3-1",
        grade: "3",
        students: [student("student-a", "1")],
      };
      await privileged(async (context) => {
        await setDoc(doc(context.firestore(), revisionPath), {
          schemaVersion: 1,
          year: "2026",
          semester: "2",
          examId: saved.id,
          revision,
          state: "cleanup",
          uploadedBy: "teacher",
          classIds: ["3-1"],
          studentCount: 1,
          createdAt: serverTimestamp(),
        });
        await setDoc(doc(context.firestore(), responsePath), classData);
      });
      const before = (
        await getDocFromServer(doc(clients.teacher.db, manifestPath))
      ).data();
      await assertFails(
        setDoc(doc(clients.teacher.db, manifestPath), {
          ...before,
          revision,
          updatedAt: serverTimestamp(),
        }),
      );
      await assertFails(
        updateDoc(doc(clients.teacher.db, revisionPath), { state: "ready" }),
      );
      await assertFails(
        setDoc(doc(clients.teacher.db, responsePath), classData),
      );
      await assertFails(
        runTransaction(clients.teacher.db, async (transaction) => {
          transaction.update(doc(clients.teacher.db, revisionPath), {
            state: "ready",
          });
          transaction.set(doc(clients.teacher.db, manifestPath), {
            ...before,
            revision,
            updatedAt: serverTimestamp(),
          });
        }),
      );
      await assertFails(deleteDoc(doc(clients.admin.db, responsePath)));
      await assertFails(deleteDoc(doc(clients.admin.db, revisionPath)));
      await assertSucceeds(deleteDoc(doc(clients.teacher.db, responsePath)));
      await assertSucceeds(deleteDoc(doc(clients.teacher.db, revisionPath)));
      assert.equal(
        (await getDocFromServer(doc(clients.teacher.db, manifestPath))).data()
          .revision,
        before.revision,
      );
    },
  );
  await check(
    "semester fence: old semester write denied and reads remain scoped",
    async () => {
      await assert.rejects(
        () =>
          store.saveWrittenExamAnalysis({ year: "2026", semester: "1" }, input),
        { code: "permission-denied" },
      );
      hooks.calls = [];
      assert.deepEqual(
        await store.listWrittenExamAnalyses({ year: "2026", semester: "1" }),
        [],
      );
      assert.equal(
        hooks.calls[0].path,
        root.replace("semesters/2", "semesters/1"),
      );
      await assertFails(
        setDoc(
          doc(clients.teacher.db, `${root}/scope-check/revisions/staged`),
          {
            schemaVersion: 1,
            year: "2027",
            semester: "2",
            examId: "scope-check",
            revision: "staged",
            state: "staging",
            uploadedBy: "teacher",
            classIds: ["3-1"],
            studentCount: 1,
            createdAt: serverTimestamp(),
          },
        ),
      );
    },
  );

  // Direct browser access is denied even for teachers/admins; authenticated
  // callables enforce ownership, semester, staging and publication via Admin SDK.
  const stagePath = `${manifestPath}/revisions/asset-stage`;
  await setDoc(doc(clients.teacher.db, stagePath), {
    schemaVersion: 1,
    year: "2026",
    semester: "2",
    examId: saved.id,
    revision: "asset-stage",
    state: "staging",
    uploadedBy: "teacher",
    classIds: ["3-1"],
    studentCount: 1,
    createdAt: serverTimestamp(),
  });
  const objectPath = `${root}/${saved.id}/asset-stage/paper.pdf`;
  const stageBytes = Buffer.from(
    "%PDF-1.4\n% synthetic protected bytes\n%%EOF",
  );
  const uploadInput = {
    action: "upload",
    storagePath: objectPath,
    contentType: "application/pdf",
    totalSize: stageBytes.length,
    sha256: createHash("sha256").update(stageBytes).digest("hex"),
    chunkIndex: 0,
    contentBase64: stageBytes.toString("base64"),
  };
  await check(
    "server teacher upload succeeds; staged read is denied",
    async () => {
      assert.equal(
        (await assetHandler(requestFor("teacher", uploadInput))).complete,
        true,
      );
      await assert.rejects(
        assetHandler(
          requestFor("teacher", {
            action: "read",
            storagePath: objectPath,
            chunkIndex: 0,
          }),
        ),
      );
    },
  );
  for (const actor of [
    "teacher",
    "admin",
    "student-a",
    "student-b",
    "staff",
    "anon",
    "expired",
    "revoked",
    "pending",
    "missing",
    "external",
  ])
    await check(
      `${actor}: direct Storage read, write, delete and internal chunk access all denied`,
      async () => {
        for (const storagePath of [
          objectPath,
          objectPath.replace(
            "paper.pdf",
            `_chunks/${createHash("sha256").update("paper.pdf").digest("hex")}-0`,
          ),
        ]) {
          const reference = ref(clients[actor].storage, storagePath);
          await assertFails(getMetadata(reference));
          await assertFails(
            uploadBytes(reference, new Uint8Array(1), {
              contentType: "application/pdf",
            }),
          );
          await assertFails(deleteObject(reference));
        }
      },
    );
  for (const actor of [
    "student-a",
    "student-b",
    "staff",
    "anon",
    "expired",
    "revoked",
    "pending",
    "missing",
    "external",
  ])
    await check(
      `${actor}: server asset read, upload and removal denied`,
      async () => {
        await assert.rejects(assetHandler(requestFor(actor, uploadInput)));
        await assert.rejects(
          assetHandler(
            requestFor(actor, {
              action: "read",
              storagePath: objectPath,
              chunkIndex: 0,
            }),
          ),
        );
        await assert.rejects(
          assetHandler(
            requestFor(actor, { action: "remove", storagePath: objectPath }),
          ),
        );
      },
    );
  await check(
    "server validates content type, declared size, semester and revision ownership",
    async () => {
      for (const change of [
        { contentType: "text/html" },
        { totalSize: 30 * 1024 * 1024 + 1 },
        { storagePath: objectPath.replace("semesters/2", "semesters/1") },
        { storagePath: objectPath.replace("asset-stage", "not-a-revision") },
        { extra: "unexpected" },
      ])
        await assert.rejects(
          assetHandler(requestFor("teacher", { ...uploadInput, ...change })),
        );
      await assert.rejects(assetHandler(requestFor("admin", uploadInput)));
      await assert.rejects(
        assetHandler({
          ...requestFor("teacher", uploadInput),
          data: {
            ...uploadInput,
            _session: { ...proof, revision: "b".repeat(64) },
          },
        }),
      );
    },
  );
  await check(
    "server cleanup removes staging bytes; ready assets cannot be overwritten or removed",
    async () => {
      await assetHandler(
        requestFor("teacher", { action: "remove", storagePath: objectPath }),
      );
      assert.equal((await adminBucket.file(objectPath).exists())[0], false);
      await privileged((context) =>
        updateDoc(doc(context.firestore(), stagePath), { state: "ready" }),
      );
      await assert.rejects(assetHandler(requestFor("teacher", uploadInput)));
      await assert.rejects(
        assetHandler(
          requestFor("teacher", { action: "remove", storagePath: objectPath }),
        ),
      );
      const publishedPath = `${root}/${saved.id}/${saved.revision}/paper.pdf`;
      for (const actor of ["teacher", "admin"]) {
        const response = await assetHandler(
          requestFor(actor, {
            action: "read",
            storagePath: publishedPath,
            chunkIndex: 0,
          }),
        );
        assert.equal(Buffer.from(response.contentBase64, "base64").length, 32);
        await assertFails(
          getMetadata(ref(clients[actor].storage, publishedPath)),
        );
      }
    },
  );
  await check(
    "official score, signature and objection collections stay untouched",
    async () => {
      await privileged(async (context) => {
        for (const name of [
          "performance_score_rosters",
          "performance_score_objections",
          "performance_score_answer_sheet_requests",
        ])
          assert.equal(
            (
              await getDocsFromServer(
                collection(
                  context.firestore(),
                  `years/2026/semesters/2/${name}`,
                ),
              )
            ).size,
            0,
          );
        const revisions = await getDocsFromServer(
          collection(context.firestore(), `${manifestPath}/revisions`),
        );
        assert.equal(
          revisions.docs.some((item) => item.data().state === "staging"),
          false,
          "failed imports must clean their staged revisions",
        );
      });
    },
  );

  await check(
    "linked materials publish without copying any student responses",
    async () => {
      hooks.failClassCommit = true;
      const materials = await store.saveWrittenExamAnalysis(
        config,
        { ...input, examId: "linked-score-materials" },
        { materialsOnly: true },
      );
      assert.equal(
        hooks.failClassCommit,
        true,
        "Materials must not commit a class-response batch",
      );
      hooks.failClassCommit = false;
      const manifest = await getDocFromServer(
        doc(clients.teacher.db, root, materials.id),
      );
      assert.equal(manifest.data().revision, materials.revision);
      assert.equal("students" in manifest.data(), false);
      const responses = await getDocsFromServer(
        collection(
          clients.teacher.db,
          root,
          materials.id,
          "revisions",
          materials.revision,
          "classes",
        ),
      );
      assert.equal(responses.size, 0);
      await assertFails(
        getDocFromServer(doc(clients["student-a"].db, root, materials.id)),
      );
    },
  );
  const linkedId = "synthetic-essay-ledger";
  const linkedRosterPath = `years/2026/semesters/2/performance_score_rosters/${linkedId}`;
  const linkedScorePath = `users/student-a/performance_scores/${linkedId}`;
  const linkedConfirmationPath = `${linkedScorePath}/confirmations/synthetic-confirmation`;
  const essayDefinition = {
    name: "논술형",
    itemKey: "essay-total",
    examSection: "essay",
    maxScore: 10,
  };
  const linkedRoster = {
    scoreKind: "written_exam_essay",
    scoreContentKind: "essay",
    title: "합성 자료 등록 검증",
    subject: "역사",
    academicYear: "2026",
    semester: "2",
    targetGrade: "3",
    targetClass: "",
    classes: Array.from({ length: 10 }, (_, index) => String(index + 1)),
    rowCount: 285,
    items: [essayDefinition],
    totalMaxScore: 10,
    rows: Array.from({ length: 285 }, (_, index) => ({
      uid: `synthetic-${index}`,
      grade: "3",
      class: String(Math.floor(index / 29) + 1),
      number: String((index % 29) + 1),
      studentName: `합성학생 ${index + 1}`,
      rowNumber: index + 1,
      items: [
        {
          ...essayDefinition,
          score: index % 10,
          scoreEntered: true,
          feedback: "합성 교사 피드백",
        },
      ],
      totalScore: index % 10,
      totalMaxScore: 10,
      enteredScoreCount: 1,
    })),
    updatedAt: Timestamp.fromMillis(1_800_000_000_000),
  };
  const twentyQuestions = Array.from({ length: 20 }, (_, index) => ({
    ...question,
    number: index + 1,
  }));
  const pdfBytes = new TextEncoder().encode(
    "%PDF-1.4\n% Synthetic storage transport fixture only\n%%EOF",
  );
  const pageBytes = new Uint8Array(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const linkedInput = {
    examId: linkedId,
    expectedRevision: null,
    examDate: "2026-11-14",
    questions: twentyQuestions,
    crops: twentyQuestions.map(({ number }) => ({
      questionNumber: number,
      page: 1,
      rect: { x: 0, y: 0, width: 1, height: 1 },
      highlights: [{ x: 0.1, y: 0.8, width: 0.7, height: 0.1 }],
      ...(number === 1
        ? { contextRects: [{ x: 0.1, y: 0.05, width: 0.8, height: 0.2 }] }
        : {}),
      status: "ready",
      warnings: [],
    })),
    files: [
      {
        fileName: "paper.pdf",
        kind: "pdf",
        blob: new Blob([pdfBytes], { type: "application/pdf" }),
      },
      {
        fileName: "page-1.png",
        kind: "page",
        page: 1,
        blob: new Blob([pageBytes], { type: "image/png" }),
      },
    ],
  };
  await privileged(async (context) => {
    await setDoc(doc(context.firestore(), linkedRosterPath), linkedRoster);
    await setDoc(doc(context.firestore(), linkedScorePath), {
      uid: "student-a",
      rosterId: linkedId,
      scoreKind: "written_exam_essay",
      academicYear: "2026",
      semester: "2",
      totalScore: 0,
      signatureName: "합성 서명",
      signatureImage: "synthetic-image",
      signedAt: Timestamp.fromMillis(1_800_000_000_000),
    });
    await setDoc(doc(context.firestore(), linkedConfirmationPath), {
      uid: "student-a",
      rosterId: linkedId,
      signatureName: "합성 서명",
      confirmedAt: Timestamp.fromMillis(1_800_000_000_000),
    });
  });
  const ledgerBefore = await privileged(async (context) =>
    JSON.stringify(
      await Promise.all(
        [linkedRosterPath, linkedScorePath, linkedConfirmationPath].map(
          async (path) =>
            (await getDocFromServer(doc(context.firestore(), path))).data(),
        ),
      ),
    ),
  );
  let linkedSaved;
  await check(
    "registered-source REST projection connects through the real authenticated emulator",
    async () => {
      const sources = await store.listWrittenExamScoreSources(config);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].id, linkedId);
      assert.equal(sources[0].rowCount, 285);
      assert.equal("rows" in sources[0], false);
    },
  );
  await check(
    "285-student essay ledger: real materials-only save and reload preserve 20 items and protected PDF/page bytes",
    async () => {
      hooks.calls = [];
      linkedSaved = await store.saveWrittenExamScoreMaterials(
        config,
        linkedInput,
      );
      assert.equal(linkedSaved.studentCount, 285);
      assert.equal(linkedSaved.classIds.length, 10);
      assert.equal(linkedSaved.questions.length, 20);
      assert.equal(
        hooks.calls.filter((call) => call.path.startsWith("users/")).length,
        0,
      );
      const reloaded = await store.loadWrittenExamMaterials(config, linkedId);
      assert.equal(reloaded.revision, linkedSaved.revision);
      assert.deepEqual(reloaded.questions, twentyQuestions);
      assert.deepEqual(reloaded.crops, linkedInput.crops);
      for (const [fileName, bytes] of [
        ["paper.pdf", pdfBytes],
        ["page-1.png", pageBytes],
      ]) {
        const loaded = await store.loadWrittenExamAnalysisAsset(
          config,
          linkedId,
          reloaded.revision,
          fileName,
        );
        assert.deepEqual(new Uint8Array(await loaded.arrayBuffer()), bytes);
      }
      const classCopies = await getDocsFromServer(
        collection(
          clients.teacher.db,
          root,
          linkedId,
          "revisions",
          reloaded.revision,
          "classes",
        ),
      );
      assert.equal(classCopies.size, 0);
      for (const actor of [
        "student-a",
        "student-b",
        "expired",
        "revoked",
        "anon",
      ]) {
        await assertFails(
          getDocFromServer(doc(clients[actor].db, root, linkedId)),
        );
        await assertFails(
          getMetadata(
            ref(
              clients[actor].storage,
              `${root}/${linkedId}/${reloaded.revision}/paper.pdf`,
            ),
          ),
        );
      }
    },
  );
  await check(
    "materials-only lost publication acknowledgement recovers the committed revision",
    async () => {
      hooks.failAfterCommit = true;
      linkedSaved = await store.saveWrittenExamScoreMaterials(config, {
        ...linkedInput,
        expectedRevision: linkedSaved.revision,
      });
      assert.equal(
        (await store.loadWrittenExamMaterials(config, linkedId)).revision,
        linkedSaved.revision,
      );
    },
  );
  await check(
    "optional common-passage regions preserve old crops and reject excess/outside/nonfinite rectangles before upload",
    async () => {
      for (const contextRects of [
        Array.from({ length: 3 }, () => ({
          x: 0,
          y: 0,
          width: 0.1,
          height: 0.1,
        })),
        [{ x: -0.1, y: 0, width: 0.2, height: 0.2 }],
        [{ x: 0.8, y: 0, width: 0.3, height: 0.2 }],
        [{ x: 0, y: 0, width: NaN, height: 0.2 }],
      ]) {
        const before = hooks.uploads.length;
        await assert.rejects(
          store.saveWrittenExamScoreMaterials(config, {
            ...linkedInput,
            expectedRevision: linkedSaved.revision,
            crops: [{ ...linkedInput.crops[0], contextRects }],
          }),
          /공통 지문/,
        );
        assert.equal(hooks.uploads.length, before);
        assert.equal(
          (await store.loadWrittenExamMaterials(config, linkedId)).revision,
          linkedSaved.revision,
        );
      }
    },
  );
  for (const action of ["delete", "change"])
    await check(
      `linked ledger ${action} during upload blocks publication, removes new assets, and supports retry`,
      async () => {
        const previous = linkedSaved.revision;
        const uploadStart = hooks.uploads.length;
        hooks.beforeTransaction = () =>
          privileged((context) =>
            action === "delete"
              ? deleteDoc(doc(context.firestore(), linkedRosterPath))
              : updateDoc(doc(context.firestore(), linkedRosterPath), {
                  items: [{ ...essayDefinition, maxScore: 20 }],
                  updatedAt: serverTimestamp(),
                }),
          );
        await assert.rejects(
          store.saveWrittenExamScoreMaterials(config, {
            ...linkedInput,
            expectedRevision: previous,
          }),
          /점수표.*(삭제|변경)/,
        );
        assert.equal(
          (await store.loadWrittenExamMaterials(config, linkedId)).revision,
          previous,
        );
        await privileged(async (context) => {
          for (const file of hooks.uploads.slice(uploadStart))
            await assert.rejects(
              getMetadata(ref(context.storage(bucket), file)),
              { code: "storage/object-not-found" },
              JSON.stringify(hooks.assetFailures),
            );
          const revisions = await getDocsFromServer(
            collection(context.firestore(), root, linkedId, "revisions"),
          );
          assert.equal(
            revisions.docs.some((doc) => doc.data().state === "staging"),
            false,
          );
          await setDoc(
            doc(context.firestore(), linkedRosterPath),
            linkedRoster,
          );
        });
        linkedSaved = await store.saveWrittenExamScoreMaterials(config, {
          ...linkedInput,
          expectedRevision: previous,
        });
        assert.notEqual(linkedSaved.revision, previous);
      },
    );
  await check(
    "linked-source stale material revision cannot replace current PDF or metadata",
    async () => {
      const previous = linkedSaved.revision;
      await assert.rejects(
        store.saveWrittenExamScoreMaterials(config, {
          ...linkedInput,
          expectedRevision: "stale-material-revision",
        }),
        /변경/,
      );
      assert.equal(
        (await store.loadWrittenExamMaterials(config, linkedId)).revision,
        previous,
      );
    },
  );
  await check(
    "materials success, conflicts and retries never alter official roster, grades or confirmation",
    async () => {
      const ledgerAfter = await privileged(async (context) =>
        JSON.stringify(
          await Promise.all(
            [linkedRosterPath, linkedScorePath, linkedConfirmationPath].map(
              async (path) =>
                (await getDocFromServer(doc(context.firestore(), path))).data(),
            ),
          ),
        ),
      );
      assert.equal(ledgerAfter, ledgerBefore);
    },
  );
  await check(
    "284 by 21 objective server transaction, compact roster, materials reload and complete hydration retain the existing essay ledger",
    async () => {
      const compactId = "synthetic-compact-objective";
      const objectiveQuestions = Array.from({ length: 21 }, (_, index) => ({
        ...question,
        number: index + 1,
      }));
      const definitions = objectiveQuestions.map((q) => ({
        name: `${q.number}번`,
        itemKey: `objective-${q.number}`,
        examSection: "objective",
        questionNumber: q.number,
        correctAnswer: q.answer,
        maxScore: q.points,
      }));
      const compactRows = linkedRoster.rows.slice(0, 284).map((row, index) => ({
        ...row,
        items: [],
        enteredScoreCount: 21,
        totalScore: index % 7 === 0 ? 0 : 84,
        totalMaxScore: 84,
      }));
      const compactRoster = {
        ...linkedRoster,
        scoreContentKind: "objective",
        rowCount: 284,
        items: definitions,
        rows: compactRows,
        totalMaxScore: 84,
      };
      // Exercise the same server document shapes in one teacher transaction.
      // Workbook parsing and PSM save orchestration are covered separately.
      await assertSucceeds(
        runTransaction(clients.teacher.db, async (transaction) => {
          transaction.set(
            doc(
              clients.teacher.db,
              `years/2026/semesters/2/performance_score_rosters/${compactId}`,
            ),
            compactRoster,
          );
          compactRows.forEach((row, index) =>
            transaction.set(
              doc(
                clients.teacher.db,
                "users",
                row.uid,
                "performance_scores",
                compactId,
              ),
              {
                ...row,
                rosterId: compactId,
                scoreKind: "written_exam_essay",
                scoreContentKind: "objective",
                academicYear: "2026",
                semester: "2",
                title: "합성 21문항 점수표",
                subject: "역사",
                items: definitions.map((item) => ({
                  ...item,
                  score: index % 7 === 0 ? 0 : item.maxScore,
                  scoreEntered: true,
                  studentAnswer: index % 7 === 0 ? "1" : item.correctAnswer,
                  answerCorrect: index % 7 !== 0,
                  answerStatus: index % 7 === 0 ? "incorrect" : "correct",
                })),
              },
            ),
          );
        }),
      );
      hooks.calls = [];
      const compact = await store.saveWrittenExamScoreMaterials(config, {
        ...linkedInput,
        examId: compactId,
        questions: objectiveQuestions,
      });
      assert.equal(compact.studentCount, 284);
      assert.equal(
        (await store.loadWrittenExamMaterials(config, compactId)).questions
          .length,
        21,
      );
      assert.equal(
        hooks.calls.filter((call) => call.path.startsWith("users/")).length,
        0,
      );
      hooks.calls = [];
      const complete = await store.loadWrittenExamScoreAnalysis(
        config,
        compactId,
        { analysisKind: "objective" },
      );
      assert.equal(complete.students.length, 284);
      assert.equal(complete.metadata.questions.length, 21);
      assert.equal(complete.students[0].totalScore, 0);
      assert.equal(complete.students[1].totalScore, 84);
      assert.equal(
        hooks.calls.filter((call) => call.path.startsWith("users/")).length,
        284,
      );
      const unchanged = await privileged(async (context) =>
        JSON.stringify(
          await Promise.all(
            [linkedRosterPath, linkedScorePath, linkedConfirmationPath].map(
              async (path) =>
                (await getDocFromServer(doc(context.firestore(), path))).data(),
            ),
          ),
        ),
      );
      assert.equal(unchanged, ledgerBefore);
    },
  );
  console.log(
    JSON.stringify(
      {
        result: "passed",
        checks: checks.length,
        serverReads: {
          metadataList: "1 scoped query / no student docs",
          selectedClass: "1 metadata + 1 class",
          wholeGrade: "1 metadata + all class docs; no limit",
          refreshSelectedClassTwice: "4 document reads",
        },
        cases: checks,
      },
      null,
      2,
    ),
  );
} finally {
  await env.cleanup();
  await deleteApp(adminApp);
  rmSync(tempFile, { force: true });
  delete globalThis.__writtenExamStore;
}
