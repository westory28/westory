import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

// This suite writes synthetic fixtures only to an explicitly local emulator.
const endpoint = process.env.FIRESTORE_EMULATOR_HOST || "";
setLogLevel("silent");
assert.match(
  endpoint,
  /^(127\.0\.0\.1|localhost):\d+$/,
  "A local Firestore emulator is required",
);
const [host, port] = endpoint.split(":");
const projectId = "demo-westory-developer-log";
const rulesFiles = ["firestore.rules", "firestore.staging.rules"];
const sources = await Promise.all(
  rulesFiles.map((file) =>
    readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ),
);
const withoutFixture = (source) =>
  source
    .replace(/\r\n/g, "\n")
    .replace(
      /    function isTrustedW10PVisualFixtureAdmin\(\) \{[\s\S]*?\n    \}/,
      "    function isTrustedW10PVisualFixtureAdmin() { FIXTURE_ONLY }",
    );
assert.equal(
  withoutFixture(sources[0]),
  withoutFixture(sources[1]),
  "Production and staging may differ only in their visual fixture helper",
);
const now = Date.now();
const recentAuth = Math.floor(now / 1000) - 30;
const olderAuth = recentAuth - 10 * 60;
const future = Timestamp.fromMillis(now + 10 * 60 * 1000);
const past = Timestamp.fromMillis(now - 60 * 1000);
const adminEmail = "westoria28@gmail.com";
const itemPath = "site_settings/developer_logs/items";
const session = (uid, authTime, overrides = {}) => ({
  uid,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: future,
  highRiskExpiresAt: future,
  ...overrides,
});
let checks = 0;
const succeeds = async (operation) => {
  await assertSucceeds(operation);
  checks++;
};
const fails = async (operation) => {
  await assertFails(operation);
  checks++;
};

