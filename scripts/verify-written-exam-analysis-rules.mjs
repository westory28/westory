// Synthetic-only integration verification; never connect to production.
// firebase emulators:exec --only firestore,storage --config firebase.written-exam-analysis-test.json --project demo-westory-written-analysis "node scripts/verify-written-exam-analysis-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { getMetadata, ref, uploadBytes } from "firebase/storage";

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
    auth: { currentUser: { uid: "teacher" } },
    storage: clients.teacher.storage,
    hooks,
  };
  mkdirSync(tempDir, { recursive: true });
  const result = await build({
    entryPoints: ["src/lib/writtenExamAnalysisStore.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    packages: "external",
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
          builder.onResolve(
            { filter: /^firebase\/(firestore|storage)$/ },
            (args) =>
              args.namespace === "instrument"
                ? { path: args.path, external: true }
                : { path: args.path, namespace: "instrument" },
          );
          builder.onLoad(
            { filter: /.*/, namespace: "synthetic" },
            ({ path }) => ({
              contents:
                path === "singleton"
                  ? "export const db = globalThis.__writtenExamStore.db; export const auth = globalThis.__writtenExamStore.auth; export const getFirebaseStorage = async () => globalThis.__writtenExamStore.storage;"
                  : "export const isSemesterArchive = false; export const archiveScope = null; export const assertArchiveWritable = () => {};",
            }),
          );
          builder.onLoad(
            { filter: /.*/, namespace: "instrument" },
            ({ path }) => ({
              contents: path.endsWith("firestore")
                ? `
        export * from "firebase/firestore";
        import * as sdk from "firebase/firestore";
        const h = globalThis.__writtenExamStore.hooks;
        const path = value => value.path || value._query?.path?.canonicalString();
        export const getDocFromServer = async value => { const result = await sdk.getDocFromServer(value); h.calls.push({kind:"get",path:path(value),documents:result.exists()?1:0}); return result; };
        export const getDocsFromServer = async value => { const result = await sdk.getDocsFromServer(value); h.calls.push({kind:"list",path:path(value),documents:result.size}); return result; };
        export const writeBatch = value => { const batch = sdk.writeBatch(value); const commit = batch.commit.bind(batch); batch.commit = async () => { if(h.failClassCommit) { h.failClassCommit=false; throw new Error("injected class write failure"); } return commit(); }; return batch; };
        export const runTransaction = async (...args) => { const result = await sdk.runTransaction(...args); if(h.failAfterCommit) { h.failAfterCommit=false; throw new Error("injected lost commit acknowledgement"); } return result; };
      `
                : `
        export * from "firebase/storage";
        import * as sdk from "firebase/storage";
        export const uploadBytes = async (...args) => { const result = await sdk.uploadBytes(...args); if(globalThis.__writtenExamStore.hooks.failAfterUpload) {globalThis.__writtenExamStore.hooks.failAfterUpload=false; throw new Error("injected lost upload acknowledgement");} return result; };
      `,
            }),
          );
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
          blob: new Blob([new Uint8Array(32)], { type: "application/pdf" }),
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
      await assertSucceeds(
        getMetadata(
          ref(
            clients.teacher.storage,
            `${root}/${saved.id}/${saved.revision}/paper.pdf`,
          ),
        ),
      );
    },
  );
  await check("asset loader never generates a public token URL", async () => {
    const source = readFileSync("src/lib/writtenExamAnalysisStore.ts", "utf8");
    assert.equal(source.includes("getDownloadURL"), false);
    assert.match(source, /return getBlob\(/);
  });

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

  // Storage checks use real cross-service session/role/revision rules.
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
  const imagePath = `${root}/${saved.id}/asset-stage/page-1.webp`;
  const objectMetadata = {
    contentType: "application/pdf",
    customMetadata: {
      ownerUid: "teacher",
      year: "2026",
      semester: "2",
      examId: saved.id,
      revision: "asset-stage",
    },
  };
  await check(
    "teacher: stage PDF/page uploads allowed; unpublished read blocked",
    async () => {
      await assertSucceeds(
        uploadBytes(
          ref(clients.teacher.storage, objectPath),
          new Uint8Array(20),
          objectMetadata,
        ),
      );
      await assertSucceeds(
        uploadBytes(
          ref(clients.teacher.storage, imagePath),
          new Uint8Array(20),
          { ...objectMetadata, contentType: "image/webp" },
        ),
      );
      await assertFails(getMetadata(ref(clients.teacher.storage, objectPath)));
    },
  );
  await check(
    "storage type, size, scope, unexpected metadata and ownership rejected",
    async () => {
      await assertFails(
        uploadBytes(
          ref(clients.teacher.storage, objectPath),
          new Uint8Array(1),
          { ...objectMetadata, contentType: "text/html" },
        ),
      );
      await assertFails(
        uploadBytes(
          ref(clients.teacher.storage, objectPath),
          new Uint8Array(30 * 1024 * 1024 + 1),
          objectMetadata,
        ),
      );
      await assertFails(
        uploadBytes(
          ref(clients.teacher.storage, imagePath),
          new Uint8Array(12 * 1024 * 1024 + 1),
          { ...objectMetadata, contentType: "image/webp" },
        ),
      );
      await assertFails(
        uploadBytes(
          ref(clients.teacher.storage, objectPath),
          new Uint8Array(1),
          {
            ...objectMetadata,
            customMetadata: {
              ...objectMetadata.customMetadata,
              publicUrl: "https://invalid.example/asset",
            },
          },
        ),
      );
      await assertFails(
        uploadBytes(ref(clients.admin.storage, objectPath), new Uint8Array(1), {
          ...objectMetadata,
          customMetadata: {
            ...objectMetadata.customMetadata,
            ownerUid: "admin",
          },
        }),
      );
      await assertFails(
        uploadBytes(
          ref(
            clients.teacher.storage,
            objectPath.replace("semesters/2", "semesters/1"),
          ),
          new Uint8Array(1),
          objectMetadata,
        ),
      );
    },
  );
  await privileged((context) =>
    updateDoc(doc(context.firestore(), stagePath), { state: "ready" }),
  );
  for (const actor of ["teacher", "admin"])
    await check(`${actor}: published protected asset read allowed`, () =>
      assertSucceeds(getMetadata(ref(clients[actor].storage, objectPath))),
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
    await check(`${actor}: protected asset read/write denied`, async () => {
      await assertFails(getMetadata(ref(clients[actor].storage, objectPath)));
      await assertFails(
        uploadBytes(
          ref(clients[actor].storage, objectPath),
          new Uint8Array(1),
          objectMetadata,
        ),
      );
    });
  await check("published asset cannot be overwritten", () =>
    assertFails(
      uploadBytes(
        ref(clients.teacher.storage, objectPath),
        new Uint8Array(1),
        objectMetadata,
      ),
    ),
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
  rmSync(tempFile, { force: true });
  delete globalThis.__writtenExamStore;
}
