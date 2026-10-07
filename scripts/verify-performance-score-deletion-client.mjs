import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Extract the real deletion closure and batch queue instead of reimplementing
// their behavior. All Firestore calls use synthetic, in-memory documents.
const names = new Set([
  "deleteRoster",
  "createBatchQueue",
  "getFirestoreWriteErrorMessage",
  "FIRESTORE_BATCH_WRITE_LIMIT",
  "FIRESTORE_ROSTER_PAYLOAD_TOO_LARGE",
  "SCORE_LIST_ALL_ROSTERS_VALUE",
  "PERFORMANCE_SCORE_USER_COLLECTION",
  "PERFORMANCE_SCORE_CONFIRMATIONS_COLLECTION",
]);
const declarations = new Map();
for (const path of [
  "src/lib/performanceScores.ts",
  "src/pages/teacher/components/PerformanceScoreManager.tsx",
]) {
  const source = ts.createSourceFile(
    path,
    fs.readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      names.has(node.name.text)
    ) {
      assert(
        !declarations.has(node.name.text),
        `Ambiguous declaration: ${node.name.text}`,
      );
      declarations.set(node.name.text, `const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
assert.deepEqual([...declarations.keys()].sort(), [...names].sort());
const compiled = ts.transpileModule(
  `${[...declarations.values()].join("\n")}\nthis.subject = { deleteRoster, FIRESTORE_BATCH_WRITE_LIMIT };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
    },
  },
).outputText;

const rosterId = "delete-client-target";
const rosterCollectionPath = "years/2026/semesters/2/performance_score_rosters";
const rosterPath = `${rosterCollectionPath}/${rosterId}`;
const scorePath = (uid, id = rosterId) =>
  `users/${uid}/performance_scores/${id}`;
const confirmationPath = (uid, id = rosterId) =>
  `${scorePath(uid, id)}/confirmations/${uid}`;
const otherPath = scorePath("student-1", "keep-other-assessment");
const archivePath = scorePath("student-1", "keep-previous-semester");

const reference = (path) => {
  const segments = path.split("/");
  return {
    path,
    id: segments.at(-1),
    parent: {
      path: segments.slice(0, -1).join("/"),
      id: segments.at(-2),
      parent:
        segments.length > 2
          ? { path: segments.slice(0, -2).join("/"), id: segments.at(-3) }
          : null,
    },
  };
};

