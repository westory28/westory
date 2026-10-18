// firebase emulators:exec --only firestore --config firebase.wis-shop-test.json --project demo-westory-wis-shop-archive "node scripts/verify-wis-shop-archive-rules.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";

const projectId = "demo-westory-wis-shop-archive";
assert.equal(
  process.env.GCLOUD_PROJECT,
  projectId,
  "Only the isolated demo project is supported.",
);
assert.equal(
  process.env.FIRESTORE_EMULATOR_HOST,
  "127.0.0.1:18227",
  "The isolated local Firestore emulator is required.",
);
const rulesPath =
  process.env.WIS_SHOP_RULES_PATH ||
  new URL("../firestore.rules", import.meta.url);
const env = await initializeTestEnvironment({
  projectId,
  firestore: {
    host: "127.0.0.1",
    port: 18227,
    rules: readFileSync(rulesPath, "utf8"),
  },
});
const authTime = Math.floor(Date.now() / 1000) - 60;
const session = {
  schemaVersion: 2,
  status: "active",
  authTime,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 3600000),
};
const client = (uid, extra = {}) =>
  env
    .authenticatedContext(uid, {
      email:
        uid === "admin" || uid === "admin-no-session"
          ? "westoria28@gmail.com"
          : `${uid}@yongshin-ms.ms.kr`,
      auth_time: authTime,
      ...extra,
    })
    .firestore();
const teacher = client("teacher");
const admin = client("admin");
const collections = ["semester_wis_inventory", "semester_wis_orders"];
const archiveQuery = (db, name, scope = "2026-1", pageSize = 200) =>
  query(
    collection(db, name),
    where("semesterId", "==", scope),
    orderBy(documentId()),
    ...(pageSize == null ? [] : [limit(pageSize)]),
  );
const privileged = (action) =>
  env.withSecurityRulesDisabled((context) => action(context.firestore()));
const setPointer = (value) =>
  privileged((db) =>
    value === null
      ? deleteDoc(doc(db, "site_settings/semester_active"))
      : setDoc(doc(db, "site_settings/semester_active"), value),
  );
let passed = 0;
const check = async (name, action) => {
  await action();
  passed += 1;
  console.log(`PASS ${name}`);
};

