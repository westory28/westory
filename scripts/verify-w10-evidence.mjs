import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const schema = readJson("scripts/w10-evidence-schema.json");
const matrix = readJson("scripts/w10-browser-matrix.json");
const routes = readJson("scripts/w10-route-inventory.json");
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name) =>
  String(
    args
      .find((item) => item.startsWith(`--${name}=`))
      ?.split("=")
      .slice(1)
      .join("=") || "",
  ).trim();
assert.equal(
  has("dry-run") || has("verify"),
  true,
  "Choose --dry-run or --verify.",
);
assert.equal(has("dry-run") && has("verify"), false);
assert.equal(schema.schemaVersion, 1);
assert.equal(matrix.schemaVersion, 1);
assert.equal(matrix.fixtureOwner, schema.fixtureOwner);
assert.equal(matrix.projectId, "westory-staging-177587430482");
assert.notEqual(matrix.projectId, "history-quiz-yongsin");
assert.equal(matrix.viewports.length, 5);
assert.deepEqual(
  matrix.viewports.map(({ width, height }) => `${width}x${height}`),
  ["390x844", "768x1024", "1024x768", "1280x800", "1600x900"],
);
assert.equal(
  new Set(matrix.personas.map((item) => item.id)).size,
  matrix.personas.length,
);
assert.equal(
  new Set(matrix.routeGroups.map((item) => item.id)).size,
  matrix.routeGroups.length,
);
for (const group of matrix.routeGroups.filter((item) => item.inventoryKey)) {
  assert.ok(
    Array.isArray(routes[group.inventoryKey]),
    `Unknown inventory key: ${group.inventoryKey}`,
  );
}

const plannedCanonicalViewportCases =
  (routes.studentCanonical.length +
    routes.teacherCanonical.length +
    routes.legacyAliases.length) *
  matrix.viewports.length;
const viewportIds = matrix.viewports.map((item) => item.id);
const expectedRouteCases = matrix.routeGroups.flatMap((group) => {
  const routeItems = group.inventoryKey
    ? routes[group.inventoryKey]
    : group.routes;
  const groupViewports =
    group.viewports === "ALL" ? viewportIds : group.viewports;
  return routeItems.flatMap((routeItem) => {
    const inventoryPath =
      typeof routeItem === "string" ? routeItem : routeItem.path;
    const route =
      typeof routeItem === "string"
        ? routeItem
        : routeItem.testPath || routeItem.path;
    const disposition = routes.routeDispositions.find(
      (item) => item.path === inventoryPath,
    )?.disposition;
    const expected =
      group.dispositionOverrides?.[disposition] || group.expected;
    const persona =
      group.persona === "MATCHING_PORTAL"
        ? route.startsWith("/teacher/")
          ? "teacher"
          : "student"
        : group.persona;
    return groupViewports.map((viewportId) => ({
      route,
      persona,
      viewportId,
      expected,
    }));
  });
});
const routeCaseKey = ({ route, persona, viewportId, expected }) =>
  `${route}\n${persona}\n${viewportId}\n${expected}`;
const viewportCaseKey = ({ route, persona, viewportId }) =>
  `${route}\n${persona}\n${viewportId}`;
assert.equal(
  new Set(expectedRouteCases.map(routeCaseKey)).size,
  expectedRouteCases.length,
  "The browser route matrix contains duplicate cases.",
);

if (has("dry-run")) {
  console.log(
    JSON.stringify({
      suite: "w10-evidence-dry-run",
      passed: true,
      fixtureOwner: schema.fixtureOwner,
      projectId: matrix.projectId,
      viewports: matrix.viewports.length,
      personas: matrix.personas.length,
      routeGroups: matrix.routeGroups.length,
      canonicalViewportCases: plannedCanonicalViewportCases,
      totalRouteViewportCases: expectedRouteCases.length,
      journeys: matrix.journeys.length,
      stateCases: matrix.stateCases.length,
      plannedWrites: 0,
      productionAccess: 0,
    }),
  );
  process.exit(0);
}

const testRunId = value("test-run-id");
assert.match(testRunId, new RegExp(schema.testRunIdPattern, "u"));
const evidenceRoot =
  value("evidence-root") ||
  schema.evidenceRoot.replace("{testRunId}", testRunId);
for (const file of schema.requiredFiles) {
  assert.equal(
    existsSync(resolve(evidenceRoot, file)),
    true,
    `Missing evidence: ${file}`,
  );
}
const evidence = Object.fromEntries(
  schema.requiredFiles.map((file) => [
    file,
    readJson(resolve(evidenceRoot, file)),
  ]),
);
const metadata = evidence["metadata.json"];
for (const field of schema.metadataRequired)
  assert.ok(field in metadata, `Metadata field missing: ${field}`);
