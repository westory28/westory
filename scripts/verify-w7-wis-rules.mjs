import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertFails, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from "firebase/firestore";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w7";
assert.equal(projectId, "demo-westory-session-w7");
assert.notEqual(projectId, "history-quiz-yongsin");
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const authTime = Math.floor(Date.now() / 1000) - 5;
const uid = "w7-rules-student";
const canonical = [
  "semester_wis_economies",
  "semester_wis_accounts",
  "semester_wis_ledger",
  "semester_wis_balances",
  "semester_wis_rankings",
  "wis_product_catalog",
  "semester_wis_inventory",
  "semester_wis_orders",
  "semester_wis_reconciliation_reports",
  "wis_legacy_issues",
];
const legacy = [
  "years/2026/semesters/2/point_wallets/student",
  "years/2026/semesters/2/point_transactions/tx",
  "years/2026/semesters/2/point_products/product",
  "years/2026/semesters/2/point_orders/order",
  "years/2026/semesters/2/point_policies/current",
];
const session = {
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "7".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
};
const env = await initializeTestEnvironment({ projectId, firestore: { host: "127.0.0.1", port: 8080, rules } });
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "users", uid), { role: "student" }),
      setDoc(doc(db, "application_sessions", uid, "sessions", String(authTime)), session),
      ...canonical.map((name) => setDoc(doc(db, name, "seed"), { studentUid: uid, semesterId: "2026-2" })),
      ...legacy.map((path) => setDoc(doc(db, path), { uid, studentUid: uid })),
    ]);
  });
  const student = env.authenticatedContext(uid, { email: "w7-rules@yongshin-ms.ms.kr", auth_time: authTime }).firestore();
  const admin = env.authenticatedContext("w7-admin", { email: "westoria28@gmail.com", auth_time: authTime }).firestore();
  const anonymous = env.unauthenticatedContext().firestore();
  let denied = 0;
  for (const db of [student, admin, anonymous]) {
    for (const name of canonical) {
      await assertFails(getDoc(doc(db, name, "seed")));
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name, "create"), { marker: true }));
      await assertFails(updateDoc(doc(db, name, "seed"), { marker: true }));
      await assertFails(deleteDoc(doc(db, name, "seed")));
      denied += 5;
    }
  }
  for (const db of [student, admin]) {
    for (const path of legacy) {
      await assertFails(setDoc(doc(db, `${path}-create`), { marker: true }));
      await assertFails(updateDoc(doc(db, path), { marker: true }));
      await assertFails(deleteDoc(doc(db, path)));
      denied += 3;
    }
  }
  console.log(JSON.stringify({ suite: "w7-wis-rules", passed: true, cases: 7, deniedOperations: denied, productionAccess: 0 }));
} finally {
  await env.cleanup();
}
