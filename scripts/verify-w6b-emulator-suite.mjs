import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const PRODUCTION_PROJECT_ID = "history-quiz-yongsin";
const projectId = process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w6b";
assert.notEqual(projectId, PRODUCTION_PROJECT_ID, "Production emulator verification is forbidden.");
assert.match(projectId, /^demo-/u, "W6B emulator suite requires a demo-* project.");

for (const variable of [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_STORAGE_EMULATOR_HOST",
]) {
  assert.ok(process.env[variable], `${variable} is required through firebase emulators:exec.`);
}

const run = (script, args = [], overrides = {}) => {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WESTORY_TEST_PROJECT_ID: projectId,
      ...overrides,
    },
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

const resetFirestore = async () => {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  assert.equal(response.ok, true, `Firestore emulator reset failed with ${response.status}.`);
};

run("scripts/verify-w6a-emulator-suite.mjs");
await Promise.all([resetAuth(), resetFirestore()]);
run("scripts/verify-w6b-grade-rules.mjs");
await Promise.all([resetAuth(), resetFirestore()]);
run("scripts/verify-w6b-grade-integration.mjs");

console.log(
  JSON.stringify({
    suite: "w6b-single-emulator-regression",
    passed: true,
    projectId,
    w2ToW6aRegression: true,
    gradeRulesAndIntegration: true,
    productionAccess: 0,
  }),
);
