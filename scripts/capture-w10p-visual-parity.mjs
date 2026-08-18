import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { platform, release } from "node:os";
import { chromium } from "playwright-core";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10p-visual-parity-contract.json");
const inventory = readJson("scripts/w10p-route-menu-inventory.json");
const args = process.argv.slice(2);
const valueArg = (name) =>
  args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ||
  "";
const requiredArg = (name) => {
  const value = valueArg(name).trim();
  assert.ok(value, `${name}=... is required.`);
  return value;
};

const outputRoot = resolve(requiredArg("--output"));
const sourceCommitSha = requiredArg("--source-commit");
const baselineDeploymentId = requiredArg("--baseline-deployment-id");
const baselineDeploymentUrl = requiredArg("--baseline-url");
const candidateDeploymentId = requiredArg("--candidate-deployment-id");
const candidateDeploymentUrl = requiredArg("--candidate-url");
const fixtureAuditInputPath = resolve(requiredArg("--fixture-audit"));
assert.equal(
  existsSync(fixtureAuditInputPath),
  true,
  "The fresh staging fixture audit is missing.",
);
const fixtureAuditBytes = readFileSync(fixtureAuditInputPath);
const fixtureAuditText = fixtureAuditBytes.toString("utf8");
assert.doesNotMatch(fixtureAuditText, /@/u);
assert.doesNotMatch(
  fixtureAuditText,
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u,
);
const fixtureAudit = JSON.parse(fixtureAuditText);
const fixtureId = requiredArg("--fixture-id");
assert.equal(
  fixtureId,
  contract.fixtureId,
  "Visual capture must use the contract-bound staging fixture.",
);
const fixedTime = requiredArg("--fixed-time");
assert.equal(Number.isNaN(Date.parse(fixedTime)), false);
assert.equal(
  fixedTime,
  contract.fixedTime,
  "Visual capture time must match the contract-bound clock.",
);
assert.equal(existsSync(outputRoot), false, "Evidence output already exists.");

const credentials = JSON.parse(
  process.env.W10P_VISUAL_CREDENTIALS_JSON || "{}",
);
for (const role of ["student", "teacher", "admin"]) {
  assert.match(credentials[role]?.email ?? "", /@/u);
  assert.ok(String(credentials[role]?.password ?? "").length >= 8);
}
assert.equal(
  new Set(
    Object.values(credentials).map((credential) =>
      String(credential.email).trim().toLowerCase(),
    ),
  ).size,
  3,
  "Student, teacher, and admin captures require distinct accounts.",
);
const firebaseConfig = JSON.parse(
  process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "{}",
);
for (const field of [
  "apiKey",
  "authDomain",
  "projectId",
  "storageBucket",
  "messagingSenderId",
  "appId",
]) {
  assert.ok(
    String(firebaseConfig[field] ?? "").trim().length > 0,
    `W10P_VISUAL_FIREBASE_CONFIG_JSON.${field} is required.`,
  );
}
assert.equal(
  firebaseConfig.projectId,
  contract.firebaseProjectId,
  "The visual login config must use the dedicated staging Firebase project.",
);
assert.ok(
  String(firebaseConfig.authDomain).includes(contract.firebaseProjectId),
  "The visual login authDomain must belong to the staging Firebase project.",
);
assert.ok(
  String(firebaseConfig.storageBucket).includes(contract.firebaseProjectId),
  "The visual login storageBucket must belong to the staging Firebase project.",
);
for (const forbiddenProjectId of contract.networkBoundary
  .forbiddenFirebaseProjectIds) {
  assert.doesNotMatch(
    JSON.stringify(firebaseConfig),
    new RegExp(
      forbiddenProjectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "iu",
    ),
    "The visual login config contains a Production Firebase identifier.",
  );
}
const bypassSecret = String(
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
).trim();
const edgeExecutable =
  valueArg("--browser-executable") ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.equal(
  existsSync(edgeExecutable),
  true,
  "Microsoft Edge is unavailable.",
);

