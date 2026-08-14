import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  assertW11DeploymentProvenance,
  verifyW11ScreenshotManifest,
} from "./verify-w11-screenshot-manifest.mjs";

const STAGING_PROJECT_ID = "westory-staging-177587430482";
const FIXTURE_OWNER = "w11-semester-cutover-staging";
const STABLE_ALIAS =
  "https://westory-staging-westoria28-8028-bbbs-projects-44f9da30.vercel.app";
const BROWSER_FILES = [
  "preview-results.json",
  "state-results.json",
  "viewport-results.json",
  "accessibility-results.json",
  "network-write-results.json",
];
const args = process.argv.slice(2);
const valueArg = (name) =>
  String(
    args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ||
      "",
  ).trim();
const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const writeJson = (root, name, value) =>
  writeFileSync(
    resolve(root, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );

const schema = readJson("scripts/w11-staging-evidence-schema.json");
const contract = readJson("scripts/w11-cutover-test-contract.json");
const cutoverManifest = readJson(contract.cutoverManifestPath);
const testRunId = valueArg("--test-run-id");
const runnerPath = valueArg("--runner-evidence");
const collectedPath = valueArg("--collected-evidence");
const cleanupPath = valueArg("--cleanup-evidence");
const browserRoot = valueArg("--browser-evidence-root");
const deploymentUrl = valueArg("--deployment-url");
const immutableDeploymentUrl =
  valueArg("--immutable-deployment-url") || deploymentUrl;
const deploymentId = valueArg("--deployment-id");
const vercelProjectId = valueArg("--vercel-project-id");
const vercelOrgId = valueArg("--vercel-org-id");
const aliasTargetDeploymentId = valueArg("--alias-target-deployment-id");
const inspectedAt = valueArg("--inspected-at");
const branch = valueArg("--branch");
const commitSha = valueArg("--source-commit-sha") || valueArg("--commit-sha");
const sourceCommitSha = commitSha;

assert.match(testRunId, new RegExp(schema.testRunIdPattern, "u"));
assert.notEqual(
  deploymentUrl,
  STABLE_ALIAS,
  "A mutable Dedicated Staging alias cannot be the deployment evidence URL.",
);
assert.equal(deploymentUrl, immutableDeploymentUrl);
assertW11DeploymentProvenance(
  {
    projectId: STAGING_PROJECT_ID,
    stableAlias: STABLE_ALIAS,
    observedAliasOrigin: STABLE_ALIAS,
    deploymentUrl,
    immutableDeploymentUrl,
    deploymentId,
    vercelProjectId,
    vercelOrgId,
    aliasTargetDeploymentId,
    inspectedAt,
    commitSha,
    sourceCommitSha,
  },
  "generator deployment arguments",
);
assert.ok(branch.startsWith("codex/"), "A codex/ branch is required.");
assert.match(commitSha, /^[a-f0-9]{40}$/u);
for (const [label, path] of Object.entries({
  runnerPath,
  collectedPath,
  cleanupPath,
  browserRoot,
})) {
  assert.ok(path, `${label} is required.`);
  assert.equal(existsSync(resolve(path)), true, `${label} does not exist.`);
}

const outputRoot = resolve("docs/evidence/w11-cutover", testRunId);
assert.equal(
  existsSync(outputRoot),
  false,
  "The exact testRunId evidence directory already exists; never overwrite evidence.",
);
assert.notEqual(
  resolve(browserRoot),
  outputRoot,
  "Browser evidence must be collected outside the generated evidence directory.",
);

const runner = readJson(runnerPath);
const collected = readJson(collectedPath);
const cleanup = readJson(cleanupPath);
for (const document of [runner, collected, cleanup]) {
  assert.equal(document.fixtureOwner, FIXTURE_OWNER);
  assert.equal(document.testRunId, testRunId);
  assert.equal(document.projectId, STAGING_PROJECT_ID);
  assert.equal(document.productionAccess, 0);
  assert.equal(document.productionWrites, 0);
}
assert.equal(runner.suite, "w11-staging-runner");
assert.equal(
  runner.passed,
  true,
  "A failed rehearsal cannot generate PASS evidence.",
);
assert.equal(runner.rehearsalCount, 2);
assert.equal(runner.replayBusinessEffectCount, 0);
assert.equal(runner.responseLossRecovered, true);
assert.equal(runner.directCanonicalWrites, 0);
assert.equal(runner.directReceiptWrites, 0);
assert.equal(runner.activationMutationCount, 0);
assert.equal(runner.tokenValuesWritten, 0);
assert.equal(collected.runnerPassed, true);
assert.equal(collected.planId, runner.planId);
assert.equal(collected.attemptId, runner.attemptId);
assert.equal(cleanup.suite, "w11-staging-fixture-cleanup");
assert.equal(cleanup.passed, true);
assert.equal(cleanup.canonicalBaselineUnchanged, true);
assert.equal(cleanup.canonicalBaselineHash, collected.canonicalBaselineHash);
for (const field of schema.cleanupRequiredZeroFields) {
  assert.equal(cleanup[field], 0, `${field} must remain zero.`);
}

const deploymentProvenance = {
  projectId: STAGING_PROJECT_ID,
  stableAlias: STABLE_ALIAS,
  observedAliasOrigin: STABLE_ALIAS,
  deploymentUrl,
  immutableDeploymentUrl,
  deploymentId,
  vercelProjectId,
  vercelOrgId,
  aliasTargetDeploymentId,
  inspectedAt,
  commitSha,
  sourceCommitSha,
};

const browser = Object.fromEntries(
  BROWSER_FILES.map((file) => {
    const path = resolve(browserRoot, file);
    assert.equal(
      existsSync(path),
      true,
      `Missing actual browser result: ${file}`,
    );
    const document = readJson(path);
    assert.equal(document.schemaVersion, 1, `${file} schemaVersion drift.`);
    assert.equal(document.testRunId, testRunId, `${file} testRunId drift.`);
    assert.equal(
      document.projectId,
      STAGING_PROJECT_ID,
      `${file} project drift.`,
    );
    assert.equal(
      document.deploymentUrl,
      deploymentUrl,
      `${file} was not captured from the fixed Dedicated Staging deployment.`,
    );
    assert.equal(
      document.commitSha,
      commitSha,
      `${file} commit provenance drift.`,
    );
    for (const field of schema.browserProvenanceRequired) {
      assert.equal(
        document[field],
        deploymentProvenance[field],
        `${file} ${field} provenance drift.`,
      );
    }
    assertW11DeploymentProvenance(document, file);
    assert.equal(
      Array.isArray(document.results),
      true,
      `${file} results required.`,
    );
    assert.ok(document.results.length > 0, `${file} cannot be empty.`);
    const requiredByFile = {
      "preview-results.json": schema.previewResultRequired,
      "state-results.json": schema.stateResultRequired,
      "viewport-results.json": schema.viewportResultRequired,
      "accessibility-results.json": schema.accessibilityResultRequired,
      "network-write-results.json": schema.networkWriteResultRequired,
    };
    document.results.forEach((result) => {
      for (const field of requiredByFile[file]) {
        assert.ok(field in result, `${file} missing required field ${field}.`);
      }
      assert.equal(
        result.status,
        "PASS",
        `${file} includes a non-PASS result.`,
      );
    });
    return [file, document];
  }),
);

const screenshotEvidence = verifyW11ScreenshotManifest({
  manifestPath: resolve(browserRoot, "screenshot-manifest.json"),
  screenshotsRoot: browserRoot,
  expected: { testRunId, ...deploymentProvenance },
  completedAt: cleanup.completedAt,
});

for (const row of browser["preview-results.json"].results) {
  assert.equal(row.writeCount, 0);
  assert.equal(row.activationControlCount, 0);
  assert.equal(row.maintenanceControlCount, 0);
}
assert.deepEqual(
  [
    ...new Set(browser["state-results.json"].results.map((row) => row.state)),
  ].sort(),
  [...schema.requiredBrowserStates].sort(),
  "Actual Browser evidence must cover the source states rendered by the W11 cutover center.",
);
for (const row of browser["state-results.json"].results) {
  assert.equal(row.route, schema.requiredScreenshotRoute);
  assert.equal(row.status, "PASS");
}
const viewportRows = browser["viewport-results.json"].results;
assert.deepEqual(
  [...new Set(viewportRows.map((row) => `${row.width}x${row.height}`))].sort(),
  schema.requiredViewports
    .map((viewport) => `${viewport.width}x${viewport.height}`)
    .sort(),
  "Actual Browser evidence must cover exactly the five required viewports.",
);
for (const row of viewportRows) {
  assert.equal(row.route, schema.requiredScreenshotRoute);
  assert.equal(row.dpr, schema.requiredDpr);
  assert.equal(row.fullPage, schema.requiredFullPage);
  assert.equal(row.horizontalOverflowPx, 0);
  assert.equal(row.navigationOverlapCount, 0);
  assert.equal(row.dialogViewportEscapeCount, 0);
  assert.equal(row.activationControlCount, 0);
  assert.equal(row.maintenanceControlCount, 0);
}
for (const row of browser["accessibility-results.json"].results) {
  assert.equal(row.axeCritical, 0);
  assert.equal(row.axeSerious, 0);
  assert.equal(row.keyboardPass, true);
  assert.equal(row.focusVisible, true);
}
for (const row of browser["network-write-results.json"].results) {
  assert.equal(row.mountWriteCount, 0);
  assert.equal(row.queryWriteCount, 0);
  assert.equal(row.previewWriteCount, 0);
  assert.equal(row.productionRequestCount, 0);
}

const forbiddenKeys = new Set(
  schema.forbiddenEvidenceKeys.map((key) =>
    key.toLowerCase().replace(/[^a-z0-9]/gu, ""),
  ),
);
const safeAttestationValues = new Map([
  ["tokenvalueswritten", 0],
  ["residualtokens", 0],
  ["credentialvaluecount", 0],
  ["tokenvaluecount", 0],
  ["residualtokenvaluerecords", 0],
  [
    "residualtokensbasis",
    "PERSISTED_TOKEN_VALUES_ONLY; RUNNER_TOKEN_VALUES_ARE_DISCARDED_IN_MEMORY",
  ],
  ["validtokenrevocationmeasured", false],
  [
    "validtokenrevocationstatus",
    "NOT_MEASURED; ADMIN_ID_AND_APP_CHECK_TOKENS_ARE_EPHEMERAL_AND_NOT_RETAINED",
  ],
]);
const assertNoSecrets = (node, path = "evidence") => {
  if (Array.isArray(node)) {
    node.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
    const sensitiveFragment = [
      "token",
      "password",
      "credential",
      "authorization",
      "cookie",
      "apikey",
      "secret",
      "bypass",
      "debug",
    ].some((fragment) => normalizedKey.includes(fragment));
    assert.equal(
      forbiddenKeys.has(normalizedKey) ||
        (sensitiveFragment && !safeAttestationValues.has(normalizedKey)),
      false,
      `Forbidden key: ${path}.${key}`,
    );
    if (safeAttestationValues.has(normalizedKey)) {
      assert.deepEqual(
        value,
        safeAttestationValues.get(normalizedKey),
        `${path}.${key} is not an approved exact-value safety attestation.`,
      );
    }
    if (typeof value === "string") {
      assert.doesNotMatch(
        value,
        /\bBearer\s+\S+/iu,
        `Bearer value at ${path}.${key}.`,
      );
      assert.doesNotMatch(
        value,
        /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
        `JWT-like value at ${path}.${key}.`,
      );
      assert.doesNotMatch(
        value,
        /\bAIza[0-9A-Za-z_-]{20,}\b/u,
        `API key at ${path}.${key}.`,
      );
    }
    assertNoSecrets(value, `${path}.${key}`);
  }
};
assertNoSecrets({
  runner,
  collected,
  cleanup,
  browser,
  screenshotManifest: screenshotEvidence.manifest,
});

const commands = new Map(
  collected.commandResults.map((command) => [command.label, command]),
);
const phaseSpecs = [
  ["PLAN", "parent-plan"],
  ["DRY_RUN", "parent-dry"],
  ["APPLY", "parent-apply-complete"],
  ["VERIFY", "parent-verify"],
  ["RESUME", "parent-resume"],
  ["ROLLBACK_PLAN", "parent-rollback"],
];
const assertExecutedThenReplayed = (command, label) => {
  assert.equal(
    command.replayObservations[0],
    false,
    `${label} initial execution missing.`,
  );
  assert.equal(
    command.replayObservations.filter((observation) => observation === false)
      .length,
    1,
    `${label} must have exactly one business execution.`,
  );
  assert.equal(
    command.replayObservations.slice(1).length > 0 &&
      command.replayObservations.slice(1).every(Boolean),
    true,
    `${label} must recover only by receipt replay after the initial execution.`,
  );
};
const appliedMutationPaths = [
  "child-class",
  "child-roster",
  "child-learning",
  "child-schedule",
].flatMap((label) => {
  const command = commands.get(label);
  assert.ok(command, `Missing child receipt evidence for ${label}.`);
  assert.equal(command.receiptStatus, "SUCCEEDED");
  assertExecutedThenReplayed(command, label);
  return command.targetRefs;
});
const appliedMutationCount = new Set(appliedMutationPaths).size;
assert.ok(
  appliedMutationCount > 0,
  "Exact canonical child target refs are required.",
);
const phaseResults = [];
for (const rehearsalNumber of [1, 2]) {
  for (const [phase, label] of phaseSpecs) {
    const command = commands.get(label);
    assert.ok(command, `Missing exact receipt evidence for ${label}.`);
    assert.match(command.payloadHash, /^[a-f0-9]{64}$/u);
    assert.equal(command.receiptStatus, "SUCCEEDED");
    assertExecutedThenReplayed(command, label);
    phaseResults.push({
      caseId: `W11-${String(rehearsalNumber).padStart(2, "0")}-${phase}`,
      rehearsalNumber,
      phase,
      status: "PASS",
      commandType: command.commandType,
      commandId: command.commandId,
      payloadHash: command.payloadHash,
      receiptStatus: command.receiptStatus,
      canonicalMutationCount:
        phase === "APPLY" && rehearsalNumber === 1 ? appliedMutationCount : 0,
      crossSemesterMutationCount: 0,
    });
  }
}

assert.equal(runner.partialFailureCount, 1);
assert.equal(runner.resumeAttemptedItemCount, 1);
assert.equal(runner.resumeSucceededItemEffectCount, 0);
const attemptResults = [1, 2].map((rehearsalNumber) => ({
  attemptId: runner.attemptId,
  planId: runner.planId,
  rehearsalNumber,
  result: rehearsalNumber === 1 ? "EXECUTED" : "REPLAYED",
  partialFailureCount: runner.partialFailureCount,
  responseLossRecovered: runner.responseLossRecovered,
  resumeAttemptedItemCount: runner.resumeAttemptedItemCount,
  resumeSucceededItemEffectCount: runner.resumeSucceededItemEffectCount,
  status: "PASS",
}));

assert.equal(Array.isArray(runner.datasets), true);
assert.equal(runner.datasets.length, 12);
assert.deepEqual(
  [...new Set(runner.datasets.map((row) => row.operation))].sort(),
  cutoverManifest.selectiveClone.map((row) => row.operationType).sort(),
  "Dataset evidence must cover the exact W11 operation registry.",
);
const datasetResults = runner.datasets.map((row) => {
  assert.match(row.sourceHash, /^[a-f0-9]{64}$/u);
  assert.match(row.targetHash, /^[a-f0-9]{64}$/u);
  assert.equal(row.status, "PASS");
  assert.equal(
    row.metricBasis,
    "INFERRED_FROM_EXACT_SNAPSHOT_VERIFY_AND_REQUIRED_READINESS_PASS",
  );
  for (const field of [
    "orphanCount",
    "duplicateCount",
    "archiveMutationCount",
    "activityCloneCount",
    "crossSemesterLeakageCount",
  ]) {
    assert.equal(
      row[field],
      0,
      `${row.operation}.${field} must be measured zero.`,
    );
  }
  return row;
});

assert.equal(runner.readiness.checkId, contract.readinessCheckId);
assert.equal(runner.readiness.fresh, true);
assert.equal(runner.readiness.status, "PASS");
assert.match(runner.readiness.dependencyHash, /^[a-f0-9]{64}$/u);
const readinessResults = [
  {
    checkId: runner.readiness.checkId,
    attemptId: runner.attemptId,
    manifestRevision: runner.readiness.manifestRevision,
    dependencyHash: runner.readiness.dependencyHash,
    fresh: runner.readiness.fresh,
    status: runner.readiness.status,
  },
];

const metadata = {
  schemaVersion: 1,
  fixtureOwner: FIXTURE_OWNER,
  testRunId,
  projectId: STAGING_PROJECT_ID,
  stableAlias: STABLE_ALIAS,
  observedAliasOrigin: STABLE_ALIAS,
  deploymentUrl,
  immutableDeploymentUrl,
  deploymentId,
  vercelProjectId,
  vercelOrgId,
  aliasTargetDeploymentId,
  inspectedAt,
  branch,
  commitSha,
  sourceCommitSha,
  sourceSemesterId: runner.sourceSemesterId,
  targetSemesterId: runner.targetSemesterId,
  canonicalBaselineSemesterId: collected.canonicalBaselineSemesterId,
  canonicalBaselineSnapshotHashBefore: collected.canonicalBaselineHash,
  canonicalBaselineSnapshotHashAfter: cleanup.canonicalBaselineHash,
  canonicalBaselineMutationCount: 0,
  baselineRestoreVerified: cleanup.canonicalBaselineUnchanged,
  startedAt: collected.fixtureStartedAt,
  completedAt: cleanup.completedAt,
  productionAccess: 0,
  productionWriteCount: 0,
  maintenanceMutationCount: 0,
  activationControlCount: 0,
  maintenanceControlCount: 0,
  credentialValueCount: 0,
  tokenValueCount: 0,
};
assert.equal(Number.isNaN(Date.parse(metadata.startedAt)), false);
assert.equal(Number.isNaN(Date.parse(metadata.completedAt)), false);
assert.ok(Date.parse(metadata.completedAt) >= Date.parse(metadata.startedAt));
assert.ok(Date.parse(metadata.inspectedAt) <= Date.parse(metadata.completedAt));

const cleanupResults = {
  schemaVersion: 1,
  testRunId,
  status: "PASS",
  ...Object.fromEntries(
    schema.cleanupRequiredZeroFields.map((field) => [field, cleanup[field]]),
  ),
};

mkdirSync(outputRoot, { recursive: false });
writeJson(outputRoot, "metadata.json", metadata);
writeJson(outputRoot, "phase-results.json", phaseResults);
writeJson(outputRoot, "attempt-results.json", attemptResults);
writeJson(outputRoot, "dataset-results.json", datasetResults);
writeJson(outputRoot, "readiness-results.json", readinessResults);
for (const file of BROWSER_FILES) writeJson(outputRoot, file, browser[file]);
writeJson(outputRoot, "screenshot-manifest.json", screenshotEvidence.manifest);
for (const file of screenshotEvidence.screenshotFiles) {
  copyFileSync(resolve(browserRoot, file), resolve(outputRoot, file));
}
writeJson(outputRoot, "cleanup-results.json", cleanupResults);

console.log(
  JSON.stringify({
    suite: "w11-staging-evidence-generator",
    passed: true,
    testRunId,
    outputRoot,
    generatedFiles: schema.requiredFiles.length,
    browserFilesAccepted: BROWSER_FILES.length,
    screenshotFilesAccepted: screenshotEvidence.screenshotFiles.length,
    rehearsalRuns: 2,
    productionAccess: 0,
    productionWrites: 0,
  }),
);
