import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, where } from "firebase/firestore";

const projectId = "demo-westory-content-semester-rules";
const port = Number(process.env.CONTENT_RULES_FIRESTORE_PORT || 8080);
const authTime = Math.floor(Date.now() / 1000) - 10;
const first = "years/2026/semesters/1";
const second = "years/2026/semesters/2";
let checks = 0;
const succeeds = async operation => { await assertSucceeds(operation); checks++; };
const fails = async operation => { await assertFails(operation); checks++; };
for (const filename of ["firestore.rules", "firestore.staging.rules"]) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port, rules: readFileSync(filename, "utf8") },
  });
  try {
    await env.clearFirestore();
    const profiles = {
      student: { role: "student", email: "student@yongshin-ms.ms.kr" },
      other: { role: "student", email: "other@yongshin-ms.ms.kr" },
      teacher: { role: "teacher", email: "teacher@yongshin-ms.ms.kr" },
      staff: { role: "staff", email: "staff@yongshin-ms.ms.kr", teacherPortalEnabled: true, staffPermissions: [] },
      admin: { role: "teacher", email: "westoria28@gmail.com" },
    };
    const rows = {
      "curriculum/tree": { tree: [] },
      "lessons/unit": { unitId: "unit", isVisibleToStudents: true },
      "quiz_questions/question": { unitId: "unit" },
      "history_classrooms/classroom": { targetStudentUid: "student" },
      "history_classroom_results/result": { uid: "student" },
      "history_classroom_exemptions/exemption": { uid: "student" },
      "history_classroom_exemption_requests/request": { uid: "student" },
      "assessment_config/settings": {},
      "grading_plans/plan": {},
      "quiz_results/result": { uid: "student" },
      "quiz_submissions/submission": { uid: "student" },
      "lesson_progress/student": {},
      "lesson_progress/student/units/unit": {},
      "history_dictionary_terms/term": { title: "학기 단어" },
      "history_dictionary_requests/request": { uid: "student" },
      "dictionary_students/student/history_dictionary_words/word": { uid: "student" },
    };
    const maintenance = {
      enabled: false, blockedRoles: ["student"], bypassUids: [], title: "점검", message: "확인 중입니다.",
      startedAt: null, updatedAt: Timestamp.now(), updatedBy: "admin", revision: 1,
    };
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "site_settings/config"), { year: "2026", semester: "2" });
      await setDoc(doc(db, "site_settings/semester_active"), { semesterId: "2026-2", revision: 4 });
      await setDoc(doc(db, "semester_manifests/2026-2"), { semesterId: "2026-2", status: "ACTIVE", revision: 4 });
      await setDoc(doc(db, "semester_manifests/2026-1"), { semesterId: "2026-1", status: "ARCHIVED", revision: 8 });
      await setDoc(doc(db, "site_settings/student_maintenance"), maintenance);
      for (const [uid, profile] of Object.entries(profiles)) {
        await setDoc(doc(db, `users/${uid}`), { ...profile, uid, registrationApprovalStatus: "APPROVED" });
        await setDoc(doc(db, `application_sessions/${uid}/sessions/${authTime}`), {
          status: "active", authTime, schemaVersion: 2, authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2, sessionRevision: "a".repeat(64), authorityModeAtOpen: "ENFORCE",
          generalExpiresAt: Timestamp.fromMillis(Date.now() + 600000), highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 600000),
        });
      }
      for (const [path, data] of Object.entries(rows)) {
        await setDoc(doc(db, `${first}/${path}`), data);
        await setDoc(doc(db, `${second}/${path}`), data);
        if (!path.startsWith("dictionary_students/")) await setDoc(doc(db, path), data);
      }
      await setDoc(doc(db, "users/student/history_dictionary_words/word"), { uid: "student" });
      for (const id of ["2026_1", "2026_2", "malformed"]) {
        await setDoc(doc(db, `users/student/academic_records/${id}`), { scores: { plan_0: "10" } });
      }
      await setDoc(doc(db, "users/student/performance_scores/current"), { academicYear: "2026", semester: "2" });
      await setDoc(doc(db, "users/student/performance_scores/prior"), { academicYear: "2026", semester: "1" });
      await setDoc(doc(db, "users/student/performance_scores/unscoped"), {});
      for (const id of ["current", "prior"]) await setDoc(doc(db, `users/student/performance_scores/${id}/confirmations/one`), {});
    });
    const clients = Object.fromEntries(Object.entries(profiles).map(([uid, profile]) => [uid, env.authenticatedContext(uid, { email: profile.email, auth_time: authTime }).firestore()]));
    for (const path of Object.keys(rows)) {
      await succeeds(getDoc(doc(clients.student, `${second}/${path}`)));
      await fails(getDoc(doc(clients.student, `${first}/${path}`)));
      await fails(getDoc(doc(clients.teacher, `${first}/${path}`)));
      await fails(getDoc(doc(clients.admin, `${first}/${path}`)));
      if (!path.startsWith("dictionary_students/")) await fails(getDoc(doc(clients.student, path)));
    }
    await succeeds(getDocs(collection(clients.student, `${second}/lessons`)));
    await succeeds(getDocs(collection(clients.student, `${second}/curriculum`)));
    await succeeds(getDocs(collection(clients.student, `${second}/history_dictionary_terms`)));
    await succeeds(getDocs(collection(clients.student, `${second}/dictionary_students/student/history_dictionary_words`)));
    await succeeds(getDocs(query(collection(clients.student, `${second}/history_dictionary_requests`), where("uid", "==", "student"))));
    await fails(getDocs(collection(clients.student, `${first}/lessons`)));
    await fails(getDocs(collection(clients.teacher, "lessons")));
    await fails(getDoc(doc(clients.student, "users/student/history_dictionary_words/word")));
    await fails(getDocs(query(collectionGroup(clients.student, "history_dictionary_words"), where("uid", "==", "student"))));
    await fails(getDocs(collectionGroup(clients.admin, "history_dictionary_words")));
    await fails(getDoc(doc(clients.other, `${second}/dictionary_students/student/history_dictionary_words/word`)));
    await fails(getDoc(doc(clients.staff, `${second}/history_classrooms/classroom`)));
    await fails(getDoc(doc(clients.staff, `${second}/dictionary_students/student/history_dictionary_words/word`)));
    await succeeds(getDoc(doc(clients.teacher, `${second}/lessons/unit`)));
    await succeeds(getDoc(doc(clients.admin, `${second}/lessons/unit`)));
    const currentAcademic = "users/student/academic_records/2026_2";
    const priorAcademic = "users/student/academic_records/2026_1";
    await succeeds(getDoc(doc(clients.student, currentAcademic)));
    await succeeds(setDoc(doc(clients.student, currentAcademic), { scores: { plan_0: "11" } }));
    await succeeds(deleteDoc(doc(clients.student, currentAcademic)));
    await succeeds(setDoc(doc(clients.student, currentAcademic), { scores: { plan_0: "12" } }));
    for (const path of [priorAcademic, "users/student/academic_records/malformed"]) {
      await fails(getDoc(doc(clients.student, path)));
      await fails(setDoc(doc(clients.student, path), { scores: {} }));
      await fails(deleteDoc(doc(clients.student, path)));
    }
    await fails(getDocs(collection(clients.student, "users/student/academic_records")));
    await fails(getDoc(doc(clients.other, currentAcademic)));
    await fails(setDoc(doc(clients.other, currentAcademic), { scores: {} }));
    await fails(deleteDoc(doc(clients.other, currentAcademic)));
    await fails(getDoc(doc(clients.teacher, priorAcademic)));
    await succeeds(getDoc(doc(clients.admin, priorAcademic)));
    await succeeds(getDoc(doc(clients.admin, currentAcademic)));
    await succeeds(deleteDoc(doc(clients.admin, priorAcademic)));
    await fails(setDoc(doc(clients.admin, currentAcademic), { scores: {} }));
    await succeeds(getDoc(doc(clients.student, "users/student/performance_scores/current")));
    await succeeds(getDocs(query(collection(clients.student, "users/student/performance_scores"), where("academicYear", "==", "2026"), where("semester", "==", "2"))));
    await succeeds(getDoc(doc(clients.student, "users/student/performance_scores/current/confirmations/one")));
    await fails(getDoc(doc(clients.student, "users/student/performance_scores/prior")));
    await fails(getDoc(doc(clients.student, "users/student/performance_scores/unscoped")));
    await fails(getDoc(doc(clients.student, "users/student/performance_scores/prior/confirmations/one")));
    await fails(getDocs(collection(clients.student, "users/student/performance_scores")));
    await fails(setDoc(doc(clients.teacher, `${second}/lessons/unit`), { title: "직접 쓰기" }));
    await succeeds(setDoc(doc(clients.teacher, `${second}/assessment_config/extra`), { note: "기존 현재 학기 권한" }));
    await fails(setDoc(doc(clients.admin, `${first}/assessment_config/extra`), {}));

    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "site_settings/student_maintenance"), {
      ...maintenance, enabled: true, startedAt: Timestamp.now(),
    }));
    await fails(getDoc(doc(clients.student, `${second}/lessons/unit`)));
    await succeeds(getDoc(doc(clients.teacher, `${second}/lessons/unit`)));
    await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), "site_settings/student_maintenance"), maintenance));

    // Missing, inconsistent or inactive authority must deny even administrators.
    for (const [path, value] of [
      ["site_settings/config", null],
      ["site_settings/config", { year: "2026", semester: "1" }],
      ["site_settings/semester_active", null],
      ["site_settings/semester_active", { semesterId: "2026-2", revision: 99 }],
      ["semester_manifests/2026-2", { semesterId: "2026-2", revision: 4, status: "READY" }],
    ]) {
      await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        await setDoc(doc(db, "site_settings/config"), { year: "2026", semester: "2" });
        await setDoc(doc(db, "site_settings/semester_active"), { semesterId: "2026-2", revision: 4 });
        await setDoc(doc(db, "semester_manifests/2026-2"), { semesterId: "2026-2", revision: 4, status: "ACTIVE" });
        if (value === null) await deleteDoc(doc(db, path)); else await setDoc(doc(db, path), value);
      });
      await fails(getDoc(doc(clients.student, currentAcademic)));
      await fails(setDoc(doc(clients.student, currentAcademic), { scores: {} }));
      await fails(deleteDoc(doc(clients.student, currentAcademic)));
      await fails(getDoc(doc(clients.student, `${second}/lessons/unit`)));
      await fails(getDoc(doc(clients.admin, `${second}/lessons/unit`)));
    }
    assert.ok(checks > 100);
  } finally {
    await env.cleanup();
  }
}
console.log(JSON.stringify({ passed: true, checks, projectId, productionAccess: false, variants: ["production", "staging"] }));