const git = (...gitArgs) =>
  execFileSync("git", gitArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
const fixtureAuditSha256 = sha256(fixtureAuditBytes);
assert.equal(fixtureAudit.suite, "w10p-visual-fixture-audit");
assert.equal(fixtureAudit.passed, true);
assert.equal(
  fixtureAudit.artifactSchemaVersion,
  "w10p-visual-fixture-audit-v1",
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
  "The staging fixture capture binding hash is invalid.",
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
const fixtureAuditIssuedAt = Date.parse(fixtureAudit.freshness?.issuedAt);
const fixtureAuditExpiresAt = Date.parse(fixtureAudit.freshness?.expiresAt);
assert.equal(Number.isNaN(fixtureAuditIssuedAt), false);
assert.equal(Number.isNaN(fixtureAuditExpiresAt), false);
assert.equal(fixtureAudit.freshness?.maxAgeSeconds, 3600);
assert.equal(fixtureAudit.freshness?.fixedFixtureTime, contract.fixedTime);
assert.ok(fixtureAuditIssuedAt <= Date.now() + 30_000);
assert.ok(fixtureAuditExpiresAt > Date.now());
const runnerScriptPath = contract.captureRunner.scriptPath;
assert.equal(
  git("rev-parse", "HEAD"),
  sourceCommitSha,
  "Visual capture must run from the deployed candidate commit.",
);
assert.equal(
  realpathSync(resolve(process.argv[1])),
  realpathSync(resolve(runnerScriptPath)),
  "Visual capture must execute the contract-bound runner entrypoint.",
);
const trustedInputPaths = [
  runnerScriptPath,
  "scripts/w10p-visual-parity-contract.json",
  "scripts/w10p-route-menu-inventory.json",
  "scripts/seed-w10p-visual-fixture.mjs",
  "package.json",
  "package-lock.json",
];
const trustedInputs = Object.fromEntries(
  trustedInputPaths.map((path) => {
    const runtimeBytes = readFileSync(resolve(path));
    const committedBlobSha = git("rev-parse", `${sourceCommitSha}:${path}`);
    const workingBlobSha = git("hash-object", "--path", path, path);
    assert.equal(
      workingBlobSha,
      committedBlobSha,
      `Trusted visual input differs from the candidate commit: ${path}.`,
    );
    return [
      path,
      {
        gitBlobSha: committedBlobSha,
        runtimeSha256: sha256(runtimeBytes),
      },
    ];
  }),
);
const runnerCommittedBlobSha = trustedInputs[runnerScriptPath].gitBlobSha;
const runnerRuntimeSha256 = trustedInputs[runnerScriptPath].runtimeSha256;
const trustedInputsSha256 = sha256(Buffer.from(JSON.stringify(trustedInputs)));
const viewportKey = ({ width, height }) => `${width}x${height}`;
const captureKey = (stage, screenId, viewport) =>
  `${stage}:${screenId}:${viewportKey(viewport)}`;
const comparisonKey = (screenId, viewport) =>
  `${screenId}:${viewportKey(viewport)}`;
const normalizeOrigin = (value) => new URL(value).origin;
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
assert.equal(screens.length, 69);
const screensById = new Map(screens.map((screen) => [screen.id, screen]));
const minimumViewports = new Set(contract.minimumViewportKeys);
const keyScreens = new Set(contract.keyScreenIds);
const viewportsForScreen = (screenId) =>
  contract.viewports.filter(
    (viewport) =>
      keyScreens.has(screenId) || minimumViewports.has(viewportKey(viewport)),
  );

const candidateTargets = [];
const baselineTargetsByKey = new Map();
for (const screen of screens) {
  for (const viewport of viewportsForScreen(screen.id)) {
    const candidatePrimitiveRequirements = screen.productionPresentation
      ? []
      : contract.newSurfaceRequiredPrimitives[screen.id].map((requirement) => ({
          id: requirement.id,
          selector: requirement.selector,
          tagPattern: requirement.tagPattern,
          exactCount: requirement.exactCount,
        }));
    candidateTargets.push({
      stage: "candidate",
      screen,
      viewport,
      primitiveRequirements: candidatePrimitiveRequirements,
    });
    const baselineId = screen.productionPresentation
      ? screen.id
      : contract.newSurfaceReferences[screen.id];
    const baselineScreen = screensById.get(baselineId);
    assert.ok(baselineScreen?.productionPresentation);
    const baselineKey = captureKey("baseline", baselineId, viewport);
    const baselineTarget = baselineTargetsByKey.get(baselineKey) || {
      stage: "baseline",
      screen: baselineScreen,
      viewport,
      primitiveRequirements: [],
    };
    if (!screen.productionPresentation) {
      for (const requirement of contract.newSurfaceRequiredPrimitives[
        screen.id
      ]) {
        baselineTarget.primitiveRequirements.push({
          id: `${screen.id}:${requirement.id}`,
          selector: requirement.referenceSelector,
          tagPattern: requirement.referenceTagPattern,
          exactCount: requirement.referenceExactCount,
        });
      }
    }
    baselineTargetsByKey.set(baselineKey, baselineTarget);
  }
}
const targets = [...baselineTargetsByKey.values(), ...candidateTargets].sort(
  (left, right) =>
    captureKey(left.stage, left.screen.id, left.viewport).localeCompare(
      captureKey(right.stage, right.screen.id, right.viewport),
    ),
);

mkdirSync(outputRoot, { recursive: true });
mkdirSync(resolve(outputRoot, "baseline"));
mkdirSync(resolve(outputRoot, "candidate"));
mkdirSync(resolve(outputRoot, "browser-audits"));
const fixtureAuditFileName = "fixture-audit.json";
const fixtureAuditEvidencePath = resolve(outputRoot, fixtureAuditFileName);
writeFileSync(fixtureAuditEvidencePath, fixtureAuditBytes);
assert.equal(
  sha256(readFileSync(fixtureAuditEvidencePath)),
  fixtureAuditSha256,
  "The copied fixture audit differs from its fresh input.",
);

const styleProperties = contract.layoutDiff.computedStyleProperties;
const describePage = async (
  page,
  anchorRequirements = [],
  readyRequirements = [],
  primitiveRequirements = [],
  fixtureRequirements = null,
) =>
  page.evaluate(
    async ({
      styleProperties,
      anchorRequirements,
      readyRequirements,
      primitiveRequirements,
      fixtureRequirements,
      privacyContract,
    }) => {
      const cssEscape = (value) => {
        if (globalThis.CSS?.escape) return globalThis.CSS.escape(value);
        return value.replace(
          /[^a-zA-Z0-9_-]/gu,
          (character) => `\\${character.codePointAt(0).toString(16)} `,
        );
      };
      const selectorFor = (element) => {
        if (!(element instanceof Element)) return "";
        if (element.id) return `#${cssEscape(element.id)}`;
        const parts = [];
        let current = element;
        while (current && current !== document.documentElement) {
          const parent = current.parentElement;
          if (!parent) break;
          const tag = current.tagName.toLowerCase();
          const siblings = [...parent.children].filter(
            (sibling) => sibling.tagName === current.tagName,
          );
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
          current = parent;
          if (current.id) {
            parts.unshift(`#${cssEscape(current.id)}`);
            break;
          }
        }
        return parts.join(" > ");
      };
      let pointerlessPositionedOverlaysCache = null;
      let blockingPseudoOverlaysCache = null;
      const positionedOverlayPositions = new Set([
        "absolute",
        "fixed",
        "sticky",
      ]);
      const pointerlessPositionedOverlays = () => {
        if (pointerlessPositionedOverlaysCache) {
          return pointerlessPositionedOverlaysCache;
        }
        pointerlessPositionedOverlaysCache = [
          ...document.body.querySelectorAll("*"),
        ].filter((candidate) => {
          const style = getComputedStyle(candidate);
          return (
            positionedOverlayPositions.has(style.position) &&
            style.pointerEvents === "none"
          );
        });
        return pointerlessPositionedOverlaysCache;
      };
      const blockingPseudoOverlays = () => {
        if (blockingPseudoOverlaysCache !== null) {
          return blockingPseudoOverlaysCache;
        }
        blockingPseudoOverlaysCache = [
          document.documentElement,
          document.body,
          ...document.body.querySelectorAll("*"),
        ].flatMap((candidate) =>
          ["::before", "::after"].flatMap((pseudo) => {
            const style = getComputedStyle(candidate, pseudo);
            const content = String(style.content || "").trim();
            if (
              !positionedOverlayPositions.has(style.position) ||
              ["", "none", "normal"].includes(content)
            ) {
              return [];
            }
            const insetCoversHost = [
              style.top,
              style.right,
              style.bottom,
              style.left,
            ].every((value) => {
              const parsed = Number.parseFloat(value || "0");
              return Number.isFinite(parsed) && Math.abs(parsed) <= 1;
            });
            const opacity = Number.parseFloat(style.opacity || "1");
            const paintAlpha =
              (Number.isFinite(opacity) ? opacity : 1) *
              colorAlpha(style.backgroundColor);
            const zIndex = Number.parseInt(style.zIndex || "0", 10);
            const visiblyPainted =
              paintAlpha >= 0.5 ||
              ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                style.backgroundImage &&
                style.backgroundImage !== "none");
            if (
              !insetCoversHost ||
              !visiblyPainted ||
              !Number.isFinite(zIndex) ||
              zIndex < 100
            ) {
              return [];
            }
            return [
              { host: candidate, pseudo, position: style.position, zIndex },
            ];
          }),
        );
        return blockingPseudoOverlaysCache;
      };
      const visibilityFor = (element) => {
        if (!(element instanceof Element)) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: 0, y: 0, width: 0, height: 0 },
          };
        }
        const own = element.getBoundingClientRect();
        if (own.width <= 0 || own.height <= 0) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: own.x, y: own.y, width: 0, height: 0 },
          };
        }
        if (
          typeof element.checkVisibility === "function" &&
          !element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          })
        ) {
          return {
            visible: false,
            areaRatio: 0,
            effectiveOpacity: 0,
            paintVisibilityRatio: 0,
            box: { x: own.x, y: own.y, width: 0, height: 0 },
          };
        }
        let left = Math.max(0, own.left);
        let right = Math.min(window.innerWidth, own.right);
        let top = Math.max(-window.scrollY, own.top);
        let bottom = Math.min(
          document.documentElement.scrollHeight - window.scrollY,
          own.bottom,
        );
        let current = element;
        let effectiveOpacity = 1;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const opacity = Number.parseFloat(style.opacity || "1");
          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            effectiveOpacity < 0.9 ||
            (style.clipPath && style.clipPath !== "none")
          ) {
            return {
              visible: false,
              areaRatio: 0,
              effectiveOpacity,
              paintVisibilityRatio: 0,
              box: { x: own.x, y: own.y, width: 0, height: 0 },
            };
          }
          if (current !== element) {
            const clipBox = current.getBoundingClientRect();
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowX)
            ) {
              left = Math.max(left, clipBox.left);
              right = Math.min(right, clipBox.right);
            }
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowY)
            ) {
              top = Math.max(top, clipBox.top);
              bottom = Math.min(bottom, clipBox.bottom);
            }
          }
          current = current.parentElement;
        }
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        const areaRatio = (width * height) / (own.width * own.height);
        const sampleIsPaintVisible = ([x, y]) => {
          const stack = document.elementsFromPoint(x, y);
          const targetIndex = stack.findIndex(
            (candidate) => candidate === element || element.contains(candidate),
          );
          if (targetIndex < 0) return false;
          const positionedDescendantOccludes = stack
            .slice(0, targetIndex + 1)
            .some((candidate) => {
              if (candidate === element || !element.contains(candidate)) {
                return false;
              }
              const style = getComputedStyle(candidate);
              if (!positionedOverlayPositions.has(style.position)) {
                return false;
              }
              const opacity = Number.parseFloat(style.opacity || "1");
              const paintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                paintAlpha >= 0.5 ||
                ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                  style.backgroundImage &&
                  style.backgroundImage !== "none")
              );
            });
          if (positionedDescendantOccludes) return false;
          const stackOccludes = stack
            .slice(0, targetIndex)
            .some((candidate) => {
              if (element.contains(candidate)) return false;
              const style = getComputedStyle(candidate);
              const opacity = Number.parseFloat(style.opacity || "1");
              const effectivePaintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                effectivePaintAlpha >= 0.5 ||
                ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                  style.backgroundImage &&
                  style.backgroundImage !== "none")
              );
            });
          if (stackOccludes) return false;
          const targetZIndex = Number.parseInt(
            getComputedStyle(element).zIndex || "0",
            10,
          );
          const pointerlessPositionedOverlay =
            pointerlessPositionedOverlays().some((candidate) => {
              if (candidate === element || candidate.contains(element)) {
                return false;
              }
              const style = getComputedStyle(candidate);
              if (
                !positionedOverlayPositions.has(style.position) ||
                style.pointerEvents !== "none"
              ) {
                return false;
              }
              const box = candidate.getBoundingClientRect();
              if (
                x < box.left ||
                x > box.right ||
                y < box.top ||
                y > box.bottom
              ) {
                return false;
              }
              const opacity = Number.parseFloat(style.opacity || "1");
              const zIndex = Number.parseInt(style.zIndex || "0", 10);
              const paintAlpha =
                (Number.isFinite(opacity) ? opacity : 1) *
                colorAlpha(style.backgroundColor);
              return (
                (Number.isFinite(zIndex) ? zIndex : 0) >=
                  (Number.isFinite(targetZIndex) ? targetZIndex : 0) &&
                (paintAlpha >= 0.5 ||
                  ((Number.isFinite(opacity) ? opacity : 1) >= 0.5 &&
                    style.backgroundImage &&
                    style.backgroundImage !== "none"))
              );
            });
          if (pointerlessPositionedOverlay) return false;
          const pseudoOverlay = blockingPseudoOverlays().some((overlay) => {
            const box =
              overlay.position === "fixed"
                ? {
                    left: 0,
                    top: 0,
                    right: window.innerWidth,
                    bottom: window.innerHeight,
                  }
                : overlay.host.getBoundingClientRect();
            if (
              x < box.left ||
              x > box.right ||
              y < box.top ||
              y > box.bottom
            ) {
              return false;
            }
            return (
              overlay.zIndex >=
              (Number.isFinite(targetZIndex) ? targetZIndex : 0)
            );
          });
          return !pseudoOverlay;
        };
        const hitTest = () => {
          const box = element.getBoundingClientRect();
          const sampleLeft = Math.max(0, box.left);
          const sampleRight = Math.min(window.innerWidth, box.right);
          const sampleTop = Math.max(0, box.top);
          const sampleBottom = Math.min(window.innerHeight, box.bottom);
          const sampleWidth = Math.max(0, sampleRight - sampleLeft);
          const sampleHeight = Math.max(0, sampleBottom - sampleTop);
          if (sampleWidth <= 0 || sampleHeight <= 0) return 0;
          const insetX = Math.min(2, sampleWidth / 4);
          const insetY = Math.min(2, sampleHeight / 4);
          const samplePoints = [
            [sampleLeft + sampleWidth / 2, sampleTop + sampleHeight / 2],
            [sampleLeft + insetX, sampleTop + insetY],
            [sampleRight - insetX, sampleTop + insetY],
            [sampleLeft + insetX, sampleBottom - insetY],
            [sampleRight - insetX, sampleBottom - insetY],
          ];
          return (
            samplePoints.filter(sampleIsPaintVisible).length /
            samplePoints.length
          );
        };
        const savedScroll = { x: window.scrollX, y: window.scrollY };
        let paintVisibilityRatio = hitTest();
        if (paintVisibilityRatio === 0 && areaRatio >= 0.9) {
          const documentTop = own.top + savedScroll.y;
          const targetScrollY = Math.max(
            0,
            Math.min(
              document.documentElement.scrollHeight - window.innerHeight,
              documentTop - Math.max(16, (window.innerHeight - own.height) / 2),
            ),
          );
          window.scrollTo(savedScroll.x, targetScrollY);
          paintVisibilityRatio = hitTest();
          window.scrollTo(savedScroll.x, savedScroll.y);
        }
        return {
          visible:
            areaRatio >= 0.9 &&
            effectiveOpacity >= 0.9 &&
            paintVisibilityRatio >= 0.6,
          areaRatio,
          effectiveOpacity,
          paintVisibilityRatio,
          box: { x: left, y: top, width, height },
        };
      };
      const colorAlpha = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (!normalized || normalized === "transparent") return 0;
        const rgba = normalized.match(
          /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
        );
        if (rgba) return Number.parseFloat(rgba[1]);
        const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
        if (!modern) return 1;
        const parsed = Number.parseFloat(modern[1]);
        return modern[2] ? parsed / 100 : parsed;
      };
      const colorRgb = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        const srgb = normalized.match(
          /^color\(srgb\s+([-+]?[0-9.]+)\s+([-+]?[0-9.]+)\s+([-+]?[0-9.]+)/u,
        );
        if (srgb) {
          return srgb
            .slice(1, 4)
            .map((component) =>
              Math.max(0, Math.min(255, Number(component) * 255)),
            );
        }
        if (normalized.startsWith("color(")) return null;
        const rgb = normalized.match(/^rgba?\(([^)]*)\)$/u);
        if (!rgb) return null;
        const channelPart = rgb[1].split("/")[0];
        const channels = channelPart
          .trim()
          .split(/[\s,]+/u)
          .filter(Boolean)
          .slice(0, 3);
        if (channels.length !== 3) return null;
        const components = channels.map((channel) => {
          const percentage = channel.endsWith("%");
          const parsed = Number.parseFloat(channel);
          if (!Number.isFinite(parsed)) return Number.NaN;
          const component = percentage ? (parsed / 100) * 255 : parsed;
          return Math.max(0, Math.min(255, component));
        });
        return components.every(Number.isFinite) ? components : null;
      };
      const luminance = (rgb) => {
        const linear = rgb.map((component) => {
          const channel = component / 255;
          return channel <= 0.03928
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };
      const contrastRatio = (foreground, background) => {
        const foregroundLuminance = luminance(foreground);
        const backgroundLuminance = luminance(background);
        return (
          (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
          (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
        );
      };
      const compositeRgb = (foreground, background, alpha) =>
        foreground.map(
          (component, index) =>
            component * alpha + background[index] * (1 - alpha),
        );
      const splitCssLayers = (value) => {
        const layers = [];
        let depth = 0;
        let start = 0;
        for (let index = 0; index < value.length; index += 1) {
          if (value[index] === "(") depth += 1;
          if (value[index] === ")") depth -= 1;
          if (value[index] === "," && depth === 0) {
            layers.push(value.slice(start, index).trim());
            start = index + 1;
          }
        }
        layers.push(value.slice(start).trim());
        return layers.filter(Boolean);
      };
      const gradientStopsFor = (value) => {
        if (
          !/^(?:repeating-)?(?:linear|radial|conic)-gradient\(/u.test(value) ||
          /url\(/u.test(value)
        ) {
          return null;
        }
        const colors = [...value.matchAll(/rgba?\([^)]*\)/gu)]
          .map((match) => ({
            rgb: colorRgb(match[0]),
            alpha: colorAlpha(match[0]),
          }))
          .filter((color) => color.rgb);
        return colors.length >= 2 ? colors : null;
      };
      const compositeCandidates = (backgrounds, overlays) => {
        const unique = new Map();
        for (const background of backgrounds) {
          for (const overlay of overlays) {
            const rgb = compositeRgb(overlay.rgb, background, overlay.alpha);
            const key = rgb.map((value) => value.toFixed(2)).join(":");
            unique.set(key, rgb);
            if (unique.size > 512) return null;
          }
        }
        return [...unique.values()];
      };
      const resolvedBackgroundFor = (element) => {
        const ancestry = [];
        let unresolvedImage = false;
        let current = element;
        while (current instanceof Element) {
          ancestry.push(current);
          current = current.parentElement;
        }
        let rgbCandidates = [[255, 255, 255]];
        for (const layerElement of ancestry.reverse()) {
          const style = getComputedStyle(layerElement);
          const solidRgb = colorRgb(style.backgroundColor);
          const solidAlpha = colorAlpha(style.backgroundColor);
          if (solidRgb && solidAlpha > 0) {
            const composited = compositeCandidates(rgbCandidates, [
              { rgb: solidRgb, alpha: solidAlpha },
            ]);
            if (!composited) unresolvedImage = true;
            else rgbCandidates = composited;
          }
          if (style.backgroundImage && style.backgroundImage !== "none") {
            const imageLayers = splitCssLayers(style.backgroundImage);
            for (const imageLayer of imageLayers.reverse()) {
              const stops = gradientStopsFor(imageLayer);
              if (!stops) {
                unresolvedImage = true;
                continue;
              }
              const composited = compositeCandidates(rgbCandidates, stops);
              if (!composited) unresolvedImage = true;
              else rgbCandidates = composited;
            }
          }
        }
        if (element instanceof SVGTextElement) {
          const svgStops = [];
          const svg = element.closest("svg");
          for (const stop of svg?.querySelectorAll("defs stop") ?? []) {
            const stopStyle = getComputedStyle(stop);
            const stopColor =
              stopStyle.stopColor || stop.getAttribute("stop-color");
            const stopOpacity = Number.parseFloat(
              stopStyle.stopOpacity || stop.getAttribute("stop-opacity") || "1",
            );
            const rgb = colorRgb(stopColor);
            const alpha =
              colorAlpha(stopColor) *
              (Number.isFinite(stopOpacity) ? stopOpacity : 1);
            if (rgb) svgStops.push({ rgb, alpha });
          }
          if (svgStops.length > 0) {
            const composited = compositeCandidates(rgbCandidates, svgStops);
            if (!composited) unresolvedImage = true;
            else rgbCandidates = composited;
          }
        }
        return { rgbCandidates, resolved: !unresolvedImage };
      };
      const paintEffectsSafeFor = (element) => {
        let current = element;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const filter = String(style.filter || "none").toLowerCase();
          const maskImage = String(
            style.maskImage || style.webkitMaskImage || "none",
          ).toLowerCase();
          const blendMode = String(
            style.mixBlendMode || "normal",
          ).toLowerCase();
          if (
            /(?:opacity|blur|brightness|contrast)\(/u.test(filter) ||
            maskImage !== "none" ||
            blendMode !== "normal"
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const glyphVisibleRatioFor = (element) => {
        if (!(element instanceof Element)) return 0;
        const own = element.getBoundingClientRect();
        if (own.width <= 0 || own.height <= 0) return 0;
        const style = getComputedStyle(element);
        const textIndent = Number.parseFloat(style.textIndent || "0");
        if (
          Number.isFinite(textIndent) &&
          Math.abs(textIndent) >= Math.max(8, own.width)
        ) {
          return 0;
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return String(element.value || "").trim() ||
            (element instanceof HTMLSelectElement &&
              element.selectedOptions.length > 0)
            ? 1
            : 0;
        }
        const directTextNodes = [...element.childNodes].filter(
          (node) =>
            node.nodeType === Node.TEXT_NODE &&
            String(node.textContent || "").trim().length > 0,
        );
        if (directTextNodes.length === 0) return 0;
        const clipRectFor = (rect) => {
          let left = Math.max(rect.left, own.left);
          let right = Math.min(rect.right, own.right);
          let top = Math.max(rect.top, own.top);
          let bottom = Math.min(rect.bottom, own.bottom);
          let current = element;
          while (current instanceof Element) {
            const currentStyle = getComputedStyle(current);
            const currentBox = current.getBoundingClientRect();
            if (
              ["auto", "clip", "hidden", "scroll"].includes(
                currentStyle.overflowX,
              )
            ) {
              left = Math.max(left, currentBox.left);
              right = Math.min(right, currentBox.right);
            }
            if (
              ["auto", "clip", "hidden", "scroll"].includes(
                currentStyle.overflowY,
              )
            ) {
              top = Math.max(top, currentBox.top);
              bottom = Math.min(bottom, currentBox.bottom);
            }
            current = current.parentElement;
          }
          return {
            visibleArea: Math.max(0, right - left) * Math.max(0, bottom - top),
            totalArea: Math.max(0, rect.width) * Math.max(0, rect.height),
          };
        };
        let visibleArea = 0;
        let totalArea = 0;
        for (const node of directTextNodes) {
          const range = document.createRange();
          range.selectNodeContents(node);
          let rects = [...range.getClientRects()];
          range.detach();
          if (rects.length === 0 && element instanceof SVGTextElement) {
            rects = [own];
          }
          for (const rect of rects) {
            const clipped = clipRectFor(rect);
            visibleArea += clipped.visibleArea;
            totalArea += clipped.totalArea;
          }
        }
        return totalArea > 0 ? Math.min(1, visibleArea / totalArea) : 0;
      };
      const textPaintFor = (element, minimumContrastRatio = null) => {
        if (!(element instanceof Element)) {
          return {
            painted: false,
            fontSizePx: 0,
            foregroundAlpha: 0,
            contrastRatio: 0,
            glyphVisibleRatio: 0,
            effectsSafe: false,
          };
        }
        const style = getComputedStyle(element);
        const fontSizePx = Number.parseFloat(style.fontSize || "0");
        const fontWeight = Number.parseFloat(style.fontWeight || "400");
        const requiredContrastRatio = Number.isFinite(minimumContrastRatio)
          ? minimumContrastRatio
          : fontSizePx >= 24 ||
              (fontSizePx >= 18.66 &&
                Number.isFinite(fontWeight) &&
                fontWeight >= 700)
            ? 3
            : 4.5;
        const foregroundColor =
          element instanceof SVGTextElement
            ? style.fill
            : style.webkitTextFillColor || style.color;
        const foregroundAlpha = Math.min(
          colorAlpha(foregroundColor),
          element instanceof SVGTextElement
            ? Number.parseFloat(style.fillOpacity || "1")
            : colorAlpha(style.color),
        );
        const foregroundRgb = colorRgb(foregroundColor);
        const background = resolvedBackgroundFor(element);
        const measuredContrast =
          foregroundRgb && background.resolved
            ? Math.min(
                ...background.rgbCandidates.map((backgroundRgb) =>
                  contrastRatio(
                    compositeRgb(foregroundRgb, backgroundRgb, foregroundAlpha),
                    backgroundRgb,
                  ),
                ),
              )
            : 0;
        const glyphVisibleRatio = glyphVisibleRatioFor(element);
        const effectsSafe = paintEffectsSafeFor(element);
        return {
          painted:
            Number.isFinite(fontSizePx) &&
            fontSizePx >= 8 &&
            foregroundAlpha >= 0.9 &&
            measuredContrast >= requiredContrastRatio &&
            glyphVisibleRatio >= 0.6 &&
            effectsSafe,
          fontSizePx,
          foregroundAlpha,
          contrastRatio: measuredContrast,
          requiredContrastRatio,
          glyphVisibleRatio,
          effectsSafe,
        };
      };
      const canvasPaintFor = (element) => {
        if (!(element instanceof HTMLCanvasElement)) {
          return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
        }
        try {
          const context = element.getContext("2d", {
            willReadFrequently: true,
          });
          if (!context || element.width <= 0 || element.height <= 0) {
            return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
          }
          const pixels = context.getImageData(
            0,
            0,
            element.width,
            element.height,
          ).data;
          const pixelCount = element.width * element.height;
          const stride = Math.max(1, Math.floor(pixelCount / 8192));
          let sampledOpaquePixels = 0;
          const sampledColors = new Set();
          for (let index = 0; index < pixels.length; index += 4 * stride) {
            if (pixels[index + 3] < 64) continue;
            sampledOpaquePixels += 1;
            sampledColors.add(
              `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}:${pixels[index + 3]}`,
            );
            if (sampledColors.size > 32) break;
          }
          return {
            painted: sampledOpaquePixels >= 8 && sampledColors.size >= 2,
            sampledOpaquePixels,
            sampledColors: sampledColors.size,
          };
        } catch {
          return { painted: false, sampledOpaquePixels: 0, sampledColors: 0 };
        }
      };
      const describe = (element, { minimumContrastRatio = null } = {}) => {
        if (!(element instanceof Element)) return { present: false };
        const box = element.getBoundingClientRect();
        const computedStyle = getComputedStyle(element);
        const visibility = visibilityFor(element);
        const textPaint = textPaintFor(element, minimumContrastRatio);
        const canvasPaint = canvasPaintFor(element);
        return {
          present: true,
          selector: selectorFor(element),
          tagName: element.tagName,
          box: {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
          visibleAreaRatio: visibility.areaRatio,
          effectiveOpacity: visibility.effectiveOpacity,
          paintVisibilityRatio: visibility.paintVisibilityRatio,
          visibleBox: visibility.box,
          textPainted: textPaint.painted,
          textFontSizePx: textPaint.fontSizePx,
          textForegroundAlpha: textPaint.foregroundAlpha,
          textContrastRatio: textPaint.contrastRatio,
          textRequiredContrastRatio: textPaint.requiredContrastRatio,
          textGlyphVisibleRatio: textPaint.glyphVisibleRatio,
          textPaintEffectsSafe: textPaint.effectsSafe,
          canvasPainted: canvasPaint.painted,
          canvasSampledOpaquePixels: canvasPaint.sampledOpaquePixels,
          canvasSampledColors: canvasPaint.sampledColors,
          computed: Object.fromEntries(
            styleProperties.map((property) => [
              property,
              computedStyle[property] || "",
            ]),
          ),
        };
      };
      const contentRoot =
        document.querySelector("#main-content") ||
        document.querySelector("main") ||
        document.querySelector("#root > div") ||
        document.body;
      const firstVisible = (selector, root = document) =>
        [...root.querySelectorAll(selector)].find(
          (element) => visibilityFor(element).visible,
        ) || null;
      const isVisible = (element) => visibilityFor(element).visible;
      const isRendered = (element) => {
        if (!(element instanceof Element)) return false;
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        let current = element;
        let effectiveOpacity = 1;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const opacity = Number.parseFloat(style.opacity || "1");
          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            effectiveOpacity < 0.9
          ) {
            return false;
          }
          current = current.parentElement;
        }
        return true;
      };
      const readableText = (element) => {
        if (element instanceof HTMLSelectElement) {
          return `${String(element.value || "")} ${[...element.selectedOptions]
            .map((option) => option.textContent || "")
            .join(" ")}`
            .replace(/\s+/gu, " ")
            .trim();
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return String(element.value || "")
            .replace(/\s+/gu, " ")
            .trim();
        }
        return String(element.innerText || element.textContent || "")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const directPaintText = (element) => {
        if (
          element instanceof HTMLSelectElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return readableText(element);
        }
        return [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const paintWitnessFor = (
        container,
        pattern,
        { allowRendered = false, minimumContrastRatio = null } = {},
      ) => {
        if (!(container instanceof Element)) return null;
        const candidates = [container, ...container.querySelectorAll("*")]
          .filter((element) => {
            const rendered = allowRendered
              ? isRendered(element)
              : isVisible(element);
            return (
              rendered &&
              pattern.test(directPaintText(element)) &&
              textPaintFor(element, minimumContrastRatio).painted
            );
          })
          .sort((left, right) => {
            const leftBox = left.getBoundingClientRect();
            const rightBox = right.getBoundingClientRect();
            return (
              leftBox.width * leftBox.height - rightBox.width * rightBox.height
            );
          });
        return candidates[0] || null;
      };
      const elements = {
        header: describe(document.querySelector("#root > div > header")),
        content: describe(contentRoot),
        desktopNavigation: describe(firstVisible(".desktop-nav")),
        mobileNavigationTrigger: describe(firstVisible(".mobile-menu-btn")),
        table: describe(firstVisible("table", contentRoot)),
        firstTableRow: describe(firstVisible("table tr", contentRoot)),
        primaryButton: describe(firstVisible("button, a", contentRoot)),
      };
      const pickAnchor = (requirement) => {
        const pattern = requirement.textPattern
          ? new RegExp(requirement.textPattern, "u")
          : null;
        const selectors =
          requirement.selector ||
          (requirement.id === "heading"
            ? "h1, h2, h3"
            : requirement.id === "primary-action"
              ? "button, a"
              : "section, article, form, table, [role='status'], p, div");
        const candidates = [...contentRoot.querySelectorAll(selectors)].filter(
          (element) => {
            const text = readableText(element);
            const paintReady =
              requirement.paintMode === "canvas"
                ? canvasPaintFor(element).painted
                : !pattern ||
                  Boolean(
                    paintWitnessFor(element, pattern, {
                      minimumContrastRatio: requirement.minimumContrastRatio,
                    }),
                  );
            return (
              isVisible(element) &&
              paintReady &&
              (requirement.allowEmptyText || text.length > 0) &&
              (!pattern || pattern.test(text))
            );
          },
        );
        if (requirement.id === "content" || requirement.preferSmallest) {
          candidates.sort((left, right) => {
            const leftBox = left.getBoundingClientRect();
            const rightBox = right.getBoundingClientRect();
            return (
              leftBox.width * leftBox.height - rightBox.width * rightBox.height
            );
          });
        }
        return candidates[0] || null;
      };
      const anchorIds = ["heading", "content", "primary-action"];
      const requirementsById = new Map(
        anchorRequirements.map((requirement) => [requirement.id, requirement]),
      );
      const anchors = {};
      for (const id of anchorIds) {
        const requirement = requirementsById.get(id) || { id };
        const element = pickAnchor(requirement);
        if (!element) continue;
        const described = describe(element, {
          minimumContrastRatio: requirement.minimumContrastRatio,
        });
        const paintPattern = requirement.textPattern
          ? new RegExp(requirement.textPattern, "u")
          : null;
        const paintWitness = paintPattern
          ? paintWitnessFor(element, paintPattern, {
              minimumContrastRatio: requirement.minimumContrastRatio,
            })
          : element;
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
        });
        anchors[id] = {
          selector: described.selector,
          tagName: described.tagName,
          box: described.box,
          visibleAreaRatio: described.visibleAreaRatio,
          effectiveOpacity: described.effectiveOpacity,
          paintVisibilityRatio: described.paintVisibilityRatio,
          visibleBox: described.visibleBox,
          textPainted: described.textPainted,
          textFontSizePx: described.textFontSizePx,
          textForegroundAlpha: described.textForegroundAlpha,
          textContrastRatio: described.textContrastRatio,
          textRequiredContrastRatio: described.textRequiredContrastRatio,
          textGlyphVisibleRatio: described.textGlyphVisibleRatio,
          textPaintEffectsSafe: described.textPaintEffectsSafe,
          canvasPainted: described.canvasPainted,
          canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
          canvasSampledColors: described.canvasSampledColors,
          paintWitness: describedPaintWitness.present
            ? {
                selector: describedPaintWitness.selector,
                tagName: describedPaintWitness.tagName,
                effectiveOpacity: describedPaintWitness.effectiveOpacity,
                paintVisibilityRatio:
                  describedPaintWitness.paintVisibilityRatio,
                visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                textPainted: describedPaintWitness.textPainted,
                textFontSizePx: describedPaintWitness.textFontSizePx,
                textForegroundAlpha: describedPaintWitness.textForegroundAlpha,
                textContrastRatio: describedPaintWitness.textContrastRatio,
                textRequiredContrastRatio:
                  describedPaintWitness.textRequiredContrastRatio,
                textGlyphVisibleRatio:
                  describedPaintWitness.textGlyphVisibleRatio,
                textPaintEffectsSafe:
                  describedPaintWitness.textPaintEffectsSafe,
                text: directPaintText(paintWitness),
              }
            : null,
          computed: described.computed,
          text: readableText(element),
        };
      }
      const readySignals = {};
      for (const requirement of readyRequirements) {
        const element = pickAnchor({ ...requirement, preferSmallest: true });
        if (!element) continue;
        const described = describe(element, {
          minimumContrastRatio: requirement.minimumContrastRatio,
        });
        const paintPattern = new RegExp(requirement.textPattern, "u");
        const paintWitness =
          requirement.paintMode === "canvas"
            ? null
            : paintWitnessFor(element, paintPattern, {
                minimumContrastRatio: requirement.minimumContrastRatio,
              });
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
        });
        readySignals[requirement.id] = {
          selector: described.selector,
          tagName: described.tagName,
          box: described.box,
          visibleAreaRatio: described.visibleAreaRatio,
          effectiveOpacity: described.effectiveOpacity,
          paintVisibilityRatio: described.paintVisibilityRatio,
          visibleBox: described.visibleBox,
          textPainted: described.textPainted,
          textFontSizePx: described.textFontSizePx,
          textForegroundAlpha: described.textForegroundAlpha,
          textContrastRatio: described.textContrastRatio,
          textRequiredContrastRatio: described.textRequiredContrastRatio,
          textGlyphVisibleRatio: described.textGlyphVisibleRatio,
          textPaintEffectsSafe: described.textPaintEffectsSafe,
          canvasPainted: described.canvasPainted,
          canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
          canvasSampledColors: described.canvasSampledColors,
          paintWitness: describedPaintWitness.present
            ? {
                selector: describedPaintWitness.selector,
                tagName: describedPaintWitness.tagName,
                effectiveOpacity: describedPaintWitness.effectiveOpacity,
                paintVisibilityRatio:
                  describedPaintWitness.paintVisibilityRatio,
                visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                textPainted: describedPaintWitness.textPainted,
                textFontSizePx: describedPaintWitness.textFontSizePx,
                textForegroundAlpha: describedPaintWitness.textForegroundAlpha,
                textContrastRatio: describedPaintWitness.textContrastRatio,
                textRequiredContrastRatio:
                  describedPaintWitness.textRequiredContrastRatio,
                textGlyphVisibleRatio:
                  describedPaintWitness.textGlyphVisibleRatio,
                textPaintEffectsSafe:
                  describedPaintWitness.textPaintEffectsSafe,
                text: directPaintText(paintWitness),
              }
            : null,
          computed: described.computed,
          text: readableText(element),
        };
      }
      const primitives = {};
      for (const requirement of primitiveRequirements) {
        const matches = [
          ...document.querySelectorAll(requirement.selector),
        ].filter(requirement.countMode === "rendered" ? isRendered : isVisible);
        primitives[requirement.id] = {
          selector: requirement.selector,
          matchCount: matches.length,
          items: matches.map((element) => {
            const described = describe(element);
            const paintWitness = paintWitnessFor(element, /.+/u);
            const describedPaintWitness = describe(paintWitness);
            return {
              selector: described.selector,
              tagName: described.tagName,
              box: described.box,
              visibleAreaRatio: described.visibleAreaRatio,
              effectiveOpacity: described.effectiveOpacity,
              paintVisibilityRatio: described.paintVisibilityRatio,
              visibleBox: described.visibleBox,
              textPainted: described.textPainted,
              textFontSizePx: described.textFontSizePx,
              textForegroundAlpha: described.textForegroundAlpha,
              textContrastRatio: described.textContrastRatio,
              textRequiredContrastRatio: described.textRequiredContrastRatio,
              textGlyphVisibleRatio: described.textGlyphVisibleRatio,
              textPaintEffectsSafe: described.textPaintEffectsSafe,
              canvasPainted: described.canvasPainted,
              canvasSampledOpaquePixels: described.canvasSampledOpaquePixels,
              canvasSampledColors: described.canvasSampledColors,
              paintWitness: describedPaintWitness.present
                ? {
                    selector: describedPaintWitness.selector,
                    tagName: describedPaintWitness.tagName,
                    effectiveOpacity: describedPaintWitness.effectiveOpacity,
                    paintVisibilityRatio:
                      describedPaintWitness.paintVisibilityRatio,
                    visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                    textPainted: describedPaintWitness.textPainted,
                    textFontSizePx: describedPaintWitness.textFontSizePx,
                    textForegroundAlpha:
                      describedPaintWitness.textForegroundAlpha,
                    textContrastRatio: describedPaintWitness.textContrastRatio,
                    textRequiredContrastRatio:
                      describedPaintWitness.textRequiredContrastRatio,
                    textGlyphVisibleRatio:
                      describedPaintWitness.textGlyphVisibleRatio,
                    textPaintEffectsSafe:
                      describedPaintWitness.textPaintEffectsSafe,
                    text: directPaintText(paintWitness),
                  }
                : null,
              computed: described.computed,
              text: readableText(element),
            };
          }),
        };
      }
      const sha256Text = async (value) => {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(String(value || "")),
        );
        return [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      };
      const fixtureAssertions = {};
      const fixtureItemTexts = [];
      for (const requirement of fixtureRequirements?.items ?? []) {
        const pattern = new RegExp(requirement.textPattern, "u");
        const matches = [
          ...document.querySelectorAll(requirement.selector),
        ].filter((element) => {
          const rendered =
            requirement.countMode === "rendered"
              ? isRendered(element)
              : isVisible(element);
          return (
            rendered &&
            Boolean(
              paintWitnessFor(element, pattern, {
                allowRendered: requirement.countMode === "rendered",
                minimumContrastRatio: requirement.minimumContrastRatio,
              }),
            )
          );
        });
        const items = [];
        for (const element of matches) {
          const text = readableText(element);
          fixtureItemTexts.push(text);
          const described = describe(element, {
            minimumContrastRatio: requirement.minimumContrastRatio,
          });
          const paintWitness = paintWitnessFor(element, pattern, {
            minimumContrastRatio: requirement.minimumContrastRatio,
          });
          const describedPaintWitness = describe(paintWitness, {
            minimumContrastRatio: requirement.minimumContrastRatio,
          });
          items.push({
            selector: described.selector,
            tagName: described.tagName,
            visibleAreaRatio: described.visibleAreaRatio,
            effectiveOpacity: described.effectiveOpacity,
            paintVisibilityRatio: described.paintVisibilityRatio,
            visibleBox: described.visibleBox,
            textPainted: described.textPainted,
            textFontSizePx: described.textFontSizePx,
            textForegroundAlpha: described.textForegroundAlpha,
            textContrastRatio: described.textContrastRatio,
            textRequiredContrastRatio: described.textRequiredContrastRatio,
            textGlyphVisibleRatio: described.textGlyphVisibleRatio,
            textPaintEffectsSafe: described.textPaintEffectsSafe,
            paintWitness: describedPaintWitness.present
              ? {
                  selector: describedPaintWitness.selector,
                  tagName: describedPaintWitness.tagName,
                  effectiveOpacity: describedPaintWitness.effectiveOpacity,
                  paintVisibilityRatio:
                    describedPaintWitness.paintVisibilityRatio,
                  visibleAreaRatio: describedPaintWitness.visibleAreaRatio,
                  textPainted: describedPaintWitness.textPainted,
                  textFontSizePx: describedPaintWitness.textFontSizePx,
                  textForegroundAlpha:
                    describedPaintWitness.textForegroundAlpha,
                  textContrastRatio: describedPaintWitness.textContrastRatio,
                  textRequiredContrastRatio:
                    describedPaintWitness.textRequiredContrastRatio,
                  textGlyphVisibleRatio:
                    describedPaintWitness.textGlyphVisibleRatio,
                  textPaintEffectsSafe:
                    describedPaintWitness.textPaintEffectsSafe,
                  textSha256: await sha256Text(directPaintText(paintWitness)),
                  textMatches: pattern.test(directPaintText(paintWitness)),
                }
              : null,
            textSha256: await sha256Text(text),
            textMatches: pattern.test(text),
            optionCount:
              element instanceof HTMLSelectElement
                ? element.options.length
                : null,
          });
        }
        fixtureAssertions[requirement.id] = {
          selector: requirement.selector,
          matchCount: matches.length,
          items,
        };
      }
      const contentText = `${String(
        contentRoot.innerText || contentRoot.textContent || "",
      )} ${[...contentRoot.querySelectorAll("input, textarea, select")]
        .filter(isVisible)
        .map((element) => readableText(element))
        .join(" ")}`
        .replace(/\s+/gu, " ")
        .trim();
      const observedEmails = [
        ...new Set(
          [
            ...contentText.matchAll(
              /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gu,
            ),
          ].map((match) => match[0].toLowerCase()),
        ),
      ].sort();
      const allowedEmailSet = new Set(
        privacyContract.allowedVisibleEmails.map((email) =>
          email.toLowerCase(),
        ),
      );
      const observedEmailSha256s = [];
      const unexpectedEmailSha256s = [];
      for (const email of observedEmails) {
        const emailHash = await sha256Text(email);
        observedEmailSha256s.push(emailHash);
        if (!allowedEmailSet.has(email)) unexpectedEmailSha256s.push(emailHash);
      }
      const forbiddenPatternMatchCounts = {};
      for (const [id, source] of Object.entries(
        privacyContract.forbiddenVisibleTextPatterns,
      )) {
        forbiddenPatternMatchCounts[id] = [
          ...contentText.matchAll(new RegExp(source, "gu")),
        ].length;
      }
      const personPattern = new RegExp(
        privacyContract.personLabelPattern,
        "gu",
      );
      const personLabels = [
        ...new Set(
          fixtureItemTexts.flatMap((text) =>
            [...text.matchAll(personPattern)].map((match) => match[0]),
          ),
        ),
      ].sort();
      const allowedPersonLabels = new Set(
        fixtureRequirements?.allowedPersonLabels ?? [],
      );
      const unexpectedPersonLabels = personLabels.filter(
        (label) => !allowedPersonLabels.has(label),
      );
      const firstRow = firstVisible("table tr", contentRoot);
      return {
        finalUrl: location.href,
        performanceNavigationUrl:
          performance.getEntriesByType("navigation")[0]?.name || location.href,
        documentReadyState: document.readyState,
        elements,
        anchors,
        readySignals,
        primitives,
        fixtureEvidence: {
          assertions: fixtureAssertions,
          privacy: {
            contentTextSha256: await sha256Text(contentText),
            observedEmailSha256s,
            unexpectedEmailSha256s,
            forbiddenPatternMatchCounts,
            personLabels,
            unexpectedPersonLabels,
          },
        },
        dom: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          overflowX:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          tableCount: contentRoot.querySelectorAll("table").length,
          buttonCount: contentRoot.querySelectorAll("button").length,
          tableColumnWidths: firstRow
            ? [...firstRow.querySelectorAll("th, td")].map(
                (cell) => cell.getBoundingClientRect().width,
              )
            : [],
        },
      };
    },
    {
      styleProperties,
      anchorRequirements,
      readyRequirements,
      primitiveRequirements,
      fixtureRequirements,
      privacyContract: contract.fixturePrivacy,
    },
  );

const waitForScreenReady = async (page, screenId) => {
  const readiness = contract.screenReadyStates[screenId];
  assert.ok(readiness, `Missing ready-state contract for ${screenId}.`);
  assert.ok(Array.isArray(readiness.signals) && readiness.signals.length > 0);
  const waitInput = {
    signals: readiness.signals,
    blockingTextPattern: contract.readiness.blockingVisibleTextPattern,
  };
  await page.waitForFunction(
    ({ signals, blockingTextPattern }) => {
      const contentRoot =
        document.querySelector("#main-content") ||
        document.querySelector("main") ||
        document.querySelector("#root > div") ||
        document.body;
      const visible = (element) => {
        const own = element.getBoundingClientRect();
        if (own.width <= 0 || own.height <= 0) return false;
        if (
          typeof element.checkVisibility === "function" &&
          !element.checkVisibility({
            checkOpacity: true,
            checkVisibilityCSS: true,
          })
        ) {
          return false;
        }
        let left = Math.max(0, own.left);
        let right = Math.min(window.innerWidth, own.right);
        let top = Math.max(-window.scrollY, own.top);
        let bottom = Math.min(
          document.documentElement.scrollHeight - window.scrollY,
          own.bottom,
        );
        let current = element;
        let effectiveOpacity = 1;
        while (current instanceof Element) {
          const style = getComputedStyle(current);
          const opacity = Number.parseFloat(style.opacity || "1");
          effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            effectiveOpacity < 0.9 ||
            (style.clipPath && style.clipPath !== "none")
          ) {
            return false;
          }
          if (current !== element) {
            const clipBox = current.getBoundingClientRect();
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowX)
            ) {
              left = Math.max(left, clipBox.left);
              right = Math.min(right, clipBox.right);
            }
            if (
              ["auto", "clip", "hidden", "scroll"].includes(style.overflowY)
            ) {
              top = Math.max(top, clipBox.top);
              bottom = Math.min(bottom, clipBox.bottom);
            }
          }
          current = current.parentElement;
        }
        const visibleArea =
          Math.max(0, right - left) * Math.max(0, bottom - top);
        return (
          visibleArea / (own.width * own.height) >= 0.9 &&
          effectiveOpacity >= 0.9
        );
      };
      const colorAlpha = (value) => {
        const normalized = String(value || "")
          .trim()
          .toLowerCase();
        if (!normalized || normalized === "transparent") return 0;
        const rgba = normalized.match(
          /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
        );
        if (rgba) return Number.parseFloat(rgba[1]);
        const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
        if (!modern) return 1;
        const parsed = Number.parseFloat(modern[1]);
        return modern[2] ? parsed / 100 : parsed;
      };
      const paintedText = (element) => {
        const style = getComputedStyle(element);
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const foreground =
          element instanceof SVGTextElement
            ? style.fill
            : style.webkitTextFillColor || style.color;
        return (
          Number.isFinite(fontSize) &&
          fontSize >= 1 &&
          Math.min(
            colorAlpha(foreground),
            element instanceof SVGTextElement
              ? Number.parseFloat(style.fillOpacity || "1")
              : colorAlpha(style.color),
          ) >= 0.9
        );
      };
      const normalizedText = (element) => {
        if (element instanceof HTMLSelectElement) {
          return `${String(element.value || "")} ${[...element.selectedOptions]
            .map((option) => option.textContent || "")
            .join(" ")}`
            .replace(/\s+/gu, " ")
            .trim();
        }
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return String(element.value || "")
            .replace(/\s+/gu, " ")
            .trim();
        }
        return String(element.innerText || element.textContent || "")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const directPaintText = (element) => {
        if (
          element instanceof HTMLSelectElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement
        ) {
          return normalizedText(element);
        }
        return [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent || "")
          .join(" ")
          .replace(/\s+/gu, " ")
          .trim();
      };
      const canvasPainted = (element) => {
        if (!(element instanceof HTMLCanvasElement)) return false;
        try {
          const context = element.getContext("2d", {
            willReadFrequently: true,
          });
          if (!context || element.width <= 0 || element.height <= 0)
            return false;
          const pixels = context.getImageData(
            0,
            0,
            element.width,
            element.height,
          ).data;
          const stride = Math.max(
            1,
            Math.floor((element.width * element.height) / 8192),
          );
          let opaque = 0;
          const colors = new Set();
          for (let index = 0; index < pixels.length; index += 4 * stride) {
            if (pixels[index + 3] < 64) continue;
            opaque += 1;
            colors.add(
              `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`,
            );
            if (colors.size > 32) break;
          }
          return opaque >= 8 && colors.size >= 2;
        } catch {
          return false;
        }
      };
      const hasSignal = (signal) => {
        const pattern = new RegExp(signal.textPattern, "u");
        const tagPattern = new RegExp(signal.tagPattern, "u");
        return [...contentRoot.querySelectorAll(signal.selector)].some(
          (element) => {
            const text = normalizedText(element);
            const paintedWitness =
              signal.paintMode === "canvas"
                ? canvasPainted(element)
                : [element, ...element.querySelectorAll("*")]
                    .filter(visible)
                    .some(
                      (candidate) =>
                        pattern.test(directPaintText(candidate)) &&
                        paintedText(candidate),
                    );
            return (
              visible(element) &&
              paintedWitness &&
              tagPattern.test(element.tagName) &&
              (signal.allowEmptyText || text.length > 0) &&
              pattern.test(text)
            );
          },
        );
      };
      const blockingPattern = new RegExp(blockingTextPattern, "u");
      const blockingVisible = [...contentRoot.querySelectorAll("*")]
        .filter(
          (element) =>
            element.children.length === 0 &&
            !["OPTION", "SCRIPT", "STYLE", "TEMPLATE"].includes(
              element.tagName,
            ),
        )
        .some(
          (element) =>
            visible(element) &&
            paintedText(element) &&
            blockingPattern.test(normalizedText(element)),
        );
      return (
        document.readyState === "complete" &&
        !blockingVisible &&
        signals.every(hasSignal)
      );
    },
    waitInput,
    { timeout: contract.readiness.timeoutMs },
  );

  let previousFingerprint = "";
  let stableSamples = 0;
  for (
    let attempt = 0;
    attempt < contract.readiness.maxSettleSamples;
    attempt += 1
  ) {
    const fingerprint = await page.evaluate(
      ({ signals }) => {
        const contentRoot =
          document.querySelector("#main-content") ||
          document.querySelector("main") ||
          document.querySelector("#root > div") ||
          document.body;
        const visible = (element) => {
          const own = element.getBoundingClientRect();
          if (own.width <= 0 || own.height <= 0) return false;
          if (
            typeof element.checkVisibility === "function" &&
            !element.checkVisibility({
              checkOpacity: true,
              checkVisibilityCSS: true,
            })
          ) {
            return false;
          }
          let left = Math.max(0, own.left);
          let right = Math.min(window.innerWidth, own.right);
          let top = Math.max(-window.scrollY, own.top);
          let bottom = Math.min(
            document.documentElement.scrollHeight - window.scrollY,
            own.bottom,
          );
          let current = element;
          let effectiveOpacity = 1;
          while (current instanceof Element) {
            const style = getComputedStyle(current);
            const opacity = Number.parseFloat(style.opacity || "1");
            effectiveOpacity *= Number.isFinite(opacity) ? opacity : 1;
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.visibility === "collapse" ||
              effectiveOpacity < 0.9 ||
              (style.clipPath && style.clipPath !== "none")
            ) {
              return false;
            }
            if (current !== element) {
              const clipBox = current.getBoundingClientRect();
              if (
                ["auto", "clip", "hidden", "scroll"].includes(style.overflowX)
              ) {
                left = Math.max(left, clipBox.left);
                right = Math.min(right, clipBox.right);
              }
              if (
                ["auto", "clip", "hidden", "scroll"].includes(style.overflowY)
              ) {
                top = Math.max(top, clipBox.top);
                bottom = Math.min(bottom, clipBox.bottom);
              }
            }
            current = current.parentElement;
          }
          const visibleArea =
            Math.max(0, right - left) * Math.max(0, bottom - top);
          return (
            visibleArea / (own.width * own.height) >= 0.9 &&
            effectiveOpacity >= 0.9
          );
        };
        const colorAlpha = (value) => {
          const normalized = String(value || "")
            .trim()
            .toLowerCase();
          if (!normalized || normalized === "transparent") return 0;
          const rgba = normalized.match(
            /^rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)$/u,
          );
          if (rgba) return Number.parseFloat(rgba[1]);
          const modern = normalized.match(/\/\s*([0-9.]+)(%)?\s*\)$/u);
          if (!modern) return 1;
          const parsed = Number.parseFloat(modern[1]);
          return modern[2] ? parsed / 100 : parsed;
        };
        const paintedText = (element) => {
          const style = getComputedStyle(element);
          const fontSize = Number.parseFloat(style.fontSize || "0");
          const foreground =
            element instanceof SVGTextElement
              ? style.fill
              : style.webkitTextFillColor || style.color;
          return (
            Number.isFinite(fontSize) &&
            fontSize >= 1 &&
            Math.min(
              colorAlpha(foreground),
              element instanceof SVGTextElement
                ? Number.parseFloat(style.fillOpacity || "1")
                : colorAlpha(style.color),
            ) >= 0.9
          );
        };
        const readableText = (element) => {
          if (element instanceof HTMLSelectElement) {
            return `${String(element.value || "")} ${[
              ...element.selectedOptions,
            ]
              .map((option) => option.textContent || "")
              .join(" ")}`
              .replace(/\s+/gu, " ")
              .trim();
          }
          if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return String(element.value || "")
              .replace(/\s+/gu, " ")
              .trim();
          }
          return String(element.innerText || element.textContent || "")
            .replace(/\s+/gu, " ")
            .trim();
        };
        const directPaintText = (element) => {
          if (
            element instanceof HTMLSelectElement ||
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          ) {
            return readableText(element);
          }
          return [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent || "")
            .join(" ")
            .replace(/\s+/gu, " ")
            .trim();
        };
        const canvasPainted = (element) => {
          if (!(element instanceof HTMLCanvasElement)) return false;
          try {
            const context = element.getContext("2d", {
              willReadFrequently: true,
            });
            if (!context || element.width <= 0 || element.height <= 0) {
              return false;
            }
            const pixels = context.getImageData(
              0,
              0,
              element.width,
              element.height,
            ).data;
            const stride = Math.max(
              1,
              Math.floor((element.width * element.height) / 8192),
            );
            let opaque = 0;
            const colors = new Set();
            for (let index = 0; index < pixels.length; index += 4 * stride) {
              if (pixels[index + 3] < 64) continue;
              opaque += 1;
              colors.add(
                `${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`,
              );
              if (colors.size > 32) break;
            }
            return opaque >= 8 && colors.size >= 2;
          } catch {
            return false;
          }
        };
        const signalRows = signals.map((signal) => {
          const pattern = new RegExp(signal.textPattern, "u");
          const tagPattern = new RegExp(signal.tagPattern, "u");
          const candidates = [...contentRoot.querySelectorAll(signal.selector)]
            .filter((element) => {
              const text = readableText(element);
              const paintedWitness =
                signal.paintMode === "canvas"
                  ? canvasPainted(element)
                  : [element, ...element.querySelectorAll("*")]
                      .filter(visible)
                      .some(
                        (candidate) =>
                          pattern.test(directPaintText(candidate)) &&
                          paintedText(candidate),
                      );
              return (
                visible(element) &&
                paintedWitness &&
                tagPattern.test(element.tagName) &&
                (signal.allowEmptyText || text.length > 0) &&
                pattern.test(text)
              );
            })
            .sort((left, right) => {
              const leftBox = left.getBoundingClientRect();
              const rightBox = right.getBoundingClientRect();
              return (
                leftBox.width * leftBox.height -
                rightBox.width * rightBox.height
              );
            });
          const element = candidates[0];
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            id: signal.id,
            text: readableText(element),
            box: [box.x, box.y, box.width, box.height].map((value) =>
              Number(value.toFixed(2)),
            ),
            canvasPixels:
              element instanceof HTMLCanvasElement
                ? element.toDataURL("image/png")
                : "",
          };
        });
        const canvasRows = [...contentRoot.querySelectorAll("canvas")]
          .filter(visible)
          .map((canvas) => {
            try {
              return canvas.toDataURL("image/png");
            } catch {
              return `TAINTED:${canvas.width}x${canvas.height}`;
            }
          });
        const controlRows = [
          ...contentRoot.querySelectorAll("input, textarea, select"),
        ]
          .filter(visible)
          .map((control) => readableText(control));
        return JSON.stringify({
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          contentText: readableText(contentRoot),
          elementCount: contentRoot.querySelectorAll("*").length,
          controlRows,
          canvasRows,
          signalRows,
        });
      },
      { signals: readiness.signals },
    );
    stableSamples = fingerprint === previousFingerprint ? stableSamples + 1 : 1;
    previousFingerprint = fingerprint;
    if (stableSamples >= contract.readiness.requiredStableSamples) return;
    await page.waitForTimeout(contract.readiness.settleIntervalMs);
  }
  assert.fail(`${screenId} did not reach a stable ready layout.`);
};

