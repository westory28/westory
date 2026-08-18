import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10p-visual-parity-contract.json");
assert.equal(contract.schemaVersion, 2);
assert.equal(contract.fixtureRevision, 1);
assert.match(contract.fixturePlanHash, /^[a-f0-9]{64}$/u);
const inventory = readJson("scripts/w10p-route-menu-inventory.json");
const packageJson = readJson("package.json");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const args = process.argv.slice(2);
const verifyLive = args.includes("--verify-live");
assert.equal(
  verifyLive,
  true,
  "--verify-live is mandatory for a passing W10P visual evidence gate.",
);
const manifestArg =
  args
    .find((item) => item.startsWith("--manifest="))
    ?.slice("--manifest=".length) || process.env.W10P_VISUAL_MANIFEST;
assert.ok(
  manifestArg,
  "--manifest=<path> or W10P_VISUAL_MANIFEST is required.",
);

const manifestPath = resolve(manifestArg);
const evidenceRoot = dirname(manifestPath);
assert.equal(existsSync(manifestPath), true, "Visual manifest is missing.");
assert.equal(statSync(evidenceRoot).isDirectory(), true);
const manifest = readJson(manifestPath);

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const runJson = (command, commandArgs) => JSON.parse(run(command, commandArgs));
const git = (...gitArgs) => run("git", gitArgs);
const normalizeWebUrl = (value) =>
  new URL(value.startsWith("http") ? value : `https://${value}`)
    .toString()
    .replace(/\/$/u, "");
const normalizedRouteFromUrl = (value) => {
  const parsed = new URL(value);
  assert.ok(parsed.hash.startsWith("#/"), `${value} has no HashRouter route.`);
  return decodeURIComponent(parsed.hash.slice(1));
};

const isoTime = (value, label) => {
  const parsed = Date.parse(value);
  assert.equal(Number.isNaN(parsed), false, `${label} must be an ISO time.`);
  return parsed;
};

const viewportKey = ({ width, height }) => `${width}x${height}`;
const captureKey = (stage, screenId, viewport) =>
  `${stage}:${screenId}:${viewportKey(viewport)}`;
const comparisonKey = (screenId, viewport) =>
  `${screenId}:${viewportKey(viewport)}`;
const normalizeNumber = (value) => Number(Number(value).toFixed(8));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const cssNumber = (value) => {
  const parsed = Number.parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};
const cssColorAlpha = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "transparent") return 0;
  const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u);
  if (rgba) return Number.parseFloat(rgba[1]);
  const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
  if (!modern) return 1;
  const parsed = Number.parseFloat(modern[1]);
  return modern[2] ? parsed / 100 : parsed;
};
const visualTokenCategories = (computed = {}) => {
  const categories = new Set();
  if (cssColorAlpha(computed.backgroundColor) >= 0.5) {
    categories.add("background");
  }
  if (
    ["Top", "Right", "Bottom", "Left"].some(
      (side) =>
        cssNumber(computed[`border${side}Width`]) >= 1 &&
        cssColorAlpha(computed[`border${side}Color`]) >= 0.25,
    )
  ) {
    categories.add("border");
  }
  if (cssNumber(computed.borderRadius) >= 4) {
    categories.add("radius");
  }
  if (
    ["Top", "Right", "Bottom", "Left"].some(
      (side) => cssNumber(computed[`padding${side}`]) >= 4,
    )
  ) {
    categories.add("padding");
  }
  if (cssNumber(computed.rowGap) >= 4 || cssNumber(computed.columnGap) >= 4) {
    categories.add("gap");
  }
  return categories;
};
const visualTokenValues = (computed = {}) => ({
  background:
    cssColorAlpha(computed.backgroundColor) >= 0.5
      ? [computed.backgroundColor]
      : [],
  border: ["Top", "Right", "Bottom", "Left"]
    .filter(
      (side) =>
        cssNumber(computed[`border${side}Width`]) >= 1 &&
        cssColorAlpha(computed[`border${side}Color`]) >= 0.25,
    )
    .flatMap((side) => [
      `width:${computed[`border${side}Width`]}`,
      `color:${computed[`border${side}Color`]}`,
    ]),
  radius: cssNumber(computed.borderRadius) >= 4 ? [computed.borderRadius] : [],
  padding: ["Top", "Right", "Bottom", "Left"]
    .map((side) => computed[`padding${side}`])
    .filter((value) => cssNumber(value) >= 4),
  gap: [computed.rowGap, computed.columnGap].filter(
    (value) => cssNumber(value) >= 4,
  ),
  "background-image": [computed.backgroundImage || "none"],
});

