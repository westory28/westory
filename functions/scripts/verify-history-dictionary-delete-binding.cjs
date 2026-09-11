const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync } = require("node:fs");
const { runInNewContext } = require("node:vm");
const { resolve } = require("node:path");
const {
  parseTarget,
  inspectTarget,
  assertRewardBinding,
} = require("../historyDictionaryDelete");
const hash = (value) => crypto.createHash("sha1").update(value).digest("hex");
const scope = { year: "2026", semester: "2" };
const termId = `term_${hash("백제")}`;
const requestId = `req_${hash("2026:2:student-a:백제")}`;
const profile = { uid: "student-a", role: "student", name: "합성 학생" };
const input = {
  uid: profile.uid,
  termId,
  requestId,
  word: "백제",
  normalizedWord: "백제",
};
const word = { ...input, ...scope, status: "requested" };
const request = {
  ...input,
  ...scope,
  status: "requested",
  matchedTermId: "",
  resolvedTermId: "",
};
const target = parseTarget(input, scope);
const base = { target, wordData: word, requestData: request, profile };
let checks = 0;
const cases = [];
const test = (name, fn) => {
  try {
    fn();
    cases.push(name);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};
const eq = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
const denied = (fn, reason = "HISTORY_DICTIONARY_DELETE_MISMATCH") => {
  assert.throws(
    fn,
    (error) =>
      error.code === "failed-precondition" && error.details?.reason === reason,
  );
  checks++;
};
const rejectRecord = (key, patch, reason) => {
  const fixture = structuredClone(base);
  fixture[key] = { ...fixture[key], ...patch };
  const before = structuredClone(fixture);
  denied(() => inspectTarget(fixture), reason);
  eq(fixture, before);
};

test("deterministic IDs match actual existing sanitizers", () => {
  const source = readFileSync(resolve(__dirname, "../index.js"), "utf8");
  const text = source.slice(
    source.indexOf("const normalizeHistoryDictionaryWord ="),
    source.indexOf("const MAX_HISTORY_DICTIONARY_BULK_TERMS"),
  );
  const actual = runInNewContext(
    text +
      "\n({ normalizeHistoryDictionaryWord, buildHistoryDictionaryTermId, buildHistoryDictionaryRequestId })",
    { crypto },
  );
  for (const value of ["백제", " New  Word ", "\t한글\n단어 "]) {
    const normalized = actual.normalizeHistoryDictionaryWord(value);
    const parsed = parseTarget({ uid: profile.uid, word: value }, scope);
    eq(parsed.termId, actual.buildHistoryDictionaryTermId(normalized));
    const id = actual.buildHistoryDictionaryRequestId(
      scope.year,
      scope.semester,
      profile.uid,
      normalized,
    );
    const recovery = inspectTarget({
      target: { ...parsed, requestId: id },
      profile,
      requestData: null,
      wordData: {
        uid: profile.uid,
        termId: parsed.termId,
        requestId: id,
        normalizedWord: normalized,
        ...scope,
        status: "requested",
      },
    });
    eq(recovery.recoverRequest, true);
  }
});
for (const field of ["uid", "requestId", "termId"])
  for (const value of [
    "other/path",
    "other\\path",
    ".",
    "..",
    " bad",
    "bad\u0000",
    { id: "object" },
    false,
    0,
    "x".repeat(129),
  ])
    test(`path rejects ${field}/${JSON.stringify(value)}`, () =>
      denied(() => parseTarget({ ...input, [field]: value }, scope)));
for (const patch of [
  { word: [] },
  { normalizedWord: {} },
  { word: "다른 단어" },
  { normalizedWord: "다른 단어" },
])
  test(`input text mismatch ${JSON.stringify(patch)}`, () =>
    denied(() => parseTarget({ ...input, ...patch }, scope)));
for (const [key, patch] of [
  ["wordData", { uid: "another" }],
  ["wordData", { termId: "another" }],
  ["wordData", { requestId: "another" }],
  ["wordData", { requestId: "" }],
  ["wordData", { year: "2025" }],
  ["wordData", { semester: "1" }],
  ["wordData", { year: "" }],
  ["wordData", { normalizedWord: "다른 단어" }],
  ["wordData", { word: "다른 단어" }],
  ["wordData", { rewardTermId: "bad/path" }],
  ["requestData", { uid: "another" }],
  ["requestData", { year: "2025" }],
  ["requestData", { semester: "1" }],
  ["requestData", { year: "", semester: "" }],
  ["requestData", { normalizedWord: "다른 단어", word: "다른 단어" }],
  ["requestData", { word: "다른 단어" }],
  ["requestData", { matchedTermId: "wrong" }],
  ["requestData", { resolvedTermId: "wrong" }],
  ["requestData", { status: "rejected" }],
  ["requestData", { status: "unknown" }],
  ["profile", { uid: "another" }],
])
  test(`${key} refuses ${JSON.stringify(patch)}`, () =>
    rejectRecord(key, patch));
test("requested and needs-approval and resolved saved are valid", () => {
  for (const status of ["requested", "needs_approval", "resolved"]) {
    const fixture = {
      ...base,
      wordData: {
        ...word,
        status: status === "resolved" ? "saved" : "requested",
      },
      requestData: { ...request, status, matchedTermId: termId },
    };
    const plan = inspectTarget(fixture);
    eq(plan.rejectRequest, true);
    eq(plan.reclaimAllowed, true);
    eq(plan.recoverRequest, false);
  }
});
test("official saved legacy without UID/scope/reward deletes without ledger inference", () => {
  const plan = inspectTarget({
    ...base,
    target: { ...target, requestId: "" },
    requestData: null,
    wordData: {
      termId,
      word: "백제",
      normalizedWord: "백제",
      status: "saved",
      requestId: "",
    },
  });
  eq(plan.noop, false);
  eq(plan.reclaimAllowed, false);
  eq(plan.rejectRequest, false);
});
test("resolver saved row without UID/scope uses its real request binding", () => {
  const plan = inspectTarget({
    ...base,
    wordData: { termId, word: "백제", status: "saved", requestId },
    requestData: { ...request, status: "resolved", resolvedTermId: termId },
  });
  eq(plan.reclaimAllowed, true);
});
test("legacy reward with no scope proof is refused", () => {
  denied(
    () =>
      inspectTarget({
        ...base,
        target: { ...target, requestId: "" },
        requestData: null,
        wordData: {
          termId,
          word: "백제",
          status: "saved",
          requestId: "",
          rewardTermId: termId,
        },
      }),
    "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
  );
});
test("missing request recovery requires current explicit proof", () => {
  eq(inspectTarget({ ...base, requestData: null }).recoverRequest, true);
  for (const key of ["uid", "termId", "year", "semester", "requestId"]) {
    const data = { ...word };
    delete data[key];
    denied(
      () => inspectTarget({ ...base, wordData: data, requestData: null }),
      ["year", "semester"].includes(key)
        ? "HISTORY_DICTIONARY_DELETE_MISMATCH"
        : "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
    );
  }
  denied(
    () => inspectTarget({ ...base, requestData: null, wordData: null }),
    "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
  );
  denied(
    () =>
      inspectTarget({
        ...base,
        requestData: null,
        profile: { ...profile, role: "teacher" },
      }),
    "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
  );
});
test("no word never guesses a reward; closed rename retry performs no operation", () => {
  const plan = inspectTarget({ ...base, wordData: null });
  eq(plan.rejectRequest, true);
  eq(plan.reclaimAllowed, false);
  const closed = inspectTarget({
    ...base,
    wordData: null,
    target: { ...target, termId: "renamed-id", normalizedWord: "new" },
    requestData: { ...request, status: "rejected" },
  });
  eq(closed.noop, true);
  eq(closed.reclaimAllowed, false);
  eq(
    inspectTarget({
      ...base,
      wordData: null,
      requestData: { ...request, status: "resolved", resolvedTermId: termId },
    }).noop,
    true,
  );
  eq(
    inspectTarget({
      ...base,
      target: { ...target, requestId: "" },
      wordData: null,
      requestData: null,
    }).noop,
    true,
  );
});
test("teacher rename binds original request and reward ID", () => {
  const renamed = `term_${hash("고친 단어")}`;
  const fixture = {
    ...base,
    target: {
      ...target,
      termId: renamed,
      normalizedWord: "고친 단어",
      word: "고친 단어",
    },
    wordData: {
      ...word,
      termId: renamed,
      normalizedWord: "고친 단어",
      word: "고친 단어",
      status: "saved",
      definitionSource: "teacher_reviewed",
      reviewedBy: "teacher",
      reviewedAt: 123,
      rewardTermId: termId,
      rewardTransactionId: "unreliable-old-metadata",
    },
    requestData: { ...request, status: "resolved", resolvedTermId: termId },
  };
  eq(inspectTarget(fixture).rewardTermId, termId);
  eq(
    inspectTarget({
      ...fixture,
      wordData: { ...fixture.wordData, rewardTermId: "legacy-original-id" },
      requestData: {
        ...fixture.requestData,
        matchedTermId: "legacy-original-id",
        resolvedTermId: "legacy-original-id",
      },
    }).rewardTermId,
    "legacy-original-id",
  );
  for (const patch of [
    { definitionSource: "student" },
    { reviewedBy: "" },
    { reviewedAt: null },
    { rewardTermId: "other" },
  ])
    denied(() =>
      inspectTarget({
        ...fixture,
        wordData: { ...fixture.wordData, ...patch },
      }),
    );
  denied(
    () => inspectTarget({ ...fixture, requestData: null }),
    "HISTORY_DICTIONARY_DELETE_UNVERIFIED",
  );
});
test("reward and reclaim bind UID/type/source/delta before mutations", () => {
  const reward = {
    uid: profile.uid,
    type: "history_dictionary",
    sourceId: `history-dictionary:${termId}`,
    delta: 20,
  };
  const reclaim = { ...reward, type: "history_dictionary_reclaim", delta: -20 };
  const args = { reward, reclaim, uid: profile.uid, sourceId: reward.sourceId };
  assertRewardBinding(args);
  checks++;
  for (const patch of [
    { uid: "other" },
    { type: "quiz" },
    { sourceId: "other" },
    { delta: NaN },
    { delta: "20" },
  ])
    denied(() =>
      assertRewardBinding({ ...args, reward: { ...reward, ...patch } }),
    );
  for (const patch of [
    { uid: "other" },
    { type: "quiz" },
    { sourceId: "other" },
    { delta: -19 },
    { delta: 20 },
  ])
    denied(() =>
      assertRewardBinding({ ...args, reclaim: { ...reclaim, ...patch } }),
    );
});
console.log(
  JSON.stringify({
    suite: "history-dictionary-delete-binding-unit",
    passed: true,
    checks,
    scenarios: cases.length,
    cases,
    networkAccess: 0,
    actualHelper: true,
    serverTransactionVerified: false,
  }),
);