const applyScreenFixtureActions = async (page, screenId, viewport) => {
  const actions = contract.screenFixtureActions?.[screenId] ?? [];
  const results = [];
  for (const action of actions) {
    const viewportExcluded =
      (Number.isFinite(action.maxViewportWidth) &&
        viewport.width > action.maxViewportWidth) ||
      (Number.isFinite(action.minViewportWidth) &&
        viewport.width < action.minViewportWidth);
    if (viewportExcluded) {
      results.push({
        id: action.id,
        type: action.type,
        applied: false,
        skippedByViewport: true,
        matchCount: 0,
      });
      continue;
    }

    if (action.type === "select-option-text") {
      await page.waitForFunction(
        ({ selector, text, exactMatchCount }) => {
          const normalize = (value) =>
            String(value || "")
              .replace(/\s+/gu, " ")
              .trim();
          const matches = [...document.querySelectorAll(selector)].filter(
            (element) =>
              element instanceof HTMLSelectElement &&
              [...element.options].some(
                (option) => normalize(option.textContent) === text,
              ),
          );
          return matches.length === exactMatchCount;
        },
        {
          selector: action.selector,
          text: action.text,
          exactMatchCount: action.exactMatchCount,
        },
        { timeout: contract.readiness.timeoutMs },
      );
      const result = await page.evaluate(({ selector, text }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/gu, " ")
            .trim();
        const matches = [...document.querySelectorAll(selector)].filter(
          (element) =>
            element instanceof HTMLSelectElement &&
            [...element.options].some(
              (option) => normalize(option.textContent) === text,
            ),
        );
        const select = matches[0];
        const option = [...select.options].find(
          (candidate) => normalize(candidate.textContent) === text,
        );
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return {
          matchCount: matches.length,
          selected: normalize(select.selectedOptions[0]?.textContent) === text,
        };
      }, action);
      assert.equal(result.matchCount, action.exactMatchCount);
      assert.equal(result.selected, true);
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount: result.matchCount,
      });
      continue;
    }

    if (action.type === "fill" || action.type === "click") {
      const locator = page.locator(action.selector);
      await locator.first().waitFor({
        state: "visible",
        timeout: contract.readiness.timeoutMs,
      });
      const matchCount = await locator.count();
      assert.equal(matchCount, action.exactMatchCount);
      if (action.type === "fill") await locator.fill(action.value);
      else await locator.click();
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount,
      });
      continue;
    }

    if (action.type === "scroll-text-into-view") {
      await page.waitForFunction(
        ({ selector, text, exactMatchCount }) => {
          const normalize = (value) =>
            String(value || "")
              .replace(/\s+/gu, " ")
              .trim();
          return (
            [...document.querySelectorAll(selector)].filter(
              (element) =>
                normalize(element.innerText || element.textContent) === text,
            ).length === exactMatchCount
          );
        },
        action,
        { timeout: contract.readiness.timeoutMs },
      );
      const matchCount = await page.evaluate(({ selector, text }) => {
        const normalize = (value) =>
          String(value || "")
            .replace(/\s+/gu, " ")
            .trim();
        const matches = [...document.querySelectorAll(selector)].filter(
          (element) =>
            normalize(element.innerText || element.textContent) === text,
        );
        matches[0].scrollIntoView({
          behavior: "auto",
          block: "nearest",
          inline: "center",
        });
        return matches.length;
      }, action);
      assert.equal(matchCount, action.exactMatchCount);
      results.push({
        id: action.id,
        type: action.type,
        applied: true,
        skippedByViewport: false,
        matchCount,
      });
      continue;
    }

    assert.fail(
      `${screenId} declares an unsupported fixture action: ${action.type}`,
    );
  }
  return results;
};

