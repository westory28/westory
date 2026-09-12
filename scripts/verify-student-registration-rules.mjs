import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, getDoc, deleteField, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const projectId = "demo-westory-registration";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
assert.equal(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "127.0.0.1:9199");
const env = await initializeTestEnvironment({ projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules: readFileSync("firestore.rules", "utf8") },
  storage: { host: "127.0.0.1", port: 9199, rules: readFileSync("storage.rules", "utf8") } });
const now = Date.now(), authTime = Math.floor(now / 1000) - 5;
const bucket = `gs://${projectId}.appspot.com`;
const identities = ["new", "legacy", "teacher"].map(uid => ({ uid, email: `${uid}@yongshin-ms.ms.kr` }));
let checks = 0;
const pass = async promise => { await assertSucceeds(promise); checks++; };
const deny = async promise => { await assertFails(promise); checks++; };
try {
  await env.clearFirestore(); await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const user of identities) {
      await setDoc(doc(db, `application_sessions/${user.uid}/sessions/${authTime}`), {
        uid: user.uid, email: user.email, authTime, status: "active", schemaVersion: 2,
        authorityGeneration: "w1r2-2026-08-09", protocolVersion: 2, sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE",
        generalExpiresAt: Timestamp.fromMillis(now + 1800000), highRiskExpiresAt: Timestamp.fromMillis(now + 900000),
      });
      if (user.uid !== "new") await setDoc(doc(db, `users/${user.uid}`), { ...user, role: user.uid === "teacher" ? "teacher" : "student" });
    }
    for (const id of ["config", "menu_config", "consent"]) await setDoc(doc(db, `site_settings/${id}`), { test: true });
    await setDoc(doc(db, "site_settings/config"), { year: "2026", semester: "2" });
    await setDoc(doc(db, "site_settings/semester_active"), { semesterId: "2026-2", revision: 4 });
    await setDoc(doc(db, "semester_manifests/2026-2"), { semesterId: "2026-2", status: "ACTIVE", revision: 4 });
    await setDoc(doc(db, "site_settings/consent/items/one"), { title: "동의" });
    await setDoc(doc(db, "years/2026/semesters/2/lessons/registration-test"), { title: "합성 수업" });
    await uploadBytes(ref(ctx.storage(bucket), "lesson_pdfs/registration/test.pdf"), new Uint8Array([37,80,68,70]), { contentType: "application/pdf" });
  });
  const contexts = identities.map(user => env.authenticatedContext(user.uid, { email: user.email, auth_time: authTime }));
  const db = contexts[0].firestore(), storage = contexts[0].storage(bucket), userRef = doc(db, "users/new");
  const lesson = doc(db, "years/2026/semesters/2/lessons/registration-test"), file = ref(storage, "lesson_pdfs/registration/test.pdf");
  await deny(getDoc(lesson)); await deny(getBytes(file)); await pass(getDoc(userRef));
  for (const id of ["config", "menu_config", "consent"]) await pass(getDoc(doc(db, `site_settings/${id}`)));
  await pass(getDoc(doc(db, "site_settings/consent/items/one")));
  const profile = { ...identities[0], role: "student", customNameConfirmed: true, name: "학생", grade: "1", class: "1", number: "1" };
  await deny(setDoc(userRef, profile));
  await deny(setDoc(userRef, { ...profile, registrationApprovalStatus: "APPROVED" }));
  await pass(setDoc(userRef, { ...profile, registrationApprovalStatus: "PENDING" }));
  await pass(getDoc(userRef)); await deny(getDoc(lesson)); await deny(getBytes(file));
  await pass(updateDoc(userRef, { photoURL: "", lastLogin: Timestamp.now() }));
  await deny(updateDoc(userRef, { registrationApprovalStatus: "APPROVED" }));
  await deny(updateDoc(userRef, { registrationApprovalStatus: deleteField() }));
  await deny(updateDoc(userRef, { role: "teacher" }));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/new"), { registrationApprovalStatus: "APPROVED_PENDING_ACCOUNT" }));
  await deny(getDoc(lesson)); await deny(getBytes(file));
  await env.withSecurityRulesDisabled(ctx => updateDoc(doc(ctx.firestore(), "users/new"), { registrationApprovalStatus: "APPROVED" }));
  await pass(getDoc(lesson)); await pass(getBytes(file));
  for (const ctx of contexts.slice(1)) { await pass(getDoc(doc(ctx.firestore(), "years/2026/semesters/2/lessons/registration-test"))); await pass(getBytes(ref(ctx.storage(bucket), "lesson_pdfs/registration/test.pdf"))); }
  console.log(JSON.stringify({ passed: true, checks, projectId, productionAccess: 0 }));
} finally { await env.cleanup(); }