assert.equal(metadata.fixtureOwner, schema.fixtureOwner);
assert.equal(metadata.testRunId, testRunId);
assert.equal(metadata.projectId, matrix.projectId);
assert.equal(metadata.stableAlias, matrix.stableAlias);
assert.match(metadata.commitSha, /^[a-f0-9]{40}$/u);
for (const field of [
  "productionAccess",
  "productionMutationCount",
  "credentialValueCount",
  "tokenValueCount",
]) {
  assert.equal(metadata[field], 0, `${field} must remain zero.`);
}

const scanForbiddenKeys = (node, path = "evidence") => {
  if (Array.isArray(node))
    return node.forEach((item, index) =>
      scanForbiddenKeys(item, `${path}[${index}]`),
    );
  if (!node || typeof node !== "object") return;
  for (const [key, item] of Object.entries(node)) {
    assert.equal(
      schema.forbiddenEvidenceKeys.includes(key),
      false,
      `Forbidden evidence key: ${path}.${key}`,
    );
    scanForbiddenKeys(item, `${path}.${key}`);
  }
};
scanForbiddenKeys(evidence);

const assertRows = (file, required) => {
  const rows = evidence[file];
  assert.equal(Array.isArray(rows), true, `${file} must be an array.`);
  for (const row of rows) {
    for (const field of required)
      assert.ok(field in row, `${file} missing ${field}`);
    assert.equal(row.status, "PASS", `${file} contains a non-PASS row.`);
  }
  return rows;
};
const routeRows = assertRows("route-results.json", schema.routeResultRequired);
const viewportRows = assertRows(
  "viewport-results.json",
  schema.viewportResultRequired,
);
assert.deepEqual(
  routeRows.map(routeCaseKey).sort(),
  expectedRouteCases.map(routeCaseKey).sort(),
  "Route evidence must exactly cover the source-backed browser matrix.",
);
assert.deepEqual(
  viewportRows.map(viewportCaseKey).sort(),
  expectedRouteCases.map(viewportCaseKey).sort(),
  "Viewport evidence must exactly cover the route matrix without duplicates or omissions.",
);
for (const row of routeRows) {
  assert.equal(row.queryWriteCount, 0);
  assert.equal(row.consoleUnexpectedErrorCount, 0);
}
for (const row of viewportRows) {
  assert.equal(row.horizontalOverflowPx, 0);
  assert.equal(row.navigationOverlapCount, 0);
  assert.equal(row.dialogViewportEscapeCount, 0);
  assert.equal(row.primaryActionReachable, true);
  assert.equal(row.currentLocationVisible, true);
}
const journeyRows = assertRows(
  "journey-results.json",
  schema.journeyResultRequired,
);
assert.deepEqual(
  journeyRows.map((row) => row.journeyId).sort(),
  [...matrix.journeys].sort(),
  "Journey evidence must cover each W10 journey exactly once.",
);
const stateRows = assertRows("state-results.json", schema.stateResultRequired);
assert.deepEqual(
  stateRows.map((row) => row.state).sort(),
  [...matrix.stateCases].sort(),
  "State evidence must cover each common state exactly once.",
);
const accessibilityRows = assertRows(
  "accessibility-results.json",
  schema.accessibilityResultRequired,
);
assert.deepEqual(
  [...new Set(accessibilityRows.map((row) => row.viewportId))].sort(),
  [...viewportIds].sort(),
  "Accessibility evidence must include all five required viewports.",
);
for (const row of accessibilityRows) {
  assert.equal(row.axeCritical, 0);
  assert.equal(row.axeSerious, 0);
  assert.equal(row.keyboardPass, true);
  assert.equal(row.focusOrderPass, true);
}
const networkRows = assertRows(
  "network-write-results.json",
  schema.networkWriteResultRequired,
);
assert.deepEqual(
  networkRows.map(viewportCaseKey).sort(),
  expectedRouteCases.map(viewportCaseKey).sort(),
  "Network purity evidence must exactly cover every route/viewport case.",
);
for (const row of networkRows) {
  assert.equal(row.mountWriteCount, 0);
  assert.equal(row.listenerWriteCount, 0);
}
const cleanup = evidence["cleanup-results.json"];
for (const field of schema.cleanupRequiredZeroFields)
  assert.equal(cleanup[field], 0, `${field} must be zero.`);

console.log(
  JSON.stringify({
    suite: "w10-evidence-verify",
    passed: true,
    testRunId,
    routeResults: routeRows.length,
    viewportResults: viewportRows.length,
    journeyResults: journeyRows.length,
    stateResults: stateRows.length,
    accessibilityResults: accessibilityRows.length,
    networkWriteResults: networkRows.length,
    residuals: 0,
    tokenValues: 0,
    productionAccess: 0,
  }),
);
