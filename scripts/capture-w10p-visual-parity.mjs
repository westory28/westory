import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { platform, release } from "node:os";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const STAGING_PROJECT_NUMBER = "894916304910";
const STAGING_APP_ID = "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f";
const APP_CHECK_DEBUG_SENTINEL = "w10p-visual-app-check-debug-sentinel-v1";
const BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES = [
  "W10P_VISUAL_APPCHECK_DEBUG_TOKEN",
  "W10P_VISUAL_CREDENTIALS_JSON",
  "W10P_VISUAL_FIREBASE_CONFIG_JSON",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
];
const BROWSER_CHILD_ENVIRONMENT_ALLOWLIST = [
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "COMSPEC",
  "DRIVERDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LOCALAPPDATA",
  "LOGONSERVER",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PUBLIC",
  "SESSIONNAME",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TZ",
  "USERDOMAIN",
  "USERDOMAIN_ROAMINGPROFILE",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
].sort();
const createBrowserChildEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) =>
      BROWSER_CHILD_ENVIRONMENT_ALLOWLIST.includes(name.toUpperCase()),
    ),
  );

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10p-visual-parity-contract.json");
const inventory = readJson("scripts/w10p-route-menu-inventory.json");
const args = process.argv.slice(2);
const APP_CHECK_DEBUG_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JWT_PATTERN =
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u;
const APP_CHECK_JWT_SHAPE_PATTERN =
  /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/u;
const secretSha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const FIXTURE_AUDIT_FRESHNESS_KEYS = [
  "issuedAt",
  "expiresAt",
  "maxAgeSeconds",
  "fixedFixtureTime",
].sort();
const assertFixtureAuditFreshnessBinding = ({
  freshness,
  captureBindingFreshness,
  expectedFixedTime,
}) => {
  assert.ok(freshness && typeof freshness === "object");
  assert.equal(Array.isArray(freshness), false);
  assert.deepEqual(
    Object.keys(freshness).sort(),
    FIXTURE_AUDIT_FRESHNESS_KEYS,
    "The fixture audit freshness schema drifted.",
  );
  assert.deepEqual(
    captureBindingFreshness,
    freshness,
    "The fixture audit freshness is not exactly bound to captureBinding.",
  );
  const issuedAt = Date.parse(freshness.issuedAt);
  const expiresAt = Date.parse(freshness.expiresAt);
  assert.equal(Number.isNaN(issuedAt), false);
  assert.equal(Number.isNaN(expiresAt), false);
  assert.equal(new Date(issuedAt).toISOString(), freshness.issuedAt);
  assert.equal(new Date(expiresAt).toISOString(), freshness.expiresAt);
  assert.equal(freshness.maxAgeSeconds, 3600);
  assert.equal(freshness.fixedFixtureTime, expectedFixedTime);
  assert.equal(
    expiresAt - issuedAt,
    3600 * 1000,
    "The fixture audit freshness window must be exactly one hour.",
  );
  return { issuedAt, expiresAt };
};
const PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION = {
  schemaVersion: 1,
  interceptionStage: "cdp-fetch-request-stage",
  inspectionFunction: "inspectNetworkRequest",
  blockedMarkers: ["production", "unbound-firebase"],
  blockMechanism: "Fetch.failRequest",
  blockErrorReason: "BlockedByClient",
  ordering: "before-header-body-read-or-secret-mutation",
};
const preTransmissionBoundaryDecision = ({
  productionMarker,
  unboundFirebaseRequest,
}) => {
  assert.equal(typeof productionMarker, "boolean");
  assert.equal(typeof unboundFirebaseRequest, "boolean");
  if (productionMarker) {
    return { block: true, marker: "production" };
  }
  if (unboundFirebaseRequest) {
    return { block: true, marker: "unbound-firebase" };
  }
  return { block: false, marker: null };
};
const verifyPreTransmissionBoundaryNegativeFixtures = () => {
  const cases = [
    {
      method: "GET",
      inspection: { productionMarker: true, unboundFirebaseRequest: false },
      marker: "production",
    },
    {
      method: "POST",
      inspection: { productionMarker: true, unboundFirebaseRequest: false },
      marker: "production",
    },
    {
      method: "POST",
      inspection: { productionMarker: false, unboundFirebaseRequest: true },
      marker: "unbound-firebase",
    },
  ];
  for (const fixture of cases) {
    const decision = preTransmissionBoundaryDecision(fixture.inspection);
    assert.deepEqual(decision, { block: true, marker: fixture.marker });
    assert.ok(["GET", "POST"].includes(fixture.method));
  }
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
    }),
    { block: false, marker: null },
  );
  return {
    preTransmissionProductionGetRejectedCaseCount: 1,
    preTransmissionProductionPostRejectedCaseCount: 1,
    preTransmissionUnboundFirebaseRejectedCaseCount: 1,
    preTransmissionAcceptedStagingCaseCount: 1,
  };
};
const verifyFixtureAuditFreshnessNegativeFixtures = () => {
  const freshness = {
    issuedAt: "2026-08-24T00:00:00.000Z",
    expiresAt: "2026-08-24T01:00:00.000Z",
    maxAgeSeconds: 3600,
    fixedFixtureTime: contract.fixedTime,
  };
  assert.doesNotThrow(() =>
    assertFixtureAuditFreshnessBinding({
      freshness,
      captureBindingFreshness: structuredClone(freshness),
      expectedFixedTime: contract.fixedTime,
    }),
  );
  const mutations = [
    {
      freshness: { ...freshness, unexpected: true },
      captureBindingFreshness: { ...freshness, unexpected: true },
    },
    {
      freshness,
      captureBindingFreshness: {
        ...freshness,
        issuedAt: "2026-08-24T00:00:00.001Z",
      },
    },
    {
      freshness,
      captureBindingFreshness: { ...freshness, unexpected: true },
    },
    {
      freshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:00:00.001Z",
      },
      captureBindingFreshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:00:00.001Z",
      },
    },
    {
      freshness: { ...freshness, maxAgeSeconds: 3599 },
      captureBindingFreshness: { ...freshness, maxAgeSeconds: 3599 },
    },
    {
      freshness: { ...freshness, fixedFixtureTime: "2026-08-17T06:00:00.001Z" },
      captureBindingFreshness: {
        ...freshness,
        fixedFixtureTime: "2026-08-17T06:00:00.001Z",
      },
    },
  ];
  for (const mutation of mutations) {
    assert.throws(() =>
      assertFixtureAuditFreshnessBinding({
        ...mutation,
        expectedFixedTime: contract.fixedTime,
      }),
    );
  }
  return {
    acceptedFreshnessBindingCaseCount: 1,
    rejectedFreshnessMutationCaseCount: mutations.length,
  };
};
const assertNoAppCheckSecretMaterial = (
  textValue,
  { debugToken = "", debugSentinel = "", exchangedToken = "" } = {},
) => {
  const text = String(textValue);
  if (debugToken) {
    assert.equal(
      text.includes(debugToken),
      false,
      "Raw App Check debug token material reached evidence.",
    );
  }
  if (exchangedToken) {
    assert.equal(
      text.includes(exchangedToken),
      false,
      "Raw exchanged App Check token material reached evidence.",
    );
  }
  if (debugSentinel) {
    assert.equal(
      text.includes(debugSentinel),
      false,
      "Raw App Check debug sentinel material reached evidence.",
    );
  }
  assert.doesNotMatch(
    text,
    JWT_PATTERN,
    "Token-shaped App Check material reached evidence.",
  );
};
const sanitizeAppCheckDiagnostic = (
  value,
  debugToken,
  debugSentinel = APP_CHECK_DEBUG_SENTINEL,
  deploymentBypassSecret = "",
) => {
  let sanitized = String(value)
    .replaceAll(debugToken, "[W10P_APPCHECK_DEBUG_TOKEN_REDACTED]")
    .replaceAll(debugSentinel, "[W10P_APPCHECK_DEBUG_SENTINEL_REDACTED]")
    .replace(
      /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu,
      "[W10P_APPCHECK_JWT_REDACTED]",
    );
  if (deploymentBypassSecret) {
    sanitized = sanitized.replaceAll(
      deploymentBypassSecret,
      "[W10P_VERCEL_BYPASS_REDACTED]",
    );
  }
  return sanitized;
};
const verifyAppCheckSecretNegativeFixtures = () => {
  const debugToken = "12345678-1234-4123-8123-123456789abc";
  const exchangedToken = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(
    24,
  )}`;
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${debugToken}`, { debugToken }),
  );
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${exchangedToken}`, {
      exchangedToken,
    }),
  );
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${APP_CHECK_DEBUG_SENTINEL}`, {
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
    }),
  );
  assert.doesNotThrow(() =>
    assertNoAppCheckSecretMaterial(
      JSON.stringify({ debugTokenSha256: secretSha256(debugToken) }),
      { debugToken },
    ),
  );
  return { rejectedRawSecretCaseCount: 3, acceptedSanitizedCaseCount: 1 };
};
const appCheckSecretNegativeSelfTest = verifyAppCheckSecretNegativeFixtures();
const preTransmissionBoundaryNegativeSelfTest =
  verifyPreTransmissionBoundaryNegativeFixtures();
const fixtureAuditFreshnessNegativeSelfTest =
  verifyFixtureAuditFreshnessNegativeFixtures();
