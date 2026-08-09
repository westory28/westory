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

const projectId = process.env.GCLOUD_PROJECT || "demo-westory-session-integration";
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
    const revoked = await createClient("session-revoked", "session.revoked@yongshin-ms.ms.kr");

    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "site_settings", "config"), {
        year: "2026",
        semester: "1",
      });
    });

    const open = httpsCallable(active.functions, "openApplicationSession");
    const touch = httpsCallable(active.functions, "touchApplicationSession");
    const protectedCallable = httpsCallable(active.functions, "getPrintClientInfo");
    const opened = (await open({
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
    })).data;
    if (opened?.status !== "active" || !opened?.generalExpiresAt) {
      throw new Error("Application session did not open with a server deadline.");
    }
    const sessionProof = {
      authorityGeneration: opened.authorityGeneration,
      protocolVersion: opened.protocolVersion,
      revision: opened.revision,
    };
    await touch({ scope: "GENERAL", _session: sessionProof });
    await protectedCallable({ _session: sessionProof });
    await active.user.getIdToken(true);
    await protectedCallable({ _session: sessionProof });
    await assertSucceeds(getDoc(doc(active.db, "site_settings", "config")));

    await expectFunctionReason(
      () => protectedCallable({}),
      "SESSION_PROOF_INVALID",
    );
    await expectFunctionReason(
      () => protectedCallable({
        _session: { ...sessionProof, revision: "b".repeat(64) },
      }),
      "SESSION_PROOF_INVALID",
    );

    const activeIdToken = await active.user.getIdToken();
    const oldBundleRawResponse = await fetch(
      `http://127.0.0.1:5001/${projectId}/asia-northeast3/getPrintClientInfo`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${activeIdToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: {} }),
      },
    );
    const oldBundleRawBody = await oldBundleRawResponse.json();
    if (oldBundleRawBody?.error?.details?.reason !== "SESSION_PROOF_INVALID") {
      throw new Error(`Old-bundle raw callable bypass was not rejected: ${JSON.stringify(oldBundleRawBody)}`);
    }

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

    await expectFunctionReason(
      () => protectedCallable({ _session: sessionProof }),
      "SESSION_EXPIRED",
    );
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
        body: JSON.stringify({ data: { _session: sessionProof } }),
      },
    );
    const rawBody = await rawResponse.json();
    if (rawBody?.error?.details?.reason !== "SESSION_EXPIRED") {
      throw new Error(`Raw callable bypass was not rejected: ${JSON.stringify(rawBody)}`);
    }

    const missingCallable = httpsCallable(missing.functions, "getPrintClientInfo");
    await expectFunctionReason(() => missingCallable({}), "SESSION_MISSING");

    const oldOpen = httpsCallable(missing.functions, "openApplicationSession");
    await expectFunctionReason(() => oldOpen({}), "SESSION_PROTOCOL_REQUIRED");

    const revokedOpen = httpsCallable(revoked.functions, "openApplicationSession");
    const revokedSession = (await revokedOpen({
      authorityGeneration: "w1r2-2026-08-09",
      protocolVersion: 2,
    })).data;
    const revokedProof = {
      authorityGeneration: revokedSession.authorityGeneration,
      protocolVersion: revokedSession.protocolVersion,
      revision: revokedSession.revision,
    };
    const revokedCallable = httpsCallable(revoked.functions, "getPrintClientInfo");
    await revokedCallable({ _session: revokedProof });
    const close = httpsCallable(revoked.functions, "closeApplicationSession");
    await close({});
    await expectFunctionReason(
      () => revokedCallable({ _session: revokedProof }),
      "SESSION_EXPIRED",
    );

    console.log(JSON.stringify({
      suite: "session-authority-end-to-end",
      passed: true,
      cases: [
        "OPEN",
        "TOUCH",
        "PROTECTED_CALLABLE_ACTIVE",
        "TOKEN_REFRESH_SAME_AUTH_TIME",
        "OLD_BUNDLE_CALLABLE_PROOF_MISSING",
        "SESSION_REVISION_MISMATCH",
        "PROTECTED_FIRESTORE_ACTIVE",
        "CALLABLE_EXPIRED",
        "FIRESTORE_EXPIRED",
        "RAW_HTTP_CALLABLE_EXPIRED",
        "SESSION_MISSING",
        "OPEN_OLD_PROTOCOL_DENIED",
        "CLOSE_PROOFLESS",
        "REVOKED_SESSION_DENIED",
      ],
      knownLimitations: [
        "SECURITY_RULES_ALONE_CANNOT_DISTINGUISH_A_SAME_ORIGIN_OLD_BUNDLE_THAT_SHARES_THE_CURRENT_ID_TOKEN_AND_ACTIVE_SESSION",
        "APP_CHECK_MUST_BE_ENFORCED_FOR_STAGING_FIRESTORE_AND_STORAGE_OUTSIDE_SECURITY_RULES",
        "APP_CHECK_DOES_NOT_DISTINGUISH_SAME_ORIGIN_CODE_THAT_CAN_OBTAIN_A_VALID_ATTESTATION",
      ],
      productionAccess: 0,
    }));
  } finally {
    await Promise.all(apps.map((app) => deleteApp(app)));
    await env.cleanup();
  }
};

await main();