const fixture = ({
  count = 32,
  confirmed = true,
  failCommit = 0,
  queryError = null,
  busy = false,
} = {}) => {
  const rows = Array.from({ length: count }, (_, index) => ({
    uid: `student-${index + 1}`,
  }));
  const roster = { id: rosterId, title: "삭제 검증 평가", rows };
  const store = new Map([[rosterPath, roster]]);
  rows.forEach(({ uid }) => {
    store.set(scorePath(uid), {
      uid,
      rosterId,
      academicYear: "2026",
      semester: "2",
    });
    store.set(confirmationPath(uid), {
      uid,
      rosterId,
      signatureName: "검증 학생",
    });
  });
  const otherScore = {
    uid: "student-1",
    rosterId: "keep-other-assessment",
    academicYear: "2026",
    semester: "2",
  };
  const archiveScore = {
    uid: "student-1",
    rosterId: "keep-previous-semester",
    academicYear: "2026",
    semester: "1",
  };
  store.set(otherPath, otherScore);
  store.set(archivePath, archiveScore);
  const initialStore = new Map(store);
  const events = {
    confirmations: [],
    queries: [],
    batches: [],
    attempts: [],
    committed: [],
    toasts: [],
    deletionStates: [],
    invalidations: [],
    ui: [],
    errors: [],
  };
  const db = {};
  let currentRosters = [roster, { id: "keep-other-assessment" }];
  const context = {
    Error,
    console: { ...console, error: (...args) => events.errors.push(args) },
    db,
    rosterCollectionPath,
    managerCopy: { scoreKindLabel: "수행평가" },
    deletingRosterId: busy ? "another-roster" : "",
    scoreEditing: false,
    savingScoreEdits: false,
    scoreDocumentSyncRunRef: { current: 7 },
    scoreListRosterId: rosterId,
    scoreListAllSelected: false,
    scoreStatsLoadedRosterId: rosterId,
    confirm: async (options) => {
      events.confirmations.push(options);
      return confirmed;
    },
    setDeletingRosterId: (id) => {
      context.deletingRosterId = id;
      events.deletionStates.push(id);
    },
    doc: (base, ...parts) =>
      reference([...(base.path ? [base.path] : []), ...parts].join("/")),
    collectionGroup: (database, collectionId) => {
      assert.equal(database, db);
      return { collectionId };
    },
    where: (field, operator, value) => ({ field, operator, value }),
    query: (collection, filter) => ({ ...collection, ...filter }),
    getDocs: async (request) => {
      events.queries.push(request);
      assert.deepEqual(request, {
        collectionId: "performance_scores",
        field: "rosterId",
        operator: "==",
        value: rosterId,
      });
      if (queryError) throw queryError;
      const docs = [...store]
        .filter(
          ([path, data]) =>
            /^users\/[^/]+\/performance_scores\/[^/]+$/.test(path) &&
            data.rosterId === request.value,
        )
        .map(([path, data]) => ({ ref: reference(path), data: () => data }));
      return { docs, forEach: (callback) => docs.forEach(callback) };
    },
    writeBatch: (database) => {
      assert.equal(database, db);
      const paths = [];
      events.batches.push(paths);
      return {
        delete: (ref) => paths.push(ref.path),
        set: () => assert.fail("Deletion must not create score documents."),
        update: () => assert.fail("Deletion must not update score documents."),
        commit: async () => {
          events.attempts.push([...paths]);
          if (failCommit === events.attempts.length) {
            throw Object.assign(new Error("Synthetic batch unavailable"), {
              code: "unavailable",
            });
          }
          paths.forEach((path) => store.delete(path));
          events.committed.push([...paths]);
        },
      };
    },
    invalidateRosterReadCaches: (...ids) => events.invalidations.push(...ids),
    sortPerformanceScoreRosters: (values) => values,
    setRosters: (update) => {
      currentRosters = update(currentRosters);
      events.ui.push("setRosters");
    },
    showToast: (toast) => events.toasts.push(toast),
  };
  for (const setter of [
    "setScoreListLoadedRosterId",
    "setScoreListRecords",
    "setScoreListSummaryStudents",
    "setScoreListSummaryLoadedKey",
    "setScoreEditing",
    "setScoreEditOriginalRecords",
    "setScoreStatsRecords",
    "setScoreStatsLoadedRosterId",
    "setClassSheetPreviewStudents",
    "setClassSheetPreviewLoadedKey",
  ])
    context[setter] = () => events.ui.push(setter);
  vm.createContext(context);
  vm.runInContext(compiled, context);
  assert.equal(context.subject.FIRESTORE_BATCH_WRITE_LIMIT, 450);
  return {
    roster,
    store,
    initialStore,
    events,
    context,
    run: () => context.subject.deleteRoster(roster),
    rosters: () => currentRosters,
    assertOtherScoresUnchanged: () => {
      assert.deepEqual(store.get(otherPath), otherScore);
      assert.deepEqual(store.get(archivePath), archiveScore);
    },
  };
};

const checks = [];
const check = (label) => {
  checks.push(label);
  console.log(`PASS ${label}`);
};
const assertNoSuccess = (test) => {
  assert.equal(
    test.events.toasts.filter((toast) => toast.tone === "success").length,
    0,
  );
  assert.equal(test.events.invalidations.length, 0);
  assert.equal(test.events.ui.length, 0);
  assert.equal(
    test.rosters().some((roster) => roster.id === rosterId),
    true,
  );
};

