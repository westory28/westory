const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { DEFAULT_LIMITS, createThinkCloudSubmitQueue, createThinkCloudFastHandler } = require("../productionGateway/thinkCloudSubmitQueue");
const maintenance = require("../productionGateway/studentMaintenance");
const { Timestamp } = require("firebase-admin/firestore");

const request = (label, sessionId = "topic") => ({ auth: { uid: "synthetic-student" },
  data: { commandType: "submitThinkCloudResponse", payload: { semesterId: "2026-2", sessionId } }, label });
const gate = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const reason = (expected) => (error) => error.code === "resource-exhausted" && error.details?.reason === expected && error.details?.retryable === true;

test("only valid authenticated Think Cloud submissions are queued; other commands retain exact passthrough", async () => {
  const calls = [];
  const result = Promise.resolve("unchanged");
  const wrapped = createThinkCloudSubmitQueue((input) => { calls.push(input); return result; });
  const inputs = [undefined, {}, { data: request("x").data }, { ...request("x"), auth: { uid: "" } },
    { ...request("x"), data: { commandType: "grantWis" } },
    { ...request("x"), data: { commandType: "submitThinkCloudResponse", payload: { semesterId: "2026-3", sessionId: "x" } } },
    request("x", "topic/other"), request("x", "x".repeat(181))];
  for (const input of inputs) assert.equal(wrapped(input), result);
  assert.deepEqual(calls, inputs);
});

test("one session runs FIFO while different sessions run independently; failures release the map", async () => {
  const first = gate();
  const calls = [];
  const wrapped = createThinkCloudSubmitQueue(async (input) => {
    calls.push(input.label);
    if (input.label === "first") return first.promise;
    if (input.label === "second") throw Error("preserved core error");
    return input.label;
  }, { maxSessions: 2 });
  const one = wrapped(request("first"));
  const second = wrapped(request("second"));
  const secondCheck = assert.rejects(second, /preserved core error/);
  const third = wrapped(request("third"));
  assert.equal(await wrapped(request("parallel", "other-topic")), "parallel");
  assert.deepEqual(calls, ["first", "parallel"]);
  first.resolve("finished");
  assert.equal(await one, "finished");
  await secondCheck;
  assert.equal(await third, "third");
  await tick();
  assert.deepEqual(calls, ["first", "parallel", "second", "third"]);
  assert.equal(await wrapped(request("new-key", "new-topic")), "new-key");
});

test("key, per-session and global limits reject before executing and capacity is reclaimed", async () => {
  for (const configuration of [
    { maxSessions: 1 }, { maxPending: 1 }, { perSessionPending: 1 },
  ]) {
    const first = gate();
    let calls = 0;
    const wrapped = createThinkCloudSubmitQueue(async () => { calls++; return first.promise; }, configuration);
    const active = wrapped(request("active"));
    await tick();
    let waiting;
    if (configuration.maxSessions) {
      await assert.rejects(wrapped(request("extra", "other")), reason("THINK_CLOUD_SUBMIT_QUEUE_FULL"));
    } else {
      waiting = wrapped(request("waiting"));
      await assert.rejects(wrapped(request("extra")), reason("THINK_CLOUD_SUBMIT_QUEUE_FULL"));
    }
    assert.equal(calls, 1);
    first.resolve("ok");
    await active;
    if (waiting) await waiting;
    await tick();
    assert.equal(await wrapped(request("reclaimed", "next")), "ok");
  }
});

test("wait timeout removes an unstarted job and never cancels or repeats an active transaction", async () => {
  const first = gate();
  const calls = [];
  const wrapped = createThinkCloudSubmitQueue(async (input) => {
    calls.push(input.label);
    return input.label === "active" ? first.promise : input.label;
  }, { waitTimeoutMs: 25, maxSessions: 1 });
  const active = wrapped(request("active"));
  await tick();
  await assert.rejects(wrapped(request("expired")), reason("THINK_CLOUD_SUBMIT_WAIT_TIMEOUT"));
  assert.deepEqual(calls, ["active"]);
  first.resolve("committed once");
  assert.equal(await active, "committed once");
  await tick();
  assert.equal(await wrapped(request("fresh", "next")), "fresh");
  assert.deepEqual(calls, ["active", "fresh"]);
});

test("core authorization is evaluated at start after queueing, preserving revocation", async () => {
  const first = gate();
  let authorized = true;
  let executions = 0;
  const wrapped = createThinkCloudSubmitQueue(async (input) => {
    if (!authorized) throw Object.assign(Error("revoked while waiting"), { code: "permission-denied" });
    executions++;
    return input.label === "first" ? first.promise : "ok";
  });
  const active = wrapped(request("first"));
  await tick();
  const waiting = wrapped(request("waiting"));
  const rejected = assert.rejects(waiting, (error) => error.code === "permission-denied");
  authorized = false;
  first.resolve("ok");
  await active;
  await rejected;
  assert.equal(executions, 1);
});

