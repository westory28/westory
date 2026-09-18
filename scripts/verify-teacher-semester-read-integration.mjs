import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import w8 from "../functions/w8Domains.js";
import wis from "../functions/wisEconomy.js";
import enrollment from "../functions/archiveEnrollment.js";
import assessment from "../functions/assessmentLifecycle.js";

// Exercise the real frontend query adapters against the real callable cores.
// The only replaced boundary is Firebase transport and its synthetic data store.
const output = join(mkdtempSync(join(tmpdir(), "westory-semester-read-integration-")), "queries.mjs");
await build({
  stdin: {
    contents: `export { getW8DomainState } from './src/lib/w8Domains';
      export { getWisEconomyState } from './src/lib/wisEconomy';
      export { loadTeacherSemesterRoster } from './src/lib/teacherSemesterRoster';
      export { getAssessmentState } from './src/lib/assessmentLifecycle';`,
    resolveDir: process.cwd(), loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", outfile: output,
  plugins: [{
    name: "synthetic-firebase-transport",
    setup(plugin) {
      plugin.onResolve({ filter: /^(\.\/firebase|\.\/commandGateway|\.\/stepUpReauth|firebase\/firestore)$/ }, args => ({ path: args.path, namespace: "synthetic" }));
      plugin.onLoad({ filter: /.*/, namespace: "synthetic" }, args => ({ contents:
        args.path === "./firebase"
          ? `export const db = {}; export const getHttpsCallable = async name => async data => ({ data: await globalThis.__semesterReadCall(name, data) });`
          : args.path === "firebase/firestore"
            ? `export const collection = (...args) => args; export const getDocs = async () => { throw new Error('Historical roster must not read current users'); };`
            : args.path === "./commandGateway"
              ? `export const executeWestoryCommand = async () => { throw new Error('Read issued a command'); };`
              : `export const requestStepUpReauthentication = async () => { throw new Error('Read requested high-risk reauthentication'); };`,
      }));
    },
  }],
});
const frontend = await import(pathToFileURL(output));
const documents = new Map(Object.entries({
  "site_settings/semester_active": { semesterId: "2026-2", revision: 2 },
  "semester_manifests/2026-1": { semesterId: "2026-1", status: "ARCHIVED", revision: 3 },
  "semester_manifests/2026-2": { semesterId: "2026-2", status: "ACTIVE", revision: 2 },
  "users/teacher": { role: "teacher", teacherPortalEnabled: true, staffPermissions: ["lesson_read", "point_manage", "student_list_read"] },
  "users/student": { role: "student", name: "현재 이름", grade: "3", class: "9", number: "99" },
  "semester_classes/past-class": { classId: "past-class", semesterId: "2026-1", status: "CLOSED", grade: "2", classNumber: "1", homeroomTeacherUid: "teacher" },
  "semester_enrollments/past-enrollment": { enrollmentId: "past-enrollment", studentUid: "student", semesterId: "2026-1", classId: "past-class", enrollmentStatus: "COMPLETED", studentNumber: "7", snapshot: { displayName: "과거 이름", grade: "2", classNumber: "1", studentNumber: "7" } },
  "semester_enrollments/current-enrollment": { enrollmentId: "current-enrollment", studentUid: "student", semesterId: "2026-2", classId: "current-class", enrollmentStatus: "ACTIVE", snapshot: { displayName: "현재 이름", grade: "3", classNumber: "9", studentNumber: "99" } },
  "semester_learning_contents/past-lesson": { contentId: "past-lesson", semesterId: "2026-1", title: "과거 수업", status: "PUBLISHED", revision: 1 },
  "semester_learning_contents/current-lesson": { contentId: "current-lesson", semesterId: "2026-2", title: "현재 수업", status: "PUBLISHED", revision: 1 },
  "semester_schedule_events/past-event": { eventId: "past-event", semesterId: "2026-1", title: "과거 일정", status: "PUBLISHED", revision: 1 },
  "semester_schedule_events/current-event": { eventId: "current-event", semesterId: "2026-2", title: "현재 일정", status: "PUBLISHED", revision: 1 },
  "semester_wis_economies/2026-1": { semesterId: "2026-1", status: "CLOSED", revision: 1 },
  "semester_wis_accounts/past-account": { accountId: "past-account", semesterId: "2026-1", studentUid: "student", displayName: "과거 이름", grade: "2", classNumber: "1", studentNumber: "7", balance: 80 },
  "semester_wis_accounts/current-account": { accountId: "current-account", semesterId: "2026-2", studentUid: "student", displayName: "현재 이름", balance: 900 },
  "semester_assessment_definitions/past-quiz": { definitionId: "past-quiz", semesterId: "2026-1", assessmentKind: "QUIZ", title: "과거 퀴즈", status: "CLOSED", revision: 1 },
  "semester_assessment_definitions/past-classroom": { definitionId: "past-classroom", semesterId: "2026-1", assessmentKind: "HISTORY_CLASSROOM", title: "과거 역사교실", status: "CLOSED", revision: 1 },
}));
const readPaths = [];
const snapshot = path => ({ path, exists: documents.has(path), data: structuredClone(documents.get(path) || null) });
const store = {
  get: async path => { readPaths.push(path); return snapshot(path); },
  getAll: async paths => Promise.all(paths.map(path => store.get(path))),
  query: async (collection, spec = null) => {
    const filters = spec?.filters || (spec?.field ? [spec] : []);
    const prefix = `${collection}/`;
    let rows = [...documents.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(snapshot).filter(row => filters.every(filter => {
        if (filter.operator === "==") return row.data[filter.field] === filter.value;
        if (filter.operator === "in") return filter.value.includes(row.data[filter.field]);
        throw new Error(`Unsupported test filter: ${filter.operator}`);
      }));
    if (spec?.limit) rows = rows.slice(0, spec.limit);
    readPaths.push(...rows.map(row => row.path));
    return rows;
  },
  runTransaction: callback => callback(store),
  set: () => assert.fail("Read changed data"),
  create: () => assert.fail("Read created data"),
  update: () => assert.fail("Read changed data"),
  delete: () => assert.fail("Read deleted data"),
};
const assertSession = async request => ({ uid: request.auth.uid, email: request.auth.token.email });
const cores = {
  ...w8.createW8QueryCore({ store, assertSession }),
  ...wis.createWisQueryCore({ store, assertSession }),
  ...enrollment.createArchiveEnrollmentQueryCore({ store, assertSession }),
  ...assessment.createAssessmentQueryCore({ store, assertSession }),
};
const requests = [];
let actorUid = "teacher";
globalThis.__semesterReadCall = async (name, data) => {
  requests.push({ name, data: structuredClone(data) });
  assert.ok(cores[name], `Unexpected callable: ${name}`);
  return cores[name]({ auth: { uid: actorUid, token: { email: `${actorUid}@yongshin-ms.ms.kr` } }, data });
};
const pastConfig = { year: "2026", semester: "1", teacherViewOnly: true };
const before = JSON.stringify([...documents]);
for (const [domain, field, expected] of [
  ["LEARNING", "learningContents", "past-lesson"],
  ["SCHEDULE", "scheduleEvents", "past-event"],
]) {
  const result = await frontend.getW8DomainState({ config: pastConfig, audience: "teacher", domain, source: "CURRENT" });
  assert.equal(result.semesterId, "2026-1");
  assert.equal(result.source, "EXPLICIT");
  assert.equal(result.readOnly, true);
  assert.equal(result[field].length, 1);
  assert.equal(result[field][0].contentId || result[field][0].eventId, expected);
}
const wisState = await frontend.getWisEconomyState({ config: pastConfig, audience: "teacher", projection: "overview" });
assert.equal(wisState.readOnly, true);
assert.equal(wisState.provenance, "EXPLICIT");
assert.equal(wisState.accounts.length, 1);
assert.equal(wisState.accounts[0].displayName, "과거 이름");
assert.equal(wisState.accounts[0].balance, 80);
const roster = await frontend.loadTeacherSemesterRoster(pastConfig);
assert.equal(roster.length, 1);
assert.deepEqual([roster[0].name, roster[0].grade, roster[0].class, roster[0].number], ["과거 이름", "2", "1", "7"]);
for (const definitionId of ["past-quiz", "past-classroom"]) {
  const result = await frontend.getAssessmentState({ definitionId });
  assert.equal(result.status, "ARCHIVED");
  assert.equal(result.definition.semesterId, "2026-1");
  assert.equal(result.writeCount, 0);
}
assert.ok(!readPaths.includes("users/student"), "Historical teacher reads must not borrow the current student profile");
assert.equal(JSON.stringify([...documents]), before);
actorUid = "student";
await assert.rejects(() => frontend.getW8DomainState({ config: pastConfig, audience: "student", domain: "LEARNING" }));
await assert.rejects(() => frontend.loadTeacherSemesterRoster(pastConfig));
await assert.rejects(() => frontend.getAssessmentState({ definitionId: "past-quiz" }));
assert.equal(JSON.stringify([...documents]), before);
console.log(JSON.stringify({ passed: true, frontendBackendContracts: 6, pastSemesterScope: "2026-1", currentStudentProfilesRead: 0, studentPastReadDenials: 3, writes: 0, productionAccess: 0, callables: [...new Set(requests.map(item => item.name))] }));
