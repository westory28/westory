// Actual client Gateway, synthetic transport/storage; no external access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const storage = new Map();
const calls = [];
let mode = "lost";
const failure = code => Object.assign(Error(code), { code: `functions/${code}` });
const source = transformSync(readFileSync("src/lib/commandGateway.ts", "utf8"), { loader: "ts", format: "cjs" }).code;
const load = () => {
  const module = { exports: {} };
  runInNewContext(source, {
    module, exports: module.exports, crypto: webcrypto, TextEncoder,
    window: { localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    } },
    require: name => name === "./firebase" ? {
      auth: { app: { options: { projectId: "demo-retry" } }, currentUser: { uid: "teacher-a" } },
      getHttpsCallable: async name => async request => {
        calls.push({ name, ...request });
        if (mode === "lost") throw failure("unavailable");
        if (mode === "denied") throw failure("permission-denied");
        if (mode === "conflict" || mode === "deleted") throw Object.assign(failure(mode === "conflict" ? "aborted" : "not-found"), { details: { reason: mode === "conflict" ? "PATCH_NOTE_CONFLICT" : "PATCH_NOTE_NOT_FOUND" } });
        return { data: { status: "SUCCEEDED", commandId: request.commandId, result: { noteId: "one-note" } } };
      },
    } : name === "./highRiskCommands" ? { requiresCommandGatewayStepUpReauthentication: () => false } : {
      createHighRiskCommandFlightKey: (...args) => JSON.stringify(args),
      createHighRiskCommandLockName: value => value,
      runHighRiskCommandSingleFlight: async (_type, _payload, run) => run(),
      StepUpReauthError: class extends Error {},
    },
  });
  return module.exports;
};
const payload = { content: { body: "same request" } };
let gateway = load();
await assert.rejects(gateway.executeWestoryCommand("createTeacherPatchNote", payload), error => error.state === "retryable");
const originalId = calls[0].commandId;
assert.equal(storage.size, 1);
mode = "denied";
// Reload must not turn a later authorization denial into proof of non-commit.
gateway = load();
await assert.rejects(gateway.executeWestoryCommand("createTeacherPatchNote", payload), error => error.state === "retryable");
assert.equal(calls.at(-1).commandId, originalId);
assert.equal(storage.size, 1);
gateway = load();
mode = "success";
const recovered = await gateway.executeWestoryCommand("createTeacherPatchNote", payload);
assert.equal(recovered.commandId, originalId);
assert.equal(storage.size, 0);
mode = "denied";
await assert.rejects(gateway.executeWestoryCommand("createTeacherPatchNote", { content: { body: "fresh request" } }), error => error.state === "unauthorized");
assert.equal(storage.size, 0);
for (const rejection of ["conflict", "deleted"]) {
  mode = "lost";
  await assert.rejects(gateway.executeWestoryCommand("updateTeacherPatchNote", payload), error => error.state === "retryable");
  mode = rejection;
  await assert.rejects(gateway.executeWestoryCommand("updateTeacherPatchNote", payload), error => error.outcomeConfirmed === true && error.retryable === false);
  assert.equal(storage.size, 0);
}
console.log(JSON.stringify({ passed: true, checks: 15, network: 0, scenario: "lost -> denied -> reload -> same ID; lost -> confirmed conflict/deletion releases draft" }));
