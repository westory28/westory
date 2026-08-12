import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w9";
assert.equal(projectId, "demo-westory-session-w9");
assert.notEqual(projectId, "history-quiz-yongsin");
for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
]) {
  assert.ok(
    process.env[variable],
    `${variable} is required through firebase emulators:exec.`,
  );
}

const run = (script) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: { ...process.env, WESTORY_TEST_PROJECT_ID: projectId },
    stdio: "inherit",
  });
  assert.equal(result.error, undefined, `${script} could not start.`);
  assert.equal(result.status, 0, `${script} failed with ${result.status}.`);
};

const reset = async (host, path) => {
  const response = await fetch(`http://${host}${path}`, { method: "DELETE" });
  assert.equal(response.ok, true, `Emulator reset failed with ${response.status}.`);
};

run("scripts/verify-w9-domain-rules.mjs");
await Promise.all([
  reset(
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
    `/emulator/v1/projects/${projectId}/accounts`,
  ),
  reset(
    process.env.FIRESTORE_EMULATOR_HOST,
    `/emulator/v1/projects/${projectId}/databases/(default)/documents`,
  ),
]);
run("scripts/verify-w9-domain-integration.mjs");

console.log(
  JSON.stringify({
    suite: "w9-single-emulator-regression",
    passed: true,
    rulesAndIntegration: true,
    resetBetweenSuites: true,
    productionAccess: 0,
  }),
);
