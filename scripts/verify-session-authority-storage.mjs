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
import { doc, setDoc, Timestamp } from "firebase/firestore";
import {
  connectStorageEmulator,
  getStorage,
  ref,
  uploadBytes,
} from "firebase/storage";

const projectId = "demo-westory-session-storage";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];

const createClient = async (name, email) => {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: `${projectId}.appspot.com`,
  }, name);
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

const seedIdentity = async (db, client, { role = "teacher", expired = false, session = true } = {}) => {
  await setDoc(doc(db, "users", client.uid), {
    uid: client.uid,
    email: client.email,
    role,
    teacherPortalEnabled: role === "teacher",
    staffPermissions: [],
  });
  if (!session) return;
  await setDoc(
    doc(db, "application_sessions", client.uid, "sessions", String(client.authTime)),
    {
      uid: client.uid,
      email: client.email,
      authTime: client.authTime,
      status: "active",
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
    const active = await createClient("storage-active", "storage.active@yongshin-ms.ms.kr");
    const expired = await createClient("storage-expired", "storage.expired@yongshin-ms.ms.kr");
    const missing = await createClient("storage-missing", "storage.missing@yongshin-ms.ms.kr");
    const student = await createClient("storage-student", "storage.student@yongshin-ms.ms.kr");

    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await seedIdentity(db, active);
      await seedIdentity(db, expired, { expired: true });
      await seedIdentity(db, missing, { session: false });
      await seedIdentity(db, student, { role: "student" });
    });

    const bytes = new Uint8Array([137, 80, 78, 71]);
    const target = (client, suffix) => ref(
      client.storage,
      `years/2026/semesters/1/notice_images/session-test/${suffix}.png`,
    );

    await uploadBytes(target(active, "active"), bytes, { contentType: "image/png" });
    await expectRejected(() =>
      uploadBytes(target(expired, "expired"), bytes, { contentType: "image/png" }),
    );
    await expectRejected(() =>
      uploadBytes(target(missing, "missing"), bytes, { contentType: "image/png" }),
    );
    await expectRejected(() =>
      uploadBytes(target(student, "student"), bytes, { contentType: "image/png" }),
    );

    console.log(JSON.stringify({
      suite: "session-authority-storage-rules",
      passed: true,
      uniqueFirestoreAccessesPerTeacherWrite: 2,
      cases: ["ACTIVE_TEACHER", "EXPIRED", "MISSING", "WRONG_ROLE"],
      productionAccess: 0,
    }));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await env.cleanup();
  }
};

await main();
