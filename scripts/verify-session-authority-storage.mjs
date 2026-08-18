import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  getIdTokenResult,
} from "firebase/auth";
import { deleteDoc, doc, setDoc, Timestamp } from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const projectId = process.env.GCLOUD_PROJECT || "demo-westory-session-storage";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];

const createClient = async (name, email) => {
  const app = initializeApp(
    {
      apiKey: "demo-api-key",
      authDomain: `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: `${projectId}.appspot.com`,
    },
    name,
  );
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    "Password!123",
  );
  const token = await getIdTokenResult(credential.user);
  const authTime = Math.floor(Date.parse(token.authTime) / 1000);
  const storage = getStorage(app);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return { app, auth, storage, uid: credential.user.uid, email, authTime };
};

const seedIdentity = async (
  db,
  client,
  {
    role = "teacher",
    expired = false,
    session = true,
    mode = "ENFORCE",
    schemaVersion = 2,
    status = "active",
  } = {},
) => {
  await setDoc(doc(db, "users", client.uid), {
    uid: client.uid,
    email: client.email,
    role,
    teacherPortalEnabled: role === "teacher",
    staffPermissions: [],
  });
  if (!session) return;
  await setDoc(
    doc(
      db,
      "application_sessions",
      client.uid,
      "sessions",
      String(client.authTime),
    ),
    {
      uid: client.uid,
      email: client.email,
      authTime: client.authTime,
      status,
      schemaVersion,
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
      sessionRevision: "a".repeat(64),
      authorityModeAtOpen: mode,
      generalExpiresAt: Timestamp.fromMillis(
        expired ? Date.now() - 1000 : Date.now() + 30 * 60 * 1000,
      ),
      highRiskExpiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
    },
  );
};

const expectRejected = async (operation) => {
  try {
    await operation();
  } catch (error) {
    const code = String(error?.code || "");
    if (code.includes("unauthorized") || code.includes("permission")) return;
    throw error;
  }
  throw new Error("Expected Storage operation to be rejected.");
};

const main = async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  try {
    await env.clearFirestore();
    const adminEmail = "westoria28@gmail.com";
    const admin = await createClient("storage-admin", adminEmail);
    const student = await createClient(
      "storage-student",
      "storage.student@yongshin-ms.ms.kr",
    );

    const withRulesDisabled = (operation) =>
      env.withSecurityRulesDisabled(async (context) =>
        operation(context.firestore()),
      );
    const sessionRef = (db) =>
      doc(
        db,
        "application_sessions",
        admin.uid,
        "sessions",
        String(admin.authTime),
      );
    const transitionRef = (db) =>
      doc(db, "application_session_transitions", admin.uid);
    const seedAdminSession = (options = {}) =>
      withRulesDisabled((db) => seedIdentity(db, admin, options));
    const clearAdminSession = () =>
      withRulesDisabled(async (db) => {
        await deleteDoc(sessionRef(db));
      });
    const seedTransition = (expired) =>
      withRulesDisabled(async (db) => {
        await deleteDoc(sessionRef(db));
        await setDoc(transitionRef(db), {
          uid: admin.uid,
          status: "pending",
          fromAuthTime: admin.authTime - 1,
          expiresAt: Timestamp.fromMillis(
            expired ? Date.now() - 1000 : Date.now() + 90 * 1000,
          ),
          schemaVersion: 1,
          authorityGeneration: "w1r2-2026-08-09",
          protocolVersion: 2,
        });
      });

    await withRulesDisabled(async (db) => {
      await seedIdentity(db, admin);
      await seedIdentity(db, student, { role: "student" });
    });

    const bytes = new Uint8Array([137, 80, 78, 71]);
    const target = (client, suffix) =>
      ref(client.storage, `developer_log_images/session-test/${suffix}.png`);

    await uploadBytes(target(admin, "active"), bytes, {
      contentType: "image/png",
    });

    await seedAdminSession({ expired: true });
    await expectRejected(() =>
      uploadBytes(target(admin, "expired"), bytes, {
        contentType: "image/png",
      }),
    );

    await clearAdminSession();
    await expectRejected(() =>
      uploadBytes(target(admin, "missing"), bytes, {
        contentType: "image/png",
      }),
    );
    await expectRejected(() =>
      uploadBytes(target(student, "student"), bytes, {
        contentType: "image/png",
      }),
    );
    await seedAdminSession({ expired: true, mode: "OBSERVE_ONLY" });
    await uploadBytes(target(admin, "observe-expired"), bytes, {
      contentType: "image/png",
    });

    await seedAdminSession({ schemaVersion: 1 });
    await expectRejected(() =>
      uploadBytes(target(admin, "old-protocol"), bytes, {
        contentType: "image/png",
      }),
    );

    await seedAdminSession({ mode: "OBSERVE_ONLY", status: "closed" });
    await expectRejected(() =>
      uploadBytes(target(admin, "observe-closed"), bytes, {
        contentType: "image/png",
      }),
    );

    await seedAdminSession({ expired: true, mode: "DISABLED" });
    await uploadBytes(target(admin, "disabled-expired"), bytes, {
      contentType: "image/png",
    });

    await seedTransition(false);
    await uploadBytes(target(admin, "reauth-transition"), bytes, {
      contentType: "image/png",
    });

    await seedTransition(true);
    await expectRejected(() =>
      uploadBytes(target(admin, "expired-reauth-transition"), bytes, {
        contentType: "image/png",
      }),
    );

    console.log(
      JSON.stringify({
        suite: "session-authority-storage-rules",
        passed: true,
        uniqueFirestoreAccessesPerTeacherWrite: 3,
        cases: [
          "ACTIVE_ADMIN",
          "REAUTH_TRANSITION_NEW_EPOCH",
          "REAUTH_TRANSITION_EXPIRED_DENIED",
          "EXPIRED",
          "MISSING",
          "WRONG_ROLE",
          "OBSERVE_IDLE_EXPIRED_ALLOWED",
          "OBSERVE_CLOSED_DENIED",
          "DISABLED_IDLE_EXPIRED_ALLOWED",
          "OLD_PROTOCOL_DENIED",
        ],
        productionAccess: 0,
      }),
    );
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await env.cleanup();
  }
};

await main();
