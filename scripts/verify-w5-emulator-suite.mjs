import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectId =
  process.env.WESTORY_TEST_PROJECT_ID || "demo-westory-session-w5";
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

const scripts = [
  ["scripts/verify-w4-emulator-suite.mjs"],
  ["functions/scripts/verify-student-maintenance.cjs", "--integration"],
  ["scripts/verify-student-maintenance-rules.mjs"],
];

for (const args of scripts) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, WESTORY_TEST_PROJECT_ID: projectId },
    stdio: "inherit",
  });
  assert.equal(result.error, undefined, `${args[0]} could not start.`);
  assert.equal(result.status, 0, `${args[0]} failed with ${result.status}.`);
}

console.log(
  JSON.stringify({
    suite: "w5-single-emulator-regression",
    passed: true,
    projectId,
    w2ToW4Regression: true,
    maintenanceFunctionsAndRules: true,
    productionAccess: 0,
  }),
);
