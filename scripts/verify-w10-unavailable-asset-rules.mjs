import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w10-assets";
assert.equal(projectId, "demo-westory-session-w10-assets");
assert.notEqual(projectId, "history-quiz-yongsin");

const bucketUrl = `gs://${projectId}.appspot.com`;
const authTime = Math.floor(Date.now() / 1000) - 5;
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const storageRules = readFileSync(resolve("storage.rules"), "utf8");
const users = {
  student: {
    uid: "w10-assets-student",
    email: "w10.assets.student@yongshin-ms.ms.kr",
    role: "student",
  },
  teacher: {
    uid: "w10-assets-teacher",
    email: "w10.assets.teacher@yongshin-ms.ms.kr",
    role: "teacher",
  },
  admin: {
    uid: "w10-assets-admin",
    email: "westoria28@gmail.com",
    role: "admin",
  },
};
const session = (user) => ({
  uid: user.uid,
  email: user.email,
  authTime,
  status: "active",
  schemaVersion: 2,
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  sessionRevision: "a".repeat(64),
  authorityModeAtOpen: "ENFORCE",
  generalExpiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
});

const env = await initializeTestEnvironment({
  projectId,
  firestore: { host: "127.0.0.1", port: 8080, rules },
  storage: { host: "127.0.0.1", port: 9199, rules: storageRules },
});

let deniedOperations = 0;
let preservedReads = 0;
const denied = async (operation) => {
  await assertFails(operation);
  deniedOperations += 1;
};
const readable = async (operation) => {
  await assertSucceeds(operation);
  preservedReads += 1;
};

try {
  await Promise.all([env.clearFirestore(), env.clearStorage()]);
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const storage = context.storage(bucketUrl);
    for (const user of Object.values(users)) {
      await setDoc(doc(db, "users", user.uid), {
        uid: user.uid,
        email: user.email,
        role: user.role,
        teacherPortalEnabled: user.role === "teacher",
        staffPermissions: user.role === "teacher" ? ["lesson_read"] : [],
      });
      await setDoc(
        doc(db, "application_sessions", user.uid, "sessions", String(authTime)),
        session(user),
      );
    }
    await setDoc(doc(db, "map_resources", "legacy-map"), {
      title: "Legacy map",
    });
    await setDoc(
      doc(
        db,
        "years",
        "2026",
        "semesters",
        "2",
        "map_resources",
        "current-map",
      ),
      {
        title: "Current map",
      },
    );
    await setDoc(doc(db, "source_archive", "source-one"), {
      title: "Source one",
      status: "ready",
    });
    await uploadBytes(
      ref(storage, "map-resources/legacy-map/original.png"),
      new Uint8Array([1, 2, 3]),
      { contentType: "image/png" },
    );
    await uploadBytes(
      ref(storage, "source-archive/source-one/v-1/original.png"),
      new Uint8Array([4, 5, 6]),
      { contentType: "image/png" },
    );
  });

  const clients = Object.fromEntries(
    Object.entries(users).map(([key, user]) => {
      const context = env.authenticatedContext(user.uid, {
        email: user.email,
        auth_time: authTime,
      });
      return [
        key,
        { db: context.firestore(), storage: context.storage(bucketUrl) },
      ];
    }),
  );
  const anonymousContext = env.unauthenticatedContext();
  const anonymous = {
    db: anonymousContext.firestore(),
    storage: anonymousContext.storage(bucketUrl),
  };

  for (const key of ["student", "teacher", "admin"]) {
    await readable(getDoc(doc(clients[key].db, "map_resources", "legacy-map")));
    await readable(
      getDoc(
        doc(
          clients[key].db,
          "years",
          "2026",
          "semesters",
          "2",
          "map_resources",
          "current-map",
        ),
      ),
    );
    await readable(
      getBytes(
        ref(clients[key].storage, "map-resources/legacy-map/original.png"),
      ),
    );
  }
  for (const key of ["teacher", "admin"]) {
    await readable(
      getDoc(doc(clients[key].db, "source_archive", "source-one")),
    );
    await readable(
      getBytes(
        ref(clients[key].storage, "source-archive/source-one/v-1/original.png"),
      ),
    );
  }
  await denied(getDoc(doc(clients.student.db, "source_archive", "source-one")));
  await denied(
    getBytes(
      ref(
        clients.student.storage,
        "source-archive/source-one/v-1/original.png",
      ),
    ),
  );

  for (const client of [...Object.values(clients), anonymous]) {
    for (const path of [
      ["map_resources", "new-map"],
      ["years", "2026", "semesters", "2", "map_resources", "new-map"],
      ["source_archive", "new-source"],
    ]) {
      await denied(
        setDoc(doc(client.db, ...path), { title: "previous bundle" }),
      );
    }
    for (const path of [
      ["map_resources", "legacy-map"],
      ["years", "2026", "semesters", "2", "map_resources", "current-map"],
      ["source_archive", "source-one"],
    ]) {
      await denied(updateDoc(doc(client.db, ...path), { title: "mutated" }));
      await denied(deleteDoc(doc(client.db, ...path)));
    }
    await denied(
      uploadBytes(
        ref(client.storage, "map-resources/new-map/original.png"),
        new Uint8Array([7]),
        { contentType: "image/png" },
      ),
    );
    await denied(
      uploadBytes(
        ref(client.storage, "source-archive/new-source/incoming/token.png"),
        new Uint8Array([8]),
        { contentType: "image/png" },
      ),
    );
    await denied(
      deleteObject(
        ref(client.storage, "map-resources/legacy-map/original.png"),
      ),
    );
    await denied(
      deleteObject(
        ref(client.storage, "source-archive/source-one/v-1/original.png"),
      ),
    );
  }

  console.log(
    JSON.stringify({
      suite: "w10-unavailable-asset-rules",
      passed: true,
      disposition: "EXPLICITLY_UNAVAILABLE",
      deniedOperations,
      preservedReads,
      previousBundleDirectSdkDenied: true,
      immutableSourceArchiveReadPreserved: true,
      unrelatedStorageChanged: false,
      productionAccess: 0,
    }),
  );
} finally {
  await env.cleanup();
}
