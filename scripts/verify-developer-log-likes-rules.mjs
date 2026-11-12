import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  deleteField,
  doc,
  getDocFromServer,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

// Refuse to run against any real project or a different emulator endpoint.
const projectId = "demo-westory-developer-log-likes";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18220");
setLogLevel("silent");
const baseline = process.argv.includes("--reproduce-baseline");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18220,
    rules: readFileSync(
      process.env.DEVELOPER_LOG_LIKES_RULES_FILE || "firestore.rules",
      "utf8",
    ),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 30;
const paths = [
  "site_settings/developer_logs/items/like-fixture",
  "developer_logs/like-fixture",
];
const roles = {
  "student-a": "student",
  "student-b": "student",
  teacher: "teacher",
  admin: "teacher",
  pending: "student",
  expired: "student",
  revoked: "student",
  missing: "student",
  outsider: "student",
};
const clients = {};
const likeOwners = [...Object.keys(roles), "anon"];
const metrics = {
  transactionAttempts: 0,
  requestedDocumentReads: 0,
  stagedDocumentWrites: 0,
  successfulTransactions: 0,
  committedTransactionWrites: 0,
  directBatchAttempts: 0,
  directBatchStagedWrites: 0,
  successfulDirectBatches: 0,
  committedDirectBatchWrites: 0,
  deniedOperations: 0,
};
let checks = 0;
const privileged = async (fn) => {
  let result;
  await env.withSecurityRulesDisabled(async (context) => {
    result = await fn(context.firestore());
  });
  return result;
};
const sessionPath = (uid) => `application_sessions/${uid}/sessions/${authTime}`;
const basePost = {
  title: "좋아요 규칙 검증",
  bodyHtml: "<p>synthetic fixture</p>",
  category: "notice",
  viewCount: 0,
  likeCount: 0,
};
const setMaintenance = (enabled, bypassCount, includeStudent = false) =>
  privileged((db) =>
    setDoc(doc(db, "site_settings/student_maintenance"), {
      enabled,
      blockedRoles: ["student"],
      bypassUids: Array.from({ length: bypassCount }, (_, index) =>
        includeStudent && index === 0
          ? "student-a"
          : `synthetic-bypass-${index}`,
      ),
      title: "점검",
      message: "검증 중",
      startedAt: enabled ? Timestamp.now() : null,
      updatedAt: Timestamp.now(),
      updatedBy: "synthetic-admin",
      revision: 1,
    }),
  );
const setStudentSessionMode = (authorityModeAtOpen) =>
  privileged(async (db) => {
    for (const uid of ["student-a", "student-b"])
      await updateDoc(doc(db, sessionPath(uid)), { authorityModeAtOpen });
  });
const resetPost = (path) =>
  privileged(async (db) => {
    await setDoc(doc(db, path), basePost);
    for (const uid of likeOwners) await deleteDoc(doc(db, path, "likes", uid));
  });
const snapshot = (path) =>
  privileged(async (db) => ({
    post: (await getDocFromServer(doc(db, path))).data(),
    likes: await Promise.all(
      likeOwners.map(async (uid) => {
        const value = await getDocFromServer(doc(db, path, "likes", uid));
        return [uid, value.exists() ? value.data() : null];
      }),
    ),
  }));
const assertState = async (path, count, likedUsers) => {
  const state = await snapshot(path);
  assert.equal(state.post.likeCount, count);
  assert.deepEqual(
    state.likes
      .filter(([, value]) => value !== null)
      .map(([uid]) => uid)
      .sort(),
    [...likedUsers].sort(),
  );
  checks++;
};
const expectDenied = async (path, label, action) => {
  const observedPaths = Array.isArray(path) ? path : [path];
  const before = await Promise.all(observedPaths.map(snapshot));
  await assert.rejects(action, { code: "permission-denied" }, label);
  assert.deepEqual(
    await Promise.all(observedPaths.map(snapshot)),
    before,
    label + ": no partial writes",
  );
  metrics.deniedOperations++;
  checks++;
};