const screenIdForRoute = (route) => {
  if (route === "/") return "login";
  if (route === "*") return "not-found";
  return route
    .split("?")[0]
    .replace(/^\//u, "")
    .replace(/:([a-z])([A-Z])/gu, "$1-$2")
    .replace(/:/gu, "")
    .replace(/\*/gu, "wildcard")
    .replace(/\//gu, "-")
    .toLowerCase();
};

const productionPatterns = new Set(contract.productionRoutePatterns);
const screens = inventory.routes
  .filter((route) => route.role !== "alias")
  .map((route) => ({
    id: screenIdForRoute(route.path),
    role: route.role,
    route: route.path,
    captureRoute: contract.captureOverrides[route.path] ?? route.path,
    productionPresentation: productionPatterns.has(route.path),
  }))
  .concat(
    contract.queryVariants.map((variant) => ({
      ...variant,
      captureRoute: variant.route,
    })),
  );

assert.equal(new Set(screens.map((screen) => screen.id)).size, screens.length);
assert.deepEqual(
  inventory.canonicalCounts,
  { student: 22, teacher: 15, admin: 2, support: 5 },
  "W10P canonical route inventory drifted.",
);
assert.equal(screens.length, 69, "W10P visual screen inventory drifted.");

const screensById = new Map(screens.map((screen) => [screen.id, screen]));
for (const keyScreenId of contract.keyScreenIds) {
  assert.equal(
    screensById.has(keyScreenId),
    true,
    `Unknown key screen: ${keyScreenId}`,
  );
}
for (const screen of screens.filter(
  (candidate) => !candidate.productionPresentation,
)) {
  const referenceId = contract.newSurfaceReferences[screen.id];
  assert.ok(referenceId, `New surface needs a reference: ${screen.id}`);
  assert.equal(
    screensById.get(referenceId)?.productionPresentation,
    true,
    `New surface reference must be an exact Production screen: ${screen.id}`,
  );
}
const newSurfaceIds = screens
  .filter((screen) => !screen.productionPresentation)
  .map((screen) => screen.id)
  .sort();
assert.deepEqual(
  Object.keys(contract.newSurfaceReferences).sort(),
  newSurfaceIds,
  "New-surface reference inventory drifted.",
);
assert.deepEqual(
  Object.keys(contract.newSurfaceRequiredAnchors).sort(),
  newSurfaceIds,
  "New-surface anchor inventory drifted.",
);
assert.deepEqual(
  Object.keys(contract.newSurfaceRequiredPrimitives ?? {}).sort(),
  newSurfaceIds,
  "New-surface primitive inventory drifted.",
);
assert.deepEqual(
  Object.keys(contract.newSurfacePrimitiveProfiles ?? {}).sort(),
  newSurfaceIds,
  "New-surface primitive profile inventory drifted.",
);
assert.deepEqual(
  Object.keys(contract.newSurfacePrimitiveGrammar ?? {}).sort(),
  newSurfaceIds,
  "New-surface candidate visual grammar inventory drifted.",
);
assert.deepEqual(
  Object.keys(contract.primitiveComparisonProfiles ?? {}).sort(),
  ["aligned-surface", "control", "exact", "structure"],
  "Primitive comparison profiles drifted.",
);
let primitiveContractCount = 0;
for (const screenId of newSurfaceIds) {
  const requirements = contract.newSurfaceRequiredPrimitives[screenId];
  assert.ok(
    Array.isArray(requirements) && requirements.length >= 2,
    `${screenId} needs at least two screen-specific structural primitives.`,
  );
  const ids = new Set();
  const candidateSelectors = new Set();
  const referenceSelectors = new Set();
  const profiles = contract.newSurfacePrimitiveProfiles[screenId];
  const grammar = contract.newSurfacePrimitiveGrammar[screenId];
  assert.deepEqual(
    Object.keys(profiles).sort(),
    requirements.map((requirement) => requirement.id).sort(),
    `${screenId} primitive profiles are incomplete.`,
  );
  assert.deepEqual(
    Object.keys(grammar).sort(),
    requirements.map((requirement) => requirement.id).sort(),
    `${screenId} candidate visual grammar is incomplete.`,
  );
  for (const requirement of requirements) {
    assert.match(requirement.id ?? "", /^[a-z][a-z0-9-]*$/u);
    assert.equal(
      ids.has(requirement.id),
      false,
      `${screenId} repeats ${requirement.id}.`,
    );
    ids.add(requirement.id);
    for (const field of [
      "selector",
      "tagPattern",
      "referenceSelector",
      "referenceTagPattern",
    ]) {
      assert.ok(
        String(requirement[field] ?? "").trim().length > 0,
        `${screenId}.${requirement.id}.${field} is required.`,
      );
    }
    assert.equal(requirement.exactCount, 1);
    assert.equal(requirement.referenceExactCount, 1);
    assert.equal(
      candidateSelectors.has(requirement.selector),
      false,
      `${screenId} reuses one candidate primitive selector.`,
    );
    candidateSelectors.add(requirement.selector);
    assert.equal(
      referenceSelectors.has(requirement.referenceSelector),
      false,
      `${screenId} reuses one Production primitive selector.`,
    );
    referenceSelectors.add(requirement.referenceSelector);
    new RegExp(requirement.tagPattern, "u");
    new RegExp(requirement.referenceTagPattern, "u");
    const profileName = profiles[requirement.id];
    assert.ok(
      ["structure", "control", "aligned-surface", "exact"].includes(
        profileName,
      ),
    );
    const profile = contract.primitiveComparisonProfiles[profileName];
    const requiredVisualTokens = grammar[requirement.id];
    assert.ok(
      Array.isArray(requiredVisualTokens) && requiredVisualTokens.length > 0,
      `${screenId}.${requirement.id} needs explicit candidate visual tokens.`,
    );
    assert.equal(
      new Set(requiredVisualTokens).size,
      requiredVisualTokens.length,
      `${screenId}.${requirement.id} repeats a candidate visual token.`,
    );
    for (const token of requiredVisualTokens) {
      assert.ok(
        ["background", "border", "radius", "padding", "gap"].includes(token),
        `${screenId}.${requirement.id} has an unsupported visual token: ${token}.`,
      );
    }
    assert.equal(
      profile.minimumCandidateVisualTokenCategories === undefined ||
        (Number.isSafeInteger(profile.minimumCandidateVisualTokenCategories) &&
          profile.minimumCandidateVisualTokenCategories >= 0 &&
          profile.minimumCandidateVisualTokenCategories <= 6),
      true,
    );
    assert.equal(requirement.compareComputedStyleProperties, undefined);
    assert.equal(requirement.compareBoxProperties, undefined);
    const comparedStyles = profile.compareComputedStyleProperties;
    assert.ok(comparedStyles.length > 0);
    assert.equal(new Set(comparedStyles).size, comparedStyles.length);
    for (const property of comparedStyles) {
      assert.ok(
        contract.layoutDiff.computedStyleProperties.includes(property),
        `${screenId}.${requirement.id} compares an unsupported style.`,
      );
    }
    const comparedBoxProperties = profile.compareBoxProperties ?? [];
    assert.equal(
      new Set(comparedBoxProperties).size,
      comparedBoxProperties.length,
    );
    for (const property of comparedBoxProperties) {
      assert.ok(
        ["x", "y", "width", "height"].includes(property),
        `${screenId}.${requirement.id} compares an unsupported box field.`,
      );
    }
    for (const field of [
      "minimumWidthPx",
      "minimumWidthViewportRatio",
      "minimumHeightPx",
      "minimumAreaViewportRatio",
    ]) {
      if (profile[field] === undefined) continue;
      assert.equal(Number.isFinite(profile[field]), true);
      assert.ok(profile[field] > 0);
    }
    primitiveContractCount += 1;
  }
}
assert.deepEqual(
  contract.networkBoundary,
  {
    forbiddenFirebaseProjectIds: ["history-quiz-yongsin"],
    forbiddenWebHosts: ["westory.kr", "www.westory.kr"],
    requiredMeasuredFirebaseProjectIds: [contract.firebaseProjectId],
  },
  "The staging browser network boundary drifted.",
);
assert.deepEqual(
  Object.keys(contract.screenReadyStates ?? {}).sort(),
  screens.map((screen) => screen.id).sort(),
  "Every W10P screen needs a screen-specific ready-state contract.",
);
assert.deepEqual(
  contract.captureAuthenticationRoles,
  {
    "developer-log": "teacher",
    "developer-log-postid": "teacher",
  },
  "Authenticated support-screen capture roles drifted.",
);
assert.deepEqual(
  contract.captureIdentities,
  {
    adminEmailSha256:
      "e0704874f65563b0d7f1b75520d0f28c01bde74606e9a9aedcdb6c80e49493fe",
    roles: {
      student: {
        uid: "w10p-visual-student",
        profileRole: "student",
        teacherPortalEnabled: false,
        requiredStaffPermissions: [],
      },
      teacher: {
        uid: "w10p-visual-teacher",
        profileRole: "teacher",
        teacherPortalEnabled: true,
        requiredStaffPermissions: [
          "lesson_read",
          "point_manage",
          "quiz_read",
          "student_list_read",
        ],
      },
      admin: {
        uid: "w10p-visual-admin",
        profileRole: "teacher",
        teacherPortalEnabled: true,
        requiredStaffPermissions: [],
      },
    },
  },
  "The three synthetic capture identities drifted.",
);
assert.deepEqual(
  contract.readiness,
  {
    timeoutMs: 60000,
    settleIntervalMs: 250,
    requiredStableSamples: 3,
    maxSettleSamples: 20,
    blockingVisibleTextPattern:
      "(?:불러오는 중|준비하는 중|^준비 중\\.\\.\\.$|로딩 중|잠시만 기다려|불러오지 못했습니다|접근 권한이 없습니다|권한이 부족합니다|문제가 발생했습니다)",
  },
  "The screen readiness policy drifted.",
);
assert.equal(
  contract.fixedTime,
  "2026-08-17T06:00:00.000Z",
  "The contract-bound visual clock drifted.",
);
for (const [screenId, readiness] of Object.entries(
  contract.screenReadyStates ?? {},
)) {
  assert.ok(Array.isArray(readiness.signals) && readiness.signals.length > 0);
  const signalIds = new Set();
  for (const signal of readiness.signals) {
    assert.match(signal.id ?? "", /^[a-z][a-z0-9-]*$/u);
    assert.equal(
      signalIds.has(signal.id),
      false,
      `${screenId} repeats ${signal.id}.`,
    );
    signalIds.add(signal.id);
    assert.ok(String(signal.selector ?? "").trim().length > 0);
    assert.ok(String(signal.textPattern ?? "").trim().length > 0);
    assert.ok(String(signal.tagPattern ?? "").trim().length > 0);
    assert.equal(
      signal.allowEmptyText === undefined ||
        typeof signal.allowEmptyText === "boolean",
      true,
      `${screenId}.${signal.id}.allowEmptyText must be boolean.`,
    );
    assert.ok(
      signal.paintMode === undefined || signal.paintMode === "canvas",
      `${screenId}.${signal.id}.paintMode is unsupported.`,
    );
    assert.equal(
      signal.minimumContrastRatio === undefined ||
        signal.minimumContrastRatio === 2.5,
      true,
      `${screenId}.${signal.id}.minimumContrastRatio is unsupported.`,
    );
    if (signal.minimumContrastRatio === 2.5) {
      assert.ok(
        [
          "student-calendar",
          "teacher-schedule",
          "admin-teacher-schedule",
          "teacher-schedule-holiday-tools",
        ].includes(screenId),
        `${screenId}.${signal.id} is not a legacy pixel-locked calendar witness.`,
      );
      assert.equal(
        screenId === "teacher-schedule-holiday-tools"
          ? contract.newSurfaceReferences[screenId] === "admin-teacher-schedule"
          : screensById.get(screenId)?.productionPresentation === true,
        true,
      );
      assert.equal(signal.id, "schedule-fixture");
    }
    assert.equal(
      signal.minimumGlyphVisibleRatio === undefined ||
        signal.minimumGlyphVisibleRatio === 0.25,
      true,
      `${screenId}.${signal.id}.minimumGlyphVisibleRatio is unsupported.`,
    );
    if (signal.minimumGlyphVisibleRatio === 0.25) {
      assert.ok(
        [
          "student-calendar",
          "teacher-schedule",
          "admin-teacher-schedule",
          "teacher-schedule-holiday-tools",
        ].includes(screenId),
        `${screenId}.${signal.id} is not a legacy pixel-locked calendar witness.`,
      );
      assert.equal(signal.id, "schedule-fixture");
    }
    if (signal.paintMode === "canvas") {
      assert.equal(signal.allowEmptyText, true);
      assert.match(signal.tagPattern, /CANVAS/u);
    }
    new RegExp(signal.textPattern, "u");
    new RegExp(signal.tagPattern, "u");
  }
}
for (const [screenId, marker] of Object.entries(
  contract.fixtureMarkers ?? {},
)) {
  assert.equal(
    screens.some((screen) => screen.id === screenId),
    true,
    `Unknown fixture-marker screen ${screenId}.`,
  );
  assert.ok(String(marker).trim().length > 0, `${screenId} marker is empty.`);
  assert.equal(
    contract.screenReadyStates[screenId].signals.some((signal) =>
      new RegExp(signal.textPattern, "u").test(marker),
    ),
    true,
    `${screenId} fixture marker is not bound to a ready-state signal.`,
  );
}
assert.deepEqual(
  contract.fixturePrivacy,
  {
    allowedVisibleEmails: [
      "westoria28@gmail.com",
      "w10p-visual-student@yongshin-ms.ms.kr",
      "w10p-visual-teacher@yongshin-ms.ms.kr",
    ],
    personLabelPattern: "W10P (?:학생|교사|관리자)(?: 2)?",
    forbiddenVisibleTextPatterns: {
      phone: "01[016789]-?\\d{3,4}-?\\d{4}",
      "resident-id": "\\d{6}-?[1-4]\\d{6}",
      jwt: "eyJ[a-zA-Z0-9_-]{20,}\\.[a-zA-Z0-9_-]{20,}\\.[a-zA-Z0-9_-]{20,}",
    },
  },
  "The synthetic evidence privacy boundary drifted.",
);
assert.deepEqual(
  Object.keys(contract.fixtureDomAssertions ?? {}).sort(),
  Object.keys(contract.fixtureMarkers ?? {}).sort(),
  "Every marker screen must have an exclusive DOM fixture assertion.",
);
for (const [screenId, fixture] of Object.entries(
  contract.fixtureDomAssertions ?? {},
)) {
  assert.equal(Array.isArray(fixture.allowedPersonLabels), true);
  assert.equal(Array.isArray(fixture.items) && fixture.items.length > 0, true);
  const itemIds = new Set();
  for (const item of fixture.items) {
    assert.match(item.id ?? "", /^[a-z][a-z0-9-]*$/u);
    assert.equal(itemIds.has(item.id), false);
    itemIds.add(item.id);
    assert.ok(String(item.selector ?? "").trim().length > 0);
    assert.ok(String(item.textPattern ?? "").trim().length > 0);
    assert.ok(String(item.tagPattern ?? "").trim().length > 0);
    assert.equal(
      Number.isSafeInteger(item.exactCount) && item.exactCount > 0,
      true,
    );
    assert.equal(
      item.exactOptionCount === undefined ||
        (Number.isSafeInteger(item.exactOptionCount) &&
          item.exactOptionCount > 0),
      true,
    );
    assert.equal(
      item.countMode === undefined || item.countMode === "rendered",
      true,
    );
    assert.equal(
      item.minimumContrastRatio === undefined ||
        item.minimumContrastRatio === 2.5,
      true,
    );
    if (item.minimumContrastRatio === 2.5) {
      assert.ok(
        [
          "student-calendar",
          "teacher-schedule",
          "admin-teacher-schedule",
          "teacher-schedule-holiday-tools",
        ].includes(screenId),
        `${screenId}.${item.id} is not a legacy pixel-locked calendar fixture.`,
      );
      assert.equal(
        screenId === "teacher-schedule-holiday-tools"
          ? contract.newSurfaceReferences[screenId] === "admin-teacher-schedule"
          : screensById.get(screenId)?.productionPresentation === true,
        true,
      );
      assert.equal(item.id, "schedule-events");
    }
    assert.equal(
      item.minimumGlyphVisibleRatio === undefined ||
        item.minimumGlyphVisibleRatio === 0.25,
      true,
    );
    if (item.minimumGlyphVisibleRatio === 0.25) {
      assert.ok(
        [
          "student-calendar",
          "teacher-schedule",
          "admin-teacher-schedule",
          "teacher-schedule-holiday-tools",
        ].includes(screenId),
        `${screenId}.${item.id} is not a legacy pixel-locked calendar fixture.`,
      );
      assert.equal(item.id, "schedule-events");
    }
    new RegExp(item.textPattern, "u");
    new RegExp(item.tagPattern, "u");
  }
  for (const label of fixture.allowedPersonLabels) {
    assert.match(
      label,
      new RegExp(`^(?:${contract.fixturePrivacy.personLabelPattern})$`, "u"),
    );
  }
  assert.ok(contract.fixtureMarkers[screenId]);
}
const allowedFixtureActionTypes = new Set([
  "select-option-text",
  "fill",
  "click",
  "scroll-text-into-view",
]);
for (const [screenId, actions] of Object.entries(
  contract.screenFixtureActions ?? {},
)) {
  assert.equal(
    screens.some((screen) => screen.id === screenId),
    true,
    `Unknown fixture-action screen ${screenId}.`,
  );
  assert.ok(Array.isArray(actions) && actions.length > 0);
  const actionIds = new Set();
  for (const action of actions) {
    assert.match(action.id ?? "", /^[a-z][a-z0-9-]*$/u);
    assert.equal(actionIds.has(action.id), false);
    actionIds.add(action.id);
    assert.equal(allowedFixtureActionTypes.has(action.type), true);
    assert.ok(String(action.selector ?? "").trim().length > 0);
    assert.equal(
      Number.isSafeInteger(action.exactMatchCount) &&
        action.exactMatchCount > 0,
      true,
    );
    for (const widthKey of ["minViewportWidth", "maxViewportWidth"]) {
      assert.equal(
        action[widthKey] === undefined ||
          (Number.isSafeInteger(action[widthKey]) && action[widthKey] > 0),
        true,
      );
    }
    if (
      action.type === "select-option-text" ||
      action.type === "scroll-text-into-view"
    ) {
      assert.ok(String(action.text ?? "").trim().length > 0);
    }
    if (action.type === "fill") {
      assert.ok(String(action.value ?? "").trim().length > 0);
    }
  }
}

const allViewports = new Map(
  contract.viewports.map((viewport) => [viewportKey(viewport), viewport]),
);
assert.deepEqual(
  [...allViewports.keys()],
  ["390x844", "768x1024", "1024x768", "1440x900", "1600x900"],
  "The five required W10P viewports drifted.",
);
const minimumViewportSet = new Set(contract.minimumViewportKeys);
const fullPageViewportSet = new Set(contract.fullPageViewportKeys);
assert.deepEqual(
  [...fullPageViewportSet],
  ["390x844", "1440x900"],
  "The required full-page viewport set drifted.",
);
const keyScreenSet = new Set(contract.keyScreenIds);
const viewportsForScreen = (screenId) =>
  contract.viewports.filter(
    (viewport) =>
      keyScreenSet.has(screenId) ||
      minimumViewportSet.has(viewportKey(viewport)),
  );

const expectedCandidateCaptureKeys = new Set();
const expectedBaselineCaptureKeys = new Set();
const expectedComparisonKeys = new Set();
const expectedPrimitiveRequirementsByCapture = new Map();
for (const screen of screens) {
  for (const viewport of viewportsForScreen(screen.id)) {
    const candidateCaptureId = captureKey("candidate", screen.id, viewport);
    expectedCandidateCaptureKeys.add(candidateCaptureId);
    expectedPrimitiveRequirementsByCapture.set(
      candidateCaptureId,
      screen.productionPresentation
        ? []
        : contract.newSurfaceRequiredPrimitives[screen.id].map(
            (requirement) => ({
              id: requirement.id,
              selector: requirement.selector,
              tagPattern: requirement.tagPattern,
              exactCount: requirement.exactCount,
            }),
          ),
    );
    expectedComparisonKeys.add(comparisonKey(screen.id, viewport));
    const baselineScreenId = screen.productionPresentation
      ? screen.id
      : contract.newSurfaceReferences[screen.id];
    const baselineCaptureId = captureKey(
      "baseline",
      baselineScreenId,
      viewport,
    );
    expectedBaselineCaptureKeys.add(baselineCaptureId);
    const baselineRequirements =
      expectedPrimitiveRequirementsByCapture.get(baselineCaptureId) || [];
    if (!screen.productionPresentation) {
      baselineRequirements.push(
        ...contract.newSurfaceRequiredPrimitives[screen.id].map(
          (requirement) => ({
            id: `${screen.id}:${requirement.id}`,
            selector: requirement.referenceSelector,
            tagPattern: requirement.referenceTagPattern,
            exactCount: requirement.referenceExactCount,
          }),
        ),
      );
    }
    expectedPrimitiveRequirementsByCapture.set(
      baselineCaptureId,
      baselineRequirements,
    );
  }
}
const expectedCaptureKeys = new Set([
  ...expectedCandidateCaptureKeys,
  ...expectedBaselineCaptureKeys,
]);

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const paeth = (left, above, upperLeft) => {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
};

const decodePng = (png, label) => {
  assert.ok(png.length >= 57, `${label} is too small to be a PNG.`);
  assert.equal(
    png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE),
    true,
    `${label} has no PNG signature.`,
  );
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let header = null;
  let sawEnd = false;
  const imageData = [];
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, `${label} has a truncated chunk.`);
    const length = png.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    assert.ok(chunkEnd <= png.length, `${label} has an invalid chunk length.`);
    const typeBytes = png.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    assert.equal(
      png.readUInt32BE(offset + 8 + length),
      crc32(png.subarray(offset + 4, offset + 8 + length)),
      `${label} ${type} CRC is invalid.`,
    );
    if (chunkIndex === 0) {
      assert.equal(type, "IHDR", `${label} has no leading IHDR.`);
      assert.equal(length, 13, `${label} has an invalid IHDR.`);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    }
    if (type === "IDAT") imageData.push(data);
    if (type === "IEND") {
      assert.equal(length, 0, `${label} has an invalid IEND.`);
      assert.equal(chunkEnd, png.length, `${label} has bytes after IEND.`);
      sawEnd = true;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  assert.ok(header, `${label} has no IHDR.`);
  assert.equal(imageData.length > 0, true, `${label} has no IDAT.`);
  assert.equal(sawEnd, true, `${label} has no IEND.`);
  assert.equal(header.bitDepth, 8, `${label} must use 8-bit channels.`);
  assert.ok(
    header.colorType === 6 || header.colorType === 2,
    `${label} must be RGB or RGBA.`,
  );
  assert.deepEqual(
    [header.compression, header.filter, header.interlace],
    [0, 0, 0],
    `${label} uses an unsupported PNG encoding.`,
  );

  const bytesPerPixel = header.colorType === 6 ? 4 : 3;
  const rowBytes = header.width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(imageData));
  assert.equal(
    inflated.length,
    (rowBytes + 1) * header.height,
    `${label} decompressed size drifted.`,
  );
  const decoded = Buffer.alloc(rowBytes * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const sourceOffset = y * (rowBytes + 1);
    const filterType = inflated[sourceOffset];
    assert.ok(filterType <= 4, `${label} has an unknown PNG row filter.`);
    const rowOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = inflated[sourceOffset + 1 + x];
      const left =
        x >= bytesPerPixel ? decoded[rowOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? decoded[rowOffset - rowBytes + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? decoded[rowOffset - rowBytes + x - bytesPerPixel]
          : 0;
      const predictor =
        filterType === 0
          ? 0
          : filterType === 1
            ? left
            : filterType === 2
              ? above
              : filterType === 3
                ? Math.floor((left + above) / 2)
                : paeth(left, above, upperLeft);
      decoded[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let source = 0, target = 0; source < decoded.length; ) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = header.colorType === 6 ? decoded[source + 3] : 255;
    source += bytesPerPixel;
    target += 4;
  }
  return { width: header.width, height: header.height, rgba };
};

const listPngFiles = (root, current = root) =>
  readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) return listPngFiles(root, absolute);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".png")) {
      return [];
    }
    return [relative(root, absolute).replaceAll("\\", "/")];
  });
