const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const origin = require("../historyDictionaryRequestOrigin");
const update = require("../historyDictionaryUpdate");
const deletion = require("../historyDictionaryDelete");
const hash = (value) => crypto.createHash("sha1").update(value).digest("hex");
const termId = (word) => `term_${hash(word)}`;
const uid = "student-origin";
const requestId = `req_${hash(`2026:2:${uid}:b`)}`;
const base = {
  target: { uid, termId: termId("b"), year: "2026", semester: "2" },
  profile: { uid, role: "student" },
  wordData: {
    uid,
    termId: termId("b"),
    year: "2026",
    semester: "2",
    word: "B",
    normalizedWord: "b",
    status: "requested",
    requestId,
    rewardTermId: termId("a"),
  },
  requestData: {
    uid,
    year: "2026",
    semester: "2",
    word: "B",
    normalizedWord: "b",
    status: "requested",
    matchedTermId: termId("b"),
    resolvedTermId: "",
  },
};
const renamed = () => ({
  ...structuredClone(base),
  target: { ...base.target, termId: termId("c") },
  wordData: {
    ...base.wordData,
    termId: termId("c"),
    word: "C",
    normalizedWord: "c",
    status: "saved",
    requestOriginTermId: termId("b"),
    definitionSource: "teacher_reviewed",
    reviewedBy: "teacher-origin",
    reviewedAt: 123,
  },
});
let checks = 0;
const scenarios = [];
const equal = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const test = (label, work) => {
  work();
  scenarios.push(label);
};
const inspectUpdate = (value) =>
  update.inspectRequest({ ...value, binding: update.inspectCurrent(value) });
const inspectDelete = (value) =>
  deletion.inspectTarget({
    ...value,
    target: {
      ...value.target,
      requestId: value.wordData?.requestId ?? requestId,
    },
  });
const denied = (operation, endpoint, unverified = false) => {
  assert.throws(
    operation,
    (error) =>
      error.code === "failed-precondition" &&
      error.details?.reason ===
        `HISTORY_DICTIONARY_${endpoint}_${unverified ? "UNVERIFIED" : "MISMATCH"}`,
  );
  checks++;
};
const rejectBoth = (label, modify) =>
  test(label, () => {
    const value = renamed();
    modify(value);
    const before = structuredClone(value);
    denied(() => inspectUpdate(value), "UPDATE");
    denied(() => inspectDelete(value), "DELETE");
    equal(value, before);
  });

test("directly bound request infers B without using reward A", () => {
  const before = structuredClone(base);
  equal(inspectUpdate(base), termId("b"));
  equal(inspectDelete(base).rewardTermId, termId("a"));
  equal(base, before);
});
for (const field of [undefined, "", termId("b")])
  test(`initial request origin ${field}`, () => {
    const value = structuredClone(base);
    if (field !== undefined) value.wordData.requestOriginTermId = field;
    equal(inspectUpdate(value), termId("b"));
  });