const fixedClockScript = ({ fixedTimestamp }) => {
  const NativeDate = Date;
  const fixed = new NativeDate(fixedTimestamp).valueOf();
  class FrozenDate extends NativeDate {
    constructor(...dateArgs) {
      super(...(dateArgs.length ? dateArgs : [fixed]));
    }
    static now() {
      return fixed;
    }
  }
  Object.defineProperty(globalThis, "Date", {
    configurable: true,
    writable: true,
    value: FrozenDate,
  });
};

const authenticate = async (page, credential, origin) => {
  await page.goto(`${origin}/#/`, { waitUntil: "domcontentloaded" });
  const identity = await page.evaluate(
    async ({ email, password, config }) => {
      const appModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js");
      const authModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js");
      const firestoreModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
      const app = appModule.initializeApp(config);
      const auth = authModule.getAuth(app);
      await authModule.setPersistence(auth, authModule.browserLocalPersistence);
      const credentialResult = await authModule.signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      await auth.authStateReady();
      const token = await authModule.getIdTokenResult(credentialResult.user);
      const database = firestoreModule.getFirestore(app);
      const profileSnapshot = await firestoreModule.getDoc(
        firestoreModule.doc(database, "users", credentialResult.user.uid),
      );
      if (!profileSnapshot.exists()) throw new Error("VISUAL_PROFILE_MISSING");
      const profile = profileSnapshot.data();
      return {
        uid: credentialResult.user.uid,
        email: credentialResult.user.email || "",
        profileEmail: String(profile.email || ""),
        profileRole: String(profile.role || ""),
        teacherPortalEnabled: profile.teacherPortalEnabled === true,
        staffPermissions: Array.isArray(profile.staffPermissions)
          ? profile.staffPermissions.map(String).sort()
          : [],
        tokenRole:
          typeof token.claims.role === "string" ? token.claims.role : null,
      };
    },
    { ...credential, config: firebaseConfig },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  return identity;
};

const createIdentityAttestation = (role, identity) => {
  const expected = contract.captureIdentities.roles[role];
  assert.ok(expected, `Missing capture identity contract for ${role}.`);
  assert.equal(identity.uid, expected.uid);
  assert.equal(identity.profileRole, expected.profileRole);
  assert.equal(identity.teacherPortalEnabled, expected.teacherPortalEnabled);
  assert.equal(
    identity.profileEmail.trim().toLowerCase(),
    identity.email.trim().toLowerCase(),
    `${role} Auth and profile emails differ.`,
  );
  assert.equal(
    identity.tokenRole === null || identity.tokenRole === identity.profileRole,
    true,
    `${role} token and profile roles conflict.`,
  );
  for (const permission of expected.requiredStaffPermissions) {
    assert.equal(
      identity.staffPermissions.includes(permission),
      true,
      `${role} is missing ${permission}.`,
    );
  }
  const emailSha256 = sha256(identity.email.trim().toLowerCase());
  const adminEmail =
    emailSha256 === contract.captureIdentities.adminEmailSha256;
  assert.equal(adminEmail, role === "admin");
  return {
    role,
    uidSha256: sha256(identity.uid),
    emailSha256,
    profileRole: identity.profileRole,
    tokenRole: identity.tokenRole,
    teacherPortalEnabled: identity.teacherPortalEnabled,
    staffPermissions: [...new Set(identity.staffPermissions)].sort(),
    adminEmail,
  };
};

const sanitizeBrowserUrl = (value) => {
  const url = new URL(value);
  url.searchParams.delete("x-vercel-protection-bypass");
  url.searchParams.delete("x-vercel-set-bypass-cookie");
  return url.toString();
};
const safelyDecodeUrl = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
const commonFirebaseApiHosts = new Set([
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseappcheck.googleapis.com",
]);
const firebaseServiceForHost = (hostname) => {
  if (
    hostname === "identitytoolkit.googleapis.com" ||
    hostname === "securetoken.googleapis.com"
  ) {
    return "auth";
  }
  if (hostname === "firebaseappcheck.googleapis.com") return "app-check";
  if (hostname === "firestore.googleapis.com") return "firestore";
  if (hostname === "firebasestorage.googleapis.com") return "storage";
  if (hostname.endsWith(".cloudfunctions.net")) return "functions";
  if (hostname.endsWith(".firebaseio.com")) return "realtime-database";
  if (hostname.endsWith(".firebaseapp.com") || hostname.endsWith(".web.app")) {
    return "hosting";
  }
  return null;
};
const fixtureDataServices = new Set(["firestore", "functions", "storage"]);
const inspectNetworkRequest = ({
  url: requestUrl,
  method,
  phase,
  groupKey,
  captureId,
  correlationId,
}) => {
  const parsed = new URL(requestUrl);
  const hostname = parsed.hostname.toLowerCase();
  const decoded = safelyDecodeUrl(requestUrl).toLowerCase();
  const observedProjectIds = new Set();
  const projectPatterns = [
    /\/projects\/([a-z0-9-]+)/gu,
    /\bprojects=([a-z0-9-]+)/gu,
    /\/v0\/b\/([a-z0-9.-]+)\/o(?:\/|\?|$)/gu,
  ];
  for (const pattern of projectPatterns) {
    for (const match of decoded.matchAll(pattern)) {
      const value = match[1].replace(
        /\.(?:appspot\.com|firebasestorage\.app)$/u,
        "",
      );
      observedProjectIds.add(value);
    }
  }
  for (const projectId of [
    contract.firebaseProjectId,
    ...contract.networkBoundary.forbiddenFirebaseProjectIds,
  ]) {
    if (hostname.endsWith(`-${projectId}.cloudfunctions.net`)) {
      observedProjectIds.add(projectId);
    }
  }
  const firebaseDomainMatch = hostname.match(
    /^([a-z0-9-]+)\.(?:firebaseapp\.com|web\.app|firebaseio\.com)$/u,
  );
  if (firebaseDomainMatch) observedProjectIds.add(firebaseDomainMatch[1]);

  const requestApiKey = parsed.searchParams.get("key");
  const apiKeySha256 = requestApiKey ? sha256(requestApiKey) : null;
  const apiKeyMatches = requestApiKey === firebaseConfig.apiKey;
  const firebaseService = firebaseServiceForHost(hostname);
  const isFirebaseRequest = Boolean(firebaseService);
  const productionMarker =
    contract.networkBoundary.forbiddenWebHosts.includes(hostname) ||
    contract.networkBoundary.forbiddenFirebaseProjectIds.some(
      (projectId) =>
        decoded.includes(projectId.toLowerCase()) ||
        observedProjectIds.has(projectId.toLowerCase()),
    );
  const stagingMarker =
    isFirebaseRequest &&
    (decoded.includes(contract.firebaseProjectId.toLowerCase()) ||
      observedProjectIds.has(contract.firebaseProjectId.toLowerCase()) ||
      (commonFirebaseApiHosts.has(hostname) && apiKeyMatches));
  const unboundFirebaseRequest =
    isFirebaseRequest && !stagingMarker && !productionMarker;

  return {
    groupKey,
    captureId,
    correlationId,
    phase,
    method: method.toUpperCase(),
    hostname,
    firebaseService,
    isFirebaseRequest,
    stagingMarker,
    productionMarker,
    unboundFirebaseRequest,
    apiKeySha256,
    productionWrite:
      productionMarker &&
      !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()),
    observedProjectIds: [...observedProjectIds].sort(),
  };
};
const summarizeNetwork = (observations, responses = []) => {
  const firebaseRequests = observations.filter(
    (observation) => observation.isFirebaseRequest,
  );
  const productionRequests = observations.filter(
    (observation) => observation.productionMarker,
  );
  const stagingRequests = firebaseRequests.filter(
    (observation) => observation.stagingMarker,
  );
  const unboundFirebaseRequests = firebaseRequests.filter(
    (observation) => observation.unboundFirebaseRequest,
  );
  const stagingFirebaseResponses = responses.filter(
    (response) =>
      response.isFirebaseRequest &&
      response.stagingMarker &&
      response.status < 400,
  );
  const stagingDataRequests = stagingRequests.filter((request) =>
    fixtureDataServices.has(request.firebaseService),
  );
  const stagingDataResponses = stagingFirebaseResponses.filter((response) =>
    fixtureDataServices.has(response.firebaseService),
  );
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
  return {
    requestCount: observations.length,
    responseCount: responses.length,
    firebaseRequestCount: firebaseRequests.length,
    stagingFirebaseRequestCount: stagingRequests.length,
    stagingFirebaseResponseCount: stagingFirebaseResponses.length,
    stagingDataRequestCount: stagingDataRequests.length,
    stagingDataResponseCount: stagingDataResponses.length,
    stagingFirebaseRequestsByPhase: countBy(
      stagingRequests,
      (observation) => observation.phase,
    ),
    stagingFirebaseRequestsByStage: countBy(
      stagingRequests,
      (observation) => observation.groupKey.split(":")[0],
    ),
    stagingScreenRequestsByStage: countBy(
      stagingRequests.filter(
        (observation) => observation.phase === "screen-capture",
      ),
      (observation) => observation.groupKey.split(":")[0],
    ),
    productionAccess: productionRequests.length,
    productionWrites: productionRequests.filter(
      (observation) => observation.productionWrite,
    ).length,
    unboundFirebaseRequestCount: unboundFirebaseRequests.length,
    observedFirebaseApiKeySha256s: [
      ...new Set(
        firebaseRequests
          .map((observation) => observation.apiKeySha256)
          .filter(Boolean),
      ),
    ].sort(),
    observedFirebaseProjectIds: [
      ...new Set(
        firebaseRequests.flatMap(
          (observation) => observation.observedProjectIds,
        ),
      ),
    ].sort(),
    observedFirebaseHosts: [
      ...new Set(firebaseRequests.map((observation) => observation.hostname)),
    ].sort(),
    productionRequestHosts: [
      ...new Set(productionRequests.map((observation) => observation.hostname)),
    ].sort(),
    failedFirebaseResponseCount: responses.filter(
      (response) => response.isFirebaseRequest && response.status >= 400,
    ).length,
  };
};
const headers = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret }
  : {};
