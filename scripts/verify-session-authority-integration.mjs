import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteApp, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  getIdTokenResult,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  Timestamp,
} from "firebase/firestore";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectId = "demo-westory-session-integration";
const rules = readFileSync(resolve("firestore.rules"), "utf8");
const apps = [];

const createClient = async (name, email) => {
  const app = initializeApp({
    apiKey: "demo-api-key",
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  }, name);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  const functions = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    "Password!123",
  );
  const token = await getIdTokenResult(credential.user);
  return {
    app,
    auth,
    db,
    functions,
    user: credential.user,
    uid: credential.user.uid,
    email,
    authTime: Math.floor(Date.parse(token.authTime) / 1000),
  };
};

const expectFunctionReason = async (operation, expectedReason) => {
  try {
    await operation();
  } catch (error) {
    const reason = String(error?.details?.reason || "");
    if (reason === expectedReason) return;
    throw error;
  }
  throw new Error(`Expected callable to reject with ${expectedReason}.`);
};

const main = async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
  try {
    await env.clearFirestore();
    const active = await createClient("session-active", "session.active@yongshin-ms.ms.kr");
    const missing = await createClient("session-missing", "session.missing@yongshin-ms.ms.kr");

    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "site_settings", "config"), {
        year: "2026",
        semester: "1",
      });
    });

    const open = httpsCallable(active.functions, "openApplicationSession");
    const touch = httpsCallable(active.functions, "touchApplicationSession");
    const protectedCallable = httpsCallable(active.functions, "getPrintClientInfo");
    const opened = (await open({})).data;
    if (opened?.status !== "active" || !opened?.generalExpiresAt) {
      throw new Error("Application session did not open with a server deadline.");
    }
    await touch({ scope: "GENERAL" });
    await protectedCallable({});
    await assertSucceeds(getDoc(doc(active.db, "site_settings", "config")));

    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(
          context.firestore(),
          "application_sessions",
          active.uid,
          "sessions",
          String(active.authTime),
        ),
        {
          status: "active",
          authTime: active.authTime,
          generalExpiresAt: Timestamp.fromMillis(Date.now() - 1000),
        },
        { merge: true },
      );
    });

    await expectFunctionReason(() => protectedCallable({}), "SESSION_EXPIRED");
    await assertFails(getDoc(doc(active.db, "site_settings", "config")));

    const idToken = await active.user.getIdToken();
    const rawResponse = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-northeast3/getPrintClientInfo`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: {} }),
      },
    );
    const rawBody = await rawResponse.json();
    if (rawBody?.error?.details?.reason !== "SESSION_EXPIRED") {
      throw new Error(`Raw callable bypass was not rejected: ${JSON.stringify(rawBody)}`);
    }

    const missingCallable = httpsCallable(missing.functions, "getPrintClientInfo");
    await expectFunctionReason(() => missingCallable({}), "SESSION_MISSING");

    console.log(JSON.stringify({
      suite: "session-authority-end-to-end",
      passed: true,
      cases: [
        "OPEN",
        "TOUCH",
        "PROTECTED_CALLABLE_ACTIVE",
        "PROTECTED_FIRESTORE_ACTIVE",
        "CALLABLE_EXPIRED",
        "FIRESTORE_EXPIRED",
        "RAW_HTTP_CALLABLE_EXPIRED",
        "SESSION_MISSING",
      ],
      productionAccess: 0,
    }));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await env.cleanup();
  }
};

await main();
