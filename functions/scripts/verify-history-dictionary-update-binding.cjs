const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  parseTarget,
  inspectCurrent,
  inspectRequest,
} = require("../historyDictionaryUpdate");
const term = (word) =>
  `term_${crypto.createHash("sha1").update(word).digest("hex")}`;
const scope = { year: "2026", semester: "2" };
const target = parseTarget({ uid: "student-a", termId: term("백제") }, scope);
const base = {
  target,
  profile: { uid: target.uid, role: "student" },
  wordData: {
    ...target,
    word: "백제",
    normalizedWord: "백제",
    status: "saved",
    requestId: "request-a",
  },
  requestData: {
    uid: target.uid,
    ...scope,
    word: "백제",
    normalizedWord: "백제",
    status: "resolved",
    resolvedTermId: target.termId,
  },
};
let checks = 0;
const scenarios = [];
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const run = (fixture) => {
  const binding = inspectCurrent(fixture);
  inspectRequest({ ...fixture, binding });
  return binding;
};
const test = (name, fn) => {
  fn();
  scenarios.push(name);
};
const deny = (fn, unverified = false) => {
  assert.throws(
    fn,
    (error) =>
      error.code === "failed-precondition" &&
      error.details?.reason ===
        `HISTORY_DICTIONARY_UPDATE_${unverified ? "UNVERIFIED" : "MISMATCH"}`,
  );
  checks++;
};
const reject = (name, patch, unverified = false) =>
  test(name, () => {
    const fixture = structuredClone(base);
    patch(fixture);
    const before = structuredClone(fixture);
    deny(() => run(fixture), unverified);
    equal(fixture, before);
  });

for (const key of ["uid", "termId"]) {
  for (const value of [
    undefined,
    null,
    3,
    {},
    "",
    " ",
    " padded",
    "padded ",
    ".",
    "..",
    "x/y",
    "x\\y",
    "x\ny",
    "x\u0000y",
    "x\u007fy",
    "a".repeat(key === "uid" ? 129 : 81),
  ]) {
    test(`raw ${key} rejects ${JSON.stringify(value)}`, () =>
      deny(() => parseTarget({ ...target, [key]: value }, scope)));
  }
}
for (const patch of [
  { year: "26" },
  { year: "2026/x" },
  { semester: "3" },
  { semester: "" },
])
  test(`invalid scope ${JSON.stringify(patch)}`, () =>
    deny(() => parseTarget(target, { ...scope, ...patch })));
for (const [key, value] of [
  ["uid", "student-b"],
  ["termId", "another-term"],
  ["year", "2025"],
  ["semester", "1"],
  ["year", ""],
  ["normalizedWord", "신라"],
  ["word", ""],
  ["word", 42],
  ["status", "rejected"],
  ["status", "unknown"],
  ["requestId", "x/y"],
  ["requestId", null],
  ["requestId", false],
  ["rewardTermId", "x/y"],
  ["rewardTermId", null],
  ["rewardTermId", 7],
])
  reject(`word ${key} ${JSON.stringify(value)}`, (f) => {
    f.wordData[key] = value;
  });
reject("word missing text identity", (f) => {
  delete f.wordData.word;
  delete f.wordData.normalizedWord;
});
reject("profile uid mismatch", (f) => {
  f.profile.uid = "student-b";
});
reject(
  "profile missing",
  (f) => {
    f.profile = null;
  },
  true,
);
reject(
  "linked request missing",
  (f) => {
    f.requestData = null;
  },
  true,
);
for (const [key, value] of [
  ["uid", "student-b"],
  ["year", "2025"],
  ["semester", "1"],
  ["year", ""],
  ["word", "신라"],
  ["normalizedWord", "신라"],
  ["status", "rejected"],
  ["status", "unknown"],
  ["matchedTermId", "another"],
  ["resolvedTermId", "another"],
])
  reject(`request ${key} ${JSON.stringify(value)}`, (f) => {
    f.requestData[key] = value;
  });

for (const status of ["requested", "needs_approval", "resolved"])
  test(`linked ${status} accepts`, () => {
    const fixture = structuredClone(base);
    fixture.requestData.status = status;
    const before = structuredClone(fixture);
    equal(run(fixture), {
      requestId: "request-a",
      currentWord: "백제",
      preserveUnscoped: false,
    });
    equal(fixture, before);
  });
for (const status of ["requested", "saved"])
  test(`current ${status} accepts`, () =>
    equal(
      run({ ...base, wordData: { ...base.wordData, status } }).currentWord,
      "백제",
    ));
for (const profile of [{}, { role: "teacher" }, { uid: target.uid }])
  test(`profile compatibility ${JSON.stringify(profile)}`, () =>
    equal(run({ ...base, profile }).currentWord, "백제"));
for (const omit of [true, false])
  test(`unscoped legacy direct ${omit}`, () => {
    const wordData = {
      termId: "legacy-id",
      word: "백제",
      status: "saved",
      ...(omit ? {} : { requestId: "", year: "", semester: "" }),
    };
    equal(
      run({
        ...base,
        target: { ...target, termId: "legacy-id" },
        wordData,
        requestData: null,
      }),
      { requestId: "", currentWord: "백제", preserveUnscoped: true },
    );
  });
