import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const evidencePath = resolve(
  "docs/evidence/w10r-ui-recovery/w10r-canonical-20260817/browser-navigation-results.json",
);
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
const requiredScenarios = new Set([
  "teacher.desktop-child-menu-click",
  "teacher.query-tab-history-back",
  "teacher.route-refresh",
  "teacher.direct-new-tab",
  "teacher.mobile-drawer-child",
  "teacher.keyboard-dropdown-focus",
  "teacher.unauthorized-admin-hidden",
  "student.desktop-child-menu-click",
  "student.mobile-bottom-nav",
  "student.mobile-more-drawer",
  "student.route-refresh",
  "student.history-back",
  "student.direct-new-tab",
  "admin.cutover-direct",
  "admin.cutover-refresh",
]);

assert.equal(evidence.schemaVersion, 1);
assert.equal(evidence.phase, "W10R");
assert.equal(evidence.status, "PASS");
assert.match(evidence.testRunId, /^w10r-[a-z0-9][a-z0-9-]{7,63}$/u);
assert.equal(evidence.branch, "codex/phase6-w10r-ui-recovery");
assert.match(evidence.sourceCommitSha, /^[a-f0-9]{40}$/u);
assert.equal(evidence.projectId, "westory-staging-177587430482");
assert.equal(
  evidence.stableAlias,
  "https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app",
);
assert.match(
  evidence.deploymentUrl,
  /^https:\/\/westory-staging-[a-z0-9]{9,}-bbbs-projects-44f9da30\.vercel\.app\/?$/u,
);
assert.match(evidence.deploymentId, /^dpl_[A-Za-z0-9]{20,}$/u);
assert.equal(Number.isNaN(Date.parse(evidence.executedAt)), false);
assert.equal(evidence.browser, "Codex in-app Browser");
assert.equal(evidence.productionAccess, 0);
assert.equal(evidence.productionWrites, 0);
assert.equal(Array.isArray(evidence.scenarios), true);
assert.equal(evidence.scenarios.length, requiredScenarios.size);

const observed = new Set();
for (const scenario of evidence.scenarios) {
  assert.equal(requiredScenarios.has(scenario.id), true, scenario.id);
  assert.equal(observed.has(scenario.id), false, scenario.id);
  observed.add(scenario.id);
  assert.ok(["student", "teacher", "admin"].includes(scenario.role));
  assert.equal(Number.isInteger(scenario.viewport?.width), true);
  assert.equal(Number.isInteger(scenario.viewport?.height), true);
  assert.equal(scenario.viewport.dpr, 1);
  assert.equal(Array.isArray(scenario.actions), true);
  assert.ok(scenario.actions.length > 0);
  assert.match(scenario.finalRoute, /^\/(?:student|teacher)\//u);
  assert.ok(String(scenario.heading || "").trim());
  assert.equal(scenario.activeParentCount, 1);
  assert.equal(scenario.navigationMountCount, 1);
  assert.equal(scenario.horizontalOverflow, 0);
  assert.equal(scenario.consoleErrorCount, 0);
  assert.notEqual(scenario.focusTarget, "body");
  assert.equal(scenario.status, "PASS");
}
assert.deepEqual([...observed].sort(), [...requiredScenarios].sort());

console.log(
  JSON.stringify({
    suite: "w10r-browser-navigation",
    passed: true,
    scenarios: observed.size,
    roles: 3,
    desktopAndMobile: true,
    clickRefreshBackNewTab: true,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
