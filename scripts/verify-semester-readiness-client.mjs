import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const {
  createCommandGatewayCore,
} = require("./productionGateway/commandGateway.js");
let epoch = 1800000000;
const owner = { uid: "admin", email: "westoria28@gmail.com" };
const auth = { currentUser: owner };
const proof = {
  authorityGeneration: "w1r2-2026-08-09",
  protocolVersion: 2,
  revision: "a".repeat(64),
};
const ready = () => ({
  requested: { semesterId: "2026-2", revision: 8, status: "ACTIVE" },
  error: null,
  readiness: { current: true, reason: null },
});
let state = ready(),
  pending = null;
const calls = [];
const gateway = createCommandGatewayCore({
  store: {
    runTransaction: () => {
      throw new Error("Unexpected readiness write");
    },
  },
  assertSession: async (request, options) => {
    assert.deepEqual(options, { recentAuth: false, highRisk: false });
    assert.deepEqual(request.data._session, proof);
    return { uid: request.auth.uid, email: request.auth.token.email };
  },
  semesterCoreResolver: async ({ semesterId }) => {
    assert.equal(semesterId, "2026-2");
    if (pending) await pending;
    return state;
  },
});
const compile = (file, imports) => {
  const exports = {};
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(source, {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error("Unexpected import: " + name);
    },
  });
  return exports;
};
const session = compile("src/lib/historyDictionarySession.ts", {
  "firebase/auth": {
    getIdTokenResult: async () => ({
      authTime: new Date(epoch * 1000).toISOString(),
    }),
  },
  "./firebase": {
    auth,
    getHttpsCallable: async (name) => async (data) => {
      calls.push({ name, data });
      if (name === "openApplicationSession")
        return { data: { ...proof, status: "active", authTime: epoch } };
      assert.equal(name, "getSemesterCoreState");
      assert.deepEqual(Object.keys(data).sort(), ["_session", "semesterId"]);
      return {
        data: await gateway.getSemesterCoreState({
          auth: {
            uid: auth.currentUser.uid,
            token: { email: auth.currentUser.email },
          },
          data: JSON.parse(JSON.stringify(data)),
        }),
      };
    },
  },
});
const client = compile("src/lib/semesterReadiness.ts", {
  "./firebase": { auth },
  "./historyDictionarySession": session,
});
const read = () => client.loadSemesterReadiness("2026", "2");
assert.equal((await read()).status, "ready");
assert.equal(
  calls.filter((item) => item.name === "getSemesterCoreState").length,
  1,
);
console.log(
  "PASS canonical read-only gateway payload and real general-session wrapper",
);
for (const reason of [
  "SEMESTER_READINESS_NOT_FOUND",
  "SEMESTER_READINESS_STALE",
  "SEMESTER_POLICY_VERSION_MISMATCH",
  "SEMESTER_READINESS_NOT_PASS",
]) {
  state = { ...ready(), readiness: { current: false, reason } };
  const result = await read();
  assert.equal(result.status, "partial");
  assert.equal(result.missingRequiredCount, 1);
  assert.equal(result.requiredItems[0].ready, false);
  assert.doesNotMatch(result.requiredItems[0].detail, /SEMESTER_/);
}
state = {
  ...ready(),
  requested: null,
  error: "SEMESTER_NOT_FOUND",
  readiness: { current: false, reason: "SEMESTER_NOT_FOUND" },
};
assert.equal((await read()).status, "danger");
state = { ...ready(), error: "CONFLICTING_ACTIVE_SEMESTER" };
assert.equal((await read()).status, "danger");
console.log(
  "PASS missing/stale/policy/failed readiness never appears ready and conflicts remain blocked",
);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ReadinessPanel = compile(
  "src/pages/teacher/components/SettingsSemesterReadiness.tsx",
  { react: React, "react/jsx-runtime": require("react/jsx-runtime") },
).default;
state = {
  ...ready(),
  readiness: {
    current: false,
    reason: "SEMESTER_READINESS_DEPENDENCY_CHANGED",
  },
};
const reference = await read();
assert.equal(reference.status, "reference");
assert.equal(reference.requiredItems.length, 0);
assert.equal(reference.missingRequiredCount, 0);
assert.equal(reference.advisoryItems[0].ready, false);
const markup = renderToStaticMarkup(
  React.createElement(ReadinessPanel, {
    readiness: reference,
    loading: false,
    error: "",
    semesterLabel: "2026학년도 2학기",
    showTransitionImpact: false,
  }),
);
assert.match(markup, /개시 전 검증 기록 이후 운영 자료가 변경/);
assert.match(markup, /학생 로그인이나 학습 기능이 차단되지는 않습니다/);
assert.doesNotMatch(markup, /검증 완료|검증이 완료|기준 충족|재검증|필수 확인/);
for (const status of ["PREPARING", "VALIDATING", "READY", "CLOSING"]) {
  state.requested.status = status;
  const result = await read();
  assert.equal(result.status, "partial");
  assert.equal(result.requiredItems[0].ready, false);
  assert.match(result.requiredItems[0].detail, /재검증/);
}
state.requested.status = "ACTIVE";
state.error = "CONFLICTING_ACTIVE_SEMESTER";
assert.equal((await read()).status, "danger");
console.log(
  "PASS ACTIVE dependency drift is reference-only in actual panel; preparing and conflict checks remain strict",
);
for (const invalid of [
  null,
  { ...ready(), readiness: {} },
  { ...ready(), requested: { semesterId: "2026-1" } },
]) {
  state = invalid;
  await assert.rejects(read(), /응답/);
}
await assert.rejects(client.loadSemesterReadiness("2026", "3"), /학년도/);
console.log("PASS malformed and mismatched-scope responses are rejected");
state = ready();
let release;
pending = new Promise((resolve) => {
  release = resolve;
});
let flight = read();
await new Promise((resolve) => setTimeout(resolve, 0));
auth.currentUser = { uid: "another", email: owner.email };
release();
await assert.rejects(flight, /로그인/);
auth.currentUser = owner;
pending = new Promise((resolve) => {
  release = resolve;
});
flight = read();
await new Promise((resolve) => setTimeout(resolve, 0));
epoch++;
release();
await assert.rejects(flight, /로그인/);
pending = null;
auth.currentUser = { uid: "student", email: "student@yongshin-ms.ms.kr" };
await assert.rejects(read(), (error) => error.code === "permission-denied");
console.log(
  "PASS stale owner/auth epoch discard and actual gateway administrator-only authorization",
);
console.log("Semester readiness client: 5 groups passed.");