test("unscoped legacy linked request accepts", () => {
  const fixture = structuredClone(base);
  for (const key of ["uid", "year", "semester"]) delete fixture.wordData[key];
  equal(run(fixture).requestId, "request-a");
});
for (const reward of [
  { rewardTermId: "original" },
  { rewardTransactionId: "historic" },
  { rewardAmount: 7 },
  { rewardAwardedAt: 1 },
]) {
  reject(
    `unscoped direct reward ${JSON.stringify(reward)}`,
    (f) => {
      delete f.wordData.year;
      delete f.wordData.semester;
      f.wordData.requestId = "";
      f.requestData = null;
      Object.assign(f.wordData, reward);
    },
    true,
  );
  test(`scoped reward metadata preserved ${JSON.stringify(reward)}`, () => {
    const fixture = structuredClone(base);
    Object.assign(fixture.wordData, reward);
    const before = structuredClone(fixture);
    run(fixture);
    equal(fixture, before);
  });
}
const renameFixture = (original = target.termId) => ({
  ...structuredClone(base),
  target: { ...target, termId: term("새 백제") },
  wordData: {
    ...base.wordData,
    termId: term("새 백제"),
    word: "새 백제",
    normalizedWord: "새 백제",
    definitionSource: "teacher_reviewed",
    reviewedBy: "teacher-a",
    reviewedAt: 123,
    rewardTermId: original,
    rewardTransactionId: "different-current-save-id",
  },
  requestData: { ...base.requestData, resolvedTermId: original },
});
for (const original of [target.termId, "legacy-original"])
  test(`rename original ${original}`, () => {
    const fixture = renameFixture(original),
      before = structuredClone(fixture);
    equal(run(fixture).currentWord, "새 백제");
    equal(fixture, before);
  });
for (const [key, value] of [
  ["definitionSource", "student"],
  ["reviewedBy", "x/y"],
  ["reviewedAt", null],
  ["rewardTermId", "unrelated"],
])
  test(`rename invalid ${key}`, () => {
    const fixture = renameFixture();
    fixture.wordData[key] = value;
    deny(() => run(fixture));
  });
test("canonical request without references accepts", () => {
  const fixture = renameFixture();
  delete fixture.requestData.resolvedTermId;
  equal(run(fixture).currentWord, "새 백제");
});
test("legacy request without reference cannot prove rename", () => {
  const fixture = renameFixture("legacy-original");
  delete fixture.requestData.resolvedTermId;
  deny(() => run(fixture));
});
test("same spelling with moved legacy ID supports subsequent update and delete", () => {
  const { inspectTarget } = require("../historyDictionaryDelete");
  const fixture = renameFixture("legacy-original");
  fixture.target.termId = target.termId;
  Object.assign(fixture.wordData, {
    termId: target.termId,
    word: "백제",
    normalizedWord: "백제",
  });
  equal(run(fixture).currentWord, "백제");
  equal(
    inspectTarget({
      ...fixture,
      target: { ...fixture.target, requestId: "request-a" },
    }).rewardTermId,
    "legacy-original",
  );
  for (const patch of [
    { definitionSource: "student" },
    { reviewedBy: "bad/id" },
    { reviewedAt: null },
    { rewardTermId: "unrelated" },
    { rewardTermId: "" },
  ]) {
    const invalid = { ...fixture, wordData: { ...fixture.wordData, ...patch } };
    deny(() => run(invalid));
    assert.throws(
      () =>
        inspectTarget({
          ...invalid,
          target: { ...invalid.target, requestId: "request-a" },
        }),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "HISTORY_DICTIONARY_DELETE_MISMATCH",
    );
    checks++;
  }
  const contradictory = {
    ...fixture,
    requestData: { ...fixture.requestData, matchedTermId: target.termId },
  };
  deny(() => run(contradictory));
  assert.throws(
    () =>
      inspectTarget({
        ...contradictory,
        target: { ...fixture.target, requestId: "request-a" },
      }),
    (error) => error.details?.reason === "HISTORY_DICTIONARY_DELETE_MISMATCH",
  );
  checks++;
});
test("distinct origins derive a request origin independently before ID moves", () => {
  const fixture = structuredClone(base);
  fixture.wordData.rewardTermId = "earlier-reward-origin";
  const before = structuredClone(fixture);
  equal(run(fixture).currentWord, "백제");
  equal(
    inspectRequest({ ...fixture, binding: inspectCurrent(fixture) }),
    target.termId,
  );
  equal(fixture, before);
  const direct = {
    ...fixture,
    wordData: { ...fixture.wordData, requestId: "" },
    requestData: null,
  };
  equal(run({ ...direct, nextTermId: term("새 이름") }).requestId, "");
  const legacy = {
    ...fixture,
    target: { ...target, termId: "legacy-current" },
    wordData: { ...fixture.wordData, termId: "legacy-current" },
    requestData: { ...fixture.requestData, resolvedTermId: "legacy-current" },
  };
  equal(
    inspectRequest({ ...legacy, binding: inspectCurrent(legacy) }),
    "legacy-current",
  );
});
console.log(
  JSON.stringify(
    { ok: true, checks, scenarios: scenarios.length, cases: scenarios },
    null,
    2,
  ),
);