const browser = await chromium.launch({
  executablePath: edgeExecutable,
  headless: true,
});
const browserVersion = browser.version();
const captureSessionId = randomUUID();
const startedAt = new Date().toISOString();
assert.ok(Date.parse(startedAt) >= fixtureAuditIssuedAt);
assert.ok(
  Date.parse(startedAt) < fixtureAuditExpiresAt,
  "The fixture audit expired before browser capture began.",
);
const captures = [];
const browserAudits = [];
const identityAttestations = new Map();
const networkObservations = [];
const networkResponseObservations = [];
const groupedTargets = new Map();
for (const target of targets) {
  const authenticationRole =
    contract.captureAuthenticationRoles[target.screen.id] ??
    (target.screen.role === "support" ? null : target.screen.role);
  const traceRole =
    target.screen.role === "support"
      ? authenticationRole
        ? `support-${authenticationRole}`
        : "support-public"
      : target.screen.role;
  const key = `${target.stage}:${traceRole}:${viewportKey(target.viewport)}`;
  const current = groupedTargets.get(key) || [];
  current.push({ ...target, authenticationRole });
  groupedTargets.set(key, current);
}

try {
  for (const [groupKey, groupTargets] of [...groupedTargets.entries()].sort()) {
    const [stage, traceRole, viewportName] = groupKey.split(":");
    const viewport = contract.viewports.find(
      (candidate) => viewportKey(candidate) === viewportName,
    );
    const origin =
      stage === "baseline"
        ? normalizeOrigin(baselineDeploymentUrl)
        : normalizeOrigin(candidateDeploymentUrl);
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: contract.requiredDpr,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      reducedMotion: "reduce",
      extraHTTPHeaders: headers,
    });
    let networkPhase = "context-bootstrap";
    let activeCaptureId = null;
    let networkRequestSequence = 0;
    const requestCorrelations = new WeakMap();
    const groupNetworkObservationStart = networkObservations.length;
    const groupNetworkResponseObservationStart =
      networkResponseObservations.length;
    const groupCaptureAttestations = [];
    context.on("request", (request) => {
      const correlation = {
        correlationId: `${groupKey}:request-${networkRequestSequence}`,
        phase: networkPhase,
        captureId: activeCaptureId,
      };
      networkRequestSequence += 1;
      requestCorrelations.set(request, correlation);
      networkObservations.push(
        inspectNetworkRequest({
          url: request.url(),
          method: request.method(),
          phase: correlation.phase,
          groupKey,
          captureId: correlation.captureId,
          correlationId: correlation.correlationId,
        }),
      );
    });
    context.on("response", (response) => {
      const request = response.request();
      const correlation = requestCorrelations.get(request);
      assert.ok(correlation, "A browser response has no originating request.");
      networkResponseObservations.push({
        ...inspectNetworkRequest({
          url: response.url(),
          method: request.method(),
          phase: correlation.phase,
          groupKey,
          captureId: correlation.captureId,
          correlationId: correlation.correlationId,
        }),
        status: response.status(),
      });
    });
    await context.addInitScript(fixedClockScript, {
      fixedTimestamp: fixedTime,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") pageErrors.push(message.text());
    });
    const authenticationRole = groupTargets[0].authenticationRole;
    assert.equal(
      groupTargets.every(
        (target) => target.authenticationRole === authenticationRole,
      ),
      true,
    );
    let groupIdentityAttestation = null;
    if (authenticationRole) {
      networkPhase = "authentication";
      const identity = await authenticate(
        page,
        credentials[authenticationRole],
        origin,
      );
      groupIdentityAttestation = createIdentityAttestation(
        authenticationRole,
        identity,
      );
      const previous = identityAttestations.get(authenticationRole);
      if (previous) assert.deepEqual(groupIdentityAttestation, previous);
      else
        identityAttestations.set(authenticationRole, groupIdentityAttestation);
    }
    for (const target of groupTargets) {
      pageErrors.length = 0;
      activeCaptureId = captureKey(stage, target.screen.id, viewport);
      networkPhase = "screen-capture";
      const networkObservationStart = networkObservations.length;
      const networkResponseObservationStart =
        networkResponseObservations.length;
      const routeUrl = `${origin}/#${target.screen.captureRoute}`;
      await page.goto(routeUrl, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (expectedRoute) =>
          decodeURIComponent(location.hash.slice(1)) ===
          decodeURIComponent(expectedRoute),
        target.screen.captureRoute,
      );
      await page.waitForLoadState("load");
      await page.evaluate(async () => document.fonts.ready);
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}",
      });
      const fixtureActions = await applyScreenFixtureActions(
        page,
        target.screen.id,
        viewport,
      );
      await waitForScreenReady(page, target.screen.id);
      assert.deepEqual(pageErrors, [], `${target.screen.id} browser errors.`);
      const anchorRequirements =
        stage === "candidate" && !target.screen.productionPresentation
          ? contract.newSurfaceRequiredAnchors[target.screen.id]
          : [];
      const readyRequirements =
        contract.screenReadyStates[target.screen.id].signals;
      const metadata = await describePage(
        page,
        anchorRequirements,
        readyRequirements,
        target.primitiveRequirements,
        contract.fixtureDomAssertions[target.screen.id] ?? null,
      );
      assert.deepEqual(
        metadata.fixtureEvidence.privacy.unexpectedEmailSha256s,
        [],
        `${target.screen.id} exposed a non-fixture email.`,
      );
      assert.deepEqual(
        metadata.fixtureEvidence.privacy.unexpectedPersonLabels,
        [],
        `${target.screen.id} exposed an unapproved fixture person label.`,
      );
      assert.equal(
        Object.values(
          metadata.fixtureEvidence.privacy.forbiddenPatternMatchCounts,
        ).every((count) => count === 0),
        true,
        `${target.screen.id} exposed a forbidden personal-data pattern.`,
      );
      metadata.finalUrl = sanitizeBrowserUrl(metadata.finalUrl);
      metadata.performanceNavigationUrl = sanitizeBrowserUrl(
        metadata.performanceNavigationUrl,
      );
      const fullPage = contract.fullPageViewportKeys.includes(viewportName);
      const fileName = `${stage}/${target.screen.id}-${viewportName}.png`;
      const absoluteFile = resolve(outputRoot, fileName);
      await page.screenshot({ path: absoluteFile, fullPage });
      assert.deepEqual(
        pageErrors,
        [],
        `${target.screen.id} emitted an error during screenshot capture.`,
      );
      const postScreenshotMetadata = await describePage(
        page,
        anchorRequirements,
        readyRequirements,
        target.primitiveRequirements,
        contract.fixtureDomAssertions[target.screen.id] ?? null,
      );
      postScreenshotMetadata.finalUrl = sanitizeBrowserUrl(
        postScreenshotMetadata.finalUrl,
      );
      postScreenshotMetadata.performanceNavigationUrl = sanitizeBrowserUrl(
        postScreenshotMetadata.performanceNavigationUrl,
      );
      assert.deepEqual(
        postScreenshotMetadata,
        metadata,
        `${target.screen.id} DOM or paint evidence changed during screenshot capture.`,
      );
      const png = readFileSync(absoluteFile);
      const actualPixelSize = {
        width: viewport.width,
        height: fullPage
          ? Math.max(viewport.height, metadata.dom.scrollHeight)
          : viewport.height,
      };
      const captureRequests = networkObservations
        .slice(networkObservationStart)
        .filter((observation) => observation.captureId === activeCaptureId);
      const captureResponses = networkResponseObservations
        .slice(networkResponseObservationStart)
        .filter((observation) => observation.captureId === activeCaptureId);
      const captureNetwork = summarizeNetwork(
        captureRequests,
        captureResponses,
      );
      if (contract.fixtureMarkers[target.screen.id]) {
        assert.ok(
          captureNetwork.stagingDataRequestCount > 0,
          `${target.screen.id} rendered fixture data without a capture-bound staging data request.`,
        );
        assert.ok(
          captureNetwork.stagingDataResponseCount > 0,
          `${target.screen.id} rendered fixture data without a successful capture-bound staging data response.`,
        );
        const successfulDataResponseIds = new Set(
          captureResponses
            .filter(
              (response) =>
                response.stagingMarker &&
                fixtureDataServices.has(response.firebaseService) &&
                response.status < 400,
            )
            .map((response) => response.correlationId),
        );
        assert.ok(
          captureRequests.some(
            (request) =>
              request.stagingMarker &&
              fixtureDataServices.has(request.firebaseService) &&
              successfulDataResponseIds.has(request.correlationId),
          ),
          `${target.screen.id} has no correlated successful staging data exchange.`,
        );
      }
      const captureRow = {
        id: captureKey(stage, target.screen.id, viewport),
        stage,
        screenId: target.screen.id,
        role: target.screen.role,
        route: target.screen.captureRoute,
        sourceCommitSha:
          stage === "baseline"
            ? contract.productionPresentationSha
            : sourceCommitSha,
        observedOrigin: origin,
        finalUrl: metadata.finalUrl,
        performanceNavigationUrl: metadata.performanceNavigationUrl,
        documentReadyState: metadata.documentReadyState,
        capturedAt: new Date().toISOString(),
        viewport,
        actualPixelSize,
        dpr: contract.requiredDpr,
        fullPage,
        fileName,
        sha256: sha256(png),
        status: "CAPTURED",
        dom: metadata.dom,
        elements: metadata.elements,
        anchors: metadata.anchors,
        primitives: metadata.primitives,
        readyStateId: target.screen.id,
        readySignals: metadata.readySignals,
        fixtureMarker: contract.fixtureMarkers[target.screen.id] ?? null,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        fixtureActions,
        fixtureEvidence: metadata.fixtureEvidence,
        network: captureNetwork,
      };
      const captureAttestation = {
        type: "capture",
        id: captureRow.id,
        route: captureRow.route,
        finalUrl: captureRow.finalUrl,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        screenshotFile: captureRow.fileName,
        screenshotSha256: captureRow.sha256,
        readySignalsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.readySignals)),
        ),
        domSha256: sha256(Buffer.from(JSON.stringify(captureRow.dom))),
        elementsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.elements)),
        ),
        anchorsSha256: sha256(Buffer.from(JSON.stringify(captureRow.anchors))),
        primitivesSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.primitives)),
        ),
        fixtureActionsSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.fixtureActions)),
        ),
        fixtureEvidenceSha256: sha256(
          Buffer.from(JSON.stringify(captureRow.fixtureEvidence)),
        ),
      };
      captureRow.browserAttestationSha256 = sha256(
        Buffer.from(JSON.stringify(captureAttestation)),
      );
      captures.push(captureRow);
      groupCaptureAttestations.push(captureAttestation);
    }
    activeCaptureId = null;
    networkPhase = "browser-audit-finalization";
    const groupRequests = networkObservations.slice(
      groupNetworkObservationStart,
    );
    const groupResponses = networkResponseObservations.slice(
      groupNetworkResponseObservationStart,
    );
    const browserAuditFileName = `browser-audits/${stage}-${traceRole}-${viewportName}.jsonl`;
    const browserAuditPath = resolve(outputRoot, browserAuditFileName);
    const auditEvents = [
      {
        type: "browser-session",
        id: groupKey,
        stage,
        role: traceRole,
        viewport,
        browserVersion,
        captureSessionId,
        runnerRuntimeSha256,
        trustedInputsSha256,
        firebaseProjectId: contract.firebaseProjectId,
        fixtureId,
        fixturePlanHash: contract.fixturePlanHash,
        fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
        fixtureAuditSha256,
        identityAttestation: groupIdentityAttestation,
      },
      ...groupRequests.map((request, sequence) => ({
        type: "network-request",
        sequence,
        phase: request.phase,
        captureId: request.captureId,
        correlationId: request.correlationId,
        method: request.method,
        hostname: request.hostname,
        firebaseService: request.firebaseService,
        firebase: request.isFirebaseRequest,
        staging: request.stagingMarker,
        production: request.productionMarker,
        unboundFirebase: request.unboundFirebaseRequest,
        productionWrite: request.productionWrite,
        apiKeySha256: request.apiKeySha256,
        observedProjectIds: request.observedProjectIds,
      })),
      ...groupResponses.map((response, sequence) => ({
        type: "network-response",
        sequence,
        phase: response.phase,
        captureId: response.captureId,
        correlationId: response.correlationId,
        method: response.method,
        hostname: response.hostname,
        firebaseService: response.firebaseService,
        status: response.status,
        firebase: response.isFirebaseRequest,
        staging: response.stagingMarker,
        production: response.productionMarker,
        unboundFirebase: response.unboundFirebaseRequest,
        apiKeySha256: response.apiKeySha256,
        observedProjectIds: response.observedProjectIds,
      })),
      ...groupCaptureAttestations,
      {
        type: "browser-session-complete",
        id: groupKey,
        captureCount: groupCaptureAttestations.length,
        network: summarizeNetwork(groupRequests, groupResponses),
      },
    ];
    const browserAuditText = `${auditEvents
      .map((event) => JSON.stringify(event))
      .join("\n")}\n`;
    for (const secret of [
      ...Object.values(credentials).flatMap((credential) => [
        credential.email,
        credential.password,
      ]),
      firebaseConfig.apiKey,
      firebaseConfig.appId,
      bypassSecret,
    ].filter(Boolean)) {
      assert.equal(
        browserAuditText.includes(secret),
        false,
        "A credential or deployment secret reached the browser audit.",
      );
    }
    assert.doesNotMatch(
      browserAuditText,
      /(?:authorization|idToken|refreshToken|password|postData|responseBody)/iu,
      "The browser audit contains a sensitive transport field.",
    );
    writeFileSync(browserAuditPath, browserAuditText, "utf8");
    browserAudits.push({
      id: groupKey,
      stage,
      role: traceRole,
      viewport,
      fileName: browserAuditFileName,
      sha256: sha256(readFileSync(browserAuditPath)),
      captureIds: groupTargets.map((target) =>
        captureKey(stage, target.screen.id, viewport),
      ),
    });
    await context.close();
  }
} finally {
  await browser.close();
}

