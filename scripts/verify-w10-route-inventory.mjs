import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) => readFileSync(resolve(path), "utf8");
const manifest = JSON.parse(read("scripts/w10-route-inventory.json"));
const app = read(manifest.sourceOfTruth.router);
const metadata = read(manifest.sourceOfTruth.metadata);
const accessGate = read("src/components/auth/ProtectedAccessGate.tsx");
const accessBoundary = read(manifest.sourceOfTruth.accessBoundary);
const maintenanceBoundary = read(manifest.sourceOfTruth.maintenanceBoundary);
const dialogBoundary = read(manifest.sourceOfTruth.dialogBoundary);

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.wave, "W10");
assert.match(manifest.baselineSha, /^[a-f0-9]{40}$/u);
assert.equal(manifest.expectedCounts.unknown, 0);

const unique = (values, label) => {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicate entries.`,
  );
};
unique(manifest.studentCanonical, "student canonical routes");
unique(manifest.teacherCanonical, "teacher canonical routes");
unique(
  manifest.legacyAliases.map((item) => item.path),
  "legacy aliases",
);
unique(
  manifest.integrationRoutes.map((item) => item.path),
  "integration routes",
);
unique(
  manifest.stateSurfaces.map((item) => item.id),
  "state surface IDs",
);

assert.equal(
  manifest.studentCanonical.length,
  manifest.expectedCounts.studentCanonical,
);
assert.equal(
  manifest.teacherCanonical.length,
  manifest.expectedCounts.teacherCanonical,
);
assert.equal(
  manifest.legacyAliases.length,
  manifest.expectedCounts.legacyAliases,
);
assert.equal(
  manifest.integrationRoutes.length,
  manifest.expectedCounts.integrationRoutes,
);
assert.equal(manifest.coreRoutes.length, manifest.expectedCounts.coreRoutes);
assert.equal(
  manifest.auxiliaryRoutes.length,
  manifest.expectedCounts.auxiliaryRoutes,
);

const registeredRoutes = [
  ...app.matchAll(/<Route\b[\s\S]*?\bpath="([^"]+)"/gu),
].map((match) => match[1]);
unique(registeredRoutes, "registered App routes");
assert.equal(registeredRoutes.length, manifest.expectedCounts.registeredRoutes);

const inventoriedRoutes = [
  ...manifest.coreRoutes.map((item) => item.path),
  ...manifest.studentCanonical,
  ...manifest.teacherCanonical,
  ...manifest.legacyAliases.map((item) => item.path),
  ...manifest.integrationRoutes.map((item) => item.path),
  ...manifest.auxiliaryRoutes,
];
unique(inventoriedRoutes, "combined route inventory");
assert.deepEqual(
  [...registeredRoutes].sort(),
  [...inventoriedRoutes].sort(),
  "Every registered route must have exactly one W10 inventory disposition.",
);

const allowedDispositions = new Set([
  "COMPLETE",
  "INTEGRATE",
  "REBUILD_PRESENTATION",
  "REMOVE_LEGACY_UI",
  "RELEASE_DECISION",
]);
assert.equal(
  manifest.routeDispositions.length,
  manifest.expectedCounts.registeredRoutes,
  "Each registered route must have exactly one explicit W10 disposition row.",
);
unique(
  manifest.routeDispositions.map((item) => item.id),
  "route disposition IDs",
);
unique(
  manifest.routeDispositions.map((item) => item.path),
  "route disposition paths",
);
assert.deepEqual(
  manifest.routeDispositions.map((item) => item.path).sort(),
  [...registeredRoutes].sort(),
  "The disposition manifest must exactly cover the registered route set.",
);

const dispositionCounts = Object.fromEntries(
  [...allowedDispositions, "UNKNOWN"].map((disposition) => [disposition, 0]),
);
for (const item of manifest.routeDispositions) {
  assert.equal(
    allowedDispositions.has(item.disposition),
    true,
    `Unknown route disposition: ${item.id} (${item.disposition})`,
  );
  dispositionCounts[item.disposition] += 1;
  for (const field of ["sourceFile", "component", "reason", "status"]) {
    assert.equal(
      typeof item[field],
      "string",
      `Route disposition ${item.id} is missing ${field}.`,
    );
    assert.ok(
      item[field].trim().length > 0,
      `Route disposition ${item.id} has an empty ${field}.`,
    );
  }
  assert.equal(
    existsSync(resolve(item.sourceFile)),
    true,
    `Route disposition source does not exist: ${item.id} (${item.sourceFile})`,
  );
}
assert.deepEqual(
  dispositionCounts,
  manifest.expectedDispositionCounts,
  "Disposition counts must be derived from the 47-row source-backed manifest.",
);
assert.equal(dispositionCounts.UNKNOWN, 0);

const routeSlice = (path) => {
  const marker = `path="${path}"`;
  const start = app.indexOf(marker);
  assert.ok(start >= 0, `Route is not registered: ${path}`);
  const next = app.indexOf("<Route", start + marker.length);
  return app.slice(start, next < 0 ? app.length : next);
};

for (const item of manifest.routeDispositions) {
  const slice = routeSlice(item.path);
  assert.ok(
    slice.includes(`<${item.component}`),
    `Registered route does not mount its declared component: ${item.id} (${item.component})`,
  );
  if (item.disposition === "REMOVE_LEGACY_UI") {
    assert.equal(item.component, "LegacyRouteRedirect");
    assert.equal(typeof item.target, "string");
    assert.ok(
      slice.includes(`LegacyRouteRedirect to="${item.target}"`),
      `Legacy alias target drift: ${item.path} -> ${item.target}`,
    );
  }
}

const protectedRoutes = [
  ...manifest.studentCanonical,
  ...manifest.teacherCanonical,
  ...manifest.integrationRoutes.map((item) => item.path),
];
for (const path of protectedRoutes) {
  const slice = routeSlice(path);
  assert.equal(
    slice.includes("renderWithLayout(") ||
      slice.includes("LegacyRouteRedirect"),
    true,
    `Protected route bypasses the access boundary: ${path}`,
  );
  const integration = manifest.integrationRoutes.find(
    (item) => item.path === path,
  );
  const metadataPath = integration?.metadataPath || path;
  assert.ok(
    metadata.includes(`path: "${metadataPath}"`),
    `Route metadata is missing: ${path}`,
  );
  if (integration?.metadataDisposition === "PARENT_PREFIX") {
    assert.equal(path.startsWith(`${metadataPath}/`), true);
  } else if (integration) {
    assert.equal(integration.metadataDisposition, "EXACT");
    assert.equal(metadataPath, path);
  }
}

for (const { path, target } of manifest.legacyAliases) {
  assert.ok(
    routeSlice(path).includes(`LegacyRouteRedirect to="${target}"`),
    `Alias target drift: ${path} -> ${target}`,
  );
}

for (const item of manifest.coreRoutes) {
  assert.equal(existsSync(resolve(item.sourceFile)), true);
  assert.ok(
    read(item.sourceFile).includes(item.anchor),
    `Core route source anchor is missing: ${item.id}`,
  );
}
for (const item of manifest.stateSurfaces) {
  assert.equal(existsSync(resolve(item.sourceFile)), true);
  assert.ok(
    read(item.sourceFile).includes(item.anchor),
    `State surface source anchor is missing: ${item.id}`,
  );
}

assert.match(app, /HashRouter as Router/u);
assert.match(
  app,
  /const renderWithLayout[\s\S]*?<ProtectedAccessGate>[\s\S]*?<AppDialogProvider>[\s\S]*?<MainLayout>/u,
);
assert.match(accessGate, /resolveProtectedRouteAccess/u);
for (const status of [
  "AUTHORIZED",
  "AUTHENTICATING",
  "SESSION_EXPIRED",
  "ERROR",
]) {
  assert.ok(accessBoundary.includes(status), `Access state missing: ${status}`);
}
assert.match(accessBoundary, /state="PERMISSION"/u);
assert.match(
  maintenanceBoundary,
  /<Navigate to=\{STUDENT_MAINTENANCE_ROUTE\}/u,
);
assert.match(
  dialogBoundary,
  /role=\{dialog\.kind === "confirm" \? "alertdialog" : "dialog"\}/u,
);
assert.match(dialogBoundary, /aria-modal="true"/u);
assert.match(dialogBoundary, /event\.key === "Escape"/u);
assert.match(dialogBoundary, /opener\?\.focus\?\.\(\)/u);

console.log(
  JSON.stringify({
    suite: "w10-route-inventory",
    passed: true,
    canonicalRoutes: {
      student: manifest.studentCanonical.length,
      teacher: manifest.teacherCanonical.length,
    },
    legacyAliases: manifest.legacyAliases.length,
    integrationRoutes: manifest.integrationRoutes.length,
    registeredRoutes: registeredRoutes.length,
    dispositions: dispositionCounts,
    stateSurfaces: manifest.stateSurfaces.length,
    duplicateRoutes: 0,
    missingSourceAnchors: 0,
    unknown: 0,
    productionAccess: 0,
  }),
);