test("production wiring wraps execute only and keeps bounded documented defaults", () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxSessions: 64, maxPending: 512, perSessionPending: 64, waitTimeoutMs: 15000 });
  const production = readFileSync(path.resolve(__dirname, "../productionGateway/productionSource.js"), "utf8");
  assert.match(production, /\.\.\.commandGatewayCore, execute: createThinkCloudSubmitQueue\(commandGatewayCore\.execute,/);
  assert.match(production, /dequeuedExecute: studentMaintenance\.withStudentMaintenanceGuard\(commandGatewayCore\.execute\)/);
  for (const invalid of [0, -1, 1.5, Infinity]) assert.throws(() => createThinkCloudSubmitQueue(() => {}, { maxSessions: invalid }), TypeError);
});

test("a blocked event loop cannot start a job after its monotonic wait deadline", async () => {
  const first = gate();
  const calls = [];
  const wrapped = createThinkCloudSubmitQueue(async (input) => {
    calls.push(input.label);
    return input.label === "active" ? first.promise : "unexpected";
  }, { waitTimeoutMs: 10 });
  const active = wrapped(request("active"));
  await tick();
  const rejected = assert.rejects(wrapped(request("expired")), reason("THINK_CLOUD_SUBMIT_WAIT_TIMEOUT"));
  const end = performance.now() + 35;
  while (performance.now() < end) { /* Exercise a delayed timer, not the timeout callback. */ }
  first.resolve("ok");
  await active;
  await rejected;
  assert.deepEqual(calls, ["active"]);
});

test("the actual maintenance and registration guards run again when a queued submit starts", async () => {
  for (const blockedBy of ["maintenance", "registration"]) {
    const first = gate();
    const documents = new Map([["users/synthetic-student", { role: "student", registrationApprovalStatus: "APPROVED" }]]);
    const reads = [];
    const service = maintenance.createStudentMaintenanceService({ db: { doc: (path) => ({ get: async () => {
      reads.push(path);
      return { exists: documents.has(path), data: () => documents.get(path) };
    } }) } });
    const calls = [];
    const core = async (input) => { calls.push(input.label); return input.label === "active" ? first.promise : "must not execute"; };
    const queue = createThinkCloudSubmitQueue(core, {
      dequeuedExecute: maintenance.withStudentMaintenanceGuard(core, { service }),
    });
    const endpoint = maintenance.withStudentMaintenanceGuard(queue, { service });
    const active = endpoint(request("active"));
    await tick();
    const queued = endpoint(request("waiting"));
    const expected = blockedBy === "maintenance" ? "student-maintenance" : "STUDENT_REGISTRATION_APPROVAL_REQUIRED";
    const rejected = assert.rejects(queued, (error) => error.code === "permission-denied" && error.details?.reason === expected);
    await tick();
    assert.deepEqual(calls, ["active"], "the second request passed the entry guard but is queued");
    if (blockedBy === "registration") documents.get("users/synthetic-student").registrationApprovalStatus = "PENDING";
    else documents.set(maintenance.CONFIG_DOCUMENT_PATH, {
      enabled: true, blockedRoles: ["student"], bypassUids: [], title: "합성 점검", message: "합성 차단",
      revision: 1, startedAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: "synthetic-teacher",
    });
    first.resolve("committed before block");
    await active;
    await rejected;
    assert.deepEqual(calls, ["active"]);
    assert.ok(reads.filter((path) => path === "users/synthetic-student").length >= 4, "actual service re-reads the profile after dequeue");
    reads.length = 0;
    await queue({ ...request("other-command"), data: { commandType: "grantWis" } });
    assert.equal(reads.length, 0, "the new dequeue guard does not run for unrelated commands");
  }
});

test("the US endpoint admits only Think Cloud submit and preserves the protected core request", async () => {
  const calls = [];
  const fast = createThinkCloudFastHandler((input) => { calls.push(input); return Promise.resolve("same receipt"); });
  const allowed = request("allowed");
  assert.equal(await fast(allowed), "same receipt");
  assert.equal(calls[0], allowed);
  for (const commandType of ["grantWis", "createThinkCloudSession", "deleteThinkCloudSession", "submitThinkCloudResponse ", undefined]) {
    assert.throws(() => fast({ ...allowed, data: { ...allowed.data, commandType } }),
      (error) => error.code === "permission-denied" && error.details?.reason === "THINK_CLOUD_FAST_SUBMIT_REQUIRED");
  }
  assert.equal(calls.length, 1);
});
