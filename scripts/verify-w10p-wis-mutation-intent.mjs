import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const helperSource = readFileSync(
  resolve("src/lib/legacyWisMutationIntent.ts"),
  "utf8",
);
const transpiled = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const firstModule = await import(`${helperUrl}#first-page-instance`);
const reloadedModule = await import(`${helperUrl}#reloaded-page-instance`);

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

const storage = new MemoryStorage();
const receipts = new Map();
const effects = new Map();
const attempts = [];
let commandIndex = 0;

const createCommandId = () => {
  commandIndex += 1;
  return `00000000-0000-4000-8000-${String(commandIndex).padStart(12, "0")}`;
};

const executeWithSyntheticResponseLoss = async (kind, intent, dropResponse) => {
  const payloadJson = JSON.stringify(intent.payload);
  attempts.push({ kind, commandId: intent.commandId, payloadJson });
  const receipt = receipts.get(intent.commandId);
  if (receipt) {
    assert.equal(receipt.kind, kind);
    assert.equal(receipt.payloadJson, payloadJson);
    return { replayed: true };
  }
  effects.set(kind, (effects.get(kind) || 0) + 1);
  receipts.set(intent.commandId, { kind, payloadJson });
  if (dropResponse) throw new Error("synthetic response lost after commit");
  return { replayed: false };
};

const cases = [
  {
    kind: "purchase",
    namespace: "student-wis-purchase",
    action: {
      studentUid: "student-1",
      semesterId: "2026-2",
      provenance: "CURRENT",
      productId: "product-1",
    },
    payload: () => ({
      semesterId: "2026-2",
      expectedSemesterRevision: 7,
      expectedEconomyRevision: 3,
      inventoryId: "inventory-1",
      expectedInventoryRevision: 4,
      expectedAccountRevision: 5,
      quantity: 1,
    }),
  },
  {
    kind: "grant",
    namespace: "teacher-wis-adjust",
    action: {
      actorUid: "teacher-1",
      semesterId: "2026-2",
      studentUid: "student-1",
      mode: "grant",
      amount: 100,
      reason: "수업 참여",
    },
    payload: (commandId) => ({
      semesterId: "2026-2",
      expectedSemesterRevision: 7,
      expectedEconomyRevision: 3,
      accountId: "account-1",
      expectedAccountRevision: 5,
      amount: 100,
      sourceId: `legacy-w10p:grant:${commandId}`,
      reason: "수업 참여",
    }),
  },
  {
    kind: "reclaim",
    namespace: "teacher-wis-adjust",
    action: {
      actorUid: "teacher-1",
      semesterId: "2026-2",
      studentUid: "student-1",
      mode: "reclaim",
      amount: 30,
      reason: "오지급 정정",
    },
    payload: (commandId) => ({
      semesterId: "2026-2",
      expectedSemesterRevision: 7,
      expectedEconomyRevision: 3,
      accountId: "account-1",
      expectedAccountRevision: 5,
      amount: 30,
      sourceId: `legacy-w10p:reclaim:${commandId}`,
      reason: "오지급 정정",
    }),
  },
];

for (const fixture of cases) {
  const firstKey = firstModule.createStableLegacyMutationActionKey(
    fixture.namespace,
    fixture.action,
  );
  const reloadKey = reloadedModule.createStableLegacyMutationActionKey(
    fixture.namespace,
    { ...fixture.action },
  );
  assert.equal(reloadKey, firstKey);

  let firstBuildCount = 0;
  const firstIntent = firstModule.getOrCreateLegacyWisMutationIntent(
    firstKey,
    (commandId) => {
      firstBuildCount += 1;
      return fixture.payload(commandId);
    },
    { storage, createCommandId },
  );
  await assert.rejects(
    executeWithSyntheticResponseLoss(fixture.kind, firstIntent, true),
    /response lost/u,
  );
  assert.equal(effects.get(fixture.kind), 1);

  let reloadBuildCount = 0;
  const reloadIntent = reloadedModule.getOrCreateLegacyWisMutationIntent(
    reloadKey,
    (commandId) => {
      reloadBuildCount += 1;
      return fixture.payload(commandId);
    },
    { storage, createCommandId },
  );
  const replay = await executeWithSyntheticResponseLoss(
    fixture.kind,
    reloadIntent,
    false,
  );
  assert.equal(replay.replayed, true);
  assert.equal(firstBuildCount, 1);
  assert.equal(reloadBuildCount, 0);
  assert.equal(reloadIntent.commandId, firstIntent.commandId);
  assert.deepEqual(reloadIntent.payload, firstIntent.payload);
  assert.equal(effects.get(fixture.kind), 1);

  reloadedModule.forgetLegacyWisMutationIntent(reloadKey, storage);
  const nextGestureIntent = reloadedModule.getOrCreateLegacyWisMutationIntent(
    reloadKey,
    fixture.payload,
    { storage, createCommandId },
  );
  const nextGesture = await executeWithSyntheticResponseLoss(
    fixture.kind,
    nextGestureIntent,
    false,
  );
  assert.equal(nextGesture.replayed, false);
  assert.notEqual(nextGestureIntent.commandId, firstIntent.commandId);
  if (fixture.kind !== "purchase") {
    assert.notEqual(
      nextGestureIntent.payload.sourceId,
      firstIntent.payload.sourceId,
    );
    assert.match(nextGestureIntent.payload.sourceId, /00000000-0000-4000/u);
  }
  assert.equal(effects.get(fixture.kind), 2);
  reloadedModule.forgetLegacyWisMutationIntent(reloadKey, storage);
}

