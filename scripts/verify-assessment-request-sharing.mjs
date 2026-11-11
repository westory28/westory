import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const transpile = (file) => ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
const timers = new Map();
let timerId = 0, commandId = 0, epoch = 1;
let clock = Date.now();
class TestDate extends Date { static now() { return clock; } }
let readToken = async () => ({ authTime: String(epoch) });
const setTimer = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
const clearTimer = id => timers.delete(id);
const deadlines = {};
runInNewContext(transpile("src/lib/requestDeadline.ts"), { exports: deadlines, setTimeout: setTimer, clearTimeout: clearTimer });
const auth = { currentUser: { uid: "synthetic-student" } };
const storage = new Map();
let handler;
const calls = [];
const client = {};
runInNewContext(transpile("src/lib/assessmentLifecycle.ts"), {
  exports: client,
  Date: TestDate,
  require: name => {
    if (name === "./requestDeadline") return deadlines;
    if (name === "./firebase") return { auth };
    if (name === "firebase/auth") return { getIdTokenResult: () => readToken() };
    if (name === "./sensitiveOperation") return { ensureSensitiveOperation: async () => {} };
    if (name === "./historyDictionarySession") return { getHistoryDictionaryCallable: async name => async input => {
      calls.push({ name, input });
      return { data: await handler(name, input) };
    } };
    throw Error(name);
  },
  window: { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
  crypto: { randomUUID: () => `synthetic-${++commandId}` },
  setTimeout: setTimer, clearTimeout: clearTimer,
});
const overview = semesterId => ({ semesterId, rounds: [], writeCount: 0 });
const read = semesterId => client.getMockExamOverview({ semesterId });
const unavailable = () => Object.assign(Error("Synthetic unavailable"), { code: "functions/unavailable" });

// StrictMode/rapid remount: one flight, never a completed authorization cache.
let gate = deferred();
handler = async () => gate.promise;
const concurrent = Array.from({ length: 4 }, () => read("2026-2"));
await flush();
assert.equal(calls.length, 1);
gate.resolve(overview("2026-2"));
await Promise.all(concurrent);
handler = async (_name, input) => overview(input.semesterId);
await read("2026-2");
assert.equal(calls.length, 2, "A later read must recheck current access/publication");

// Different semesters have independent requests.
calls.length = 0;
const semesters = new Map();
handler = async (_name, input) => { const next = deferred(); semesters.set(input.semesterId, next); return next.promise; };
const semesterReads = [read("2026-1"), read("2026-2")];
await flush();
assert.equal(calls.length, 2);
for (const [scope, pending] of semesters) pending.resolve(overview(scope));
await Promise.all(semesterReads);

// Shared failure is released, and only an explicit retry sends another request.
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const failed = Promise.allSettled([read("2026-2"), read("2026-2")]);
await flush();
gate.reject(unavailable());
assert.ok((await failed).every(result => result.status === "rejected"));
assert.equal(calls.length, 1);
handler = async () => overview("2026-2");
await read("2026-2");
assert.equal(calls.length, 2);

// A timed-out read cannot supply its late result to a new explicit retry.
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const timedOut = assert.rejects(read("2026-2"), /지연/);
await flush();
const deadline = [...timers.values()].find(timer => timer.delay === 15_000);
assert.ok(deadline);
deadline.callback();
await timedOut;
handler = async () => overview("2026-2");
await read("2026-2");
gate.resolve({ ...overview("2026-2"), marker: "obsolete" });
await flush();
assert.equal(calls.length, 2);

// A new auth_time on the same Firebase User object is a separate flight.
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const oldEpoch = assert.rejects(read("2026-2"), /로그인 상태가 변경/);
await flush();
epoch++;
handler = async () => overview("2026-2");
await read("2026-2");
gate.resolve(overview("2026-2"));
await oldEpoch;
assert.equal(calls.length, 2);

// A new account object with the same UID also cannot inherit the old flight.
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const oldOwner = assert.rejects(read("2026-2"), /로그인 상태가 변경/);
await flush();
auth.currentUser = { uid: "synthetic-student" };
handler = async () => overview("2026-2");
await read("2026-2");
gate.resolve(overview("2026-2"));
await oldOwner;
assert.equal(calls.length, 2);

// State/asset preparation has the same login boundary as overview and saves.
const stateInput = { definitionId: "quiz:2026-2:fixture:diagnostic" };
const stateResult = { status: "READY", definition: { id: stateInput.definitionId } };
calls.length = 0;
gate = deferred();
readToken = () => gate.promise;
const waitingForToken = assert.rejects(client.getAssessmentState(stateInput), /로그인 연결/);
await flush();
const tokenDeadline = [...timers.values()].find(timer => timer.delay === 15_000);
assert.ok(tokenDeadline);
tokenDeadline.callback();
await waitingForToken;
gate.resolve({ authTime: String(epoch) });
await flush();
assert.equal(calls.length, 0, "A late token must not dispatch after the owner deadline");
readToken = async () => ({ authTime: String(epoch) });
// Keep the existing total state-read budget even when token refresh is slow.
calls.length = 0;
const tokenGate = deferred(), responseGate = deferred();
readToken = () => tokenGate.promise;
handler = async () => responseGate.promise;
const slowLoginRead = assert.rejects(client.getAssessmentState(stateInput), /지연/);
await flush();
clock += 6000;
tokenGate.resolve({ authTime: String(epoch) });
await flush();
assert.equal(calls.length, 1);
const remainingDeadline = [...timers.values()].find(timer => timer.delay === 9000);
assert.ok(remainingDeadline, "6 seconds of token refresh leaves 9 seconds for the state read");
remainingDeadline.callback();
await slowLoginRead;
responseGate.resolve(stateResult);
await flush();
readToken = async () => ({ authTime: String(epoch) });

// An earlier caller with a slow token can join a later caller's live flight.
// Its own 15-second budget must not inherit the later transport's deadline.
calls.length = 0;
const joiningTokenGate = deferred(), sharedResponseGate = deferred();
let joiningTokenReads = 0, laterCallerSettled = false;
readToken = () => ++joiningTokenReads === 1
  ? joiningTokenGate.promise
  : Promise.resolve({ authTime: String(epoch) });
handler = async () => sharedResponseGate.promise;
const earlierStartedAt = clock;
const earlierCaller = assert.rejects(client.getAssessmentState(stateInput), {
  code: "functions/deadline-exceeded",
});
await flush();
clock += 13000;
const laterCaller = client.getAssessmentState(stateInput);
void laterCaller.then(
  () => { laterCallerSettled = true; },
  () => { laterCallerSettled = true; },
);
await flush();
assert.equal(calls.length, 1, "The later caller starts the only shared transport");
clock += 1000;
joiningTokenGate.resolve({ authTime: String(epoch) });
await flush();
assert.equal(calls.length, 1, "The earlier caller joins without a second transport");
const joiningDeadline = [...timers.values()].find(timer => timer.delay === 1000);
assert.ok(joiningDeadline, "A caller joining after 14 seconds retains only its final second");
clock += 1000;
joiningDeadline.callback();
await earlierCaller;
assert.equal(clock - earlierStartedAt, 15000);
assert.equal(laterCallerSettled, false, "One caller's timeout must not cancel the later caller");
const thirdCaller = client.getAssessmentState(stateInput);
await flush();
assert.equal(calls.length, 1, "A caller timeout must not evict another caller's live transport");
sharedResponseGate.resolve(stateResult);
assert.equal((await laterCaller).status, "READY");
assert.equal((await thirdCaller).status, "READY");
await flush();
readToken = async () => ({ authTime: String(epoch) });

calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const stateReads = Array.from({ length: 4 }, () => client.getAssessmentState({ ...stateInput }));
await flush();
assert.equal(calls.length, 1, "Concurrent state reads share only one transport");
gate.resolve(stateResult);
await Promise.all(stateReads);
handler = async () => stateResult;
await client.getAssessmentState(stateInput);
assert.equal(calls.length, 2, "A later state read rechecks live access");

calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const obsoleteState = assert.rejects(client.getAssessmentState(stateInput), /로그인 상태가 변경/);
await flush();
epoch++;
handler = async () => stateResult;
const freshState = client.getAssessmentState(stateInput);
await flush();
assert.equal(calls.length, 2, "Reauthentication on the same User must dispatch a new state read");
assert.equal((await freshState).status, "READY");
gate.resolve(stateResult);
await obsoleteState;

calls.length = 0;
const stateGates = [];
handler = async () => { const next = deferred(); stateGates.push(next); return next.promise; };
const differentStates = [client.getAssessmentState(stateInput), client.getAssessmentState({ ...stateInput, prepareAssets: true }), client.getAssessmentState({ attemptId: "another-attempt" })];
await flush();
assert.equal(calls.length, 3, "State, asset preparation and another attempt remain distinct");
stateGates.forEach(next => next.resolve(stateResult));
await Promise.all(differentStates);

calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const lostStates = Promise.allSettled([client.getAssessmentState(stateInput), client.getAssessmentState(stateInput)]);
await flush();
gate.reject(unavailable());
assert.ok((await lostStates).every(result => result.status === "rejected"));
handler = async () => stateResult;
await client.getAssessmentState(stateInput);
assert.equal(calls.length, 2, "Failed state reads permit an explicit new retry");

const progress = { attemptId: "synthetic-attempt", expectedRevision: 1, answers: { q1: "조선" }, currentItemId: "q1" };
const saveResult = { attemptId: progress.attemptId, status: "IN_PROGRESS", revision: 2, savedAtIso: "2026-11-10T12:00:00.000Z", replayed: false };
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const saves = Array.from({ length: 4 }, () => client.saveAssessmentProgress(structuredClone(progress)));
await flush();
assert.equal(calls.length, 1, "Identical pending saves must send only one callable");
gate.resolve(saveResult);
await Promise.all(saves);
assert.equal(storage.size, 0);

// Different answers/attempts/revisions are never combined into the old save.
calls.length = 0;
const saveGates = [];
handler = async () => { const next = deferred(); saveGates.push(next); return next.promise; };
const distinct = [
  client.saveAssessmentProgress(progress),
  client.saveAssessmentProgress({ ...progress, answers: { q1: "고려" } }),
  client.saveAssessmentProgress({ ...progress, attemptId: "another-attempt" }),
  client.saveAssessmentProgress({ ...progress, expectedRevision: 2 }),
];
await flush();
assert.equal(calls.length, 4);
saveGates.forEach(next => next.resolve(saveResult));
await Promise.all(distinct);

// Lost save responses retain the exact receipt; no automatic write replay.
calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const lostSaves = Promise.allSettled([client.saveAssessmentProgress(progress), client.saveAssessmentProgress(progress)]);
await flush();
const retainedSaveId = calls[0].input.saveId;
gate.reject(unavailable());
assert.ok((await lostSaves).every(result => result.status === "rejected"));
assert.equal(calls.length, 1);
handler = async () => ({ ...saveResult, replayed: true });
await client.saveAssessmentProgress(progress);
assert.equal(calls.length, 2);
assert.equal(calls[1].input.saveId, retainedSaveId);
assert.equal(storage.size, 0);

calls.length = 0;
gate = deferred();
handler = async () => gate.promise;
const oldSave = assert.rejects(client.saveAssessmentProgress(progress), /로그인 상태가 변경/);
await flush();
epoch++;
handler = async () => saveResult;
await client.saveAssessmentProgress(progress);
gate.resolve(saveResult);
await oldSave;
assert.equal(calls.length, 2, "A save from the previous auth_time is never shared");
console.log("PASS assessment request sharing: 4 concurrent overview/state/save calls each use 1 transport; completed/error/timeout eviction, stalled-token and caller-specific total deadlines, explicit receipt retry, semester/account/auth_time isolation and distinct assets/answers/revisions preserved. No live network or production writes.");
