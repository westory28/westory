import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const parse = (path) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
const compile = (node, file, dependencies) => {
  const code = ts.transpileModule(`const target = ${node.getText(file)};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return target;`)(
    ...Object.values(dependencies),
  );
};
const find = (file, predicate) => {
  let result;
  const visit = (node) => {
    if (predicate(node)) result = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  assert.ok(result, "The production implementation must exist");
  return result;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};
const bank = parse("src/pages/teacher/components/QuizBankTab.tsx");
const primaryEffect = find(
  bank,
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(bank) === "useEffect" &&
    node.arguments[0]
      ?.getText(bank)
      .includes("const [questionsResult, treeResult]"),
).arguments[0];
const stats = {
  questionStats: { q1: { attempts: 3 } },
  classAverageByClass: {},
  participationByClass: {},
  totalParticipants: 1,
  recentClassFocus: null,
  lastAttemptAt: 1,
  recentExamRoundFocus: "",
};
const setup = () => {
  const questions = deferred(),
    tree = deferred(),
    analytics = deferred(),
    roster = deferred();
  const state = {},
    calls = { analytics: 0, roster: 0 };
  const dependencies = {
    userTouchedFiltersRef: { current: false },
    userTouchedClassScopeRef: { current: false },
    analyticsRoundRef: { current: "" },
    loadQuestions: () => questions.promise,
    loadTreeData: () => tree.promise,
    loadQuestionAnalytics: () => {
      calls.analytics++;
      return analytics.promise;
    },
    loadStudentRoster: () => {
      calls.roster++;
      return roster.promise;
    },
    createEmptyBankFilters: () => ({ big: "", mid: "", small: "" }),
    buildDefaultFocus: () => ({
      category: "diagnostic",
      filters: { big: "b", mid: "m", small: "" },
    }),
  };
  for (const key of [
    "Loading",
    "SupportLoading",
    "QuestionStats",
    "ClassAverageByClass",
    "ParticipationByClass",
    "TotalParticipants",
    "RecentClassFocus",
    "LastAttemptAt",
    "StudentRoster",
    "RosterAccessLimited",
    "DefaultFocus",
    "Filters",
    "CategoryFilter",
    "ExamRoundFilter",
    "Questions",
    "TreeData",
  ])
    dependencies[`set${key}`] = (value) => {
      state[key] = value;
    };
  const cleanup = compile(primaryEffect, bank, dependencies)();
  return {
    questions,
    tree,
    analytics,
    roster,
    state,
    calls,
    dependencies,
    cleanup,
  };
};

const slow = setup();
slow.questions.resolve([{ docId: "q1" }]);
slow.tree.resolve([]);
await flush();
assert.equal(
  slow.state.Loading,
  false,
  "Question editing is available before slow auxiliary reads finish",
);
assert.equal(slow.state.SupportLoading, true);
assert.equal(slow.state.Questions.length, 1);
assert.deepEqual(slow.calls, { analytics: 1, roster: 1 });
slow.dependencies.userTouchedFiltersRef.current = true;
slow.state.Filters = { big: "user-choice", mid: "", small: "" };
slow.analytics.resolve(stats);
slow.roster.resolve({ students: [], accessLimited: false });
await flush();
assert.equal(
  slow.state.Filters.big,
  "user-choice",
  "Late statistics must never overwrite user input",
);
assert.equal(slow.state.SupportLoading, false);
slow.cleanup();

const empty = setup();
empty.questions.resolve([]);
empty.tree.resolve([]);
await flush();
assert.deepEqual(
  empty.calls,
  { analytics: 0, roster: 0 },
  "Empty semester does not read results or the whole user collection",
);
assert.equal(empty.state.Loading, false);
assert.equal(empty.state.SupportLoading, false);
empty.cleanup();

const cancelled = setup();
cancelled.questions.resolve([{ docId: "old-semester" }]);
cancelled.tree.resolve([]);
await flush();
cancelled.cleanup();
cancelled.analytics.resolve(stats);
cancelled.roster.resolve({
  students: [{ uid: "old-student" }],
  accessLimited: false,
});
await flush();
assert.deepEqual(
  cancelled.state.StudentRoster,
  [],
  "Unmount/semester cleanup fences late profile data",
);
assert.deepEqual(cancelled.state.QuestionStats, {});

const adapter = parse("src/lib/legacyWisPresentationAdapter.ts");
const roundEffect = find(
  bank,
  (node) =>
    ts.isCallExpression(node) &&
    node.expression.getText(bank) === "useEffect" &&
    node.arguments[0]
      ?.getText(bank)
      .includes("const round = isMockExamCategory"),
).arguments[0];
const roundResponse = deferred();
let roundReads = 0,
  requestedRound;
const roundState = {};
const roundDependencies = {
  loading: false,
  supportLoading: false,
  questions: [{ docId: "q1" }],
  categoryFilter: "exam_prep",
  examRoundFilter: "1",
  analyticsRoundRef: { current: "" },
  isMockExamCategory: (category) => category === "exam_prep",
  loadQuestionAnalytics: (round) => {
    roundReads++;
    requestedRound = round;
    return roundResponse.promise;
  },
};
for (const key of [
  "RoundAnalyticsLoading",
  "QuestionStats",
  "ClassAverageByClass",
  "ParticipationByClass",
  "TotalParticipants",
  "RecentClassFocus",
  "LastAttemptAt",
])
  roundDependencies[`set${key}`] = (value) => {
    roundState[key] = value;
  };
const roundCleanup = compile(roundEffect, bank, roundDependencies)();
assert.equal(roundReads, 1);
assert.equal(roundState.RoundAnalyticsLoading, true);
assert.equal(requestedRound, "1");
roundResponse.resolve(stats);
await flush();
assert.equal(roundState.RoundAnalyticsLoading, false);
assert.equal(roundDependencies.analyticsRoundRef.current, "1");
roundCleanup();
compile(roundEffect, bank, roundDependencies)();
assert.equal(roundReads, 1, "Already loaded round does not fetch again");
roundDependencies.categoryFilter = "diagnostic";
compile(roundEffect, bank, roundDependencies)();
await flush();
assert.equal(
  requestedRound,
  "",
  "Leaving an exam round restores all-round statistics",
);
assert.equal(roundReads, 2);
const transactions = find(
  adapter,
  (node) =>
    ts.isVariableDeclaration(node) &&
    node.name.getText(adapter) === "listLegacyTeacherPointTransactionsByUid",
).initializer;
const reference = {
  accountId: "acct1",
  studentUid: "student1",
  semesterId: "2026-2",
};
let overviewReads = 0,
  accountReads = 0;
let response = {
  semesterId: "2026-2",
  accounts: [reference],
  account: null,
  ledger: [],
};
const readTransactions = compile(transactions, adapter, {
  semesterKey: (config) => `${config.year}-${config.semester}`,
  LegacyWisPresentationError: Error,
  queryAllPages: async () => {
    overviewReads++;
    return { accounts: [reference] };
  },
  queryCurrentTeacherState: async (_, options) => {
    accountReads++;
    assert.equal(options.accountId, "acct1");
    return response;
  },
  ledgerForAccount: (state) => state.ledger,
  mapLedgerEntry: (entry) => entry,
  limitRows: (entries, limit) => entries.slice(0, limit),
});
const config = { year: "2026", semester: "2" };
await readTransactions(config, "student1", 20, reference);
assert.equal(overviewReads, 0);
assert.equal(
  accountReads,
  1,
  "Known account needs one scoped server request only",
);
for (const invalid of [
  { ...reference, studentUid: "other" },
  { ...reference, semesterId: "2026-1" },
  { ...reference, accountId: "" },
])
  await assert.rejects(readTransactions(config, "student1", 20, invalid));
assert.equal(
  accountReads,
  1,
  "Invalid local identity must not issue a request",
);
response = { ...response, semesterId: "2026-1" };
await assert.rejects(readTransactions(config, "student1", 20, reference));
response = {
  ...response,
  semesterId: "2026-2",
  accounts: [{ ...reference, studentUid: "other" }],
};
await assert.rejects(readTransactions(config, "student1", 20, reference));
response = { ...response, accounts: [reference] };
await readTransactions(config, "student1", 20);
assert.equal(
  overviewReads,
  1,
  "Callers without a trusted reference keep the verified lookup path",
);
console.log(
  "Teacher page read latency: primary/auxiliary readiness, empty bank, late edits, stale response, and scoped account lookup PASS",
);
