import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import * as firestore from "firebase/firestore";
const require = createRequire(import.meta.url);
const {
  doc,
  collection,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
  setLogLevel,
} = firestore;
const { build } = require("esbuild");
const projectId = "demo-westory-rhythm";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:18231");
setLogLevel("silent");
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18231,
    rules: readFileSync("firestore.rules", "utf8"),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 30;
const scope = { year: "2026", semester: "2" };
const base = "years/2026/semesters/2";
const publicationPath = `${base}/rhythm_publication/gungdeok-rock`;
const auditPath = `${base}/rhythm_publication_audit/gungdeok-rock`;
const clients = {};
const privileged = (fn) =>
  env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
const denied = (operation) =>
  assert.rejects(operation, { code: "permission-denied" });
const roles = {
  admin: "teacher",
  teacher: "teacher",
  staff: "staff",
  "staff-denied": "staff",
  student: "student",
  transferred: "student",
  disabled: "student",
  deleted: "student",
  pending: "student",
  expired: "student",
  "no-session": "student",
  outsider: "student",
};
const publish = (db, enabled, revision, extra = {}) => {
  const batch = writeBatch(db);
  const value = {
    schemaVersion: 1,
    enabled,
    revision,
    updatedAt: serverTimestamp(),
    ...extra,
  };
  batch.set(doc(db, publicationPath), value);
  batch.set(doc(db, auditPath), { ...value, updatedBy: "teacher" });
  return batch.commit();
};
const report = { cases: [], transactions: {} };
const ok = (label) => report.cases.push(label);
try {
  await env.clearFirestore();
  await privileged(async (db) => {
    await setDoc(doc(db, "site_settings/config"), {
      ...scope,
      studentMenuVisibility: { weplay: true, rhythm: true },
    });
    await setDoc(doc(db, "site_settings/semester_active"), {
      semesterId: "2026-2",
      revision: 1,
    });
    await setDoc(doc(db, "semester_manifests/2026-2"), {
      status: "ACTIVE",
      revision: 1,
    });
    for (const [uid, role] of Object.entries(roles)) {
      clients[uid] = env
        .authenticatedContext(uid, {
          email:
            uid === "admin"
              ? "westoria28@gmail.com"
              : `${uid}@${uid === "outsider" ? "example.com" : "yongshin-ms.ms.kr"}`,
          auth_time: authTime,
        })
        .firestore();
      await setDoc(doc(db, `users/${uid}`), {
        role,
        registrationApprovalStatus: uid === "pending" ? "PENDING" : "APPROVED",
        teacherPortalEnabled: true,
        staffPermissions: uid === "staff" ? ["lesson_read"] : [],
        enrollmentStatus: uid === "transferred" ? "transferred" : "active",
        disabled: uid === "disabled",
        isDeleted: uid === "deleted",
      });
      if (uid !== "no-session")
        await setDoc(
          doc(db, `application_sessions/${uid}/sessions/${authTime}`),
          {
            schemaVersion: 2,
            status: "active",
            authTime,
            authorityGeneration: "w1r2-2026-08-09",
            protocolVersion: 2,
            sessionRevision: "a".repeat(64),
            authorityModeAtOpen: "ENFORCE",
            generalExpiresAt: Timestamp.fromMillis(
              Date.now() + (uid === "expired" ? -10000 : 3600000),
            ),
          },
        );
    }
  });
  clients.anon = env.unauthenticatedContext().firestore();
  for (const actor of ["admin", "teacher", "staff", "student"])
    assert.equal(
      (await getDocFromServer(doc(clients[actor], publicationPath))).exists(),
      false,
    );
  ok("Missing document is readable for eligible roles and stays closed");
  for (const actor of [
    "staff-denied",
    "transferred",
    "disabled",
    "deleted",
    "pending",
    "expired",
    "no-session",
    "outsider",
    "anon",
  ])
    await denied(getDocFromServer(doc(clients[actor], publicationPath)));
  ok("Ineligible roles, accounts, school identities and sessions cannot read");
  for (const actor of ["student", "staff", "staff-denied"])
    await denied(publish(clients[actor], true, 1));
  await denied(
    setDoc(doc(clients.teacher, publicationPath), {
      schemaVersion: 1,
      enabled: true,
      revision: 1,
      updatedAt: serverTimestamp(),
    }),
  );
  ok("Student/staff writes and publication without audit are denied");
  await publish(clients.teacher, true, 1);
  for (const actor of ["admin", "teacher", "staff", "student"])
    assert.equal(
      (await getDocFromServer(doc(clients[actor], publicationPath))).data()
        .enabled,
      true,
    );
  await denied(getDocFromServer(doc(clients.student, auditPath)));
  assert.equal(
    (await getDocFromServer(doc(clients.staff, auditPath))).data().updatedBy,
    "teacher",
  );
  ok(
    "Teacher publishes; public record contains no actor UID; audit is teacher-only",
  );
  for (const actor of ["admin", "teacher", "student"]) {
    await denied(
      getDocsFromServer(
        collection(clients[actor], `${base}/rhythm_publication`),
      ),
    );
    await denied(deleteDoc(doc(clients[actor], publicationPath)));
    await denied(
      getDocFromServer(
        doc(clients[actor], `${base}/rhythm_publication/other-game`),
      ),
    );
    await denied(
      getDocFromServer(
        doc(
          clients[actor],
          "years/2026/semesters/1/rhythm_publication/gungdeok-rock",
        ),
      ),
    );
  }
  ok("List/delete, other game and other semester denied, including teachers");
  await denied(publish(clients.teacher, false, 1));
  await denied(publish(clients.teacher, true, 2));
  await denied(publish(clients.teacher, false, 2, { unsafe: true }));
  await denied(
    publish(clients.teacher, false, 2, { updatedAt: Timestamp.fromMillis(0) }),
  );
  await denied(
    setDoc(doc(clients.teacher, auditPath), {
      schemaVersion: 1,
      enabled: true,
      revision: 1,
      updatedAt: serverTimestamp(),
      updatedBy: "teacher",
    }),
  );
  ok(
    "Revision replay, no-change write, extra fields, false timestamp and audit-only rewrite denied",
  );

  for (const blocked of ["weplay", "rhythm"]) {
    await privileged((db) =>
      updateDoc(doc(db, "site_settings/config"), {
        [`studentMenuVisibility.${blocked}`]: false,
      }),
    );
    await denied(getDocFromServer(doc(clients.student, publicationPath)));
    await getDocFromServer(doc(clients.teacher, publicationPath));
    await privileged((db) =>
      updateDoc(doc(db, "site_settings/config"), {
        [`studentMenuVisibility.${blocked}`]: true,
      }),
    );
  }
  await privileged((db) =>
    updateDoc(doc(db, "semester_manifests/2026-2"), { readOnly: true }),
  );
  await denied(getDocFromServer(doc(clients.student, publicationPath)));
  await denied(publish(clients.teacher, false, 2));
  await privileged((db) =>
    updateDoc(doc(db, "semester_manifests/2026-2"), { readOnly: false }),
  );
  ok("Menu closure and read-only semester block access and writes");

  const maintenance = {
    enabled: true,
    blockedRoles: ["student"],
    bypassUids: [],
    title: "점검",
    message: "검증 중",
    startedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    updatedBy: "admin",
    revision: 1,
  };
  await privileged((db) =>
    setDoc(doc(db, "site_settings/student_maintenance"), maintenance),
  );
  await denied(getDocFromServer(doc(clients.student, publicationPath)));
  await getDocFromServer(doc(clients.teacher, publicationPath));
  await privileged((db) =>
    updateDoc(doc(db, "site_settings/student_maintenance"), {
      enabled: false,
      startedAt: null,
      bypassUids: Array.from({ length: 20 }, (_, i) => `bypass-${i}`),
    }),
  );
  await getDocFromServer(doc(clients.student, publicationPath));
  ok(
    "Maintenance closes student access; maximal bypass list stays in rules budget",
  );

  await publish(clients.teacher, false, 2);
  assert.equal(
    (await getDocFromServer(doc(clients.student, publicationPath))).data()
      .enabled,
    false,
  );
  ok("A closed publication is observed by the next entry read");

  // Exercise the shipped adapter with real Firestore transactions, counting
  // document operations rather than claiming these include rules billing reads.
  const output = path.resolve("output/rhythm-publication-20261115");
  mkdirSync(output, { recursive: true });
  globalThis.__rhythmTest = {
    auth: { currentUser: { uid: "teacher" } },
    db: clients.teacher,
    firestore,
    reads: 0,
    writes: 0,
  };
  const bundle = path.join(output, "publication-adapter.mjs");
  await build({
    entryPoints: ["src/lib/rhythmPublication.ts"],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins: [
      {
        name: "emulator-adapter",
        setup(plugin) {
          plugin.onResolve({ filter: /^\.\/firebase$/ }, () => ({
            path: "firebase",
            namespace: "fixture",
          }));
          plugin.onResolve({ filter: /^firebase\/firestore$/ }, () => ({
            path: "firestore",
            namespace: "fixture",
          }));
          plugin.onLoad(
            { filter: /.*/, namespace: "fixture" },
            ({ path: name }) => ({
              contents:
                name === "firebase"
                  ? "export const auth=globalThis.__rhythmTest.auth;export let db=globalThis.__rhythmTest.db;globalThis.__rhythmTest.setDb=value=>{db=value};"
                  : `const sdk=globalThis.__rhythmTest.firestore;export const {doc,serverTimestamp}=sdk;
           export const getDocFromServer=ref=>{globalThis.__rhythmTest.reads++;return sdk.getDocFromServer(ref)};
           export const runTransaction=(db,callback)=>sdk.runTransaction(db,tx=>callback({
             get:ref=>{globalThis.__rhythmTest.reads++;return tx.get(ref)},
             set:(...args)=>{globalThis.__rhythmTest.writes++;return tx.set(...args)}
           }));`,
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  const adapter = await import(pathToFileURL(bundle).href);
  const counters = () => ({
    reads: globalThis.__rhythmTest.reads,
    writes: globalThis.__rhythmTest.writes,
  });
  const resetCounts = () => {
    globalThis.__rhythmTest.reads = 0;
    globalThis.__rhythmTest.writes = 0;
  };
  resetCounts();
  assert.deepEqual(await adapter.saveRhythmPublication(scope, true, 2), {
    enabled: true,
    revision: 3,
  });
  report.transactions.changed = counters();
  assert.deepEqual(counters(), { reads: 1, writes: 2 });
  resetCounts();
  assert.deepEqual(await adapter.saveRhythmPublication(scope, true, 2), {
    enabled: true,
    revision: 3,
  });
  report.transactions.responseLossRetry = counters();
  assert.deepEqual(counters(), { reads: 1, writes: 0 });
  resetCounts();
  await assert.rejects(
    adapter.saveRhythmPublication(scope, false, 1),
    /다른 곳/,
  );
  report.transactions.conflict = counters();
  assert.deepEqual(counters(), { reads: 1, writes: 0 });
  const before = (await getDocFromServer(doc(clients.teacher, publicationPath)))
    .data()
    .updatedAt.toMillis();
  resetCounts();
  await adapter.saveRhythmPublication(scope, true, 3);
  assert.equal(
    (await getDocFromServer(doc(clients.teacher, publicationPath)))
      .data()
      .updatedAt.toMillis(),
    before,
  );
  assert.deepEqual(counters(), { reads: 1, writes: 0 });
  ok(
    "Shipped adapter: changed 1 read/2 writes; no-change/lost-response retry/conflict 1 read/0 writes",
  );
  await assert.rejects(
    adapter.saveRhythmPublication({ year: "", semester: "2" }, false, 3),
    /운영 학기/,
  );
  await assert.rejects(
    adapter.saveRhythmPublication(scope, false, -1),
    /공개 설정/,
  );
  assert.throws(
    () =>
      adapter.parseRhythmPublication({
        schemaVersion: 1,
        enabled: true,
        revision: 1,
      }),
    /공개 설정/,
  );
  ok("Malformed scope, revision and document fail closed");
  globalThis.__rhythmTest.setDb(clients.student);
  resetCounts();
  assert.deepEqual(await adapter.getRhythmPublication(scope), {
    enabled: true,
    revision: 3,
  });
  assert.deepEqual(counters(), { reads: 1, writes: 0 });
  report.transactions.entryRead = counters();
  globalThis.__rhythmTest.setDb(clients.expired);
  resetCounts();
  await denied(adapter.getRhythmPublication(scope));
  assert.deepEqual(counters(), { reads: 1, writes: 0 });
  globalThis.__rhythmTest.setDb(clients.teacher);
  await adapter.saveRhythmPublication(scope, false, 3);
  globalThis.__rhythmTest.setDb(clients.student);
  assert.deepEqual(await adapter.getRhythmPublication(scope), {
    enabled: false,
    revision: 4,
  });
  ok(
    "Entry uses one authoritative read; expired sessions reject and closed publication returns false",
  );
  const menuBundle = path.join(output, "menu-adapter.mjs");
  await build({
    stdin: {
      contents:
        'export * from "./src/constants/menus"; export * from "./src/lib/studentMenuAccess";',
      loader: "ts",
      resolveDir: process.cwd(),
    },
    outfile: menuBundle,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const menu = await import(pathToFileURL(menuBundle).href);
  const config = {
    ...scope,
    showQuiz: true,
    showScore: true,
    showLesson: true,
  };
  const target = { pathname: "/student/weplay", search: "?game=gungdeok-rock" };
  const menus = menu.cloneDefaultMenus();
  assert.equal(menu.getStudentRouteAccess(target, config, menus).allowed, true);
  const hidden = structuredClone(menus);
  hidden.student
    .find((item) => item.url === target.pathname)
    .children.push({
      name: "덩기덕 쿵더Rock",
      url: target.pathname + target.search,
      hidden: true,
    });
  assert.equal(menu.buildStudentMenuVisibility(hidden).rhythm, false);
  assert.equal(
    menu.getStudentRouteAccess(target, config, hidden).allowed,
    false,
  );
  assert.equal(
    menu.getStudentRouteAccess(
      target,
      { ...config, studentMenuVisibility: { rhythm: false } },
      menus,
    ).allowed,
    false,
  );
  assert.equal(
    menu.getStudentRouteAccess(
      target,
      { ...config, studentMenuVisibility: { weplay: false } },
      menus,
    ).allowed,
    false,
  );
  assert.equal(
    menu.getStudentRouteAccess(
      { pathname: target.pathname, search: "?game=not-a-game" },
      config,
      menus,
    ).allowed,
    false,
  );
  const oldMenus = structuredClone(menus);
  const oldGames = oldMenus.student.find(
    (item) => item.url === target.pathname,
  );
  oldGames.children = oldGames.children.filter(
    (item) => item.url !== target.pathname + target.search,
  );
  assert.equal(
    menu
      .sanitizeMenuConfig(oldMenus)
      .student.find((item) => item.url === target.pathname)
      .children.some((item) => item.url === target.pathname + target.search),
    false,
  );
  const visibleChildren = menu
    .getStudentVisibleMenuItems(menus.student, {
      ...config,
      studentMenuVisibility: { rhythm: false },
    })
    .find((item) => item.url === target.pathname).children;
  assert.equal(
    visibleChildren.some(
      (item) => item.url === target.pathname + target.search,
    ),
    false,
  );
  assert.equal(
    menu.getStudentRouteAccess(
      { pathname: target.pathname },
      {
        ...config,
        studentMenuVisibility: { naval: false, yut: false, rhythm: true },
      },
      menus,
    ).allowed,
    true,
  );
  ok(
    "No default sidebar disclosure; projection/direct-link gates preserve parent/child closure and catalog access",
  );
  writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({ passed: report.cases.length, ...report }, null, 2),
  );
} finally {
  await env.cleanup();
  delete globalThis.__rhythmTest;
}
