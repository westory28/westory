import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectId = "demo-westory-session-w6a";
for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
]) {
  assert.ok(process.env[variable], `${variable} is required through firebase emulators:exec.`);
}

const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, WESTORY_TEST_PROJECT_ID: projectId },
    stdio: "inherit",
  });
  assert.equal(result.error, undefined, `${script} could not start.`);
  assert.equal(result.status, 0, `${script} failed with status ${result.status}.`);
};

const resetAuth = async () => {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true, `Auth emulator reset failed with ${response.status}.`);
};

run("scripts/verify-w5-emulator-suite.mjs");
run("scripts/verify-w6a-assessment-rules.mjs");
await resetAuth();
run("scripts/verify-w6a-assessment-integration.mjs");

console.log(JSON.stringify({
  suite: "w6a-single-emulator-regression",
  passed: true,
  projectId,
  w2ToW5Regression: true,
  quizAndHistoryLifecycle: true,
  productionAccess: 0,
}));
