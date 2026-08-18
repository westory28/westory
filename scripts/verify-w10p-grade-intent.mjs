import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import ts from "typescript";

const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const dataUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const genericSource = readFileSync(
  resolve("src/lib/legacyWisMutationIntent.ts"),
  "utf8",
);
const actionSource = readFileSync(
  resolve("src/lib/legacyGradeMutationIntent.ts"),
  "utf8",
);
const genericFirstUrl = `${dataUrl(transpile(genericSource))}#grade-first`;
const genericReloadUrl = `${dataUrl(transpile(genericSource))}#grade-reload`;
const compileAction = (genericUrl, suffix) => {
  const compiled = transpile(actionSource).replace(
    /["']\.\/legacyWisMutationIntent["']/u,
    JSON.stringify(genericUrl),
  );
  return `${dataUrl(compiled)}#${suffix}`;
};
const firstAction = await import(
  compileAction(genericFirstUrl, "grade-action-first")
);
const reloadedAction = await import(
  compileAction(genericReloadUrl, "grade-action-reload")
);
const firstIntentModule = await import(genericFirstUrl);
const reloadedIntentModule = await import(genericReloadUrl);

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

let commandSequence = 0;
const createCommandId = () => {
  commandSequence += 1;
  return `00000000-0000-4000-8000-${String(commandSequence).padStart(12, "0")}`;
};
const storage = new MemoryStorage();
const receipts = new Map();
const effects = new Map();

const execute = (kind, intent, loseResponse) => {
  const payload = JSON.stringify(intent.payload);
  const receipt = receipts.get(intent.commandId);
  if (receipt) {
    assert.equal(receipt.kind, kind);
    assert.equal(receipt.payload, payload);
    return { replayed: true };
  }
  receipts.set(intent.commandId, { kind, payload });
  effects.set(kind, (effects.get(kind) || 0) + 1);
  if (loseResponse) throw { kind: "NETWORK" };
  return { replayed: false };
};

const fixtures = [
  {
    kind: "upsert",
    commandType: "upsertLegacyGradeRoster",
    firstPayload: {
      semesterId: "2026-2",
      expectedSemesterRevision: 7,
      rosterId: "generated-roster-before-reload",
      expectedRosterRevision: 0,
      mode: "CREATE",
      roster: { title: "역사 탐구", rows: [{ uid: "student-1", score: 9 }] },
      records: [{ uid: "student-1", totalScore: 9 }],
      relatedRosters: [
        { rosterId: "related-1", expectedRosterRevision: 2 },
      ],
      reason: "수행평가 점수표 업로드",
    },
    reloadPayload: {
      semesterId: "2026-2",
      expectedSemesterRevision: 8,
      rosterId: "regenerated-roster-after-reload",
      expectedRosterRevision: 1,
      mode: "CREATE",
      roster: { title: "역사 탐구", rows: [{ uid: "student-1", score: 9 }] },
      records: [{ uid: "student-1", totalScore: 9 }],
      relatedRosters: [
        { rosterId: "related-1", expectedRosterRevision: 3 },
      ],
      reason: "수행평가 점수표 업로드",
    },
  },
  {
    kind: "delete",
    commandType: "deleteLegacyGradeRoster",
    firstPayload: {
      semesterId: "2026-2",
      expectedSemesterRevision: 7,
      rosterId: "roster-delete-1",
      expectedRosterRevision: 3,
      reason: "수행평가 점수표 삭제",
    },
    reloadPayload: {
      semesterId: "2026-2",
      expectedSemesterRevision: 8,
      rosterId: "roster-delete-1",
      expectedRosterRevision: 4,
      reason: "수행평가 점수표 삭제",
    },
  },
];

for (const fixture of fixtures) {
  const firstKey = firstAction.createLegacyGradeMutationActionKey(
    fixture.commandType,
    fixture.firstPayload,
  );
  const reloadKey = reloadedAction.createLegacyGradeMutationActionKey(
    fixture.commandType,
    fixture.reloadPayload,
  );
  assert.equal(reloadKey, firstKey);
  assert.notEqual(
    firstAction.createLegacyGradeMutationActionKey(fixture.commandType, {
      ...fixture.firstPayload,
      reason: `${fixture.firstPayload.reason} (다른 작업)`,
    }),
    firstKey,
  );

  let firstBuildCount = 0;
  const firstIntent = firstIntentModule.getOrCreateLegacyWisMutationIntent(
    firstKey,
    () => {
      firstBuildCount += 1;
      return fixture.firstPayload;
    },
    { storage, createCommandId },
  );
  assert.throws(() => execute(fixture.kind, firstIntent, true));
  assert.equal(
    firstIntentModule.shouldForgetLegacyWisIntentAfterError({ kind: "NETWORK" }),
    false,
  );

  let reloadBuildCount = 0;
  const replayIntent =
    reloadedIntentModule.getOrCreateLegacyWisMutationIntent(
      reloadKey,
      () => {
        reloadBuildCount += 1;
        return fixture.reloadPayload;
      },
      { storage, createCommandId },
    );
  const replay = execute(fixture.kind, replayIntent, false);
  assert.equal(replay.replayed, true);
  assert.equal(replayIntent.commandId, firstIntent.commandId);
  assert.deepEqual(replayIntent.payload, firstIntent.payload);
  assert.equal(firstBuildCount, 1);
  assert.equal(reloadBuildCount, 0);
  assert.equal(effects.get(fixture.kind), 1);
  reloadedIntentModule.forgetLegacyWisMutationIntent(reloadKey, storage);
}

const gradeClientSource = readFileSync(resolve("src/lib/gradeEvidence.ts"), "utf8");
assert.match(gradeClientSource, /createLegacyGradeMutationActionKey/u);
assert.match(
  gradeClientSource,
  /executeLegacyGradeCommand\(commandType, intent\.payload, \{[\s\S]*?commandId: intent\.commandId/u,
);
assert.match(gradeClientSource, /forgetLegacyWisMutationIntent\(intentKey\)/u);

const managerSource = readFileSync(
  resolve("src/pages/teacher/components/PerformanceScoreManager.tsx"),
  "utf8",
);
assert.match(managerSource, /LEGACY_GRADE_ATOMIC_RECORD_LIMIT/u);
assert.match(managerSource, /학급별 명단으로 나누어 저장/u);

console.log(
  JSON.stringify({
    suite: "w10p-grade-intent",
    status: "PASS",
    scenarios: fixtures.map(({ kind }) => kind),
    persistedReloadReplays: fixtures.length,
    duplicateEffects: 0,
    productionAccess: 0,
  }),
);
