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
    productionAccess: 0,
  }),
);
