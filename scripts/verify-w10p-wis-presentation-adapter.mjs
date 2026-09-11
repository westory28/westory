import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const adapterSource = readFileSync(
  resolve("src/lib/legacyWisPresentationAdapter.ts"),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "legacyWisPresentationAdapter.ts",
  adapterSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const helperStatement = sourceFile.statements.find(
  (statement) =>
    ts.isVariableStatement(statement) &&
    statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === "hydrateLegacyStudentWisOwnProjection",
    ),
);
assert.ok(
  helperStatement,
  "student own-projection hydration helper is required",
);
const helperModule = ts.transpileModule(helperStatement.getText(sourceFile), {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperModule).toString("base64")}`;
const { hydrateLegacyStudentWisOwnProjection } = await import(helperUrl);

const studentUid = "student-own-1";
const accountId = "wisacct-own-1";
const wireLedgerEntry = {
  ledgerEntryId: "wisled-lesson-1",
  type: "GRANT",
  delta: 500,
  balanceBefore: 100,
  balanceAfter: 600,
  sourceId: "lesson-core-points-all",
  reason: "전체 수업자료 핵심포인트 완주",
  createdAt: "2026-08-18T01:00:00.000Z",
};
const wireOrder = {
  orderId: "wisorder-own-1",
  productId: "product-1",
  productName: "학용품",
  quantity: 1,
  unitPrice: 100,
  totalPrice: 100,
  revision: 1,
  status: "REQUESTED",
  reviewReason: "",
  createdAt: "2026-08-18T01:01:00.000Z",
  reviewedAt: null,
  updatedAt: "2026-08-18T01:01:00.000Z",
};
for (const wireRow of [wireLedgerEntry, wireOrder]) {
  assert.doesNotMatch(
    JSON.stringify(wireRow),
    /actorUid|commandId|receiptId|reviewedBy|accountId|studentUid/u,
  );
}

const hydrated = hydrateLegacyStudentWisOwnProjection(
  {
    account: { accountId, studentUid },
    ledger: [wireLedgerEntry],
    orders: [wireOrder],
  },
  studentUid,
);
const visibleLedger = hydrated.ledger.filter(
  (entry) => entry.accountId === accountId,
);
const visibleOrders = hydrated.orders.filter(
  (order) => order.studentUid === studentUid,
);
assert.equal(visibleLedger.length, 1);
assert.equal(visibleLedger[0].studentUid, studentUid);
assert.equal(visibleLedger[0].sourceId, "lesson-core-points-all");
assert.equal(visibleOrders.length, 1);
assert.equal(visibleOrders[0].accountId, accountId);

for (const functionName of [
  "getLegacyStudentPointWalletByUid",
  "listLegacyStudentPointTransactionsByUid",
  "listLegacyStudentPointOrders",
]) {
  const start = adapterSource.indexOf(`export const ${functionName}`);
  const end = adapterSource.indexOf("\nexport const ", start + 1);
  assert.ok(start >= 0, `${functionName} must exist`);
  assert.match(
    adapterSource.slice(start, end >= 0 ? end : undefined),
    /hydrateLegacyStudentWisOwnProjection/u,
    `${functionName} must hydrate the authenticated student's own projection`,
  );
}
assert.match(
  adapterSource,
  /entry\.type === "GRANT" && entry\.sourceId === "lesson-core-points-all"/u,
);

const loadAdapterFunction = (name, dependencies = {}) => {
  const statement = sourceFile.statements.find((item) => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some((declaration) => declaration.name.getText(sourceFile) === name));
  assert.ok(statement, `${name} must exist`);
  const code = ts.transpileModule(statement.getText(sourceFile).replace(/^export\s+/u, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}\nreturn ${name};`)(...Object.values(dependencies));
};
const mapLedgerType = loadAdapterFunction("mapLedgerType");
assert.equal(mapLedgerType({ type: "GRANT", delta: 10, activityType: "history_dictionary" }), "history_dictionary");
assert.equal(mapLedgerType({ type: "REVERSAL", delta: -10, activityType: "history_dictionary_reclaim" }), "history_dictionary_reclaim");
assert.equal(mapLedgerType({ type: "DEDUCT", delta: -10, activityType: "history_dictionary" }), "manual_reclaim");
assert.equal(mapLedgerType({ type: "GRANT", delta: 10, activityType: "history_dictionary_reclaim" }), "manual_adjust");
assert.equal(mapLedgerType({ type: "GRANT", delta: 10, activityType: "internal-type" }), "manual_adjust");
const mapOrders = loadAdapterFunction("mapOrders", { parseSchoolIdentity: () => ({}), mapOrderStatus: (status) => status });
assert.equal(mapOrders({ accounts: [], orders: [{ memo: "구매 요청", reviewReason: "" }] })[0].memo, "구매 요청");
assert.equal(mapOrders({ accounts: [], orders: [{ memo: "구매 요청", reviewReason: "처리 메모" }] })[0].memo, "처리 메모");
assert.equal(mapOrders({ accounts: [], orders: [{}] })[0].memo, "");

let retainedIntent;
let loseResponse = true;
const dispatches = [];
const requestPurchase = loadAdapterFunction("requestLegacyStudentWisPurchase", {
  semesterKey: () => "2026-2",
  getLegacyWisMutationIntent: () => retainedIntent,
  getOrCreateLegacyWisMutationIntent: (_key, factory) => retainedIntent ||= { commandId: "same-order-command", payload: factory() },
  forgetLegacyWisMutationIntent: () => { retainedIntent = undefined; },
  shouldForgetLegacyWisIntentAfterError: () => false,
  pendingQueries: new Map(),
  queryState: async () => ({ semesterId: "2026-2", manifestRevision: 1, account: { revision: 2 }, inventory: [{ productId: "product-1", inventoryId: "inventory-1", revision: 3, active: true, available: 2 }] }),
  requireWritableState: () => ({ revision: 4 }),
  LegacyWisPresentationError: Error,
  placeWisOrder: async (payload, options) => {
    dispatches.push(structuredClone({ payload, options }));
    if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
    return { result: { orderId: "original-order" }, replayed: true };
  },
});
const purchaseInput = { config: {}, uid: studentUid, productId: "product-1", requestKey: "intent-1", memo: "  파란색/검은색\n파란색 요청  " };
await assert.rejects(() => requestPurchase(purchaseInput), /response lost/u);
await requestPurchase({ ...purchaseInput, memo: "응답 유실 후 편집된 메모" });
assert.equal(dispatches[0].payload.memo, "파란색/검은색\n파란색 요청");
assert.deepEqual(dispatches[1], dispatches[0], "uncertain retries preserve original memo, revisions and command ID");
assert.equal(retainedIntent, undefined);
await requestPurchase({ ...purchaseInput, requestKey: "intent-2", memo: " " });
assert.equal(dispatches[2].payload.memo, "");

console.log(
  JSON.stringify({
    suite: "w10p-wis-presentation-adapter",
    passed: true,
    wireSensitiveFields: 0,
    ledgerRows: visibleLedger.length,
    lessonRewardRows: visibleLedger.filter(
      (entry) => entry.sourceId === "lesson-core-points-all",
    ).length,
    orderRows: visibleOrders.length,
    addedChecks: ["dictionary activity/type mapping", "purchase and review memo display", "purchase memo dispatch", "response-loss original memo replay"],
    productionAccess: 0,
  }),
);
