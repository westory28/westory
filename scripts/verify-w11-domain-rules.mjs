import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w11";
assert.equal(projectId, "demo-westory-session-w11");
assert.notEqual(projectId, "history-quiz-yongsin");

const canonicalCollections = [
  "semester_cutover_plans",
  "semester_cutover_attempts",
  "semester_cutover_evidence",
  "semester_cutover_targets",
];
const nestedItemPath = "semester_cutover_attempts/seed/items/seed-item";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
for (const collectionName of canonicalCollections) {
  assert.match(
    rules,
    new RegExp(`match \\/${collectionName.replaceAll("_", "_")}\\/`, "u"),
    `Rules do not declare ${collectionName}.`,
  );
}

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
});

try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      ...canonicalCollections.map((name) =>
        setDoc(doc(db, name, "seed"), {
          sourceSemesterId: "2026-1",
          targetSemesterId: "2026-2",
          fixtureOwner: "w11-rules",
        }),
      ),
      setDoc(doc(db, nestedItemPath), {
        attemptId: "seed",
        fixtureOwner: "w11-rules",
      }),
    ]);
  });

  const contexts = [
    env
      .authenticatedContext("w11-rules-student", {
        email: "w11-rules-student@yongshin-ms.ms.kr",
      })
      .firestore(),
    env
      .authenticatedContext("w11-rules-teacher", {
        email: "w11-rules-teacher@yongshin-ms.ms.kr",
      })
      .firestore(),
    env
      .authenticatedContext("w11-rules-admin", {
        email: "westoria28@gmail.com",
      })
      .firestore(),
    env.unauthenticatedContext().firestore(),
  ];
  let deniedOperations = 0;
  for (const db of contexts) {
    for (const collectionName of canonicalCollections) {
      await assertFails(getDoc(doc(db, collectionName, "seed")));
      await assertFails(getDocs(collection(db, collectionName)));
      await assertFails(
        setDoc(doc(db, collectionName, "previous-bundle-create"), {
          marker: true,
        }),
      );
      await assertFails(
        updateDoc(doc(db, collectionName, "seed"), { marker: true }),
      );
      await assertFails(deleteDoc(doc(db, collectionName, "seed")));
      deniedOperations += 5;
    }
    await assertFails(getDoc(doc(db, nestedItemPath)));
    await assertFails(
      setDoc(doc(db, "semester_cutover_attempts", "seed", "items", "create"), {
        marker: true,
      }),
    );
    await assertFails(updateDoc(doc(db, nestedItemPath), { marker: true }));
    await assertFails(deleteDoc(doc(db, nestedItemPath)));
    deniedOperations += 4;
  }

  console.log(
    JSON.stringify({
      suite: "w11-domain-rules",
      passed: true,
      canonicalCollections: canonicalCollections.length,
      nestedCollections: 1,
      principals: contexts.length,
      deniedOperations,
      previousBundleDirectSdkDenied: true,
      productionAccess: 0,
      productionWrites: 0,
    }),
  );
} finally {
  await env.cleanup();
}
