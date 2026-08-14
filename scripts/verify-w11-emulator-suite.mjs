import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w11";
const storageBucket = `${projectId}.appspot.com`;
assert.equal(projectId, "demo-westory-session-w11");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
  "FIREBASE_EMULATOR_HUB",
]) {
  assert.ok(
    process.env[variable],
    `${variable} is required through firebase emulators:exec.`,
  );
}

const hubResponse = await fetch(
  `http://${process.env.FIREBASE_EMULATOR_HUB}/emulators`,
);
assert.equal(hubResponse.ok, true, "Firebase Emulator Hub is unavailable.");
const emulators = await hubResponse.json();
for (const emulator of [
  "hub",
  "logging",
  "auth",
  "firestore",
  "functions",
  "storage",
]) {
  assert.ok(emulators[emulator], `${emulator} is missing from Emulator Hub.`);
  assert.equal(Number.isSafeInteger(emulators[emulator].port), true);
}
assert.equal(
  Number(emulators.storage.port),
  Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(":").at(-1)),
);

const run = (script) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, WESTORY_TEST_PROJECT_ID: projectId },
    stdio: "inherit",
  });
  assert.equal(result.error, undefined, `${script} could not start.`);
  assert.equal(result.status, 0, `${script} failed with ${result.status}.`);
};
const reset = async (host, path, method = "DELETE") => {
  const response = await fetch(`http://${host}${path}`, { method });
  assert.equal(
    response.ok,
    true,
    `Emulator reset failed with ${response.status}.`,
  );
};

run("scripts/verify-w11-domain-rules.mjs");
await Promise.all([
  reset(
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
    `/emulator/v1/projects/${projectId}/accounts`,
  ),
  reset(
    process.env.FIRESTORE_EMULATOR_HOST,
    `/emulator/v1/projects/${projectId}/databases/(default)/documents`,
  ),
  reset(process.env.FIREBASE_STORAGE_EMULATOR_HOST, "/internal/reset", "POST"),
]);
const storageListResponse = await fetch(
  `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/storage/v1/b/${storageBucket}/o`,
  { headers: { Authorization: "Bearer owner" } },
);
assert.equal(storageListResponse.ok, true);
const storageList = await storageListResponse.json();
assert.equal(
  Array.isArray(storageList.items) ? storageList.items.length : 0,
  0,
);
run("scripts/verify-w11-domain-integration.mjs");

console.log(
  JSON.stringify({
    suite: "w11-single-emulator-regression",
    passed: true,
    rulesAndIntegration: true,
    resetBetweenSuites: true,
    storageResetBetweenSuites: true,
    residualStorageObjectsAfterReset: 0,
    emulatorHubVerified: true,
    emulatorLoggingVerified: true,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