const verifyDirectCdpAllHeadersLoopback = async () => {
  for (const name of BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES) {
    delete process.env[name];
  }
  const loopbackBrowserEnvironment = createBrowserChildEnvironment();
  assert.equal(
    BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.filter((name) =>
      Object.hasOwn(loopbackBrowserEnvironment, name),
    ).length,
    0,
  );
  const wireHeaderValues = [];
  const preTransmissionBlockedWirePaths = [];
  const preTransmissionBlockedPaths = new Map([
    ["/production-get", "production"],
    ["/production-post", "production"],
    ["/unbound-firebase", "unbound-firebase"],
  ]);
  const server = createServer((request, response) => {
    const requestPath = new URL(request.url || "/", "http://127.0.0.1")
      .pathname;
    if (preTransmissionBlockedPaths.has(requestPath)) {
      preTransmissionBlockedWirePaths.push(requestPath);
    }
    if (request.url === "/probe") {
      wireHeaderValues.push(request.headers["x-firebase-appcheck"] || "");
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>direct-cdp-probe</title>");
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const probeUrl = `${origin}/probe`;
  const syntheticJwt = `${"a".repeat(24)}.${"b".repeat(24)}.${"c".repeat(24)}`;
  const executablePath =
    args
      .find((item) => item.startsWith("--browser-executable="))
      ?.slice("--browser-executable=".length) ||
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  let loopbackBrowser = null;
  try {
    loopbackBrowser = await chromium.launch({
      executablePath,
      headless: true,
      env: loopbackBrowserEnvironment,
    });
    const context = await loopbackBrowser.newContext({
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const handlerPromises = new Set();
    let preTransmissionBoundaryInspectionCount = 0;
    let preTransmissionBoundaryBlockAttemptCount = 0;
    let preTransmissionBoundaryProductionBlockCount = 0;
    let preTransmissionBoundaryUnboundFirebaseBlockCount = 0;
    let preTransmissionBoundaryFailRequestCount = 0;
    cdp.on("Fetch.requestPaused", (event) => {
      const handlerPromise = (async () => {
        const requestPath = new URL(event.request.url).pathname;
        const syntheticBoundaryMarker =
          preTransmissionBlockedPaths.get(requestPath) || null;
        const preTransmissionInspection = {
          productionMarker: syntheticBoundaryMarker === "production",
          unboundFirebaseRequest:
            syntheticBoundaryMarker === "unbound-firebase",
        };
        const preTransmissionDecision = preTransmissionBoundaryDecision(
          preTransmissionInspection,
        );
        preTransmissionBoundaryInspectionCount += 1;
        if (preTransmissionDecision.block) {
          preTransmissionBoundaryBlockAttemptCount += 1;
          preTransmissionBoundaryProductionBlockCount += Number(
            preTransmissionDecision.marker === "production",
          );
          preTransmissionBoundaryUnboundFirebaseBlockCount += Number(
            preTransmissionDecision.marker === "unbound-firebase",
          );
          await cdp.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          preTransmissionBoundaryFailRequestCount += 1;
          return;
        }
        if (event.request.url !== probeUrl) {
          await cdp.send("Fetch.continueRequest", {
            requestId: event.requestId,
          });
          return;
        }
        const headerEntries = Object.entries(event.request.headers || {}).map(
          ([name, value]) => ({ name, value: String(value) }),
        );
        await cdp.send("Fetch.continueRequest", {
          requestId: event.requestId,
          headers: [
            ...headerEntries,
            { name: "X-Firebase-AppCheck", value: syntheticJwt },
          ],
        });
      })().finally(() => handlerPromises.delete(handlerPromise));
      handlerPromises.add(handlerPromise);
    });
    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    await page.goto(origin);
    const allHeadersObservation = new Promise((resolveObservation, reject) => {
      context.on("request", (request) => {
        if (request.url() !== probeUrl) return;
        request.allHeaders().then((headers) => {
          try {
            assert.equal(headers["x-firebase-appcheck"], syntheticJwt);
            resolveObservation();
          } catch (error) {
            reject(error);
          }
        }, reject);
      });
    });
    await page.evaluate((url) => fetch(url), probeUrl);
    await allHeadersObservation;
    const negativeBoundaryCases = [
      { path: "/production-get", method: "GET", body: null },
      {
        path: "/production-post",
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
      {
        path: "/unbound-firebase",
        method: "POST",
        body: `sensitive=${syntheticJwt}`,
      },
    ];
    for (const negativeCase of negativeBoundaryCases) {
      const rejectedBeforeWire = await page.evaluate(
        async ({ url, method, body, syntheticHeader }) => {
          try {
            await fetch(url, {
              method,
              headers: { "X-Firebase-AppCheck": syntheticHeader },
              ...(body === null ? {} : { body }),
            });
            return false;
          } catch (_error) {
            return true;
          }
        },
        {
          url: `${origin}${negativeCase.path}`,
          method: negativeCase.method,
          body: negativeCase.body,
          syntheticHeader: syntheticJwt,
        },
      );
      assert.equal(rejectedBeforeWire, true);
    }
    while (handlerPromises.size > 0) {
      await Promise.all([...handlerPromises]);
    }
    assert.deepEqual(wireHeaderValues, [syntheticJwt]);
    assert.deepEqual(preTransmissionBlockedWirePaths, []);
    assert.ok(preTransmissionBoundaryInspectionCount >= 5);
    assert.equal(preTransmissionBoundaryBlockAttemptCount, 3);
    assert.equal(preTransmissionBoundaryProductionBlockCount, 2);
    assert.equal(preTransmissionBoundaryUnboundFirebaseBlockCount, 1);
    assert.equal(preTransmissionBoundaryFailRequestCount, 3);
    await cdp.send("Fetch.disable");
    await cdp.detach();
    await context.close();
  } finally {
    if (loopbackBrowser) await loopbackBrowser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  return {
    directCdpHeaderObservedByRequestAllHeaders: true,
    directCdpHeaderObservedOnWire: true,
    serviceWorkerPolicy: "block",
    playwrightRouteRegistrationCount: 0,
    childProcessSecretEnvScrubbed: true,
    browserChildEnvironmentAllowlisted: true,
    browserChildEnvironmentUnexpectedKeyCount: 0,
    browserChildSecretEnvironmentVariableCount: 0,
    preTransmissionProductionGetBlockedBeforeWireCount: 1,
    preTransmissionProductionPostBlockedBeforeWireCount: 1,
    preTransmissionUnboundFirebaseBlockedBeforeWireCount: 1,
    preTransmissionBlockedWireRequestCount: 0,
    externalNetworkAccess: 0,
  };
};
if (args.includes("--self-test-app-check-cdp")) {
  console.log(
    JSON.stringify({
      suite: "w10p-app-check-direct-cdp-loopback",
      passed: true,
      ...(await verifyDirectCdpAllHeadersLoopback()),
    }),
  );
  process.exit(0);
}
if (args.includes("--self-test-app-check")) {
  console.log(
    JSON.stringify({
      suite: "w10p-app-check-capture-secret-self-test",
      passed: true,
      ...appCheckSecretNegativeSelfTest,
      ...preTransmissionBoundaryNegativeSelfTest,
      ...fixtureAuditFreshnessNegativeSelfTest,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
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
const exactVercelOrigin = (value) => {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.ok(!parsed.port || parsed.port === "443");
  assert.ok(parsed.hostname.toLowerCase().endsWith(".vercel.app"));
  return parsed.origin;
};
const vercelBypassAllowedOrigins = [
  ...new Set(
    [baselineDeploymentUrl, candidateDeploymentUrl, contract.stableAlias].map(
      exactVercelOrigin,
    ),
  ),
].sort();
const VERCEL_BYPASS_TRANSPORT_CONTRACT = {
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  originMatch: "exact",
};
const isVercelBypassEligibleUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (_error) {
    return false;
  }
  return (
    parsed.protocol === VERCEL_BYPASS_TRANSPORT_CONTRACT.requiredProtocol &&
    !parsed.username &&
    !parsed.password &&
    VERCEL_BYPASS_TRANSPORT_CONTRACT.allowedPorts.includes(parsed.port) &&
    vercelBypassAllowedOrigins.includes(parsed.origin)
  );
};
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

const appCheckDebugToken = String(
  process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN || "",
).trim();
const appCheckDebugTokenSha256 = secretSha256(appCheckDebugToken);
delete process.env.W10P_VISUAL_APPCHECK_DEBUG_TOKEN;
assert.equal(
  APP_CHECK_DEBUG_TOKEN_PATTERN.test(appCheckDebugToken),
  true,
  "A strong registered UUIDv4 App Check debug token is required.",
);
assert.equal(
  process.argv.some((argument) => argument.includes(appCheckDebugToken)),
  false,
  "The App Check debug token must not be passed in argv.",
);
assert.equal(
  String(process.env.DEBUG || "").trim(),
  "",
  "DEBUG must be unset so Playwright CDP parameters cannot be logged.",
);
assertNoAppCheckSecretMaterial(fixtureAuditText, {
  debugToken: appCheckDebugToken,
});

let credentialsEnvironmentJson = String(
  process.env.W10P_VISUAL_CREDENTIALS_JSON || "{}",
);
delete process.env.W10P_VISUAL_CREDENTIALS_JSON;
const credentials = JSON.parse(credentialsEnvironmentJson);
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
let firebaseConfigEnvironmentJson = String(
  process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON || "{}",
);
delete process.env.W10P_VISUAL_FIREBASE_CONFIG_JSON;
const firebaseConfig = JSON.parse(firebaseConfigEnvironmentJson);
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
assert.equal(
  firebaseConfig.appId,
  STAGING_APP_ID,
  "The visual login config must use the dedicated staging Firebase web app.",
);
assert.ok(
  String(firebaseConfig.authDomain).includes(contract.firebaseProjectId),
  "The visual login authDomain must belong to the staging Firebase project.",
);
assert.match(
  String(firebaseConfig.storageBucket),
  new RegExp(
    `^${contract.firebaseProjectId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    )}\\.(?:appspot\\.com|firebasestorage\\.app)$`,
    "u",
  ),
  "The visual login storageBucket must be an exact staging Firebase bucket.",
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
const createCaptureAppCheckTokenManager = () => {
  const requireFromFunctions = createRequire(resolve("functions/package.json"));
  const { applicationDefault, deleteApp, initializeApp } =
    requireFromFunctions("firebase-admin/app");
  const { getAppCheck } = requireFromFunctions("firebase-admin/app-check");
  const adminApp = initializeApp(
    {
      credential: applicationDefault(),
      projectId: contract.firebaseProjectId,
    },
    `w10p-capture-app-check-${process.pid}`,
  );
  const adminAppCheck = getAppCheck(adminApp);
  let token = "";
  let expiresAt = 0;
  let exchangeRequestCount = 0;
  let exchangeHttp200Count = 0;
  let adminVerificationCount = 0;
  let exchangePromise = null;
  const issuedTokenHashes = new Set();
  const exchangeEndpoint = `https://content-firebaseappcheck.googleapis.com/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken`;
  const verifiedAudienceSet = [
    `projects/${contract.firebaseProjectId}`,
    `projects/${STAGING_PROJECT_NUMBER}`,
  ].sort();
  const verifiedIssuer = `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`;
  const exchangeTransportContract = {
    method: "POST",
    contentType: "application/json",
    queryKeys: ["key"],
    requiredRequestHeaders: { "Content-Type": "application/json" },
    optionalRequestHeaders: ["X-Firebase-Client"],
    originHeaderPolicy: "exact-stable-alias-origin",
    refererHeaderPolicy: "exact-stable-alias-origin-slash",
    redirectMode: "error",
    requestBodyKeys: ["debug_token"],
    expectedStatus: 200,
    requiredResponseBodyKeys: ["token", "ttl"],
    ttlPattern: "^([\\d.]+)s$",
  };
  const exchange = async () => {
    token = "";
    expiresAt = 0;
    exchangeRequestCount += 1;
    const response = await fetch(
      `${exchangeEndpoint}?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(contract.stableAlias).origin,
          referer: `${new URL(contract.stableAlias).origin}/`,
        },
        body: JSON.stringify({ debug_token: appCheckDebugToken }),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    assert.equal(
      response.status,
      200,
      `The registered capture App Check debug token exchange failed with HTTP ${response.status}.`,
    );
    exchangeHttp200Count += 1;
    let payload = await response.json();
    token = String(payload?.token || "");
    assert.equal(
      APP_CHECK_JWT_SHAPE_PATTERN.test(token),
      true,
      "The capture App Check token is invalid.",
    );
    const ttlMatch = String(payload?.ttl || "").match(/^([\d.]+)s$/u);
    assert.ok(ttlMatch, "The capture App Check TTL is invalid.");
    const ttlSeconds = Number(ttlMatch[1]);
    assert.ok(ttlSeconds > 0 && ttlSeconds <= 7 * 24 * 60 * 60);
    const verification = await adminAppCheck.verifyToken(token);
    adminVerificationCount += 1;
    const decoded = verification?.token || {};
    assert.equal(verification?.appId, STAGING_APP_ID);
    assert.equal(decoded.app_id, STAGING_APP_ID);
    assert.equal(decoded.sub, STAGING_APP_ID);
    assert.deepEqual(
      [...new Set(decoded.aud || [])].sort(),
      verifiedAudienceSet,
    );
    assert.equal(decoded.iss, verifiedIssuer);
    const issuedAt = Number(decoded.iat || 0);
    expiresAt = Number(decoded.exp || 0);
    const now = Math.floor(Date.now() / 1_000);
    assert.ok(Number.isSafeInteger(issuedAt) && issuedAt <= now + 60);
    assert.ok(Number.isSafeInteger(expiresAt) && expiresAt >= now + 5 * 60);
    assert.ok(Math.abs(expiresAt - issuedAt - ttlSeconds) <= 5);
    issuedTokenHashes.add(secretSha256(token));
    payload = null;
  };
  return {
    async ensureFresh() {
      const now = Math.floor(Date.now() / 1_000);
      if (!token || expiresAt - now < 5 * 60) {
        exchangePromise ||= exchange().finally(() => {
          exchangePromise = null;
        });
        await exchangePromise;
      }
      return token;
    },
    matchesIssuedToken(candidate) {
      return (
        APP_CHECK_JWT_SHAPE_PATTERN.test(String(candidate || "")) &&
        issuedTokenHashes.has(secretSha256(candidate))
      );
    },
    get binding() {
      return {
        status: "VERIFIED_EXCHANGED",
        appCheckBound: true,
        debugTokenSha256: appCheckDebugTokenSha256,
        verifiedAppIdHash: secretSha256(STAGING_APP_ID),
        verifiedProjectIdHash: secretSha256(contract.firebaseProjectId),
        verifiedProjectNumberHash: secretSha256(STAGING_PROJECT_NUMBER),
        verifiedAudienceSetHash: secretSha256(
          canonicalJson(verifiedAudienceSet),
        ),
        verifiedIssuerHash: secretSha256(verifiedIssuer),
        exchangeOriginHash: secretSha256(new URL(contract.stableAlias).origin),
        exchangeEndpointHash: secretSha256(exchangeEndpoint),
        exchangeTransportContractHash: secretSha256(
          canonicalJson(exchangeTransportContract),
        ),
        exchangeRequestCount,
        exchangeHttp200Count,
        adminVerificationCount,
        refreshCount: Math.max(0, exchangeRequestCount - 1),
        minimumRemainingLifetimeSeconds: 5 * 60,
        allExchangesHttp200: exchangeRequestCount === exchangeHttp200Count,
        allExchangesAdminVerified:
          exchangeRequestCount === adminVerificationCount,
        tokenValidAtExchange: true,
        tokenJwtShapeValid: true,
        tokenLifetimeMatchedTtl: true,
        localStorageSecretWriteCount: browserLocalStorageSecretWriteCount,
      };
    },
    async close() {
      token = "";
      expiresAt = 0;
      issuedTokenHashes.clear();
      await deleteApp(adminApp);
    },
  };
};
const bypassSecret = String(
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
).trim();
delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
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
const canonicalBackupDouble = (value) => {
  if (Number.isNaN(value)) return "NaN";
  if (value === Infinity) return "Infinity";
  if (value === -Infinity) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
};
const canonicalizeBackupValue = (value) => {
  if (value === null) return ["null"];
  if (value === undefined) return ["undefined"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["integer", value.toString()];
  if (typeof value === "number")
    return ["double", canonicalBackupDouble(value)];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (Array.isArray(value))
    return ["array", value.map(canonicalizeBackupValue)];
  if (
    value?.constructor?.name === "Timestamp" &&
    Number.isFinite(value.seconds) &&
    Number.isFinite(value.nanoseconds)
  ) {
    return ["timestamp", String(value.seconds), String(value.nanoseconds)];
  }
  if (
    value?.constructor?.name === "DocumentReference" &&
    typeof value.path === "string"
  ) {
    return ["reference", String(value.formattedName || value.path)];
  }
  if (
    value?.constructor?.name === "GeoPoint" &&
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude)
  ) {
    return [
      "geoPoint",
      canonicalBackupDouble(value.latitude),
      canonicalBackupDouble(value.longitude),
    ];
  }
  if (Buffer.isBuffer(value)) return ["bytes", value.toString("base64")];
  if (value?.constructor?.name === "Bytes" && value.toBase64) {
    return ["bytes", value.toBase64()];
  }
  if (
    value?.constructor?.name === "VectorValue" &&
    typeof value.toArray === "function"
  ) {
    return ["vector", value.toArray().map(canonicalBackupDouble)];
  }
  if (value && typeof value === "object") {
    return [
      "map",
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalizeBackupValue(value[key])]),
    ];
  }
  throw new TypeError("Unsupported Firestore backup value type.");
};
const canonicalBackupJson = (value) =>
  JSON.stringify(canonicalizeBackupValue(value));
const listEvidenceFiles = (root, current = root) =>
  readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) return listEvidenceFiles(root, absolute);
    assert.equal(
      entry.isFile(),
      true,
      "The evidence root contains a non-file filesystem entry.",
    );
    return [relative(root, absolute).replaceAll("\\", "/")];
  });
const FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT = `https://content-firebaseappcheck.googleapis.com/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken`;
const FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET = [
  `projects/${contract.firebaseProjectId}`,
  `projects/${STAGING_PROJECT_NUMBER}`,
].sort();
const FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT = {
  method: "POST",
  contentType: "application/json",
  queryKeys: ["key"],
  requiredRequestHeaders: { "Content-Type": "application/json" },
  optionalRequestHeaders: ["X-Firebase-Client"],
  originHeaderPolicy: "exact-stable-alias-origin",
  refererHeaderPolicy: "exact-stable-alias-origin-slash",
  redirectMode: "error",
  requestBodyKeys: ["debug_token"],
  expectedStatus: 200,
  requiredResponseBodyKeys: ["token", "ttl"],
  ttlPattern: "^([\\d.]+)s$",
};
const BASELINE_APP_CHECK_BRIDGE_SCOPE = {
  schemaVersion: 1,
  baselinePresentationSha: "676869fa289d3e7ecef234cbb5cca65c60ec4597",
  reason: "baseline-presentation-source-has-no-app-check-initialization",
  firebaseProjectId: contract.firebaseProjectId,
  allowedServices: ["firestore", "functions", "storage"],
  allowedHosts: [
    "firestore.googleapis.com",
    "firebasestorage.googleapis.com",
    `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net`,
  ],
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  excludedMethods: ["OPTIONS"],
  firestoreDatabaseBoundaryHash: sha256(
    `projects/${contract.firebaseProjectId}/databases/(default)`,
  ),
  storageBucketHash: sha256(firebaseConfig.storageBucket),
  storagePathBoundaryHash: sha256(`/v0/b/${firebaseConfig.storageBucket}/o`),
  functionsPathRuleHash: sha256("single-callable-path-segment-v1"),
  interceptionMechanism: "cdp-fetch-request-stage",
  headerCorrelationMechanism: "playwright-request-allHeaders",
  urlMethodFifoCorrelationAllowed: false,
  redirectHeaderOverridePropagation: false,
  redirectPolicyHash: sha256(
    "abort-before-send-every-redirect-from-bridge-injected-request-v1",
  ),
  serviceWorkerPolicy: "block",
  candidateBridgeAllowed: false,
};
assert.equal(
  contract.productionPresentationSha,
  BASELINE_APP_CHECK_BRIDGE_SCOPE.baselinePresentationSha,
);
const baselineAppCheckBridgeScopeHash = sha256(
  Buffer.from(canonicalJson(BASELINE_APP_CHECK_BRIDGE_SCOPE)),
);
const preTransmissionNetworkBoundaryAttestationHash = sha256(
  Buffer.from(canonicalJson(PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION)),
);
const BROWSER_APP_CHECK_CDP_SECURITY_SCOPE = {
  schemaVersion: 1,
  interceptionMechanism: "cdp-fetch-request-stage",
  preTransmissionNetworkBoundaryAttestationHash,
  secretInitScope: "primary-page-only",
  browserGlobalValueKind: "non-secret-fixed-sentinel",
  debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
  exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
  exchangeApiKeyHash: sha256(firebaseConfig.apiKey),
  exchangeMethod: "POST",
  exchangeQueryKeys: ["key"],
  exchangeContentType: "application/json",
  exchangeRequestBodyKeys: ["debug_token"],
  replacementEncoding: "base64-utf8-json",
  appCheckHeaderAllowedScopeHashes: [
    baselineAppCheckBridgeScopeHash,
    sha256(
      canonicalJson({
        hosts: ["identitytoolkit.googleapis.com", "securetoken.googleapis.com"],
        apiKeyHash: sha256(firebaseConfig.apiKey),
        identityToolkitPathRule: "/v[12]/accounts:<operation>",
        secureTokenPath: "/v1/token",
        requiredProtocol: "https:",
        allowedPorts: ["", "443"],
        userinfoAllowed: false,
      }),
    ),
  ].sort(),
  rawDebugTokenRendererInjectionAllowed: false,
  sensitiveResponseInterception: true,
  sensitiveRedirectPolicyHash: sha256(
    "abort-before-send-any-redirect-for-debug-body-or-app-check-header-v1",
  ),
  protocolDebugLoggingAllowed: false,
  browserChildSecretEnvironmentScrubRequired: true,
  browserChildEnvironmentAllowlistHash: sha256(
    canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
  ),
  browserGlobalExtraHttpHeadersAllowed: false,
  vercelBypassInjectionMechanism: "cdp-fetch-exact-origin-only",
  vercelBypassAllowedOriginSetHash: sha256(
    canonicalJson(vercelBypassAllowedOrigins),
  ),
  vercelBypassTransportContractHash: sha256(
    canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
  ),
  vercelBypassRedirectPolicyHash: sha256(
    "abort-before-send-any-redirect-for-cdp-injected-vercel-bypass-v1",
  ),
  monitoredTargetKind: "primary-page-target-only",
  monitorTerminationMechanism: "context-close-with-fetch-enabled",
  targetDiscoveryMechanism: "cdp-target-created-cumulative",
  retainedTargetSnapshotCrossCheck: true,
  unexpectedPagePolicy: "zero",
  dedicatedWorkerPolicy: "zero",
  sharedWorkerPolicy: "zero",
  serviceWorkerTargetPolicy: "zero",
  crossOriginFramePolicy: "zero",
  oopifTargetPolicy: "zero",
  playwrightRouteInterceptionAllowed: false,
  traceWriteAllowed: false,
  harWriteAllowed: false,
  storageStateWriteAllowed: false,
};
const browserAppCheckCdpSecurityScopeHash = sha256(
  Buffer.from(canonicalJson(BROWSER_APP_CHECK_CDP_SECURITY_SCOPE)),
);
const backupAccessProbeCanary = (kind) => {
  const revisionHash = sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\nbackup-access-${kind}-canary-v1`,
  );
  const documentId = sha256(`${revisionHash}\ndocument`);
  const data = {
    schemaVersion: 1,
    fixtureOwner: "w10p-visual-parity",
    fixtureId: contract.fixtureId,
    fixtureRevision: contract.fixtureRevision,
    canaryPurpose: `backup-access-${kind}-deny-probe`,
    canaryRevision: revisionHash,
    payloadSentinelHash: sha256(
      `${contract.fixtureId}\n${contract.fixtureRevision}\n${kind}\npayload`,
    ),
  };
  return {
    revisionHash,
    path: `w10p_visual_fixture_backups/${contract.fixtureId}/documents/${documentId}`,
    documentHash: sha256(Buffer.from(canonicalBackupJson(data))),
  };
};
const verifyBackupHashKnownVectors = () => {
  const canaryVectors = [
    [
      "existing-update-delete",
      "a64dd06032f8d72c981a05f4fb59c0e8cd516f6ada1266d4fffa5654f0de931a",
      "af573ffe4c29aa45b0859cdce167f9504697aa729b35ba12288d45274e1dee2d",
    ],
    [
      "absent-create",
      "f5f4ba73a1b23a33e72d3a0287bd196a19316250937a3190b4b8ff015ccafb24",
      "0987a826ae977395ba7e064ce1b1734fc8e81159ed17ab67db0959fb9bfd71bd",
    ],
    [
      "pre-backup-existing-update-delete",
      "0bd618252e9b5c8d1be515b4db0c7743e6d6f330228ce96b4d6d2f3cea58f3aa",
      "ba5a118158a41378bb03ebd51af8319d9d52d71206063beb2d8c86712142887a",
    ],
    [
      "pre-backup-absent-create",
      "415e0746cbef40610b4fdd7e1e17572bf35d1cf6c45fd62c0187c021a199497b",
      "fec5142c3082251f5e4cf603651debe41de1bf557b0c0aa762319c61b5412630",
    ],
  ];
  for (const [kind, backupHash, genericHash] of canaryVectors) {
    const actual = backupAccessProbeCanary(kind).documentHash;
    assert.equal(actual, backupHash, `${kind} backup hash drifted.`);
    assert.notEqual(
      actual,
      genericHash,
      `${kind} must retain Firestore backup type tags.`,
    );
  }
  const probeRevisionHash = sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\npre-backup-access-probe-v1`,
  );
  const positiveControlData = {
    schemaVersion: 1,
    fixtureOwner: "w10p-visual-parity",
    fixtureId: contract.fixtureId,
    fixtureRevision: contract.fixtureRevision,
    fixturePurpose: "pre-backup-positive-control",
    probeRevision: probeRevisionHash,
    sentinelHash: sha256(`${probeRevisionHash}\npositive-control-sentinel`),
  };
  const positiveControlHash = sha256(
    Buffer.from(canonicalBackupJson(positiveControlData)),
  );
  assert.equal(
    positiveControlHash,
    "a7aeff4656ddf93f04b09f12eeb72ede57b0e57472f2b85a49c0ec341bb3c171",
    "The pre-backup positive-control backup hash drifted.",
  );
  assert.notEqual(
    positiveControlHash,
    sha256(Buffer.from(canonicalJson(positiveControlData))),
    "The pre-backup positive control must retain Firestore backup type tags.",
  );
  return canaryVectors.length + 1;
};
const POST_BACKUP_PROBE_EXACT = {
  status: "VERIFIED_DENIED",
  probeKind: "synthetic-fixture-id-token-backup-read-update-delete-create",
  sessionBound: true,
  appCheckBound: true,
  appCheckExchangeHttpStatus: 200,
  appCheckExchangeRequestCount: 1,
  appCheckAdminVerificationCount: 1,
  appCheckProjectBindingVerified: true,
  appCheckAppBindingVerified: true,
  appCheckTokenValidAtVerification: true,
  appCheckTokenLifetimeWithinMaximum: true,
  appCheckHeaderRequestCount: 4,
  readDenied: true,
  writeDenied: true,
  updateDenied: true,
  deleteDenied: true,
  createDenied: true,
  readHttpStatus: 403,
  readFirestoreStatus: "PERMISSION_DENIED",
  updateHttpStatus: 403,
  updateFirestoreStatus: "PERMISSION_DENIED",
  deleteHttpStatus: 403,
  deleteFirestoreStatus: "PERMISSION_DENIED",
  createHttpStatus: 403,
  createFirestoreStatus: "PERMISSION_DENIED",
  existingCanaryOriginalHashPreserved: true,
  requestCount: 6,
  identityRequestCount: 1,
  accessRequestCount: 4,
  readRequestCount: 1,
  writeRequestCount: 3,
  updateRequestCount: 1,
  deleteRequestCount: 1,
  createRequestCount: 1,
  adminCanarySetupWriteCount: 1,
  conditionalCanaryCleanupWriteCount: 1,
  canaryOwnershipMismatchCount: 0,
  canaryResidualCount: 0,
  temporarySessionWriteCount: 2,
  temporarySessionCleanupWriteCount: 1,
  temporarySessionResidualCount: 0,
  rawTokenOutputCount: 0,
  rawAppCheckDebugTokenOutputCount: 0,
  rawAppCheckJwtOutputCount: 0,
  rawResponseBodyOutputCount: 0,
  rawDocumentPathOutputCount: 0,
  rawCanaryDocumentOutputCount: 0,
  rawPiiOutputCount: 0,
};
const POST_BACKUP_PROBE_HASH_FIELDS = [
  "appCheckDebugTokenHash",
  "verifiedAppIdHash",
  "verifiedProjectIdHash",
  "verifiedProjectNumberHash",
  "verifiedAudienceSetHash",
  "verifiedIssuerHash",
  "exchangeEndpointHash",
  "exchangeTransportContractHash",
  "projectIdHash",
  "identityUidHash",
  "backupNamespaceHash",
  "backupManifestHash",
  "localRulesSourceHash",
  "probeSessionPathHash",
  "readDocumentPathHash",
  "existingWriteCanaryPathHash",
  "absentWriteCanaryPathHash",
  "existingWriteCanaryRevisionHash",
  "absentWriteCanaryRevisionHash",
  "existingWriteCanaryDocumentHash",
  "absentWriteCanaryDocumentHash",
];
const PRE_BACKUP_PROBE_EXACT = {
  status: "VERIFIED_DENIED",
  probeKind:
    "ephemeral-synthetic-id-token-pre-backup-read-update-delete-create",
  sessionBound: true,
  appCheckBound: true,
  appCheckExchangeHttpStatus: 200,
  appCheckExchangeRequestCount: 1,
  appCheckAdminVerificationCount: 1,
  appCheckProjectBindingVerified: true,
  appCheckAppBindingVerified: true,
  appCheckTokenValidAtVerification: true,
  appCheckTokenLifetimeWithinMaximum: true,
  appCheckHeaderRequestCount: 6,
  positiveControlPassed: true,
  positiveControlHttpStatus: 200,
  positiveControlSentinelMatched: true,
  positiveControlOriginalHashPreserved: true,
  readDenied: true,
  existingReadDenied: true,
  absentReadDenied: true,
  writeDenied: true,
  updateDenied: true,
  deleteDenied: true,
  createDenied: true,
  existingReadHttpStatus: 403,
  existingReadFirestoreStatus: "PERMISSION_DENIED",
  absentReadHttpStatus: 403,
  absentReadFirestoreStatus: "PERMISSION_DENIED",
  updateHttpStatus: 403,
  updateFirestoreStatus: "PERMISSION_DENIED",
  deleteHttpStatus: 403,
  deleteFirestoreStatus: "PERMISSION_DENIED",
  createHttpStatus: 403,
  createFirestoreStatus: "PERMISSION_DENIED",
  existingCanaryOriginalHashPreserved: true,
  requestCount: 8,
  identityRequestCount: 1,
  accessRequestCount: 6,
  readRequestCount: 2,
  writeRequestCount: 3,
  positiveControlReadRequestCount: 1,
  existingReadRequestCount: 1,
  absentReadRequestCount: 1,
  updateRequestCount: 1,
  deleteRequestCount: 1,
  createRequestCount: 1,
  ephemeralAuthWriteCount: 3,
  ephemeralAuthSetupWriteCount: 2,
  ephemeralAuthCleanupWriteCount: 1,
  ephemeralAuthResidualCount: 0,
  ephemeralProfileWriteCount: 2,
  ephemeralProfileSetupWriteCount: 1,
  ephemeralProfileCleanupWriteCount: 1,
  ephemeralProfileResidualCount: 0,
  positiveControlWriteCount: 2,
  positiveControlSetupWriteCount: 1,
  positiveControlCleanupWriteCount: 1,
  positiveControlResidualCount: 0,
  temporarySessionWriteCount: 2,
  temporarySessionCleanupWriteCount: 1,
  temporarySessionResidualCount: 0,
  adminCanarySetupWriteCount: 1,
  conditionalCanaryCleanupWriteCount: 1,
  canaryResidualCount: 0,
  ownershipMismatchCount: 0,
  rawBackupWriteCount: 0,
  rawTokenOutputCount: 0,
  rawAppCheckDebugTokenOutputCount: 0,
  rawAppCheckJwtOutputCount: 0,
  rawResponseBodyOutputCount: 0,
  rawDocumentPathOutputCount: 0,
  rawCanaryDocumentOutputCount: 0,
  rawPiiOutputCount: 0,
};
const PRE_BACKUP_PROBE_HASH_FIELDS = [
  "appCheckDebugTokenHash",
  "verifiedAppIdHash",
  "verifiedProjectIdHash",
  "verifiedProjectNumberHash",
  "verifiedAudienceSetHash",
  "verifiedIssuerHash",
  "exchangeEndpointHash",
  "exchangeTransportContractHash",
  "projectIdHash",
  "identityUidHash",
  "identityEmailHash",
  "backupNamespaceHash",
  "localRulesSourceHash",
  "probeRevisionHash",
  "probeProfilePathHash",
  "probeSessionPathHash",
  "positiveControlPathHash",
  "positiveControlSentinelHash",
  "positiveControlDocumentHash",
  "existingWriteCanaryPathHash",
  "absentWriteCanaryPathHash",
  "existingWriteCanaryRevisionHash",
  "absentWriteCanaryRevisionHash",
  "existingWriteCanaryDocumentHash",
  "absentWriteCanaryDocumentHash",
];
const assertExactBackupProbeAttestation = ({
  probe,
  exact,
  hashFields,
  expected,
  label,
}) => {
  assert.ok(
    probe && typeof probe === "object" && !Array.isArray(probe),
    `${label} is missing.`,
  );
  assert.deepEqual(
    Object.keys(probe).sort(),
    [...Object.keys(exact), ...hashFields, "attestationHash"].sort(),
    `${label} schema drifted.`,
  );
  for (const [field, value] of Object.entries(exact)) {
    assert.equal(probe[field], value, `${label} ${field} is invalid.`);
  }
  for (const field of [...hashFields, "attestationHash"]) {
    assert.match(
      probe[field],
      /^[a-f0-9]{64}$/u,
      `${label} ${field} must be SHA-256.`,
    );
  }
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(probe[field], value, `${label} ${field} is invalid.`);
  }
  const { attestationHash, ...projection } = probe;
  assert.equal(
    sha256(Buffer.from(canonicalJson(projection))),
    attestationHash,
    `${label} attestation hash is invalid.`,
  );
  return attestationHash;
};
const assertBackupAccessProbeAttestation = (probe, expected) =>
  assertExactBackupProbeAttestation({
    probe,
    exact: POST_BACKUP_PROBE_EXACT,
    hashFields: POST_BACKUP_PROBE_HASH_FIELDS,
    expected,
    label: "The post-backup namespace access probe",
  });
const assertPreBackupAccessProbeAttestation = (probe, expected) =>
  assertExactBackupProbeAttestation({
    probe,
    exact: PRE_BACKUP_PROBE_EXACT,
    hashFields: PRE_BACKUP_PROBE_HASH_FIELDS,
    expected,
    label: "The pre-backup namespace access probe",
  });
const verifyBackupAccessProbeNegativeFixtures = () => {
  const backupHashKnownVectorCount = verifyBackupHashKnownVectors();
  const hash = "a".repeat(64);
  const attest = (projection) => ({
    ...projection,
    attestationHash: sha256(Buffer.from(canonicalJson(projection))),
  });
  const postProjection = {
    ...POST_BACKUP_PROBE_EXACT,
    ...Object.fromEntries(
      POST_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
    ),
  };
  const valid = attest(postProjection);
  const postExpected = Object.fromEntries(
    POST_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
  );
  assert.doesNotThrow(() =>
    assertBackupAccessProbeAttestation(valid, postExpected),
  );
  const postInvalid = [
    null,
    attest({ ...postProjection, status: "NOT_EXECUTED" }),
    attest({ ...postProjection, appCheckBound: false }),
    attest({ ...postProjection, appCheckHeaderRequestCount: 3 }),
    attest({ ...postProjection, appCheckExchangeRequestCount: 0 }),
    attest({ ...postProjection, appCheckAdminVerificationCount: 0 }),
    attest({ ...postProjection, rawAppCheckDebugTokenOutputCount: 1 }),
    attest({ ...postProjection, rawAppCheckJwtOutputCount: 1 }),
    Object.fromEntries(
      Object.entries(valid).filter(([field]) => field !== "writeDenied"),
    ),
    attest({ ...postProjection, readDenied: false }),
    attest({ ...postProjection, writeDenied: false }),
    attest({ ...postProjection, updateDenied: false }),
    attest({ ...postProjection, deleteDenied: false }),
    attest({ ...postProjection, createDenied: false }),
    attest({ ...postProjection, createHttpStatus: 200 }),
    attest({ ...postProjection, writeRequestCount: 2 }),
    attest({ ...postProjection, canaryResidualCount: 1 }),
    attest({ ...postProjection, temporarySessionResidualCount: 1 }),
    { ...valid, requestCount: 4 },
    attest({
      ...postProjection,
      existingWriteCanaryPathHash: "b".repeat(64),
    }),
    attest({ ...postProjection, exchangeEndpointHash: "b".repeat(64) }),
    attest({
      ...postProjection,
      exchangeTransportContractHash: "b".repeat(64),
    }),
  ];
  for (const invalid of postInvalid) {
    assert.throws(() =>
      assertBackupAccessProbeAttestation(invalid, postExpected),
    );
  }
  const preProjection = {
    ...PRE_BACKUP_PROBE_EXACT,
    ...Object.fromEntries(
      PRE_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
    ),
  };
  const validPre = attest(preProjection);
  const preExpected = Object.fromEntries(
    PRE_BACKUP_PROBE_HASH_FIELDS.map((field) => [field, hash]),
  );
  assert.doesNotThrow(() =>
    assertPreBackupAccessProbeAttestation(validPre, preExpected),
  );
  const preInvalid = [
    null,
    attest({ ...preProjection, status: "NOT_EXECUTED" }),
    attest({ ...preProjection, appCheckBound: false }),
    attest({ ...preProjection, appCheckHeaderRequestCount: 5 }),
    attest({ ...preProjection, appCheckExchangeRequestCount: 0 }),
    attest({ ...preProjection, appCheckAdminVerificationCount: 0 }),
    attest({ ...preProjection, rawAppCheckDebugTokenOutputCount: 1 }),
    attest({ ...preProjection, rawAppCheckJwtOutputCount: 1 }),
    attest({ ...preProjection, positiveControlPassed: false }),
    attest({ ...preProjection, positiveControlHttpStatus: 403 }),
    attest({ ...preProjection, positiveControlSentinelMatched: false }),
    Object.fromEntries(
      Object.entries(validPre).filter(
        ([field]) => field !== "rawBackupWriteCount",
      ),
    ),
    attest({ ...preProjection, readDenied: false }),
    attest({ ...preProjection, absentReadDenied: false }),
    attest({ ...preProjection, writeDenied: false }),
    attest({ ...preProjection, updateDenied: false }),
    attest({ ...preProjection, deleteDenied: false }),
    attest({ ...preProjection, createDenied: false }),
    attest({ ...preProjection, rawBackupWriteCount: 1 }),
    attest({ ...preProjection, ephemeralAuthResidualCount: 1 }),
    attest({ ...preProjection, ephemeralProfileResidualCount: 1 }),
    attest({ ...preProjection, temporarySessionResidualCount: 1 }),
    attest({ ...preProjection, positiveControlResidualCount: 1 }),
    attest({ ...preProjection, canaryResidualCount: 1 }),
    attest({ ...preProjection, writeRequestCount: 2 }),
    { ...validPre, requestCount: 5 },
    attest({ ...preProjection, probeRevisionHash: "b".repeat(64) }),
    attest({ ...preProjection, verifiedAudienceSetHash: "b".repeat(64) }),
    attest({
      ...preProjection,
      exchangeTransportContractHash: "b".repeat(64),
    }),
  ];
  for (const invalid of preInvalid) {
    assert.throws(() =>
      assertPreBackupAccessProbeAttestation(invalid, preExpected),
    );
  }
  return {
    backupHashKnownVectorCount,
    postBackupNegativeCaseCount: postInvalid.length,
    preBackupNegativeCaseCount: preInvalid.length,
  };
};
const backupAccessProbeNegativeSelfTest =
  verifyBackupAccessProbeNegativeFixtures();
if (args.includes("--self-test-backup-probe")) {
  console.log(
    JSON.stringify({
      suite: "w10p-backup-access-probe-capture-self-test",
      passed: true,
      ...backupAccessProbeNegativeSelfTest,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
const fixtureAuditSha256 = sha256(fixtureAuditBytes);
assert.equal(fixtureAudit.suite, "w10p-visual-fixture-audit");
assert.equal(fixtureAudit.passed, true);
assert.equal(
  fixtureAudit.artifactSchemaVersion,
  "w10p-visual-fixture-audit-v2",
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
assert.deepEqual(
  Object.keys(fixtureAudit.captureBinding || {}).sort(),
  [
    "fixtureNamespace",
    "fixtureRevision",
    "projectId",
    "planHash",
    "authAllowedUidSetHash",
    "authManifestHash",
    "authFixtureIdentityScopeManifestHash",
    "fixtureDocumentCount",
    "documentProjectionHash",
    "plannedMutationTopologyAllowlistHash",
    "plannedMutationTopologyObservedHash",
    "plannedMutationTopologyBaselineHash",
    "strictCollectionCount",
    "strictExpectedRowCount",
    "strictActualRowCount",
    "strictAllowlistManifestHash",
    "strictManifestHash",
    "presentationAttestationHash",
    "privacyAttestationHash",
    "appCheckDebugTokenHash",
    "verifiedAppIdHash",
    "verifiedProjectIdHash",
    "verifiedProjectNumberHash",
    "verifiedAudienceSetHash",
    "verifiedIssuerHash",
    "exchangeEndpointHash",
    "exchangeTransportContractHash",
    "preBackupNamespaceAccessAttestationHash",
    "backupNamespaceAccessAttestationHash",
    "postBackupProbeLifecycleHash",
    "freshness",
    "extraRowCount",
  ].sort(),
  "The staging fixture capture binding schema drifted.",
);
assert.equal(
  sha256(Buffer.from(canonicalJson(fixtureAudit.captureBinding))),
  fixtureAudit.captureBindingHash,
  "The staging fixture capture binding hash is invalid.",
);
const plannedMutationTopology = fixtureAudit.isolation?.plannedMutationTopology;
assert.deepEqual(
  Object.keys(plannedMutationTopology || {}).sort(),
  [
    "documentCount",
    "allowlistHash",
    "observedHash",
    "baselineHash",
    "rows",
  ].sort(),
  "The planned mutation topology schema drifted.",
);
assert.equal(
  Number(plannedMutationTopology.documentCount),
  plannedMutationTopology.rows?.length,
);
assert.ok(Number(plannedMutationTopology.documentCount) > 0);
for (const field of ["allowlistHash", "observedHash", "baselineHash"]) {
  assert.match(plannedMutationTopology[field], /^[a-f0-9]{64}$/u);
}
const plannedMutationPathHashes = [];
const topologyRowUsesOnlyAllowedChildren = (row) => {
  const allowedChildIds = new Set(row.allowedChildIds || []);
  return (row.actualChildIds || []).every((childId) =>
    allowedChildIds.has(childId),
  );
};
for (const row of plannedMutationTopology.rows || []) {
  assert.deepEqual(
    Object.keys(row || {}).sort(),
    ["pathHash", "allowedChildIds", "actualChildIds"].sort(),
  );
  assert.match(row.pathHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(row.allowedChildIds, [...row.allowedChildIds].sort());
  assert.deepEqual(row.actualChildIds, [...row.actualChildIds].sort());
  assert.equal(new Set(row.allowedChildIds).size, row.allowedChildIds.length);
  assert.equal(new Set(row.actualChildIds).size, row.actualChildIds.length);
  assert.equal(topologyRowUsesOnlyAllowedChildren(row), true);
  plannedMutationPathHashes.push(row.pathHash);
}
assert.deepEqual(
  plannedMutationPathHashes,
  [...plannedMutationPathHashes].sort(),
);
assert.equal(
  new Set(plannedMutationPathHashes).size,
  plannedMutationPathHashes.length,
);
const unknownChildTopologyNegative = structuredClone(
  plannedMutationTopology.rows[0],
);
unknownChildTopologyNegative.actualChildIds.push("unknown-fixture-child");
assert.equal(
  topologyRowUsesOnlyAllowedChildren(unknownChildTopologyNegative),
  false,
);
assert.equal(
  sha256(Buffer.from(canonicalJson(plannedMutationTopology.rows))),
  plannedMutationTopology.observedHash,
);
assert.equal(
  sha256(
    Buffer.from(
      canonicalJson(
        plannedMutationTopology.rows.map(({ pathHash, allowedChildIds }) => ({
          pathHash,
          allowedChildIds,
        })),
      ),
    ),
  ),
  plannedMutationTopology.allowlistHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyAllowlistHash,
  plannedMutationTopology.allowlistHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyObservedHash,
  plannedMutationTopology.observedHash,
);
assert.equal(
  fixtureAudit.captureBinding.plannedMutationTopologyBaselineHash,
  plannedMutationTopology.baselineHash,
);
const postExistingCanary = backupAccessProbeCanary("existing-update-delete");
const postAbsentCanary = backupAccessProbeCanary("absent-create");
const preExistingCanary = backupAccessProbeCanary(
  "pre-backup-existing-update-delete",
);
const preAbsentCanary = backupAccessProbeCanary("pre-backup-absent-create");
const preBackupProbeRevisionHash = sha256(
  `${contract.fixtureId}\n${contract.fixtureRevision}\npre-backup-access-probe-v1`,
);
const preBackupPositiveControlSentinelHash = sha256(
  `${preBackupProbeRevisionHash}\npositive-control-sentinel`,
);
const preBackupPositiveControlData = {
  schemaVersion: 1,
  fixtureOwner: "w10p-visual-parity",
  fixtureId: contract.fixtureId,
  fixtureRevision: contract.fixtureRevision,
  fixturePurpose: "pre-backup-positive-control",
  probeRevision: preBackupProbeRevisionHash,
  sentinelHash: preBackupPositiveControlSentinelHash,
};
const preBackupNamespaceAccessAttestationHash =
  assertPreBackupAccessProbeAttestation(
    fixtureAudit.isolation?.preBackupAccessProbe,
    {
      appCheckDebugTokenHash: sha256(appCheckDebugToken),
      verifiedAppIdHash: sha256(STAGING_APP_ID),
      verifiedProjectIdHash: sha256(contract.firebaseProjectId),
      verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
      verifiedAudienceSetHash: sha256(
        canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
      ),
      verifiedIssuerHash: sha256(
        `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
      ),
      exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
      exchangeTransportContractHash: sha256(
        canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
      ),
      projectIdHash: sha256(contract.firebaseProjectId),
      identityUidHash: sha256("w10p-visual-backup-preflight"),
      identityEmailHash: sha256(
        "w10p-visual-backup-preflight@yongshin-ms.ms.kr",
      ),
      backupNamespaceHash: sha256(
        `w10p_visual_fixture_backups/${contract.fixtureId}`,
      ),
      localRulesSourceHash: sha256(readFileSync(resolve("firestore.rules"))),
      probeRevisionHash: preBackupProbeRevisionHash,
      probeProfilePathHash: sha256("users/w10p-visual-backup-preflight"),
      positiveControlPathHash: sha256(
        "users/w10p-visual-backup-preflight/academic_records/access-control",
      ),
      positiveControlSentinelHash: preBackupPositiveControlSentinelHash,
      positiveControlDocumentHash: sha256(
        Buffer.from(canonicalBackupJson(preBackupPositiveControlData)),
      ),
      existingWriteCanaryPathHash: sha256(preExistingCanary.path),
      absentWriteCanaryPathHash: sha256(preAbsentCanary.path),
      existingWriteCanaryRevisionHash: preExistingCanary.revisionHash,
      absentWriteCanaryRevisionHash: preAbsentCanary.revisionHash,
      existingWriteCanaryDocumentHash: preExistingCanary.documentHash,
      absentWriteCanaryDocumentHash: preAbsentCanary.documentHash,
    },
  );
assert.equal(
  fixtureAudit.captureBinding?.preBackupNamespaceAccessAttestationHash,
  preBackupNamespaceAccessAttestationHash,
  "The capture binding is not bound to the pre-backup deny attestation.",
);
const backupNamespaceAccessAttestationHash = assertBackupAccessProbeAttestation(
  fixtureAudit.isolation?.liveBackupAccessProbe,
  {
    appCheckDebugTokenHash: sha256(appCheckDebugToken),
    verifiedAppIdHash: sha256(STAGING_APP_ID),
    verifiedProjectIdHash: sha256(contract.firebaseProjectId),
    verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
    verifiedAudienceSetHash: sha256(
      canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
    ),
    verifiedIssuerHash: sha256(
      `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
    ),
    exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
    exchangeTransportContractHash: sha256(
      canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
    ),
    projectIdHash: sha256(contract.firebaseProjectId),
    identityUidHash: sha256(contract.captureIdentities.roles.student.uid),
    backupNamespaceHash: sha256(
      `w10p_visual_fixture_backups/${contract.fixtureId}`,
    ),
    backupManifestHash: fixtureAudit.isolation?.backupManifestHash,
    localRulesSourceHash: sha256(readFileSync(resolve("firestore.rules"))),
    existingWriteCanaryPathHash: sha256(postExistingCanary.path),
    absentWriteCanaryPathHash: sha256(postAbsentCanary.path),
    existingWriteCanaryRevisionHash: postExistingCanary.revisionHash,
    absentWriteCanaryRevisionHash: postAbsentCanary.revisionHash,
    existingWriteCanaryDocumentHash: postExistingCanary.documentHash,
    absentWriteCanaryDocumentHash: postAbsentCanary.documentHash,
  },
);
assert.equal(
  fixtureAudit.captureBinding?.backupNamespaceAccessAttestationHash,
  backupNamespaceAccessAttestationHash,
  "The capture binding is not bound to the live backup deny attestation.",
);
assert.equal(
  fixtureAudit.captureBinding?.appCheckDebugTokenHash,
  sha256(appCheckDebugToken),
  "The capture binding is not bound to the registered App Check debug token.",
);
assert.equal(
  fixtureAudit.captureBinding?.verifiedAppIdHash,
  sha256(STAGING_APP_ID),
  "The capture binding is not bound to the dedicated staging Firebase app.",
);
for (const [field, expectedHash] of Object.entries({
  verifiedProjectIdHash: sha256(contract.firebaseProjectId),
  verifiedProjectNumberHash: sha256(STAGING_PROJECT_NUMBER),
  verifiedAudienceSetHash: sha256(
    canonicalJson(FIXTURE_APP_CHECK_VERIFIED_AUDIENCE_SET),
  ),
  verifiedIssuerHash: sha256(
    `https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`,
  ),
  exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
  exchangeTransportContractHash: sha256(
    canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT),
  ),
})) {
  assert.equal(
    fixtureAudit.captureBinding?.[field],
    expectedHash,
    `The capture binding ${field} is invalid.`,
  );
}
const postBackupProbeLifecycle =
  fixtureAudit.isolation?.postBackupProbeLifecycle;
assert.deepEqual(Object.keys(postBackupProbeLifecycle || {}).sort(), [
  "absentCanaryPathHash",
  "artifactResidualCount",
  "attestationHash",
  "existingCanaryPathHash",
  "revisionHash",
  "state",
]);
assert.deepEqual(postBackupProbeLifecycle, {
  state: "VERIFIED_CLEAN",
  revisionHash: sha256(
    `${contract.fixtureId}\n${contract.fixtureRevision}\npost-backup-access-probe-v1`,
  ),
  existingCanaryPathHash: sha256(postExistingCanary.path),
  absentCanaryPathHash: sha256(postAbsentCanary.path),
  attestationHash: backupNamespaceAccessAttestationHash,
  artifactResidualCount: 0,
});
assert.equal(
  sha256(Buffer.from(canonicalJson(postBackupProbeLifecycle))),
  fixtureAudit.isolation?.postBackupProbeLifecycleHash,
);
assert.equal(
  fixtureAudit.captureBinding?.postBackupProbeLifecycleHash,
  fixtureAudit.isolation?.postBackupProbeLifecycleHash,
  "The capture binding is not bound to the post-backup probe lifecycle.",
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
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.scopeKind,
  "fixture-auth-identities",
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.scopeBoundary,
  "fixed-uid-and-email-pairs-only",
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.tenantWideEnumerationPerformed,
  false,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.nonFixtureTenantUsersInScope,
  false,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.scopedIdentityCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.expectedPresentIdentityCount,
  3,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.actualPresentIdentityCount,
  3,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.uidLookupCount, 3);
assert.equal(fixtureAudit.authFixtureIdentityScope?.emailLookupCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.uidExpectationMatchCount,
  3,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.emailExpectationMatchCount,
  3,
);
assert.equal(fixtureAudit.authFixtureIdentityScope?.customClaimMatchCount, 3);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.missingScopedIdentityCount,
  0,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope?.mismatchedScopedIdentityCount,
  0,
);
assert.equal(
  fixtureAudit.captureBinding?.authFixtureIdentityScopeManifestHash,
  fixtureAudit.authFixtureIdentityScope?.manifestHash,
);
const {
  manifestHash: authFixtureIdentityScopeManifestHash,
  ...authFixtureIdentityScopeAttestation
} = fixtureAudit.authFixtureIdentityScope;
assert.equal(
  sha256(Buffer.from(canonicalJson(authFixtureIdentityScopeAttestation))),
  authFixtureIdentityScopeManifestHash,
  "The scoped fixture Auth identity attestation hash is invalid.",
);
assert.deepEqual(
  fixtureAudit.authFixtureIdentityScope.identities.map(
    ({ role, uidHash, emailHash }) => ({ role, uidHash, emailHash }),
  ),
  fixtureAudit.authRoles,
);
assert.equal(
  fixtureAudit.authFixtureIdentityScope.identities.every(
    (row) =>
      row.expectedPresent === true &&
      row.actualPresent === true &&
      row.uidExpectationMatched === true &&
      row.emailExpectationMatched === true &&
      row.customClaimsMatched === true,
  ),
  true,
);
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
const { issuedAt: fixtureAuditIssuedAt, expiresAt: fixtureAuditExpiresAt } =
  assertFixtureAuditFreshnessBinding({
    freshness: fixtureAudit.freshness,
    captureBindingFreshness: fixtureAudit.captureBinding?.freshness,
    expectedFixedTime: contract.fixedTime,
  });
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
  "firestore.rules",
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
const runnerSourceText = readFileSync(resolve(runnerScriptPath), "utf8");
const playwrightRouteRegistrationCount = (
  runnerSourceText.match(/\.(?:route|unroute)\s*\(/gu) || []
).length;
const browserGlobalExtraHttpHeaderRegistrationCount = (
  runnerSourceText.match(/\bextraHTTPHeaders\s*:/gu) || []
).length;
const pageAppCheckSecretInitRegistrationCount = (
  runnerSourceText.match(
    /\bpage\.addInitScript\(\s*appCheckDebugInitScript\s*,\s*appCheckDebugInitArgument\s*,?\s*\)/gu,
  ) || []
).length;
const pageAppCheckSentinelInitArgumentSourceCount = (
  runnerSourceText.match(
    /\bconst\s+appCheckDebugInitArgument\s*=\s*\{\s*allowedOrigin:\s*origin,\s*debugToken:\s*APP_CHECK_DEBUG_SENTINEL,\s*\};/gu,
  ) || []
).length;
const contextAppCheckSecretInitRegistrationCount = (
  runnerSourceText.match(
    /\bcontext\.addInitScript\(appCheckDebugInitScript\s*,/gu,
  ) || []
).length;
assert.equal(
  playwrightRouteRegistrationCount,
  0,
  "Playwright route interception must not be combined with the CDP App Check bridge.",
);
assert.equal(
  browserGlobalExtraHttpHeaderRegistrationCount,
  0,
  "Browser-global HTTP headers must not carry deployment secrets.",
);
assert.equal(pageAppCheckSecretInitRegistrationCount, 1);
assert.equal(pageAppCheckSentinelInitArgumentSourceCount, 1);
assert.equal(contextAppCheckSecretInitRegistrationCount, 0);
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
      const textPaintFor = (
        element,
        minimumContrastRatio = null,
        minimumGlyphVisibleRatio = 0.6,
      ) => {
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
            glyphVisibleRatio >= minimumGlyphVisibleRatio &&
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
      const describe = (
        element,
        { minimumContrastRatio = null, minimumGlyphVisibleRatio = 0.6 } = {},
      ) => {
        if (!(element instanceof Element)) return { present: false };
        const box = element.getBoundingClientRect();
        const computedStyle = getComputedStyle(element);
        const visibility = visibilityFor(element);
        const textPaint = textPaintFor(
          element,
          minimumContrastRatio,
          minimumGlyphVisibleRatio,
        );
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
        {
          allowRendered = false,
          minimumContrastRatio = null,
          minimumGlyphVisibleRatio = 0.6,
        } = {},
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
              textPaintFor(
                element,
                minimumContrastRatio,
                minimumGlyphVisibleRatio,
              ).painted
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
                      minimumGlyphVisibleRatio:
                        requirement.minimumGlyphVisibleRatio,
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
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        const paintPattern = requirement.textPattern
          ? new RegExp(requirement.textPattern, "u")
          : null;
        const paintWitness = paintPattern
          ? paintWitnessFor(element, paintPattern, {
              minimumContrastRatio: requirement.minimumContrastRatio,
              minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
            })
          : element;
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
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
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
        });
        const paintPattern = new RegExp(requirement.textPattern, "u");
        const paintWitness =
          requirement.paintMode === "canvas"
            ? null
            : paintWitnessFor(element, paintPattern, {
                minimumContrastRatio: requirement.minimumContrastRatio,
                minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
              });
        const describedPaintWitness = describe(paintWitness, {
          minimumContrastRatio: requirement.minimumContrastRatio,
          minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
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
                minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
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
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
          });
          const paintWitness = paintWitnessFor(element, pattern, {
            minimumContrastRatio: requirement.minimumContrastRatio,
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
          });
          const describedPaintWitness = describe(paintWitness, {
            minimumContrastRatio: requirement.minimumContrastRatio,
            minimumGlyphVisibleRatio: requirement.minimumGlyphVisibleRatio,
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

const appCheckDebugInitScript = ({ allowedOrigin, debugToken }) => {
  if (location.origin !== allowedOrigin) return;
  const jwtPattern =
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu;
  const redact = (value) => {
    if (typeof value === "string") {
      return value
        .replaceAll(debugToken, "[W10P_APPCHECK_DEBUG_TOKEN_REDACTED]")
        .replace(jwtPattern, "[W10P_APPCHECK_JWT_REDACTED]");
    }
    if (value instanceof Error) {
      return `${value.name}: ${redact(value.message)}`;
    }
    if (value && typeof value === "object") {
      return "[W10P_CONSOLE_OBJECT_REDACTED]";
    }
    return value;
  };
  for (const method of ["debug", "error", "info", "log", "warn"]) {
    const original = console[method].bind(console);
    console[method] = (...values) => original(...values.map(redact));
  }
  Object.defineProperty(self, "FIREBASE_APPCHECK_DEBUG_TOKEN", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: debugToken,
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
      const appCheckModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app-check.js");
      const firestoreModule =
        await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
      const app = appModule.initializeApp(config);
      const auxiliaryAppCheck = appCheckModule.initializeAppCheck(app, {
        provider: new appCheckModule.CustomProvider({
          getToken: async () => {
            throw new Error("VISUAL_APPCHECK_DEBUG_PROVIDER_REQUIRED");
          },
        }),
        isTokenAutoRefreshEnabled: false,
      });
      let auxiliaryAppCheckToken =
        await appCheckModule.getToken(auxiliaryAppCheck);
      if (!auxiliaryAppCheckToken?.token) {
        throw new Error("VISUAL_APPCHECK_TOKEN_MISSING");
      }
      auxiliaryAppCheckToken = null;
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
        appCheckBound: true,
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
  assert.equal(identity.appCheckBound, true);
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
    appCheckBound: identity.appCheckBound === true,
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
  "content-firebaseappcheck.googleapis.com",
]);
const firebaseServiceForHost = (hostname) => {
  if (
    hostname === "identitytoolkit.googleapis.com" ||
    hostname === "securetoken.googleapis.com"
  ) {
    return "auth";
  }
  if (
    hostname === "firebaseappcheck.googleapis.com" ||
    hostname === "content-firebaseappcheck.googleapis.com"
  ) {
    return "app-check";
  }
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
  appCheckHeaderPresent = false,
  appCheckHeaderSource = null,
  appCheckHeaderJwtShapeValid = false,
  appCheckBridgeDecisionObserved = false,
  appCheckBridgeScopeEligible = false,
  appCheckBridgeHeaderStripped = false,
  appCheckBridgeRedirectedRequest = false,
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
    appCheckHeaderPresent,
    appCheckHeaderSource,
    appCheckHeaderJwtShapeValid,
    appCheckBridgeDecisionObserved,
    appCheckBridgeScopeEligible,
    appCheckBridgeHeaderStripped,
    appCheckBridgeRedirectedRequest,
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
  const appCheckProtectedDataRequests = stagingDataRequests.filter(
    (request) => request.method !== "OPTIONS",
  );
  const appCheckExchangeRequests = stagingRequests.filter(
    (request) =>
      request.firebaseService === "app-check" && request.method === "POST",
  );
  const successfulAppCheckExchangeResponses = stagingFirebaseResponses.filter(
    (response) =>
      response.firebaseService === "app-check" &&
      response.method === "POST" &&
      response.status === 200,
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
    appCheckExchangeRequestCount: appCheckExchangeRequests.length,
    successfulAppCheckExchangeResponseCount:
      successfulAppCheckExchangeResponses.length,
    appCheckProtectedDataRequestCount: appCheckProtectedDataRequests.length,
    appCheckHeaderPresentRequestCount: appCheckProtectedDataRequests.filter(
      (request) => request.appCheckHeaderPresent,
    ).length,
    appCheckHeaderMissingRequestCount: appCheckProtectedDataRequests.filter(
      (request) => !request.appCheckHeaderPresent,
    ).length,
    appCheckHeaderJwtShapeValidRequestCount:
      appCheckProtectedDataRequests.filter(
        (request) => request.appCheckHeaderJwtShapeValid,
      ).length,
    appCheckHeaderJwtShapeInvalidRequestCount:
      appCheckProtectedDataRequests.filter(
        (request) =>
          request.appCheckHeaderPresent && !request.appCheckHeaderJwtShapeValid,
      ).length,
    rawAppCheckHeaderValueOutputCount: 0,
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
const deploymentBypassHeaders = bypassSecret
  ? { "x-vercel-protection-bypass": bypassSecret }
  : {};
const captureAppCheckTokenManager = createCaptureAppCheckTokenManager();
let baselineBridgeEligibleRequestCount = 0;
let baselineBridgeInjectedRequestCount = 0;
let baselineBridgeNativeHeaderRequestCount = 0;
let baselineBridgeScopeMismatchRequestCount = 0;
let baselineBridgeStrippedHeaderRequestCount = 0;
let baselineBridgeRedirectRequestCount = 0;
let baselineBridgeRedirectHeaderAbsentRequestCount = 0;
let baselineBridgeRedirectAbortRequestCount = 0;
let baselineBridgeCdpPausedRequestCount = 0;
let baselineBridgeCdpResponsePausedRequestCount = 0;
let baselineBridgeCdpReconciledRequestCount = 0;
let appCheckCdpHandlerErrorCount = 0;
let baselineBridgeInjectedRedirectResponseAbortCount = 0;
let appCheckCdpMonitorPausedRequestCount = 0;
let preTransmissionBoundaryInspectionCount = 0;
let preTransmissionBoundaryBlockAttemptCount = 0;
let preTransmissionBoundaryProductionBlockCount = 0;
let preTransmissionBoundaryUnboundFirebaseBlockCount = 0;
let preTransmissionBoundaryFailRequestCount = 0;
let debugTokenNetworkObservationCount = 0;
let debugSentinelNetworkObservationCount = 0;
let authorizedDebugExchangeBodyReplacementCount = 0;
let unauthorizedDebugTokenEgressCount = 0;
let unauthorizedDebugSentinelEgressCount = 0;
let appCheckHeaderNetworkObservationCount = 0;
let authorizedAppCheckHeaderRequestCount = 0;
let unauthorizedAppCheckHeaderEgressCount = 0;
let sensitiveAppCheckRedirectRequestCount = 0;
let sensitiveAppCheckRedirectAbortRequestCount = 0;
let sensitiveAppCheckCdpResponsePausedRequestCount = 0;
let sensitiveAppCheckRedirectResponseAbortRequestCount = 0;
let sensitiveAppCheckResponseErrorAbortRequestCount = 0;
let sensitiveAppCheckRequestTrackingResidualCount = 0;
let vercelBypassCdpInjectedRequestCount = 0;
let vercelBypassPreexistingHeaderObservationCount = 0;
let unauthorizedVercelBypassEgressCount = 0;
let vercelBypassCdpResponsePausedRequestCount = 0;
let vercelBypassHttpSuccessResponseCount = 0;
let vercelBypassHttpErrorResponseCount = 0;
let vercelBypassRedirectRequestCount = 0;
let vercelBypassRedirectAbortRequestCount = 0;
let vercelBypassRedirectResponseAbortRequestCount = 0;
let vercelBypassResponseErrorAbortRequestCount = 0;
let vercelBypassObservedEligibleRequestCount = 0;
let vercelBypassHeaderObservedRequestCount = 0;
let vercelBypassHeaderMissingRequestCount = 0;
let vercelBypassHeaderMismatchRequestCount = 0;
let pendingBridgeDecisionResidualCount = 0;
let pendingBridgeObservationResidualCount = 0;
let candidateBridgeInjectedRequestCount = 0;
const baselineAppCheckBridgeDecision = ({ method, url }) => {
  if (method.toUpperCase() === "OPTIONS") {
    return { eligible: false, scopeMismatch: false };
  }
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase();
  const service = firebaseServiceForHost(hostname);
  if (!fixtureDataServices.has(service)) {
    return { eligible: false, scopeMismatch: false };
  }
  const transportBound =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443");
  if (!transportBound) return { eligible: false, scopeMismatch: true };
  if (hostname === "firestore.googleapis.com") {
    const databaseResource =
      `projects/${contract.firebaseProjectId}/databases/(default)`.toLowerCase();
    const pathname = safelyDecodeUrl(parsed.pathname).toLowerCase();
    const escapedProjectId = contract.firebaseProjectId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const pathnameBound = new RegExp(
      `^/v1/projects/${escapedProjectId}/databases/\\(default\\)(?:/|$)`,
      "u",
    ).test(pathname);
    const databaseQuery = String(parsed.searchParams.get("database") || "")
      .replace(/^\/+/, "")
      .toLowerCase();
    const resourceBound = pathnameBound || databaseQuery === databaseResource;
    return {
      eligible: resourceBound,
      scopeMismatch: !resourceBound,
    };
  }
  if (hostname === "firebasestorage.googleapis.com") {
    const storageBoundary = `/v0/b/${String(
      firebaseConfig.storageBucket,
    ).toLowerCase()}/o`;
    const pathname = safelyDecodeUrl(parsed.pathname).toLowerCase();
    const storageBound =
      pathname === storageBoundary ||
      pathname.startsWith(`${storageBoundary}/`);
    return {
      eligible: storageBound,
      scopeMismatch: !storageBound,
    };
  }
  const functionBound =
    hostname ===
      `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net` &&
    /^\/[A-Za-z0-9_-]+\/?$/u.test(parsed.pathname);
  return { eligible: functionBound, scopeMismatch: !functionBound };
};
const exactAuthAppCheckHeaderScope = ({ method, url }) => {
  if (method.toUpperCase() === "OPTIONS") return false;
  const parsed = new URL(url);
  const transportBound =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443");
  if (!transportBound) return false;
  const queryKeys = [...parsed.searchParams.keys()].sort();
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== "key" ||
    parsed.searchParams.get("key") !== firebaseConfig.apiKey
  ) {
    return false;
  }
  if (parsed.hostname === "identitytoolkit.googleapis.com") {
    return /^\/v[12]\/accounts:[A-Za-z][A-Za-z0-9]*$/u.test(parsed.pathname);
  }
  return (
    parsed.hostname === "securetoken.googleapis.com" &&
    parsed.pathname === "/v1/token"
  );
};
const exactBrowserDebugExchangeScope = ({ method, url, headers, postData }) => {
  if (method.toUpperCase() !== "POST") return false;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    parsed.hostname !== "content-firebaseappcheck.googleapis.com" ||
    parsed.pathname !==
      `/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken` ||
    parsed.hash
  ) {
    return false;
  }
  const queryKeys = [...parsed.searchParams.keys()];
  if (
    queryKeys.length !== 1 ||
    queryKeys[0] !== "key" ||
    parsed.searchParams.get("key") !== firebaseConfig.apiKey
  ) {
    return false;
  }
  const contentType = headers.find(
    ({ name }) => name.toLowerCase() === "content-type",
  )?.value;
  if (
    String(contentType || "")
      .trim()
      .toLowerCase() !== "application/json"
  ) {
    return false;
  }
  let body;
  try {
    body = JSON.parse(String(postData || ""));
  } catch (_error) {
    return false;
  }
  return (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === 1 &&
    Object.keys(body)[0] === "debug_token" &&
    body.debug_token === APP_CHECK_DEBUG_SENTINEL
  );
};
const browserChildEnvironment = createBrowserChildEnvironment();
const browserChildEnvironmentUnexpectedKeyCount = Object.keys(
  browserChildEnvironment,
).filter(
  (name) => !BROWSER_CHILD_ENVIRONMENT_ALLOWLIST.includes(name.toUpperCase()),
).length;
const browserChildSecretEnvironmentVariableCount =
  BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.filter((name) =>
    Object.hasOwn(browserChildEnvironment, name),
  ).length;
const browserChildSecretValues = [
  appCheckDebugToken,
  credentialsEnvironmentJson,
  firebaseConfigEnvironmentJson,
  ...Object.values(credentials).flatMap((credential) => [
    credential.email,
    credential.password,
  ]),
  firebaseConfig.apiKey,
  bypassSecret,
].filter(Boolean);
const browserChildSecretValueObservationCount = Object.values(
  browserChildEnvironment,
).filter((environmentValue) =>
  browserChildSecretValues.some((secretValue) =>
    String(environmentValue).includes(String(secretValue)),
  ),
).length;
const argvSecretCount = process.argv.filter((argument) =>
  browserChildSecretValues.some((secretValue) =>
    String(argument).includes(String(secretValue)),
  ),
).length;
assert.equal(browserChildSecretEnvironmentVariableCount, 0);
assert.equal(browserChildSecretValueObservationCount, 0);
assert.equal(browserChildEnvironmentUnexpectedKeyCount, 0);
assert.equal(argvSecretCount, 0);
credentialsEnvironmentJson = "";
firebaseConfigEnvironmentJson = "";
browserChildSecretValues.fill("");
const browser = await chromium.launch({
  executablePath: edgeExecutable,
  headless: true,
  env: browserChildEnvironment,
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
let appCheckInitScriptInjectionCount = 0;
let pageRawDebugTokenInjectionCount = 0;
let browserGlobalRawDebugTokenWriteCount = 0;
let browserGlobalDebugSentinelWriteCount = 0;
let browserLocalStorageSecretWriteCount = 0;
let browserConsoleMessageCount = 0;
let browserConsoleSecretObservationCount = 0;
let browserCorsConsoleErrorCount = 0;
let browserDomSecretObservationCount = 0;
let browserRequestFailureCount = 0;
let browserContextCloseCount = 0;
let unexpectedExtraPageCount = 0;
let unexpectedDedicatedWorkerCount = 0;
let unexpectedServiceWorkerCount = 0;
let unexpectedCrossOriginFrameCount = 0;
let unexpectedOopifTargetCount = 0;
let unexpectedDedicatedWorkerTargetCount = 0;
let unexpectedSharedWorkerTargetCount = 0;
let unexpectedServiceWorkerTargetCount = 0;
let retainedOopifTargetCount = 0;
let retainedDedicatedWorkerTargetCount = 0;
let retainedSharedWorkerTargetCount = 0;
let retainedServiceWorkerTargetCount = 0;
let browserNetworkHeaderAttestationErrorCount = 0;
let targetDiscoveryActivationCount = 0;
let targetSnapshotCount = 0;
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
      serviceWorkers: "block",
    });
    const groupBaselineBridgeEligibleStart = baselineBridgeEligibleRequestCount;
    const groupBaselineBridgeInjectedStart = baselineBridgeInjectedRequestCount;
    const groupBaselineBridgeNativeHeaderStart =
      baselineBridgeNativeHeaderRequestCount;
    const groupBaselineBridgeScopeMismatchStart =
      baselineBridgeScopeMismatchRequestCount;
    const groupBaselineBridgeStrippedHeaderStart =
      baselineBridgeStrippedHeaderRequestCount;
    const groupBaselineBridgeRedirectStart = baselineBridgeRedirectRequestCount;
    const groupBaselineBridgeRedirectHeaderAbsentStart =
      baselineBridgeRedirectHeaderAbsentRequestCount;
    const groupBaselineBridgeRedirectAbortStart =
      baselineBridgeRedirectAbortRequestCount;
    const groupBaselineBridgeCdpPausedStart =
      baselineBridgeCdpPausedRequestCount;
    const groupBaselineBridgeCdpResponsePausedStart =
      baselineBridgeCdpResponsePausedRequestCount;
    const groupBaselineBridgeCdpReconciledStart =
      baselineBridgeCdpReconciledRequestCount;
    const groupCandidateBridgeInjectedStart =
      candidateBridgeInjectedRequestCount;
    const groupPageRawDebugTokenInjectionStart =
      pageRawDebugTokenInjectionCount;
    const groupBrowserGlobalRawDebugTokenWriteStart =
      browserGlobalRawDebugTokenWriteCount;
    const groupBrowserGlobalDebugSentinelWriteStart =
      browserGlobalDebugSentinelWriteCount;
    const groupBrowserLocalStorageSecretWriteStart =
      browserLocalStorageSecretWriteCount;
    const groupTargetDiscoveryActivationStart = targetDiscoveryActivationCount;
    const groupTargetSnapshotStart = targetSnapshotCount;
    const groupBaselineBridgeHandlerErrorStart = appCheckCdpHandlerErrorCount;
    const groupBaselineBridgeInjectedRedirectResponseAbortStart =
      baselineBridgeInjectedRedirectResponseAbortCount;
    const groupAppCheckCdpMonitorPausedStart =
      appCheckCdpMonitorPausedRequestCount;
    const groupPreTransmissionBoundaryInspectionStart =
      preTransmissionBoundaryInspectionCount;
    const groupPreTransmissionBoundaryBlockAttemptStart =
      preTransmissionBoundaryBlockAttemptCount;
    const groupPreTransmissionBoundaryProductionBlockStart =
      preTransmissionBoundaryProductionBlockCount;
    const groupPreTransmissionBoundaryUnboundFirebaseBlockStart =
      preTransmissionBoundaryUnboundFirebaseBlockCount;
    const groupPreTransmissionBoundaryFailRequestStart =
      preTransmissionBoundaryFailRequestCount;
    const groupDebugTokenNetworkObservationStart =
      debugTokenNetworkObservationCount;
    const groupDebugSentinelNetworkObservationStart =
      debugSentinelNetworkObservationCount;
    const groupAuthorizedDebugExchangeBodyReplacementStart =
      authorizedDebugExchangeBodyReplacementCount;
    const groupUnauthorizedDebugTokenEgressStart =
      unauthorizedDebugTokenEgressCount;
    const groupUnauthorizedDebugSentinelEgressStart =
      unauthorizedDebugSentinelEgressCount;
    const groupAppCheckHeaderNetworkObservationStart =
      appCheckHeaderNetworkObservationCount;
    const groupAuthorizedAppCheckHeaderRequestStart =
      authorizedAppCheckHeaderRequestCount;
    const groupUnauthorizedAppCheckHeaderEgressStart =
      unauthorizedAppCheckHeaderEgressCount;
    const groupSensitiveAppCheckRedirectRequestStart =
      sensitiveAppCheckRedirectRequestCount;
    const groupSensitiveAppCheckRedirectAbortRequestStart =
      sensitiveAppCheckRedirectAbortRequestCount;
    const groupSensitiveAppCheckCdpResponsePausedStart =
      sensitiveAppCheckCdpResponsePausedRequestCount;
    const groupSensitiveAppCheckRedirectResponseAbortStart =
      sensitiveAppCheckRedirectResponseAbortRequestCount;
    const groupSensitiveAppCheckResponseErrorAbortStart =
      sensitiveAppCheckResponseErrorAbortRequestCount;
    const groupVercelBypassCdpInjectedStart =
      vercelBypassCdpInjectedRequestCount;
    const groupVercelBypassPreexistingHeaderObservationStart =
      vercelBypassPreexistingHeaderObservationCount;
    const groupUnauthorizedVercelBypassEgressStart =
      unauthorizedVercelBypassEgressCount;
    const groupVercelBypassCdpResponsePausedStart =
      vercelBypassCdpResponsePausedRequestCount;
    const groupVercelBypassHttpSuccessResponseStart =
      vercelBypassHttpSuccessResponseCount;
    const groupVercelBypassHttpErrorResponseStart =
      vercelBypassHttpErrorResponseCount;
    const groupVercelBypassRedirectRequestStart =
      vercelBypassRedirectRequestCount;
    const groupVercelBypassRedirectAbortRequestStart =
      vercelBypassRedirectAbortRequestCount;
    const groupVercelBypassRedirectResponseAbortStart =
      vercelBypassRedirectResponseAbortRequestCount;
    const groupVercelBypassResponseErrorAbortStart =
      vercelBypassResponseErrorAbortRequestCount;
    const groupVercelBypassObservedEligibleStart =
      vercelBypassObservedEligibleRequestCount;
    const groupVercelBypassHeaderObservedStart =
      vercelBypassHeaderObservedRequestCount;
    const groupVercelBypassHeaderMissingStart =
      vercelBypassHeaderMissingRequestCount;
    const groupVercelBypassHeaderMismatchStart =
      vercelBypassHeaderMismatchRequestCount;
    let networkPhase = "context-bootstrap";
    let activeCaptureId = null;
    let networkRequestSequence = 0;
    const requestCorrelations = new WeakMap();
    const requestObservations = new WeakMap();
    const requestHeaderAttestations = new WeakMap();
    const pendingNetworkAttestations = new Set();
    let networkHeaderAttestationErrorCount = 0;
    const trackNetworkAttestation = (promise) => {
      pendingNetworkAttestations.add(promise);
      promise.finally(() => pendingNetworkAttestations.delete(promise));
      return promise;
    };
    const flushNetworkAttestations = async () => {
      while (pendingNetworkAttestations.size > 0) {
        await Promise.all([...pendingNetworkAttestations]);
      }
      assert.equal(
        networkHeaderAttestationErrorCount,
        0,
        "A browser request header attestation failed.",
      );
    };
    let appCheckCdpSession = null;
    const appCheckCdpHandlerPromises = new Set();
    let groupPendingBridgeDecisionResidualCount = 0;
    let groupPendingBridgeObservationResidualCount = 0;
    let groupSensitiveRequestTrackingResidualCount = 0;
    let groupRetainedPageCount = 0;
    let groupServiceWorkerCount = 0;
    const groupNetworkObservationStart = networkObservations.length;
    const groupNetworkResponseObservationStart =
      networkResponseObservations.length;
    const groupCaptureAttestations = [];
    context.on("request", (request) => {
      const appCheckHeaderValue =
        request.headers()["x-firebase-appcheck"] || "";
      const appCheckHeaderPresent = Boolean(appCheckHeaderValue);
      const appCheckHeaderJwtShapeValid =
        APP_CHECK_JWT_SHAPE_PATTERN.test(appCheckHeaderValue);
      const correlation = {
        correlationId: `${groupKey}:request-${networkRequestSequence}`,
        phase: networkPhase,
        captureId: activeCaptureId,
        appCheckHeaderPresent,
        appCheckHeaderSource: appCheckHeaderPresent ? "native-sdk" : null,
        appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: false,
        appCheckBridgeScopeEligible: false,
        appCheckBridgeHeaderStripped: false,
        appCheckBridgeRedirectedRequest: false,
      };
      networkRequestSequence += 1;
      requestCorrelations.set(request, correlation);
      const observation = inspectNetworkRequest({
        url: request.url(),
        method: request.method(),
        phase: correlation.phase,
        groupKey,
        captureId: correlation.captureId,
        correlationId: correlation.correlationId,
        appCheckHeaderPresent,
        appCheckHeaderSource: correlation.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid,
      });
      requestObservations.set(request, observation);
      networkObservations.push(observation);
      const headerAttestation = trackNetworkAttestation(
        (async () => {
          const allHeaders = await request.allHeaders();
          const effectiveVercelBypassHeader =
            allHeaders["x-vercel-protection-bypass"] || "";
          const vercelBypassObservationEligible =
            Boolean(bypassSecret) && isVercelBypassEligibleUrl(request.url());
          if (vercelBypassObservationEligible) {
            vercelBypassObservedEligibleRequestCount += 1;
            if (effectiveVercelBypassHeader) {
              vercelBypassHeaderObservedRequestCount += 1;
            } else {
              vercelBypassHeaderMissingRequestCount += 1;
            }
          }
          if (
            effectiveVercelBypassHeader &&
            (!vercelBypassObservationEligible ||
              effectiveVercelBypassHeader !== bypassSecret)
          ) {
            vercelBypassHeaderMismatchRequestCount += 1;
          }
          const effectiveHeaderValue = allHeaders["x-firebase-appcheck"] || "";
          const effectiveHeaderPresent = Boolean(effectiveHeaderValue);
          const effectiveHeaderJwtShapeValid =
            APP_CHECK_JWT_SHAPE_PATTERN.test(effectiveHeaderValue);
          const bridgeInjectedHeader =
            stage === "baseline" &&
            captureAppCheckTokenManager.matchesIssuedToken(
              effectiveHeaderValue,
            );
          const effectiveHeaderSource = effectiveHeaderPresent
            ? bridgeInjectedHeader
              ? "baseline-cdp-fetch-bridge"
              : "native-sdk"
            : null;
          const bridgeDecision = baselineAppCheckBridgeDecision({
            method: request.method(),
            url: request.url(),
          });
          const update = {
            appCheckHeaderPresent: effectiveHeaderPresent,
            appCheckHeaderSource: effectiveHeaderSource,
            appCheckHeaderJwtShapeValid: effectiveHeaderJwtShapeValid,
            appCheckBridgeDecisionObserved: stage === "baseline",
            appCheckBridgeScopeEligible:
              stage === "baseline" && bridgeDecision.eligible,
            appCheckBridgeHeaderStripped: false,
            appCheckBridgeRedirectedRequest:
              stage === "baseline" && Boolean(request.redirectedFrom()),
          };
          Object.assign(correlation, update);
          Object.assign(observation, update);
          if (stage === "baseline") {
            baselineBridgeCdpReconciledRequestCount += 1;
          }
        })().catch(() => {
          networkHeaderAttestationErrorCount += 1;
          browserNetworkHeaderAttestationErrorCount += 1;
        }),
      );
      requestHeaderAttestations.set(request, headerAttestation);
    });
    context.on("response", (response) => {
      const request = response.request();
      trackNetworkAttestation(
        (async () => {
          await requestHeaderAttestations.get(request);
          const correlation = requestCorrelations.get(request);
          assert.ok(
            correlation,
            "A browser response has no originating request.",
          );
          networkResponseObservations.push({
            ...inspectNetworkRequest({
              url: response.url(),
              method: request.method(),
              phase: correlation.phase,
              groupKey,
              captureId: correlation.captureId,
              correlationId: correlation.correlationId,
              appCheckHeaderPresent: correlation.appCheckHeaderPresent,
              appCheckHeaderSource: correlation.appCheckHeaderSource,
              appCheckHeaderJwtShapeValid:
                correlation.appCheckHeaderJwtShapeValid,
              appCheckBridgeDecisionObserved:
                correlation.appCheckBridgeDecisionObserved,
              appCheckBridgeScopeEligible:
                correlation.appCheckBridgeScopeEligible,
              appCheckBridgeHeaderStripped:
                correlation.appCheckBridgeHeaderStripped,
              appCheckBridgeRedirectedRequest:
                correlation.appCheckBridgeRedirectedRequest,
            }),
            status: response.status(),
          });
        })().catch(() => {
          networkHeaderAttestationErrorCount += 1;
          browserNetworkHeaderAttestationErrorCount += 1;
        }),
      );
    });
    await context.addInitScript(fixedClockScript, {
      fixedTimestamp: fixedTime,
    });
    let groupPageCount = 0;
    context.on("page", () => {
      groupPageCount += 1;
    });
    const page = await context.newPage();
    let groupDedicatedWorkerCount = 0;
    let groupUnexpectedCrossOriginFrameCount = 0;
    let groupOopifTargetCount = 0;
    let groupDedicatedWorkerTargetCount = 0;
    let groupSharedWorkerTargetCount = 0;
    let groupServiceWorkerTargetCount = 0;
    let groupRetainedOopifTargetCount = 0;
    let groupRetainedDedicatedWorkerTargetCount = 0;
    let groupRetainedSharedWorkerTargetCount = 0;
    let groupRetainedServiceWorkerTargetCount = 0;
    const discoveredTargetIdsByType = new Map(
      ["iframe", "worker", "shared_worker", "service_worker"].map((type) => [
        type,
        new Set(),
      ]),
    );
    const observedCrossOriginFrames = new WeakSet();
    const observeFrameOrigin = (frame) => {
      if (frame === page.mainFrame() || observedCrossOriginFrames.has(frame)) {
        return;
      }
      const frameUrl = String(frame.url() || "");
      let parsedFrameUrl;
      try {
        parsedFrameUrl = new URL(frameUrl);
      } catch (_error) {
        return;
      }
      if (!["http:", "https:"].includes(parsedFrameUrl.protocol)) return;
      if (parsedFrameUrl.origin !== origin) {
        observedCrossOriginFrames.add(frame);
        groupUnexpectedCrossOriginFrameCount += 1;
      }
    };
    page.on("framenavigated", observeFrameOrigin);
    page.on("worker", () => {
      groupDedicatedWorkerCount += 1;
    });
    const appCheckDebugInitArgument = {
      allowedOrigin: origin,
      debugToken: APP_CHECK_DEBUG_SENTINEL,
    };
    const pageInitArgumentContainsRawDebugToken = Object.values(
      appCheckDebugInitArgument,
    ).some((value) => value === appCheckDebugToken);
    pageRawDebugTokenInjectionCount += Number(
      pageInitArgumentContainsRawDebugToken,
    );
    assert.equal(
      pageInitArgumentContainsRawDebugToken,
      false,
      "The App Check page init argument contained the raw debug token.",
    );
    assert.equal(
      appCheckDebugInitArgument.debugToken === APP_CHECK_DEBUG_SENTINEL,
      true,
      "The App Check page init argument must contain only the fixed sentinel.",
    );
    await page.addInitScript(
      appCheckDebugInitScript,
      appCheckDebugInitArgument,
    );
    appCheckInitScriptInjectionCount += 1;
    if (stage === "baseline") {
      await captureAppCheckTokenManager.ensureFresh();
    }
    appCheckCdpSession = await context.newCDPSession(page);
    const currentTarget = await appCheckCdpSession.send("Target.getTargetInfo");
    const groupBrowserContextId = currentTarget.targetInfo.browserContextId;
    assert.ok(groupBrowserContextId);
    appCheckCdpSession.on("Target.targetCreated", ({ targetInfo }) => {
      const observedTargetIds = discoveredTargetIdsByType.get(targetInfo.type);
      if (
        observedTargetIds &&
        targetInfo.browserContextId === groupBrowserContextId
      ) {
        observedTargetIds.add(targetInfo.targetId);
      }
    });
    await appCheckCdpSession.send("Target.setDiscoverTargets", {
      discover: true,
    });
    targetDiscoveryActivationCount += 1;
    const sensitiveAppCheckRequestsByFetchRequestId = new Map();
    const handlePausedRequest = async (event) => {
      if (
        event.responseStatusCode !== undefined ||
        event.responseErrorReason !== undefined
      ) {
        const sensitiveRequestKind =
          sensitiveAppCheckRequestsByFetchRequestId.get(event.requestId);
        assert.ok(
          sensitiveRequestKind,
          "A response-stage sensitive request pause had no request-stage decision.",
        );
        sensitiveAppCheckCdpResponsePausedRequestCount += 1;
        if (sensitiveRequestKind === "baseline-cdp-fetch-bridge") {
          baselineBridgeCdpResponsePausedRequestCount += 1;
        }
        if (sensitiveRequestKind === "vercel-bypass-header") {
          vercelBypassCdpResponsePausedRequestCount += 1;
        }
        if (event.responseErrorReason !== undefined) {
          sensitiveAppCheckResponseErrorAbortRequestCount += 1;
          if (sensitiveRequestKind === "vercel-bypass-header") {
            vercelBypassResponseErrorAbortRequestCount += 1;
          }
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        const responseStatus = Number(event.responseStatusCode || 0);
        if (sensitiveRequestKind === "vercel-bypass-header") {
          if (responseStatus >= 200 && responseStatus < 300) {
            vercelBypassHttpSuccessResponseCount += 1;
          } else {
            vercelBypassHttpErrorResponseCount += 1;
          }
        }
        if (responseStatus >= 300 && responseStatus < 400) {
          sensitiveAppCheckRedirectResponseAbortRequestCount += 1;
          if (sensitiveRequestKind === "baseline-cdp-fetch-bridge") {
            baselineBridgeInjectedRedirectResponseAbortCount += 1;
          }
          if (sensitiveRequestKind === "vercel-bypass-header") {
            vercelBypassRedirectResponseAbortRequestCount += 1;
          }
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        sensitiveAppCheckRequestsByFetchRequestId.delete(event.requestId);
        await appCheckCdpSession.send("Fetch.continueResponse", {
          requestId: event.requestId,
        });
        return;
      }
      appCheckCdpMonitorPausedRequestCount += 1;
      if (stage === "baseline") baselineBridgeCdpPausedRequestCount += 1;
      const requestUrl = event.request.url;
      const requestMethod = String(event.request.method).toUpperCase();
      const preTransmissionInspection = inspectNetworkRequest({
        url: requestUrl,
        method: requestMethod,
        phase: networkPhase,
        groupKey,
        captureId: activeCaptureId,
        correlationId: `${groupKey}:cdp-pre-transmission-${appCheckCdpMonitorPausedRequestCount}`,
      });
      const preTransmissionDecision = preTransmissionBoundaryDecision(
        preTransmissionInspection,
      );
      preTransmissionBoundaryInspectionCount += 1;
      if (preTransmissionDecision.block) {
        preTransmissionBoundaryBlockAttemptCount += 1;
        preTransmissionBoundaryProductionBlockCount += Number(
          preTransmissionDecision.marker === "production",
        );
        preTransmissionBoundaryUnboundFirebaseBlockCount += Number(
          preTransmissionDecision.marker === "unbound-firebase",
        );
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        preTransmissionBoundaryFailRequestCount += 1;
        return;
      }
      const headerEntries = Object.entries(event.request.headers || {}).map(
        ([name, value]) => ({ name, value: String(value) }),
      );
      const postData = String(event.request.postData || "");
      const preexistingVercelBypassHeader = headerEntries.find(
        ({ name }) => name.toLowerCase() === "x-vercel-protection-bypass",
      );
      const bypassSecretObservedOutsideCdpInjection =
        Boolean(bypassSecret) &&
        (requestUrl.includes(bypassSecret) ||
          postData.includes(bypassSecret) ||
          headerEntries.some(({ value }) => value.includes(bypassSecret)));
      if (
        preexistingVercelBypassHeader ||
        bypassSecretObservedOutsideCdpInjection
      ) {
        if (preexistingVercelBypassHeader) {
          vercelBypassPreexistingHeaderObservationCount += 1;
        }
        unauthorizedVercelBypassEgressCount += 1;
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const debugTokenInUrl = requestUrl.includes(appCheckDebugToken);
      const debugTokenInHeaders = headerEntries.some(({ value }) =>
        value.includes(appCheckDebugToken),
      );
      const debugTokenInPostData = postData.includes(appCheckDebugToken);
      const debugTokenObserved =
        debugTokenInUrl || debugTokenInHeaders || debugTokenInPostData;
      if (debugTokenObserved) {
        debugTokenNetworkObservationCount += 1;
        unauthorizedDebugTokenEgressCount += 1;
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const debugSentinelInUrl = requestUrl.includes(APP_CHECK_DEBUG_SENTINEL);
      const debugSentinelInHeaders = headerEntries.some(({ value }) =>
        value.includes(APP_CHECK_DEBUG_SENTINEL),
      );
      const debugSentinelInPostData = postData.includes(
        APP_CHECK_DEBUG_SENTINEL,
      );
      const debugSentinelObserved =
        debugSentinelInUrl || debugSentinelInHeaders || debugSentinelInPostData;
      let replaceDebugExchangeBody = false;
      if (debugSentinelObserved) {
        debugSentinelNetworkObservationCount += 1;
        replaceDebugExchangeBody =
          !debugSentinelInUrl &&
          !debugSentinelInHeaders &&
          debugSentinelInPostData &&
          exactBrowserDebugExchangeScope({
            method: requestMethod,
            url: requestUrl,
            headers: headerEntries,
            postData,
          });
        if (!replaceDebugExchangeBody) {
          unauthorizedDebugSentinelEgressCount += 1;
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
      }
      const appCheckHeaderEntry = headerEntries.find(
        ({ name }) => name.toLowerCase() === "x-firebase-appcheck",
      );
      const nativeHeaderValue = appCheckHeaderEntry?.value || "";
      const nativeHeaderPresent = Boolean(nativeHeaderValue);
      const nativeHeaderJwtShapeValid =
        APP_CHECK_JWT_SHAPE_PATTERN.test(nativeHeaderValue);
      const redirectedSensitiveRequestKind = event.redirectedRequestId
        ? sensitiveAppCheckRequestsByFetchRequestId.get(
            event.redirectedRequestId,
          ) || ""
        : "";
      if (redirectedSensitiveRequestKind) {
        sensitiveAppCheckRedirectRequestCount += 1;
        sensitiveAppCheckRedirectAbortRequestCount += 1;
        if (redirectedSensitiveRequestKind === "baseline-cdp-fetch-bridge") {
          baselineBridgeRedirectRequestCount += 1;
          baselineBridgeRedirectHeaderAbsentRequestCount += 1;
          baselineBridgeRedirectAbortRequestCount += 1;
        }
        if (redirectedSensitiveRequestKind === "vercel-bypass-header") {
          vercelBypassRedirectRequestCount += 1;
          vercelBypassRedirectAbortRequestCount += 1;
        }
        await appCheckCdpSession.send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "BlockedByClient",
        });
        return;
      }
      const decision = baselineAppCheckBridgeDecision({
        method: requestMethod,
        url: requestUrl,
      });
      if (nativeHeaderPresent) {
        appCheckHeaderNetworkObservationCount += 1;
        const headerScopeAllowed =
          nativeHeaderJwtShapeValid &&
          (decision.eligible ||
            exactAuthAppCheckHeaderScope({
              method: requestMethod,
              url: requestUrl,
            }));
        if (!headerScopeAllowed) {
          unauthorizedAppCheckHeaderEgressCount += 1;
          await appCheckCdpSession.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient",
          });
          return;
        }
        authorizedAppCheckHeaderRequestCount += 1;
      }
      const vercelBypassEligible =
        Boolean(bypassSecret) && isVercelBypassEligibleUrl(requestUrl);
      if (vercelBypassEligible) {
        vercelBypassCdpInjectedRequestCount += 1;
        sensitiveAppCheckRequestsByFetchRequestId.set(
          event.requestId,
          "vercel-bypass-header",
        );
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          headers: [
            ...headerEntries.filter(
              ({ name }) => name.toLowerCase() !== "x-vercel-protection-bypass",
            ),
            { name: "x-vercel-protection-bypass", value: bypassSecret },
          ],
          interceptResponse: true,
        });
        return;
      }
      if (replaceDebugExchangeBody) {
        authorizedDebugExchangeBodyReplacementCount += 1;
        sensitiveAppCheckRequestsByFetchRequestId.set(
          event.requestId,
          "browser-debug-exchange-body-rewrite",
        );
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          postData: Buffer.from(
            JSON.stringify({ debug_token: appCheckDebugToken }),
            "utf8",
          ).toString("base64"),
          interceptResponse: true,
        });
        return;
      }
      if (stage !== "baseline") {
        if (nativeHeaderPresent) {
          sensitiveAppCheckRequestsByFetchRequestId.set(
            event.requestId,
            "native-app-check-header",
          );
        }
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          ...(nativeHeaderPresent ? { interceptResponse: true } : {}),
        });
        return;
      }
      if (decision.scopeMismatch) {
        baselineBridgeScopeMismatchRequestCount += 1;
      }
      if (!decision.eligible) {
        if (nativeHeaderPresent) {
          sensitiveAppCheckRequestsByFetchRequestId.set(
            event.requestId,
            "native-app-check-header",
          );
        }
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          ...(nativeHeaderPresent ? { interceptResponse: true } : {}),
        });
        return;
      }
      baselineBridgeEligibleRequestCount += 1;
      if (nativeHeaderPresent) {
        baselineBridgeNativeHeaderRequestCount += 1;
        sensitiveAppCheckRequestsByFetchRequestId.set(
          event.requestId,
          "native-app-check-header",
        );
        await appCheckCdpSession.send("Fetch.continueRequest", {
          requestId: event.requestId,
          interceptResponse: true,
        });
        return;
      }
      const bridgeToken = await captureAppCheckTokenManager.ensureFresh();
      if (stage === "candidate") candidateBridgeInjectedRequestCount += 1;
      else baselineBridgeInjectedRequestCount += 1;
      appCheckHeaderNetworkObservationCount += 1;
      authorizedAppCheckHeaderRequestCount += 1;
      sensitiveAppCheckRequestsByFetchRequestId.set(
        event.requestId,
        "baseline-cdp-fetch-bridge",
      );
      await appCheckCdpSession.send("Fetch.continueRequest", {
        requestId: event.requestId,
        headers: [
          ...headerEntries.filter(
            ({ name }) => name.toLowerCase() !== "x-firebase-appcheck",
          ),
          { name: "X-Firebase-AppCheck", value: bridgeToken },
        ],
        interceptResponse: true,
      });
    };
    appCheckCdpSession.on("Fetch.requestPaused", (event) => {
      const handlerPromise = handlePausedRequest(event)
        .catch(async () => {
          appCheckCdpHandlerErrorCount += 1;
          try {
            await appCheckCdpSession.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
          } catch (_error) {
            // The request may already have been terminated by the browser.
          }
        })
        .finally(() => {
          appCheckCdpHandlerPromises.delete(handlerPromise);
        });
      appCheckCdpHandlerPromises.add(handlerPromise);
    });
    await appCheckCdpSession.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });
    const pageErrors = [];
    page.on("pageerror", (error) => {
      const rawText = String(error);
      if (
        /\bcors\b|cross-origin request blocked|access-control-allow-origin/iu.test(
          rawText,
        )
      ) {
        browserCorsConsoleErrorCount += 1;
      }
      if (
        rawText.includes(appCheckDebugToken) ||
        rawText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        (Boolean(bypassSecret) && rawText.includes(bypassSecret)) ||
        JWT_PATTERN.test(rawText)
      ) {
        browserConsoleSecretObservationCount += 1;
      }
      pageErrors.push(
        sanitizeAppCheckDiagnostic(
          rawText,
          appCheckDebugToken,
          APP_CHECK_DEBUG_SENTINEL,
          bypassSecret,
        ),
      );
    });
    page.on("requestfailed", () => {
      browserRequestFailureCount += 1;
    });
    page.on("console", (message) => {
      const rawText = message.text();
      browserConsoleMessageCount += 1;
      if (
        message.type() === "error" &&
        /\bcors\b|cross-origin request blocked|access-control-allow-origin/iu.test(
          rawText,
        )
      ) {
        browserCorsConsoleErrorCount += 1;
      }
      if (
        rawText.includes(appCheckDebugToken) ||
        rawText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        (Boolean(bypassSecret) && rawText.includes(bypassSecret)) ||
        JWT_PATTERN.test(rawText)
      ) {
        browserConsoleSecretObservationCount += 1;
      }
      const textValue = sanitizeAppCheckDiagnostic(
        rawText,
        appCheckDebugToken,
        APP_CHECK_DEBUG_SENTINEL,
        bypassSecret,
      );
      if (message.type() === "error") pageErrors.push(textValue);
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
      const appCheckDebugGlobalDescriptor = await page.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(
          self,
          "FIREBASE_APPCHECK_DEBUG_TOKEN",
        );
        return {
          value: typeof descriptor?.value === "string" ? descriptor.value : "",
          enumerable: descriptor?.enumerable,
        };
      });
      const browserGlobalContainsRawDebugToken =
        appCheckDebugGlobalDescriptor.value === appCheckDebugToken;
      browserGlobalRawDebugTokenWriteCount += Number(
        browserGlobalContainsRawDebugToken,
      );
      browserGlobalDebugSentinelWriteCount += Number(
        appCheckDebugGlobalDescriptor.value === APP_CHECK_DEBUG_SENTINEL,
      );
      assert.equal(
        browserGlobalContainsRawDebugToken,
        false,
        "The App Check browser global contained the raw debug token.",
      );
      assert.equal(
        appCheckDebugGlobalDescriptor.value === APP_CHECK_DEBUG_SENTINEL,
        true,
        "The App Check browser global did not contain the fixed sentinel.",
      );
      assert.equal(appCheckDebugGlobalDescriptor.enumerable, false);
      appCheckDebugGlobalDescriptor.value = "";

      const localStorageSnapshot = await page.evaluate(() =>
        Object.entries(localStorage).flatMap(([key, value]) => [key, value]),
      );
      const localStorageContainsRawDebugToken = localStorageSnapshot.some(
        (value) => String(value).includes(appCheckDebugToken),
      );
      browserLocalStorageSecretWriteCount += Number(
        localStorageContainsRawDebugToken,
      );
      localStorageSnapshot.fill("");
      assert.equal(
        localStorageContainsRawDebugToken,
        false,
        "Browser localStorage contained the raw App Check debug token.",
      );

      let appCheckDomText = await page.evaluate(
        () => document.documentElement?.outerHTML || "",
      );
      const appCheckSecretObservedInDom =
        appCheckDomText.includes(appCheckDebugToken) ||
        appCheckDomText.includes(APP_CHECK_DEBUG_SENTINEL) ||
        /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u.test(
          appCheckDomText,
        );
      appCheckDomText = "";
      if (appCheckSecretObservedInDom) browserDomSecretObservationCount += 1;
      assert.equal(
        appCheckSecretObservedInDom,
        false,
        "Raw App Check token material reached the rendered DOM.",
      );
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
      await flushNetworkAttestations();
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
                response.status >= 200 &&
                response.status < 300,
            )
            .map((response) => response.correlationId),
        );
        const successfulProtectedRequests = captureRequests.filter(
          (request) =>
            request.method !== "OPTIONS" &&
            request.stagingMarker &&
            fixtureDataServices.has(request.firebaseService) &&
            successfulDataResponseIds.has(request.correlationId),
        );
        assert.ok(
          successfulProtectedRequests.length > 0,
          `${target.screen.id} has no correlated successful staging data exchange.`,
        );
        const requiredHeaderSource =
          stage === "baseline" ? "baseline-cdp-fetch-bridge" : "native-sdk";
        assert.equal(
          successfulProtectedRequests.every(
            (request) =>
              request.appCheckHeaderPresent &&
              request.appCheckHeaderJwtShapeValid &&
              request.appCheckHeaderSource === requiredHeaderSource,
          ),
          true,
          `${target.screen.id} has a successful capture-bound data request without the required ${requiredHeaderSource} App Check JWT.`,
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
    if (appCheckCdpSession) {
      for (const frame of page.frames()) observeFrameOrigin(frame);
      const targetSnapshot = await appCheckCdpSession.send("Target.getTargets");
      targetSnapshotCount += 1;
      groupRetainedOopifTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "iframe",
      ).length;
      groupRetainedDedicatedWorkerTargetCount =
        targetSnapshot.targetInfos.filter(
          (targetInfo) =>
            targetInfo.browserContextId === groupBrowserContextId &&
            targetInfo.type === "worker",
        ).length;
      groupRetainedSharedWorkerTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "shared_worker",
      ).length;
      groupRetainedServiceWorkerTargetCount = targetSnapshot.targetInfos.filter(
        (targetInfo) =>
          targetInfo.browserContextId === groupBrowserContextId &&
          targetInfo.type === "service_worker",
      ).length;
      while (appCheckCdpHandlerPromises.size > 0) {
        await Promise.all([...appCheckCdpHandlerPromises]);
      }
      await flushNetworkAttestations();
      groupRetainedPageCount = context.pages().length;
      groupServiceWorkerCount = context.serviceWorkers().length;
      assert.equal(
        groupRetainedPageCount,
        1,
        "The App Check capture retained an unmonitored extra page.",
      );
      assert.equal(
        groupServiceWorkerCount,
        0,
        "The App Check capture created an unmonitored service worker.",
      );
      await context.close();
      browserContextCloseCount += 1;
      while (appCheckCdpHandlerPromises.size > 0) {
        await Promise.all([...appCheckCdpHandlerPromises]);
      }
      await flushNetworkAttestations();
      groupOopifTargetCount = discoveredTargetIdsByType.get("iframe").size;
      groupDedicatedWorkerTargetCount =
        discoveredTargetIdsByType.get("worker").size;
      groupSharedWorkerTargetCount =
        discoveredTargetIdsByType.get("shared_worker").size;
      groupServiceWorkerTargetCount =
        discoveredTargetIdsByType.get("service_worker").size;
      groupPendingBridgeDecisionResidualCount = appCheckCdpHandlerPromises.size;
      groupPendingBridgeObservationResidualCount =
        pendingNetworkAttestations.size;
      groupSensitiveRequestTrackingResidualCount =
        sensitiveAppCheckRequestsByFetchRequestId.size;
      sensitiveAppCheckRequestTrackingResidualCount +=
        groupSensitiveRequestTrackingResidualCount;
      pendingBridgeDecisionResidualCount +=
        groupPendingBridgeDecisionResidualCount;
      pendingBridgeObservationResidualCount +=
        groupPendingBridgeObservationResidualCount;
      assert.equal(
        groupSensitiveRequestTrackingResidualCount,
        0,
        "An App Check-sensitive CDP request had no terminal response decision.",
      );
      assert.equal(groupPendingBridgeDecisionResidualCount, 0);
      assert.equal(groupPendingBridgeObservationResidualCount, 0);
      assert.equal(
        appCheckCdpHandlerErrorCount - groupBaselineBridgeHandlerErrorStart,
        0,
        "A baseline CDP Fetch bridge handler failed.",
      );
      appCheckCdpSession = null;
    }
    unexpectedExtraPageCount += Math.max(0, groupPageCount - 1);
    unexpectedDedicatedWorkerCount += groupDedicatedWorkerCount;
    unexpectedServiceWorkerCount += groupServiceWorkerCount;
    unexpectedCrossOriginFrameCount += groupUnexpectedCrossOriginFrameCount;
    unexpectedOopifTargetCount += groupOopifTargetCount;
    unexpectedDedicatedWorkerTargetCount += groupDedicatedWorkerTargetCount;
    unexpectedSharedWorkerTargetCount += groupSharedWorkerTargetCount;
    unexpectedServiceWorkerTargetCount += groupServiceWorkerTargetCount;
    retainedOopifTargetCount += groupRetainedOopifTargetCount;
    retainedDedicatedWorkerTargetCount +=
      groupRetainedDedicatedWorkerTargetCount;
    retainedSharedWorkerTargetCount += groupRetainedSharedWorkerTargetCount;
    retainedServiceWorkerTargetCount += groupRetainedServiceWorkerTargetCount;
    assert.equal(
      groupPageCount,
      1,
      "The App Check capture context opened an unmonitored extra page.",
    );
    assert.equal(
      groupDedicatedWorkerCount,
      0,
      "The App Check capture created an unmonitored dedicated worker.",
    );
    assert.equal(
      groupUnexpectedCrossOriginFrameCount,
      0,
      "The App Check capture created an unmonitored cross-origin frame.",
    );
    assert.equal(
      groupOopifTargetCount,
      0,
      "The App Check capture created an unmonitored OOPIF target.",
    );
    assert.equal(
      groupDedicatedWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored dedicated-worker target.",
    );
    assert.equal(
      groupSharedWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored shared-worker target.",
    );
    assert.equal(
      groupServiceWorkerTargetCount,
      0,
      "The App Check capture created an unmonitored service-worker target.",
    );
    assert.equal(groupRetainedOopifTargetCount, 0);
    assert.equal(groupRetainedDedicatedWorkerTargetCount, 0);
    assert.equal(groupRetainedSharedWorkerTargetCount, 0);
    assert.equal(groupRetainedServiceWorkerTargetCount, 0);
    activeCaptureId = null;
    networkPhase = "browser-audit-finalization";
    const groupRequests = networkObservations.slice(
      groupNetworkObservationStart,
    );
    const groupResponses = networkResponseObservations.slice(
      groupNetworkResponseObservationStart,
    );
    const groupScreenCaptureProtectedRequests = groupRequests.filter(
      (request) =>
        request.phase === "screen-capture" &&
        request.stagingMarker &&
        fixtureDataServices.has(request.firebaseService) &&
        request.method !== "OPTIONS",
    );
    const groupProtectedDataRequests = groupRequests.filter(
      (request) =>
        request.stagingMarker &&
        fixtureDataServices.has(request.firebaseService) &&
        request.method !== "OPTIONS",
    );
    const groupBridgeDecisionUnmatchedProtectedRequestCount =
      stage === "baseline"
        ? groupProtectedDataRequests.filter(
            (request) => !request.appCheckBridgeDecisionObserved,
          ).length
        : 0;
    const groupBridgeScopeIneligibleProtectedRequestCount =
      stage === "baseline"
        ? groupProtectedDataRequests.filter(
            (request) => !request.appCheckBridgeScopeEligible,
          ).length
        : 0;
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
      {
        type: "app-check-bridge",
        id: groupKey,
        stage,
        scopeHash: baselineAppCheckBridgeScopeHash,
        browserCdpSecurityScopeHash,
        serviceWorkerPolicy: "block",
        interceptionMechanism: "cdp-fetch-request-stage",
        preTransmissionBoundaryAttestationHash:
          preTransmissionNetworkBoundaryAttestationHash,
        preTransmissionBoundaryInspectionCount:
          preTransmissionBoundaryInspectionCount -
          groupPreTransmissionBoundaryInspectionStart,
        preTransmissionBoundaryBlockAttemptCount:
          preTransmissionBoundaryBlockAttemptCount -
          groupPreTransmissionBoundaryBlockAttemptStart,
        preTransmissionBoundaryProductionBlockCount:
          preTransmissionBoundaryProductionBlockCount -
          groupPreTransmissionBoundaryProductionBlockStart,
        preTransmissionBoundaryUnboundFirebaseBlockCount:
          preTransmissionBoundaryUnboundFirebaseBlockCount -
          groupPreTransmissionBoundaryUnboundFirebaseBlockStart,
        preTransmissionBoundaryFailRequestCount:
          preTransmissionBoundaryFailRequestCount -
          groupPreTransmissionBoundaryFailRequestStart,
        headerCorrelationMechanism: "playwright-request-allHeaders",
        secretInitScope: "primary-page-only",
        browserGlobalValueKind: "non-secret-fixed-sentinel",
        debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
        pageRawDebugTokenInjectionCount:
          pageRawDebugTokenInjectionCount -
          groupPageRawDebugTokenInjectionStart,
        browserGlobalRawDebugTokenWriteCount:
          browserGlobalRawDebugTokenWriteCount -
          groupBrowserGlobalRawDebugTokenWriteStart,
        browserGlobalDebugSentinelWriteCount:
          browserGlobalDebugSentinelWriteCount -
          groupBrowserGlobalDebugSentinelWriteStart,
        localStorageSecretWriteCount:
          browserLocalStorageSecretWriteCount -
          groupBrowserLocalStorageSecretWriteStart,
        pageAppCheckSecretInitRegistrationCount,
        contextAppCheckSecretInitCount:
          contextAppCheckSecretInitRegistrationCount,
        protocolDebugLoggingDisabled: true,
        browserLaunchExplicitEnvironment: true,
        childProcessSecretEnvScrubbed: true,
        browserChildEnvironmentAllowlisted: true,
        browserChildEnvironmentAllowlistHash: sha256(
          canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
        ),
        browserChildEnvironmentUnexpectedKeyCount,
        scrubbedSecretEnvironmentVariableCount:
          BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.length,
        browserChildSecretEnvironmentVariableCount,
        browserChildSecretValueObservationCount,
        browserGlobalExtraHttpHeaderRegistrationCount,
        vercelBypassConfigured: Boolean(bypassSecret),
        vercelBypassAllowedOriginSetHash: sha256(
          canonicalJson(vercelBypassAllowedOrigins),
        ),
        vercelBypassTransportContractHash: sha256(
          canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
        ),
        vercelBypassCdpInjectedRequestCount:
          vercelBypassCdpInjectedRequestCount -
          groupVercelBypassCdpInjectedStart,
        vercelBypassPreexistingHeaderObservationCount:
          vercelBypassPreexistingHeaderObservationCount -
          groupVercelBypassPreexistingHeaderObservationStart,
        unauthorizedVercelBypassEgressCount:
          unauthorizedVercelBypassEgressCount -
          groupUnauthorizedVercelBypassEgressStart,
        vercelBypassCdpResponsePausedRequestCount:
          vercelBypassCdpResponsePausedRequestCount -
          groupVercelBypassCdpResponsePausedStart,
        vercelBypassHttpSuccessResponseCount:
          vercelBypassHttpSuccessResponseCount -
          groupVercelBypassHttpSuccessResponseStart,
        vercelBypassHttpErrorResponseCount:
          vercelBypassHttpErrorResponseCount -
          groupVercelBypassHttpErrorResponseStart,
        vercelBypassRedirectRequestCount:
          vercelBypassRedirectRequestCount -
          groupVercelBypassRedirectRequestStart,
        vercelBypassRedirectAbortRequestCount:
          vercelBypassRedirectAbortRequestCount -
          groupVercelBypassRedirectAbortStart,
        vercelBypassRedirectResponseAbortRequestCount:
          vercelBypassRedirectResponseAbortRequestCount -
          groupVercelBypassRedirectResponseAbortStart,
        vercelBypassResponseErrorAbortRequestCount:
          vercelBypassResponseErrorAbortRequestCount -
          groupVercelBypassResponseErrorAbortStart,
        vercelBypassObservedEligibleRequestCount:
          vercelBypassObservedEligibleRequestCount -
          groupVercelBypassObservedEligibleStart,
        vercelBypassHeaderObservedRequestCount:
          vercelBypassHeaderObservedRequestCount -
          groupVercelBypassHeaderObservedStart,
        vercelBypassHeaderMissingRequestCount:
          vercelBypassHeaderMissingRequestCount -
          groupVercelBypassHeaderMissingStart,
        vercelBypassHeaderMismatchRequestCount:
          vercelBypassHeaderMismatchRequestCount -
          groupVercelBypassHeaderMismatchStart,
        rawVercelBypassOutputCount: 0,
        urlMethodFifoCorrelationUsed: false,
        playwrightRouteRegistrationCount,
        eligibleRequestCount:
          baselineBridgeEligibleRequestCount - groupBaselineBridgeEligibleStart,
        injectedRequestCount:
          baselineBridgeInjectedRequestCount - groupBaselineBridgeInjectedStart,
        nativeHeaderRequestCount:
          baselineBridgeNativeHeaderRequestCount -
          groupBaselineBridgeNativeHeaderStart,
        scopeMismatchRequestCount:
          baselineBridgeScopeMismatchRequestCount -
          groupBaselineBridgeScopeMismatchStart,
        strippedHeaderRequestCount:
          baselineBridgeStrippedHeaderRequestCount -
          groupBaselineBridgeStrippedHeaderStart,
        redirectRequestCount:
          baselineBridgeRedirectRequestCount - groupBaselineBridgeRedirectStart,
        redirectHeaderAbsentRequestCount:
          baselineBridgeRedirectHeaderAbsentRequestCount -
          groupBaselineBridgeRedirectHeaderAbsentStart,
        redirectAbortRequestCount:
          baselineBridgeRedirectAbortRequestCount -
          groupBaselineBridgeRedirectAbortStart,
        cdpPausedRequestCount:
          baselineBridgeCdpPausedRequestCount -
          groupBaselineBridgeCdpPausedStart,
        cdpResponsePausedRequestCount:
          baselineBridgeCdpResponsePausedRequestCount -
          groupBaselineBridgeCdpResponsePausedStart,
        cdpReconciledRequestCount:
          baselineBridgeCdpReconciledRequestCount -
          groupBaselineBridgeCdpReconciledStart,
        handlerErrorCount:
          appCheckCdpHandlerErrorCount - groupBaselineBridgeHandlerErrorStart,
        injectedRedirectResponseAbortRequestCount:
          baselineBridgeInjectedRedirectResponseAbortCount -
          groupBaselineBridgeInjectedRedirectResponseAbortStart,
        cdpMonitorPausedRequestCount:
          appCheckCdpMonitorPausedRequestCount -
          groupAppCheckCdpMonitorPausedStart,
        debugTokenNetworkObservationCount:
          debugTokenNetworkObservationCount -
          groupDebugTokenNetworkObservationStart,
        debugSentinelNetworkObservationCount:
          debugSentinelNetworkObservationCount -
          groupDebugSentinelNetworkObservationStart,
        authorizedDebugExchangeBodyReplacementCount:
          authorizedDebugExchangeBodyReplacementCount -
          groupAuthorizedDebugExchangeBodyReplacementStart,
        unauthorizedDebugTokenEgressCount:
          unauthorizedDebugTokenEgressCount -
          groupUnauthorizedDebugTokenEgressStart,
        unauthorizedDebugSentinelEgressCount:
          unauthorizedDebugSentinelEgressCount -
          groupUnauthorizedDebugSentinelEgressStart,
        appCheckHeaderNetworkObservationCount:
          appCheckHeaderNetworkObservationCount -
          groupAppCheckHeaderNetworkObservationStart,
        authorizedAppCheckHeaderRequestCount:
          authorizedAppCheckHeaderRequestCount -
          groupAuthorizedAppCheckHeaderRequestStart,
        unauthorizedAppCheckHeaderEgressCount:
          unauthorizedAppCheckHeaderEgressCount -
          groupUnauthorizedAppCheckHeaderEgressStart,
        sensitiveRedirectRequestCount:
          sensitiveAppCheckRedirectRequestCount -
          groupSensitiveAppCheckRedirectRequestStart,
        sensitiveRedirectAbortRequestCount:
          sensitiveAppCheckRedirectAbortRequestCount -
          groupSensitiveAppCheckRedirectAbortRequestStart,
        sensitiveCdpResponsePausedRequestCount:
          sensitiveAppCheckCdpResponsePausedRequestCount -
          groupSensitiveAppCheckCdpResponsePausedStart,
        sensitiveRedirectResponseAbortRequestCount:
          sensitiveAppCheckRedirectResponseAbortRequestCount -
          groupSensitiveAppCheckRedirectResponseAbortStart,
        sensitiveResponseErrorAbortRequestCount:
          sensitiveAppCheckResponseErrorAbortRequestCount -
          groupSensitiveAppCheckResponseErrorAbortStart,
        sensitiveRequestTrackingResidualCount:
          groupSensitiveRequestTrackingResidualCount,
        networkHeaderAttestationErrorCount,
        pendingBridgeDecisionResidualCount:
          groupPendingBridgeDecisionResidualCount,
        pendingBridgeObservationResidualCount:
          groupPendingBridgeObservationResidualCount,
        unexpectedExtraPageCount: Math.max(0, groupPageCount - 1),
        unexpectedDedicatedWorkerCount: groupDedicatedWorkerCount,
        unexpectedServiceWorkerCount: groupServiceWorkerCount,
        unexpectedCrossOriginFrameCount: groupUnexpectedCrossOriginFrameCount,
        unexpectedOopifTargetCount: groupOopifTargetCount,
        unexpectedDedicatedWorkerTargetCount: groupDedicatedWorkerTargetCount,
        unexpectedSharedWorkerTargetCount: groupSharedWorkerTargetCount,
        unexpectedServiceWorkerTargetCount: groupServiceWorkerTargetCount,
        retainedOopifTargetCount: groupRetainedOopifTargetCount,
        retainedDedicatedWorkerTargetCount:
          groupRetainedDedicatedWorkerTargetCount,
        retainedSharedWorkerTargetCount: groupRetainedSharedWorkerTargetCount,
        retainedServiceWorkerTargetCount: groupRetainedServiceWorkerTargetCount,
        targetDiscoveryActivationCount:
          targetDiscoveryActivationCount - groupTargetDiscoveryActivationStart,
        targetSnapshotCount: targetSnapshotCount - groupTargetSnapshotStart,
        unmatchedProtectedRequestCount:
          groupBridgeDecisionUnmatchedProtectedRequestCount,
        scopeIneligibleProtectedRequestCount:
          groupBridgeScopeIneligibleProtectedRequestCount,
        candidateBridgeInjectedRequestCount:
          candidateBridgeInjectedRequestCount -
          groupCandidateBridgeInjectedStart,
        screenCaptureProtectedRequestCount:
          groupScreenCaptureProtectedRequests.length,
        screenCaptureBridgeHeaderRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) =>
              request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
          ).length,
        screenCaptureNativeHeaderRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) => request.appCheckHeaderSource === "native-sdk",
          ).length,
        invalidHeaderJwtShapeRequestCount:
          groupScreenCaptureProtectedRequests.filter(
            (request) => !request.appCheckHeaderJwtShapeValid,
          ).length,
        rawHeaderValueOutputCount: 0,
        rawTokenOutputCount: 0,
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
        appCheckHeaderPresent: request.appCheckHeaderPresent,
        appCheckHeaderSource: request.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid: request.appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: request.appCheckBridgeDecisionObserved,
        appCheckBridgeScopeEligible: request.appCheckBridgeScopeEligible,
        appCheckBridgeHeaderStripped: request.appCheckBridgeHeaderStripped,
        appCheckBridgeRedirectedRequest:
          request.appCheckBridgeRedirectedRequest,
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
        appCheckHeaderPresent: response.appCheckHeaderPresent,
        appCheckHeaderSource: response.appCheckHeaderSource,
        appCheckHeaderJwtShapeValid: response.appCheckHeaderJwtShapeValid,
        appCheckBridgeDecisionObserved: response.appCheckBridgeDecisionObserved,
        appCheckBridgeScopeEligible: response.appCheckBridgeScopeEligible,
        appCheckBridgeHeaderStripped: response.appCheckBridgeHeaderStripped,
        appCheckBridgeRedirectedRequest:
          response.appCheckBridgeRedirectedRequest,
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
      appCheckDebugToken,
      APP_CHECK_DEBUG_SENTINEL,
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
    assertNoAppCheckSecretMaterial(browserAuditText, {
      debugToken: appCheckDebugToken,
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
    });
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
  }
} finally {
  try {
    await browser.close();
  } finally {
    await captureAppCheckTokenManager.close();
  }
}
assert.equal(appCheckInitScriptInjectionCount, groupedTargets.size);
assert.equal(pageRawDebugTokenInjectionCount, 0);
assert.equal(browserGlobalRawDebugTokenWriteCount, 0);
assert.equal(browserLocalStorageSecretWriteCount, 0);
assert.ok(browserGlobalDebugSentinelWriteCount >= groupedTargets.size);
assert.equal(browserContextCloseCount, groupedTargets.size);
assert.equal(targetDiscoveryActivationCount, groupedTargets.size);
assert.equal(targetSnapshotCount, groupedTargets.size);
assert.equal(
  browserConsoleSecretObservationCount,
  0,
  "Raw App Check token material reached the browser console.",
);
assert.equal(
  browserDomSecretObservationCount,
  0,
  "Raw App Check token material reached the rendered DOM.",
);
assert.equal(
  browserRequestFailureCount,
  0,
  "A browser request failed during App Check-bound capture.",
);
assert.equal(
  browserCorsConsoleErrorCount,
  0,
  "A browser CORS error occurred during App Check-bound capture.",
);
assert.equal(browserNetworkHeaderAttestationErrorCount, 0);
assert.equal(unexpectedExtraPageCount, 0);
assert.equal(unexpectedDedicatedWorkerCount, 0);
assert.equal(unexpectedServiceWorkerCount, 0);
assert.equal(unexpectedCrossOriginFrameCount, 0);
assert.equal(unexpectedOopifTargetCount, 0);
assert.equal(unexpectedDedicatedWorkerTargetCount, 0);
assert.equal(unexpectedSharedWorkerTargetCount, 0);
assert.equal(unexpectedServiceWorkerTargetCount, 0);
assert.equal(retainedOopifTargetCount, 0);
assert.equal(retainedDedicatedWorkerTargetCount, 0);
assert.equal(retainedSharedWorkerTargetCount, 0);
assert.equal(retainedServiceWorkerTargetCount, 0);
assert.equal(playwrightRouteRegistrationCount, 0);
assert.equal(browserGlobalExtraHttpHeaderRegistrationCount, 0);

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

let nodeDeploymentFetchRequestCount = 0;
let nodeDeploymentFetchHttp200Count = 0;
let nodeDeploymentRedirectResponseCount = 0;
let nodeVercelBypassHeaderRequestCount = 0;
const fetchHtml = async (url) => {
  const parsed = new URL(url);
  assert.ok(vercelBypassAllowedOrigins.includes(exactVercelOrigin(parsed)));
  nodeDeploymentFetchRequestCount += 1;
  if (bypassSecret) nodeVercelBypassHeaderRequestCount += 1;
  const response = await fetch(parsed, {
    headers: deploymentBypassHeaders,
    redirect: "error",
  });
  if (response.status >= 300 && response.status < 400) {
    nodeDeploymentRedirectResponseCount += 1;
  }
  assert.equal(response.status, 200, `${url} is not available.`);
  nodeDeploymentFetchHttp200Count += 1;
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
    const assetUrl = new URL(path, deploymentUrl);
    assert.ok(vercelBypassAllowedOrigins.includes(exactVercelOrigin(assetUrl)));
    nodeDeploymentFetchRequestCount += 1;
    if (bypassSecret) nodeVercelBypassHeaderRequestCount += 1;
    const response = await fetch(assetUrl, {
      headers: deploymentBypassHeaders,
      redirect: "error",
    });
    if (response.status >= 300 && response.status < 400) {
      nodeDeploymentRedirectResponseCount += 1;
    }
    assert.equal(response.status, 200, `${path} is not available.`);
    nodeDeploymentFetchHttp200Count += 1;
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
assert.equal(nodeDeploymentRedirectResponseCount, 0);
assert.equal(nodeDeploymentFetchRequestCount, nodeDeploymentFetchHttp200Count);
assert.equal(
  nodeVercelBypassHeaderRequestCount,
  bypassSecret ? nodeDeploymentFetchRequestCount : 0,
);
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
const protectedDataRequests = networkObservations.filter(
  (request) =>
    request.stagingMarker &&
    fixtureDataServices.has(request.firebaseService) &&
    request.method !== "OPTIONS",
);
const baselineProtectedDataRequests = protectedDataRequests.filter((request) =>
  request.groupKey.startsWith("baseline:"),
);
const candidateProtectedDataRequests = protectedDataRequests.filter((request) =>
  request.groupKey.startsWith("candidate:"),
);
const candidateNativeAppCheckHeaderMissingRequestCount =
  candidateProtectedDataRequests.filter(
    (request) => !request.appCheckHeaderPresent,
  ).length;
const baselineEffectiveHeaderMissingRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckHeaderPresent,
  ).length;
const baselineBridgeDecisionUnmatchedProtectedRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckBridgeDecisionObserved,
  ).length;
const baselineBridgeScopeIneligibleProtectedRequestCount =
  baselineProtectedDataRequests.filter(
    (request) => !request.appCheckBridgeScopeEligible,
  ).length;
const protectedHeaderJwtShapeInvalidRequestCount = protectedDataRequests.filter(
  (request) =>
    !request.appCheckHeaderPresent || !request.appCheckHeaderJwtShapeValid,
).length;
const baselineScreenCaptureProtectedDataRequests =
  baselineProtectedDataRequests.filter(
    (request) => request.phase === "screen-capture",
  );
const candidateScreenCaptureProtectedDataRequests =
  candidateProtectedDataRequests.filter(
    (request) => request.phase === "screen-capture",
  );
const baselineScreenCaptureBridgeRequestCount =
  baselineScreenCaptureProtectedDataRequests.filter(
    (request) => request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
  ).length;
const candidateScreenCaptureNativeRequestCount =
  candidateScreenCaptureProtectedDataRequests.filter(
    (request) => request.appCheckHeaderSource === "native-sdk",
  ).length;
const firebaseDataRedirectResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 300 &&
    response.status < 400,
).length;
const firebaseDataErrorResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 400,
).length;
const successfulFirebaseDataResponseCount = networkResponseObservations.filter(
  (response) =>
    response.stagingMarker &&
    fixtureDataServices.has(response.firebaseService) &&
    response.status >= 200 &&
    response.status < 300,
).length;
assert.ok(baselineProtectedDataRequests.length > 0);
assert.ok(candidateProtectedDataRequests.length > 0);
assert.equal(
  baselineBridgeEligibleRequestCount,
  baselineProtectedDataRequests.length,
  "A baseline Firebase data request escaped the exact App Check bridge scope.",
);
assert.equal(
  baselineBridgeInjectedRequestCount + baselineBridgeNativeHeaderRequestCount,
  baselineBridgeEligibleRequestCount,
);
assert.ok(
  baselineBridgeInjectedRequestCount > 0,
  "The baseline bundle never exercised the App Check route bridge.",
);
assert.equal(baselineBridgeScopeMismatchRequestCount, 0);
assert.equal(baselineEffectiveHeaderMissingRequestCount, 0);
assert.equal(baselineBridgeDecisionUnmatchedProtectedRequestCount, 0);
assert.equal(baselineBridgeScopeIneligibleProtectedRequestCount, 0);
assert.ok(baselineBridgeCdpPausedRequestCount > 0);
assert.ok(baselineBridgeCdpReconciledRequestCount > 0);
assert.equal(appCheckCdpHandlerErrorCount, 0);
assert.equal(baselineBridgeRedirectAbortRequestCount, 0);
assert.equal(candidateBridgeInjectedRequestCount, 0);
assert.equal(candidateNativeAppCheckHeaderMissingRequestCount, 0);
assert.equal(protectedHeaderJwtShapeInvalidRequestCount, 0);
assert.ok(baselineScreenCaptureProtectedDataRequests.length > 0);
assert.equal(
  baselineScreenCaptureBridgeRequestCount,
  baselineScreenCaptureProtectedDataRequests.length,
);
assert.ok(candidateScreenCaptureProtectedDataRequests.length > 0);
assert.equal(
  candidateScreenCaptureNativeRequestCount,
  candidateScreenCaptureProtectedDataRequests.length,
);
assert.equal(firebaseDataRedirectResponseCount, 0);
assert.equal(firebaseDataErrorResponseCount, 0);
assert.ok(successfulFirebaseDataResponseCount > 0);
assert.ok(networkSummary.appCheckExchangeRequestCount > 0);
assert.equal(
  networkSummary.successfulAppCheckExchangeResponseCount,
  networkSummary.appCheckExchangeRequestCount,
);
assert.equal(
  networkSummary.appCheckProtectedDataRequestCount,
  protectedDataRequests.length,
);
assert.equal(
  networkSummary.appCheckHeaderPresentRequestCount,
  protectedDataRequests.length,
);
assert.equal(networkSummary.appCheckHeaderMissingRequestCount, 0);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeValidRequestCount,
  protectedDataRequests.length,
);
assert.equal(networkSummary.appCheckHeaderJwtShapeInvalidRequestCount, 0);
assert.equal(debugTokenNetworkObservationCount, 0);
assert.equal(unauthorizedDebugTokenEgressCount, 0);
assert.equal(
  debugSentinelNetworkObservationCount,
  authorizedDebugExchangeBodyReplacementCount,
);
assert.equal(unauthorizedDebugSentinelEgressCount, 0);
assert.equal(
  authorizedDebugExchangeBodyReplacementCount,
  networkSummary.appCheckExchangeRequestCount,
);
assert.equal(
  appCheckHeaderNetworkObservationCount,
  authorizedAppCheckHeaderRequestCount,
);
assert.equal(unauthorizedAppCheckHeaderEgressCount, 0);
assert.equal(sensitiveAppCheckRedirectRequestCount, 0);
assert.equal(sensitiveAppCheckRedirectAbortRequestCount, 0);
assert.equal(sensitiveAppCheckRedirectResponseAbortRequestCount, 0);
assert.equal(sensitiveAppCheckResponseErrorAbortRequestCount, 0);
assert.equal(sensitiveAppCheckRequestTrackingResidualCount, 0);
assert.equal(pendingBridgeDecisionResidualCount, 0);
assert.equal(pendingBridgeObservationResidualCount, 0);
assert.equal(vercelBypassPreexistingHeaderObservationCount, 0);
assert.equal(unauthorizedVercelBypassEgressCount, 0);
assert.equal(vercelBypassRedirectRequestCount, 0);
assert.equal(vercelBypassRedirectAbortRequestCount, 0);
assert.equal(vercelBypassRedirectResponseAbortRequestCount, 0);
assert.equal(vercelBypassResponseErrorAbortRequestCount, 0);
assert.equal(vercelBypassHttpErrorResponseCount, 0);
assert.equal(vercelBypassHeaderMissingRequestCount, 0);
assert.equal(vercelBypassHeaderMismatchRequestCount, 0);
if (bypassSecret) {
  assert.ok(vercelBypassCdpInjectedRequestCount > 0);
  assert.equal(
    vercelBypassCdpInjectedRequestCount,
    vercelBypassObservedEligibleRequestCount,
  );
  assert.equal(
    vercelBypassCdpInjectedRequestCount,
    vercelBypassHeaderObservedRequestCount,
  );
  assert.equal(
    vercelBypassCdpInjectedRequestCount,
    vercelBypassCdpResponsePausedRequestCount,
  );
  assert.equal(
    vercelBypassCdpInjectedRequestCount,
    vercelBypassHttpSuccessResponseCount,
  );
} else {
  assert.equal(vercelBypassCdpInjectedRequestCount, 0);
  assert.equal(vercelBypassObservedEligibleRequestCount, 0);
  assert.equal(vercelBypassHeaderObservedRequestCount, 0);
  assert.equal(vercelBypassCdpResponsePausedRequestCount, 0);
  assert.equal(vercelBypassHttpSuccessResponseCount, 0);
}
assert.equal(
  sensitiveAppCheckCdpResponsePausedRequestCount,
  authorizedDebugExchangeBodyReplacementCount +
    authorizedAppCheckHeaderRequestCount +
    vercelBypassCdpInjectedRequestCount,
);
assert.equal(
  baselineBridgeCdpResponsePausedRequestCount,
  baselineBridgeInjectedRequestCount,
);
assert.equal(baselineBridgeRedirectRequestCount, 0);
assert.equal(baselineBridgeRedirectHeaderAbsentRequestCount, 0);
assert.equal(baselineBridgeStrippedHeaderRequestCount, 0);
const preManifestEvidenceFiles = listEvidenceFiles(outputRoot);
const preManifestEvidenceText = preManifestEvidenceFiles
  .filter((fileName) => /\.jsonl?$/iu.test(fileName))
  .map((fileName) => readFileSync(resolve(outputRoot, fileName), "utf8"))
  .join("\n");