test("moved word uses request B and independently selects reward A", () => {
  const value = renamed(),
    before = structuredClone(value);
  equal(inspectUpdate(value), termId("b"));
  equal(inspectDelete(value).rewardTermId, termId("a"));
  equal(value, before);
});
test("same spelling after legacy ID move retains the explicit request origin", () => {
  const value = renamed();
  value.target.termId = termId("b");
  Object.assign(value.wordData, {
    termId: termId("b"),
    word: "B",
    normalizedWord: "b",
    requestOriginTermId: "legacy-request-b",
  });
  value.requestData.matchedTermId = "legacy-request-b";
  equal(inspectUpdate(value), "legacy-request-b");
  equal(inspectDelete(value).rewardTermId, termId("a"));
});
test("explicit legacy origin requires a real matching request reference", () => {
  const value = renamed();
  value.wordData.requestOriginTermId = "legacy-b";
  value.requestData.matchedTermId = "legacy-b";
  equal(inspectUpdate(value), "legacy-b");
  value.requestData.matchedTermId = "";
  denied(() => inspectUpdate(value), "UPDATE");
  denied(() => inspectDelete(value), "DELETE");
});
test("no-reference canonical request uses its own canonical origin", () => {
  const value = renamed();
  value.requestData.matchedTermId = "";
  equal(inspectUpdate(value), termId("b"));
  equal(inspectDelete(value).rewardTermId, termId("a"));
});
test("legacy reviewed bridge without new field remains readable", () => {
  const value = renamed();
  delete value.wordData.requestOriginTermId;
  value.wordData.rewardTermId = termId("b");
  equal(inspectUpdate(value), termId("b"));
  equal(inspectDelete(value).rewardTermId, termId("b"));
});
rejectBoth(
  "ambiguous legacy move without a request origin cannot be invented",
  (value) => {
    delete value.wordData.requestOriginTermId;
  },
);
rejectBoth(
  "explicit origin contradiction never falls back to a correct reward bridge",
  (value) => {
    value.wordData.requestOriginTermId = termId("x");
    value.wordData.rewardTermId = termId("b");
  },
);
for (const invalid of [
  null,
  0,
  false,
  {},
  [],
  "x/y",
  "x\\y",
  " x",
  "x ",
  ".",
  "..",
  "x\ny",
  "x\u0000y",
  "x\u007fy",
  "x".repeat(81),
])
  rejectBoth(`malformed stored origin ${JSON.stringify(invalid)}`, (value) => {
    value.wordData.requestOriginTermId = invalid;
  });
for (const [key, field] of [
  ["definitionSource", "student"],
  ["reviewedBy", "x/y"],
  ["reviewedAt", null],
])
  rejectBoth(`moved request requires ${key}`, (value) => {
    value.wordData[key] = field;
  });
rejectBoth("two request references must agree", (value) => {
  value.requestData.resolvedTermId = termId("a");
});
for (const [key, field] of [
  ["uid", "other"],
  ["year", "2025"],
  ["semester", "1"],
  ["word", "X"],
  ["status", "rejected"],
])
  rejectBoth(`outer request binding still validates ${key}`, (value) => {
    value.requestData[key] = field;
  });
test("orphan valid origin on a direct row grants no request authority and is cleared", () => {
  const value = renamed();
  value.wordData.requestId = "";
  value.requestData = null;
  equal(inspectUpdate(value), "");
  equal(inspectDelete(value).rewardTermId, termId("a"));
});
test("unscoped legacy direct row still avoids caller reward inference", () => {
  const value = structuredClone(base);
  value.wordData = {
    termId: termId("b"),
    word: "B",
    status: "saved",
    requestId: "",
  };
  value.requestData = null;
  equal(inspectUpdate(value), "");
  equal(update.inspectCurrent(value).preserveUnscoped, true);
  equal(inspectDelete(value).reclaimAllowed, false);
});
test("missing request recovery requires a consistent explicit origin", () => {
  const value = structuredClone(base);
  value.requestData = null;
  value.wordData.requestOriginTermId = termId("b");
  equal(inspectDelete(value).recoverRequest, true);
  denied(() => inspectUpdate(value), "UPDATE", true);
  value.wordData.requestOriginTermId = termId("a");
  denied(() => inspectDelete(value), "DELETE", true);
});
test("stored origin reader is pure and does not normalize a path", () => {
  const record = { requestOriginTermId: "legacy_id" },
    before = structuredClone(record);
  equal(
    origin.readStoredOrigin(record, () => {
      throw Error("unexpected rejection");
    }),
    "legacy_id",
  );
  equal(record, before);
});
console.log(
  JSON.stringify({
    suite: "history-dictionary-request-origin",
    passed: true,
    checks,
    scenarios: scenarios.length,
    cases: scenarios,
    actualHelpers: true,
    networkAccess: 0,
  }),
);
