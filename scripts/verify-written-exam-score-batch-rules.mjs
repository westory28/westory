// Synthetic Firestore REST batchGet authorization checks. Never targets production.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { createMockUserToken } from "@firebase/util";
import {
  doc,
  setDoc,
  getDocFromServer,
  setLogLevel,
  Timestamp,
} from "firebase/firestore";

const projectId = "demo-westory-written-analysis";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18228");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18228,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
setLogLevel("silent");
const authTime = Math.floor(Date.now() / 1000) - 30;
const prefix = `projects/${projectId}/databases/(default)/documents/`;
const paths = Array.from(
  { length: 284 },
  (_, i) => `users/synthetic-${i}/performance_scores/synthetic-exam`,
);
const token = (uid) =>
  createMockUserToken(
    { sub: uid, email: `${uid}@yongshin-ms.ms.kr`, auth_time: authTime },
    projectId,
  );
let calls = 0;
const readBatch = async (uid, documents) => {
  calls++;
  const response = await fetch(
    `http://127.0.0.1:18228/v1/${prefix.slice(0, -1)}:batchGet`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}),
      },
      body: JSON.stringify({
        documents: documents.map((path) => prefix + path),
        mask: { fieldPaths: ["uid", "items", "academicYear", "semester"] },
      }),
    },
  );
  return { status: response.status, body: await response.json() };
};
const results = [];
const denied = async (uid, documents, forbidden = documents[0]) => {
  const context = uid
    ? env.authenticatedContext(uid, {
        email: `${uid}@yongshin-ms.ms.kr`,
        auth_time: authTime,
      })
    : env.unauthenticatedContext();
  await assert.rejects(
    getDocFromServer(doc(context.firestore(), forbidden)),
    (error) => error.code === "permission-denied",
  );
  const result = await readBatch(uid, documents);
  // The emulator can wrap a denied streaming batch in HTTP/2 PROTOCOL_ERROR.
  // Verify the exact permission decision via SDK above and no batch data below.
  assert.ok(
    result.status === 403 ||
      (result.status === 500 &&
        /PROTOCOL_ERROR/.test(result.body.error?.message || "")),
    JSON.stringify(result.body),
  );
  assert.equal(Array.isArray(result.body), false);
};
const check = async (name, action) => {
  await action();
  results.push(name);
};
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of ["teacher", "student", "expired", "revoked", "pending"]) {
      await setDoc(doc(db, "users", uid), {
        role: uid === "student" ? "student" : "teacher",
        registrationApprovalStatus: uid === "pending" ? "PENDING" : "APPROVED",
        teacherPortalEnabled: true,
      });
      await setDoc(
        doc(db, `application_sessions/${uid}/sessions/${authTime}`),
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
    await Promise.all(
      paths.map((path, i) =>
        setDoc(doc(db, path), {
          uid: `synthetic-${i}`,
          academicYear: "2026",
          semester: "2",
          items: [{ score: i % 5, questionNumber: 1 }],
          feedback: "excluded from objective transport",
          signatureImage: "excluded",
          email: "excluded@example.test",
        }),
      ),
    );
  });
  await check(
    "284 linked documents in three concurrent REST batches retain teacher authorization and field projection",
    async () => {
      const before = calls;
      const batches = await Promise.all(
        [paths.slice(0, 100), paths.slice(100, 200), paths.slice(200)].map(
          (paths) => readBatch("teacher", paths),
        ),
      );
      assert.equal(calls - before, 3);
      const names = new Set();
      for (const response of batches) {
        assert.equal(response.status, 200, JSON.stringify(response.body));
        for (const entry of response.body) {
          assert.ok(entry.found);
          names.add(entry.found.name);
          assert.deepEqual(Object.keys(entry.found.fields).sort(), [
            "academicYear",
            "items",
            "semester",
            "uid",
          ]);
        }
      }
      assert.equal(names.size, 284);
    },
  );
  await check(
    "explicit missing document is represented without dropping other entries",
    async () => {
      const result = await readBatch("teacher", [
        paths[0],
        "users/synthetic-missing/performance_scores/synthetic-exam",
      ]);
      assert.equal(result.status, 200);
      assert.equal(result.body.filter((entry) => entry.found).length, 1);
      assert.equal(result.body.filter((entry) => entry.missing).length, 1);
    },
  );
  for (const uid of ["student", "expired", "revoked", "pending", null])
    await check(
      `${uid || "anonymous"} cannot batch-read other students`,
      async () => {
        await denied(uid, paths.slice(0, 100));
      },
    );
  await check("one forbidden document fails the whole request", async () => {
    await denied(
      "teacher",
      [paths[0], "private_runtime_secrets/synthetic"],
      "private_runtime_secrets/synthetic",
    );
  });
  await check(
    "failed request does not prevent a fresh authorized retry",
    async () => {
      const result = await readBatch("teacher", paths.slice(0, 100));
      assert.equal(result.status, 200);
      assert.equal(result.body.length, 100);
    },
  );
  console.log(
    JSON.stringify(
      {
        passed: results.length,
        checks: results,
        analysisRequestCount: 3,
        documentCount: 284,
        writesDuringAnalysis: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await env.cleanup();
}
