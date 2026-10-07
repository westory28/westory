const assert = require("node:assert/strict");

// Import the actual deployment entrypoint without contacting live services.
process.env.GCLOUD_PROJECT = "demo-westory-session-exports";
process.env.GOOGLE_CLOUD_PROJECT = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_CONFIG = JSON.stringify({
  projectId: process.env.GCLOUD_PROJECT,
});
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:18192";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:19192";

const deployedFunctions = require("../index.js");
const { callableExports } = require("../sessionAuthority");
const lifecycleNames = [
  "openApplicationSession",
  "beginApplicationSessionReauthentication",
  "touchApplicationSession",
  "closeApplicationSession",
];

for (const name of lifecycleNames) {
  const callable = deployedFunctions[name];
  assert.equal(typeof callable, "function", `index.js must export ${name}.`);
  assert.equal(
    callable,
    callableExports[name],
    `${name} must use the canonical sessionAuthority callable.`,
  );
  assert.deepEqual(
    callable.__endpoint?.region,
    ["asia-northeast3"],
    `${name} must deploy in asia-northeast3.`,
  );
  assert.equal(
    callable.__endpoint?.platform,
    "gcfv2",
    `${name} must remain a second-generation function.`,
  );
  assert.ok(
    Object.hasOwn(callable.__endpoint, "callableTrigger"),
    `${name} must be an HTTPS callable function.`,
  );
  assert.equal(typeof callable.run, "function", `${name} must expose its callable handler.`);
}

console.log(JSON.stringify({
  suite: "login-functions-deployment-exports",
  passed: true,
  functions: lifecycleNames,
  region: "asia-northeast3",
}));