const normal = fixture();
await normal.run();
const normalPaths = normal.events.committed.flat();
assert.equal(normalPaths.length, 65);
assert.equal(
  new Set(normalPaths).size,
  65,
  "Overlapping query and roster row paths must be deleted once.",
);
assert.equal(normalPaths.at(-1), rosterPath);
assert.equal(normal.store.size, 2);
assert.deepEqual(normal.events.deletionStates, [rosterId, ""]);
assert.equal(normal.events.toasts.length, 1);
assert.equal(normal.events.toasts[0].tone, "success");
assert.deepEqual(normal.events.invalidations, [rosterId]);
assert.equal(
  normal.rosters().some((roster) => roster.id === rosterId),
  false,
);
normal.assertOtherScoresUnchanged();
check(
  "32 students: overlapping paths deleted once, upload removed last, success and cleanup reflected",
);

const large = fixture({ count: 230 });
await large.run();
assert.deepEqual(
  large.events.committed.map((batch) => batch.length),
  [450, 11],
);
assert.equal(new Set(large.events.committed.flat()).size, 461);
assert.equal(large.events.committed[0].includes(rosterPath), false);
assert.equal(large.events.committed[1].at(-1), rosterPath);
assert.equal(large.store.size, 2);
large.assertOtherScoresUnchanged();
check("230 students: 450-write split and upload only in final batch");

const partial = fixture({ count: 230, failCommit: 2 });
await partial.run();
assert.deepEqual(
  partial.events.attempts.map((batch) => batch.length),
  [450, 11],
);
assert.equal(partial.events.committed.length, 1);
assert.equal(
  partial.store.has(rosterPath),
  true,
  "Failed final batch must retain upload history for retry.",
);
assert.equal(partial.store.size, partial.initialStore.size - 450);
assertNoSuccess(partial);
assert.equal(partial.events.toasts.length, 1);
assert.equal(partial.events.toasts[0].tone, "error");
assert.match(partial.events.toasts[0].message, /Firestore 연결이 불안정/);
assert.match(partial.events.toasts[0].message, /Synthetic batch unavailable/);
assert.deepEqual(partial.events.deletionStates, [rosterId, ""]);
partial.assertOtherScoresUnchanged();
check(
  "second batch failure retains upload history, reports error, skips success state, releases deletion state",
);

const cancelled = fixture({ confirmed: false });
await cancelled.run();
assert.deepEqual(cancelled.store, cancelled.initialStore);
assert.equal(cancelled.events.confirmations.length, 1);
assert.equal(cancelled.events.queries.length, 0);
assert.equal(cancelled.events.batches.length, 0);
assert.equal(cancelled.events.toasts.length, 0);
assert.deepEqual(cancelled.events.deletionStates, []);
assert.equal(cancelled.context.scoreDocumentSyncRunRef.current, 7);
assertNoSuccess(cancelled);
check("cancel leaves Firestore, UI, and synchronization state unchanged");

const queryFailure = fixture({
  queryError: Object.assign(new Error("Synthetic query denied"), {
    code: "permission-denied",
  }),
});
await queryFailure.run();
assert.deepEqual(queryFailure.store, queryFailure.initialStore);
assert.equal(queryFailure.events.attempts.length, 0);
assertNoSuccess(queryFailure);
assert.equal(queryFailure.events.toasts.length, 1);
assert.equal(queryFailure.events.toasts[0].tone, "error");
assert.match(queryFailure.events.toasts[0].message, /Firestore 권한이 거부/);
assert.deepEqual(queryFailure.events.deletionStates, [rosterId, ""]);
check(
  "query failure commits nothing, exposes permission error, releases deletion state",
);

const busy = fixture({ busy: true });
await busy.run();
assert.deepEqual(busy.store, busy.initialStore);
assert.equal(busy.events.confirmations.length, 0);
assert.equal(busy.events.queries.length, 0);
assert.equal(busy.events.batches.length, 0);
assertNoSuccess(busy);
check("existing deletion blocks duplicate entry");

console.log(
  JSON.stringify(
    {
      checks,
      source:
        "actual deleteRoster and createBatchQueue extracted by TypeScript AST",
    },
    null,
    2,
  ),
);