// Same SDK transaction shape as DeveloperLog.toggleLike: two document reads,
// then an own-like create/delete paired with the exact counter delta.
const toggle = async (uid, path) => {
  const db = clients[uid];
  const postRef = doc(db, path);
  const likeRef = doc(postRef, "likes", uid);
  const result = await runTransaction(db, async (transaction) => {
    metrics.transactionAttempts++;
    metrics.requestedDocumentReads += 2;
    const [post, like] = await Promise.all([
      transaction.get(postRef),
      transaction.get(likeRef),
    ]);
    assert(post.exists());
    const current = Math.max(0, Number(post.data().likeCount || 0));
    if (like.exists()) {
      transaction.delete(likeRef);
      transaction.update(postRef, {
        likeCount: baseline
          ? Math.max(0, current - 1)
          : current > 0
            ? increment(-1)
            : 0,
      });
    } else {
      transaction.set(likeRef, { uid, createdAt: serverTimestamp() });
      transaction.update(postRef, {
        likeCount: baseline ? current + 1 : increment(1),
      });
    }
    metrics.stagedDocumentWrites += 2;
    return !like.exists();
  });
  metrics.successfulTransactions++;
  metrics.committedTransactionWrites += 2;
  return result;
};

// Intentionally performs no get/read. The paired child mutation must enforce
// authorization even when a client sends a batch directly.
const directLikeBatch = async (uid, path, liked, options = {}) => {
  const db = clients[uid];
  const batch = writeBatch(db);
  const likeUid = options.likeUid || uid;
  const likeRef = doc(db, options.likePath || path, "likes", likeUid);
  if (liked) batch.set(likeRef, { uid: likeUid, createdAt: serverTimestamp() });
  else batch.delete(likeRef);
  batch.update(doc(db, path), {
    likeCount: options.count ?? (liked ? 1 : 0),
  });
  metrics.directBatchAttempts++;
  metrics.directBatchStagedWrites += 2;
  await batch.commit();
  metrics.successfulDirectBatches++;
  metrics.committedDirectBatchWrites += 2;
};
const seedLiked = (path, uid) =>
  privileged(async (db) => {
    await setDoc(doc(db, path), { ...basePost, likeCount: 1 });
    await setDoc(doc(db, path, "likes", uid), {
      uid,
      createdAt: Timestamp.now(),
    });
  });