const listBrowserAuditFiles = (root, current = root) =>
  readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) return listBrowserAuditFiles(root, absolute);
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".jsonl")) {
      return [];
    }
    return [relative(root, absolute).replaceAll("\\", "/")];
  });
const readBrowserAudit = (path) => {
  const textValue = readFileSync(path, "utf8");
  assert.ok(textValue.endsWith("\n"), `${path} must end with a newline.`);
  assert.doesNotMatch(
    textValue,
    /(?:authorization|idToken|refreshToken|password|postData|responseBody)/iu,
    `${path} contains a sensitive transport field.`,
  );
  assert.doesNotMatch(textValue, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u);
  assert.doesNotMatch(
    textValue,
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
    `${path} contains a token-shaped value.`,
  );
  return {
    textValue,
    events: textValue
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  };
};

const splitNonemptyLines = (value) =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replaceAll("\\", "/"));
const repositoryRoot = resolve(git("rev-parse", "--show-toplevel"));
const evidenceRelativePath = relative(repositoryRoot, evidenceRoot).replaceAll(
  "\\",
  "/",
);

assert.equal(manifest.schemaVersion, contract.schemaVersion);
assert.equal(manifest.phase, contract.phase);
assert.match(manifest.testRunId, /^w10p-[a-z0-9][a-z0-9-]{7,63}$/u);
assert.equal(
  evidenceRelativePath,
  `${contract.evidenceRootPrefix}/${manifest.testRunId}`,
  "Evidence must live in its run-specific W10P directory.",
);
assert.equal(manifest.branch, contract.branch);
assert.match(manifest.sourceCommitSha, /^[a-f0-9]{40}$/u);
assert.match(manifest.sourceTreeSha, /^[a-f0-9]{40}$/u);
assert.equal(git("cat-file", "-t", manifest.sourceCommitSha), "commit");
assert.equal(
  git("cat-file", "-t", contract.productionPresentationSha),
  "commit",
);
assert.equal(
  git("rev-parse", `${manifest.sourceCommitSha}^{tree}`),
  manifest.sourceTreeSha,
  "The manifest source tree is not the deployed candidate commit tree.",
);
assert.deepEqual(
  manifest.generator,
  {
    scriptPath: contract.captureRunner.scriptPath,
    scriptGitBlobSha: git(
      "rev-parse",
      `${manifest.sourceCommitSha}:${contract.captureRunner.scriptPath}`,
    ),
    scriptRuntimeSha256: sha256(
      readFileSync(resolve(contract.captureRunner.scriptPath)),
    ),
    entrypointVerified: true,
    trustedInputsSha256: sha256(
      Buffer.from(JSON.stringify(manifest.trustedInputs)),
    ),
    playwrightCoreVersion: contract.captureRunner.playwrightCoreVersion,
    browserExecutable: manifest.generator?.browserExecutable,
  },
  "Visual evidence was not produced by the committed W10P capture runner.",
);
const trustedInputPaths = [
  contract.captureRunner.scriptPath,
  "scripts/w10p-visual-parity-contract.json",
  "scripts/w10p-route-menu-inventory.json",
  "scripts/seed-w10p-visual-fixture.mjs",
  "package.json",
  "package-lock.json",
];
assert.deepEqual(
  Object.keys(manifest.trustedInputs ?? {}).sort(),
  [...trustedInputPaths].sort(),
  "Trusted visual input inventory drifted.",
);
for (const path of trustedInputPaths) {
  assert.deepEqual(
    manifest.trustedInputs[path],
    {
      gitBlobSha: git("rev-parse", `${manifest.sourceCommitSha}:${path}`),
      runtimeSha256: sha256(readFileSync(resolve(path))),
    },
    `Trusted visual input attestation drifted: ${path}.`,
  );
  assert.equal(
    git("hash-object", "--path", path, path),
    manifest.trustedInputs[path].gitBlobSha,
    `Trusted visual input changed after capture: ${path}.`,
  );
}
assert.ok(
  String(manifest.generator.browserExecutable ?? "")
    .toLowerCase()
    .endsWith("msedge.exe"),
);
assert.equal(
  packageJson.devDependencies?.["playwright-core"],
  contract.captureRunner.playwrightCoreVersion,
  "The trusted capture runtime must be exactly pinned.",
);
git("merge-base", "--is-ancestor", manifest.sourceCommitSha, "HEAD");
assert.equal(
  git("rev-parse", "--abbrev-ref", "HEAD"),
  contract.branch,
  "Visual evidence must be verified on the W10P branch.",
);
const allowedPostDeploymentPath = (path) =>
  path === contract.finalReportPath ||
  path.startsWith(`${contract.evidenceRootPrefix}/`);
const postDeploymentPaths = new Set([
  ...splitNonemptyLines(
    git("diff", "--name-only", `${manifest.sourceCommitSha}..HEAD`),
  ),
  ...splitNonemptyLines(git("diff", "--name-only", manifest.sourceCommitSha)),
  ...splitNonemptyLines(git("ls-files", "--others", "--exclude-standard")),
]);
for (const path of postDeploymentPaths) {
  assert.equal(
    allowedPostDeploymentPath(path),
    true,
    `Candidate source changed after deployment outside evidence scope: ${path}`,
  );
}
assert.equal(manifest.functionalBaselineSha, contract.functionalBaselineSha);
assert.equal(
  manifest.productionPresentationSha,
  contract.productionPresentationSha,
);
assert.equal(manifest.firebaseProjectId, contract.firebaseProjectId);
assert.equal(manifest.vercelProjectId, contract.vercelProjectId);
assert.equal(manifest.stableAlias, contract.stableAlias);
assert.equal(manifest.productionAccess, 0);
assert.equal(manifest.productionWrites, 0);
const networkSummary = manifest.networkSummary;
for (const field of [
  "requestCount",
  "responseCount",
  "firebaseRequestCount",
  "stagingFirebaseRequestCount",
  "stagingFirebaseResponseCount",
  "stagingDataRequestCount",
  "stagingDataResponseCount",
  "productionAccess",
  "productionWrites",
  "unboundFirebaseRequestCount",
  "failedFirebaseResponseCount",
]) {
  assert.equal(
    Number.isInteger(networkSummary?.[field]),
    true,
    `manifest.networkSummary.${field} must be an integer.`,
  );
  assert.ok(networkSummary[field] >= 0);
}
assert.equal(networkSummary.productionAccess, manifest.productionAccess);
assert.equal(networkSummary.productionWrites, manifest.productionWrites);
assert.equal(networkSummary.unboundFirebaseRequestCount, 0);
assert.ok(networkSummary.requestCount >= networkSummary.firebaseRequestCount);
assert.ok(networkSummary.requestCount >= networkSummary.responseCount);
assert.ok(
  networkSummary.firebaseRequestCount >=
    networkSummary.stagingFirebaseRequestCount,
);
assert.ok(networkSummary.stagingFirebaseRequestCount > 0);
assert.ok(networkSummary.stagingFirebaseResponseCount > 0);
assert.ok(
  networkSummary.responseCount >= networkSummary.stagingFirebaseResponseCount,
);
for (const field of [
  "stagingFirebaseRequestsByPhase",
  "stagingFirebaseRequestsByStage",
  "stagingScreenRequestsByStage",
]) {
  assert.equal(
    typeof networkSummary[field],
    "object",
    `manifest.networkSummary.${field} is required.`,
  );
  for (const value of Object.values(networkSummary[field])) {
    assert.ok(Number.isInteger(value) && value > 0);
  }
}
assert.equal(
  Object.values(networkSummary.stagingFirebaseRequestsByPhase).reduce(
    (sum, count) => sum + count,
    0,
  ),
  networkSummary.stagingFirebaseRequestCount,
);
assert.equal(
  Object.values(networkSummary.stagingFirebaseRequestsByStage).reduce(
    (sum, count) => sum + count,
    0,
  ),
  networkSummary.stagingFirebaseRequestCount,
);
assert.ok(
  (networkSummary.stagingFirebaseRequestsByPhase.authentication || 0) > 0,
);
for (const stage of ["baseline", "candidate"]) {
  assert.ok((networkSummary.stagingFirebaseRequestsByStage[stage] || 0) > 0);
  assert.ok((networkSummary.stagingScreenRequestsByStage[stage] || 0) > 0);
  assert.ok(
    networkSummary.stagingScreenRequestsByStage[stage] <=
      networkSummary.stagingFirebaseRequestsByStage[stage],
  );
}
assert.deepEqual(
  networkSummary.observedFirebaseProjectIds,
  contract.networkBoundary.requiredMeasuredFirebaseProjectIds,
);
assert.equal(Array.isArray(networkSummary.observedFirebaseHosts), true);
assert.equal(networkSummary.observedFirebaseHosts.length > 0, true);
assert.deepEqual(networkSummary.productionRequestHosts, []);
assert.deepEqual(networkSummary.observedFirebaseApiKeySha256s, [
  manifest.environment.firebaseConfig.apiKeySha256,
]);
assert.equal(networkSummary.failedFirebaseResponseCount, 0);
assert.equal(manifest.status, "CAPTURED");
const startedAt = isoTime(manifest.startedAt, "manifest.startedAt");
const completedAt = isoTime(manifest.completedAt, "manifest.completedAt");
assert.ok(completedAt >= startedAt);

assert.deepEqual(
  manifest.fixtureAudit,
  {
    fileName: "fixture-audit.json",
    sha256: manifest.fixtureAudit?.sha256,
    artifactSchemaVersion: "w10p-visual-fixture-audit-v1",
    fixtureRevision: contract.fixtureRevision,
    planHash: contract.fixturePlanHash,
    captureBindingHash: manifest.fixtureAudit?.captureBindingHash,
    issuedAt: manifest.fixtureAudit?.issuedAt,
    expiresAt: manifest.fixtureAudit?.expiresAt,
  },
  "The fixture audit manifest shape drifted.",
);
assert.match(manifest.fixtureAudit.sha256, /^[a-f0-9]{64}$/u);
assert.match(manifest.fixtureAudit.captureBindingHash, /^[a-f0-9]{64}$/u);
const fixtureAuditPath = resolve(evidenceRoot, manifest.fixtureAudit.fileName);
assert.equal(existsSync(fixtureAuditPath), true, "Fixture audit is missing.");
const fixtureAuditBytes = readFileSync(fixtureAuditPath);
assert.equal(sha256(fixtureAuditBytes), manifest.fixtureAudit.sha256);
const fixtureAuditText = fixtureAuditBytes.toString("utf8");
assert.doesNotMatch(fixtureAuditText, /@/u);
assert.doesNotMatch(
  fixtureAuditText,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
);
const fixtureAudit = JSON.parse(fixtureAuditText);
assert.equal(fixtureAudit.suite, "w10p-visual-fixture-audit");
assert.equal(fixtureAudit.passed, true);
assert.equal(
  fixtureAudit.artifactSchemaVersion,
  manifest.fixtureAudit.artifactSchemaVersion,
);
assert.equal(fixtureAudit.projectId, contract.firebaseProjectId);
assert.equal(fixtureAudit.fixtureId, contract.fixtureId);
assert.equal(fixtureAudit.fixtureNamespace, contract.fixtureId);
assert.equal(fixtureAudit.fixtureRevision, contract.fixtureRevision);
assert.equal(fixtureAudit.planHash, contract.fixturePlanHash);
assert.equal(fixtureAudit.captureBinding?.planHash, contract.fixturePlanHash);
assert.equal(
  fixtureAudit.captureBinding?.fixtureRevision,
  contract.fixtureRevision,
);
assert.equal(fixtureAudit.captureBinding?.fixtureNamespace, contract.fixtureId);
assert.equal(
  fixtureAudit.captureBinding?.projectId,
  contract.firebaseProjectId,
);
assert.equal(
  sha256(Buffer.from(canonicalJson(fixtureAudit.captureBinding))),
  fixtureAudit.captureBindingHash,
);
assert.equal(
  fixtureAudit.captureBindingHash,
  manifest.fixtureAudit.captureBindingHash,
);
for (const field of [
  "productionAccess",
  "rawCredentialOutputCount",
  "rawPiiOutputCount",
  "extraRowCount",
]) {
  assert.equal(fixtureAudit[field], 0, `fixture audit ${field} must be zero.`);
}
assert.equal(fixtureAudit.authRoleCount, 3);
assert.deepEqual(
  fixtureAudit.authRoles.map((row) => row.role),
  ["student", "teacher", "admin"],
);
assert.equal(fixtureAudit.authTenant?.actualUidCount, 3);
assert.equal(fixtureAudit.authTenant?.extraUidCount, 0);
assert.equal(fixtureAudit.authTenant?.missingUidCount, 0);
assert.equal(fixtureAudit.strict?.collectionCount, 63);
assert.equal(fixtureAudit.strict?.expectedRowCount, 51);
assert.equal(fixtureAudit.strict?.actualRowCount, 51);
assert.equal(fixtureAudit.strict?.extraRowCount, 0);
assert.equal(
  fixtureAudit.strict?.collections?.every(
    (row) =>
      row.expectedRowCount === row.actualRowCount &&
      row.expectedIdSetHash === row.actualIdSetHash &&
      row.extraRowCount === 0,
  ),
  true,
);
assert.equal(fixtureAudit.presentation?.unexpectedPersonRowCount, 0);
assert.equal(fixtureAudit.privacy?.forbiddenPatternCount, 0);
assert.equal(fixtureAudit.captureBinding?.extraRowCount, 0);
assert.equal(
  fixtureAudit.captureBinding?.presentationAttestationHash,
  fixtureAudit.presentation?.attestationHash,
);
assert.equal(
  fixtureAudit.captureBinding?.privacyAttestationHash,
  fixtureAudit.privacyAttestationHash,
);
const fixtureIssuedAt = isoTime(
  fixtureAudit.freshness?.issuedAt,
  "fixtureAudit.freshness.issuedAt",
);
const fixtureExpiresAt = isoTime(
  fixtureAudit.freshness?.expiresAt,
  "fixtureAudit.freshness.expiresAt",
);
assert.equal(fixtureAudit.freshness?.maxAgeSeconds, 3600);
assert.equal(fixtureAudit.freshness?.fixedFixtureTime, contract.fixedTime);
assert.equal(manifest.fixtureAudit.issuedAt, fixtureAudit.freshness.issuedAt);
assert.equal(manifest.fixtureAudit.expiresAt, fixtureAudit.freshness.expiresAt);
assert.ok(startedAt >= fixtureIssuedAt);
assert.ok(completedAt <= fixtureExpiresAt);

