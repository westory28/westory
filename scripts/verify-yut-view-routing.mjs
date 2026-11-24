/** Which callable serves the Yut lobby and publication views; no network. */
import assert from "node:assert/strict";
import { build } from "esbuild";

const fixture = `
export const calls = [];
export const plan = { quick: [], original: [] };
const answer = (queue, name, data) => {
  const step = queue.shift() || { value: { enabled: true, from: name } };
  return new Promise((resolve, reject) =>
    setTimeout(() => (step.error ? reject(Object.assign(new Error(step.error), { code: "functions/" + step.error })) : resolve({ data: step.value })), step.afterMs || 0));
};
export const getHistoryDictionaryCallable = async (name) => async (data) => {
  calls.push({ name, action: data.action, year: data.year, semester: data.semester, keys: Object.keys(data).sort().join(",") });
  return answer(name === "commandYutRoomFast" ? plan.quick : plan.original, name, data);
};
export const db = {};
export const doc = () => ({});
export const onSnapshot = () => () => {};
`;
const bundled = await build({
  entryPoints: ["src/lib/yut.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
  plugins: [
    {
      name: "offline-service-boundary",
      setup(plugin) {
        plugin.onResolve(
          { filter: /^\.\/(historyDictionarySession|firebase)$|^firebase\/firestore$/ },
          () => ({ path: "service", namespace: "fixture" }),
        );
        plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: fixture,
          loader: "js",
        }));
      },
    },
  ],
});
const source = bundled.outputFiles[0].text.replace(
  /export \{/,
  "export { calls as __calls, plan as __plan,",
);
let unhandled = 0;
process.on("unhandledRejection", () => {
  unhandled += 1;
});
let scenario = 0;
/** A fresh module instance: what the endpoint supports is unknown again. */
const fresh = async () => {
  scenario += 1;
  const module = await import(
    "data:text/javascript;base64," +
      Buffer.from(`${source}\n// scenario ${scenario}`).toString("base64")
  );
  return { ...module, calls: module.__calls, plan: module.__plan };
};
const config = { year: "2026", semester: "2" };
const names = (calls) => calls.map((call) => call.name + (call.action ? `:${call.action}` : ""));
const refused = (promise) => promise.then(() => "answered", (error) => error.code);
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

{
  // A deployment that predates the views: one probe, then the Seoul callables.
  const yut = await fresh();
  yut.plan.quick.push({ error: "invalid-argument", afterMs: 5 });
  yut.plan.original.push({ value: { enabled: true, from: "seoul" }, afterMs: 20 });
  assert.equal((await yut.getYutPublication(config)).from, "seoul");
  assert.deepEqual(names(yut.calls), ["commandYutRoomFast:publication", "getYutPublication"]);
  assert.deepEqual(yut.calls[0], { name: "commandYutRoomFast", action: "publication", year: "2026", semester: "2", keys: "action,semester,year" });
  assert.equal(yut.calls[1].keys, "semester,year", "the original callable receives exactly what it always did");
  yut.calls.length = 0;
  await yut.getYutPublication(config);
  await yut.getYutLobby(config);
  assert.deepEqual(names(yut.calls), ["getYutPublication", "getYutLobby"], "an older deployment is not asked again");
}
{
  // The endpoint answers first: it serves every later view alone.
  const yut = await fresh();
  yut.plan.quick.push({ value: { enabled: true, from: "command" }, afterMs: 5 });
  yut.plan.original.push({ value: { enabled: true, from: "seoul" }, afterMs: 40 });
  assert.equal((await yut.getYutPublication(config)).from, "command");
  await settle();
  yut.calls.length = 0;
  yut.plan.quick.push({ value: { enabled: true, room: null, from: "command" } });
  assert.equal((await yut.getYutLobby(config)).from, "command");
  assert.deepEqual(names(yut.calls), ["commandYutRoomFast:lobby"]);
  // A refusal is final and is not asked a second time elsewhere.
  for (const code of ["permission-denied", "unauthenticated", "failed-precondition"]) {
    yut.calls.length = 0;
    yut.plan.quick.push({ error: code });
    assert.equal(await refused(yut.getYutPublication(config)), `functions/${code}`);
    assert.deepEqual(names(yut.calls), ["commandYutRoomFast:publication"]);
  }
  // A lost or unanswered request is asked once through the original callable.
  for (const code of ["internal", "unavailable", "deadline-exceeded"]) {
    yut.calls.length = 0;
    yut.plan.quick.push({ error: code });
    yut.plan.original.push({ value: { enabled: true, from: "seoul" } });
    assert.equal((await yut.getYutPublication(config)).from, "seoul");
    assert.deepEqual(names(yut.calls), ["commandYutRoomFast:publication", "getYutPublication"]);
  }
  yut.calls.length = 0;
  yut.plan.quick.push({ error: "unavailable" });
  yut.plan.original.push({ error: "permission-denied" });
  assert.equal(await refused(yut.getYutLobby(config)), "functions/permission-denied", "the original callable's refusal stands");
  // A rollback to the older deployment is noticed and remembered.
  yut.calls.length = 0;
  yut.plan.quick.push({ error: "invalid-argument" });
  yut.plan.original.push({ value: { enabled: true, from: "seoul" } });
  assert.equal((await yut.getYutLobby(config)).from, "seoul");
  yut.calls.length = 0;
  await yut.getYutPublication(config);
  assert.deepEqual(names(yut.calls), ["getYutPublication"]);
}
{
  // Until the endpoint has answered, the original callable decides as before.
  const yut = await fresh();
  yut.plan.quick.push({ value: { enabled: true, from: "command" }, afterMs: 40 });
  yut.plan.original.push({ error: "permission-denied", afterMs: 5 });
  assert.equal(await refused(yut.getYutPublication(config)), "functions/permission-denied");
  await settle();
  // ...while a slow or failing endpoint cannot delay or fail the answer.
  const slow = await fresh();
  slow.plan.quick.push({ error: "unavailable", afterMs: 40 });
  slow.plan.original.push({ value: { enabled: true, from: "seoul" }, afterMs: 5 });
  assert.equal((await slow.getYutLobby(config)).from, "seoul");
  await settle();
  slow.calls.length = 0;
  slow.plan.quick.push({ value: { enabled: true, from: "command" }, afterMs: 5 });
  slow.plan.original.push({ value: { enabled: true, from: "seoul" }, afterMs: 40 });
  assert.equal((await slow.getYutPublication(config)).from, "command");
  assert.deepEqual(names(slow.calls), ["commandYutRoomFast:publication", "getYutPublication"], "an unanswered endpoint is asked beside the original once more");
  await settle();
  const both = await fresh();
  both.plan.quick.push({ error: "permission-denied", afterMs: 5 });
  both.plan.original.push({ value: { enabled: true, from: "seoul" }, afterMs: 30 });
  assert.equal((await both.getYutPublication(config)).from, "seoul", "before it has answered, the endpoint alone cannot refuse");
}
{
  // Commands and the teacher views keep their callables and payloads.
  const yut = await fresh();
  yut.plan.quick.push({ value: { room: null, serverNowMs: 1 } });
  await yut.commandYutRoom(config, { action: "match", requestKey: "routing-check-key" });
  yut.plan.original.push({ value: { settings: {}, rooms: [], truncated: false, serverNowMs: 1 } });
  await yut.getYutManagement(config);
  assert.deepEqual(names(yut.calls), ["commandYutRoomFast:match", "getYutManagement"]);
  assert.equal(yut.calls[0].keys, "action,requestKey,semester,year");
}
await settle();
assert.equal(unhandled, 0, "no unhandled promise rejection");
console.log(
  "PASS Yut view routing: older deployment falls back after one probe; the command endpoint serves later views alone; refusals are final; lost requests and rollbacks fall back; the original callable decides until the endpoint has answered; commands and teacher views unchanged.",
);