for (const fixture of cases) {
  const matchingAttempts = attempts.filter(
    (item) => item.kind === fixture.kind,
  );
  assert.equal(matchingAttempts.length, 3);
  assert.equal(matchingAttempts[0].commandId, matchingAttempts[1].commandId);
  assert.equal(
    matchingAttempts[0].payloadJson,
    matchingAttempts[1].payloadJson,
  );
  assert.notEqual(matchingAttempts[1].commandId, matchingAttempts[2].commandId);
}

const client = readFileSync(resolve("src/lib/wisEconomy.ts"), "utf8");
for (const command of ["grantWis", "deductWis", "placeWisOrder"]) {
  assert.match(
    client,
    new RegExp(
      `executeWestoryCommand\\("${command}", payload, options\\)`,
      "u",
    ),
  );
}

const adapter = readFileSync(
  resolve("src/lib/legacyWisPresentationAdapter.ts"),
  "utf8",
);
assert.match(
  adapter,
  /sourceId:\s*`legacy-w10p:\$\{input\.mode\}:\$\{commandId\}`/u,
);
assert.match(adapter, /forgetLegacyWisMutationIntent\(intentKey\)/u);

for (const path of [
  "src/pages/student/Points.tsx",
  "src/pages/teacher/ManagePoints.tsx",
]) {
  const source = readFileSync(resolve(path), "utf8");
  assert.match(source, /createStableLegacyMutationActionKey/u);
}

const studentPointsSource = readFileSync(
  resolve("src/pages/student/Points.tsx"),
  "utf8",
);
const purchaseCommandOffset = studentPointsSource.indexOf(
  "await requestLegacyStudentWisPurchase",
);
const purchaseSelectionClearOffset = studentPointsSource.indexOf(
  'setSelectedProductId("");',
  purchaseCommandOffset,
);
const purchaseRefreshOffset = studentPointsSource.indexOf(
  "await Promise.all([",
  purchaseCommandOffset,
);
assert.ok(purchaseCommandOffset >= 0);
assert.ok(purchaseSelectionClearOffset > purchaseCommandOffset);
assert.ok(purchaseRefreshOffset > purchaseSelectionClearOffset);
assert.match(
  studentPointsSource.slice(
    purchaseSelectionClearOffset,
    purchaseRefreshOffset,
  ),
  /setPurchaseRequestKey\(""\)/u,
);
assert.match(
  studentPointsSource.slice(purchaseRefreshOffset),
  /Purchase succeeded, but refreshing Wis state failed/u,
);

let refreshFailureEffectCount = 0;
let selectedProductId = "product-1";
let purchaseRequestKey = "stable-purchase-key";
const submitPurchaseWithRefresh = async ({ rejectRefresh = false } = {}) => {
  if (!selectedProductId || !purchaseRequestKey) return;
  refreshFailureEffectCount += 1;
  selectedProductId = "";
  purchaseRequestKey = "";
  try {
    if (rejectRefresh) throw new Error("synthetic refresh failure");
  } catch (error) {
    assert.match(error.message, /refresh failure/u);
  }
};
await submitPurchaseWithRefresh({ rejectRefresh: true });
await submitPurchaseWithRefresh();
assert.equal(refreshFailureEffectCount, 1);

const teacherPointsSource = readFileSync(
  resolve("src/pages/teacher/ManagePoints.tsx"),
  "utf8",
);
const adjustmentCommandOffset =
  teacherPointsSource.indexOf("await adjustPoints");
const adjustmentIntentClearOffset = teacherPointsSource.indexOf(
  "grantMutationIntentRef.current = null",
  adjustmentCommandOffset,
);
const adjustmentRefreshOffset = teacherPointsSource.indexOf(
  "const nextWallets = await listPointWallets",
  adjustmentCommandOffset,
);
assert.ok(adjustmentCommandOffset >= 0);
assert.ok(adjustmentIntentClearOffset > adjustmentCommandOffset);
assert.ok(adjustmentRefreshOffset > adjustmentIntentClearOffset);
assert.match(
  teacherPointsSource.slice(adjustmentRefreshOffset),
  /Wis adjustment succeeded, but refreshing Wis state failed/u,
);

const teacherRefreshFailureEffectCounts = { grant: 0, reclaim: 0 };
for (const mode of ["grant", "reclaim"]) {
  let amount = "100";
  let reason = mode === "grant" ? "수업 참여" : "오지급 정정";
  let successFeedback = "";
  const submitAdjustmentWithRefresh = async ({
    rejectRefresh = false,
  } = {}) => {
    if (!amount || !reason) return;
    teacherRefreshFailureEffectCounts[mode] += 1;
    amount = "";
    reason = "";
    successFeedback = mode === "grant" ? "지급되었습니다." : "환수되었습니다.";
    try {
      if (rejectRefresh) throw new Error("synthetic refresh failure");
    } catch (error) {
      assert.match(error.message, /refresh failure/u);
      successFeedback = `${mode === "grant" ? "지급" : "환수"}은 완료되었습니다. 최신 위스 현황을 불러오지 못했습니다.`;
    }
  };
  await submitAdjustmentWithRefresh({ rejectRefresh: true });
  await submitAdjustmentWithRefresh();
  assert.equal(teacherRefreshFailureEffectCounts[mode], 1);
  assert.match(successFeedback, /완료되었습니다/u);
  assert.doesNotMatch(successFeedback, /실패/u);
}

console.log(
  JSON.stringify({
    suite: "w10p-wis-mutation-intent",
    passed: true,
    cases: cases.length * 2 + 3,
    effectCounts: Object.fromEntries(effects),
    moduleInstances: 2,
    refreshFailureEffectCount,
    teacherRefreshFailureEffectCounts,
    productionAccess: 0,
  }),
);