assert.deepEqual(
  manifest.environment?.viewports,
  contract.viewports,
  "The captured viewport environment drifted.",
);
assert.equal(manifest.environment?.dpr, contract.requiredDpr);
assert.equal(manifest.environment?.fontsReady, true);
assert.equal(manifest.environment?.animationsDisabled, true);
assert.equal(manifest.environment?.browser, contract.captureRunner.browser);
isoTime(manifest.environment?.fixedTime, "manifest.environment.fixedTime");
assert.equal(
  manifest.environment.fixedTime,
  contract.fixedTime,
  "The visual capture clock drifted from the contract.",
);
assert.equal(manifest.environment?.fixtureId, contract.fixtureId);
assert.equal(manifest.environment?.fixtureRevision, contract.fixtureRevision);
assert.equal(manifest.environment?.fixturePlanHash, contract.fixturePlanHash);
assert.equal(
  manifest.environment?.fixtureCaptureBindingHash,
  manifest.fixtureAudit.captureBindingHash,
);
assert.equal(
  manifest.environment?.firebaseConfig?.projectId,
  contract.firebaseProjectId,
);
assert.ok(
  String(manifest.environment?.firebaseConfig?.authDomain ?? "").includes(
    contract.firebaseProjectId,
  ),
);
assert.ok(
  String(manifest.environment?.firebaseConfig?.storageBucket ?? "").includes(
    contract.firebaseProjectId,
  ),
);
assert.match(
  manifest.environment?.firebaseConfig?.apiKeySha256 ?? "",
  /^[a-f0-9]{64}$/u,
);
assert.match(
  manifest.environment?.firebaseConfig?.appIdSha256 ?? "",
  /^[a-f0-9]{64}$/u,
);
for (const field of [
  "browserVersion",
  "operatingSystem",
  "locale",
  "timezone",
  "fixtureId",
  "captureSessionId",
]) {
  assert.ok(
    String(manifest.environment?.[field] ?? "").trim().length > 0,
    `manifest.environment.${field} is required.`,
  );
}
assert.deepEqual(
  Object.keys(manifest.identityAttestations ?? {}).sort(),
  ["admin", "student", "teacher"],
  "All three authenticated capture identities must be attested.",
);
const observedIdentityUidHashes = new Set();
const observedIdentityEmailHashes = new Set();
for (const role of ["student", "teacher", "admin"]) {
  const expected = contract.captureIdentities.roles[role];
  const attestation = manifest.identityAttestations[role];
  assert.deepEqual(Object.keys(attestation).sort(), [
    "adminEmail",
    "emailSha256",
    "profileRole",
    "role",
    "staffPermissions",
    "teacherPortalEnabled",
    "tokenRole",
    "uidSha256",
  ]);
  assert.equal(attestation.role, role);
  assert.equal(attestation.uidSha256, sha256(expected.uid));
  assert.match(attestation.emailSha256, /^[a-f0-9]{64}$/u);
  assert.equal(attestation.profileRole, expected.profileRole);
  assert.equal(attestation.teacherPortalEnabled, expected.teacherPortalEnabled);
  assert.equal(
    attestation.tokenRole === null ||
      attestation.tokenRole === attestation.profileRole,
    true,
  );
  assert.deepEqual(
    attestation.staffPermissions,
    [...new Set(attestation.staffPermissions)].sort(),
  );
  for (const permission of expected.requiredStaffPermissions) {
    assert.equal(attestation.staffPermissions.includes(permission), true);
  }
  assert.equal(attestation.adminEmail, role === "admin");
  if (role === "admin") {
    assert.equal(
      attestation.emailSha256,
      contract.captureIdentities.adminEmailSha256,
    );
  } else {
    assert.notEqual(
      attestation.emailSha256,
      contract.captureIdentities.adminEmailSha256,
    );
  }
  observedIdentityUidHashes.add(attestation.uidSha256);
  observedIdentityEmailHashes.add(attestation.emailSha256);
  const fixtureRole = fixtureAudit.authRoles.find((row) => row.role === role);
  assert.ok(fixtureRole, `Fixture audit is missing ${role}.`);
  assert.equal(attestation.uidSha256, fixtureRole.uidHash);
  assert.equal(attestation.emailSha256, fixtureRole.emailHash);
}
assert.equal(observedIdentityUidHashes.size, 3);
assert.equal(observedIdentityEmailHashes.size, 3);

const deploymentUrlPattern =
  /^https:\/\/westory-staging-[a-z0-9-]+-bbbs-projects-44f9da30\.vercel\.app\/?$/u;