const literalOccurrenceCount = (textValue, needle) =>
  needle ? String(textValue).split(String(needle)).length - 1 : 0;
const rawDebugTokenOutputCount = literalOccurrenceCount(
  preManifestEvidenceText,
  appCheckDebugToken,
);
const rawExchangedTokenOutputCount = (
  preManifestEvidenceText.match(
    /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/gu,
  ) || []
).length;
const rawResponseBodyOutputCount = (
  preManifestEvidenceText.match(/"responseBody"\s*:/giu) || []
).length;
const rawHeaderValueOutputCount = (
  preManifestEvidenceText.match(
    /"(?:appCheckHeaderValue|x-firebase-appcheck|x-vercel-protection-bypass)"\s*:/giu,
  ) || []
).length;
const rawVercelBypassOutputCount = literalOccurrenceCount(
  preManifestEvidenceText,
  bypassSecret,
);
const rawTokenOutputCount =
  rawDebugTokenOutputCount + rawExchangedTokenOutputCount;
const traceWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /(?:\.trace|\.zip)$/iu.test(fileName),
).length;
const harWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /\.har$/iu.test(fileName),
).length;
const storageStateWriteCount = preManifestEvidenceFiles.filter((fileName) =>
  /storage[-_.]?state/iu.test(fileName),
).length;
assert.equal(traceWriteCount, 0);
assert.equal(harWriteCount, 0);
assert.equal(storageStateWriteCount, 0);
assert.equal(rawDebugTokenOutputCount, 0);
assert.equal(rawExchangedTokenOutputCount, 0);
assert.equal(rawResponseBodyOutputCount, 0);
assert.equal(rawHeaderValueOutputCount, 0);
assert.equal(rawVercelBypassOutputCount, 0);
assert.equal(rawTokenOutputCount, 0);
const appCheckBinding = {
  ...captureAppCheckTokenManager.binding,
  fixturePreBackupAttestationHash: preBackupNamespaceAccessAttestationHash,
  fixturePostBackupAttestationHash: backupNamespaceAccessAttestationHash,
  baselineBridgeScope: BASELINE_APP_CHECK_BRIDGE_SCOPE,
  baselineBridgeScopeHash: baselineAppCheckBridgeScopeHash,
  browserCdpSecurityScope: BROWSER_APP_CHECK_CDP_SECURITY_SCOPE,
  browserCdpSecurityScopeHash: browserAppCheckCdpSecurityScopeHash,
  preTransmissionBoundaryAttestationHash:
    preTransmissionNetworkBoundaryAttestationHash,
  preTransmissionBoundaryInspectionCount,
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount,
  preTransmissionBoundaryUnboundFirebaseBlockCount,
  preTransmissionBoundaryFailRequestCount,
  debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
  browserGlobalValueKind: "non-secret-fixed-sentinel",
  secretInitScope: "primary-page-only",
  pageRawDebugTokenInjectionCount,
  pageAppCheckSecretInitRegistrationCount,
  browserGlobalRawDebugTokenWriteCount,
  browserGlobalDebugSentinelWriteCount,
  contextAppCheckSecretInitCount: contextAppCheckSecretInitRegistrationCount,
  protocolDebugLoggingDisabled: true,
  browserLaunchExplicitEnvironment: true,
  childProcessSecretEnvScrubbed: true,
  browserChildEnvironmentAllowlisted: true,
  browserChildEnvironmentAllowlistHash: sha256(
    canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST),
  ),
  browserChildEnvironmentUnexpectedKeyCount,
  scrubbedSecretEnvironmentVariableCount:
    BROWSER_SECRET_ENVIRONMENT_VARIABLE_NAMES.length,
  browserChildSecretEnvironmentVariableCount,
  browserChildSecretValueObservationCount,
  browserGlobalExtraHttpHeaderRegistrationCount,
  vercelBypassConfigured: Boolean(bypassSecret),
  vercelBypassAllowedOriginSetHash: sha256(
    canonicalJson(vercelBypassAllowedOrigins),
  ),
  vercelBypassTransportContractHash: sha256(
    canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT),
  ),
  vercelBypassCdpInjectedRequestCount,
  vercelBypassPreexistingHeaderObservationCount,
  unauthorizedVercelBypassEgressCount,
  vercelBypassCdpResponsePausedRequestCount,
  vercelBypassHttpSuccessResponseCount,
  vercelBypassHttpErrorResponseCount,
  vercelBypassRedirectRequestCount,
  vercelBypassRedirectAbortRequestCount,
  vercelBypassRedirectResponseAbortRequestCount,
  vercelBypassResponseErrorAbortRequestCount,
  vercelBypassObservedEligibleRequestCount,
  vercelBypassHeaderObservedRequestCount,
  vercelBypassHeaderMissingRequestCount,
  vercelBypassHeaderMismatchRequestCount,
  rawVercelBypassOutputCount,
  rawDebugTokenOutputCount,
  rawExchangedTokenOutputCount,
  rawResponseBodyOutputCount,
  argvSecretCount,
  nodeDeploymentFetchRequestCount,
  nodeDeploymentFetchHttp200Count,
  nodeDeploymentRedirectResponseCount,
  nodeVercelBypassHeaderRequestCount,
  traceWriteCount,
  harWriteCount,
  storageStateWriteCount,
  playwrightRouteRegistrationCount,
  headerCorrelationMechanism: "playwright-request-allHeaders",
  urlMethodFifoCorrelationUsed: false,
  pendingBridgeDecisionResidualCount,
  pendingBridgeObservationResidualCount,
  baselineProtectedDataRequestCount: baselineProtectedDataRequests.length,
  baselineBridgeEligibleRequestCount,
  baselineBridgeInjectedRequestCount,
  baselineBridgeNativeHeaderRequestCount,
  baselineBridgeScopeMismatchRequestCount,
  baselineBridgeStrippedHeaderRequestCount,
  baselineBridgeRedirectRequestCount,
  baselineBridgeRedirectHeaderAbsentRequestCount,
  baselineBridgeRedirectAbortRequestCount,
  baselineBridgeCdpPausedRequestCount,
  baselineBridgeCdpResponsePausedRequestCount,
  baselineBridgeCdpReconciledRequestCount,
  appCheckCdpHandlerErrorCount,
  baselineBridgeInjectedRedirectResponseAbortCount,
  baselineBridgeDecisionUnmatchedProtectedRequestCount,
  baselineBridgeScopeIneligibleProtectedRequestCount,
  baselineEffectiveHeaderMissingRequestCount,
  baselineScreenCaptureProtectedRequestCount:
    baselineScreenCaptureProtectedDataRequests.length,
  baselineScreenCaptureBridgeRequestCount,
  candidateProtectedDataRequestCount: candidateProtectedDataRequests.length,
  candidateNativeHeaderPresentRequestCount:
    candidateProtectedDataRequests.length -
    candidateNativeAppCheckHeaderMissingRequestCount,
  candidateNativeHeaderMissingRequestCount:
    candidateNativeAppCheckHeaderMissingRequestCount,
  candidateScreenCaptureProtectedRequestCount:
    candidateScreenCaptureProtectedDataRequests.length,
  candidateScreenCaptureNativeRequestCount,
  candidateBridgeInjectedRequestCount,
  protectedHeaderJwtShapeInvalidRequestCount,
  browserAppCheckExchangeRequestCount:
    networkSummary.appCheckExchangeRequestCount,
  browserAppCheckExchangeHttp200Count:
    networkSummary.successfulAppCheckExchangeResponseCount,
  appCheckCdpMonitorPausedRequestCount,
  debugTokenNetworkObservationCount,
  debugSentinelNetworkObservationCount,
  authorizedDebugExchangeBodyReplacementCount,
  unauthorizedDebugTokenEgressCount,
  unauthorizedDebugSentinelEgressCount,
  appCheckHeaderNetworkObservationCount,
  authorizedAppCheckHeaderRequestCount,
  unauthorizedAppCheckHeaderEgressCount,
  sensitiveAppCheckRedirectRequestCount,
  sensitiveAppCheckRedirectAbortRequestCount,
  sensitiveAppCheckCdpResponsePausedRequestCount,
  sensitiveAppCheckRedirectResponseAbortRequestCount,
  sensitiveAppCheckResponseErrorAbortRequestCount,
  sensitiveAppCheckRequestTrackingResidualCount,
  browserNetworkHeaderAttestationErrorCount,
  firebaseDataRedirectResponseCount,
  firebaseDataErrorResponseCount,
  successfulFirebaseDataResponseCount,
  serviceWorkerPolicy: "block",
  initScriptInjectionCount: appCheckInitScriptInjectionCount,
  contextCloseCount: browserContextCloseCount,
  unexpectedExtraPageCount,
  unexpectedDedicatedWorkerCount,
  unexpectedServiceWorkerCount,
  unexpectedCrossOriginFrameCount,
  unexpectedOopifTargetCount,
  unexpectedDedicatedWorkerTargetCount,
  unexpectedSharedWorkerTargetCount,
  unexpectedServiceWorkerTargetCount,
  retainedOopifTargetCount,
  retainedDedicatedWorkerTargetCount,
  retainedSharedWorkerTargetCount,
  retainedServiceWorkerTargetCount,
  targetDiscoveryActivationCount,
  targetSnapshotCount,
  consoleMessageCount: browserConsoleMessageCount,
  consoleSecretObservationCount: browserConsoleSecretObservationCount,
  corsConsoleErrorCount: browserCorsConsoleErrorCount,
  domSecretObservationCount: browserDomSecretObservationCount,
  requestFailureCount: browserRequestFailureCount,
  rawHeaderValueOutputCount,
  rawTokenOutputCount,
};
const appCheckBindingHash = sha256(Buffer.from(canonicalJson(appCheckBinding)));
assert.ok(
  preTransmissionBoundaryInspectionCount > 0,
  "The request-stage network boundary did not inspect any browser requests.",
);
assert.equal(
  preTransmissionBoundaryInspectionCount,
  appCheckCdpMonitorPausedRequestCount,
  "Every CDP request-stage pause must pass the pre-transmission boundary.",
);
assert.equal(
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount +
    preTransmissionBoundaryUnboundFirebaseBlockCount,
);
assert.equal(
  preTransmissionBoundaryFailRequestCount,
  preTransmissionBoundaryBlockAttemptCount,
);
for (const [label, count] of Object.entries({
  preTransmissionBoundaryBlockAttemptCount,
  preTransmissionBoundaryProductionBlockCount,
  preTransmissionBoundaryUnboundFirebaseBlockCount,
  preTransmissionBoundaryFailRequestCount,
})) {
  assert.equal(count, 0, `${label} must be zero in a passing visual capture.`);
}
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
  appCheckBinding,
  appCheckBindingHash,
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
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
assertNoAppCheckSecretMaterial(manifestText, {
  debugToken: appCheckDebugToken,
  debugSentinel: APP_CHECK_DEBUG_SENTINEL,
});
if (bypassSecret) {
  assert.equal(
    manifestText.includes(bypassSecret),
    false,
    "The Vercel bypass secret reached the visual manifest.",
  );
}
writeFileSync(manifestPath, manifestText, "utf8");
assert.equal(statSync(manifestPath).isFile(), true);
const expectedEvidenceFiles = [
  "visual-parity-manifest.json",
  fixtureAuditFileName,
  ...captures.map((capture) => capture.fileName),
  ...browserAudits.map((audit) => audit.fileName),
].sort();
assert.deepEqual(
  listEvidenceFiles(outputRoot).sort(),
  expectedEvidenceFiles,
  "The capture output contains an unrepresented artifact.",
);
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
