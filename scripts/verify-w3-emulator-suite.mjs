import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const projectId = "demo-westory-session-w3";
const requiredEmulatorHosts = [
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
];

for (const variable of requiredEmulatorHosts) {
  assert.ok(
    process.env[variable],
    `${variable} is required; run this suite through firebase emulators:exec.`,
  );
}

const scripts = [
  "scripts/verify-w2a-command-gateway-rules.mjs",
  "scripts/verify-w2a-command-gateway-integration.mjs",
  "scripts/verify-w3-semester-core-rules.mjs",
  "scripts/verify-w3-semester-core-integration.mjs",
];

const resetAuthEmulator = async () => {
  const response = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );
  assert.equal(
    response.ok,
    true,
    `Auth emulator reset failed with HTTP ${response.status}.`,
  );
};

for (const script of scripts) {
  if (script.endsWith("-integration.mjs")) {
    await resetAuthEmulator();
  }
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WESTORY_TEST_PROJECT_ID: projectId,
    },
    stdio: "inherit",
  });

  assert.equal(
    result.error,
    undefined,
    `${script} could not be started: ${result.error?.message || "unknown error"}`,
  );
  assert.equal(result.status, 0, `${script} failed with status ${result.status}.`);
}

console.log(
  JSON.stringify({
    suite: "w3-single-emulator-regression",
    passed: true,
    projectId,
    scripts,
    productionAccess: 0,
  }),
);