for (const [stage, deployment] of Object.entries({
  baseline: manifest.baselineDeployment,
  candidate: manifest.candidateDeployment,
})) {
  assert.match(deployment?.id ?? "", /^dpl_[A-Za-z0-9]{20,}$/u);
  assert.match(deployment?.url ?? "", deploymentUrlPattern);
  assert.equal(deployment?.projectId, contract.vercelProjectId);
  assert.equal(deployment?.status, "READY");
  assert.match(deployment?.htmlSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.equal(
    deployment?.firebaseBundle?.firebaseProjectId,
    contract.firebaseProjectId,
  );
  assert.equal(Array.isArray(deployment?.firebaseBundle?.assets), true);
  assert.ok(deployment.firebaseBundle.assets.length > 0);
  const assetPaths = new Set();
  for (const asset of deployment.firebaseBundle.assets) {
    assert.match(asset.path ?? "", /^\/[^?#]+\.js(?:\?.*)?$/u);
    assert.equal(assetPaths.has(asset.path), false);
    assetPaths.add(asset.path);
    assert.match(asset.sha256 ?? "", /^[a-f0-9]{64}$/u);
    assert.ok(Number.isInteger(asset.bytes) && asset.bytes > 0);
  }
  assert.ok(
    isoTime(deployment?.inspectedAt, `${stage}.inspectedAt`) <= startedAt,
  );
}
assert.equal(
  manifest.baselineDeployment.sourceCommitSha,
  contract.productionPresentationSha,
);
assert.equal(
  manifest.candidateDeployment.sourceCommitSha,
  manifest.sourceCommitSha,
);
assert.notEqual(
  manifest.baselineDeployment.id,
  manifest.candidateDeployment.id,
);
assert.notEqual(
  manifest.baselineDeployment.url,
  manifest.candidateDeployment.url,
);

let liveDeploymentVerified = false;
if (verifyLive) {
  const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
  const inspectDeployment = (url) =>
    runJson(npxCommand, [
      "--yes",
      "vercel@59.1.3",
      "inspect",
      new URL(url).hostname,
      "--json",
    ]);
  const readDeploymentApi = (deploymentId) =>
    runJson(npxCommand, [
      "--yes",
      "vercel@59.1.3",
      "api",
      `/v13/deployments/${deploymentId}`,
    ]);
  for (const [stage, deployment, lookupUrl] of [
    ["baseline", manifest.baselineDeployment, manifest.baselineDeployment.url],
    ["candidate", manifest.candidateDeployment, contract.stableAlias],
  ]) {
    const inspected = inspectDeployment(lookupUrl);
    const api = readDeploymentApi(deployment.id);
    assert.equal(
      inspected.id,
      deployment.id,
      `${stage} deployment ID drifted.`,
    );
    assert.equal(
      normalizeWebUrl(inspected.url),
      normalizeWebUrl(deployment.url),
      `${stage} immutable URL drifted.`,
    );
    assert.equal(inspected.readyState, "READY");
    assert.equal(inspected.target, "production");
    assert.equal(api.id, deployment.id);
    assert.equal(api.projectId ?? api.project?.id, contract.vercelProjectId);
    assert.equal(api.readyState, "READY");
    assert.equal(api.target, "production");
    assert.equal(
      api.meta?.gitCommitSha,
      deployment.sourceCommitSha,
      `${stage} Vercel source commit drifted.`,
    );
    if (stage === "candidate") {
      assert.equal(api.meta?.gitCommitRef, contract.branch);
    }
  }
  const bypassSecret = String(
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
  ).trim();
  const htmlHeaders = {
    "cache-control": "no-cache",
    ...(bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : {}),
  };
  for (const [stage, url, expectedHtmlSha] of [
    [
      "baseline",
      manifest.baselineDeployment.url,
      manifest.baselineDeployment.htmlSha256,
    ],
    [
      "candidate",
      contract.stableAlias,
      manifest.candidateDeployment.htmlSha256,
    ],
  ]) {
    const response = await fetch(url, {
      redirect: "follow",
      headers: htmlHeaders,
    });
    assert.equal(response.status, 200, `${stage} staging HTML is not 200.`);
    assert.equal(
      new URL(response.url).origin,
      new URL(url).origin,
      `${stage} staging HTML redirected to another origin.`,
    );
    const html = Buffer.from(await response.arrayBuffer());
    assert.equal(
      sha256(html),
      expectedHtmlSha,
      `${stage} live HTML differs from its captured deployment.`,
    );
    const deployment =
      stage === "baseline"
        ? manifest.baselineDeployment
        : manifest.candidateDeployment;
    let combinedBundleSource = "";
    for (const asset of deployment.firebaseBundle.assets) {
      const assetResponse = await fetch(new URL(asset.path, url), {
        redirect: "follow",
        headers: htmlHeaders,
      });
      assert.equal(
        assetResponse.status,
        200,
        `${stage} ${asset.path} is not 200.`,
      );
      const assetBytes = Buffer.from(await assetResponse.arrayBuffer());
      assert.equal(assetBytes.length, asset.bytes);
      assert.equal(sha256(assetBytes), asset.sha256);
      combinedBundleSource += assetBytes.toString("utf8");
    }
    assert.match(
      combinedBundleSource,
      new RegExp(
        contract.firebaseProjectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
        "u",
      ),
      `${stage} bundle is not built for staging Firebase.`,
    );
  }
  liveDeploymentVerified = true;
}

assert.equal(Array.isArray(manifest.captures), true);
assert.equal(manifest.captures.length, expectedCaptureKeys.size);
const captures = new Map();
const representedPngs = new Set();
const decodedPngs = new Map();
const screenshotHashesByStageAndViewport = new Map();
let captureNetworkRequestCount = 0;
for (const capture of manifest.captures) {
  assert.ok(["baseline", "candidate"].includes(capture.stage));
  const screen = screensById.get(capture.screenId);
  assert.ok(screen, `Unknown capture screen: ${capture.screenId}`);
  assert.equal(capture.role, screen.role);
  assert.equal(capture.route, screen.captureRoute);
  assert.equal(capture.dpr, contract.requiredDpr);
  const isFullPage = fullPageViewportSet.has(viewportKey(capture.viewport));
  assert.equal(capture.fullPage, isFullPage);
  assert.equal(capture.status, "CAPTURED");
  assert.equal(capture.documentReadyState, "complete");
  assert.equal(capture.fixtureId, contract.fixtureId);
  assert.equal(capture.fixturePlanHash, contract.fixturePlanHash);
  assert.equal(
    capture.fixtureCaptureBindingHash,
    manifest.fixtureAudit.captureBindingHash,
  );
  assert.equal(capture.fixtureAuditSha256, manifest.fixtureAudit.sha256);
  const expectedFixtureActions =
    contract.screenFixtureActions?.[capture.screenId] ?? [];
  assert.deepEqual(
    capture.fixtureActions?.map((action) => action.id),
    expectedFixtureActions.map((action) => action.id),
    `${capture.id} fixture-action inventory drifted.`,
  );
  for (const [index, expectedAction] of expectedFixtureActions.entries()) {
    const actualAction = capture.fixtureActions[index];
    const skippedByViewport =
      (Number.isFinite(expectedAction.maxViewportWidth) &&
        capture.viewport.width > expectedAction.maxViewportWidth) ||
      (Number.isFinite(expectedAction.minViewportWidth) &&
        capture.viewport.width < expectedAction.minViewportWidth);
    assert.deepEqual(actualAction, {
      id: expectedAction.id,
      type: expectedAction.type,
      applied: !skippedByViewport,
      skippedByViewport,
      matchCount: skippedByViewport ? 0 : expectedAction.exactMatchCount,
    });
  }
  const expectedFixture =
    contract.fixtureDomAssertions?.[capture.screenId] ?? null;
  const expectedFixtureItems = expectedFixture?.items ?? [];
  assert.deepEqual(
    Object.keys(capture.fixtureEvidence?.assertions ?? {}).sort(),
    expectedFixtureItems.map((item) => item.id).sort(),
    `${capture.id} fixture DOM assertion inventory drifted.`,
  );
  for (const requirement of expectedFixtureItems) {
    const assertion = capture.fixtureEvidence.assertions[requirement.id];
    assert.equal(assertion.selector, requirement.selector);
    assert.equal(assertion.matchCount, requirement.exactCount);
    assert.equal(assertion.items.length, requirement.exactCount);
    for (const item of assertion.items) {
      assert.match(item.selector, /\S/u);
      assert.match(item.tagName, new RegExp(requirement.tagPattern, "u"));
      assert.match(item.textSha256, /^[a-f0-9]{64}$/u);
      assert.equal(item.textMatches, true);
      assert.equal(
        item.visibleAreaRatio >=
          (requirement.countMode === "rendered" ? 0 : 0.9) &&
          item.visibleAreaRatio <= 1.000001,
        true,
      );
      assert.equal(
        Number.isFinite(item.effectiveOpacity) &&
          item.effectiveOpacity >= 0.9 &&
          item.effectiveOpacity <= 1.000001,
        true,
      );
      assert.equal(Number.isFinite(item.paintVisibilityRatio), true);
      if (requirement.countMode !== "rendered") {
        assert.ok(item.paintVisibilityRatio >= 0.6);
      }
      const paintWitness = item.paintWitness;
      assert.match(paintWitness?.selector ?? "", /\S/u);
      assert.match(paintWitness?.tagName ?? "", /^(?:[A-Z][A-Z0-9-]*|text)$/u);
      assert.ok(paintWitness.effectiveOpacity >= 0.9);
      assert.ok(paintWitness.visibleAreaRatio >= 0.9);
      assert.ok(paintWitness.paintVisibilityRatio >= 0.6);
      assert.equal(paintWitness.textPainted, true);
      assert.ok(paintWitness.textFontSizePx >= 8);
      assert.ok(paintWitness.textForegroundAlpha >= 0.9);
      assert.ok(
        paintWitness.textGlyphVisibleRatio >=
          (requirement.minimumGlyphVisibleRatio ?? 0.6),
      );
      assert.equal(paintWitness.textPaintEffectsSafe, true);
      if (Number.isFinite(requirement.minimumContrastRatio)) {
        assert.equal(
          paintWitness.textRequiredContrastRatio,
          requirement.minimumContrastRatio,
        );
      } else {
        assert.ok([3, 4.5].includes(paintWitness.textRequiredContrastRatio));
      }
      assert.ok(
        paintWitness.textContrastRatio >=
          paintWitness.textRequiredContrastRatio,
      );
      assert.match(paintWitness.textSha256, /^[a-f0-9]{64}$/u);
      assert.equal(paintWitness.textMatches, true);
      for (const field of ["x", "y", "width", "height"]) {
        assert.equal(Number.isFinite(item.visibleBox?.[field]), true);
      }
      if (requirement.countMode !== "rendered") {
        assert.ok(item.visibleBox.width > 0 && item.visibleBox.height > 0);
      }
      assert.equal(
        item.optionCount,
        requirement.exactOptionCount ?? null,
        `${capture.id}.${requirement.id} option inventory drifted.`,
      );
    }
  }
  const privacy = capture.fixtureEvidence?.privacy;
  assert.match(privacy?.contentTextSha256 ?? "", /^[a-f0-9]{64}$/u);
  assert.deepEqual(privacy.unexpectedEmailSha256s, []);
  assert.deepEqual(privacy.unexpectedPersonLabels, []);
  assert.deepEqual(
    Object.keys(privacy.forbiddenPatternMatchCounts ?? {}).sort(),
    Object.keys(contract.fixturePrivacy.forbiddenVisibleTextPatterns).sort(),
  );
  assert.equal(
    Object.values(privacy.forbiddenPatternMatchCounts).every(
      (count) => count === 0,
    ),
    true,
  );
  const allowedEmailHashes = new Set(
    contract.fixturePrivacy.allowedVisibleEmails.map((email) =>
      sha256(email.toLowerCase()),
    ),
  );
  assert.equal(
    privacy.observedEmailSha256s.every((hash) => allowedEmailHashes.has(hash)),
    true,
  );
  assert.deepEqual(
    privacy.observedEmailSha256s,
    [...new Set(privacy.observedEmailSha256s)].sort(),
  );
  assert.deepEqual(
    privacy.personLabels,
    [...new Set(privacy.personLabels)].sort(),
  );
  for (const label of privacy.personLabels) {
    assert.equal(expectedFixture?.allowedPersonLabels.includes(label), true);
  }
  for (const field of [
    "requestCount",
    "responseCount",
    "firebaseRequestCount",
    "stagingFirebaseRequestCount",
    "stagingFirebaseResponseCount",
    "stagingDataRequestCount",
    "stagingDataResponseCount",
    "productionAccess",
    "productionWrites",
    "unboundFirebaseRequestCount",
    "failedFirebaseResponseCount",
  ]) {
    assert.equal(Number.isInteger(capture.network?.[field]), true);
    assert.ok(capture.network[field] >= 0);
  }
  assert.equal(capture.network.productionAccess, 0);
  assert.equal(capture.network.productionWrites, 0);
  assert.equal(capture.network.unboundFirebaseRequestCount, 0);
  assert.equal(capture.network.failedFirebaseResponseCount, 0);
  if (contract.fixtureMarkers[capture.screenId]) {
    assert.ok(
      capture.network.stagingDataRequestCount > 0,
      `${capture.id} rendered a fixture marker without a staging Firestore, Functions, or Storage request.`,
    );
    assert.ok(
      capture.network.stagingDataResponseCount > 0,
      `${capture.id} rendered a fixture marker without a successful staging data response.`,
    );
  }
  assert.deepEqual(capture.network.productionRequestHosts, []);
  assert.equal(Array.isArray(capture.network.observedFirebaseProjectIds), true);
  assert.equal(Array.isArray(capture.network.observedFirebaseHosts), true);
  assert.equal(
    Array.isArray(capture.network.observedFirebaseApiKeySha256s),
    true,
  );
  for (const apiKeySha256 of capture.network.observedFirebaseApiKeySha256s) {
    assert.equal(
      apiKeySha256,
      manifest.environment.firebaseConfig.apiKeySha256,
      `${capture.id} used an unexpected Firebase API key.`,
    );
  }
  for (const projectId of capture.network.observedFirebaseProjectIds) {
    assert.equal(
      contract.networkBoundary.forbiddenFirebaseProjectIds.includes(projectId),
      false,
      `${capture.id} contacted the Production Firebase project.`,
    );
  }
  captureNetworkRequestCount += capture.network.requestCount;
  assert.equal(capture.dom?.overflowX, 0);
  assert.equal(Number.isInteger(capture.viewport?.width), true);
  assert.equal(Number.isInteger(capture.viewport?.height), true);
  assert.equal(allViewports.has(viewportKey(capture.viewport)), true);
  assert.equal(capture.actualPixelSize?.width, capture.viewport.width);
  if (isFullPage) {
    assert.equal(
      capture.actualPixelSize?.height,
      Math.max(capture.viewport.height, capture.dom?.scrollHeight ?? 0),
      `${capture.id} full-page height is not the captured document height.`,
    );
  } else {
    assert.deepEqual(capture.actualPixelSize, capture.viewport);
  }
  assert.equal(
    capture.id,
    captureKey(capture.stage, capture.screenId, capture.viewport),
  );
  assert.equal(
    expectedCaptureKeys.has(capture.id),
    true,
    `Unexpected capture: ${capture.id}`,
  );
  assert.equal(
    captures.has(capture.id),
    false,
    `Duplicate capture: ${capture.id}`,
  );
  captures.set(capture.id, capture);
  const sourceCommitSha =
    capture.stage === "baseline"
      ? contract.productionPresentationSha
      : manifest.sourceCommitSha;
  const observedOrigin =
    capture.stage === "baseline"
      ? manifest.baselineDeployment.url.replace(/\/$/u, "")
      : manifest.candidateDeployment.url.replace(/\/$/u, "");
  assert.equal(capture.sourceCommitSha, sourceCommitSha);
  assert.equal(capture.observedOrigin.replace(/\/$/u, ""), observedOrigin);
  assert.equal(
    new URL(capture.finalUrl).origin,
    new URL(observedOrigin).origin,
  );
  assert.equal(
    normalizedRouteFromUrl(capture.finalUrl),
    decodeURIComponent(capture.route),
    `${capture.id} browser URL does not match the captured route.`,
  );
  assert.equal(
    new URL(capture.performanceNavigationUrl).origin,
    new URL(observedOrigin).origin,
    `${capture.id} navigation trace came from another origin.`,
  );
  const capturedAt = isoTime(capture.capturedAt, `${capture.id}.capturedAt`);
  assert.ok(capturedAt >= startedAt && capturedAt <= completedAt);
  assert.equal(capture.fileName, capture.fileName.replaceAll("\\", "/"));
  assert.match(
    capture.fileName,
    /^(?:baseline|candidate)\/[a-z0-9][a-z0-9-]*-[0-9]+x[0-9]+\.png$/u,
  );
  assert.equal(
    basename(capture.fileName).startsWith(`${capture.screenId}-`),
    true,
  );
  assert.equal(representedPngs.has(capture.fileName), false);
  representedPngs.add(capture.fileName);
  assert.match(capture.sha256, /^[a-f0-9]{64}$/u);
  const screenshotHashKey = `${capture.stage}:${viewportKey(capture.viewport)}:${capture.sha256}`;
  assert.equal(
    screenshotHashesByStageAndViewport.has(screenshotHashKey),
    false,
    `${capture.id} reuses another screen's screenshot bytes.`,
  );
  screenshotHashesByStageAndViewport.set(screenshotHashKey, capture.id);
  const pngPath = resolve(evidenceRoot, capture.fileName);
  assert.equal(existsSync(pngPath), true, `Missing ${capture.fileName}.`);
  assert.equal(statSync(pngPath).isFile(), true);
  const png = readFileSync(pngPath);
  assert.equal(sha256(png), capture.sha256, `${capture.fileName} SHA drifted.`);
  const decoded = decodePng(png, capture.fileName);
  assert.deepEqual(
    { width: decoded.width, height: decoded.height },
    capture.actualPixelSize,
    `${capture.fileName} pixel dimensions drifted.`,
  );
  decodedPngs.set(capture.id, decoded);

  assert.equal(Number.isInteger(capture.dom?.scrollWidth), true);
  assert.equal(Number.isInteger(capture.dom?.clientWidth), true);
  assert.equal(Number.isInteger(capture.dom?.scrollHeight), true);
  assert.equal(Number.isInteger(capture.dom?.clientHeight), true);
  assert.ok(capture.dom.scrollHeight >= capture.dom.clientHeight);
  assert.equal(Number.isInteger(capture.dom?.tableCount), true);
  assert.equal(Number.isInteger(capture.dom?.buttonCount), true);
  assert.equal(Array.isArray(capture.dom?.tableColumnWidths), true);
  assert.equal(
    capture.dom.scrollWidth - capture.dom.clientWidth,
    capture.dom.overflowX,
  );
  if (screen.role !== "support") {
    for (const elementName of contract.layoutDiff
      .requiredAuthenticatedElements) {
      assert.equal(
        capture.elements?.[elementName]?.present,
        true,
        `${capture.id} is missing ${elementName}.`,
      );
    }
    const navigationElement =
      capture.viewport.width >= 1024
        ? contract.layoutDiff.requiredDesktopElement
        : contract.layoutDiff.requiredMobileElement;
    assert.equal(
      capture.elements?.[navigationElement]?.present,
      true,
      `${capture.id} is missing ${navigationElement}.`,
    );
  } else {
    assert.equal(
      capture.elements?.content?.present,
      true,
      `${capture.id} is missing content.`,
    );
  }
  if (capture.dom.tableCount > 0) {
    assert.equal(capture.elements?.table?.present, true);
    assert.equal(capture.elements?.firstTableRow?.present, true);
    assert.ok(capture.dom.tableColumnWidths.length > 0);
  }
  if (capture.dom.buttonCount > 0) {
    assert.equal(capture.elements?.primaryButton?.present, true);
  }
}
assert.ok(
  networkSummary.requestCount >= captureNetworkRequestCount,
  "The root network measurement omits one or more captured requests.",
);
assert.deepEqual(
  [...captures.keys()].sort(),
  [...expectedCaptureKeys].sort(),
  "Visual capture matrix is incomplete.",
);
assert.deepEqual(
  listPngFiles(evidenceRoot).sort(),
  [...representedPngs].sort(),
  "Every evidence PNG must be represented exactly once.",
);

const expectedAuditCaptures = new Map();
for (const capture of captures.values()) {
  const authenticationRole =
    contract.captureAuthenticationRoles[capture.screenId];
  const auditRole =
    capture.role === "support"
      ? authenticationRole
        ? `support-${authenticationRole}`
        : "support-public"
      : capture.role;
  const auditId = `${capture.stage}:${auditRole}:${viewportKey(capture.viewport)}`;
  const current = expectedAuditCaptures.get(auditId) || [];
  current.push(capture.id);
  expectedAuditCaptures.set(auditId, current);
}
assert.equal(Array.isArray(manifest.browserAudits), true);
assert.equal(manifest.browserAudits.length, expectedAuditCaptures.size);
const representedAuditFiles = new Set();
const capturesRepresentedByAudit = new Set();
const observedAuditIds = new Set();
let auditedStagingFirebaseRequests = 0;
let auditedProductionAccess = 0;
let auditedProductionWrites = 0;
for (const audit of manifest.browserAudits) {
  assert.equal(observedAuditIds.has(audit.id), false, `Duplicate ${audit.id}.`);
  observedAuditIds.add(audit.id);
  assert.ok(["baseline", "candidate"].includes(audit.stage));
  assert.ok(
    [
      "student",
      "teacher",
      "admin",
      "support-public",
      "support-teacher",
    ].includes(audit.role),
  );
  assert.equal(allViewports.has(viewportKey(audit.viewport)), true);
  assert.equal(
    audit.id,
    `${audit.stage}:${audit.role}:${viewportKey(audit.viewport)}`,
  );
  assert.deepEqual(
    [...audit.captureIds].sort(),
    [...(expectedAuditCaptures.get(audit.id) || [])].sort(),
    `${audit.id} does not cover its browser captures.`,
  );
  for (const captureId of audit.captureIds) {
    assert.equal(
      capturesRepresentedByAudit.has(captureId),
      false,
      `${captureId} appears in more than one browser audit.`,
    );
    capturesRepresentedByAudit.add(captureId);
  }
  assert.match(
    audit.fileName,
    /^browser-audits\/(?:baseline|candidate)-(?:student|teacher|admin|support-public|support-teacher)-[0-9]+x[0-9]+\.jsonl$/u,
  );
  assert.equal(representedAuditFiles.has(audit.fileName), false);
  representedAuditFiles.add(audit.fileName);
  assert.match(audit.sha256, /^[a-f0-9]{64}$/u);
  const auditPath = resolve(evidenceRoot, audit.fileName);
  assert.equal(existsSync(auditPath), true, `Missing ${audit.fileName}.`);
  assert.ok(statSync(auditPath).size > 100, `${audit.fileName} is empty.`);
  const { textValue: auditText, events } = readBrowserAudit(auditPath);
  assert.equal(sha256(Buffer.from(auditText)), audit.sha256);
  const sessionEvents = events.filter(
    (event) => event.type === "browser-session",
  );
  const completionEvents = events.filter(
    (event) => event.type === "browser-session-complete",
  );
  assert.equal(sessionEvents.length, 1);
  assert.equal(completionEvents.length, 1);
  const authenticatedAuditRole = audit.role.startsWith("support-")
    ? audit.role.slice("support-".length)
    : audit.role;
  assert.deepEqual(sessionEvents[0], {
    type: "browser-session",
    id: audit.id,
    stage: audit.stage,
    role: audit.role,
    viewport: audit.viewport,
    browserVersion: manifest.environment.browserVersion,
    captureSessionId: manifest.environment.captureSessionId,
    runnerRuntimeSha256: manifest.generator.scriptRuntimeSha256,
    trustedInputsSha256: manifest.generator.trustedInputsSha256,
    firebaseProjectId: contract.firebaseProjectId,
    fixtureId: contract.fixtureId,
    fixturePlanHash: contract.fixturePlanHash,
    fixtureCaptureBindingHash: manifest.fixtureAudit.captureBindingHash,
    fixtureAuditSha256: manifest.fixtureAudit.sha256,
    identityAttestation:
      authenticatedAuditRole === "public"
        ? null
        : manifest.identityAttestations[authenticatedAuditRole],
  });
  const captureEvents = events.filter((event) => event.type === "capture");
  assert.deepEqual(
    captureEvents.map((event) => event.id).sort(),
    [...audit.captureIds].sort(),
    `${audit.id} capture attestations are incomplete.`,
  );
  for (const event of captureEvents) {
    const capture = captures.get(event.id);
    assert.ok(capture, `${event.id} is not a manifest capture.`);
    const expectedEvent = {
      type: "capture",
      id: capture.id,
      route: capture.route,
      finalUrl: capture.finalUrl,
      fixtureId: contract.fixtureId,
      fixturePlanHash: contract.fixturePlanHash,
      fixtureCaptureBindingHash: manifest.fixtureAudit.captureBindingHash,
      fixtureAuditSha256: manifest.fixtureAudit.sha256,
      screenshotFile: capture.fileName,
      screenshotSha256: capture.sha256,
      readySignalsSha256: sha256(
        Buffer.from(JSON.stringify(capture.readySignals)),
      ),
      domSha256: sha256(Buffer.from(JSON.stringify(capture.dom))),
      elementsSha256: sha256(Buffer.from(JSON.stringify(capture.elements))),
      anchorsSha256: sha256(Buffer.from(JSON.stringify(capture.anchors))),
      primitivesSha256: sha256(Buffer.from(JSON.stringify(capture.primitives))),
      fixtureActionsSha256: sha256(
        Buffer.from(JSON.stringify(capture.fixtureActions)),
      ),
      fixtureEvidenceSha256: sha256(
        Buffer.from(JSON.stringify(capture.fixtureEvidence)),
      ),
    };
    assert.deepEqual(event, expectedEvent);
    assert.equal(
      capture.browserAttestationSha256,
      sha256(Buffer.from(JSON.stringify(expectedEvent))),
      `${capture.id} browser attestation drifted.`,
    );
  }
  const requestEvents = events.filter(
    (event) => event.type === "network-request",
  );
  const responseEvents = events.filter(
    (event) => event.type === "network-response",
  );
  const fixtureDataServices = new Set(["firestore", "functions", "storage"]);
  const knownFirebaseServices = new Set([
    "auth",
    "app-check",
    "firestore",
    "storage",
    "functions",
    "realtime-database",
    "hosting",
  ]);
  for (const event of [...requestEvents, ...responseEvents]) {
    assert.equal(
      event.firebase,
      event.firebaseService === null
        ? false
        : knownFirebaseServices.has(event.firebaseService),
      `${audit.id} contains an invalid Firebase service classification.`,
    );
    assert.match(
      event.correlationId ?? "",
      new RegExp(
        `^${audit.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:request-[0-9]+$`,
        "u",
      ),
    );
  }
  const requestsByCorrelationId = new Map();
  for (const request of requestEvents) {
    assert.equal(requestsByCorrelationId.has(request.correlationId), false);
    requestsByCorrelationId.set(request.correlationId, request);
  }
  const observedResponseCorrelationIds = new Set();
  for (const response of responseEvents) {
    assert.equal(
      observedResponseCorrelationIds.has(response.correlationId),
      false,
      `${audit.id} repeats a response correlation ID.`,
    );
    observedResponseCorrelationIds.add(response.correlationId);
    const request = requestsByCorrelationId.get(response.correlationId);
    assert.ok(request, `${audit.id} response has no originating request.`);
    for (const field of [
      "phase",
      "captureId",
      "method",
      "hostname",
      "firebaseService",
      "firebase",
      "staging",
      "production",
      "unboundFirebase",
      "apiKeySha256",
    ]) {
      assert.deepEqual(
        response[field],
        request[field],
        `${audit.id} response correlation changed ${field}.`,
      );
    }
    assert.deepEqual(response.observedProjectIds, request.observedProjectIds);
  }
  for (const event of captureEvents) {
    const capture = captures.get(event.id);
    if (!capture.fixtureMarker) continue;
    assert.ok(
      requestEvents.some(
        (request) =>
          request.captureId === event.id &&
          request.staging &&
          fixtureDataServices.has(request.firebaseService) &&
          responseEvents.some(
            (response) =>
              response.correlationId === request.correlationId &&
              response.status < 400,
          ),
      ),
      `${event.id} has no capture-bound staging data request.`,
    );
  }
  assert.equal(requestEvents.length > 0, true, `${audit.id} has no requests.`);
  const stagingRequests = requestEvents.filter(
    (request) => request.firebase && request.staging,
  );
  const productionRequests = requestEvents.filter(
    (request) => request.production,
  );
  const unboundFirebaseRequests = requestEvents.filter(
    (request) => request.firebase && request.unboundFirebase,
  );
  assert.deepEqual(
    unboundFirebaseRequests,
    [],
    `${audit.id} contains a Firebase request outside the staging boundary.`,
  );
  for (const request of requestEvents.filter(
    (request) => request.apiKeySha256,
  )) {
    assert.equal(
      request.apiKeySha256,
      manifest.environment.firebaseConfig.apiKeySha256,
      `${audit.id} used an unexpected Firebase API key.`,
    );
  }
  if (audit.role !== "support-public") {
    assert.ok(
      stagingRequests.length > 0,
      `${audit.id} does not prove staging Firebase use.`,
    );
  }
  assert.deepEqual(productionRequests, [], `${audit.id} reached Production.`);
  const countBy = (items, selectKey) =>
    Object.fromEntries(
      [
        ...items.reduce((counts, item) => {
          const key = selectKey(item);
          counts.set(key, (counts.get(key) || 0) + 1);
          return counts;
        }, new Map()),
      ].sort(([left], [right]) => left.localeCompare(right)),
    );
  const firebaseRequests = requestEvents.filter((request) => request.firebase);
  const stagingResponses = responseEvents.filter(
    (response) =>
      response.firebase && response.staging && response.status < 400,
  );
  const stagingDataRequests = stagingRequests.filter((request) =>
    fixtureDataServices.has(request.firebaseService),
  );
  const stagingDataResponses = stagingResponses.filter((response) =>
    fixtureDataServices.has(response.firebaseService),
  );
  const groupNetwork = {
    requestCount: requestEvents.length,
    responseCount: responseEvents.length,
    firebaseRequestCount: firebaseRequests.length,
    stagingFirebaseRequestCount: stagingRequests.length,
    stagingFirebaseResponseCount: stagingResponses.length,
    stagingDataRequestCount: stagingDataRequests.length,
    stagingDataResponseCount: stagingDataResponses.length,
    stagingFirebaseRequestsByPhase: countBy(
      stagingRequests,
      (request) => request.phase,
    ),
    stagingFirebaseRequestsByStage: stagingRequests.length
      ? { [audit.stage]: stagingRequests.length }
      : {},
    stagingScreenRequestsByStage: stagingRequests.some(
      (request) => request.phase === "screen-capture",
    )
      ? {
          [audit.stage]: stagingRequests.filter(
            (request) => request.phase === "screen-capture",
          ).length,
        }
      : {},
    productionAccess: productionRequests.length,
    productionWrites: productionRequests.filter(
      (request) => request.productionWrite,
    ).length,
    unboundFirebaseRequestCount: unboundFirebaseRequests.length,
    observedFirebaseApiKeySha256s: [
      ...new Set(
        firebaseRequests.map((request) => request.apiKeySha256).filter(Boolean),
      ),
    ].sort(),
    observedFirebaseProjectIds: [
      ...new Set(
        firebaseRequests.flatMap((request) => request.observedProjectIds),
      ),
    ].sort(),
    observedFirebaseHosts: [
      ...new Set(firebaseRequests.map((request) => request.hostname)),
    ].sort(),
    productionRequestHosts: [
      ...new Set(productionRequests.map((request) => request.hostname)),
    ].sort(),
    failedFirebaseResponseCount: responseEvents.filter(
      (response) => response.firebase && response.status >= 400,
    ).length,
  };
  assert.deepEqual(completionEvents[0], {
    type: "browser-session-complete",
    id: audit.id,
    captureCount: captureEvents.length,
    network: groupNetwork,
  });
  auditedStagingFirebaseRequests += stagingRequests.length;
  auditedProductionAccess += productionRequests.length;
  auditedProductionWrites += productionRequests.filter(
    (request) => request.productionWrite,
  ).length;
}
assert.ok(auditedStagingFirebaseRequests > 0);
assert.equal(
  auditedStagingFirebaseRequests,
  networkSummary.stagingFirebaseRequestCount,
);
assert.equal(auditedProductionAccess, manifest.productionAccess);
assert.equal(auditedProductionWrites, manifest.productionWrites);
assert.deepEqual(
  [...observedAuditIds].sort(),
  [...expectedAuditCaptures.keys()].sort(),
  "Browser audit matrix is incomplete.",
);
assert.deepEqual(
  [...capturesRepresentedByAudit].sort(),
  [...captures.keys()].sort(),
  "Every capture must be backed by exactly one sanitized browser audit.",
);
assert.deepEqual(
  listBrowserAuditFiles(evidenceRoot).sort(),
  [...representedAuditFiles].sort(),
  "Every sanitized browser audit must be represented exactly once.",
);

const validateElement = (element, label) => {
  assert.equal(typeof element?.present, "boolean", `${label}.present missing.`);
  if (!element.present) return;
  assert.ok(String(element.selector ?? "").trim().length > 0);
  assert.match(String(element.tagName ?? ""), /^[A-Z][A-Z0-9-]*$/u);
  for (const coordinate of ["x", "y", "width", "height"]) {
    assert.equal(Number.isFinite(element.box?.[coordinate]), true);
    assert.equal(Number.isFinite(element.visibleBox?.[coordinate]), true);
  }
  assert.equal(Number.isFinite(element.visibleAreaRatio), true);
  assert.equal(Number.isFinite(element.paintVisibilityRatio), true);
  assert.ok(
    element.visibleAreaRatio >= 0 && element.visibleAreaRatio <= 1.000001,
  );
  assert.ok(
    Number.isFinite(element.effectiveOpacity) &&
      element.effectiveOpacity >= 0.9 &&
      element.effectiveOpacity <= 1.000001,
    `${label}.effectiveOpacity is not visibly painted.`,
  );
  assert.equal(typeof element.textPainted, "boolean");
  assert.equal(Number.isFinite(element.textFontSizePx), true);
  assert.equal(Number.isFinite(element.textForegroundAlpha), true);
  assert.equal(Number.isFinite(element.textGlyphVisibleRatio), true);
  assert.equal(typeof element.textPaintEffectsSafe, "boolean");
  assert.equal(typeof element.canvasPainted, "boolean");
  assert.equal(Number.isFinite(element.canvasSampledOpaquePixels), true);
  assert.equal(Number.isFinite(element.canvasSampledColors), true);
  for (const property of contract.layoutDiff.computedStyleProperties) {
    assert.equal(
      typeof element.computed?.[property],
      "string",
      `${label}.computed.${property} missing.`,
    );
  }
};

for (const capture of captures.values()) {
  for (const [name, element] of Object.entries(capture.elements ?? {})) {
    validateElement(element, `${capture.id}.elements.${name}`);
  }
}

const validateAnchor = (
  anchor,
  label,
  capture,
  {
    allowBelowFold = false,
    allowEmptyText = false,
    paintMode = "text",
    minimumContrastRatio = null,
    minimumGlyphVisibleRatio = 0.6,
  } = {},
) => {
  assert.ok(String(anchor?.selector ?? "").trim().length > 0);
  assert.match(String(anchor?.tagName ?? ""), /^[A-Z][A-Z0-9-]*$/u);
  if (!allowEmptyText) {
    assert.ok(
      String(anchor?.text ?? "").trim().length > 0,
      `${label}.text empty.`,
    );
  }
  for (const coordinate of ["x", "y", "width", "height"]) {
    assert.equal(Number.isFinite(anchor?.box?.[coordinate]), true);
    assert.equal(Number.isFinite(anchor?.visibleBox?.[coordinate]), true);
  }
  assert.ok(
    anchor.visibleAreaRatio >= 0.9 && anchor.visibleAreaRatio <= 1.000001,
    `${label} is not visibly rendered.`,
  );
  assert.ok(
    Number.isFinite(anchor.effectiveOpacity) &&
      anchor.effectiveOpacity >= 0.9 &&
      anchor.effectiveOpacity <= 1.000001,
    `${label} is not visibly opaque.`,
  );
  assert.ok(
    Number.isFinite(anchor.paintVisibilityRatio) &&
      anchor.paintVisibilityRatio >= 0.6,
    `${label} is occluded.`,
  );
  if (paintMode === "canvas") {
    assert.equal(anchor.tagName, "CANVAS");
    assert.equal(anchor.canvasPainted, true, `${label} canvas is blank.`);
    assert.ok(anchor.canvasSampledOpaquePixels >= 8);
    assert.ok(anchor.canvasSampledColors >= 2);
    assert.equal(anchor.paintWitness, null);
  } else {
    const paintWitness = anchor.paintWitness;
    assert.match(paintWitness?.selector ?? "", /\S/u);
    assert.match(paintWitness?.tagName ?? "", /^(?:[A-Z][A-Z0-9-]*|text)$/u);
    assert.ok(paintWitness.effectiveOpacity >= 0.9);
    assert.ok(paintWitness.visibleAreaRatio >= 0.9);
    assert.ok(paintWitness.paintVisibilityRatio >= 0.6);
    assert.equal(
      paintWitness.textPainted,
      true,
      `${label} text is not painted.`,
    );
    assert.ok(
      paintWitness.textFontSizePx >= 8,
      `${label} text is too small to be a visible witness.`,
    );
    assert.ok(
      paintWitness.textForegroundAlpha >= 0.9,
      `${label} text foreground is transparent.`,
    );
    assert.ok(
      paintWitness.textGlyphVisibleRatio >= minimumGlyphVisibleRatio,
      `${label} text glyphs are clipped or shifted out of view.`,
    );
    assert.equal(
      paintWitness.textPaintEffectsSafe,
      true,
      `${label} text uses a masking or hiding paint effect.`,
    );
    if (Number.isFinite(minimumContrastRatio)) {
      assert.equal(
        paintWitness.textRequiredContrastRatio,
        minimumContrastRatio,
      );
    } else {
      assert.ok([3, 4.5].includes(paintWitness.textRequiredContrastRatio));
    }
    assert.ok(
      paintWitness.textContrastRatio >= paintWitness.textRequiredContrastRatio,
      `${label} text contrast is too low.`,
    );
  }
  assert.ok(anchor.visibleBox.width > 0 && anchor.visibleBox.height > 0);
  assert.ok(anchor.box.x >= 0 && anchor.box.y >= 0);
  assert.ok(anchor.box.width > 0 && anchor.box.height > 0);
  assert.ok(
    anchor.box.x + anchor.box.width <= capture.actualPixelSize.width + 1,
  );
  assert.ok(
    anchor.box.y + anchor.box.height <=
      (allowBelowFold
        ? capture.dom.scrollHeight
        : capture.actualPixelSize.height) +
        1,
    `${label} is outside the captured page.`,
  );
  for (const property of contract.layoutDiff.computedStyleProperties) {
    assert.equal(
      typeof anchor.computed?.[property],
      "string",
      `${label}.computed.${property} missing.`,
    );
  }
};

let capturedPrimitiveAssertions = 0;
for (const capture of captures.values()) {
  const requirements =
    expectedPrimitiveRequirementsByCapture.get(capture.id) || [];
  assert.deepEqual(
    Object.keys(capture.primitives ?? {}).sort(),
    requirements.map((requirement) => requirement.id).sort(),
    `${capture.id} has an incomplete structural primitive trace.`,
  );
  for (const requirement of requirements) {
    const primitive = capture.primitives[requirement.id];
    assert.equal(
      primitive.selector,
      requirement.selector,
      `${capture.id}.${requirement.id} selector drifted.`,
    );
    assert.equal(
      primitive.matchCount,
      requirement.exactCount,
      `${capture.id}.${requirement.id} visible match count drifted.`,
    );
    assert.equal(primitive.items.length, requirement.exactCount);
    const itemSelectors = new Set();
    for (const [index, item] of primitive.items.entries()) {
      validateAnchor(
        item,
        `${capture.id}.primitives.${requirement.id}[${index}]`,
        capture,
        { allowBelowFold: true, allowEmptyText: true },
      );
      assert.match(item.tagName, new RegExp(requirement.tagPattern, "u"));
      assert.equal(
        itemSelectors.has(item.selector),
        false,
        `${capture.id}.${requirement.id} repeats one DOM element.`,
      );
      itemSelectors.add(item.selector);
      capturedPrimitiveAssertions += 1;
    }
  }
}

let readySignalAssertions = 0;
for (const capture of captures.values()) {
  assert.equal(capture.readyStateId, capture.screenId);
  assert.equal(
    capture.fixtureMarker,
    contract.fixtureMarkers[capture.screenId] ?? null,
    `${capture.id} fixture marker drifted.`,
  );
  const requirements = contract.screenReadyStates[capture.screenId].signals;
  assert.deepEqual(
    Object.keys(capture.readySignals ?? {}).sort(),
    requirements.map((requirement) => requirement.id).sort(),
    `${capture.id} has an incomplete ready-state trace.`,
  );
  const selectors = new Set();
  const boxes = new Set();
  for (const requirement of requirements) {
    const signal = capture.readySignals[requirement.id];
    validateAnchor(
      signal,
      `${capture.id}.readySignals.${requirement.id}`,
      capture,
      {
        allowBelowFold: true,
        allowEmptyText: requirement.allowEmptyText === true,
        paintMode: requirement.paintMode ?? "text",
        minimumContrastRatio: requirement.minimumContrastRatio ?? null,
        minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio ?? 0.6,
      },
    );
    assert.match(signal.text, new RegExp(requirement.textPattern, "u"));
    assert.match(signal.tagName, new RegExp(requirement.tagPattern, "u"));
    assert.equal(
      selectors.has(signal.selector),
      false,
      `${capture.id} reuses one element for multiple ready signals.`,
    );
    selectors.add(signal.selector);
    const boxKey = [
      signal.box.x,
      signal.box.y,
      signal.box.width,
      signal.box.height,
    ].join(":");
    assert.equal(
      boxes.has(boxKey),
      false,
      `${capture.id} reuses one ready-signal box.`,
    );
    boxes.add(boxKey);
    readySignalAssertions += 1;
  }
  if (capture.fixtureMarker) {
    assert.equal(
      Object.values(capture.readySignals).some(
        (signal) => signal.text === capture.fixtureMarker,
      ),
      true,
      `${capture.id} did not render its exact fixture marker.`,
    );
  }
}

let requiredAnchorAssertions = 0;
for (const capture of captures.values()) {
  for (const [name, anchor] of Object.entries(capture.anchors ?? {})) {
    validateAnchor(anchor, `${capture.id}.anchors.${name}`, capture);
  }
  if (capture.stage !== "candidate") continue;
  const screen = screensById.get(capture.screenId);
  if (screen?.productionPresentation) continue;
  const requirements = contract.newSurfaceRequiredAnchors[capture.screenId];
  assert.ok(
    Array.isArray(requirements) && requirements.length >= 2,
    `${capture.screenId} has no screen-specific content anchors.`,
  );
  const requiredAnchorSelectors = new Set();
  const requiredAnchorBoxes = new Set();
  for (const requirement of requirements) {
    const anchor = capture.anchors?.[requirement.id];
    assert.ok(anchor, `${capture.id} is missing anchor ${requirement.id}.`);
    validateAnchor(anchor, `${capture.id}.anchors.${requirement.id}`, capture);
    assert.match(
      anchor.text,
      new RegExp(requirement.textPattern, "u"),
      `${capture.id} anchor ${requirement.id} has unexpected content.`,
    );
    assert.equal(
      requiredAnchorSelectors.has(anchor.selector),
      false,
      `${capture.id} reuses one selector for multiple required anchors.`,
    );
    requiredAnchorSelectors.add(anchor.selector);
    const anchorBoxKey = [
      anchor.box.x,
      anchor.box.y,
      anchor.box.width,
      anchor.box.height,
    ].join(":");
    assert.equal(
      requiredAnchorBoxes.has(anchorBoxKey),
      false,
      `${capture.id} reuses one element box for multiple required anchors.`,
    );
    requiredAnchorBoxes.add(anchorBoxKey);
    if (requirement.id === "heading") {
      assert.match(anchor.tagName, /^H[1-3]$/u);
    }
    if (requirement.id === "content") {
      assert.doesNotMatch(anchor.tagName, /^H[1-6]$/u);
    }
    if (requirement.id === "primary-action") {
      assert.match(anchor.tagName, /^(?:A|BUTTON)$/u);
    }
    requiredAnchorAssertions += 1;
  }
}

const boxDiff = (baselineElement, candidateElement, compareHeight) => {
  const coordinateKeys = ["x", "y"];
  const sizeKeys = compareHeight ? ["width", "height"] : ["width"];
  return {
    coordinate: Math.max(
      ...coordinateKeys.map((key) =>
        Math.abs(baselineElement.box[key] - candidateElement.box[key]),
      ),
    ),
    size: Math.max(
      ...sizeKeys.map((key) =>
        Math.abs(baselineElement.box[key] - candidateElement.box[key]),
      ),
    ),
  };
};

const compareLayout = (baselineCapture, candidateCapture, mode) => {
  const requiredNavigation =
    candidateCapture.viewport.width >= 1024
      ? contract.layoutDiff.requiredDesktopElement
      : contract.layoutDiff.requiredMobileElement;
  const names =
    mode === "shell"
      ? ["header", "content", requiredNavigation]
      : [
          ...new Set([
            ...Object.keys(baselineCapture.elements ?? {}),
            ...Object.keys(candidateCapture.elements ?? {}),
          ]),
        ];
  let maxCoordinateDelta = 0;
  let maxSizeDelta = 0;
  let computedStyleMismatches = 0;
  for (const name of names) {
    const baselineElement = baselineCapture.elements?.[name] ?? {
      present: false,
    };
    const candidateElement = candidateCapture.elements?.[name] ?? {
      present: false,
    };
    assert.equal(
      candidateElement.present,
      baselineElement.present,
      `${candidateCapture.id} ${name} presence differs from Production.`,
    );
    if (!baselineElement.present) continue;
    const compareHeight = !(mode === "shell" && name === "content");
    const difference = boxDiff(
      baselineElement,
      candidateElement,
      compareHeight,
    );
    maxCoordinateDelta = Math.max(maxCoordinateDelta, difference.coordinate);
    maxSizeDelta = Math.max(maxSizeDelta, difference.size);
    const compareComputed = mode === "pixel" || name !== "content";
    if (compareComputed) {
      for (const property of contract.layoutDiff.computedStyleProperties) {
        if (
          baselineElement.computed[property] !==
          candidateElement.computed[property]
        ) {
          computedStyleMismatches += 1;
        }
      }
    }
  }
  const baselineWidths = baselineCapture.dom.tableColumnWidths;
  const candidateWidths = candidateCapture.dom.tableColumnWidths;
  let tableColumnMaxDelta = 0;
  if (mode === "pixel") {
    assert.equal(
      candidateCapture.dom.tableCount,
      baselineCapture.dom.tableCount,
      `${candidateCapture.id} table count differs from Production.`,
    );
    assert.equal(
      candidateCapture.dom.buttonCount,
      baselineCapture.dom.buttonCount,
      `${candidateCapture.id} button count differs from Production.`,
    );
    assert.equal(
      candidateWidths.length,
      baselineWidths.length,
      `${candidateCapture.id} table column count differs from Production.`,
    );
    for (let index = 0; index < baselineWidths.length; index += 1) {
      tableColumnMaxDelta = Math.max(
        tableColumnMaxDelta,
        Math.abs(baselineWidths[index] - candidateWidths[index]),
      );
    }
  }
  const result = {
    maxBoxCoordinateDeltaPx: normalizeNumber(maxCoordinateDelta),
    maxBoxSizeDeltaPx: normalizeNumber(maxSizeDelta),
    tableColumnMaxDeltaPx: normalizeNumber(tableColumnMaxDelta),
    computedStyleMismatches,
  };
  assert.ok(
    result.maxBoxCoordinateDeltaPx <=
      contract.layoutDiff.maxBoxCoordinateDeltaPx,
    `${candidateCapture.id} element coordinates drifted.`,
  );
  assert.ok(
    result.maxBoxSizeDeltaPx <= contract.layoutDiff.maxBoxSizeDeltaPx,
    `${candidateCapture.id} element sizes drifted.`,
  );
  assert.ok(
    result.tableColumnMaxDeltaPx <= contract.layoutDiff.maxBoxSizeDeltaPx,
    `${candidateCapture.id} table columns drifted.`,
  );
  assert.equal(
    result.computedStyleMismatches,
    0,
    `${candidateCapture.id} computed styles drifted.`,
  );
  return result;
};

const productionVisualTokenInventory = Object.fromEntries(
  ["background", "border", "radius", "padding", "gap", "background-image"].map(
    (token) => [token, new Set()],
  ),
);
const collectProductionVisualTokens = (item) => {
  if (!item?.computed || typeof item.computed !== "object") return;
  for (const [token, values] of Object.entries(
    visualTokenValues(item.computed),
  )) {
    for (const tokenValue of values) {
      productionVisualTokenInventory[token].add(tokenValue);
    }
  }
};
for (const capture of captures.values()) {
  if (capture.stage !== "baseline") continue;
  for (const item of Object.values(capture.elements ?? {})) {
    collectProductionVisualTokens(item);
  }
  for (const item of Object.values(capture.anchors ?? {})) {
    collectProductionVisualTokens(item);
  }
  for (const item of Object.values(capture.readySignals ?? {})) {
    collectProductionVisualTokens(item);
  }
  for (const primitive of Object.values(capture.primitives ?? {})) {
    for (const item of primitive.items ?? []) {
      collectProductionVisualTokens(item);
    }
  }
}
for (const [token, values] of Object.entries(productionVisualTokenInventory)) {
  assert.ok(
    values.size > 0,
    `Production evidence contains no ${token} design-token values.`,
  );
}

const compareNewSurfacePrimitives = (
  screenId,
  requirements,
  baselineCapture,
  candidateCapture,
) => {
  let styleAssertions = 0;
  let boxAssertions = 0;
  const candidateSelectors = new Set();
  const candidateBoxes = new Set();
  const baselineSelectors = new Set();
  const baselineBoxes = new Set();
  for (const requirement of requirements) {
    const baselinePrimitive =
      baselineCapture.primitives?.[`${screenId}:${requirement.id}`];
    const candidatePrimitive = candidateCapture.primitives?.[requirement.id];
    assert.equal(
      baselinePrimitive?.matchCount,
      requirement.referenceExactCount,
    );
    assert.equal(candidatePrimitive?.matchCount, requirement.exactCount);
    const baselineItem = baselinePrimitive.items[0];
    const candidateItem = candidatePrimitive.items[0];
    assert.equal(
      baselineSelectors.has(baselineItem.selector),
      false,
      `${baselineCapture.id} reuses one Production element for multiple ${screenId} primitives.`,
    );
    baselineSelectors.add(baselineItem.selector);
    const baselineBoxKey = [
      baselineItem.box.x,
      baselineItem.box.y,
      baselineItem.box.width,
      baselineItem.box.height,
    ].join(":");
    assert.equal(
      baselineBoxes.has(baselineBoxKey),
      false,
      `${baselineCapture.id} reuses one Production box for multiple ${screenId} primitives.`,
    );
    baselineBoxes.add(baselineBoxKey);
    assert.equal(
      candidateSelectors.has(candidateItem.selector),
      false,
      `${candidateCapture.id} reuses one element for multiple primitives.`,
    );
    candidateSelectors.add(candidateItem.selector);
    const candidateBoxKey = [
      candidateItem.box.x,
      candidateItem.box.y,
      candidateItem.box.width,
      candidateItem.box.height,
    ].join(":");
    assert.equal(
      candidateBoxes.has(candidateBoxKey),
      false,
      `${candidateCapture.id} reuses one box for multiple primitives.`,
    );
    candidateBoxes.add(candidateBoxKey);
    const profileName =
      contract.newSurfacePrimitiveProfiles[screenId][requirement.id];
    const profile = contract.primitiveComparisonProfiles[profileName];
    for (const [item, capture, label] of [
      [baselineItem, baselineCapture, "Production"],
      [candidateItem, candidateCapture, "candidate"],
    ]) {
      const minimumWidth = Math.max(
        profile.minimumWidthPx ?? 0,
        (profile.minimumWidthViewportRatio ?? 0) * capture.viewport.width,
      );
      assert.ok(
        item.box.width >= minimumWidth,
        `${candidateCapture.id}.${requirement.id} ${label} primitive is too narrow.`,
      );
      assert.ok(
        item.box.height >= (profile.minimumHeightPx ?? 0),
        `${candidateCapture.id}.${requirement.id} ${label} primitive is too short.`,
      );
      assert.ok(
        item.box.width * item.box.height >=
          (profile.minimumAreaViewportRatio ?? 0) *
            capture.viewport.width *
            capture.viewport.height,
        `${candidateCapture.id}.${requirement.id} ${label} primitive area collapsed.`,
      );
    }
    const observedCandidateTokens = visualTokenCategories(
      candidateItem.computed,
    );
    const observedCandidateTokenValues = visualTokenValues(
      candidateItem.computed,
    );
    const candidateBackgroundImage =
      candidateItem.computed.backgroundImage || "none";
    assert.doesNotMatch(
      candidateBackgroundImage,
      /url\(/iu,
      `${candidateCapture.id}.${requirement.id} uses an external background image.`,
    );
    assert.equal(
      productionVisualTokenInventory["background-image"].has(
        candidateBackgroundImage,
      ),
      true,
      `${candidateCapture.id}.${requirement.id} uses a background image absent from Production.`,
    );
    for (const requiredToken of contract.newSurfacePrimitiveGrammar[screenId][
      requirement.id
    ]) {
      assert.equal(
        observedCandidateTokens.has(requiredToken),
        true,
        `${candidateCapture.id}.${requirement.id} lost its required ${requiredToken} visual token.`,
      );
      assert.ok(
        observedCandidateTokenValues[requiredToken].length > 0,
        `${candidateCapture.id}.${requirement.id} has no measurable ${requiredToken} token value.`,
      );
      for (const tokenValue of observedCandidateTokenValues[requiredToken]) {
        assert.equal(
          productionVisualTokenInventory[requiredToken].has(tokenValue),
          true,
          `${candidateCapture.id}.${requirement.id} uses a ${requiredToken} value absent from Production: ${tokenValue}.`,
        );
      }
    }
    const comparedStyles = profile.compareComputedStyleProperties;
    for (const property of comparedStyles) {
      assert.equal(
        candidateItem.computed[property],
        baselineItem.computed[property],
        `${candidateCapture.id}.${requirement.id} ${property} differs from its Production primitive.`,
      );
      styleAssertions += 1;
    }
    for (const property of profile.compareBoxProperties ?? []) {
      const tolerance = ["x", "y"].includes(property)
        ? contract.layoutDiff.maxBoxCoordinateDeltaPx
        : contract.layoutDiff.maxBoxSizeDeltaPx;
      assert.ok(
        Math.abs(candidateItem.box[property] - baselineItem.box[property]) <=
          tolerance,
        `${candidateCapture.id}.${requirement.id} ${property} differs from its Production primitive.`,
      );
      boxAssertions += 1;
    }
  }
  return {
    structuralPrimitives: requirements.length,
    styleAssertions,
    boxAssertions,
  };
};

const comparePixels = (
  baselinePng,
  candidatePng,
  baselineCapture,
  candidateCapture,
  masks,
  label,
) => {
  assert.deepEqual(
    [candidatePng.width, candidatePng.height],
    [baselinePng.width, baselinePng.height],
    `${label} PNG sizes differ.`,
  );
  const masked = new Uint8Array(baselinePng.width * baselinePng.height);
  const maskedElementNames = new Set();
  for (const [index, mask] of masks.entries()) {
    assert.ok(
      contract.pixelDiff.allowedMaskKinds.includes(mask.kind),
      `${label} mask ${index} has an unsupported kind.`,
    );
    assert.ok(String(mask.reason ?? "").trim().length >= 10);
    assert.ok(
      String(mask.elementName ?? "").trim().length > 0,
      `${label} mask ${index} is not tied to a captured element.`,
    );
    assert.equal(
      maskedElementNames.has(mask.elementName),
      false,
      `${label} masks ${mask.elementName} more than once.`,
    );
    maskedElementNames.add(mask.elementName);
    const baselineElement = baselineCapture.elements?.[mask.elementName];
    const candidateElement = candidateCapture.elements?.[mask.elementName];
    assert.equal(baselineElement?.present, true);
    assert.equal(candidateElement?.present, true);
    assert.ok(
      contract.pixelDiff.allowedMaskElementTags.includes(
        baselineElement.tagName,
      ),
      `${label} mask ${index} uses a broad baseline element.`,
    );
    assert.ok(
      contract.pixelDiff.allowedMaskElementTags.includes(
        candidateElement.tagName,
      ),
      `${label} mask ${index} uses a broad candidate element.`,
    );
    const padding = contract.pixelDiff.maskPaddingPx;
    const x = Math.max(
      0,
      Math.floor(
        Math.min(baselineElement.box.x, candidateElement.box.x) - padding,
      ),
    );
    const y = Math.max(
      0,
      Math.floor(
        Math.min(baselineElement.box.y, candidateElement.box.y) - padding,
      ),
    );
    const right = Math.min(
      baselinePng.width,
      Math.ceil(
        Math.max(
          baselineElement.box.x + baselineElement.box.width,
          candidateElement.box.x + candidateElement.box.width,
        ) + padding,
      ),
    );
    const bottom = Math.min(
      baselinePng.height,
      Math.ceil(
        Math.max(
          baselineElement.box.y + baselineElement.box.height,
          candidateElement.box.y + candidateElement.box.height,
        ) + padding,
      ),
    );
    assert.deepEqual(
      { x: mask.x, y: mask.y, width: mask.width, height: mask.height },
      { x, y, width: right - x, height: bottom - y },
      `${label} mask ${index} does not match its captured element box.`,
    );
    for (const field of ["x", "y", "width", "height"]) {
      assert.equal(Number.isInteger(mask[field]), true);
    }
    assert.ok(mask.x >= 0 && mask.y >= 0 && mask.width > 0 && mask.height > 0);
    assert.ok(mask.x + mask.width <= baselinePng.width);
    assert.ok(mask.y + mask.height <= baselinePng.height);
    for (let y = mask.y; y < mask.y + mask.height; y += 1) {
      for (let x = mask.x; x < mask.x + mask.width; x += 1) {
        masked[y * baselinePng.width + x] = 1;
      }
    }
  }
  const totalPixels = baselinePng.width * baselinePng.height;
  const maskedPixels = masked.reduce((total, value) => total + value, 0);
  assert.ok(
    maskedPixels / totalPixels <= contract.pixelDiff.maxMaskedPixelRatio,
    `${label} masks too much of the viewport.`,
  );
  let differentPixels = 0;
  let channelDeltaTotal = 0;
  let maxChannelDelta = 0;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    if (masked[pixel]) continue;
    let pixelDiffers = false;
    const offset = pixel * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(
        baselinePng.rgba[offset + channel] -
          candidatePng.rgba[offset + channel],
      );
      channelDeltaTotal += delta;
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      if (delta > contract.pixelDiff.channelTolerance) pixelDiffers = true;
    }
    if (pixelDiffers) differentPixels += 1;
  }
  const comparedPixels = totalPixels - maskedPixels;
  const result = {
    comparedPixels,
    maskedPixels,
    differentPixels,
    differentPixelRatio: normalizeNumber(differentPixels / comparedPixels),
    meanChannelDelta: normalizeNumber(channelDeltaTotal / (comparedPixels * 4)),
    maxChannelDelta,
  };
  assert.ok(
    result.differentPixelRatio <= contract.pixelDiff.maxDifferentPixelRatio,
    `${label} pixel ratio drifted: ${result.differentPixelRatio}.`,
  );
  assert.ok(
    result.meanChannelDelta <= contract.pixelDiff.maxMeanChannelDelta,
    `${label} mean channel delta drifted: ${result.meanChannelDelta}.`,
  );
  return result;
};

assert.equal(Array.isArray(manifest.comparisons), true);
assert.equal(manifest.comparisons.length, expectedComparisonKeys.size);
const observedComparisons = new Set();
let exactPixelComparisons = 0;
let newSurfaceShellComparisons = 0;
let newSurfacePrimitiveComparisons = 0;
let primitiveStyleAssertions = 0;
let primitiveBoxAssertions = 0;
for (const comparison of manifest.comparisons) {
  const screen = screensById.get(comparison.screenId);
  assert.ok(screen, `Unknown comparison screen: ${comparison.screenId}`);
  const key = comparisonKey(comparison.screenId, comparison.viewport);
  assert.equal(
    expectedComparisonKeys.has(key),
    true,
    `Unexpected comparison: ${key}`,
  );
  assert.equal(
    observedComparisons.has(key),
    false,
    `Duplicate comparison: ${key}`,
  );
  observedComparisons.add(key);
  const mode = screen.productionPresentation ? "pixel" : "shell";
  assert.equal(comparison.mode, mode);
  const baselineScreenId = screen.productionPresentation
    ? screen.id
    : contract.newSurfaceReferences[screen.id];
  const expectedBaselineId = captureKey(
    "baseline",
    baselineScreenId,
    comparison.viewport,
  );
  const expectedCandidateId = captureKey(
    "candidate",
    screen.id,
    comparison.viewport,
  );
  assert.equal(comparison.baselineCaptureId, expectedBaselineId);
  assert.equal(comparison.candidateCaptureId, expectedCandidateId);
  const baselineCapture = captures.get(expectedBaselineId);
  const candidateCapture = captures.get(expectedCandidateId);
  assert.ok(baselineCapture && candidateCapture);
  assert.deepEqual(candidateCapture.viewport, comparison.viewport);
  assert.deepEqual(baselineCapture.viewport, comparison.viewport);
  compareLayout(baselineCapture, candidateCapture, mode);
  assert.equal(comparison.layoutDiff, undefined);
  if (mode === "pixel") {
    assert.equal(comparison.anchorStyleDiff, undefined);
    assert.equal(Array.isArray(comparison.maskRegions), true);
    assert.deepEqual(
      comparison.maskRegions,
      [],
      `${comparison.id} cannot use post-capture visual masks.`,
    );
    comparePixels(
      decodedPngs.get(expectedBaselineId),
      decodedPngs.get(expectedCandidateId),
      baselineCapture,
      candidateCapture,
      comparison.maskRegions,
      key,
    );
    assert.equal(comparison.pixelDiff, undefined);
    exactPixelComparisons += 1;
  } else {
    const primitiveResult = compareNewSurfacePrimitives(
      screen.id,
      contract.newSurfaceRequiredPrimitives[screen.id],
      baselineCapture,
      candidateCapture,
    );
    newSurfacePrimitiveComparisons += primitiveResult.structuralPrimitives;
    primitiveStyleAssertions += primitiveResult.styleAssertions;
    primitiveBoxAssertions += primitiveResult.boxAssertions;
    assert.equal(comparison.anchorStyleDiff, undefined);
    assert.deepEqual(comparison.maskRegions, []);
    assert.equal(comparison.pixelDiff, undefined);
    newSurfaceShellComparisons += 1;
  }
  assert.equal(comparison.status, undefined);
}
assert.deepEqual(
  [...observedComparisons].sort(),
  [...expectedComparisonKeys].sort(),
  "Visual comparison matrix is incomplete.",
);

console.log(
  JSON.stringify(
    {
      suite: "w10p-visual-parity",
      passed: true,
      testRunId: manifest.testRunId,
      canonicalRoutes: inventory.canonicalCounts,
      screens: screens.length,
      keyScreens: contract.keyScreenIds.length,
      viewports: contract.viewports,
      captures: captures.size,
      comparisons: manifest.comparisons.length,
      exactPixelComparisons,
      newSurfaceShellComparisons,
      newSurfacePrimitiveComparisons,
      primitiveContractCount,
      capturedPrimitiveAssertions,
      primitiveStyleAssertions,
      primitiveBoxAssertions,
      requiredAnchorAssertions,
      readySignalAssertions,
      stagingFirebaseRequests: networkSummary.stagingFirebaseRequestCount,
      auditedStagingFirebaseRequests,
      fullPageViewportKeys: contract.fullPageViewportKeys,
      sourceCommitSha: manifest.sourceCommitSha,
      sourceTreeSha: manifest.sourceTreeSha,
      liveDeploymentVerified,
      productionAccess: manifest.productionAccess,
      productionWrites: manifest.productionWrites,
    },
    null,
    2,
  ),
);