try {
  await env.clearFirestore();
  await privileged(async (db) => {
    for (const [uid, role] of Object.entries(roles)) {
      clients[uid] = env
        .authenticatedContext(uid, {
          email:
            uid === "admin"
              ? "westoria28@gmail.com"
              : uid === "outsider"
                ? "outsider@example.invalid"
                : `${uid}@yongshin-ms.ms.kr`,
          auth_time: authTime,
        })
        .firestore();
      await setDoc(doc(db, "users", uid), {
        role,
        registrationApprovalStatus: uid === "pending" ? "PENDING" : "APPROVED",
        teacherPortalEnabled: role === "teacher",
        staffPermissions: [],
      });
      if (uid !== "missing")
        await setDoc(doc(db, sessionPath(uid)), {
          schemaVersion: 2,
          status: uid === "revoked" ? "revoked" : "active",
          authTime,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
          sessionRevision: "a".repeat(64),
          authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(
            Date.now() + (uid === "expired" ? -10000 : 3600000),
          ),
        });
    }
  });
  clients.anon = env.unauthenticatedContext().firestore();

  if (baseline) {
    await setMaintenance(false, 1);
    for (const path of paths) {
      await resetPost(path);
      const beforeWrites = metrics.stagedDocumentWrites;
      await expectDenied(path, "baseline normal student like", () =>
        toggle("student-a", path),
      );
      assert.equal(metrics.stagedDocumentWrites - beforeWrites, 2);
      console.log(
        `BASELINE reproduced: normal student like commit denied at ${path}; reads completed, 2 writes staged, 0 committed.`,
      );
    }
  } else {
    for (const mode of ["ENFORCE", "OBSERVE_ONLY"]) {
      await setStudentSessionMode(mode);
      for (const bypassCount of [0, 1, 20]) {
        await setMaintenance(false, bypassCount);
        for (const path of paths) {
          await resetPost(path);
          const attemptsBefore = metrics.transactionAttempts;
          const readsBefore = metrics.requestedDocumentReads;
          const writesBefore = metrics.stagedDocumentWrites;
          assert.equal(await toggle("student-a", path), true);
          await assertState(path, 1, ["student-a"]);
          assert.equal(await toggle("student-a", path), false);
          await assertState(path, 0, []);
          for (let repeat = 0; repeat < 2; repeat++) {
            await toggle("student-a", path);
            await toggle("student-a", path);
          }
          await assertState(path, 0, []);
          const attempts = metrics.transactionAttempts - attemptsBefore;
          assert.equal(
            metrics.requestedDocumentReads - readsBefore,
            attempts * 2,
          );
          assert.equal(
            metrics.stagedDocumentWrites - writesBefore,
            attempts * 2,
          );
        }
        console.log(
          `PASS both paths: add/cancel/repeat with ${mode}, maintenance disabled, bypass ${bypassCount}.`,
        );
      }
    }

    await setStudentSessionMode("ENFORCE");
    await setMaintenance(false, 20);
    for (const path of paths) {
      await resetPost(path);
      await Promise.all([toggle("student-a", path), toggle("student-b", path)]);
      await assertState(path, 2, ["student-a", "student-b"]);
      await Promise.all([toggle("student-a", path), toggle("student-b", path)]);
      await assertState(path, 0, []);
      console.log(
        `PASS concurrent students: exact count after add and cancel at ${path}.`,
      );

      const student = clients["student-a"];
      const otherPath = path + "-other";
      await resetPost(otherPath);
      await directLikeBatch("student-a", path, true);
      await assertState(path, 1, ["student-a"]);
      await expectDenied(path, "counter decrement without child deletion", () =>
        updateDoc(doc(student, path), { likeCount: 0 }),
      );
      await directLikeBatch("student-a", path, false);
      await assertState(path, 0, []);
      await expectDenied(path, "counter decrement without own like", () =>
        updateDoc(doc(student, path), { likeCount: -1 }),
      );
      await expectDenied(
        [path, otherPath],
        "different post like creation",
        () => directLikeBatch("student-a", path, true, { likePath: otherPath }),
      );
      await seedLiked(path, "student-a");
      await seedLiked(otherPath, "student-a");
      await expectDenied(
        [path, otherPath],
        "different post like deletion",
        () =>
          directLikeBatch("student-a", path, false, { likePath: otherPath }),
      );
      await resetPost(path);
      await resetPost(otherPath);
      for (const uid of [
        "teacher",
        "admin",
        "pending",
        "expired",
        "revoked",
        "missing",
        "outsider",
        "anon",
      ]) {
        await expectDenied(path, uid + " cannot batch-create own like", () =>
          directLikeBatch(uid, path, true),
        );
        await seedLiked(path, uid);
        await expectDenied(path, uid + " cannot batch-delete own like", () =>
          directLikeBatch(uid, path, false),
        );
        await resetPost(path);
      }
      console.log(
        `PASS read-free batches: add/cancel, invalid actors, cross-post coupling and no partial writes at ${path}.`,
      );

      for (const [label, invalidPatch] of [
        ["non-string bypass UID", { bypassUids: [42] }],
        ["duplicate bypass UID", { bypassUids: ["duplicate", "duplicate"] }],
        [
          "21 bypass UIDs",
          { bypassUids: Array.from({ length: 21 }, (_, i) => `invalid-${i}`) },
        ],
        ["missing required title", { title: deleteField() }],
      ]) {
        await setMaintenance(false, 20);
        await privileged((db) =>
          updateDoc(doc(db, "site_settings/student_maintenance"), invalidPatch),
        );
        await expectDenied(path, label + " blocks direct creation", () =>
          directLikeBatch("student-a", path, true),
        );
        await seedLiked(path, "student-a");
        await expectDenied(path, label + " blocks direct deletion", () =>
          directLikeBatch("student-a", path, false),
        );
        await resetPost(path);
      }
      await setMaintenance(false, 20);
      console.log(
        `PASS malformed maintenance rejects direct add/cancel at ${path}.`,
      );

      await expectDenied(path, "counter without own like", () =>
        updateDoc(doc(student, path), { likeCount: 1 }),
      );
      await expectDenied(path, "counter jump with own like", () => {
        const batch = writeBatch(student);
        batch.set(doc(student, path, "likes", "student-a"), {
          uid: "student-a",
          createdAt: serverTimestamp(),
        });
        batch.update(doc(student, path), { likeCount: 2 });
        return batch.commit();
      });
      await expectDenied(path, "foreign UID like", () => {
        const batch = writeBatch(student);
        batch.set(doc(student, path, "likes", "student-b"), {
          uid: "student-b",
          createdAt: serverTimestamp(),
        });
        batch.update(doc(student, path), { likeCount: 1 });
        return batch.commit();
      });
      await expectDenied(path, "forged body with like", () => {
        const batch = writeBatch(student);
        batch.set(doc(student, path, "likes", "student-a"), {
          uid: "student-a",
          createdAt: serverTimestamp(),
        });
        batch.update(doc(student, path), {
          likeCount: 1,
          bodyHtml: "<p>forged</p>",
        });
        return batch.commit();
      });
      for (const uid of [
        "teacher",
        "admin",
        "pending",
        "expired",
        "revoked",
        "missing",
        "outsider",
      ])
        await expectDenied(path, uid + " cannot like", () => toggle(uid, path));
      await expectDenied(path, "anonymous cannot like", () =>
        updateDoc(doc(clients.anon, path), { likeCount: 1 }),
      );

      await toggle("student-a", path);
      await expectDenied(path, "other student cannot remove like", () => {
        const db = clients["student-b"];
        const batch = writeBatch(db);
        batch.delete(doc(db, path, "likes", "student-a"));
        batch.update(doc(db, path), { likeCount: 0 });
        return batch.commit();
      });
      await expectDenied(path, "own like cannot be rewritten", () =>
        updateDoc(doc(student, path, "likes", "student-a"), {
          createdAt: serverTimestamp(),
        }),
      );
      await toggle("student-a", path);
      await assertState(path, 0, []);

      await updateDoc(doc(student, path), { viewCount: 1 });
      await updateDoc(doc(clients.teacher, path), { viewCount: 2 });
      assert.equal((await snapshot(path)).post.viewCount, 2);
      checks++;
      await expectDenied(path, "view count must increment exactly once", () =>
        updateDoc(doc(student, path), { viewCount: 4 }),
      );
      await updateDoc(doc(clients.admin, path), {
        bodyHtml: "<p>admin edit</p>",
      });
      assert.equal((await snapshot(path)).post.bodyHtml, "<p>admin edit</p>");
      checks++;
      await expectDenied(path, "student cannot edit body", () =>
        updateDoc(doc(student, path), { bodyHtml: "<p>student edit</p>" }),
      );

      await setMaintenance(true, 20);
      await expectDenied(path, "maintenance blocks regular student", () =>
        toggle("student-a", path),
      );
      await expectDenied(
        path,
        "maintenance blocks read-free like creation",
        () => directLikeBatch("student-a", path, true),
      );
      await seedLiked(path, "student-a");
      await expectDenied(
        path,
        "maintenance blocks read-free like deletion",
        () => directLikeBatch("student-a", path, false),
      );
      await resetPost(path);
      await setMaintenance(true, 20, true);
      await toggle("student-a", path);
      await assertState(path, 1, ["student-a"]);
      await toggle("student-a", path);
      await assertState(path, 0, []);
      await expectDenied(path, "maintenance blocks non-bypassed student", () =>
        toggle("student-b", path),
      );
      await setMaintenance(false, 20);
      console.log(
        `PASS ownership, session, registration, maintenance, view and admin edit boundaries at ${path}.`,
      );
    }
  }
  console.log(
    JSON.stringify(
      {
        mode: baseline ? "baseline-reproduced" : "regression-passed",
        checks,
        ...metrics,
        note: "Counts cover the instrumented SDK transaction and direct-like batch flows; rule-internal reads, other attack writes and verification fixture operations are separate. Direct-like batches have no client reads. Only the demo emulator was used.",
      },
      null,
      2,
    ),
  );
} finally {
  await env.cleanup();
}