try {
  await env.clearFirestore();
  await privileged(async (db) => {
    await setDoc(doc(db, "site_settings/semester_active"), {
      semesterId: "2026-2",
      revision: 4,
    });
    // A stale ACTIVE manifest must not deny historical reads, and a CLOSED
    // manifest must not open the actual current semester.
    await setDoc(doc(db, "semester_manifests/2026-1"), {
      semesterId: "2026-1",
      status: "ACTIVE",
    });
    await setDoc(doc(db, "semester_manifests/2026-2"), {
      semesterId: "2026-2",
      status: "CLOSED",
    });
    const profiles = {
      teacher: { role: "teacher", staffPermissions: ["point_read"] },
      manager: { role: "teacher", staffPermissions: ["point_manage"] },
      "teacher-no-permission": {
        role: "teacher",
        staffPermissions: ["lesson_read"],
      },
      "teacher-no-portal": {
        role: "teacher",
        staffPermissions: ["point_read"],
        teacherPortalEnabled: false,
      },
      staff: {
        role: "staff",
        staffPermissions: ["point_read", "point_manage"],
      },
      student: {
        role: "student",
        staffPermissions: ["point_read", "point_manage"],
      },
      "no-session": { role: "teacher", staffPermissions: ["point_read"] },
      revoked: { role: "teacher", staffPermissions: ["point_read"] },
      expired: { role: "teacher", staffPermissions: ["point_read"] },
      pending: {
        role: "teacher",
        staffPermissions: ["point_read"],
        registrationApprovalStatus: "PENDING",
      },
      outsider: { role: "teacher", staffPermissions: ["point_read"] },
    };
    for (const [uid, profile] of Object.entries(profiles)) {
      await setDoc(doc(db, "users", uid), {
        teacherPortalEnabled: true,
        registrationApprovalStatus: "APPROVED",
        ...profile,
      });
      if (uid === "no-session") continue;
      await setDoc(
        doc(db, "application_sessions", uid, "sessions", String(authTime)),
        {
          ...session,
          status: uid === "revoked" ? "closed" : "active",
          generalExpiresAt: Timestamp.fromMillis(
            Date.now() + (uid === "expired" ? -60000 : 3600000),
          ),
        },
      );
    }
    await setDoc(
      doc(db, "application_sessions", "admin", "sessions", String(authTime)),
      session,
    );
    for (const name of collections) {
      for (const [id, scope] of [
        ["old-a", "2026-1"],
        ["old-b", "2026-1"],
        ["older", "2025-2"],
        ["current", "2026-2"],
        ["future", "2027-1"],
        ["invalid-term", "2026-3"],
        ["invalid-year", "202-1"],
        ["invalid-type", 20261],
      ]) {
        await setDoc(doc(db, name, id), {
          semesterId: scope,
          productId: "synthetic-product",
          productName: "검증 상품",
          productDescription: "이전 학기 상품 설명",
          productImageUrl: "https://example.invalid/archive.webp",
          stock: 10,
          reserved: 2,
          sold: 3,
          available: 5,
          studentUid: "synthetic-student",
          studentName: "가상 학생",
          grade: "3",
          class: "1",
          number: "1",
          quantity: 1,
          price: 100,
          status: "FULFILLED",
          revision: 1,
        });
      }
      await setDoc(doc(db, name, "missing-scope"), {
        productId: "synthetic-product",
      });
    }
    for (const name of [
      "wis_product_catalog",
      "semester_wis_accounts",
      "semester_wis_ledger",
      "semester_wis_balances",
      "semester_wis_rankings",
      "semester_wis_economies",
    ]) {
      await setDoc(doc(db, name, "private"), {
        semesterId: "2026-1",
        studentUid: "synthetic-student",
        balance: 1000,
      });
    }
  });

  for (const name of collections) {
    await check(
      `${name}: point_read teacher sees only the selected past semester`,
      async () => {
        const result = await assertSucceeds(
          getDocs(archiveQuery(teacher, name)),
        );
        assert.deepEqual(
          result.docs.map((item) => item.id),
          ["old-a", "old-b"],
        );
        assert.equal(result.docs[0].data().productName, "검증 상품");
        assert.equal(result.docs[0].data().studentName, "가상 학생");
      },
    );
    await check(
      `${name}: admin and point_manage teacher can read past snapshots`,
      async () => {
        await assertSucceeds(getDoc(doc(admin, name, "old-a")));
        await assertSucceeds(getDocs(archiveQuery(client("manager"), name)));
      },
    );
    await check(
      `${name}: cursor pagination retains the semester boundary`,
      async () => {
        const first = await assertSucceeds(
          getDocs(archiveQuery(teacher, name, "2026-1", 1)),
        );
        const next = await assertSucceeds(
          getDocs(
            query(
              collection(teacher, name),
              where("semesterId", "==", "2026-1"),
              orderBy(documentId()),
              startAfter(first.docs[0]),
              limit(1),
            ),
          ),
        );
        assert.equal(first.docs[0].id, "old-a");
        assert.equal(next.docs[0].id, "old-b");
      },
    );
    await check(
      `${name}: earlier year and stale ACTIVE manifest remain readable`,
      async () => {
        await assertSucceeds(getDoc(doc(teacher, name, "old-a")));
        await assertSucceeds(getDocs(archiveQuery(teacher, name, "2025-2")));
      },
    );
    for (const uid of [
      "student",
      "staff",
      "teacher-no-permission",
      "teacher-no-portal",
      "no-session",
      "admin-no-session",
      "revoked",
      "expired",
      "pending",
    ]) {
      await check(
        `${name}: ${uid} cannot read archived snapshots`,
        async () => {
          await assertFails(getDoc(doc(client(uid), name, "old-a")));
          await assertFails(getDocs(archiveQuery(client(uid), name)));
        },
      );
    }
    await check(
      `${name}: unauthenticated, outside-domain and mismatched session reads fail`,
      async () => {
        await assertFails(
          getDoc(doc(env.unauthenticatedContext().firestore(), name, "old-a")),
        );
        await assertFails(
          getDoc(
            doc(
              client("outsider", { email: "outsider@example.com" }),
              name,
              "old-a",
            ),
          ),
        );
        await assertFails(
          getDocs(
            archiveQuery(client("teacher", { auth_time: authTime + 1 }), name),
          ),
        );
      },
    );
    for (const [id, scope] of [
      ["current", "2026-2"],
      ["future", "2027-1"],
      ["invalid-term", "2026-3"],
      ["invalid-year", "202-1"],
      ["invalid-type", 20261],
    ]) {
      await check(`${name}: ${id} denied even to admin`, async () => {
        await assertFails(getDoc(doc(admin, name, id)));
        await assertFails(getDocs(archiveQuery(admin, name, scope)));
      });
    }
    await check(`${name}: documents without scope cannot be read`, () =>
      assertFails(getDoc(doc(teacher, name, "missing-scope"))),
    );
    await check(
      `${name}: unscoped, unlimited and oversized queries fail`,
      async () => {
        await assertFails(
          getDocs(query(collection(teacher, name), limit(200))),
        );
        await assertFails(getDocs(archiveQuery(teacher, name, "2026-1", null)));
        await assertFails(getDocs(archiveQuery(teacher, name, "2026-1", 201)));
        await assertFails(
          getDocs(
            query(
              collection(teacher, name),
              where("semesterId", "in", ["2026-1", "2026-2"]),
              limit(200),
            ),
          ),
        );
      },
    );
    await check(
      `${name}: all direct writes remain denied for teacher and admin`,
      async () => {
        for (const db of [teacher, admin]) {
          await assertFails(
            setDoc(doc(db, name, "new"), { semesterId: "2026-1" }),
          );
          await assertFails(
            updateDoc(doc(db, name, "old-a"), { available: 100 }),
          );
          await assertFails(deleteDoc(doc(db, name, "old-a")));
        }
      },
    );
  }

  for (const value of [
    null,
    {},
    { semesterId: 20262 },
    { semesterId: "2026-3" },
    { semesterId: "2026-2-extra" },
  ]) {
    await check(
      `invalid active pointer ${JSON.stringify(value)} fails closed`,
      async () => {
        await setPointer(value);
        for (const name of collections) {
          await assertFails(getDoc(doc(admin, name, "old-a")));
          await assertFails(getDocs(archiveQuery(teacher, name)));
        }
      },
    );
  }
  await check(
    "year and semester ordering follows the actual active pointer",
    async () => {
      await setPointer({ semesterId: "2026-1", revision: 5 });
      for (const name of collections) {
        await assertFails(getDoc(doc(teacher, name, "old-a")));
        await assertSucceeds(getDoc(doc(teacher, name, "older")));
      }
      await setPointer({ semesterId: "2027-1", revision: 6 });
      for (const name of collections) {
        await assertSucceeds(getDoc(doc(teacher, name, "current")));
        await assertFails(getDoc(doc(teacher, name, "future")));
      }
    },
  );
  await setPointer({ semesterId: "2026-2", revision: 7 });
  for (const name of [
    "wis_product_catalog",
    "semester_wis_accounts",
    "semester_wis_ledger",
    "semester_wis_balances",
    "semester_wis_rankings",
    "semester_wis_economies",
  ]) {
    await check(
      `${name}: direct global and financial data remains closed`,
      async () => {
        await assertFails(getDoc(doc(teacher, name, "private")));
        await assertFails(getDoc(doc(admin, name, "private")));
        await assertFails(getDocs(archiveQuery(admin, name)));
      },
    );
  }
  await check(
    "valid maintenance config with the full bypass list preserves teacher reads",
    async () => {
      await privileged((db) =>
        setDoc(doc(db, "site_settings/student_maintenance"), {
          enabled: true,
          blockedRoles: ["student"],
          bypassUids: Array.from(
            { length: 20 },
            (_, index) => `synthetic-bypass-${index}`,
          ),
          title: "점검",
          message: "잠시 점검 중입니다.",
          startedAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
          updatedBy: "admin",
          revision: 1,
        }),
      );
      await assertSucceeds(getDoc(doc(teacher, "site_settings/config")));
      for (const name of collections) {
        await assertSucceeds(getDoc(doc(teacher, name, "old-a")));
        await assertSucceeds(getDocs(archiveQuery(teacher, name)));
        await assertSucceeds(getDocs(archiveQuery(client("manager"), name)));
        await assertSucceeds(getDocs(archiveQuery(admin, name)));
      }
    },
  );
  await check(
    "invalid maintenance configuration still blocks archive reads",
    async () => {
      await privileged((db) =>
        setDoc(doc(db, "site_settings/student_maintenance"), {
          enabled: false,
        }),
      );
      for (const name of collections)
        await assertFails(getDocs(archiveQuery(teacher, name)));
    },
  );
  console.log(`Wis shop archive rules: ${passed} checks passed.`);
} finally {
  await env.cleanup();
}