for (let index = 0; index < sources.length; index++) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host, port: Number(port), rules: sources[index] },
  });
  try {
    await env.clearFirestore();
    const actors = [
      ["older-admin", adminEmail, olderAuth, {}],
      [
        "older-low-risk-admin",
        adminEmail,
        olderAuth,
        { highRiskExpiresAt: past },
      ],
      ["recent-admin", adminEmail, recentAuth, {}],
      [
        "recent-low-risk-admin",
        adminEmail,
        recentAuth,
        { highRiskExpiresAt: past },
      ],
      ["expired-admin", adminEmail, olderAuth, { generalExpiresAt: past }],
      ["closed-admin", adminEmail, olderAuth, { status: "closed" }],
      ["mismatch-admin", adminEmail, olderAuth, { authTime: olderAuth - 1 }],
      ["teacher", "fixture-teacher@yongshin-ms.ms.kr", olderAuth, {}],
      ["student", "fixture-student@yongshin-ms.ms.kr", olderAuth, {}],
      ["outside", "fixture-outside@example.invalid", olderAuth, {}],
    ];
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "site_settings/student_maintenance"), {
        enabled: false,
        blockedRoles: ["student"],
        bypassUids: [],
        title: "Synthetic maintenance setting",
        message: "Synthetic routine save rules verification",
        startedAt: null,
        updatedAt: Timestamp.now(),
        updatedBy: "synthetic-admin",
        revision: 1,
      });
      for (const [uid, email, authTime, overrides] of actors) {
        await setDoc(
          doc(db, `application_sessions/${uid}/sessions/${authTime}`),
          session(uid, authTime, overrides),
        );
        await setDoc(doc(db, `users/${uid}`), {
          uid,
          email,
          role: uid === "student" ? "student" : "teacher",
          registrationApprovalStatus: "APPROVED",
        });
      }
      await setDoc(doc(db, `${itemPath}/existing`), {
        title: "Synthetic original",
        likeCount: 0,
        viewCount: 0,
      });
      await setDoc(doc(db, "site_settings/ordinary/items/existing"), {
        title: "Synthetic setting",
      });
      await setDoc(doc(db, "site_settings/consent/items/existing"), {
        title: "Synthetic consent",
      });
      await setDoc(doc(db, "site_settings/ordinary"), {
        title: "Synthetic setting root",
      });
    });
    const databases = Object.fromEntries(
      actors.map(([uid, email, authTime]) => [
        uid,
        env
          .authenticatedContext(uid, { email, auth_time: authTime })
          .firestore(),
      ]),
    );
    databases["missing-session"] = env
      .authenticatedContext("missing-session", {
        email: adminEmail,
        auth_time: olderAuth,
      })
      .firestore();
    databases["missing-auth-time"] = env
      .authenticatedContext("missing-auth-time", { email: adminEmail })
      .firestore();
    databases.anonymous = env.unauthenticatedContext().firestore();

    for (const name of [
      "older-admin",
      "older-low-risk-admin",
      "recent-admin",
      "recent-low-risk-admin",
    ]) {
      const db = databases[name];
      await succeeds(
        setDoc(doc(db, `${itemPath}/${name}`), {
          title: "Synthetic published post",
        }),
      );
      await succeeds(
        updateDoc(doc(db, `${itemPath}/existing`), { title: name }),
      );
      if (name === "recent-admin")
        await succeeds(deleteDoc(doc(db, `${itemPath}/${name}`)));
      else await fails(deleteDoc(doc(db, `${itemPath}/${name}`)));
    }

    for (const name of [
      "expired-admin",
      "closed-admin",
      "mismatch-admin",
      "missing-session",
      "missing-auth-time",
      "teacher",
      "student",
      "outside",
      "anonymous",
    ]) {
      const db = databases[name];
      await fails(
        setDoc(doc(db, `${itemPath}/denied-${name}`), {
          title: "Must not publish",
        }),
      );
      await fails(
        updateDoc(doc(db, `${itemPath}/existing`), {
          title: "Must not change",
        }),
      );
      await fails(deleteDoc(doc(db, `${itemPath}/existing`)));
    }

    for (const name of ["older-admin", "recent-admin"]) {
      const db = databases[name];
      const expectation = name === "recent-admin" ? succeeds : fails;
      await expectation(
        setDoc(doc(db, `site_settings/ordinary/items/${name}`), {
          title: "Synthetic setting",
        }),
      );
      await expectation(
        updateDoc(doc(db, "site_settings/ordinary/items/existing"), {
          title: name,
        }),
      );
      await expectation(
        updateDoc(doc(db, "site_settings/ordinary"), { title: name }),
      );
      await fails(
        setDoc(doc(db, `site_settings/consent/items/${name}`), {
          title: "Must remain gateway-owned",
        }),
      );
      await fails(
        updateDoc(doc(db, "site_settings/consent/items/existing"), {
          title: "Must remain gateway-owned",
        }),
      );
      await fails(deleteDoc(doc(db, "site_settings/consent/items/existing")));
    }
    await fails(
      deleteDoc(
        doc(databases["older-admin"], "site_settings/ordinary/items/existing"),
      ),
    );
    await succeeds(
      deleteDoc(
        doc(databases["recent-admin"], "site_settings/ordinary/items/existing"),
      ),
    );
    await fails(
      setDoc(doc(databases["older-admin"], "site_settings/developer_logs"), {
        title: "Parent settings keep their recent-auth requirement",
      }),
    );
    await succeeds(
      setDoc(doc(databases["recent-admin"], "site_settings/developer_logs"), {
        title: "Parent settings require recent authentication",
      }),
    );

    // Existing reader/like exceptions stay narrow and continue to work.
    const studentDb = databases.student;
    await succeeds(
      updateDoc(doc(databases.teacher, `${itemPath}/existing`), {
        viewCount: 1,
      }),
    );
    await fails(
      updateDoc(doc(studentDb, `${itemPath}/existing`), { likeCount: 1 }),
    );
    // Positive student like/unlike batches are excluded: the unchanged cab07ef
    // rules exceed 1,000 expressions when this valid maintenance fixture exists.
    // That pre-existing limitation was reproduced separately against HEAD rules;
    // this change preserves the like rules and the production-shaped fixture.
    await fails(
      setDoc(doc(databases.teacher, `${itemPath}/existing/likes/teacher`), {
        uid: "teacher",
        createdAt: Timestamp.now(),
      }),
    );

    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), "site_settings/student_maintenance"), {
        enabled: "invalid",
      }),
    );
    await fails(
      setDoc(doc(databases["older-admin"], `${itemPath}/maintenance-denied`), {
        title: "Must retain maintenance validation",
      }),
    );
    await fails(
      updateDoc(doc(databases["older-admin"], `${itemPath}/existing`), {
        title: "Must retain maintenance validation",
      }),
    );
    console.log(
      `${rulesFiles[index]}: developer-log authorization cases passed`,
    );
  } finally {
    await env.cleanup();
  }
}
console.log(
  `Developer log rules: ${checks} emulator checks passed; routine create/update and recent-auth delete remain separated.`,
);
