import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { analyzeClientBoundary } from "./verify-client-direct-write-boundary.mjs";

const read = (path) => readFileSync(resolve(path), "utf8");
const clientPaths = [
  "src/lib/wisEconomy.ts",
  "src/lib/legacyWisPresentationAdapter.ts",
  "src/pages/student/Points.tsx",
  "src/pages/student/WisEconomyStudentView.tsx",
  "src/pages/teacher/ManagePoints.tsx",
  "src/pages/teacher/components/points/HallOfFameManagementTab.tsx",
  "src/pages/teacher/components/points/PointsOverviewTab.tsx",
  "src/pages/teacher/WisEconomyManager.tsx",
];
const mutationPattern =
  /\b(?:addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|uploadBytes|deleteObject)\s*\(/u;
for (const path of clientPaths) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    mutationPattern,
    `${path} retains a direct SDK mutation.`,
  );
  assert.doesNotMatch(
    source,
    /from\s+["']firebase\/(?:firestore|storage)["']/u,
    `${path} imports a direct persistence SDK.`,
  );
}
const client = read(clientPaths[0]);
const legacyAdapter = read("src/lib/legacyWisPresentationAdapter.ts");
const server = read("functions/wisEconomy.js");
assert.match(client, /getWisEconomyState/u);
for (const command of [
  "createSemesterEconomy",
  "createWisAccounts",
  "grantInitialWis",
  "grantWis",
  "deductWis",
  "adjustWis",
  "reverseWisEntry",
  "rebuildWisProjection",
  "transitionWisEconomy",
  "upsertWisProduct",
  "upsertWisInventory",
  "placeWisOrder",
  "reviewWisOrder",
  "saveWisHallOfFameConfig",
]) {
  assert.ok(
    read("functions/wisEconomy.js").includes(command),
    `Missing W7 command ${command}.`,
  );
}
const analysis = analyzeClientBoundary({ rootDir: process.cwd() });
const owned = new Set(clientPaths);
const forbidden = analysis.observations.filter(
  (entry) =>
    owned.has(entry.file) && ["FIRESTORE", "STORAGE"].includes(entry.boundary),
);
assert.deepEqual(forbidden, []);
const implicit = analysis.observations.filter(
  (entry) =>
    owned.has(entry.file) &&
    entry.triggers.some((trigger) =>
      ["MOUNT", "LISTENER", "TIMER", "UNMOUNT"].includes(trigger),
    ) &&
    entry.boundary !== "QUERY_CALLABLE",
);
assert.deepEqual(implicit, []);
const app = read("src/App.tsx");
assert.match(app, /import\("\.\/pages\/student\/Points"\)/u);
assert.match(app, /import\("\.\/pages\/teacher\/ManagePoints"\)/u);
assert.match(
  legacyAdapter,
  /if \(productChanged && inventoryChanged\)[\s\S]*?한 종류씩 나누어 저장/u,
  "Legacy product form must reject non-atomic product + inventory writes",
);
assert.doesNotMatch(
  legacyAdapter,
  /getArchiveEnrollmentState|queryCurrentEnrollmentState/u,
  "Point-manage roster must come from the authorized Wis projection.",
);
assert.match(server, /projectTeacherRosterFields/u);
for (const field of ["grade", "classNumber", "studentNumber"]) {
  assert.match(
    server,
    new RegExp(`${field}: validEnrollment`, "u"),
    `Teacher Wis projection is missing ${field}.`,
  );
}
const queryCoreSource = server.slice(
  server.indexOf("const createWisQueryCore"),
  server.indexOf("const createWisCallableExports"),
);
assert.match(queryCoreSource, /queryBoundedDocumentPage/u);
assert.match(queryCoreSource, /queryBoundedCreatedAtPage/u);
assert.match(server, /const WIS_HALL_ACCOUNT_LIMIT = 2_000/u);
assert.match(server, /limit: WIS_HALL_ACCOUNT_LIMIT \+ 1/u);
assert.doesNotMatch(
  queryCoreSource,
  /transaction\.query\(WIS_RANKING_COLLECTION/u,
  "Student own ranking must use a direct own-document projection.",
);
const assertOwnRankingReadContract = (source) => {
  const tree = ts.createSourceFile("wis-query.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
      && node.name.elements.some((element) => ts.isBindingElement(element)
        && ts.isIdentifier(element.name) && element.name.text === "ownRankingSnapshot")) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  assert.equal(declarations.length, 1, "The student own ranking must have exactly one explicit result binding.");
  const declaration = declarations[0];
  assert.ok(declaration.initializer && ts.isAwaitExpression(declaration.initializer),
    "The parallel ranking read must be awaited before its result is exposed.");
  const aggregate = declaration.initializer.expression;
  assert.ok(ts.isCallExpression(aggregate)
    && ts.isPropertyAccessExpression(aggregate.expression)
    && ts.isIdentifier(aggregate.expression.expression)
    && aggregate.expression.expression.text === "Promise"
    && aggregate.expression.name.text === "all"
    && aggregate.arguments.length === 1
    && ts.isArrayLiteralExpression(aggregate.arguments[0]),
  "Ranking and ledger reads must be collected by an awaited Promise.all.");
  const resultIndex = declaration.name.elements.findIndex((element) => ts.isBindingElement(element)
    && ts.isIdentifier(element.name) && element.name.text === "ownRankingSnapshot");
  const rankingRead = aggregate.arguments[0].elements[resultIndex];
  assert.ok(rankingRead && ts.isCallExpression(rankingRead)
    && ts.isPropertyAccessExpression(rankingRead.expression)
    && ts.isIdentifier(rankingRead.expression.expression)
    && rankingRead.expression.expression.text === "transaction"
    && rankingRead.expression.name.text === "get"
    && rankingRead.arguments.length === 1,
  "The ranking result slot must contain a direct transaction.get, never a collection query.");
  const ownPath = rankingRead.arguments[0];
  assert.ok(ts.isCallExpression(ownPath) && ts.isIdentifier(ownPath.expression)
    && ownPath.expression.text === "rankingPath" && ownPath.arguments.length === 1
    && ts.isIdentifier(ownPath.arguments[0]) && ownPath.arguments[0].text === "ownAccountId",
  "The ranking read must use the authenticated student's own account path.");
};
assert.match(queryCoreSource, /const ownAccountId = accountIdFor\(query\.semesterId, uid\)/u);
assertOwnRankingReadContract(queryCoreSource);
for (const [label, before, after] of [
  ["unawaited reads", "const [recentLedger, ownRankingSnapshot] = await Promise.all", "const [recentLedger, ownRankingSnapshot] = Promise.all"],
  ["foreign account", "transaction.get(rankingPath(ownAccountId))", "transaction.get(rankingPath(targetAccountId))"],
  ["collection read", "transaction.get(rankingPath(ownAccountId))", "transaction.query(WIS_RANKING_COLLECTION)"],
  ["wrong result binding", "const [recentLedger, ownRankingSnapshot]", "const [ownRankingSnapshot, recentLedger]"],
]) {
  assert.ok(queryCoreSource.includes(before), `Missing mutation target: ${label}`);
  assert.throws(() => assertOwnRankingReadContract(queryCoreSource.replace(before, after)),
    { name: "AssertionError" }, `The ranking contract must reject ${label}.`);
}
assert.match(server, /const projectWisAccount/u);
assert.doesNotMatch(
  server.slice(
    server.indexOf("const projectWisAccount"),
    server.indexOf("const maskStudentName"),
  ),
  /recentLedgerEntries/u,
  "Public account responses must not embed the recent-ledger cache.",
);
assert.match(server, /const gradeEntries = studentAccount/u);
assert.match(
  server,
  /const classEntries = studentAccount[\s\S]*?entry\.classKey === studentClassKey/u,
);
assert.match(server, /\["point_read", "point_manage"\]/u);
assert.match(
  server,
  /const portalEligible =\s*role === "teacher" \|\| profileData\.teacherPortalEnabled === true/u,
);
assert.match(legacyAdapter, /sourceId === "lesson-core-points-all"/u);
assert.match(legacyAdapter, /reclaimed:\s*entry\.type === "REVERSAL"/u);
assert.doesNotMatch(
  legacyAdapter.slice(
    legacyAdapter.indexOf("const mapWallet"),
    legacyAdapter.indexOf("const mapProducts"),
  ),
  /entries\.length\s*\?/u,
  "Wallet totals must come from the canonical account projection.",
);
const pointsOverview = read(
  "src/pages/teacher/components/points/PointsOverviewTab.tsx",
);
assert.match(pointsOverview, /canManage &&\s*!transaction\.reclaimed/u);
const studentPoints = read("src/pages/student/Points.tsx");
assert.match(studentPoints, /HallOfFameLoadStatus/u);
assert.match(studentPoints, /화랑의 전당을 불러오지 못했습니다/u);
assert.match(studentPoints, />\s*다시 시도\s*</u);

const firestoreIndexes = JSON.parse(read("firestore.indexes.json"));
const wisIndexes = firestoreIndexes.indexes.filter((index) =>
  ["semester_wis_ledger", "semester_wis_orders"].includes(
    index.collectionGroup,
  ),
);
const indexContract = (collectionGroup, equalityFields, paginated = false) => ({
  collectionGroup,
  queryScope: "COLLECTION",
  fields: [
    ...equalityFields.map((fieldPath) => ({ fieldPath, order: "ASCENDING" })),
    ...(paginated
      ? [
          { fieldPath: "createdAt", order: "DESCENDING" },
          { fieldPath: "__name__", order: "DESCENDING" },
        ]
      : []),
  ],
});
// Reward eligibility uses bounded equality queries, while wallet/order pages
// require deterministic createdAt + document-id cursor ordering.
const rewardScopeFields = ["semesterId", "studentUid", "type", "activityType"];
const expectedWisIndexes = [
  indexContract("semester_wis_ledger", rewardScopeFields),
  indexContract("semester_wis_ledger", [...rewardScopeFields, "targetDate"]),
  indexContract("semester_wis_ledger", ["accountId"], true),
  ...[
    ["semesterId"],
    ["accountId"],
    ["semesterId", "status"],
    ["accountId", "status"],
  ].map((fields) => indexContract("semester_wis_orders", fields, true)),
];
const indexSignatures = (indexes) =>
  indexes
    .map(({ collectionGroup, queryScope, fields }) =>
      JSON.stringify({ collectionGroup, queryScope, fields }),
    )
    .sort();
assert.deepEqual(
  indexSignatures(wisIndexes),
  indexSignatures(expectedWisIndexes),
  "Wis indexes must cover the exact reward scope and cursor pagination contracts.",
);
assert.match(
  legacyAdapter,
  /if \(!currentProduct \|\| !currentInventory\)[\s\S]*?새 상품을 저장할 수 없습니다/u,
  "Legacy product creation must fail closed until an atomic command exists",
);
const studentMenuAccess = read("src/lib/studentMenuAccess.ts");
assert.match(
  studentMenuAccess,
  /"\/student\/points": new Set\(\["semesterId", "source"\]\)/u,
);
assert.match(studentMenuAccess, /targetHasMenuSearchParams/u);
const rules = read("firestore.rules");
for (const name of [
  "semester_wis_economies",
  "semester_wis_accounts",
  "semester_wis_ledger",
  "semester_wis_balances",
  "semester_wis_rankings",
  "wis_product_catalog",
  "semester_wis_inventory",
  "semester_wis_orders",
  "semester_wis_reconciliation_reports",
  "wis_legacy_issues",
]) {
  assert.match(
    rules,
    new RegExp(
      `match /${name}/\\{documentId\\} \\{[\\s\\S]*?allow read, create, update, delete: if false;`,
      "u",
    ),
  );
}
console.log(
  JSON.stringify({
    suite: "w7-wis-query-purity",
    passed: true,
    directReads: 0,
    directWrites: 0,
    implicitWrites: 0,
    queryCallable: "getWisEconomyState",
    productionAccess: 0,
  }),
);