const comparisonRows = [];
for (const screen of screens) {
  for (const viewport of viewportsForScreen(screen.id)) {
    const baselineScreenId = screen.productionPresentation
      ? screen.id
      : contract.newSurfaceReferences[screen.id];
    comparisonRows.push({
      id: comparisonKey(screen.id, viewport),
      screenId: screen.id,
      viewport,
      mode: screen.productionPresentation ? "pixel" : "shell",
      baselineCaptureId: captureKey("baseline", baselineScreenId, viewport),
      candidateCaptureId: captureKey("candidate", screen.id, viewport),
      maskRegions: [],
    });
  }
}

const fetchHtml = async (url) => {
  const response = await fetch(url, { headers, redirect: "follow" });
  assert.equal(response.status, 200, `${url} is not available.`);
  return Buffer.from(await response.arrayBuffer());
};
const inspectFirebaseBundle = async (deploymentUrl, html) => {
  const deploymentOrigin = new URL(deploymentUrl).origin;
  const scriptPaths = [
    ...new Set(
      [
        ...html
          .toString("utf8")
          .matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/giu),
      ]
        .map((match) => new URL(match[1], deploymentUrl))
        .filter((url) => url.origin === deploymentOrigin)
        .map((url) => `${url.pathname}${url.search}`),
    ),
  ].sort();
  assert.ok(
    scriptPaths.length > 0,
    `${deploymentUrl} has no local script bundle.`,
  );
  const assets = [];
  let combinedSource = "";
  for (const path of scriptPaths) {
    const response = await fetch(new URL(path, deploymentUrl), {
      headers,
      redirect: "follow",
    });
    assert.equal(response.status, 200, `${path} is not available.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    combinedSource += bytes.toString("utf8");
    assets.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  assert.match(
    combinedSource,
    new RegExp(
      contract.firebaseProjectId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
      "u",
    ),
    `${deploymentUrl} is not built for the dedicated staging Firebase project.`,
  );
  return {
    firebaseProjectId: contract.firebaseProjectId,
    assets,
  };
};
const baselineHtml = await fetchHtml(baselineDeploymentUrl);
const candidateHtml = await fetchHtml(candidateDeploymentUrl);
const candidateAliasHtml = await fetchHtml(contract.stableAlias);
assert.equal(
  sha256(candidateAliasHtml),
  sha256(candidateHtml),
  "The fixed candidate alias does not serve the immutable candidate deployment.",
);
const baselineFirebaseBundle = await inspectFirebaseBundle(
  baselineDeploymentUrl,
  baselineHtml,
);
const candidateFirebaseBundle = await inspectFirebaseBundle(
  candidateDeploymentUrl,
  candidateHtml,
);
const completedAt = new Date().toISOString();
assert.ok(
  Date.parse(completedAt) <= fixtureAuditExpiresAt,
  "The fixture audit expired before browser capture completed.",
);
for (const auditRole of fixtureAudit.authRoles) {
  const identity = identityAttestations.get(auditRole.role);
  assert.ok(identity, `Missing browser identity for ${auditRole.role}.`);
  assert.equal(identity.uidSha256, auditRole.uidHash);
  assert.equal(identity.emailSha256, auditRole.emailHash);
}
const networkSummary = summarizeNetwork(
  networkObservations,
  networkResponseObservations,
);
assert.equal(
  networkSummary.productionAccess,
  0,
  `Production network access detected: ${networkSummary.productionRequestHosts.join(", ")}`,
);
assert.equal(networkSummary.productionWrites, 0);
assert.equal(
  networkSummary.unboundFirebaseRequestCount,
  0,
  "A Firebase request was not bound to the staging project or API key.",
);
assert.deepEqual(
  networkSummary.observedFirebaseApiKeySha256s,
  [sha256(firebaseConfig.apiKey)],
  "The browser used an unexpected Firebase API key.",
);
assert.ok(
  networkSummary.stagingFirebaseRequestCount > 0,
  "The browser did not make a measured request to the staging Firebase project.",
);
assert.ok(
  (networkSummary.stagingFirebaseRequestsByPhase.authentication || 0) > 0,
  "The explicit staging authentication flow was not observed.",
);
for (const stage of ["baseline", "candidate"]) {
  assert.ok(
    (networkSummary.stagingScreenRequestsByStage[stage] || 0) > 0,
    `${stage} application routes did not contact staging Firebase.`,
  );
}
assert.deepEqual(
  networkSummary.observedFirebaseProjectIds,
  contract.networkBoundary.requiredMeasuredFirebaseProjectIds,
  "The browser observed an unexpected Firebase project.",
);
assert.equal(
  networkSummary.failedFirebaseResponseCount,
  0,
  "One or more staging Firebase requests failed during visual capture.",
);
const manifest = {
  schemaVersion: contract.schemaVersion,
  phase: contract.phase,
  testRunId: outputRoot.split(/[\\/]/u).at(-1),
  branch: contract.branch,
  sourceCommitSha,
  sourceTreeSha: git("rev-parse", `${sourceCommitSha}^{tree}`),
  functionalBaselineSha: contract.functionalBaselineSha,
  productionPresentationSha: contract.productionPresentationSha,
  firebaseProjectId: contract.firebaseProjectId,
  vercelProjectId: contract.vercelProjectId,
  stableAlias: contract.stableAlias,
  productionAccess: networkSummary.productionAccess,
  productionWrites: networkSummary.productionWrites,
  networkSummary,
  status: "CAPTURED",
  startedAt,
  completedAt,
  fixtureAudit: {
    fileName: fixtureAuditFileName,
    sha256: fixtureAuditSha256,
    artifactSchemaVersion: fixtureAudit.artifactSchemaVersion,
    fixtureRevision: contract.fixtureRevision,
    planHash: contract.fixturePlanHash,
    captureBindingHash: fixtureAudit.captureBindingHash,
    issuedAt: fixtureAudit.freshness.issuedAt,
    expiresAt: fixtureAudit.freshness.expiresAt,
  },
  generator: {
    scriptPath: runnerScriptPath,
    scriptGitBlobSha: runnerCommittedBlobSha,
    scriptRuntimeSha256: runnerRuntimeSha256,
    entrypointVerified: true,
    trustedInputsSha256,
    playwrightCoreVersion: JSON.parse(
      readFileSync(
        resolve("node_modules/playwright-core/package.json"),
        "utf8",
      ),
    ).version,
    browserExecutable: edgeExecutable,
  },
  trustedInputs,
  environment: {
    viewports: contract.viewports,
    dpr: contract.requiredDpr,
    fontsReady: true,
    animationsDisabled: true,
    browser: "Microsoft Edge via Playwright",
    browserVersion,
    operatingSystem: `${platform()} ${release()}`,
    locale: "ko-KR",
    timezone: "Asia/Seoul",
    fixtureId,
    fixtureRevision: contract.fixtureRevision,
    fixturePlanHash: contract.fixturePlanHash,
    fixtureCaptureBindingHash: fixtureAudit.captureBindingHash,
    captureSessionId,
    fixedTime,
    firebaseConfig: {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      storageBucket: firebaseConfig.storageBucket,
      apiKeySha256: sha256(firebaseConfig.apiKey),
      appIdSha256: sha256(firebaseConfig.appId),
    },
  },
  identityAttestations: Object.fromEntries(
    [...identityAttestations.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ),
  baselineDeployment: {
    id: baselineDeploymentId,
    url: baselineDeploymentUrl,
    projectId: contract.vercelProjectId,
    status: "READY",
    sourceCommitSha: contract.productionPresentationSha,
    htmlSha256: sha256(baselineHtml),
    firebaseBundle: baselineFirebaseBundle,
    inspectedAt: startedAt,
  },
  candidateDeployment: {
    id: candidateDeploymentId,
    url: candidateDeploymentUrl,
    projectId: contract.vercelProjectId,
    status: "READY",
    sourceCommitSha,
    htmlSha256: sha256(candidateHtml),
    firebaseBundle: candidateFirebaseBundle,
    inspectedAt: startedAt,
  },
  captures: captures.sort((left, right) => left.id.localeCompare(right.id)),
  browserAudits: browserAudits.sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
  comparisons: comparisonRows.sort((left, right) =>
    left.id.localeCompare(right.id),
  ),
};
const manifestPath = resolve(outputRoot, "visual-parity-manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
assert.equal(statSync(manifestPath).isFile(), true);
console.log(
  JSON.stringify(
    {
      suite: "w10p-visual-capture",
      captured: true,
      manifestPath: relative(process.cwd(), manifestPath).replaceAll("\\", "/"),
      captures: captures.length,
      comparisons: comparisonRows.length,
      browserAudits: browserAudits.length,
      stagingFirebaseRequests: networkSummary.stagingFirebaseRequestCount,
      productionAccess: networkSummary.productionAccess,
      productionWrites: networkSummary.productionWrites,
    },
    null,
    2,
  ),
);
