// Actual teacher helpers and callable factory; controlled SDK/session/reauth I/O.
// No Firebase initialization, browser, network or backend authorization claim.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";

const compile = (source) =>
  transformSync(source, { loader: "ts", format: "cjs" }).code;
const source = readFileSync("src/lib/firebase.ts", "utf8");
const factory = source
  .slice(
    source.indexOf("const getHttpsCallable ="),
    source.indexOf("const getFirebaseStorage ="),
  )
  .replaceAll('import("firebase/functions")', "loadFunctions()")
  .replaceAll('import("./applicationSession")', "loadSession()");
assert.ok(factory.includes("assertExpectedOwner"));
assert.ok(!factory.includes("import("));
const factoryCode = compile(
  factory + "\nmodule.exports = { getHttpsCallable };\n",
);
const helperCode = compile(
  readFileSync("src/lib/historyDictionary.ts", "utf8"),
);
const load = (code, imports = {}, globals = {}) => {
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    TextEncoder,
    ...globals,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected module ${name}`);
      return imports[name];
    },
    fetch: () => {
      throw Error("Network forbidden");
    },
  });
  return module.exports;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const methods = [
  "saveHistoryDictionaryTerm",
  "approveHistoryDictionaryTermForRequests",
  "updateStudentHistoryDictionaryWordByTeacher",
  "deleteStudentHistoryDictionaryWordByTeacher",
];
const cases = [];
for (const method of methods) {
  for (const phase of ["factory", "session", "reauth"]) {
    for (const changeIdentity of [false, true]) {
      const gate = deferred(),
        entered = deferred(),
        auth = { currentUser: { uid: "teacher-a" } },
        calls = [],
        preparations = [],
        optionsSeen = [];
      const pause = async (boundary) => {
        if (boundary === phase) {
          entered.resolve();
          await gate.promise;
        }
      };
      class StepUpReauthError extends Error {
        constructor(reason, message) {
          super(message);
          this.reason = reason;
        }
      }
      const raw = async (payload) => {
        calls.push(JSON.parse(JSON.stringify(payload)));
        return { data: { termId: "term-a", updated: true } };
      };
      raw.stream = raw;
      const actual = load(
        factoryCode,
        {},
        {
          auth,
          StepUpReauthError,
          getFirebaseFunctions: async () => {
            await pause("factory");
            return {};
          },
          loadFunctions: async () => ({ httpsCallable: () => raw }),
          loadSession: async () => {
            await pause("session");
            return {
              prepareCallableDataWithApplicationSession: (_name, payload) => {
                preparations.push(auth.currentUser.uid);
                return payload;
              },
            };
          },
          isHighRiskCommand: () => true,
          runHighRiskCommandSingleFlight: (_name, _data, run) => run(),
          requestStepUpReauthentication: () => pause("reauth"),
        },
      );
      const helpers = load(helperCode, {
        "firebase/firestore": {},
        "./commandGateway": {
          WestoryCommandError: class extends Error {},
          hasPendingWestoryCommand: async () => false,
          executeWestoryCommand: async (name, payload, options) => {
            optionsSeen.push({ name, ...options });
            const callable = await actual.getHttpsCallable(
              "executeCommand",
              options,
            );
            return { result: (await callable(payload)).data };
          },
        },
        "./semesterScope": {
          getYearSemester: (config) => ({
            year: config.year,
            semester: config.semester,
          }),
        },
        "./firebase": {
          auth,
          db: {},
          getHttpsCallable: (name, options) => {
            optionsSeen.push({ name, ...options });
            return actual.getHttpsCallable(name, options);
          },
        },
      });
      const config = { year: "2026", semester: "2" };
      const input = {
        word: "원래 단어",
        definition: "원래 뜻풀이입니다.",
        studentLevel: "중학생 수준",
        tags: ["원래 태그"],
        relatedUnitId: "unit-a",
        uid: "student-a",
        termId: "term-a",
        requestId: "request-a",
        fallbackUid: "student-a",
        fallbackRequestId: "request-a",
        year: "2026",
        semester: "1",
        reason: "teacher_review",
        expectedWordVersion: "42:123456789",
        expectedTermVersion: "42:123456789",
        expectedRequestVersion: "42:123456789",
      };
      const pending = helpers[method](config, input, "teacher-a").then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      await entered.promise;
      config.year = "2027";
      config.semester = "1";
      input.word = "새 단어";
      input.definition = "새 풀이";
      input.uid = "student-b";
      input.termId = "term-b";
      input.requestId = "request-b";
      input.fallbackUid = "student-b";
      input.fallbackRequestId = "request-b";
      input.tags.push("새 태그");
      input.year = "2028";
      input.semester = "2";
      if (changeIdentity) auth.currentUser = { uid: "teacher-b" };
      gate.resolve();
      const result = await pending;
      assert.deepEqual(optionsSeen, [
        { name: method, expectedUid: "teacher-a" },
      ]);
      if (changeIdentity) {
        assert.equal(result.error?.reason, "IDENTITY_CHANGED");
        assert.equal(calls.length, 0);
        assert.equal(preparations.length, 0);
      } else {
        assert.equal(result.error, undefined);
        assert.equal(calls.length, 1);
        const payload = calls[0];
        assert.equal(payload.year, "2026");
        assert.equal(
          payload.semester,
          method.includes("ByTeacher") ? "1" : "2",
        );
        if (method !== "approveHistoryDictionaryTermForRequests")
          assert.equal(payload.word, "원래 단어");
        if (method.includes("ByTeacher"))
          assert.equal(payload.uid, "student-a");
        if (method !== "saveHistoryDictionaryTerm")
          assert.equal(payload.termId, "term-a");
        if (method === "saveHistoryDictionaryTerm") {
          assert.deepEqual(payload.tags, ["원래 태그"]);
          assert.equal(payload.fallbackUid, "student-a");
          assert.equal(payload.fallbackRequestId, "request-a");
        }
      }
      cases.push(
        `${method}: ${phase} ${changeIdentity ? "identity changed rejects before send" : "original payload and scope preserved"}`,
      );
      for (const expectedUid of ["", "teacher-c"]) {
        const before = optionsSeen.length;
        await assert.rejects(
          helpers[method](config, input, expectedUid),
          /로그인 사용자가 바뀌었습니다/,
        );
        assert.equal(optionsSeen.length, before);
      }
    }
  }
}
console.log(
  JSON.stringify({
    passed: true,
    scenarios: cases.length,
    staleOwnerPreflightChecks: cases.length * 2,
    cases,
    networkAccess: 0,
    coverage:
      "Actual historyDictionary teacher helpers and actual getHttpsCallable factory; SDK/session/step-up/single-flight I/O controlled, high-risk branch exercised",
    exclusions: [
      "Actual Google/SDK transport",
      "Server authorization",
      "Gateway/CAS",
      "Browser UI",
    ],
  }),
);
