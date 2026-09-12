import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
const source = fs.readFileSync(new URL("../src/lib/mapTagReward.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
class WestoryCommandError extends Error { constructor(confirmed = false) { super("test"); this.outcomeConfirmed = confirmed; } }
const auth = { currentUser: { uid: "student-one" } }, calls = [];
const result = { status: "AWARDED", awarded: true, duplicate: false, amount: 10, totalAwarded: 10, balance: 10, blockedReason: "", blockedMessage: "" };
let handler = async () => ({ replayed: false, result });
const modules = {
  "./firebase": { auth },
  "./commandGateway": { WestoryCommandError, executeWestoryCommand: async (...args) => { calls.push(args); return handler(...args); } },
  "./semesterScope": { getSemesterCollectionPath: config => "years/" + config.year + "/semesters/" + config.semester + "/map_resources" },
};
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, require: name => { assert(name in modules); return modules[name]; }, crypto: { randomUUID } });
const claim = module.exports.claimMapTagReward, input = { config: { year: "2026", semester: "2" }, mapId: "map_one", tag: "고구려" };
const first = await claim(input); assert(first.awarded); assert.equal(calls[0][0], "claimMapTagReward");
assert.equal(calls[0][1].semesterId, "2026-2"); assert.equal(calls[0][1].interactionId, calls[0][2].commandId);
assert.equal(calls[0][2].expectedUid, "student-one"); assert.equal("amount" in calls[0][1], false);
handler = async () => { throw new WestoryCommandError(); };
await assert.rejects(() => claim(input)); const uncertain = calls.at(-1);
handler = async () => ({ replayed: true, result });
const recovered = await claim(input);
assert.deepEqual(calls.at(-1), uncertain); assert.equal(recovered.awarded, false); assert.equal(recovered.totalAwarded, 0); assert.equal(recovered.status, "DUPLICATE");
let release; handler = () => new Promise(resolve => { release = resolve; }); const before = calls.length;
const a = claim(input), b = claim(input); assert.equal(calls.length, before + 1);
release({ replayed: false, result }); await Promise.all([a, b]);
handler = async () => { throw new WestoryCommandError(true); }; await assert.rejects(() => claim(input)); const rejectedId = calls.at(-1)[2].commandId;
handler = async () => ({ replayed: false, result }); await claim(input); assert.notEqual(calls.at(-1)[2].commandId, rejectedId);
handler = async () => { throw new WestoryCommandError(); }; await assert.rejects(() => claim(input)); const oldId = calls.at(-1)[2].commandId;
auth.currentUser = { uid: "student-two" }; handler = async () => ({ replayed: false, result }); await claim(input);
assert.notEqual(calls.at(-1)[2].commandId, oldId); assert.equal(calls.at(-1)[2].expectedUid, "student-two");
handler = async () => { auth.currentUser = { uid: "student-three" }; return { replayed: false, result }; };
await assert.rejects(() => claim(input), /로그인 사용자가 바뀌었습니다/);
const page = fs.readFileSync(new URL("../src/pages/student/lesson/Maps.tsx", import.meta.url), "utf8");
assert(!page.includes("claimPointActivityReward"));
assert(page.includes('pointResult.awarded || pointResult.status === "DUPLICATE"'));
assert(page.includes("mapRewardPending.current = true"));
console.log("PASS map reward client: owner/scope, original retry key, recovered receipt, single flight, confirmed rejection, identity change, balance refresh");
