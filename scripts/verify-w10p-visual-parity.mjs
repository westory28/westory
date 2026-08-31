import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { inflateSync } from "node:zlib";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const contract = readJson("scripts/w10p-visual-parity-contract.json");
assert.equal(contract.schemaVersion, 15);
const resolveAuthenticationLandingGuard = ({
  guardContract,
  fixedTimeValue,
}) => {
  assert.deepEqual(Object.keys(guardContract || {}).sort(), [
    "id",
    "keyPrefix",
    "purpose",
    "roles",
    "scope",
    "semesters",
    "storage",
    "utcOffsetMinutes",
    "year",
  ]);
  assert.equal(guardContract.id, "korean-public-holiday-sync-v1");
  assert.equal(guardContract.storage, "localStorage");
  assert.equal(guardContract.keyPrefix, "westory:holiday-sync");
  assert.match(guardContract.year, /^\d{4}$/u);
  assert.deepEqual(guardContract.semesters, ["1", "2"]);
  assert.deepEqual(guardContract.roles, ["admin", "teacher"]);
  assert.equal(guardContract.utcOffsetMinutes, 9 * 60);
  assert.equal(guardContract.scope, "ephemeral-capture-browser-context");
  assert.equal(
    guardContract.purpose,
    "prevent-authentication-landing-staging-write",
  );
  assert.match(
    fixedTimeValue,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
  );
  const fixedTimestamp = Date.parse(fixedTimeValue);
  assert.equal(Number.isSafeInteger(fixedTimestamp), true);
  const markerValue = new Date(
    fixedTimestamp + guardContract.utcOffsetMinutes * 60_000,
  )
    .toISOString()
    .slice(0, 10);
  assert.equal(markerValue.slice(0, 4), guardContract.year);
  const markers = guardContract.semesters.map((semester) =>
    Object.freeze({
      key: `${guardContract.keyPrefix}:${guardContract.year}:${semester}`,
      value: markerValue,
    }),
  );
  return Object.freeze({
    id: guardContract.id,
    storage: guardContract.storage,
    markers: Object.freeze(markers),
    roles: Object.freeze([...guardContract.roles]),
    scope: guardContract.scope,
    purpose: guardContract.purpose,
  });
};
const authenticationLandingGuard = resolveAuthenticationLandingGuard({
  guardContract: contract.authenticationLandingGuard,
  fixedTimeValue: contract.fixedTime,
});
const verifyAuthenticationLandingGuardFixtures = () => {
  const validGuardContract = contract.authenticationLandingGuard;
  const invalidGuardContracts = [
    { ...validGuardContract, id: "wrong-guard" },
    { ...validGuardContract, storage: "sessionStorage" },
    { ...validGuardContract, keyPrefix: "westory:other-sync" },
    { ...validGuardContract, year: "2025" },
    { ...validGuardContract, semesters: ["1", "3"] },
    { ...validGuardContract, semesters: ["2", "1"] },
    { ...validGuardContract, roles: ["teacher", "admin"] },
    { ...validGuardContract, utcOffsetMinutes: 0 },
    { ...validGuardContract, scope: "persistent-browser-profile" },
    { ...validGuardContract, purpose: "allow-staging-write" },
    { ...validGuardContract, unexpectedField: true },
  ];
  for (const guardContract of invalidGuardContracts) {
    assert.throws(() =>
      resolveAuthenticationLandingGuard({
        guardContract,
        fixedTimeValue: contract.fixedTime,
      }),
    );
  }
  assert.throws(() =>
    resolveAuthenticationLandingGuard({
      guardContract: validGuardContract,
      fixedTimeValue: "not-a-fixed-time",
    }),
  );
  assert.deepEqual(authenticationLandingGuard.markers, [
    { key: "westory:holiday-sync:2026:1", value: "2026-08-17" },
    { key: "westory:holiday-sync:2026:2", value: "2026-08-17" },
  ]);
  return {
    authenticationLandingGuardAcceptedFixtureCount: 1,
    authenticationLandingGuardRejectedFixtureCount:
      invalidGuardContracts.length + 1,
    authenticationLandingGuardNetworkAccess: 0,
  };
};
const authenticationLandingGuardSelfTest =
  verifyAuthenticationLandingGuardFixtures();
const FROZEN_BASELINE_AUTHENTICATION_TARGET_CLASSES = Object.freeze([
  "attendance-default-scope",
  "attendance-active-scope",
  "history-dictionary",
  "notification-inbox",
  "broadcast",
  "unknown",
]);
const resolveFrozenBaselineAuthenticationAnomalyPolicy = (policy) => {
  assert.deepEqual(Object.keys(policy || {}).sort(), [
    "authenticationRole",
    "captureRole",
    "consoleError",
    "id",
    "phase",
    "presentationSourceCommit",
    "removedCauseCode",
    "removedTargetClass",
    "stage",
    "successorTargetClass",
    "viewport",
  ]);
  assert.deepEqual(Object.keys(policy.consoleError || {}).sort(), [
    "errorNameClass",
    "expectedCount",
    "messageClass",
    "operationClass",
    "sha256",
    "sourceClass",
  ]);
  assert.equal(policy.id, "w10p-frozen-dashboard-attendance-default-scope-v1");
  assert.equal(
    policy.presentationSourceCommit,
    "676869fa289d3e7ecef234cbb5cca65c60ec4597",
  );
  assert.equal(
    policy.presentationSourceCommit,
    contract.productionPresentationSha,
  );
  assert.equal(policy.stage, "baseline");
  assert.equal(policy.captureRole, "student");
  assert.equal(policy.authenticationRole, "student");
  assert.equal(policy.viewport, "1024x768");
  assert.equal(policy.phase, "authentication");
  assert.equal(policy.consoleError.sourceClass, "console-error");
  assert.equal(policy.consoleError.errorNameClass, "console-error");
  assert.equal(policy.consoleError.messageClass, "firebase-permission-denied");
  assert.equal(
    policy.consoleError.operationClass,
    "firestore-unhandled-snapshot-listener",
  );
  assert.equal(
    policy.consoleError.sha256,
    "22a802d5f907a1f881328ae78eab9ea0711a8e266a7bcf540c0066906e56e6d6",
  );
  assert.equal(policy.consoleError.expectedCount, 1);
  assert.equal(policy.removedTargetClass, "attendance-default-scope");
  assert.equal(policy.successorTargetClass, "attendance-active-scope");
  assert.equal(policy.removedCauseCode, 7);
  return Object.freeze({
    ...policy,
    consoleError: Object.freeze({ ...policy.consoleError }),
  });
};
const frozenBaselineAuthenticationAnomalyPolicy =
  resolveFrozenBaselineAuthenticationAnomalyPolicy(
    contract.frozenBaselineAuthenticationAnomalyPolicy,
  );
const MAX_RESOLVED_REQUEST_POST_DATA_BYTES = 8 * 1024 * 1024;
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES = 64 * 1024;
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES = 16 * 1024 * 1024;
const NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS = 30_000;
const NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS = {
  accept: "*/*",
  "accept-encoding": "identity",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache",
};
const NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST = [
  "access-control-allow-origin",
  "cache-control",
  "content-language",
  "content-type",
  "cross-origin-resource-policy",
  "etag",
  "last-modified",
  "timing-allow-origin",
];
const NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT = {
  schemaVersion: 1,
  method: "GET",
  headers: NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS,
  redirectPolicy: "manual-no-follow-exact-200",
  contentEncodingPolicy: "absent-or-identity",
  timeoutMilliseconds: NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS,
  responseHeaderMaximumBytes:
    NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES,
  responseBodyMaximumBytes:
    NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES,
};
const BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES = [
  "content-firebaseappcheck.googleapis.com",
  "firebaseappcheck.googleapis.com",
  "firebasestorage.googleapis.com",
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net`,
  `${contract.firebaseProjectId}.firebaseapp.com`,
  `${contract.firebaseProjectId}.firebaseio.com`,
  `${contract.firebaseProjectId}.web.app`,
].sort();
const BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES = [
  "edge.microsoft.com",
  "www.bing.com",
].sort();
const BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
];
const BROWSER_RESPONSE_HEADER_ALLOWLIST = [
  "accept-ranges",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "access-control-allow-methods",
  "access-control-allow-origin",
  "access-control-expose-headers",
  "access-control-max-age",
  "cache-control",
  "content-disposition",
  "content-encoding",
  "content-language",
  "content-length",
  "content-range",
  "content-type",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "date",
  "etag",
  "expires",
  "grpc-message",
  "grpc-status",
  "last-modified",
  "server-timing",
  "timing-allow-origin",
  "vary",
  "x-firebase-locale",
  "x-goog-generation",
  "x-goog-hash",
  "x-goog-metageneration",
  "x-goog-storage-class",
  "x-goog-stored-content-encoding",
  "x-goog-stored-content-length",
  "x-guploader-uploadid",
];
const FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID =
  "staging-firestore-webchannel-session";
const FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME = "x-http-session-id";
const FIRESTORE_WEBCHANNEL_PATHNAMES = new Set([
  "/google.firestore.v1.Firestore/Listen/channel",
  "/google.firestore.v1.Firestore/Write/channel",
]);
const FIRESTORE_WEBCHANNEL_INITIAL_QUERY_NAMES = [
  "CVER",
  "RID",
  "VER",
  "X-HTTP-Session-Id",
  "database",
  "t",
  "zx",
].sort();
const BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES = [
  "alt-svc",
  "clear-site-data",
  "content-security-policy",
  "content-security-policy-report-only",
  "link",
  "location",
  "nel",
  "refresh",
  "report-to",
  "reporting-endpoints",
  "set-cookie",
  "speculation-rules",
  "x-dns-prefetch-control",
];
assert.equal(
  BROWSER_RESPONSE_HEADER_ALLOWLIST.includes(
    FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
  ),
  false,
);
assert.equal(
  BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES.includes(
    FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
  ),
  false,
);
assert.equal(contract.fixtureRevision, 1);
assert.match(contract.fixturePlanHash, /^[a-f0-9]{64}$/u);
const inventory = readJson("scripts/w10p-route-menu-inventory.json");
const packageJson = readJson("package.json");
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const args = process.argv.slice(2);
const VERIFIER_CHILD_SECRET_ENVIRONMENT_VARIABLE_NAMES = [
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
const verifierVercelBypassSecret = String(
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "",
).trim();
const verifierChildSecretValues =
  VERIFIER_CHILD_SECRET_ENVIRONMENT_VARIABLE_NAMES.map((name) =>
    String(process.env[name] || ""),
  ).filter(Boolean);
for (const name of VERIFIER_CHILD_SECRET_ENVIRONMENT_VARIABLE_NAMES) {
  delete process.env[name];
}
const verifierChildEnvironment = { ...process.env };
const verifierChildSecretEnvironmentVariableCount =
  VERIFIER_CHILD_SECRET_ENVIRONMENT_VARIABLE_NAMES.filter((name) =>
    Object.hasOwn(verifierChildEnvironment, name),
  ).length;
const verifierChildSecretValueObservationCount = Object.values(
  verifierChildEnvironment,
).filter((environmentValue) =>
  verifierChildSecretValues.some((secretValue) =>
    String(environmentValue).includes(secretValue),
  ),
).length;
assert.equal(verifierChildSecretEnvironmentVariableCount, 0);
assert.equal(verifierChildSecretValueObservationCount, 0);
verifierChildSecretValues.fill("");
const STAGING_PROJECT_NUMBER = "894916304910";
const STAGING_APP_ID = "1:894916304910:web:bd8c8a9e3ed8bd1620dc5f";
const APP_CHECK_DEBUG_SENTINEL = "w10p-visual-app-check-debug-sentinel-v1";
const PLAYWRIGHT_DEFAULT_DISABLED_FEATURES = [
  "AvoidUnnecessaryBeforeUnloadCheckSync",
  "BoundaryEventDispatchTracksNodeRemoval",
  "DestroyProfileOnBrowserClose",
  "DialMediaRouteProvider",
  "GlobalMediaControls",
  "HttpsUpgrades",
  "LensOverlay",
  "MediaRouter",
  "PaintHolding",
  "ThirdPartyStoragePartitioning",
  "BlockOriginHeaderModificationOnRedirect",
  "Translate",
  "AutoDeElevate",
  "OptimizationHints",
  "msForceBrowserSignIn",
  "msEdgeUpdateLaunchServicesPreferredVersion",
];
const CAPTURE_ADDITIONAL_DISABLED_FEATURES = [
  "EarlyHintsPreloadForNavigation",
  "PreconnectOnRedirect",
  "PreconnectToSearch",
  "Prerender2",
  "SpeculationRulesPrefetchFuture",
  "msSmartScreenBrowserDnsLookups",
  "msSmartScreenCertCollection",
  "msSmartScreenCollectFaviconUrls",
  "msSmartScreenEnableTelemetry",
  "msSmartScreenMultipleRedirectBlockPages",
  "msSmartScreenProtection",
  "msSmartScreenSendReferrerChain",
  "msSmartScreenSubResourceThrottle",
  "msSmartScreenSyncWcfCalls",
  "msSmartScreenUseEdgeNetworking",
  "msSmartScreenWebSocketThrottle",
  "msSmartScreenWebSocketThrottleBlock",
];
const BROWSER_EFFECTIVE_DISABLED_FEATURES = [
  ...new Set([
    ...PLAYWRIGHT_DEFAULT_DISABLED_FEATURES,
    ...CAPTURE_ADDITIONAL_DISABLED_FEATURES,
  ]),
].sort();
const PLAYWRIGHT_DEFAULT_DISABLE_FEATURES_ARGUMENT = `--disable-features=${PLAYWRIGHT_DEFAULT_DISABLED_FEATURES.join(",")}`;
const BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT = `--disable-features=${BROWSER_EFFECTIVE_DISABLED_FEATURES.join(",")}`;
const BROWSER_PRETRANSMISSION_LAUNCH_ARGS = [
  "--disable-quic",
  "--disable-preconnect",
  "--dns-prefetch-disable",
  "--enable-automation",
  "--no-pings",
  BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT,
];
const BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS = [
  PLAYWRIGHT_DEFAULT_DISABLE_FEATURES_ARGUMENT,
];
const BROWSER_PRETRANSMISSION_REQUIRED_EFFECTIVE_ARGUMENTS = [
  "--disable-background-networking",
  "--disable-quic",
  "--disable-preconnect",
  "--dns-prefetch-disable",
  "--enable-automation",
  "--no-pings",
  BROWSER_EFFECTIVE_DISABLE_FEATURES_ARGUMENT,
].sort();
const BROWSER_PROXY_BYPASS_LIST_ARGUMENT = "--proxy-bypass-list=<-loopback>";
const JWT_PATTERN =
  /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/u;
const APP_CHECK_DEBUG_TOKEN_CANDIDATE_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const secretSha256 = (value) =>
  createHash("sha256").update(String(value), "utf8").digest("hex");
const canonicalNetworkHostname = (hostname) => {
  assert.equal(typeof hostname, "string");
  const lowercaseHostname = hostname.toLowerCase();
  if (lowercaseHostname.startsWith("[") && lowercaseHostname.endsWith("]")) {
    return lowercaseHostname;
  }
  return lowercaseHostname.replace(/\.+$/u, "");
};
const safelyDecodeUrl = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};
const firebaseServiceForHostname = (hostname) => {
  const canonicalHostname = canonicalNetworkHostname(hostname);
  if (
    canonicalHostname === "identitytoolkit.googleapis.com" ||
    canonicalHostname === "securetoken.googleapis.com"
  ) {
    return "auth";
  }
  if (
    canonicalHostname === "firebaseappcheck.googleapis.com" ||
    canonicalHostname === "content-firebaseappcheck.googleapis.com"
  ) {
    return "app-check";
  }
  if (canonicalHostname === "firestore.googleapis.com") return "firestore";
  if (canonicalHostname === "firebasestorage.googleapis.com") return "storage";
  if (canonicalHostname.endsWith(".cloudfunctions.net")) return "functions";
  if (
    canonicalHostname.endsWith(".firebaseio.com") ||
    canonicalHostname.endsWith(".firebasedatabase.app")
  ) {
    return "realtime-database";
  }
  if (
    canonicalHostname.endsWith(".firebaseapp.com") ||
    canonicalHostname.endsWith(".web.app")
  ) {
    return "hosting";
  }
  return null;
};
const FIXTURE_AUDIT_FRESHNESS_KEYS = [
  "issuedAt",
  "expiresAt",
  "maxAgeSeconds",
  "fixedFixtureTime",
].sort();
const FIXTURE_AUDIT_MAX_AGE_SECONDS = 2 * 60 * 60;
const FIXTURE_AUDIT_CAPTURE_START_MAX_DELAY_SECONDS = 5 * 60;
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
  assert.equal(freshness.maxAgeSeconds, FIXTURE_AUDIT_MAX_AGE_SECONDS);
  assert.equal(freshness.fixedFixtureTime, expectedFixedTime);
  assert.equal(
    expiresAt - issuedAt,
    FIXTURE_AUDIT_MAX_AGE_SECONDS * 1000,
    "The fixture audit freshness window must be exactly two hours.",
  );
  return { issuedAt, expiresAt };
};
const assertFixtureAuditCaptureWindow = ({
  issuedAt,
  expiresAt,
  startedAt,
  completedAt = null,
}) => {
  for (const [label, value] of [
    ["issuedAt", issuedAt],
    ["expiresAt", expiresAt],
    ["startedAt", startedAt],
  ]) {
    assert.equal(Number.isFinite(value), true, `${label} must be finite.`);
  }
  const startDelayMilliseconds = startedAt - issuedAt;
  assert.ok(
    startDelayMilliseconds >= 0,
    "The browser capture started before the fixture audit was issued.",
  );
  assert.ok(
    startDelayMilliseconds <=
      FIXTURE_AUDIT_CAPTURE_START_MAX_DELAY_SECONDS * 1000,
    "The browser capture did not start within five minutes of the fixture audit.",
  );
  assert.ok(
    startedAt < expiresAt,
    "The fixture audit expired before browser capture began.",
  );
  if (completedAt !== null) {
    assert.equal(
      Number.isFinite(completedAt),
      true,
      "completedAt must be finite.",
    );
    assert.ok(
      completedAt >= startedAt,
      "The browser capture completed before it started.",
    );
    assert.ok(
      completedAt <= expiresAt,
      "The fixture audit expired before browser capture completed.",
    );
  }
};
const PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION = {
  schemaVersion: 8,
  interceptionStage: "cdp-fetch-request-stage",
  inspectionFunction: "inspectNetworkRequest",
  blockedMarkers: [
    "production",
    "cross-origin-document",
    "unbound-firebase",
    "non-firebase-hostname-not-allowlisted",
    "malformed-url-encoding",
  ],
  nonFirebaseHostnameAllowlist:
    contract.networkBoundary.nonFirebaseHostnameAllowlist,
  hostnameCanonicalization: contract.networkBoundary.hostnameCanonicalization,
  firebaseRequestBinding: contract.networkBoundary.firebaseRequestBinding,
  executionTargetBoundary: contract.networkBoundary.executionTargetBoundary,
  networkResponseBoundary: contract.networkBoundary.networkResponseBoundary,
  browserConnectProxy: contract.networkBoundary.browserConnectProxy,
  requestBodyResolver: "resolvePausedRequestPostData",
  requestBodyMaximumBytes:
    contract.networkBoundary.executionTargetBoundary.requestBodyMaximumBytes,
  blockMechanism: "Fetch.failRequest",
  blockErrorReason: "BlockedByClient",
  ordering:
    "after-single-full-request-body-resolution-before-sensitive-scan-telemetry-deterministic-external-or-secret-mutation",
};
const preTransmissionBoundaryDecision = ({
  productionMarker,
  unboundFirebaseRequest,
  isFirebaseRequest,
  nonFirebaseHostnameAllowed,
  malformedUrlEncoding = false,
  crossOriginDocument = false,
}) => {
  assert.equal(typeof productionMarker, "boolean");
  assert.equal(typeof unboundFirebaseRequest, "boolean");
  assert.equal(typeof isFirebaseRequest, "boolean");
  assert.equal(typeof nonFirebaseHostnameAllowed, "boolean");
  assert.equal(typeof malformedUrlEncoding, "boolean");
  assert.equal(typeof crossOriginDocument, "boolean");
  if (malformedUrlEncoding) {
    return { block: true, marker: "malformed-url-encoding" };
  }
  if (productionMarker) return { block: true, marker: "production" };
  if (crossOriginDocument) {
    return { block: true, marker: "cross-origin-document" };
  }
  if (unboundFirebaseRequest) {
    return { block: true, marker: "unbound-firebase" };
  }
  if (!isFirebaseRequest && !nonFirebaseHostnameAllowed) {
    return {
      block: true,
      marker: "non-firebase-hostname-not-allowlisted",
    };
  }
  return { block: false, marker: null };
};
const isCrossOriginDocumentRequest = ({
  requestUrl,
  resourceType,
  stableBrowserOrigin,
}) =>
  resourceType === "Document" &&
  new URL(requestUrl).origin !== stableBrowserOrigin;
const isVercelNetworkHostname = (hostname) =>
  canonicalNetworkHostname(hostname) === "vercel.app" ||
  canonicalNetworkHostname(hostname).endsWith(".vercel.app");
const normalizedNetworkResourceType = (resourceType) =>
  String(resourceType || "").toLowerCase();
const exactStaticExternalRuleId = ({
  requestUrl,
  method,
  resourceType,
  allowlist = contract.networkBoundary.externalStaticRequestAllowlist,
}) => {
  const parsed = new URL(requestUrl);
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = normalizedNetworkResourceType(resourceType);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    !allowlist.methods.includes(normalizedMethod)
  ) {
    return null;
  }
  const rule = allowlist.rules.find((candidate) => {
    if (
      parsed.hostname.toLowerCase() !== candidate.hostname ||
      !candidate.resourceTypes.some(
        (value) => value.toLowerCase() === normalizedResourceType,
      )
    ) {
      return false;
    }
    if (candidate.exactPathAndSearch !== undefined) {
      return (
        `${parsed.pathname}${parsed.search}` === candidate.exactPathAndSearch
      );
    }
    if (candidate.queryPolicy === "none" && parsed.search) return false;
    if (candidate.exactPathnames?.includes(parsed.pathname)) return true;
    if (
      candidate.pathnamePrefix &&
      parsed.pathname.startsWith(candidate.pathnamePrefix) &&
      candidate.allowedExtensions?.some((extension) =>
        parsed.pathname.toLowerCase().endsWith(extension),
      )
    ) {
      return true;
    }
    return false;
  });
  return rule?.id || null;
};
const deterministicRecaptchaRequestInScope = ({
  requestUrl,
  method,
  resourceType,
}) => {
  const parsed = new URL(requestUrl);
  const responseContract =
    contract.browserTransport.deterministicRecaptchaResponse;
  return (
    parsed.protocol === responseContract.protocol &&
    parsed.hostname.toLowerCase() === responseContract.hostname &&
    responseContract.allowedPorts.includes(parsed.port) &&
    (responseContract.userinfoAllowed ||
      (!parsed.username && !parsed.password)) &&
    String(method).toUpperCase() === responseContract.method &&
    parsed.pathname === responseContract.pathname &&
    parsed.search === "" &&
    parsed.hash === "" &&
    normalizedNetworkResourceType(resourceType) ===
      responseContract.resourceType.toLowerCase()
  );
};
const optionalTelemetrySuppressionDecision = ({ requestUrl, method }) => {
  const parsed = new URL(requestUrl);
  const suppression = contract.networkBoundary.optionalTelemetrySuppression;
  const eligible =
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    suppression.methods.includes(String(method).toUpperCase()) &&
    suppression.hostnames.includes(parsed.hostname.toLowerCase());
  return {
    eligible,
    hostname: parsed.hostname.toLowerCase(),
    ruleId: eligible ? "optional-telemetry-host" : null,
  };
};
const exactAuthCredentialBodyRequestScope = ({
  requestUrl,
  method,
  stagingApiKey,
}) => {
  const parsed = new URL(requestUrl);
  const queryKeys = [...parsed.searchParams.keys()];
  return (
    String(method).toUpperCase() === "POST" &&
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    parsed.hostname === "identitytoolkit.googleapis.com" &&
    parsed.pathname === "/v1/accounts:signInWithPassword" &&
    parsed.hash === "" &&
    queryKeys.length === 1 &&
    queryKeys[0] === "key" &&
    parsed.searchParams.getAll("key").length === 1 &&
    parsed.searchParams.get("key") === stagingApiKey
  );
};
const exactRefreshTokenBodyRequestScope = ({
  requestUrl,
  method,
  stagingApiKey,
}) => {
  const parsed = new URL(requestUrl);
  const queryKeys = [...parsed.searchParams.keys()];
  return (
    String(method).toUpperCase() === "POST" &&
    parsed.protocol === "https:" &&
    !parsed.username &&
    !parsed.password &&
    (!parsed.port || parsed.port === "443") &&
    parsed.hostname === "securetoken.googleapis.com" &&
    parsed.pathname === "/v1/token" &&
    parsed.hash === "" &&
    queryKeys.length === 1 &&
    queryKeys[0] === "key" &&
    parsed.searchParams.getAll("key").length === 1 &&
    parsed.searchParams.get("key") === stagingApiKey
  );
};
const deterministicResponseDecision = ({
  requestUrl,
  method,
  resourceType,
  headers = {},
  postData = "",
  stableBrowserOrigin,
}) => {
  const parsed = new URL(requestUrl);
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = normalizedNetworkResourceType(resourceType);
  const headerNames = Object.keys(headers).map((name) => name.toLowerCase());
  const bodyAbsent = String(postData || "") === "";
  const holidayContract = contract.browserTransport.deterministicLocalResponse;
  const holidayNamespace =
    parsed.origin === stableBrowserOrigin &&
    (parsed.pathname === "/api" || parsed.pathname.startsWith("/api/"));
  if (holidayNamespace) {
    const yearValues = parsed.searchParams.getAll("year");
    const yearValue = yearValues.length === 1 ? yearValues[0] : "";
    const canonicalYear =
      /^(?:19[0-9]{2}|20[0-9]{2}|2100)$/u.test(yearValue) &&
      Number(yearValue) >= holidayContract.yearCanonicalDecimalMinimum &&
      Number(yearValue) <= holidayContract.yearCanonicalDecimalMaximum &&
      parsed.search === `?year=${yearValue}`;
    const forbiddenHeaderPresent =
      holidayContract.forbiddenRequestHeaderNames.some((name) =>
        headerNames.includes(name),
      );
    const eligible =
      parsed.pathname === holidayContract.pathname &&
      parsed.hash === "" &&
      normalizedMethod === holidayContract.method &&
      holidayContract.resourceTypes.some(
        (value) => value.toLowerCase() === normalizedResourceType,
      ) &&
      [...parsed.searchParams.keys()].length ===
        holidayContract.queryOccurrenceCount &&
      canonicalYear &&
      bodyAbsent &&
      !forbiddenHeaderPresent;
    return {
      scoped: true,
      eligible,
      id: holidayContract.id,
      year: canonicalYear ? Number(yearValue) : null,
      responseContract: holidayContract,
    };
  }
  if (
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  ) {
    const responseContract =
      contract.browserTransport.deterministicRecaptchaResponse;
    const forbiddenHeaderPresent =
      responseContract.forbiddenRequestHeaderNames.some((name) =>
        headerNames.includes(name),
      );
    return {
      scoped: true,
      eligible: bodyAbsent && !forbiddenHeaderPresent,
      id: responseContract.id,
      year: null,
      responseContract,
    };
  }
  return {
    scoped: false,
    eligible: false,
    id: null,
    year: null,
    responseContract: null,
  };
};
const isNonFirebaseHostnameAllowed = ({
  requestUrl,
  method,
  resourceType,
  isFirebaseRequest,
  allowedOrigins,
}) => {
  assert.equal(typeof isFirebaseRequest, "boolean");
  assert.equal(Array.isArray(allowedOrigins), true);
  if (isFirebaseRequest) return false;
  const parsed = new URL(requestUrl);
  return (
    allowedOrigins.includes(parsed.origin) ||
    exactStaticExternalRuleId({ requestUrl, method, resourceType }) !== null ||
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  );
};
const nonFirebasePolicyRuleId = ({
  requestUrl,
  method,
  resourceType,
  isFirebaseRequest,
  allowedOrigins,
}) => {
  if (isFirebaseRequest) return null;
  const parsed = new URL(requestUrl);
  if (allowedOrigins.includes(parsed.origin)) {
    return "exact-browser-or-immutable-origin";
  }
  const externalRuleId = exactStaticExternalRuleId({
    requestUrl,
    method,
    resourceType,
  });
  if (externalRuleId) return `external-static:${externalRuleId}`;
  if (
    deterministicRecaptchaRequestInScope({
      requestUrl,
      method,
      resourceType,
    })
  ) {
    return `deterministic:${contract.browserTransport.deterministicRecaptchaResponse.id}`;
  }
  return null;
};
const expectedPinnedStartupSourceBindingsForContract = () =>
  contract.networkBoundary.externalStaticRequestAllowlist.rules.flatMap(
    (rule) =>
      Object.entries(rule.pinnedSources || {}).map(
        ([browserPathname, source]) => ({ rule, browserPathname, source }),
      ),
  );
const assertPinnedStartupSourceAttestationsForContract = (attestations) => {
  const expectedBindings = expectedPinnedStartupSourceBindingsForContract();
  assert.equal(attestations.length, expectedBindings.length);
  const remainingBindings = [...expectedBindings];
  for (const attestation of attestations) {
    assertExactObjectKeys(attestation, [
      "schemaVersion",
      "ruleId",
      "browserUrlSha256",
      "sourceUrl",
      "sourceUrlSha256",
      "responseStatus",
      "responseBodySha256",
      "responseBodyBytes",
      "informationalResponseCount",
      "informationalEgressHeaderObservationCount",
      "informationalBrowserExposureCount",
      "finalHeaderSuppressionCount",
      "requestContractHash",
    ]);
    const bindingIndex = remainingBindings.findIndex(
      ({ rule, browserPathname, source }) =>
        attestation.ruleId === rule.id &&
        attestation.browserUrlSha256 ===
          secretSha256(`https://${rule.hostname}${browserPathname}`) &&
        attestation.sourceUrl === source.url,
    );
    assert.ok(bindingIndex >= 0);
    const [{ source }] = remainingBindings.splice(bindingIndex, 1);
    assert.equal(attestation.schemaVersion, 1);
    assert.equal(attestation.sourceUrlSha256, secretSha256(source.url));
    assert.equal(attestation.responseStatus, 200);
    assert.equal(attestation.responseBodySha256, source.sha256);
    assert.equal(attestation.responseBodyBytes, source.bytes);
    assert.ok(Number.isInteger(attestation.informationalResponseCount));
    assert.ok(attestation.informationalResponseCount >= 0);
    assert.ok(
      Number.isInteger(attestation.informationalEgressHeaderObservationCount),
    );
    assert.ok(attestation.informationalEgressHeaderObservationCount >= 0);
    assert.equal(attestation.informationalBrowserExposureCount, 0);
    assert.ok(Number.isInteger(attestation.finalHeaderSuppressionCount));
    assert.ok(attestation.finalHeaderSuppressionCount >= 0);
    assert.equal(
      attestation.requestContractHash,
      secretSha256(JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT)),
    );
  }
  assert.equal(remainingBindings.length, 0);
  return true;
};
const externalStaticRequestDecision = ({
  requestUrl,
  method,
  resourceType,
  headers = {},
  postData = "",
}) => {
  const ruleId = exactStaticExternalRuleId({
    requestUrl,
    method,
    resourceType,
  });
  if (!ruleId) {
    return { scoped: false, eligible: false, rule: null, action: null };
  }
  const allowlist = contract.networkBoundary.externalStaticRequestAllowlist;
  const rule = allowlist.rules.find((candidate) => candidate.id === ruleId);
  assert.ok(rule);
  const headerNames = Object.keys(headers).map((name) => name.toLowerCase());
  const forbiddenHeaderPresent = allowlist.forbiddenRequestHeaderNames.some(
    (name) => headerNames.includes(name),
  );
  const bodyAbsent = String(postData || "") === "";
  const action = rule.action;
  return {
    scoped: true,
    eligible:
      bodyAbsent &&
      !forbiddenHeaderPresent &&
      action !== "block-before-transmission-until-trusted-pin",
    rule,
    action,
  };
};
const literalOccurrenceCount = (textValue, needle) =>
  needle ? String(textValue).split(String(needle)).length - 1 : 0;
const exactStagingFirestoreWebChannelInitialRequestScope = ({
  requestUrl,
  method,
  inspection,
}) => {
  if (
    !inspection ||
    inspection.firebaseService !== "firestore" ||
    inspection.isFirebaseRequest !== true ||
    inspection.stagingMarker !== true ||
    inspection.productionMarker !== false ||
    inspection.unboundFirebaseRequest !== false ||
    inspection.malformedUrlEncoding !== false ||
    inspection.firebaseTransportValid !== true ||
    inspection.serviceResourceBound !== true ||
    String(method).toUpperCase() !== "POST"
  ) {
    return false;
  }
  try {
    const parsed = new URL(requestUrl);
    const queryNames = [...parsed.searchParams.keys()].sort();
    const databaseValues = parsed.searchParams.getAll("database");
    const ridValues = parsed.searchParams.getAll("RID");
    const attemptValues = parsed.searchParams.getAll("t");
    const cacheBusterValues = parsed.searchParams.getAll("zx");
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLowerCase() === "firestore.googleapis.com" &&
      parsed.username === "" &&
      parsed.password === "" &&
      (parsed.port === "" || parsed.port === "443") &&
      parsed.hash === "" &&
      FIRESTORE_WEBCHANNEL_PATHNAMES.has(parsed.pathname) &&
      JSON.stringify(queryNames) ===
        JSON.stringify(FIRESTORE_WEBCHANNEL_INITIAL_QUERY_NAMES) &&
      databaseValues.length === 1 &&
      databaseValues[0] ===
        `projects/${contract.firebaseProjectId}/databases/(default)` &&
      parsed.searchParams.getAll("VER").length === 1 &&
      parsed.searchParams.get("VER") === "8" &&
      parsed.searchParams.getAll("CVER").length === 1 &&
      parsed.searchParams.get("CVER") === "22" &&
      parsed.searchParams.getAll("X-HTTP-Session-Id").length === 1 &&
      parsed.searchParams.get("X-HTTP-Session-Id") === "gsessionid" &&
      ridValues.length === 1 &&
      /^(?:0|[1-9][0-9]{0,4})$/u.test(ridValues[0]) &&
      Number(ridValues[0]) <= 99_999 &&
      attemptValues.length === 1 &&
      /^[1-9][0-9]*$/u.test(attemptValues[0]) &&
      cacheBusterValues.length === 1 &&
      /^[0-9a-z]+$/u.test(cacheBusterValues[0])
    );
  } catch {
    return false;
  }
};
const exactStagingFirestoreWebChannelEncodedApiKeyBodyScope = ({
  requestUrl,
  method,
  headers = {},
  postData = "",
  stagingApiKey,
  inspection,
}) => {
  const rawPostData = String(postData);
  const decodedPostData = safelyDecodeUrl(rawPostData.replace(/\+/gu, "%20"));
  if (
    !exactStagingFirestoreWebChannelInitialRequestScope({
      requestUrl,
      method,
      inspection,
    }) ||
    inspection.apiKeyValueCount !== 0 ||
    inspection.apiKeyBindingValid !== false ||
    decodedPostData === null ||
    literalOccurrenceCount(rawPostData, stagingApiKey) !== 1 ||
    literalOccurrenceCount(decodedPostData, stagingApiKey) !== 1
  ) {
    return false;
  }
  const contentTypeValues = Object.entries(headers)
    .filter(([name]) => String(name).toLowerCase() === "content-type")
    .map(([, value]) => String(value));
  if (
    contentTypeValues.length !== 1 ||
    !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/iu.test(
      contentTypeValues[0],
    )
  ) {
    return false;
  }
  const rawHeaderFieldCount = rawPostData
    .split("&")
    .filter((segment) => segment.split("=", 1)[0] === "headers").length;
  const bodyParams = new URLSearchParams(rawPostData);
  const encodedHeaderFields = [...bodyParams.entries()].filter(
    ([name]) => String(name).toLowerCase() === "headers",
  );
  if (
    rawHeaderFieldCount !== 1 ||
    encodedHeaderFields.length !== 1 ||
    encodedHeaderFields[0][0] !== "headers"
  ) {
    return false;
  }
  const encodedHeaderBlock = encodedHeaderFields[0][1];
  if (
    !encodedHeaderBlock.endsWith("\r\n") ||
    encodedHeaderBlock.includes("\0")
  ) {
    return false;
  }
  const headerLines = encodedHeaderBlock.split("\r\n");
  if (headerLines.pop() !== "" || headerLines.some((line) => line === "")) {
    return false;
  }
  const parsedHeaderLines = [];
  for (const line of headerLines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) return false;
    const name = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name)) return false;
    parsedHeaderLines.push({ name: name.toLowerCase(), value });
  }
  const apiKeyHeaderLines = parsedHeaderLines.filter(
    ({ name }) => name === "x-goog-api-key",
  );
  return (
    apiKeyHeaderLines.length === 1 &&
    apiKeyHeaderLines[0].value === stagingApiKey
  );
};
const stagingApiKeyScopeDecision = ({
  requestUrl,
  method = "GET",
  headers = {},
  postData = "",
  stagingApiKey,
  inspection,
}) => {
  assert.ok(stagingApiKey);
  assert.ok(inspection && typeof inspection === "object");
  const decodedRequestUrl = safelyDecodeUrl(requestUrl);
  const headerOccurrenceCount = Object.values(headers).reduce(
    (count, value) => {
      const rawValue = String(value);
      const decodedValue = safelyDecodeUrl(rawValue) || rawValue;
      return count + literalOccurrenceCount(decodedValue, stagingApiKey);
    },
    0,
  );
  const rawPostData = String(postData);
  const decodedPostData =
    safelyDecodeUrl(rawPostData.replace(/\+/gu, "%20")) || rawPostData;
  const observedOccurrenceCount =
    literalOccurrenceCount(decodedRequestUrl || "", stagingApiKey) +
    headerOccurrenceCount +
    literalOccurrenceCount(decodedPostData, stagingApiKey);
  const approvedRequestOccurrenceCount =
    inspection.isFirebaseRequest && inspection.apiKeyBindingValid
      ? inspection.apiKeyValueCount
      : 0;
  const approvedEncodedBodyOccurrenceCount = Number(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl,
      method,
      headers,
      postData,
      stagingApiKey,
      inspection,
    }),
  );
  const approvedOccurrenceCount =
    approvedRequestOccurrenceCount + approvedEncodedBodyOccurrenceCount;
  return {
    observedOccurrenceCount,
    approvedOccurrenceCount,
    approvedEncodedBodyOccurrenceCount,
    valid: observedOccurrenceCount === approvedOccurrenceCount,
  };
};
const sensitiveMaterialScopeDecision = ({
  requestUrl,
  headers = {},
  postData = "",
  credentialValues = [],
  refreshTokenValues = [],
  debugToken = "",
  debugSentinel = "",
  authCredentialBodyScope = false,
  refreshTokenBodyScope = false,
  debugSentinelBodyScope = false,
}) => {
  const decodedRequestUrl = safelyDecodeUrl(requestUrl) || "";
  const headerValues = Object.values(headers).map(String);
  const valueInUrlOrHeaders = (value) =>
    Boolean(value) &&
    (decodedRequestUrl.includes(value) ||
      headerValues.some((headerValue) => headerValue.includes(value)));
  const valueInBody = (value) =>
    Boolean(value) && String(postData).includes(value);
  const credentialInUrlOrHeaders = credentialValues.some(valueInUrlOrHeaders);
  const credentialInBody = credentialValues.some(valueInBody);
  const refreshTokenFieldPresent =
    /(?:^|[&{,])\s*"?(?:refresh_token|refreshToken)"?\s*(?:=|:)/u.test(
      String(postData),
    );
  const refreshTokenInUrlOrHeaders =
    refreshTokenValues.some(valueInUrlOrHeaders);
  const refreshTokenInBody = refreshTokenValues.some(valueInBody);
  const debugTokenObserved =
    valueInUrlOrHeaders(debugToken) || valueInBody(debugToken);
  const debugSentinelInUrlOrHeaders = valueInUrlOrHeaders(debugSentinel);
  const debugSentinelInBody = valueInBody(debugSentinel);
  if (
    credentialInUrlOrHeaders ||
    (credentialInBody && !authCredentialBodyScope)
  ) {
    return { valid: false, marker: "test-credential-scope" };
  }
  if (
    refreshTokenInUrlOrHeaders ||
    ((refreshTokenFieldPresent || refreshTokenInBody) && !refreshTokenBodyScope)
  ) {
    return { valid: false, marker: "refresh-token-scope" };
  }
  if (debugTokenObserved) {
    return { valid: false, marker: "debug-token-scope" };
  }
  if (
    debugSentinelInUrlOrHeaders ||
    (debugSentinelInBody && !debugSentinelBodyScope)
  ) {
    return { valid: false, marker: "debug-sentinel-scope" };
  }
  return { valid: true, marker: null };
};
const deterministicFulfillPayload = (responseContract, bodyBytes = null) => {
  const bytes =
    bodyBytes || Buffer.from(responseContract.responseBodyUtf8, "utf8");
  assert.equal(
    bytes.length,
    responseContract.bytes ??
      responseContract.responseBodyBytes ??
      bytes.length,
  );
  assert.equal(
    secretSha256(bytes),
    responseContract.sha256 ?? responseContract.responseBodySha256,
  );
  const responseHeaders = Object.entries(
    responseContract.responseHeaders || {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    },
  ).map(([name, value]) => ({ name, value }));
  return {
    responseCode: responseContract.responseStatus ?? 200,
    responseHeaders,
    body: bytes.toString("base64"),
    bodySha256: secretSha256(bytes),
    bodyBytes: bytes.length,
  };
};
const localFirebaseModulePayloadCache = new Map();
const localFirebaseModulePayload = (requestUrl) => {
  const pathname = new URL(requestUrl).pathname;
  if (localFirebaseModulePayloadCache.has(pathname)) {
    return localFirebaseModulePayloadCache.get(pathname);
  }
  const firebaseRule =
    contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
      (rule) => rule.id === "firebase-esm-12.9.0",
    );
  const moduleContract = firebaseRule?.localModules?.[pathname];
  assert.ok(moduleContract);
  const bytes = readFileSync(resolve(moduleContract.path));
  const payload = deterministicFulfillPayload(
    {
      ...moduleContract,
      responseStatus: 200,
      responseHeaders: firebaseRule.responseHeaders,
    },
    bytes,
  );
  localFirebaseModulePayloadCache.set(pathname, payload);
  return payload;
};
const assertAuditedNetworkBoundaryEvent = ({ event, expectedApiKeySha256 }) => {
  assert.equal(
    event.canonicalHostname,
    canonicalNetworkHostname(event.hostname),
  );
  assert.equal(
    event.firebaseService,
    firebaseServiceForHostname(event.canonicalHostname),
  );
  assert.equal(event.firebase, Boolean(event.firebaseService));
  assert.equal(
    event.canonicalHostname.endsWith(".firebasedatabase.app"),
    false,
    "A regional Realtime Database request reached evidence even though no exact regional databaseURL is configured.",
  );
  assert.equal(event.malformedUrlEncoding, false);
  assert.equal(event.production, false);
  assert.equal(event.unboundFirebase, false);
  assert.equal(event.firebaseTransportValid, true);
  assert.ok(Number.isInteger(event.apiKeyValueCount));
  assert.ok(event.apiKeyValueCount >= 0);
  if (!event.firebase) {
    assert.equal(event.serviceResourceBound, false);
    assert.equal(event.apiKeyValueCount, 0);
    assert.equal(event.apiKeyBindingValid, false);
    assert.equal(event.apiKeySha256, null);
    return true;
  }
  assert.equal(event.staging, true);
  assert.equal(event.serviceResourceBound, true);
  const exactApiKeyRequired = ["auth", "app-check"].includes(
    event.firebaseService,
  );
  if (exactApiKeyRequired) assert.equal(event.apiKeyValueCount, 1);
  else assert.ok([0, 1].includes(event.apiKeyValueCount));
  if (event.apiKeyValueCount === 1) {
    assert.equal(event.apiKeyBindingValid, true);
    assert.equal(event.apiKeySha256, expectedApiKeySha256);
  } else {
    assert.equal(event.apiKeyBindingValid, false);
    assert.equal(event.apiKeySha256, null);
  }
  assert.equal(
    event.observedProjectIds.every(
      (projectId) => projectId === contract.firebaseProjectId.toLowerCase(),
    ),
    true,
  );
  return true;
};
const stableOriginRewriteDecision = ({
  stage,
  requestUrl,
  method,
  resourceType,
  browserOrigin,
  upstreamOrigins,
  transportContract,
}) => {
  assert.ok(["baseline", "candidate"].includes(stage));
  const parsed = new URL(requestUrl);
  const stableOriginRequest =
    parsed.protocol === transportContract.requiredProtocol &&
    (transportContract.userinfoAllowed ||
      (parsed.username === "" && parsed.password === "")) &&
    transportContract.allowedPorts.includes(parsed.port) &&
    parsed.origin === browserOrigin;
  const normalizedMethod = String(method).toUpperCase();
  const normalizedResourceType = String(resourceType);
  const extensionMatch = parsed.pathname.toLowerCase().match(/\.[a-z0-9]+$/u);
  const pathExtension = extensionMatch?.[0] || "";
  const documentRequest =
    normalizedResourceType === transportContract.documentResourceType;
  const staticRequest =
    transportContract.staticResourceTypes.includes(normalizedResourceType) ||
    transportContract.staticPathPrefixes.some((prefix) =>
      parsed.pathname.startsWith(prefix),
    ) ||
    transportContract.staticPathExtensions.includes(pathExtension);
  const eligible =
    stableOriginRequest &&
    transportContract.allowedMethods.includes(normalizedMethod) &&
    (documentRequest || staticRequest);
  if (!eligible) {
    return {
      stableOriginRequest,
      eligible: false,
      kind: null,
      browserOrigin: parsed.origin,
      browserPath: `${parsed.pathname}${parsed.search}`,
      upstreamOrigin: null,
      upstreamUrl: null,
    };
  }
  const upstreamOrigin = upstreamOrigins[stage];
  assert.match(upstreamOrigin, /^https:\/\/[^/?#]+\.vercel\.app$/u);
  const upstreamUrl = new URL(
    `${parsed.pathname}${parsed.search}`,
    upstreamOrigin,
  );
  assert.equal(upstreamUrl.origin, upstreamOrigin);
  return {
    stableOriginRequest: true,
    eligible: true,
    kind: documentRequest ? "document" : "static",
    browserOrigin: parsed.origin,
    browserPath: `${parsed.pathname}${parsed.search}`,
    upstreamOrigin,
    upstreamUrl: upstreamUrl.toString(),
  };
};
const telemetryCapabilityGuardDecision = ({
  documentUrl,
  stableBrowserOrigin,
  guardContract = contract.networkBoundary.optionalTelemetrySuppression
    .documentStartGuard,
}) => {
  const parsed = new URL(documentUrl);
  const exactOrigin =
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    (!parsed.port || parsed.port === "443") &&
    parsed.origin === stableBrowserOrigin;
  return {
    eligible: exactOrigin,
    property: exactOrigin ? guardContract.property : null,
    value: exactOrigin ? guardContract.value : null,
    action: exactOrigin ? "define-locked-own-data-property" : "leave-native",
  };
};
const stableOriginFaviconFallbackDecision = ({
  stage,
  requestUrl,
  method,
  resourceType,
  postData = "",
  browserOrigin,
  transportContract = contract.browserTransport,
}) => {
  const fallback = transportContract.stableOriginFaviconFallback;
  const parsed = new URL(requestUrl);
  const exactStableOrigin =
    parsed.protocol === transportContract.requiredProtocol &&
    parsed.username === "" &&
    parsed.password === "" &&
    transportContract.allowedPorts.includes(parsed.port) &&
    parsed.origin === browserOrigin;
  const eligible =
    fallback.stages.includes(stage) &&
    exactStableOrigin &&
    String(method).toUpperCase() === fallback.method &&
    parsed.pathname === fallback.pathname &&
    parsed.search === "" &&
    parsed.hash === "" &&
    String(resourceType) === fallback.resourceType &&
    String(postData || "") === "";
  return {
    eligible,
    id: eligible ? fallback.id : null,
    browserOrigin: parsed.origin,
    browserPath: `${parsed.pathname}${parsed.search}`,
    responseStatus: eligible ? fallback.responseStatus : null,
    responseBodySha256: eligible ? fallback.responseBodySha256 : null,
  };
};
const verifyTelemetryCapabilityGuardNegativeFixtures = () => {
  const stableBrowserOrigin = "https://stable.example.vercel.app";
  const accepted = telemetryCapabilityGuardDecision({
    documentUrl: `${stableBrowserOrigin}/#/teacher/dashboard`,
    stableBrowserOrigin,
  });
  assert.deepEqual(accepted, {
    eligible: true,
    property: "cookieEnabled",
    value: false,
    action: "define-locked-own-data-property",
  });
  const rejectedDocumentUrls = [
    "about:blank",
    "https://candidate.example.vercel.app/",
    "https://stable.example.vercel.app.evil.invalid/",
    "https://user@stable.example.vercel.app/",
    "http://stable.example.vercel.app/",
  ];
  for (const documentUrl of rejectedDocumentUrls) {
    assert.deepEqual(
      telemetryCapabilityGuardDecision({
        documentUrl,
        stableBrowserOrigin,
      }),
      {
        eligible: false,
        property: null,
        value: null,
        action: "leave-native",
      },
    );
  }
  return {
    acceptedTelemetryCapabilityGuardCaseCount: 1,
    rejectedTelemetryCapabilityGuardScopeCaseCount: rejectedDocumentUrls.length,
  };
};
const verifyStableOriginFaviconFallbackNegativeFixtures = () => {
  const browserOrigin = "https://stable.example.vercel.app";
  const acceptedFixtures =
    contract.browserTransport.stableOriginFaviconFallback.stages.map(
      (stage) => ({
        stage,
        requestUrl: `${browserOrigin}/favicon.ico`,
        method: "GET",
        resourceType: "Other",
      }),
    );
  for (const fixture of acceptedFixtures) {
    assert.deepEqual(
      stableOriginFaviconFallbackDecision({
        ...fixture,
        browserOrigin,
      }),
      {
        eligible: true,
        id: "stable-origin-favicon-empty-204-v1",
        browserOrigin,
        browserPath: "/favicon.ico",
        responseStatus: 204,
        responseBodySha256:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      },
    );
  }
  const rejectedFixtures = [
    { requestUrl: `${browserOrigin}/favicon.ico?cache=1` },
    { requestUrl: `${browserOrigin}/favicon.ico#fragment` },
    { requestUrl: "https://candidate.example.vercel.app/favicon.ico" },
    { method: "HEAD" },
    { resourceType: "Image" },
    { postData: "unexpected" },
    { requestUrl: "https://user@stable.example.vercel.app/favicon.ico" },
    { requestUrl: "http://stable.example.vercel.app/favicon.ico" },
    { requestUrl: "https://stable.example.vercel.app:444/favicon.ico" },
  ];
  for (const mutation of rejectedFixtures) {
    const decision = stableOriginFaviconFallbackDecision({
      ...acceptedFixtures[0],
      ...mutation,
      browserOrigin,
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.id, null);
    assert.equal(decision.responseStatus, null);
    assert.equal(decision.responseBodySha256, null);
  }
  return {
    acceptedStableOriginFaviconFallbackCaseCount: acceptedFixtures.length,
    rejectedStableOriginFaviconFallbackCaseCount: rejectedFixtures.length,
    stableOriginFaviconFallbackNodeUpstreamFetchCount: 0,
  };
};
const verifyStableOriginRewriteNegativeFixtures = () => {
  const browserOrigin = "https://stable.example.vercel.app";
  const upstreamOrigins = {
    baseline: "https://baseline.example.vercel.app",
    candidate: "https://candidate.example.vercel.app",
  };
  const document = stableOriginRewriteDecision({
    stage: "baseline",
    requestUrl: `${browserOrigin}/?fixture=1`,
    method: "GET",
    resourceType: "Document",
    browserOrigin,
    upstreamOrigins,
    transportContract: contract.browserTransport,
  });
  assert.equal(document.eligible, true);
  assert.equal(document.kind, "document");
  assert.equal(document.upstreamUrl, `${upstreamOrigins.baseline}/?fixture=1`);
  const script = stableOriginRewriteDecision({
    stage: "candidate",
    requestUrl: `${browserOrigin}/assets/index-123.js`,
    method: "GET",
    resourceType: "Script",
    browserOrigin,
    upstreamOrigins,
    transportContract: contract.browserTransport,
  });
  assert.equal(script.eligible, true);
  assert.equal(script.kind, "static");
  assert.equal(script.upstreamOrigin, upstreamOrigins.candidate);
  for (const fixture of [
    {
      requestUrl:
        "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
      method: "GET",
      resourceType: "XHR",
    },
    {
      requestUrl: `${browserOrigin}/api/write`,
      method: "POST",
      resourceType: "Fetch",
    },
    {
      requestUrl: `${upstreamOrigins.baseline}/assets/index-123.js`,
      method: "GET",
      resourceType: "Script",
    },
    {
      requestUrl: "https://user@stable.example.vercel.app/assets/index-123.js",
      method: "GET",
      resourceType: "Script",
    },
  ]) {
    const decision = stableOriginRewriteDecision({
      stage: "baseline",
      ...fixture,
      browserOrigin,
      upstreamOrigins,
      transportContract: contract.browserTransport,
    });
    assert.equal(decision.eligible, false);
    assert.equal(decision.upstreamUrl, null);
  }
  return {
    acceptedStableDocumentCaseCount: 1,
    acceptedStableStaticCaseCount: 1,
    rejectedExternalOrNonStaticCaseCount: 4,
  };
};
const verifyNetworkPolicyNegativeFixtures = () => {
  const stableBrowserOrigin = "https://stable.example.vercel.app";
  const stagingApiKey = "w10p-synthetic-staging-api-key";
  const credentialValues = [
    "w10p-student@example.invalid",
    "w10p-password-secret",
  ];
  const refreshToken = "w10p-refresh-token-secret";
  const debugToken = "12345678-1234-4123-8123-123456789abc";
  const holidayRequest = `${stableBrowserOrigin}/api/korean-holidays?year=2026`;
  const holiday = deterministicResponseDecision({
    requestUrl: holidayRequest,
    method: "GET",
    resourceType: "Fetch",
    stableBrowserOrigin,
  });
  assert.equal(holiday.scoped, true);
  assert.equal(holiday.eligible, true);
  assert.equal(holiday.year, 2026);
  const rejectedHolidayRequests = [
    { requestUrl: `${stableBrowserOrigin}/api/korean-holidays`, method: "GET" },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=2026&year=2026`,
      method: "GET",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=02026`,
      method: "GET",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/korean-holidays?year=2026`,
      method: "POST",
    },
    {
      requestUrl: `${stableBrowserOrigin}/api/unknown?year=2026`,
      method: "GET",
    },
  ];
  for (const fixture of rejectedHolidayRequests) {
    const decision = deterministicResponseDecision({
      ...fixture,
      resourceType: "Fetch",
      stableBrowserOrigin,
    });
    assert.equal(decision.scoped, true);
    assert.equal(decision.eligible, false);
  }
  const recaptchaContract =
    contract.browserTransport.deterministicRecaptchaResponse;
  const recaptchaUrl = `${recaptchaContract.protocol}//${recaptchaContract.hostname}${recaptchaContract.pathname}`;
  assert.equal(
    deterministicResponseDecision({
      requestUrl: recaptchaUrl,
      method: "GET",
      resourceType: "Script",
      stableBrowserOrigin,
    }).eligible,
    true,
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: `https://${recaptchaContract.hostname}/recaptcha/api.js`,
      method: "GET",
      resourceType: "Script",
      isFirebaseRequest: false,
      allowedOrigins: [stableBrowserOrigin],
    }),
    false,
  );
  const firebaseModuleUrl =
    "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
  assert.equal(
    externalStaticRequestDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      resourceType: "Script",
    }).eligible,
    true,
  );
  assert.equal(
    exactStaticExternalRuleId({
      requestUrl: firebaseModuleUrl,
      method: "HEAD",
      resourceType: "Script",
    }),
    null,
  );
  const externalScopeMismatchFixtures = [
    { headers: { range: "bytes=0-10" } },
    { headers: { authorization: "synthetic" } },
    { headers: { "x-goog-api-key": stagingApiKey } },
    { postData: "synthetic-body" },
  ];
  for (const fixture of externalScopeMismatchFixtures) {
    const decision = externalStaticRequestDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      resourceType: "Script",
      ...fixture,
    });
    assert.equal(decision.scoped, true);
    assert.equal(decision.eligible, false);
  }
  for (const requestUrl of [
    `${firebaseModuleUrl}?unexpected=1`,
    "https://www.gstatic.com/firebasejs/12.9.0/unknown.js",
    "https://unknown-external.invalid/file.js",
  ]) {
    assert.equal(
      exactStaticExternalRuleId({
        requestUrl,
        method: "GET",
        resourceType: "Script",
      }),
      null,
    );
  }
  const externalInspection = {
    isFirebaseRequest: false,
    apiKeyBindingValid: false,
    apiKeyValueCount: 0,
  };
  assert.equal(
    stagingApiKeyScopeDecision({
      requestUrl: firebaseModuleUrl,
      method: "GET",
      headers: { "x-goog-api-key": stagingApiKey },
      stagingApiKey,
      inspection: externalInspection,
    }).valid,
    false,
  );
  const firestoreDatabase = `projects/${contract.firebaseProjectId}/databases/(default)`;
  const firestoreWebChannelUrl = new URL(
    "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel",
  );
  firestoreWebChannelUrl.searchParams.set("database", firestoreDatabase);
  firestoreWebChannelUrl.searchParams.set("VER", "8");
  firestoreWebChannelUrl.searchParams.set("RID", "12345");
  firestoreWebChannelUrl.searchParams.set("CVER", "22");
  firestoreWebChannelUrl.searchParams.set("X-HTTP-Session-Id", "gsessionid");
  firestoreWebChannelUrl.searchParams.set("zx", "abc123");
  firestoreWebChannelUrl.searchParams.set("t", "1");
  const firestoreHeaders = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
  };
  const firestoreEncodedHeaderBlock = [
    "X-Goog-Api-Client:gl-js/fire/12.9.0",
    `X-Goog-Api-Key:${stagingApiKey}`,
    "Authorization:Bearer synthetic-token",
    "",
  ].join("\r\n");
  const firestorePostData = [
    `headers=${encodeURIComponent(firestoreEncodedHeaderBlock)}`,
    "count=1",
    "ofs=0",
    `req0___data__=${encodeURIComponent('{"database":"staging"}')}`,
  ].join("&");
  const firestoreInspection = {
    firebaseService: "firestore",
    isFirebaseRequest: true,
    stagingMarker: true,
    productionMarker: false,
    unboundFirebaseRequest: false,
    malformedUrlEncoding: false,
    firebaseTransportValid: true,
    serviceResourceBound: true,
    apiKeyValueCount: 0,
    apiKeyBindingValid: false,
  };
  assert.equal(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: firestoreHeaders,
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    true,
  );
  assert.equal(
    exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    true,
  );
  assert.deepEqual(
    stagingApiKeyScopeDecision({
      requestUrl: firestoreWebChannelUrl.toString(),
      method: "POST",
      headers: firestoreHeaders,
      postData: firestorePostData,
      stagingApiKey,
      inspection: firestoreInspection,
    }),
    {
      observedOccurrenceCount: 1,
      approvedOccurrenceCount: 1,
      approvedEncodedBodyOccurrenceCount: 1,
      valid: true,
    },
  );
  const duplicateDatabaseUrl = new URL(firestoreWebChannelUrl);
  duplicateDatabaseUrl.searchParams.append("database", firestoreDatabase);
  const wrongSessionNegotiationUrl = new URL(firestoreWebChannelUrl);
  wrongSessionNegotiationUrl.searchParams.set(
    "X-HTTP-Session-Id",
    "wrong-session-parameter",
  );
  const queryApiKeyUrl = new URL(firestoreWebChannelUrl);
  queryApiKeyUrl.searchParams.set("key", stagingApiKey);
  const rejectedFirestoreWebChannelApiKeyScopes = [
    { method: "GET" },
    {
      requestUrl: firestoreWebChannelUrl
        .toString()
        .replace("/Listen/channel?", "/Listen/channel/extra?"),
    },
    { requestUrl: duplicateDatabaseUrl.toString() },
    { requestUrl: wrongSessionNegotiationUrl.toString() },
    { requestUrl: queryApiKeyUrl.toString() },
    { headers: { "content-type": "application/json" } },
    {
      postData: `${firestorePostData}&headers=${encodeURIComponent(firestoreEncodedHeaderBlock)}`,
    },
    { postData: `req0___data__=${stagingApiKey}` },
    {
      postData: `${firestorePostData}&extra=%77${stagingApiKey.slice(1)}`,
    },
    {
      postData: firestorePostData.replace(
        encodeURIComponent(firestoreEncodedHeaderBlock),
        encodeURIComponent(
          `${firestoreEncodedHeaderBlock}X-Goog-Api-Key:${stagingApiKey}\r\n`,
        ),
      ),
    },
    { postData: `headers=%E0%A4%A${stagingApiKey}` },
    { inspection: { ...firestoreInspection, stagingMarker: false } },
  ];
  for (const fixture of rejectedFirestoreWebChannelApiKeyScopes) {
    assert.equal(
      exactStagingFirestoreWebChannelEncodedApiKeyBodyScope({
        requestUrl: firestoreWebChannelUrl.toString(),
        method: "POST",
        headers: firestoreHeaders,
        postData: firestorePostData,
        stagingApiKey,
        inspection: firestoreInspection,
        ...fixture,
      }),
      false,
    );
  }
  const sensitiveFixtures = [
    {
      postData: credentialValues[0],
      credentialValues,
      marker: "test-credential-scope",
    },
    {
      headers: { "x-test": credentialValues[1] },
      credentialValues,
      marker: "test-credential-scope",
    },
    {
      postData: `refresh_token=${refreshToken}`,
      refreshTokenValues: [refreshToken],
      marker: "refresh-token-scope",
    },
    { postData: debugToken, debugToken, marker: "debug-token-scope" },
    {
      headers: { "x-test": APP_CHECK_DEBUG_SENTINEL },
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
      marker: "debug-sentinel-scope",
    },
  ];
  for (const { marker, ...fixture } of sensitiveFixtures) {
    assert.deepEqual(
      sensitiveMaterialScopeDecision({
        requestUrl: firebaseModuleUrl,
        ...fixture,
      }),
      { valid: false, marker },
    );
  }
  assert.equal(
    exactAuthCredentialBodyRequestScope({
      requestUrl: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${stagingApiKey}`,
      method: "POST",
      stagingApiKey,
    }),
    true,
  );
  assert.equal(
    exactRefreshTokenBodyRequestScope({
      requestUrl: `https://securetoken.googleapis.com/v1/token?key=${stagingApiKey}`,
      method: "POST",
      stagingApiKey,
    }),
    true,
  );
  for (const requestUrl of [
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${stagingApiKey}`,
    `https://securetoken.googleapis.com/v1/token?key=${stagingApiKey}&key=${stagingApiKey}`,
    `https://securetoken.googleapis.com/v1/other?key=${stagingApiKey}`,
  ]) {
    assert.equal(
      exactRefreshTokenBodyRequestScope({
        requestUrl,
        method: "POST",
        stagingApiKey,
      }),
      false,
    );
  }
  assert.equal(
    optionalTelemetrySuppressionDecision({
      requestUrl:
        "https://firebaseinstallations.googleapis.com/v1/projects/x/installations",
      method: "POST",
    }).eligible,
    true,
  );
  const firebaseRule =
    contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
      ({ id }) => id === "firebase-esm-12.9.0",
    );
  assert.ok(firebaseRule);
  for (const pathname of Object.keys(firebaseRule.localModules)) {
    const payload = localFirebaseModulePayload(
      `https://${firebaseRule.hostname}${pathname}`,
    );
    const responseHeaders = Object.fromEntries(
      payload.responseHeaders.map(({ name, value }) => [name, value]),
    );
    assert.equal(responseHeaders["access-control-allow-origin"], "*");
    assert.equal(
      responseHeaders["cross-origin-resource-policy"],
      "cross-origin",
    );
    assert.equal(responseHeaders["cache-control"], "no-store");
  }
  return {
    acceptedDeterministicHolidayCaseCount: 1,
    rejectedDeterministicHolidayScopeCaseCount: rejectedHolidayRequests.length,
    acceptedDeterministicRecaptchaCaseCount: 1,
    rejectedRecaptchaPathCaseCount: 1,
    acceptedExternalStaticCaseCount: 1,
    rejectedExternalStaticHeadCaseCount: 1,
    rejectedExternalStaticSensitiveInputCaseCount:
      externalScopeMismatchFixtures.length,
    rejectedExternalStaticPathCaseCount: 3,
    rejectedStagingApiKeyExfiltrationCaseCount: 1,
    acceptedFirestoreWebChannelEncodedApiKeyCaseCount: 2,
    rejectedFirestoreWebChannelEncodedApiKeyCaseCount:
      rejectedFirestoreWebChannelApiKeyScopes.length,
    rejectedSensitiveMaterialExfiltrationCaseCount: sensitiveFixtures.length,
    acceptedExactAuthCredentialBodyScopeCaseCount: 1,
    acceptedExactRefreshTokenBodyScopeCaseCount: 1,
    rejectedRefreshTokenBodyScopeCaseCount: 3,
    optionalTelemetrySuppressionCaseCount: 1,
    verifiedLocalFirebaseModuleCaseCount: Object.keys(firebaseRule.localModules)
      .length,
  };
};
const assertCapturePreTransmissionBoundarySourceOrdering = (sourceText) => {
  const compactSourceText = sourceText.replace(/\s+/gu, "");
  assert.match(
    sourceText,
    /const nonFirebaseHostnameAllowed = isNonFirebaseHostnameAllowed\(\{\s*requestUrl,\s*method,\s*resourceType,\s*isFirebaseRequest,\s*allowedOrigins: allowedNonFirebaseOrigins,\s*\}\);/u,
    "inspectNetworkBoundary must derive the real allowlist boolean from the exact runtime origin and request-rule set.",
  );
  assert.match(
    sourceText,
    /firebaseService,\s*isFirebaseRequest,\s*nonFirebaseHostnameAllowed,\s*nonFirebasePolicyRuleId: nonFirebaseRuleId,\s*stagingMarker,/u,
    "inspectNetworkRequest must return the allowlist boolean consumed by the pre-transmission decision.",
  );
  const publicRequestHandlerStart = sourceText.lastIndexOf(
    "const handlePausedRequest = async (event, requestCaptureScope) => {",
  );
  assert.ok(publicRequestHandlerStart >= 0);
  const directFirebaseContinuationStart = sourceText.lastIndexOf(
    "const continueInspectedDirectFirebaseRequest = async ({",
    publicRequestHandlerStart,
  );
  assert.ok(directFirebaseContinuationStart >= 0);
  const directFirebaseContinuationSource = sourceText.slice(
    directFirebaseContinuationStart,
    publicRequestHandlerStart,
  );
  assert.match(
    directFirebaseContinuationSource,
    /exactStagingFirestoreWebChannelEncodedApiKeyBodyScope\(\{[\s\S]*headers:\s*requestHeaders,[\s\S]*postData:\s*requestPostData,[\s\S]*stagingApiKey:\s*firebaseConfig\.apiKey,[\s\S]*conditionalResponseHeaderRuleId/u,
    "The conditional Firestore response-header rule must be bound to the fully resolved, exact encoded-init API-key body scope.",
  );
  const resolvedPostDataIndex = sourceText.indexOf(
    "const resolvedPostData = await resolvePausedRequestPostData({",
    publicRequestHandlerStart,
  );
  const requestStageStart = sourceText.indexOf(
    'if (stage === "baseline") baselineBridgeCdpPausedRequestCount += 1;',
    resolvedPostDataIndex,
  );
  assert.ok(requestStageStart >= 0);
  const headerReadIndex = sourceText.indexOf(
    "const headerEntries = Object.entries(event.request.headers || {})",
    requestStageStart,
  );
  const postDataReadIndex = sourceText.indexOf(
    "const postData = resolvedPostData.postData;",
    requestStageStart,
  );
  const inspectionIndex = sourceText.indexOf(
    "const preTransmissionInspection = inspectNetworkRequest({",
    requestStageStart,
  );
  const apiKeyExtractionIndex = sourceText.indexOf(
    "const preTransmissionApiKeyHeaderValues = extractApiKeyHeaderValues(",
    requestStageStart,
  );
  const unifiedSensitiveDecisionIndex = sourceText.indexOf(
    "const rawSensitiveDecision = unifiedSensitivePreTransmissionDecision({",
    inspectionIndex,
  );
  const unifiedSensitiveBlockIndex = sourceText.indexOf(
    "if (!rawSensitiveDecision.valid) {",
    unifiedSensitiveDecisionIndex,
  );
  const telemetryDecisionIndex = sourceText.indexOf(
    "const telemetryDecision = optionalTelemetrySuppressionDecision({",
    unifiedSensitiveBlockIndex,
  );
  const decisionIndex = sourceText.indexOf(
    "const preTransmissionDecision = preTransmissionBoundaryDecision(",
    telemetryDecisionIndex,
  );
  const blockIndex = sourceText.indexOf(
    "if (preTransmissionDecision.block) {",
    decisionIndex,
  );
  const deterministicDecisionIndex = sourceText.indexOf(
    "const deterministicDecision = deterministicResponseDecision({",
    blockIndex,
  );
  const externalStaticDecisionIndex = sourceText.indexOf(
    "const externalStaticDecision = externalStaticRequestDecision({",
    deterministicDecisionIndex,
  );
  const stableOriginDecisionIndex = sourceText.indexOf(
    "const rewriteDecision = stableOriginRewriteDecision({",
    externalStaticDecisionIndex,
  );
  const faviconFallbackDecisionIndex = sourceText.indexOf(
    "const faviconFallbackDecision =",
    stableOriginDecisionIndex,
  );
  const faviconFallbackFulfillIndex = sourceText.indexOf(
    "if (faviconFallbackDecision.eligible) {",
    faviconFallbackDecisionIndex,
  );
  const immutableResourceFetchIndex = sourceText.indexOf(
    "const immutableAttestation = await fetchImmutableResourceAttestation(",
    faviconFallbackFulfillIndex,
  );
  assert.ok(
    publicRequestHandlerStart < resolvedPostDataIndex &&
      resolvedPostDataIndex < requestStageStart &&
      requestStageStart < headerReadIndex &&
      headerReadIndex < postDataReadIndex &&
      postDataReadIndex < apiKeyExtractionIndex &&
      apiKeyExtractionIndex < inspectionIndex &&
      inspectionIndex < unifiedSensitiveDecisionIndex &&
      unifiedSensitiveDecisionIndex < unifiedSensitiveBlockIndex &&
      unifiedSensitiveBlockIndex < telemetryDecisionIndex &&
      inspectionIndex < decisionIndex &&
      decisionIndex < blockIndex &&
      blockIndex < deterministicDecisionIndex &&
      deterministicDecisionIndex < externalStaticDecisionIndex &&
      externalStaticDecisionIndex < stableOriginDecisionIndex &&
      stableOriginDecisionIndex < faviconFallbackDecisionIndex &&
      faviconFallbackDecisionIndex < faviconFallbackFulfillIndex &&
      faviconFallbackFulfillIndex < immutableResourceFetchIndex,
    "The unified raw-sensitive scan must run before telemetry, deterministic fulfillment, external handling, and stable-origin fulfillment.",
  );
  const faviconFallbackBranchSource = sourceText.slice(
    faviconFallbackFulfillIndex,
    immutableResourceFetchIndex,
  );
  assert.equal(
    (faviconFallbackBranchSource.match(/\bfetch\s*\(/gu) || []).length,
    0,
    "The exact favicon fallback must not perform a Node fetch.",
  );
  assert.equal(
    (
      faviconFallbackBranchSource.match(
        /Fetch\.(?:continueRequest|continueResponse|getResponseBody)/gu,
      ) || []
    ).length,
    0,
    "The exact favicon fallback must not continue a browser network request.",
  );
  assert.equal(
    (faviconFallbackBranchSource.match(/Fetch\.fulfillRequest/gu) || []).length,
    1,
    "The exact favicon fallback must have one local CDP fulfillment.",
  );
  assert.match(
    faviconFallbackBranchSource,
    /await appCheckCdpSession\.send\("Fetch\.fulfillRequest",\s*\{[\s\S]*?\}\);\s*return;/u,
    "The exact favicon fallback must return immediately after local CDP fulfillment.",
  );
  const primaryContextCreationIndex = sourceText.lastIndexOf(
    "const context = await browser.newContext({",
  );
  const telemetryCapabilityGuardRegistrationIndex = sourceText.indexOf(
    "await context.addInitScript(telemetryCapabilityGuardInitScript, {",
    primaryContextCreationIndex,
  );
  const telemetryCapabilityGuardRegistrationCountIndex = sourceText.indexOf(
    "telemetryCapabilityGuardInitScriptRegistrationCount += 1;",
    telemetryCapabilityGuardRegistrationIndex,
  );
  const fixedClockRegistrationIndex = sourceText.indexOf(
    "await context.addInitScript(fixedClockScript, {",
    telemetryCapabilityGuardRegistrationCountIndex,
  );
  const primaryPageCreationIndex = sourceText.indexOf(
    "const page = await context.newPage();",
    fixedClockRegistrationIndex,
  );
  assert.ok(
    primaryContextCreationIndex >= 0 &&
      primaryContextCreationIndex < telemetryCapabilityGuardRegistrationIndex &&
      telemetryCapabilityGuardRegistrationIndex <
        telemetryCapabilityGuardRegistrationCountIndex &&
      telemetryCapabilityGuardRegistrationCountIndex <
        fixedClockRegistrationIndex &&
      fixedClockRegistrationIndex < primaryPageCreationIndex,
    "The exact-origin telemetry capability guard must be registered at document start before the primary page is created.",
  );
  const telemetryCapabilityGuardFunctionStart = sourceText.indexOf(
    "function telemetryCapabilityGuardInitScript({ allowedOrigin, guard })",
  );
  const telemetryCapabilityGuardFunctionEnd = sourceText.indexOf(
    "function evaluateTelemetryCapabilityGuardRuntime({ expectedOrigin, guard })",
    telemetryCapabilityGuardFunctionStart,
  );
  assert.ok(
    telemetryCapabilityGuardFunctionStart >= 0 &&
      telemetryCapabilityGuardFunctionEnd >
        telemetryCapabilityGuardFunctionStart,
  );
  assert.match(
    sourceText.slice(
      telemetryCapabilityGuardFunctionStart,
      telemetryCapabilityGuardFunctionEnd,
    ),
    /if \(location\.origin !== allowedOrigin\) return;[\s\S]*Object\.defineProperty\(navigator, guard\.property, \{[\s\S]*configurable: guard\.descriptor\.configurable,[\s\S]*enumerable: guard\.descriptor\.enumerable,[\s\S]*writable: guard\.descriptor\.writable,[\s\S]*value: guard\.value,/u,
    "The telemetry capability guard must remain exact-origin and define the contracted locked navigator own property.",
  );
  const faviconFallbackFunctionStart = sourceText.indexOf(
    "const stableOriginFaviconFallbackDecision = ({",
  );
  const faviconFallbackFunctionEnd = sourceText.indexOf(
    "const exactAuthCredentialBodyRequestScope = ({",
    faviconFallbackFunctionStart,
  );
  assert.ok(
    faviconFallbackFunctionStart >= 0 &&
      faviconFallbackFunctionEnd > faviconFallbackFunctionStart,
  );
  assert.match(
    sourceText.slice(faviconFallbackFunctionStart, faviconFallbackFunctionEnd),
    /fallback\.stages\.includes\(stage\)[\s\S]*parsed\.protocol === transportContract\.requiredProtocol[\s\S]*transportContract\.userinfoAllowed[\s\S]*parsed\.username === "" && parsed\.password === ""[\s\S]*transportContract\.allowedPorts\.includes\(parsed\.port\)[\s\S]*parsed\.origin === browserOrigin[\s\S]*parsed\.pathname === fallback\.pathname[\s\S]*parsed\.search === ""[\s\S]*parsed\.hash === ""[\s\S]*String\(method\)\.toUpperCase\(\) === fallback\.method[\s\S]*String\(resourceType\) === fallback\.resourceType[\s\S]*String\(postData \|\| ""\) === ""/u,
    "The favicon fallback must remain bound to the exact stable origin, GET /favicon.ico Other request, and an absent body.",
  );
  for (const requiredSourceFragment of [
    "const resolveExactChromiumNetworkRequestIdentity = ({ browser, request }) =>",
    'symbol.description === "InterceptableRequest"',
    'candidate.constructor?.name === "_InterceptableRequest"',
    "candidate.request === requestImpl",
    "identity._interceptionId,",
    "networkRequestId: identity._requestId",
    "const exactStagingFirestoreWebChannelHeaderCorrelationScope = (options) =>",
    "const expectedFirestoreWebChannelResourceTypeForObserver = (",
    "const classifyExactStagingFirestoreWebChannelHeaderCorrelationScope = ({",
    "expectedResourceType === null ||",
    "String(resourceType).toLowerCase() !== expectedResourceType",
    "const pausedRequestPostDataPresenceForCorrelation = (request = {}) =>",
    "const SAFE_FIRESTORE_WEBCHANNEL_LISTENER_DIAGNOSTIC_REASONS = [",
    '"observer-surface-invalid",',
    '"resource-type-mismatch",',
    "const diagnoseExactStagingFirestoreWebChannelHeaderCorrelationScope = (",
    "const FIRESTORE_WEBCHANNEL_FORWARD_QUERY_NAMES = [",
    "const PLAYWRIGHT_ALL_HEADERS_ATTESTATION_TIMEOUT_MS = 30_000;",
    "const NETWORK_ATTESTATION_FLUSH_TIMEOUT_MS = 45_000;",
    "const CDP_HANDLER_DRAIN_TIMEOUT_MS = 45_000;",
    "const withExplicitTimeout = async (promise, timeoutMs, message) =>",
    "const drainAppCheckCdpHandlerPromises = async () =>",
    "request.hasPostData === true",
    "pausedRequestPostDataPresenceForCorrelation(event.request);",
    "const webChannelListenerDiagnosticClassCounts = new Map();",
    "const listenerDiagnostic = diagnoseExactStagingFirestoreWebChannelHeaderCorrelationScope({",
    "exactFirestoreWebChannelListenerDiagnosticCandidate(event.request.url)",
    "incrementSafeDiagnosticClass(webChannelListenerDiagnosticClassCounts,",
    "webChannelListenerDiagnosticClasses: snapshotSafeDiagnosticClasses(",
    "request.allHeaders(),\n            PLAYWRIGHT_ALL_HEADERS_ATTESTATION_TIMEOUT_MS,",
    "const advanceWebChannelCdpHeaderAttestationRendezvous = (entry) =>",
    "webChannelCdpHeaderAttestationsByNetworkId",
    "webChannelCdpHeaderAttestationCompletionTimeoutCount",
    "exactPlaywrightToFetchNetworkRequestBindingCount",
    "const installBrowserWidePreTransmissionBoundary = async",
    'method === "Runtime.runIfWaitingForDebugger"',
    'originalSend.call(rootSession, "Target.closeTarget"',
    'session.on("Fetch.requestPaused", state.fetchPausedListener)',
    'await originalSend.call(state.session, "Fetch.disable", {})',
    "state.session.removeListener(",
    "await context.addInitScript(blockBrowserSecondaryExecutionAndWebTransport, EXACT_DOM_MODULEPRELOAD_POLICY,",
    'await context.routeWebSocket("**/*"',
    "await browserWideBoundaryController.handoffPrimaryRequestBoundary(groupKey)",
    "await browserWideBoundaryController.deactivate(groupKey)",
    "new Worker(workerUrl)",
    "new SharedWorker(sharedWorkerUrl)",
    "navigator.serviceWorker.register(serviceWorkerUrl)",
    'window.open(url, "_blank", "noopener")',
    "new WebTransport(webTransportUrl)",
    '"WebSocketStream"',
    '"RTCPeerConnection"',
    '"webkitRTCPeerConnection"',
    'Object.defineProperty(globalThis.navigator, "sendBeacon"',
    'lockMethod(globalThis.Navigator?.prototype, "sendBeacon", blockedOperation)',
    "globalThis.ServiceWorkerContainer?.prototype",
    "const {\n    Array,\n    Boolean,\n    DOMException,",
    "const nativeReflectApply = Reflect.apply",
    "const callNative = (callable, receiver, ...args) =>",
    "Object.freeze(intrinsicPrototype)",
    "const EXACT_DOM_MODULEPRELOAD_POLICY = Object.freeze(",
    "const exactResolvedModulepreloadHrefAllowed = (node) =>",
    "const nativeAttrOwnerElementDescriptor = findNativePropertyDescriptor(",
    "const nativeAttrLocalNameDescriptor = findNativePropertyDescriptor(",
    "const nativeAttrValueDescriptor = findNativePropertyDescriptor(",
    "const nativeNodeOwnerDocumentDescriptor = findNativePropertyDescriptor(",
    "const nativeNodeTypeDescriptor = findNativePropertyDescriptor(",
    "const nativeElementLocalNameDescriptor = findNativePropertyDescriptor(",
    "const nativeEventTypeDescriptor = findNativePropertyDescriptor(",
    "const nativeTokenListValueDescriptor = findNativePropertyDescriptor(",
    "const nativeRangeStartContainerDescriptor = findNativePropertyDescriptor(",
    "const nativeTemplateContentDescriptor = findNativePropertyDescriptor(",
    "const nativeNodeListLengthDescriptor = findNativePropertyDescriptor(",
    "const nativeDocumentCreateElement = Document.prototype.createElement",
    "const getNativeAttrOwnerElement = (attribute) =>",
    "getNativeAttrMutationName(attribute)",
    "getNativeAttrValue(attribute)",
    "const isNativeCurrentDocumentNode = (node) =>",
    "const isNativeHtmlElement = (node, localName) =>",
    "const isNativePingElement = (node) =>",
    "const getNativeEventType = (event) =>",
    "const guardedTokenListOwnerSymbol = Symbol.for(",
    "const isNativeCurrentDocumentRange = (range) =>",
    "const getNativeTemplateContent = (template) =>",
    "const snapshotNativeNodeList = (nodeList) =>",
    "const canReplaceModulepreloadContainer = (node) =>",
    "const modulepreloadStateByLink = new WeakMap()",
    'isNativeHtmlElement(node, "base")',
    'for (const name of ["append", "prepend", "replaceChildren"])',
    "const snapshotNodesOrStrings = (nodes) =>",
    'lockMethod(Element.prototype, "insertAdjacentHTML"',
    '[Element.prototype, "innerHTML"]',
    'lockMethod(DOMParser.prototype, "parseFromString"',
    'lockMethod(Element.prototype, "setAttribute"',
    'lockMethod(Element.prototype, "toggleAttribute"',
    'for (const name of ["setAttributeNode", "setAttributeNodeNS"])',
    'for (const name of ["setNamedItem", "setNamedItemNS"])',
    'for (const name of ["removeNamedItem", "removeNamedItemNS"])',
    'lockAttrValueSetter(Attr.prototype, "value")',
    'lockAttrValueSetter(Node.prototype, "nodeValue")',
    'lockAttrValueSetter(Node.prototype, "textContent")',
    'lockPropertySetter(HTMLIFrameElement.prototype, "srcdoc"',
    'lockMethod(Range.prototype, "insertNode"',
    '"deleteFromDocument",',
    'lockMethod(Document.prototype, "adoptNode"',
    'lockMethod(Document.prototype, "open", blockedOperation)',
    'lockMethod(Document.prototype, "write", blockedOperation)',
    'lockMethod(Document.prototype, "writeln", blockedOperation)',
    'lockMethod(target, "moveBefore"',
    'for (const name of ["setHTML", "setHTMLUnsafe"])',
    'lockMethod(globalThis.Document, "parseHTML", blockedOperation)',
    'lockMethod(globalThis.Document, "parseHTMLUnsafe"',
    'lockMethod(Document.prototype, "execCommand", blockedOperation)',
    "const speciallyGuardedLinkAccessorProperties = new Set([",
    "const blockedLinkMutableFacadeProperties = new Set([",
    "nativeLinkInheritanceAccessorDescriptors",
    "globalThis.SVGElement?.prototype",
    "globalThis.MathMLElement?.prototype",
    "globalThis.ElementInternals?.prototype",
    'marker: "parser-iframe-srcdoc"',
    'String(getNativeAttribute(node, "type") || "").toLowerCase()',
    "const EXACT_PARSER_MODULEPRELOAD_TAG_PATTERN =",
    "const immutableDocumentParserMarkupDecision = (",
    "function telemetryCapabilityGuardInitScript({ allowedOrigin, guard })",
    "if (location.origin !== allowedOrigin) return;",
    "Object.defineProperty(navigator, guard.property, {",
    "function evaluateTelemetryCapabilityGuardRuntime({ expectedOrigin, guard })",
    "const collectTelemetryCapabilityGuardAttestation = async ({",
    'point: "post-authentication",',
    'point: "post-screen-navigation",',
    "telemetryCapabilityGuardRuntimeAttestations.push(",
    "const stableOriginFaviconFallbackDecision = ({",
    "stableOriginFaviconFallbackFulfillCount += 1",
    "responseCode: fallbackPayload.responseCode",
    'marker: "parser-base-url"',
    "documentOrigin: stableBrowserOrigin",
    "immutableResourceAttestationParserMarkupRejectCount += 1",
    "exactDomModulepreloadRuntimeAttestation = await page.evaluate(",
    'recordRejection("connectedSpoofedRelAttrNameMutation"',
    'recordRejection("crossRealmExactLinkAppend"',
    'recordRejection("crossRealmRemoveChildCall"',
    'recordRejection("crossRealmRelListMutationCall"',
    'recordRejection("initialBlankRealmRemoveChildCall"',
    'recordRejection("rangeSurroundSpeculativeNode"',
    'recordRejection("admittedRelListAssignment"',
    'recordRejection("admittedSvgStyleGetterCall"',
    'recordRejection("reentrantFetchPropertyMutation"',
    'recordRejection("reentrantVariadicNodeCoercion"',
    'recordRejection("reentrantContextualRangeMutation"',
    'recordRejection("admittedSelectionDelete"',
    'recordRejection("admittedNonceMutation"',
    'recordRejection("nestedTemplateInnerHtml"',
    "const changingString = (counter, firstValue, laterValue) => ({",
    "coercionSnapshots: {",
    'result = await session.send("Browser.getBrowserCommandLine")',
    "ignoreDefaultArgs: BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS",
    "const rawSensitiveDecision = unifiedSensitivePreTransmissionDecision({",
    "const responseStageCorrelationDecision = ({",
    "const resolveAllowedEgressResponseCorrelation = ({",
    "const createPerCorrelationTaskCoordinator = () =>",
    "const createSingleOwnerProxyAuthorizationCoordinator = ({",
    "const contextClosedWebChannelBackchannelRetirementDecision = ({",
    "const contextClosedWebChannelSessionForwardPostRetirementDecision = ({",
    "const contextClosedWebChannelTerminationRetirementDecision = ({",
    "const retireExactContextClosedWebChannelAuthorizations = ({",
    "const classifyExactStagingFirestoreWebChannelTerminationLifecycleScope = ({",
    '"context-closed-webchannel-backchannel-retired"',
    '"context-closed-webchannel-session-forward-post-retired"',
    '"context-closed-webchannel-termination-retired"',
    "retireContextClosedWebChannelAuthorizations();",
    "webChannelRequestClass: exactWebChannelHeaderCorrelationClass",
    "webChannelTerminationClass: exactWebChannelTerminationLifecycleClass",
    "webChannelTerminationClassifiedRequestCount += Number(",
    "POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES",
    '"Protocol error (Fetch.continueResponse): Invalid InterceptionId."',
    '"cdpSession.send: Protocol error (Fetch.continueResponse): Invalid InterceptionId."',
    "if (!isPostFinalAlreadyRetiredInterceptionError(error))",
    '"post-final-error-observed-retired"',
    "const resolvePausedRequestPostData = async ({",
    'send("Network.getRequestPostData"',
    "const postDataOmissionFixtureEvent =",
    "postDataOmissionFixtureInjectionCount += 1",
    "postDataOmissionFixtureRealNetworkIdCount += 1",
    "postData: undefined",
    "fullPostDataRecoveredBodyExactMatchCount += Number(",
    "fullPostDataRecoveredBodySha256 = secretSha256(",
    '"missing-network-id"',
    '"network-read-failed"',
    '"maximum-bytes-exceeded"',
    '"representation-mismatch"',
    "const sanitizeBrowserResponseHeaders = (",
    "const exactStagingFirestoreWebChannelInitialRequestScope = (",
    "const exactStagingFirestoreWebChannelEncodedApiKeyBodyScope = (",
    "conditionalResponseHeaderRuleId,",
    'if (responseStageDecision.kind === "informational")',
    "informationalResponseRequestsByFetchRequestId.add(primaryRequestId)",
    "postFinalErrorContinueResponseParams(event.requestId)",
    "const createNodeOwnedVercelRequestHeaders = (",
    "headers: deploymentNodeRequestHeaders",
    "containsVercelPreviewToolbarMarkup(bytes)",
    "stableOriginRewriteLocalFulfillCount += 1",
    "const exactAuthCredentialBodyScope = exactAuthCredentialBodyRequestScope({",
    "const exactRefreshTokenBodyScope = exactRefreshTokenBodyRequestScope({",
    "const apiKeyScope = stagingApiKeyScopeDecision({",
    "const sensitiveMaterialScope = sensitiveMaterialScopeDecision({",
    "const deterministicDecision = deterministicResponseDecision({",
    "const externalStaticDecision = externalStaticRequestDecision({",
    "const fetchPinnedExternalStaticSources = async",
    "const nodeOwnedExactExternalStaticGet = (",
    "const createBrowserConnectProxyGate = (",
    'appCheckCdpSession.on("Network.responseReceivedEarlyHints"',
    'source: "baseline-node-network"',
    "const payload = localFirebaseModulePayload(requestUrl)",
    'await appCheckCdpSession.send("Fetch.fulfillRequest", {',
    "interceptResponse: true",
    'await appCheckCdpSession.send("Fetch.continueResponse", {',
    "responseHeaders: sanitizedInformational.responseHeaders",
    "responseHeaders: sanitizedFinal.responseHeaders",
    "responseHeaders: cachedExternal.responseHeaders",
    'canonicalHostname.endsWith(".firebasedatabase.app")',
    'upstreamParsed.hostname.endsWith(".firebasedatabase.app")',
    "const exactFirestoreListenInitialRequest = (requestUrl) =>",
    "const frozenBaselineListenerTupleKey = ({ gsessionid, sid }, targetId) =>",
    "const createFrozenBaselineListenerBindingObserver = ({",
    "secretSha256(parentSegments[1]) === expectedUidHash",
    'Object.prototype.hasOwnProperty.call(targetChange, "targetChangeType",)',
    '? targetChange.targetChangeType : "NO_CHANGE"',
    'targetChangeTypePresent || !Object.prototype.hasOwnProperty.call(targetChange, "cause")',
    "targetChange.causeCode !== policy.removedCauseCode",
    "const frozenBaselineObservationSequenceBefore = (left, right) =>",
    "eventSequence: observationSequence",
    "frameSequence: 0",
    "withinEventSequence: 0",
    "frozenBaselineObservationSequenceBefore(removedSequence, exactConsoleSequence,)",
    "frozenBaselineObservationSequenceBefore(removedSequence, successorTargets[0].addSequence,)",
    "frozenBaselineObservationSequenceBefore(successorTargets[0].addSequence, successorTargets[0].acknowledgementSequences[0],)",
    "const reserveInboundPayloadSequence = () =>",
    "const FROZEN_BASELINE_LISTENER_SETTLEMENT_TIMEOUT_MS = 3_000",
    "const FROZEN_BASELINE_LISTENER_SETTLEMENT_POLL_MS = 50",
    "const readyForSettlement = () =>",
    "if (settledDecision !== null || !eligible) return true",
    "const irrecoverableFailureObserved =",
    "if (irrecoverableFailureObserved) return true",
    "readyForSettlement,",
    "assert.equal(positiveObserver.readyForSettlement(), false)",
    "assert.equal(positiveObserver.readyForSettlement(), true)",
    "assert.equal(deferredStreamObserver.readyForSettlement(), false)",
    "assert.equal(deferredStreamObserver.readyForSettlement(), true)",
    "const appendFrozenBaselineBufferedStreamSegments = ({",
    "preStreamBufferedSegments: []",
    "assert.equal(bufferedBytes.length, expectedByteLength)",
    "const appendFrozenBaselineDataReceivedStreamChunk = ({",
    "assert.equal(exactBase64Buffer(encodedValue).length, byteLength)",
    "if (settledDecision !== null) return",
    "snapshotSemanticLedger(), settledSemanticLedger",
    "targetChange.targetIds.length === 0",
    "unboundRemovedTargetCount += 1",
    "ambiguousRemovedTargetCount += 1",
    "const shouldRecordFrozenBaselineListenTerminalStreamFailure = ({",
    "settled !== true && streamRequested !== true",
    '(method === "GET" && initialRequest !== true)',
    "(initialRequest === true && responseGsessionid === null)",
    'appCheckCdpSession.send("Network.streamResourceContent"',
    "frozenBaselineListenerBindingObserver.promoteInitialTargets({",
    "frozenBaselineListenerBindingRawValueOutputCount: 0",
    "verifyFrozenBaselineListenerBindingFixtures();",
    "browserConsoleErrorRecoveredProtectedReadCount + browserConsoleErrorRetiredFrozenBaselineCount",
    "frozenBaselineAuthenticationAnomalyRetirement,",
  ]) {
    assert.equal(
      compactSourceText.includes(requiredSourceFragment.replace(/\s+/gu, "")),
      true,
      `The all-target pre-transmission source contract is missing: ${requiredSourceFragment}`,
    );
  }
  const frozenBaselineFixtureSourceStart = sourceText.indexOf(
    "const verifyFrozenBaselineListenerBindingFixtures = async () => {",
  );
  const frozenBaselineFixtureSourceEnd = sourceText.indexOf(
    "const SAFE_FIRESTORE_WEBCHANNEL_AUTH_BINDING_CLASSES",
    frozenBaselineFixtureSourceStart,
  );
  assert.ok(frozenBaselineFixtureSourceStart >= 0);
  assert.ok(frozenBaselineFixtureSourceEnd > frozenBaselineFixtureSourceStart);
  const frozenBaselineFixtureSource = sourceText.slice(
    frozenBaselineFixtureSourceStart,
    frozenBaselineFixtureSourceEnd,
  );
  assert.match(
    frozenBaselineFixtureSource,
    /frozenBaselineListenerBindingPositiveFixtureCount:\s*3/u,
    "The frozen-baseline listener source contract must retain three positive lifecycle fixtures.",
  );
  assert.match(
    frozenBaselineFixtureSource,
    /const negativeSnapshots\s*=\s*\[mismatchedBufferedSnapshot\];/u,
    "The buffered byte-length mismatch must seed the frozen-baseline negative fixture ledger.",
  );
  assert.equal(
    (frozenBaselineFixtureSource.match(/negativeSnapshots\.push\(/gu) || [])
      .length,
    7,
    "The frozen-baseline listener source contract must retain eight negative lifecycle fixtures.",
  );
  assert.match(
    frozenBaselineFixtureSource,
    /for \(const \[targetChange, expectedTargetIds\] of \[\s*\[\{ readTime: "fixture-read-time" \}, \[\]\],\s*\[\{ targetIds: \[2\], resumeToken: "fixture-resume-token" \}, \[2\]\],\s*\]\) \{[\s\S]*?targetChangeType: "NO_CHANGE",\s*targetIds: expectedTargetIds,\s*causeCode: null,/u,
    "Only an own-property-absent Firestore targetChange type may normalize to NO_CHANGE.",
  );
  assert.match(
    frozenBaselineFixtureSource,
    /for \(const explicitInvalidTargetChangeType of \["", null, false, 0\]\) \{[\s\S]*?targetChangeType: explicitInvalidTargetChangeType,[\s\S]*?\/targetChange type was unsupported\/u,/u,
    "Explicit empty, null, false and zero Firestore targetChange types must remain rejected.",
  );
  assert.match(
    frozenBaselineFixtureSource,
    /targetChange: \{ cause: \{ code: 7 \}, targetIds: \[2\] \}[\s\S]*?\/omitted its type while declaring a cause\/u,/u,
    "A Firestore targetChange with an omitted type and an explicit cause must remain rejected.",
  );
  assert.match(
    frozenBaselineFixtureSource,
    /frozenBaselineListenerBindingNegativeFixtureCount:\s*negativeSnapshots\.length/u,
    "The frozen-baseline listener self-test output must be derived from the complete negative fixture ledger.",
  );
  assert.match(
    sourceText,
    /const frozenBaselineObservationSequenceBefore\s*=\s*\(left, right\)\s*=>\s*left\.eventSequence < right\.eventSequence \|\|\s*\(left\.eventSequence === right\.eventSequence &&\s*\(left\.frameSequence < right\.frameSequence \|\|\s*\(left\.frameSequence === right\.frameSequence &&\s*left\.withinEventSequence < right\.withinEventSequence\)\)\);/u,
    "Frozen-baseline observations must retain exact event/frame/within-event lexicographic ordering.",
  );
  const frozenBaselineReadinessSourceStart = sourceText.indexOf(
    "const readyForSettlement = () => {",
  );
  const frozenBaselineReadinessSourceEnd = sourceText.indexOf(
    "const settleAuthentication = ({ dashboardStable }) => {",
    frozenBaselineReadinessSourceStart,
  );
  assert.ok(frozenBaselineReadinessSourceStart >= 0);
  assert.ok(
    frozenBaselineReadinessSourceEnd > frozenBaselineReadinessSourceStart,
  );
  const compactFrozenBaselineReadinessSource = sourceText
    .slice(frozenBaselineReadinessSourceStart, frozenBaselineReadinessSourceEnd)
    .replace(/\s+/gu, "");
  for (const requiredReadinessFragment of [
    "if (settledDecision !== null || !eligible) return true",
    "streamFailureCount > 0",
    "parseFailureCount > 0",
    "bufferExceededCount > 0",
    "exactConsoleSequences.length > policy.consoleError.expectedCount",
    "inboundRemoveCauseCodeCount > 1",
    "removedTargetClassMatchCount > 1",
    "successorAddTargetCount > 1",
    "successorTargetAcknowledgedCount > 1",
    "unknownRemovedTargetCount > 0",
    "unboundRemovedTargetCount > 0",
    "ambiguousRemovedTargetCount > 0",
    "if (irrecoverableFailureObserved) return true",
    "pendingInitialTargetsByRequestId.size === 0",
    "exactConsoleSequences.length === policy.consoleError.expectedCount",
    "inboundRemoveCauseCodeCount === 1",
    "removedTargetClassMatchCount === 1",
    "removedTargets.length === 1",
    "removedTargets[0].removedCauseCodeSequences.length === 1",
    "successorAddTargetCount === 1",
    "successorTargetAcknowledgedCount === 1",
    "successorTargets.length === 1",
    "successorTargets[0].acknowledgementSequences.length >= 1",
  ]) {
    assert.equal(
      compactFrozenBaselineReadinessSource.includes(
        requiredReadinessFragment.replace(/\s+/gu, ""),
      ),
      true,
      `The frozen-baseline readiness contract is missing: ${requiredReadinessFragment}`,
    );
  }
  assert.match(
    sourceText,
    /const recordParseFailure\s*=\s*\(\{ bufferExceeded = false \} = \{\}\)\s*=>\s*\{\s*if \(settledDecision !== null\) return;/u,
    "Frozen-baseline parse failures must not mutate the settled semantic ledger.",
  );
  assert.match(
    sourceText,
    /const recordStreamFailure\s*=\s*\(\)\s*=>\s*\{\s*if \(settledDecision !== null\) return;/u,
    "Frozen-baseline stream failures must not mutate the settled semantic ledger.",
  );
  assert.match(
    sourceText,
    /targetChange\.targetChangeType === "REMOVE" &&\s*targetChange\.causeCode === policy\.removedCauseCode &&\s*targetChange\.targetIds\.length === 0\s*\) \{\s*inboundRemoveCauseCodeCount \+= 1;\s*unboundRemovedTargetCount \+= 1;\s*ambiguousRemovedTargetCount \+= 1;/u,
    "An empty code-7 REMOVE must be counted as unbound and ambiguous.",
  );
  assert.match(
    sourceText,
    /const arrivalSequence\s*=\s*frozenBaselineListenerBindingObserver\.reserveInboundPayloadSequence\(\);[\s\S]*?entry\.preStreamBufferedSegments\.push\(\{\s*byteLength: dataLength,\s*arrivalSequence,\s*\}\);/u,
    "Pre-stream data must reserve its event sequence before exact byte-length replay.",
  );
  assert.match(
    sourceText,
    /const shouldRecordFrozenBaselineListenTerminalStreamFailure\s*=\s*\(\{[\s\S]*?\}\)\s*=>\s*settled !== true &&\s*streamRequested !== true &&\s*\(\(method === "GET" && initialRequest !== true\) \|\|\s*\(initialRequest === true && responseGsessionid === null\)\);/u,
    "Only an unsettled pre-stream Listen terminal may increment stream failure accounting.",
  );
  assert.match(
    sourceText,
    /await drainAppCheckCdpHandlerPromises\(\);\s*let authenticationNetworkAttestationDrainDiagnostic\s*=\s*await flushNetworkAttestations\(\);\s*const listenerSettlementDeadline\s*=\s*Date\.now\(\) \+ FROZEN_BASELINE_LISTENER_SETTLEMENT_TIMEOUT_MS;\s*while \(\s*!frozenBaselineListenerBindingObserver\.readyForSettlement\(\) &&\s*Date\.now\(\) < listenerSettlementDeadline\s*\) \{\s*await new Promise\(\(resolvePoll\)\s*=>\s*setTimeout\(resolvePoll, FROZEN_BASELINE_LISTENER_SETTLEMENT_POLL_MS\),?\s*\);\s*await drainAppCheckCdpHandlerPromises\(\);\s*authenticationNetworkAttestationDrainDiagnostic\s*=\s*await flushNetworkAttestations\(\);\s*\}[\s\S]*?groupFrozenBaselineListenerRetirementDecision\s*=\s*frozenBaselineListenerBindingObserver\.settleAuthentication\(\{\s*dashboardStable:\s*true,?\s*\}\);/u,
    "Frozen-baseline listener settlement must use a bounded poll, drain and flush every poll, then settle fail-closed after readiness or timeout.",
  );
  assert.match(
    sourceText,
    /const expectedFirestoreWebChannelResourceTypeForObserver\s*=\s*\(\s*observerSurface,?\s*\)\s*=>\s*\{\s*switch \(observerSurface\) \{\s*case "cdp-request-paused":\s*return "xhr";\s*case "playwright-request":\s*return "fetch";\s*default:\s*return null;\s*\}\s*\};/u,
    "The Firestore WebChannel observer surfaces must retain their exact resource-type mapping.",
  );
  assert.match(
    sourceText,
    /const cdpAuthoritativeWebChannelRequestClass\s*=\s*classifyExactStagingFirestoreWebChannelHeaderCorrelationScope\(\{\s*requestUrl: request\.url\(\),\s*method: request\.method\(\),\s*observerSurface: "playwright-request",\s*resourceType: request\.resourceType\(\),/u,
    "The Playwright request observer must use the Playwright-only WebChannel resource type.",
  );
  assert.match(
    sourceText,
    /const exactWebChannelHeaderCorrelationClass\s*=\s*classifyExactStagingFirestoreWebChannelHeaderCorrelationScope\(\{\s*requestUrl,\s*method: requestMethod,\s*observerSurface: "cdp-request-paused",\s*resourceType: event\.resourceType,/u,
    "The CDP request handler must use the CDP-only WebChannel resource type.",
  );
  assert.match(
    sourceText,
    /const exactWebChannelTerminationLifecycleClass\s*=\s*classifyExactStagingFirestoreWebChannelTerminationLifecycleScope\(\{\s*requestUrl,\s*method: requestMethod,\s*observerSurface: "cdp-request-paused",\s*resourceType: event\.resourceType,\s*postDataPresent: postData\.length > 0,\s*redirected: Boolean\(event\.redirectedRequestId\),\s*inspection: preTransmissionInspection,/u,
    "The CDP request handler must bind Image termination classification to the exact paused request scope.",
  );
  const exactRetirementStart = sourceText.indexOf(
    "const retireExactContextClosedWebChannelAuthorizations = ({",
  );
  const exactRetirementEnd = sourceText.indexOf(
    "const missingResponseCorrelationFailureReason = ({",
    exactRetirementStart,
  );
  assert.ok(exactRetirementStart >= 0);
  assert.ok(exactRetirementEnd > exactRetirementStart);
  const exactRetirementSource = sourceText.slice(
    exactRetirementStart,
    exactRetirementEnd,
  );
  for (const requiredRetirementFragment of [
    "authorizationCoordinator.activeOwnerIds()",
    "authorizationCoordinator.activeCount()",
    "contextClosedWebChannelBackchannelRetirementDecision(decisionInput)",
    "contextClosedWebChannelSessionForwardPostRetirementDecision(",
    "contextClosedWebChannelTerminationRetirementDecision(decisionInput)",
    "const retirementEntries = activeOwnerIds.map",
    "authorizationCoordinator.complete(ownerId)",
    '"context-closed-webchannel-backchannel-retired"',
    '"context-closed-webchannel-session-forward-post-retired"',
    '"context-closed-webchannel-termination-retired"',
    "collection.delete(ownerId)",
  ]) {
    assert.equal(
      exactRetirementSource.includes(requiredRetirementFragment),
      true,
      `The context-close WebChannel retirement contract is missing: ${requiredRetirementFragment}`,
    );
  }
  assert.doesNotMatch(
    exactRetirementSource,
    /authorizationCoordinator\.revoke/u,
    "Context-close WebChannel backchannels, session forward posts, and termination images must complete, never revoke, their request-stage authorization.",
  );
  const contextClosedRetirementWrapperStart = sourceText.indexOf(
    "const retireContextClosedWebChannelAuthorizations = () =>",
  );
  const contextClosedRetirementWrapperEnd = sourceText.indexOf(
    "const resolveResponseCorrelationForEvent = (event) =>",
    contextClosedRetirementWrapperStart,
  );
  assert.ok(contextClosedRetirementWrapperStart >= 0);
  assert.ok(
    contextClosedRetirementWrapperEnd > contextClosedRetirementWrapperStart,
  );
  const contextClosedRetirementWrapperSource = sourceText.slice(
    contextClosedRetirementWrapperStart,
    contextClosedRetirementWrapperEnd,
  );
  for (const requiredWrapperFragment of [
    "const retirementCounts = retireExactContextClosedWebChannelAuthorizations(",
    "contextClosed: groupBrowserContextClosed",
    "authorizationCoordinator:",
    "allowedEgressProxyAuthorizationCoordinator",
    "pendingHandlerCount:",
    "allowedEgressHandlerTaskCoordinator.pendingCount()",
    "lifecycleByOwnerId: allowedEgressLifecycleByFetchRequestId",
    "observationsByOwnerId: allowedEgressRequestsByFetchRequestId",
    "stableOriginRewriteRequestsByFetchRequestId",
    "allowedEgressRequestsByFetchRequestId",
    "sensitiveAppCheckRequestsByFetchRequestId",
    "informationalResponseRequestsByFetchRequestId",
    "allowedEgressContextCloseSessionForwardPostRetirementCount",
    "retirementCounts.sessionForwardPostRetirementCount",
  ]) {
    assert.equal(
      contextClosedRetirementWrapperSource.includes(requiredWrapperFragment),
      true,
      `The production context-close retirement wrapper is missing: ${requiredWrapperFragment}`,
    );
  }
  assert.match(
    sourceText,
    /await context\.close\(\);\s*groupBrowserContextClosed = true;[\s\S]*?await drainAppCheckCdpHandlerPromises\(\);\s*assert\.equal\(\s*allowedEgressHandlerTaskCoordinator\.pendingCount\(\),\s*0,[\s\S]*?await flushNetworkAttestations\(\);\s*if \(frozenBaselineListenerBindingObserver\) \{[\s\S]*?entry\.responseStream\.finish\(\{\s*allowIncomplete:\s*true,?\s*\}\);[\s\S]*?frozenBaselineListenerRequestsByNetworkId\.clear\(\);\s*frozenBaselineInitialRequestIdByGsessionid\.clear\(\);\s*frozenBaselineSessionSidByGsessionid\.clear\(\);\s*const frozenBaselineListenerGroupAttestation\s*=\s*frozenBaselineListenerBindingObserver\.safeSnapshot\(\);\s*assert\.equal\(\s*frozenBaselineListenerGroupAttestation\.passed,\s*true,[\s\S]*?frozenBaselineAuthenticationAnomalyGroupAttestations\.push\(\s*frozenBaselineListenerGroupAttestation,?\s*\);[\s\S]*?retireContextClosedWebChannelAuthorizations\(\);\s*assert\.equal\(\s*allowedEgressProxyAuthorizationCoordinator\.activeCount\(\),\s*0,/u,
    "The context-close WebChannel retirement must follow close, late handler drain, network-attestation flush, and safe frozen-baseline listener finalization.",
  );
  assert.match(
    sourceText,
    /const listenerDiagnostic\s*=\s*diagnoseExactStagingFirestoreWebChannelHeaderCorrelationScope\(\{\s*requestUrl: event\.request\.url,\s*method: event\.request\.method,\s*observerSurface: "cdp-request-paused",\s*resourceType: event\.resourceType,/u,
    "The CDP request listener must use the CDP-only WebChannel resource type.",
  );
  assert.match(
    sourceText,
    /authoritativeHeaderAttestation\.resourceType,\s*expectedFirestoreWebChannelResourceTypeForObserver\(\s*"cdp-request-paused",?\s*\),/u,
    "The authoritative CDP resource type must be asserted against its observer mapping.",
  );
  assert.match(
    sourceText,
    /request\.resourceType\(\)\.toLowerCase\(\),\s*expectedFirestoreWebChannelResourceTypeForObserver\(\s*"playwright-request",?\s*\),/u,
    "The Playwright resource type must be asserted against its observer mapping.",
  );
  assert.doesNotMatch(
    sourceText,
    /authoritativeHeaderAttestation\.resourceType,\s*request\.resourceType\(\)\.toLowerCase\(\)/u,
    "CDP and Playwright resource-type labels must not be compared directly.",
  );
  assert.doesNotMatch(
    sourceText,
    /resource-type-not-xhr/u,
    "The retired single-observer WebChannel diagnostic must not remain.",
  );
  assert.match(
    sourceText,
    /const POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES\s*=\s*new Set\(\[\s*"Protocol error \(Fetch\.continueResponse\): Invalid InterceptionId\.",\s*"cdpSession\.send: Protocol error \(Fetch\.continueResponse\): Invalid InterceptionId\.",?\s*\]\);/u,
    "The already-retired interception matcher must retain exactly its two closed error messages.",
  );
  assert.match(
    sourceText,
    /const isPostFinalAlreadyRetiredInterceptionError\s*=\s*\(error\)\s*=>\s*error instanceof Error\s*&&\s*\["Error",\s*"ProtocolError"\]\.includes\(error\.name\)\s*&&\s*POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES\.has\(error\.message\);/u,
    "The already-retired interception matcher must require Error identity, an exact name, and exact Set membership.",
  );
  assert.match(
    sourceText,
    /const CONTINUE_RESPONSE_INVALID_INTERCEPTION_ERROR_MESSAGES\s*=\s*POST_FINAL_ALREADY_RETIRED_INTERCEPTION_ERROR_MESSAGES;/u,
    "The unrecovered continue-response classifier must use the same exact allowlisted messages as the recovered post-final matcher.",
  );
  const protocolClassifierStart = sourceText.indexOf(
    "const safeCdpHandlerProtocolErrorClass = (error) =>",
  );
  const protocolClassifierEnd = sourceText.indexOf(
    "const createPerCorrelationTaskCoordinator = () =>",
    protocolClassifierStart,
  );
  assert.ok(
    protocolClassifierStart >= 0 &&
      protocolClassifierEnd > protocolClassifierStart,
  );
  const protocolClassifierSource = sourceText.slice(
    protocolClassifierStart,
    protocolClassifierEnd,
  );
  assert.match(
    protocolClassifierSource,
    /CONTINUE_REQUEST_INVALID_INTERCEPTION_ERROR_MESSAGES\.has\(error\.message\)[\s\S]*return "continue-request-invalid-interception"/u,
  );
  assert.match(
    protocolClassifierSource,
    /CONTINUE_RESPONSE_INVALID_INTERCEPTION_ERROR_MESSAGES\.has\(error\.message\)[\s\S]*return "continue-response-invalid-interception"/u,
  );
  assert.match(
    protocolClassifierSource,
    /const continueResponseInvalidInterceptionLifecycleClass[\s\S]*return operation === "response-continue-final"\s*&&\s*lifecycleState === "final-response-command-in-flight"\s*\? "primary-final"\s*:\s*"other";/u,
    "Primary-final and other continue-response failures must share one exact operation-and-lifecycle predicate.",
  );
  assert.match(
    sourceText,
    /const lifecycleClass\s*=\s*continueResponseInvalidInterceptionLifecycleClass\(\{\s*protocolErrorClass,\s*operation: diagnosticContext\.operation,\s*lifecycleState: diagnosticContext\.lifecycleStateAtFailure,?\s*\}\)[\s\S]*lifecycleClass === "primary-final"\s*\? "continue-response-invalid-interception-primary-final"\s*:\s*"continue-response-invalid-interception-other"/u,
    "The safe handler histogram must use the shared continue-response lifecycle predicate.",
  );
  assert.match(
    sourceText,
    /const continueResponseInvalidInterceptionClass\s*=\s*continueResponseInvalidInterceptionLifecycleClass\(\{\s*protocolErrorClass,\s*operation: diagnosticContext\.operation,\s*lifecycleState: lifecycleStateAtFailure,?\s*\}\)[\s\S]*cdpPrimaryFinalContinueResponseInvalidInterceptionErrorCount \+=\s*Number\(primaryFinalContinueResponseInvalidInterception\)[\s\S]*cdpOtherContinueResponseInvalidInterceptionErrorCount \+= Number\(\s*continueResponseInvalidInterceptionClass === "other",?\s*\)/u,
    "The unrecovered counters must use the same continue-response lifecycle predicate as the histogram.",
  );
  const informationalBranchStart = sourceText.lastIndexOf(
    'if (responseStageDecision.kind === "informational")',
  );
  const invalidPreFinalBranchStart = sourceText.indexOf(
    'if (responseStageDecision.kind === "invalid-pre-final")',
    informationalBranchStart,
  );
  assert.ok(informationalBranchStart >= 0);
  assert.ok(invalidPreFinalBranchStart > informationalBranchStart);
  const informationalBranch = sourceText.slice(
    informationalBranchStart,
    invalidPreFinalBranchStart,
  );
  assert.match(informationalBranch, /Fetch\.continueResponse/u);
  assert.match(informationalBranch, /sanitizeBrowserResponseHeaders/u);
  assert.match(informationalBranch, /sanitizedInformational\.responseHeaders/u);
  assert.doesNotMatch(
    informationalBranch,
    /conditionalResponseHeaderRuleId/u,
    "An informational response cannot receive a request-bound conditional response-header scope.",
  );
  assert.doesNotMatch(
    informationalBranch,
    /\.delete\(|Fetch\.getResponseBody|stableOriginRewriteResponseCount|externalStaticResponseObservations\.push/u,
    "An informational response must retain request correlation and cannot finalize body/cache/rewrite observations.",
  );
  const publicRequestHandlerEnd = sourceText.indexOf(
    'appCheckCdpSession.on("Fetch.requestPaused"',
    publicRequestHandlerStart,
  );
  assert.ok(publicRequestHandlerEnd > publicRequestHandlerStart);
  const publicRequestHandlerSource = sourceText.slice(
    publicRequestHandlerStart,
    publicRequestHandlerEnd,
  );
  assert.doesNotMatch(
    publicRequestHandlerSource,
    /event\.request\.postData/u,
    "The public boundary must use only the single resolved request body.",
  );
  const publicResponseBranch = sourceText.slice(
    publicRequestHandlerStart,
    resolvedPostDataIndex,
  );
  assert.equal(
    (publicResponseBranch.match(/Fetch\.continueResponse/gu) || []).length,
    3,
  );
  assert.match(
    publicResponseBranch,
    /appCheckCdpSession\.send\(\s*"Fetch\.continueResponse",\s*postFinalErrorContinueResponseParams\(event\.requestId\),?\s*\)/u,
    "A post-final body error must continue the original response without overrides.",
  );
  assert.match(
    publicResponseBranch,
    /allowedEgressProxyAuthorizationCoordinator\.stateFor\(\s*primaryRequestId,?\s*\)[\s\S]*?"completed"/u,
    "A post-final body error must observe an already-completed proxy owner.",
  );
  assert.match(
    publicResponseBranch,
    /if\s*\(!isPostFinalAlreadyRetiredInterceptionError\(error\)\)\s*\{\s*throw error;\s*\}/u,
    "Only an exact already-retired Fetch.continueResponse error may be absorbed.",
  );
  assert.match(
    publicResponseBranch,
    /setAllowedEgressLifecycleState\(\s*primaryRequestId,\s*"post-final-error-observed-retired",?\s*\)/u,
    "An already-retired post-final observation must enter its fixed retired state.",
  );
  const primaryFinalContinueStart = publicResponseBranch.lastIndexOf(
    'diagnosticContext.operation = "response-continue-final"',
  );
  const primaryFinalContinueEnd = publicResponseBranch.indexOf(
    '"final-response-released"',
    primaryFinalContinueStart,
  );
  assert.ok(
    primaryFinalContinueStart >= 0 &&
      primaryFinalContinueEnd > primaryFinalContinueStart,
  );
  const primaryFinalContinueSource = publicResponseBranch.slice(
    primaryFinalContinueStart,
    primaryFinalContinueEnd,
  );
  assert.match(
    primaryFinalContinueSource,
    /await appCheckCdpSession\.send\("Fetch\.continueResponse"/u,
  );
  assert.doesNotMatch(
    primaryFinalContinueSource,
    /catch\s*\(/u,
    "A primary-final Fetch.continueResponse failure must propagate to the unrecovered handler path.",
  );
  assert.match(
    publicResponseBranch,
    /responseHeaders:\s*sanitizedInformational\.responseHeaders/u,
  );
  assert.match(
    publicResponseBranch,
    /responseHeaders:\s*sanitizedFinal\.responseHeaders/u,
  );
  assert.match(
    publicResponseBranch,
    /const finalConditionalResponseHeaderRuleId\s*=\s*responseStatus\s*>=\s*200\s*&&\s*responseStatus\s*<\s*300[\s\S]*allowedEgressObservation\?\.conditionalResponseHeaderRuleId[\s\S]*sanitizeBrowserResponseHeaders\([\s\S]*conditionalResponseHeaderRuleId:\s*finalConditionalResponseHeaderRuleId/u,
    "Only a successful final response may receive the exact request-bound Firestore session-header rule.",
  );
  assert.match(
    sourceText,
    /fetchedExternal\s*=\s*await\s+nodeOwnedExactExternalStaticGet\([\s\S]*source:\s*"baseline-node-network"[\s\S]*Fetch\.fulfillRequest[\s\S]*responseHeaders:\s*nodeOwnedCachedExternal\.responseHeaders,[\s\S]*body:\s*nodeOwnedCachedExternal\.body/u,
  );
  assert.doesNotMatch(sourceText, /\.connectToServer\s*\(/u);
  assert.doesNotMatch(sourceText, /deploymentBypassHeaders/u);
  assert.match(
    sourceText,
    /const canonicalHostname = canonicalNetworkHostname\(hostname\);[\s\S]*contract\.networkBoundary\.forbiddenWebHosts\.includes\(canonicalHostname\)/u,
  );
  assert.match(
    sourceText,
    /const malformedUrlEncoding = decodedValue === null;[\s\S]*!malformedUrlEncoding[\s\S]*firebaseTransportValid[\s\S]*serviceResourceBound/u,
  );
  const realtimeDatabaseBindingStart = sourceText.indexOf(
    '} else if (firebaseService === "realtime-database") {',
  );
  const hostingBindingStart = sourceText.indexOf(
    '} else if (firebaseService === "hosting") {',
    realtimeDatabaseBindingStart,
  );
  assert.ok(realtimeDatabaseBindingStart >= 0);
  assert.ok(hostingBindingStart > realtimeDatabaseBindingStart);
  const realtimeDatabaseBindingSource = sourceText.slice(
    realtimeDatabaseBindingStart,
    hostingBindingStart,
  );
  assert.match(realtimeDatabaseBindingSource, /\\\.firebaseio\\\.com/u);
  assert.doesNotMatch(
    realtimeDatabaseBindingSource,
    /firebasedatabase\.app/u,
    "Regional Realtime Database hosts must remain unbound without a configured databaseURL.",
  );
  return true;
};
const assertCaptureSafeAuthenticationSignInSourceContract = (sourceText) => {
  assert.match(
    sourceText,
    /const SAFE_AUTHENTICATION_AUTH_SIGN_IN_CODE_CLASSES = Object\.freeze\(\{[\s\S]*?\}\);/u,
    "The authentication diagnostic must retain a fixed raw-code-to-safe-class map.",
  );
  assert.match(
    sourceText,
    /"auth\/network-request-failed": "network-request"/u,
  );
  assert.match(
    sourceText,
    /"auth\/invalid-credential": "credential-rejected"/u,
  );
  assert.match(
    sourceText,
    /const SAFE_AUTHENTICATION_AUTH_SIGN_IN_ERROR_FAILURE_CLASSES = Object\.freeze\([\s\S]*`authentication-evaluate-auth-sign-in-\$\{errorClass\}-failed`/u,
    "The authentication diagnostic must derive only fixed safe failure classes.",
  );
  assert.match(
    sourceText,
    /const markerKeys = Reflect\.ownKeys\(marker\);[\s\S]*markerKeys\.some\(\(key\) => typeof key !== "string"\)[\s\S]*"attemptId,detailClass,step"/u,
    "The authentication marker must reject extra string and symbol keys.",
  );
  assert.match(
    sourceText,
    /detailClass !== null[\s\S]*step !== "auth-sign-in"[\s\S]*authSignInErrorFailureClasses/u,
    "A detailed authentication error class must be accepted only for the exact sign-in step.",
  );
  const evaluationStart = sourceText.indexOf(
    "const identity = await page.evaluate(",
  );
  const evaluationEnd = sourceText.indexOf(
    'setFailureClass("application-session-proof-registration-failed")',
    evaluationStart,
  );
  assert.ok(evaluationStart >= 0 && evaluationEnd > evaluationStart);
  const evaluationSource = sourceText.slice(evaluationStart, evaluationEnd);
  const classifierStart = evaluationSource.indexOf(
    "const classifyAuthSignInErrorClass = (error) => {",
  );
  const classifierEnd = evaluationSource.indexOf(
    "const appModule =",
    classifierStart,
  );
  assert.ok(classifierStart >= 0 && classifierEnd > classifierStart);
  const classifierSource = evaluationSource.slice(
    classifierStart,
    classifierEnd,
  );
  const orderedSteps = [
    "auth-instance",
    "auth-persistence",
    "auth-sign-in",
    "auth-state-ready",
    "auth-token-result",
    "auth-id-token",
    "session-open",
  ];
  let previousStepOffset = -1;
  for (const step of orderedSteps) {
    const stepOffset = evaluationSource.indexOf(
      `setEvaluationStep("${step}")`,
      previousStepOffset + 1,
    );
    assert.ok(
      stepOffset > previousStepOffset,
      `The authentication evaluation step order drifted at ${step}.`,
    );
    previousStepOffset = stepOffset;
  }
  const signInStart = evaluationSource.indexOf(
    'setEvaluationStep("auth-sign-in")',
  );
  const signInEnd = evaluationSource.indexOf(
    'setEvaluationStep("auth-state-ready")',
    signInStart,
  );
  assert.ok(signInStart >= 0 && signInEnd > signInStart);
  const signInSource = evaluationSource.slice(signInStart, signInEnd);
  assert.match(
    signInSource,
    /try \{[\s\S]*signInWithEmailAndPassword\([\s\S]*\} catch \(error\) \{/u,
  );
  assert.match(
    classifierSource,
    /Object\.getOwnPropertyDescriptor\(error, "code"\)/u,
  );
  assert.match(
    classifierSource,
    /Object\.getOwnPropertyDescriptor\([\s\S]*authSignInCodeClasses,[\s\S]*codeDescriptor\.value/u,
  );
  assert.match(
    classifierSource,
    /!codeDescriptor\s*\|\|[\s\S]*Object\.prototype\.hasOwnProperty\.call\(codeDescriptor, "value"\)[\s\S]*codeDescriptor\.get !== undefined[\s\S]*codeDescriptor\.set !== undefined[\s\S]*typeof codeDescriptor\.value !== "string"/u,
    "The raw Firebase code must remain an own primitive-string data property.",
  );
  assert.match(
    classifierSource,
    /!errorClassDescriptor\s*\|\|[\s\S]*Object\.prototype\.hasOwnProperty\.call\([\s\S]*errorClassDescriptor,[\s\S]*"value"[\s\S]*errorClassDescriptor\.get !== undefined[\s\S]*errorClassDescriptor\.set !== undefined[\s\S]*typeof errorClassDescriptor\.value !== "string"/u,
    "The safe class map result must remain an own primitive-string data property.",
  );
  assert.match(
    classifierSource,
    /return errorClassDescriptor\.value;/u,
    "The browser helper must return only the fixed map value.",
  );
  assert.match(
    signInSource,
    /\} catch \(error\) \{\s*setEvaluationStep\(\s*"auth-sign-in",\s*classifyAuthSignInErrorClass\(error\),?\s*\);\s*throw new Error\("VISUAL_AUTH_SIGN_IN_FAILED"\);\s*\}/u,
    "The raw Firebase error must not cross the page-evaluation boundary.",
  );
  assert.doesNotMatch(
    classifierSource,
    /error\s*\.|error\s*\[|Object\.(?:keys|values|entries|getOwnPropertyDescriptors)\(error\)|Reflect\.ownKeys\(error\)|String\(error\)|JSON\.stringify\(error\)|\.\.\.error|\{[^}]*\}\s*=\s*error|throw\s+error|cause\s*:/u,
    "The authentication diagnostic must not read or serialize raw Firebase error material.",
  );
  assert.match(
    evaluationSource,
    /authSignInCodeClasses:\s*SAFE_AUTHENTICATION_AUTH_SIGN_IN_CODE_CLASSES/u,
  );
  return true;
};
const assertCaptureProtectedReadTransportResetSourceContract = (sourceText) => {
  for (const needle of [
    "prepareExactRequestAuthorityTunnelReset",
    "retirePreparedExactRequestAuthorityTunnel",
    "attestFreshConnectForRequest",
    "activeAllowedTunnelsByRequestId",
    "preparedExactTunnelResetsByRequestId",
    "exactTunnelResetPendingForAuthority",
    "activeTunnelPresentAuthorizationObservationCount",
    "targetedTunnelRetirementObservationCount",
    "retirementCompleteSequence",
    "retirementBasis",
    "retirementBinding",
    "authorizationSingletonTunnelSequence",
    "failedLeaseConsumeSequence",
    "failedLeaseConsumedTunnelSequence",
    "resetPreparationOrderSequence",
    "retryBarrierReleaseOrderSequence",
    "assertBrowserConnectProxyExactTunnelResetPreparationInvariant",
    "exactTunnelResetPreparationMutationFixtures",
    "protectedReadConfigAttemptCount",
    "protectedReadProfileAttemptCount",
    "protectedReadRetryTargets",
    "authenticationProtectedReadTransportResetBarriersByTarget",
    "authenticationProtectedReadTransportResetBarriersByTarget.delete",
    "transportResetRecoveryAttestations",
    "duplicateTargetFixture",
    "missingProfileBarrierFixture",
    "crossTargetBarrierFixture",
    "reusedRecoveryEvidenceFixture",
    "outOfOrderBarrierFixture",
    "protectedReadWholeBrowserProcessRestartRequired",
    "W10P_PROTECTED_READ_WHOLE_BROWSER_PROCESS_RESTART_REQUIRED",
    "authentication-protected-read-issued-active-tunnel-whole-browser-process-restart-required",
    "releasedResponseStreamCensusForAuthority",
    "registerReleasedResponseStream",
    "settleReleasedResponseStream",
    "settleReleasedResponseStreamsForAuthorityTransportDrain",
    "releasedResponseStreamRegisterCount",
    "releasedResponseStreamLoadingFinishedSettlementCount",
    "releasedResponseStreamLoadingFailedSettlementCount",
    "releasedResponseStreamAuthorityTransportDrainSettlementCount",
    "releasedResponseStreamResidualAtCloseCount",
    "BROWSER_CONNECT_PROXY_CONTEXT_DRAIN_RESIDUAL_FIELDS",
    "browserConnectProxyContextDrainResidualCounts",
    "verifyBrowserConnectProxyContextDrainFixtures",
  ]) {
    assert.ok(
      sourceText.includes(needle),
      `The protected-read transport reset contract is missing ${needle}.`,
    );
  }
  assert.match(
    sourceText,
    /assert\.ok\(protectedReadAttemptCount <= 4\)/u,
    "The protected-read group must allow exactly two primary attempts and at most one retry per target.",
  );
  assert.match(
    sourceText,
    /assert\.ok\(\[1, 2\]\.includes\(attemptNumber\)\)/u,
    "Each protected-read target must remain bounded to one primary attempt and one retry.",
  );
  assert.doesNotMatch(
    sourceText,
    /protectedReadRetryUsed\s*===\s*0|authenticationProtectedReadSharedRetryTarget\b|authenticationProtectedReadTransportResetBarrier\s*=/u,
    "The per-target retry contract must not regress to a group-global retry gate or singleton barrier.",
  );
  assert.match(
    sourceText,
    /const authenticationPageErrorCount\s*=\s*authenticationBrowserErrorDeltaClassHistogram[\s\S]*?const authenticationConsoleErrorObservedCount\s*=\s*authenticationBrowserErrorDeltaClassHistogram/u,
    "Authentication page and console errors must be counted from the bounded authentication-window delta.",
  );
  assert.match(
    sourceText,
    /assert\.equal\(\s*authenticationBrowserErrorCountDelta,\s*authenticationPageErrorCount \+ authenticationConsoleErrorObservedCount,?\s*\)/u,
    "Authentication browser-error accounting must reconcile against the authentication-window delta.",
  );
  assert.match(
    sourceText,
    /authenticationProtectedReadTransportResetBarriersByTarget\.get\([\s\S]*authenticationProtectedReadTransportResetBarriersByTarget\.delete\([\s\S]*authenticationProtectedReadTransportResetBarriersByTarget\.has\([\s\S]*authenticationProtectedReadTransportResetBarriersByTarget\.set\(/u,
    "Each protected-read target must own, consume, retire, and independently register its reset barrier.",
  );
  const resetBranchStart = sourceText.indexOf(
    "const protectedReadTransportResetEligible =",
  );
  const resetBranchEnd = sourceText.indexOf(
    "const responseStatus = responseStageDecision.status;",
    resetBranchStart,
  );
  assert.ok(resetBranchStart >= 0 && resetBranchEnd > resetBranchStart);
  const resetBranchSource = sourceText.slice(resetBranchStart, resetBranchEnd);
  const resetBarrierStart = resetBranchSource.indexOf(
    "if (protectedReadTransportResetPreparation !== null)",
  );
  const prepareIndex = resetBranchSource.indexOf(
    "prepareExactRequestAuthorityTunnelReset",
  );
  assert.ok(prepareIndex >= 0 && resetBarrierStart > prepareIndex);
  assert.match(
    resetBranchSource,
    /\["issued-active-tunnel", "consumed-active-tunnel"\]\.includes\(\s*responseRecord\.proxyLeaseClass,?\s*\)/u,
  );
  assert.doesNotMatch(
    resetBranchSource,
    /authenticationProtectedReadWholeBrowserProcessRestartRequired\s*=\s*true/u,
    "A proof-bound issued-active reset must not be converted to the whole-process marker.",
  );
  assert.match(
    sourceText,
    /const SAFE_AUTHENTICATION_PROTECTED_READ_WHOLE_BROWSER_PROCESS_RESTART_ERROR\s*=\s*"W10P_PROTECTED_READ_WHOLE_BROWSER_PROCESS_RESTART_REQUIRED";/u,
  );
  const retryRestartGuardStart = sourceText.indexOf(
    "if (authenticationProtectedReadWholeBrowserProcessRestartRequired)",
  );
  const retryResetBarrierStart = sourceText.indexOf(
    "authenticationProtectedReadTransportResetBarriersByTarget.get(",
    retryRestartGuardStart,
  );
  assert.ok(
    retryRestartGuardStart >= 0 &&
      retryResetBarrierStart > retryRestartGuardStart,
  );
  const retryRestartGuardSource = sourceText.slice(
    retryRestartGuardStart,
    retryResetBarrierStart,
  );
  assert.match(
    retryRestartGuardSource,
    /diagnosticContext\.reason\s*=\s*"protected-read-whole-browser-process-restart-required"[\s\S]*throw new Error\(\s*SAFE_AUTHENTICATION_PROTECTED_READ_WHOLE_BROWSER_PROCESS_RESTART_ERROR,?\s*\)/u,
    "Attempt two must fail under the same fixed whole-browser-process restart marker before any reset barrier is read.",
  );
  assert.match(
    sourceText,
    /collectAuthenticationProtectedReadAttemptDiagnostic:\s*\(\)\s*=>\s*\(\{[\s\S]*wholeBrowserProcessRestartRequired:\s*authenticationProtectedReadWholeBrowserProcessRestartRequired[\s\S]*\}\)/u,
    "The bounded authentication collector must expose only the fixed restart-required boolean.",
  );
  assert.match(
    sourceText,
    /if \(protectedReadAttemptDiagnostic\.wholeBrowserProcessRestartRequired\) \{\s*failureClass\s*=\s*SAFE_AUTHENTICATION_PROTECTED_READ_RETRY_FAILURE_CLASSES\.wholeBrowserProcessRestartRequired;\s*\}/u,
    "Authentication failure serialization must override to the fixed restart-required class.",
  );
  const safeFailureDiagnosticStart = sourceText.indexOf(
    "const createSafeAuthenticationFailureDiagnostic = ({",
  );
  const safeFailureDiagnosticEnd = sourceText.indexOf(
    "const serializeSafeAuthenticationFailure = (",
    safeFailureDiagnosticStart,
  );
  assert.ok(
    safeFailureDiagnosticStart >= 0 &&
      safeFailureDiagnosticEnd > safeFailureDiagnosticStart,
  );
  const safeFailureDiagnosticSource = sourceText.slice(
    safeFailureDiagnosticStart,
    safeFailureDiagnosticEnd,
  );
  assert.match(
    safeFailureDiagnosticSource,
    /retryTargets[\s\S]*wholeBrowserProcessRestartRequired[\s\S]*protectedReadWholeBrowserProcessRestartRequired !==\s*\(failureClass ===\s*SAFE_AUTHENTICATION_PROTECTED_READ_RETRY_FAILURE_CLASSES\.wholeBrowserProcessRestartRequired\)[\s\S]*schemaVersion:\s*4[\s\S]*protectedReadRetryTargets[\s\S]*protectedReadWholeBrowserProcessRestartRequired/u,
    "The schema-4 safe failure diagnostic must bind per-target retry evidence and its restart boolean iff the fixed failure class is selected.",
  );
  const completeIndex = resetBranchSource.indexOf(
    "completeProxyAuthorization();",
    prepareIndex,
  );
  const failIndex = resetBranchSource.indexOf(
    'appCheckCdpSession.send("Fetch.failRequest"',
    completeIndex,
  );
  const retireIndex = resetBranchSource.indexOf(
    "retirePreparedExactRequestAuthorityTunnel",
    failIndex,
  );
  assert.ok(
    prepareIndex >= 0 &&
      completeIndex > prepareIndex &&
      failIndex > completeIndex &&
      retireIndex > failIndex,
    "Both active-tunnel lease classes must prepare, complete, locally fail, and retire in fixed order.",
  );
  assert.doesNotMatch(
    resetBranchSource.slice(prepareIndex, completeIndex),
    /\bawait\b/u,
    "Issued reset preparation and authorization completion must remain in the same synchronous turn.",
  );
  const retirementDrainOrderIndex = resetBranchSource.indexOf(
    "const retirementDrainCompletionOrderSequence =",
    retireIndex,
  );
  const retryBarrierReleaseOrderIndex = resetBranchSource.indexOf(
    "const retryBarrierReleaseOrderSequence =",
    retirementDrainOrderIndex,
  );
  const retryBarrierResolveIndex = resetBranchSource.indexOf(
    "protectedReadTransportResetBarrier.resolve(",
    retryBarrierReleaseOrderIndex,
  );
  assert.ok(
    retirementDrainOrderIndex > retireIndex &&
      retryBarrierReleaseOrderIndex > retirementDrainOrderIndex &&
      retryBarrierResolveIndex > retryBarrierReleaseOrderIndex,
    "Retirement drain evidence must settle before the retry barrier is released.",
  );
  const retryBarrierIndex = sourceText.indexOf(
    "const resetAttestation = await resetBarrier.promise;",
  );
  const retryLifecycleIndex = sourceText.indexOf(
    "recordAllowedEgressRequestStageLifecycle(event, diagnosticContext.phase);",
    retryBarrierIndex,
  );
  const retryAuthorizeIndex = sourceText.indexOf(
    "allowedEgressProxyAuthorizationCoordinator.authorize(event.requestId",
    retryLifecycleIndex,
  );
  assert.ok(
    retryBarrierIndex >= 0 &&
      retryLifecycleIndex > retryBarrierIndex &&
      retryAuthorizeIndex > retryLifecycleIndex,
    "The retry request must remain paused until reset drain completes before a fresh lease is issued.",
  );
  assert.match(
    sourceText,
    /assert\.equal\(lease\.state, "consumed"\)[\s\S]*assert\.equal\(lease\.consumedTunnelSequence, tunnel\.tunnelSequence\)/u,
  );
  const primaryFinalOperationIndex = sourceText.lastIndexOf(
    'diagnosticContext.operation = "response-continue-final";',
  );
  const primaryFinalLifecycleIndex = sourceText.lastIndexOf(
    '"final-response-command-in-flight"',
    primaryFinalOperationIndex,
  );
  const primaryFinalLifecycleCallIndex = sourceText.lastIndexOf(
    "setAllowedEgressLifecycleState(",
    primaryFinalLifecycleIndex,
  );
  const primaryFinalReleaseIndex = sourceText.indexOf(
    '"final-response-released"',
    primaryFinalOperationIndex,
  );
  assert.ok(
    primaryFinalLifecycleCallIndex >= 0 &&
      primaryFinalLifecycleIndex > primaryFinalLifecycleCallIndex &&
      primaryFinalOperationIndex > primaryFinalLifecycleIndex &&
      primaryFinalReleaseIndex > primaryFinalOperationIndex,
  );
  const primaryFinalHandlerSource = sourceText.slice(
    primaryFinalLifecycleCallIndex,
    primaryFinalReleaseIndex,
  );
  assert.equal(
    (
      primaryFinalHandlerSource.match(
        /browserConnectProxy\.registerReleasedResponseStream\(\{/gu,
      ) || []
    ).length,
    1,
  );
  assert.match(
    primaryFinalHandlerSource,
    /browserConnectProxy\.registerReleasedResponseStream\(\{\s*requestId: primaryRequestId,\s*networkId: lifecycle\.networkId,\s*stage,?\s*\}\);/u,
    "The primary-final handler must register its exact lifecycle network identity, not merely expose the proxy method definition.",
  );
  const primaryFinalRegisterIndex = primaryFinalHandlerSource.indexOf(
    "browserConnectProxy.registerReleasedResponseStream({",
  );
  const primaryFinalContinueIndex = primaryFinalHandlerSource.indexOf(
    'appCheckCdpSession.send("Fetch.continueResponse"',
  );
  assert.ok(
    primaryFinalRegisterIndex >
      primaryFinalHandlerSource.indexOf('"final-response-command-in-flight"') &&
      primaryFinalContinueIndex > primaryFinalRegisterIndex,
    "The released stream registration must occur after the primary-final lifecycle transition and before Fetch.continueResponse.",
  );
  assert.match(
    sourceText,
    /Network\.loadingFinished[\s\S]*settleReleasedResponseStream[\s\S]*terminalClass: "loading-finished"/u,
  );
  assert.match(
    sourceText,
    /Network\.loadingFailed[\s\S]*settleReleasedResponseStream[\s\S]*terminalClass: "loading-failed"/u,
  );
  const authorityDrainHelperStart = sourceText.indexOf(
    "const settleReleasedResponseStreamsForAuthorityTransportDrain = (",
  );
  const authorityDrainHelperEnd = sourceText.indexOf(
    "const removeLeaseFromQueue = (lease) =>",
    authorityDrainHelperStart,
  );
  assert.ok(
    authorityDrainHelperStart >= 0 &&
      authorityDrainHelperEnd > authorityDrainHelperStart,
  );
  const authorityDrainHelperSource = sourceText.slice(
    authorityDrainHelperStart,
    authorityDrainHelperEnd,
  );
  assert.match(
    authorityDrainHelperSource,
    /const activeAuthorityTunnelCount\s*=\s*activeAllowedTunnelCounts\.get\(authority\) \|\| 0;[\s\S]*const activeAuthorityTunnelBindings\s*=\s*\[[\s\S]*activeAllowedTunnelsByRequestId\.values\(\)[\s\S]*\.filter\(\(tunnel\) => tunnel\.authority === authority\);[\s\S]*assert\.equal\(\s*activeAuthorityTunnelCount,\s*activeAuthorityTunnelBindings\.length,[\s\S]*if \(activeAuthorityTunnelCount !== 0\) return 0;/u,
    "Authority transport settlement must require both the count and exact request-binding census to be zero.",
  );
  assert.match(
    authorityDrainHelperSource,
    /for \(const \[networkId, stream\] of releasedResponseStreamsByNetworkId\)[\s\S]*assert\.equal\(stream\.networkId, networkId\);[\s\S]*assert\.equal\(stream\.state, "released-nonterminal"\);[\s\S]*if \(stream\.authority === authority\) \{\s*settlementEntries\.push\(\[networkId, stream\]\);\s*\}/u,
    "Authority transport settlement must validate every stream record before selecting the exact authority.",
  );
  assert.match(
    authorityDrainHelperSource,
    /assert\.equal\(releasedResponseStreamsByNetworkId\.get\(networkId\), stream\);\s*assert\.equal\(releasedResponseStreamsByNetworkId\.delete\(networkId\), true\);\s*stats\.releasedResponseStreamAuthorityTransportDrainSettlementCount \+= 1;/u,
    "Authority transport settlement must count only successful exact map deletions.",
  );
  assert.doesNotMatch(
    authorityDrainHelperSource,
    /\.clear\(|\.destroy\(|prepareExactRequestAuthorityTunnelReset|retirePreparedExactRequestAuthorityTunnel/u,
    "Authority transport settlement must not clear unknown streams or destroy/reset sockets.",
  );
  const upstreamCloseStart = sourceText.indexOf(
    'upstreamSocket.once("close", () => {',
  );
  const upstreamCloseEnd = sourceText.indexOf(
    'upstreamSocket.once("error", (error) => {',
    upstreamCloseStart,
  );
  assert.ok(upstreamCloseStart >= 0 && upstreamCloseEnd > upstreamCloseStart);
  const upstreamCloseSource = sourceText.slice(
    upstreamCloseStart,
    upstreamCloseEnd,
  );
  const upstreamBindingDeleteIndex = upstreamCloseSource.indexOf(
    "activeAllowedTunnelsByRequestId.delete(allowedTunnel.requestId)",
  );
  const upstreamCountDeleteIndex = upstreamCloseSource.indexOf(
    "activeAllowedTunnelCounts.delete(allowedAuthority)",
  );
  const upstreamAuthorityDrainSettleIndex = upstreamCloseSource.indexOf(
    "settleReleasedResponseStreamsForAuthorityTransportDrain(allowedAuthority)",
  );
  assert.ok(
    upstreamBindingDeleteIndex >= 0 &&
      upstreamCountDeleteIndex > upstreamBindingDeleteIndex &&
      upstreamAuthorityDrainSettleIndex > upstreamCountDeleteIndex,
    "The upstream close callback must retire tunnel count/binding state before authority stream settlement.",
  );
  const proxyRegisterStart = sourceText.indexOf(
    "registerReleasedResponseStream({ requestId, networkId, stage }) {",
  );
  const proxyRegisterEnd = sourceText.indexOf(
    "settleReleasedResponseStream({ networkId, terminalClass }) {",
    proxyRegisterStart,
  );
  assert.ok(proxyRegisterStart >= 0 && proxyRegisterEnd > proxyRegisterStart);
  const proxyRegisterSource = sourceText.slice(
    proxyRegisterStart,
    proxyRegisterEnd,
  );
  const proxyRegisterMapSetIndex = proxyRegisterSource.indexOf(
    "releasedResponseStreamsByNetworkId.set(",
  );
  const proxyRegisterCountIndex = proxyRegisterSource.indexOf(
    "stats.releasedResponseStreamRegisterCount += 1",
  );
  const proxyRegisterAuthorityDrainIndex = proxyRegisterSource.indexOf(
    "settleReleasedResponseStreamsForAuthorityTransportDrain(",
  );
  assert.ok(
    proxyRegisterMapSetIndex >= 0 &&
      proxyRegisterCountIndex > proxyRegisterMapSetIndex &&
      proxyRegisterAuthorityDrainIndex > proxyRegisterCountIndex,
    "Registration must account the stream before closing the transport-close-before-register race.",
  );
  const proxySettleStart = proxyRegisterEnd;
  const proxySettleEnd = sourceText.indexOf(
    "prepareExactRequestAuthorityTunnelReset({",
    proxySettleStart,
  );
  assert.ok(proxySettleEnd > proxySettleStart);
  const proxySettleSource = sourceText.slice(proxySettleStart, proxySettleEnd);
  assert.match(
    proxySettleSource,
    /assert\.equal\(releasedResponseStreamsByNetworkId\.delete\(networkId\), true\);\s*if \(terminalClass === "loading-finished"\) \{\s*stats\.releasedResponseStreamLoadingFinishedSettlementCount \+= 1;\s*\} else \{\s*stats\.releasedResponseStreamLoadingFailedSettlementCount \+= 1;\s*\}/u,
    "CDP terminal counters must increment only after the exact stream deletion.",
  );
  assert.match(
    sourceText,
    /const releasedResponseStreamResidualCount\s*=\s*releasedResponseStreamsByNetworkId\.size;\s*assert\.equal\(\s*stats\.releasedResponseStreamRegisterCount,\s*stats\.releasedResponseStreamLoadingFinishedSettlementCount \+\s*stats\.releasedResponseStreamLoadingFailedSettlementCount \+\s*stats\.releasedResponseStreamAuthorityTransportDrainSettlementCount \+\s*releasedResponseStreamResidualCount \+\s*stats\.releasedResponseStreamResidualAtCloseCount,[\s\S]*schemaVersion: 5,/u,
    "The proxy snapshot must enforce exact released-stream accounting before emitting schema 5.",
  );
  const proxyCloseStart = sourceText.indexOf("    async close() {");
  const proxyCloseEnd = sourceText.indexOf(
    "    setAuditStage(stage) {",
    proxyCloseStart,
  );
  assert.ok(proxyCloseStart >= 0 && proxyCloseEnd > proxyCloseStart);
  const proxyCloseSource = sourceText.slice(proxyCloseStart, proxyCloseEnd);
  const residualAtCloseIndex = proxyCloseSource.indexOf(
    "stats.releasedResponseStreamResidualAtCloseCount =",
  );
  const releasedStreamClearIndex = proxyCloseSource.indexOf(
    "releasedResponseStreamsByNetworkId.clear()",
  );
  const proxyCloseSocketDestroyIndex =
    proxyCloseSource.indexOf("socket.destroy()");
  assert.ok(
    residualAtCloseIndex >= 0 &&
      releasedStreamClearIndex > residualAtCloseIndex &&
      proxyCloseSocketDestroyIndex > releasedStreamClearIndex,
    "Proxy close must preserve residual-at-close evidence before clear and socket destruction.",
  );
  const contextDrainFieldsStart = sourceText.indexOf(
    "const BROWSER_CONNECT_PROXY_CONTEXT_DRAIN_RESIDUAL_FIELDS = Object.freeze([",
  );
  const contextDrainWaitStart = sourceText.indexOf(
    "const waitForBrowserConnectProxyContextDrain = async ({",
    contextDrainFieldsStart,
  );
  const contextDrainFixtureStart = sourceText.indexOf(
    "const verifyBrowserConnectProxyContextDrainFixtures = async () =>",
    contextDrainWaitStart,
  );
  assert.ok(
    contextDrainFieldsStart >= 0 &&
      contextDrainWaitStart > contextDrainFieldsStart &&
      contextDrainFixtureStart > contextDrainWaitStart,
  );
  const contextDrainFieldsSource = sourceText.slice(
    contextDrainFieldsStart,
    contextDrainWaitStart,
  );
  const expectedContextDrainResidualFields = [
    "requestStageAuthorizationResidualCount",
    "authorityLeaseResidualCount",
    "authorityLeaseQueueResidualCount",
    "activeAllowedTunnelResidualCount",
    "activeAllowedTunnelRequestBindingResidualCount",
    "preparedExactTunnelResetResidualCount",
    "releasedResponseStreamResidualCount",
  ];
  const contextDrainFieldListEnd = sourceText.indexOf(
    "]);",
    contextDrainFieldsStart,
  );
  assert.ok(
    contextDrainFieldListEnd > contextDrainFieldsStart &&
      contextDrainFieldListEnd < contextDrainWaitStart,
  );
  const contextDrainFieldListSource = sourceText.slice(
    contextDrainFieldsStart,
    contextDrainFieldListEnd,
  );
  assert.deepEqual(
    [...contextDrainFieldListSource.matchAll(/^\s*"([^"]+)",$/gmu)].map(
      ([, field]) => field,
    ),
    expectedContextDrainResidualFields,
    "The context-drain timeout vector must retain exactly seven count-only keys in fixed order.",
  );
  for (const field of expectedContextDrainResidualFields) {
    assert.equal(
      (contextDrainFieldsSource.match(new RegExp(`"${field}"`, "gu")) || [])
        .length,
      1,
      `The context-drain count-only vector must contain ${field} exactly once.`,
    );
  }
  const contextDrainWaitSource = sourceText.slice(
    contextDrainWaitStart,
    contextDrainFixtureStart,
  );
  const contextDrainSnapshotIndex = contextDrainWaitSource.indexOf(
    "const snapshot = proxy.snapshot();",
  );
  const contextDrainResidualIndex = contextDrainWaitSource.indexOf(
    "browserConnectProxyContextDrainResidualCounts(snapshot)",
  );
  const contextDrainDrainedIndex = contextDrainWaitSource.indexOf(
    "const drained = Object.values(residualCounts).every",
  );
  const contextDrainReturnIndex = contextDrainWaitSource.indexOf(
    "if (drained) return snapshot;",
  );
  const contextDrainDeadlineReadIndex = contextDrainWaitSource.indexOf(
    "const observedAt = nowMilliseconds();",
  );
  assert.ok(
    contextDrainSnapshotIndex >= 0 &&
      contextDrainResidualIndex > contextDrainSnapshotIndex &&
      contextDrainDrainedIndex > contextDrainResidualIndex &&
      contextDrainReturnIndex > contextDrainDrainedIndex &&
      contextDrainDeadlineReadIndex > contextDrainReturnIndex,
    "A zero context-drain snapshot must return before the post-snapshot deadline read.",
  );
  assert.match(
    contextDrainWaitSource,
    /Residual counts: \$\{JSON\.stringify\(residualCounts\)\}/u,
    "A real context-drain timeout must expose only the fixed count vector.",
  );
  const contextDrainFixtureEnd = sourceText.indexOf(
    "const sendLoopbackProxyFixtureRequest =",
    contextDrainFixtureStart,
  );
  assert.ok(contextDrainFixtureEnd > contextDrainFixtureStart);
  const contextDrainFixtureSource = sourceText.slice(
    contextDrainFixtureStart,
    contextDrainFixtureEnd,
  );
  assert.match(contextDrainFixtureSource, /zero-after-deadline/u);
  assert.match(
    contextDrainFixtureSource,
    /releasedResponseStreamResidualCount: 1/u,
  );
  assert.match(contextDrainFixtureSource, /await assert\.rejects\(/u);
  const proxyResetStart = sourceText.indexOf(
    "prepareExactRequestAuthorityTunnelReset({",
  );
  const proxyResetEnd = sourceText.indexOf(
    "attestFreshConnectForRequest({",
    proxyResetStart,
  );
  assert.ok(proxyResetStart >= 0 && proxyResetEnd > proxyResetStart);
  const proxyResetSource = sourceText.slice(proxyResetStart, proxyResetEnd);
  assert.doesNotMatch(
    proxyResetSource,
    /requestBound|creatorLeaseGenerationBound/u,
    "Issued-active retirement must not claim failed-request or creator-generation binding.",
  );
  assert.match(
    proxyResetSource,
    /schemaVersion:\s*3[\s\S]*retirementBasis[\s\S]*retirementBinding/u,
  );
  const resetInvariantStart = sourceText.indexOf(
    "const assertBrowserConnectProxyExactTunnelResetPreparationInvariant = ({",
  );
  const resetInvariantEnd = sourceText.indexOf(
    "const createBrowserConnectProxyGate = ({",
    resetInvariantStart,
  );
  assert.ok(
    resetInvariantStart >= 0 && resetInvariantEnd > resetInvariantStart,
  );
  const resetInvariantSource = sourceText.slice(
    resetInvariantStart,
    resetInvariantEnd,
  );
  assert.match(
    resetInvariantSource,
    /preparedResetCount, 0[\s\S]*sameAuthorityAuthorizations\.length, 1[\s\S]*authorityTunnels\.length, 1/u,
  );
  assert.match(
    resetInvariantSource,
    /failedLeaseClass === "issued-active-tunnel"[\s\S]*assert\.notEqual\(tunnel\.requestId, requestId\)[\s\S]*lease\.consumedAt, null[\s\S]*lease\.consumeSequence, null[\s\S]*lease\.consumedTunnelSequence, null[\s\S]*activeTunnelBindingsAtAuthorization\[0\][\s\S]*browserConnectProxyTunnelIdentity\(tunnel\)/u,
  );
  assert.match(
    resetInvariantSource,
    /tunnel\.leaseConsumeSequence < lease\.issueSequence/u,
  );
  assert.match(
    resetInvariantSource,
    /failedLeaseClass, "consumed-active-tunnel"[\s\S]*assert\.equal\(tunnel\.requestId, requestId\)[\s\S]*lease\.consumedTunnelSequence, tunnel\.tunnelSequence[\s\S]*lease\.issueSequence, tunnel\.leaseIssueSequence[\s\S]*lease\.consumeSequence, tunnel\.leaseConsumeSequence/u,
  );
  assert.equal(
    (proxyResetSource.match(/releasedResponseStreamCensusForAuthority/gu) || [])
      .length,
    2,
  );
  assert.match(
    proxyResetSource,
    /const releasedResponseStreamCensusAtPreparation\s*=\s*releasedResponseStreamCensusForAuthority\(\s*authorization\.authority,?\s*\);/u,
    "Reset preparation must census the failed authorization's exact authority.",
  );
  assert.match(
    proxyResetSource,
    /const releasedResponseStreamCensusBeforeRetirement\s*=\s*releasedResponseStreamCensusForAuthority\(\s*authority,?\s*\);[\s\S]*tunnel\.clientSocket\.destroy\(\)/u,
    "The pre-destroy census must use the prepared reset authority.",
  );
  assert.match(
    proxyResetSource,
    /releasedResponseStreamCensusAtPreparation[\s\S]*nonterminalCount: 0[\s\S]*unknownOrUnboundCount: 0/u,
  );
  assert.match(
    proxyResetSource,
    /releasedResponseStreamCensusBeforeRetirement[\s\S]*nonterminalCount: 0[\s\S]*unknownOrUnboundCount: 0[\s\S]*tunnel\.clientSocket\.destroy\(\)/u,
  );
  assert.match(
    proxyResetSource,
    /tunnel\.clientSocket\.destroy\(\);\s*tunnel\.upstreamSocket\.destroy\(\);[\s\S]*otherAuthorityTunnelRetirementCount:\s*0[\s\S]*otherAuthorityTunnelTargetingExcluded:\s*true/u,
  );
  return true;
};
const assertProtectedReadTransportResetLeaseSequenceInvariant = ({
  failedLeaseClass,
  failedLeaseIssueSequence,
  failedLeaseConsumeSequence,
  failedLeaseConsumedTunnelSequence,
  creatorLeaseIssueSequence,
  creatorLeaseConsumeSequence,
  authorizationSingletonTunnelSequence,
  retiredTunnelSequence,
  retirementCompleteSequence,
  resetPreparationOrderSequence,
  failedAuthorizationCompletionOrderSequence,
  localFailRequestCompletionOrderSequence,
  retirementDrainCompletionOrderSequence,
  retryBarrierReleaseOrderSequence,
  releasedResponseStreamNonterminalCountAtPreparation,
  releasedResponseStreamNonterminalCountBeforeRetirement,
  releasedResponseStreamUnknownOrUnboundCountAtPreparation,
  releasedResponseStreamUnknownOrUnboundCountBeforeRetirement,
}) => {
  assert.ok(
    ["issued-active-tunnel", "consumed-active-tunnel"].includes(
      failedLeaseClass,
    ),
  );
  for (const value of [
    failedLeaseIssueSequence,
    creatorLeaseIssueSequence,
    creatorLeaseConsumeSequence,
    retiredTunnelSequence,
    retirementCompleteSequence,
    resetPreparationOrderSequence,
    failedAuthorizationCompletionOrderSequence,
    localFailRequestCompletionOrderSequence,
    retirementDrainCompletionOrderSequence,
    retryBarrierReleaseOrderSequence,
  ]) {
    assert.equal(Number.isSafeInteger(value), true);
    assert.ok(value > 0);
  }
  if (failedLeaseClass === "issued-active-tunnel") {
    assert.equal(failedLeaseConsumeSequence, null);
    assert.equal(failedLeaseConsumedTunnelSequence, null);
    assert.equal(authorizationSingletonTunnelSequence, retiredTunnelSequence);
    assert.ok(creatorLeaseConsumeSequence < failedLeaseIssueSequence);
  } else {
    assert.equal(failedLeaseIssueSequence, creatorLeaseIssueSequence);
    assert.equal(failedLeaseConsumeSequence, creatorLeaseConsumeSequence);
    assert.equal(failedLeaseConsumedTunnelSequence, retiredTunnelSequence);
    assert.equal(authorizationSingletonTunnelSequence, null);
  }
  assert.ok(creatorLeaseIssueSequence < creatorLeaseConsumeSequence);
  assert.ok(creatorLeaseConsumeSequence < retirementCompleteSequence);
  assert.ok(failedLeaseIssueSequence < retirementCompleteSequence);
  assert.ok(
    resetPreparationOrderSequence < failedAuthorizationCompletionOrderSequence,
  );
  assert.ok(
    failedAuthorizationCompletionOrderSequence <
      localFailRequestCompletionOrderSequence,
  );
  assert.ok(
    localFailRequestCompletionOrderSequence <
      retirementDrainCompletionOrderSequence,
  );
  assert.ok(
    retirementDrainCompletionOrderSequence < retryBarrierReleaseOrderSequence,
  );
  for (const value of [
    releasedResponseStreamNonterminalCountAtPreparation,
    releasedResponseStreamNonterminalCountBeforeRetirement,
    releasedResponseStreamUnknownOrUnboundCountAtPreparation,
    releasedResponseStreamUnknownOrUnboundCountBeforeRetirement,
  ]) {
    assert.equal(value, 0);
  }
};
const verifyProtectedReadTransportResetLeaseSequenceFixtures = () => {
  const validFixtures = [
    {
      failedLeaseClass: "issued-active-tunnel",
      creatorLeaseIssueSequence: 1,
      creatorLeaseConsumeSequence: 2,
      failedLeaseIssueSequence: 3,
      failedLeaseConsumeSequence: null,
      failedLeaseConsumedTunnelSequence: null,
      authorizationSingletonTunnelSequence: 1,
      retiredTunnelSequence: 1,
      retirementCompleteSequence: 4,
      resetPreparationOrderSequence: 1,
      failedAuthorizationCompletionOrderSequence: 2,
      localFailRequestCompletionOrderSequence: 3,
      retirementDrainCompletionOrderSequence: 4,
      retryBarrierReleaseOrderSequence: 5,
      releasedResponseStreamNonterminalCountAtPreparation: 0,
      releasedResponseStreamNonterminalCountBeforeRetirement: 0,
      releasedResponseStreamUnknownOrUnboundCountAtPreparation: 0,
      releasedResponseStreamUnknownOrUnboundCountBeforeRetirement: 0,
    },
    {
      failedLeaseClass: "consumed-active-tunnel",
      creatorLeaseIssueSequence: 1,
      failedLeaseIssueSequence: 1,
      creatorLeaseConsumeSequence: 2,
      failedLeaseConsumeSequence: 2,
      failedLeaseConsumedTunnelSequence: 1,
      authorizationSingletonTunnelSequence: null,
      retiredTunnelSequence: 1,
      retirementCompleteSequence: 3,
      resetPreparationOrderSequence: 1,
      failedAuthorizationCompletionOrderSequence: 2,
      localFailRequestCompletionOrderSequence: 3,
      retirementDrainCompletionOrderSequence: 4,
      retryBarrierReleaseOrderSequence: 5,
      releasedResponseStreamNonterminalCountAtPreparation: 0,
      releasedResponseStreamNonterminalCountBeforeRetirement: 0,
      releasedResponseStreamUnknownOrUnboundCountAtPreparation: 0,
      releasedResponseStreamUnknownOrUnboundCountBeforeRetirement: 0,
    },
  ];
  for (const fixture of validFixtures) {
    assert.doesNotThrow(() =>
      assertProtectedReadTransportResetLeaseSequenceInvariant(fixture),
    );
  }
  const invalidFixtures = [
    {
      ...validFixtures[0],
      failedLeaseConsumeSequence: 2,
    },
    {
      ...validFixtures[0],
      authorizationSingletonTunnelSequence: 2,
    },
    {
      ...validFixtures[0],
      releasedResponseStreamNonterminalCountAtPreparation: 1,
    },
    {
      ...validFixtures[0],
      failedLeaseIssueSequence: validFixtures[0].creatorLeaseConsumeSequence,
    },
    {
      ...validFixtures[0],
      retryBarrierReleaseOrderSequence:
        validFixtures[0].retirementDrainCompletionOrderSequence,
    },
    {
      ...validFixtures[1],
      failedLeaseConsumedTunnelSequence: 2,
    },
  ];
  for (const fixture of invalidFixtures) {
    assert.throws(() =>
      assertProtectedReadTransportResetLeaseSequenceInvariant(fixture),
    );
  }
  return {
    protectedReadTransportResetLeaseSequenceAcceptedFixtureCount:
      validFixtures.length,
    protectedReadTransportResetLeaseSequenceRejectedFixtureCount:
      invalidFixtures.length,
  };
};
const assertBrowserConnectProxyTransportResetObservationConsistency = ({
  activeTunnelPresentAtAuthorizationCount,
  targetedTunnelRetirementSuccessCount,
  requestStageAuthorizationObservations,
  targetedTunnelRetirementObservations,
  authenticationProtectedReadRetryAttestations,
}) => {
  for (const count of [
    activeTunnelPresentAtAuthorizationCount,
    targetedTunnelRetirementSuccessCount,
  ]) {
    assert.equal(Number.isSafeInteger(count), true);
    assert.ok(count >= 0);
  }
  for (const observations of [
    requestStageAuthorizationObservations,
    targetedTunnelRetirementObservations,
    authenticationProtectedReadRetryAttestations,
  ]) {
    assert.equal(Array.isArray(observations), true);
  }
  for (const attestation of authenticationProtectedReadRetryAttestations) {
    assert.ok(["baseline", "candidate"].includes(attestation?.stage));
    assert.equal(Number.isSafeInteger(attestation?.retryUsed), true);
    assert.ok([0, 1, 2].includes(attestation.retryUsed));
  }
  const activeTunnelPresentAuthorizationObservationCount =
    requestStageAuthorizationObservations
      .filter(
        (observation) =>
          observation.kind === "authority-lease-active-tunnel-present",
      )
      .reduce((total, observation) => total + observation.count, 0);
  const targetedTunnelRetirementObservationCount =
    targetedTunnelRetirementObservations.reduce(
      (total, observation) => total + observation.count,
      0,
    );
  assert.equal(
    activeTunnelPresentAtAuthorizationCount,
    activeTunnelPresentAuthorizationObservationCount,
  );
  assert.ok(
    activeTunnelPresentAtAuthorizationCount >=
      targetedTunnelRetirementSuccessCount,
  );
  assert.ok(
    activeTunnelPresentAtAuthorizationCount >=
      targetedTunnelRetirementObservationCount,
  );
  assert.equal(
    targetedTunnelRetirementSuccessCount,
    targetedTunnelRetirementObservationCount,
  );
  for (const stage of ["baseline", "candidate"]) {
    const observedStageRetirementCount = targetedTunnelRetirementObservations
      .filter((observation) => observation.stage === stage)
      .reduce((total, observation) => total + observation.count, 0);
    const expectedStageRetirementCount =
      authenticationProtectedReadRetryAttestations
        .filter((attestation) => attestation.stage === stage)
        .reduce((total, attestation) => total + attestation.retryUsed, 0);
    assert.equal(observedStageRetirementCount, expectedStageRetirementCount);
  }
};
const verifyBrowserConnectProxyTransportResetObservationFixtures = () => {
  const validFixture = {
    activeTunnelPresentAtAuthorizationCount: 2,
    targetedTunnelRetirementSuccessCount: 1,
    requestStageAuthorizationObservations: [
      {
        stage: "baseline",
        kind: "authority-lease-active-tunnel-present",
        count: 1,
      },
      {
        stage: "candidate",
        kind: "authority-lease-active-tunnel-present",
        count: 1,
      },
      {
        stage: "baseline",
        kind: "authority-lease-no-active-tunnel",
        count: 3,
      },
    ],
    targetedTunnelRetirementObservations: [{ stage: "baseline", count: 1 }],
    authenticationProtectedReadRetryAttestations: [
      { stage: "baseline", retryUsed: 1 },
      { stage: "candidate", retryUsed: 0 },
    ],
  };
  const dualRetryValidFixture = {
    activeTunnelPresentAtAuthorizationCount: 3,
    targetedTunnelRetirementSuccessCount: 2,
    requestStageAuthorizationObservations: [
      {
        stage: "baseline",
        kind: "authority-lease-active-tunnel-present",
        count: 2,
      },
      {
        stage: "candidate",
        kind: "authority-lease-active-tunnel-present",
        count: 1,
      },
    ],
    targetedTunnelRetirementObservations: [{ stage: "baseline", count: 2 }],
    authenticationProtectedReadRetryAttestations: [
      { stage: "baseline", retryUsed: 2 },
      { stage: "candidate", retryUsed: 0 },
    ],
  };
  const validFixtures = [validFixture, dualRetryValidFixture];
  for (const fixture of validFixtures) {
    assert.doesNotThrow(() =>
      assertBrowserConnectProxyTransportResetObservationConsistency(fixture),
    );
  }
  const invalidFixtures = [
    {
      ...validFixture,
      activeTunnelPresentAtAuthorizationCount: 1,
    },
    {
      ...validFixture,
      targetedTunnelRetirementSuccessCount: 3,
    },
    {
      ...validFixture,
      targetedTunnelRetirementObservations: [{ stage: "baseline", count: 3 }],
    },
    {
      ...validFixture,
      authenticationProtectedReadRetryAttestations: [
        { stage: "baseline", retryUsed: 0 },
        { stage: "candidate", retryUsed: 1 },
      ],
    },
    {
      ...dualRetryValidFixture,
      authenticationProtectedReadRetryAttestations: [
        { stage: "baseline", retryUsed: 3 },
        { stage: "candidate", retryUsed: 0 },
      ],
    },
  ];
  for (const fixture of invalidFixtures) {
    assert.throws(() =>
      assertBrowserConnectProxyTransportResetObservationConsistency(fixture),
    );
  }
  return {
    browserConnectProxyTransportResetObservationAcceptedFixtureCount:
      validFixtures.length,
    browserConnectProxyTransportResetObservationRejectedFixtureCount:
      invalidFixtures.length,
  };
};
const verifyCaptureSafeAuthenticationSignInSourceContractNegativeFixtures = (
  sourceText,
) => {
  const replaceLastExact = (needle, replacement) => {
    const offset = sourceText.lastIndexOf(needle);
    assert.ok(
      offset >= 0,
      "A safe-authentication source mutation fixture is unbound.",
    );
    return `${sourceText.slice(0, offset)}${replacement}${sourceText.slice(
      offset + needle.length,
    )}`;
  };
  const descriptorNeedle =
    'const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");';
  const mutations = [
    replaceLastExact("classifyAuthSignInErrorClass(error)", "null"),
    replaceLastExact(
      descriptorNeedle,
      'const leakedMessage = error.message;\n          const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");',
    ),
    replaceLastExact(
      'throw new Error("VISUAL_AUTH_SIGN_IN_FAILED");',
      "throw error;",
    ),
    replaceLastExact(
      descriptorNeedle,
      'const leakedMessage = error["message"];\n          const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");',
    ),
    replaceLastExact(
      descriptorNeedle,
      'const leakedCopy = { ...error };\n          const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");',
    ),
    replaceLastExact(
      descriptorNeedle,
      'const { message: leakedMessage } = error;\n          const codeDescriptor = Object.getOwnPropertyDescriptor(error, "code");',
    ),
    replaceLastExact("return errorClassDescriptor.value;", "return null;"),
    replaceLastExact(
      "return errorClassDescriptor.value;",
      "return codeDescriptor.value;",
    ),
    replaceLastExact('typeof codeDescriptor.value !== "string"', "false"),
    replaceLastExact("codeDescriptor.get !== undefined", "false"),
    replaceLastExact('typeof errorClassDescriptor.value !== "string"', "false"),
  ];
  assert.equal(
    mutations.every((mutation) => mutation !== sourceText),
    true,
    "A safe-authentication source mutation fixture did not bind to live source.",
  );
  for (const mutation of mutations) {
    assert.throws(() =>
      assertCaptureSafeAuthenticationSignInSourceContract(mutation),
    );
  }
  return mutations.length;
};
const assertNoAppCheckSecretMaterial = (
  textValue,
  { debugToken = "", debugSentinel = "", exchangedToken = "" } = {},
) => {
  const text = String(textValue);
  if (debugToken) assert.equal(text.includes(debugToken), false);
  if (debugSentinel) assert.equal(text.includes(debugSentinel), false);
  if (exchangedToken) assert.equal(text.includes(exchangedToken), false);
  assert.doesNotMatch(text, JWT_PATTERN);
};
const assertExactObjectKeys = (value, expectedKeys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
};
const canonicalFrozenBaselineAuthenticationRetirementJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value
      .map(canonicalFrozenBaselineAuthenticationRetirementJson)
      .join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalFrozenBaselineAuthenticationRetirementJson(
            value[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const frozenBaselineAuthenticationRetirementSetSha256 = (groups) =>
  createHash("sha256")
    .update(canonicalFrozenBaselineAuthenticationRetirementJson(groups))
    .digest("hex");
const assertNoRawFrozenBaselineAuthenticationRetirementFields = (value) => {
  const forbiddenNormalizedKeys = new Set([
    "body",
    "idtoken",
    "path",
    "rawbody",
    "rawpath",
    "rawtoken",
    "rawuid",
    "refreshtoken",
    "requestbody",
    "responsebody",
    "token",
    "uid",
  ]);
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      assert.equal(
        forbiddenNormalizedKeys.has(
          key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase(),
        ),
        false,
        `Raw path/UID/body/token field is forbidden in the frozen-baseline authentication retirement: ${key}`,
      );
      visit(child);
    }
  };
  visit(value);
};
const frozenBaselineAuthenticationRetirementGroupKey = (group) => {
  assert.match(group.viewport, /^[1-9][0-9]{2,4}x[1-9][0-9]{2,4}$/u);
  return `${group.stage}:${group.captureRole}:${group.viewport}`;
};
const assertFrozenBaselineAuthenticationAnomalyRetirement = ({
  retirement,
  expectedGroupKeys,
  expectedPresentationSourceCommit,
}) => {
  const policy = frozenBaselineAuthenticationAnomalyPolicy;
  assertNoRawFrozenBaselineAuthenticationRetirementFields(retirement);
  assertExactObjectKeys(retirement, [
    "ambiguousRemovedTargetCount",
    "bufferExceededCount",
    "eligibleGroupCount",
    "expectedEligibleGroupCount",
    "fatalExactConsoleErrorCount",
    "groupAttestationCount",
    "groupAttestationSetSha256",
    "groups",
    "inboundRemoveCauseCodeCount",
    "observedExactConsoleErrorCount",
    "outboundAddTargetCount",
    "parseFailureCount",
    "passed",
    "policyId",
    "presentationSourceCommit",
    "retiredExactConsoleErrorCount",
    "schemaVersion",
    "streamFailureCount",
    "successorAddTargetCount",
    "targetClasses",
    "transportObserver",
    "unboundRemovedTargetCount",
    "unknownRemovedTargetCount",
    "unknownTargetCount",
  ]);
  assert.equal(retirement.schemaVersion, 1);
  assert.equal(retirement.policyId, policy.id);
  assert.equal(
    retirement.presentationSourceCommit,
    policy.presentationSourceCommit,
  );
  assert.equal(
    retirement.presentationSourceCommit,
    expectedPresentationSourceCommit,
  );
  assert.equal(
    retirement.transportObserver,
    "cdp-network-stream-resource-content",
  );
  assert.deepEqual(
    retirement.targetClasses,
    FROZEN_BASELINE_AUTHENTICATION_TARGET_CLASSES,
  );
  assert.equal(retirement.expectedEligibleGroupCount, 1);
  assert.equal(retirement.eligibleGroupCount, 1);
  assert.equal(retirement.passed, true);
  assert.equal(Array.isArray(retirement.groups), true);
  const integerFields = [
    "ambiguousRemovedTargetCount",
    "bufferExceededCount",
    "eligibleGroupCount",
    "expectedEligibleGroupCount",
    "fatalExactConsoleErrorCount",
    "groupAttestationCount",
    "inboundRemoveCauseCodeCount",
    "observedExactConsoleErrorCount",
    "outboundAddTargetCount",
    "parseFailureCount",
    "retiredExactConsoleErrorCount",
    "streamFailureCount",
    "successorAddTargetCount",
    "unboundRemovedTargetCount",
    "unknownRemovedTargetCount",
    "unknownTargetCount",
  ];
  for (const field of integerFields) {
    assert.equal(Number.isSafeInteger(retirement[field]), true);
    assert.ok(retirement[field] >= 0);
  }
  const exactExpectedGroupKeys = [...expectedGroupKeys].sort((left, right) =>
    left.localeCompare(right),
  );
  assert.equal(
    new Set(exactExpectedGroupKeys).size,
    exactExpectedGroupKeys.length,
  );
  assert.equal(retirement.groupAttestationCount, exactExpectedGroupKeys.length);
  assert.equal(retirement.groups.length, retirement.groupAttestationCount);
  assert.match(retirement.groupAttestationSetSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    retirement.groupAttestationSetSha256,
    frozenBaselineAuthenticationRetirementSetSha256(retirement.groups),
  );

  const observedGroupKeys = retirement.groups.map(
    frozenBaselineAuthenticationRetirementGroupKey,
  );
  assert.deepEqual(observedGroupKeys, exactExpectedGroupKeys);
  assert.equal(new Set(observedGroupKeys).size, observedGroupKeys.length);
  const groupIntegerFields = [
    "ambiguousRemovedTargetCount",
    "bufferExceededCount",
    "exactConsoleErrorCount",
    "fatalExactConsoleErrorCount",
    "inboundRemoveCauseCodeCount",
    "outboundAddTargetCount",
    "parseFailureCount",
    "removedTargetClassMatchCount",
    "retiredExactConsoleErrorCount",
    "streamFailureCount",
    "successorAddTargetCount",
    "successorTargetAcknowledgedCount",
    "tupleBoundRetirementCount",
    "unboundRemovedTargetCount",
    "unknownRemovedTargetCount",
    "unknownTargetCount",
  ];
  const aggregateFields = [
    "ambiguousRemovedTargetCount",
    "bufferExceededCount",
    "fatalExactConsoleErrorCount",
    "inboundRemoveCauseCodeCount",
    "observedExactConsoleErrorCount",
    "outboundAddTargetCount",
    "parseFailureCount",
    "retiredExactConsoleErrorCount",
    "streamFailureCount",
    "successorAddTargetCount",
    "unboundRemovedTargetCount",
    "unknownRemovedTargetCount",
    "unknownTargetCount",
  ];
  const aggregateValues = Object.fromEntries(
    aggregateFields.map((field) => [field, 0]),
  );
  let eligibleGroupCount = 0;
  let removedTargetClassMatchCount = 0;
  let tupleBoundRetirementCount = 0;
  for (const group of retirement.groups) {
    assertExactObjectKeys(group, [
      "ambiguousRemovedTargetCount",
      "authenticationRole",
      "bufferExceededCount",
      "captureRole",
      "dashboardStable",
      "eligible",
      "exactConsoleErrorCount",
      "fatalExactConsoleErrorCount",
      "groupKey",
      "inboundRemoveCauseCodeCount",
      "outboundAddTargetCount",
      "parseFailureCount",
      "passed",
      "phase",
      "removedTargetClassMatchCount",
      "retiredExactConsoleErrorCount",
      "stage",
      "streamFailureCount",
      "successorAddTargetCount",
      "successorExplicitlyAcknowledged",
      "successorSequenceBound",
      "successorTargetAcknowledgedCount",
      "targetClassHistogram",
      "tupleBoundRetirementCount",
      "unboundRemovedTargetCount",
      "unknownRemovedTargetCount",
      "unknownTargetCount",
      "viewport",
    ]);
    assert.ok(["baseline", "candidate"].includes(group.stage));
    assert.ok(
      ["admin", "student", "support-teacher", "teacher"].includes(
        group.captureRole,
      ),
    );
    assert.equal(
      group.authenticationRole,
      group.captureRole === "support-teacher" ? "teacher" : group.captureRole,
    );
    assert.equal(group.phase, "authentication");
    assert.equal(
      group.groupKey,
      frozenBaselineAuthenticationRetirementGroupKey(group),
    );
    assert.equal(typeof group.eligible, "boolean");
    assert.equal(typeof group.dashboardStable, "boolean");
    assert.equal(typeof group.successorExplicitlyAcknowledged, "boolean");
    assert.equal(typeof group.successorSequenceBound, "boolean");
    assert.equal(group.dashboardStable, true);
    assert.equal(group.passed, true);
    for (const field of groupIntegerFields) {
      assert.equal(Number.isSafeInteger(group[field]), true);
      assert.ok(group[field] >= 0);
    }
    assert.equal(Array.isArray(group.targetClassHistogram), true);
    assert.deepEqual(
      group.targetClassHistogram.map(({ targetClass }) => targetClass),
      FROZEN_BASELINE_AUTHENTICATION_TARGET_CLASSES,
    );
    for (const histogramEntry of group.targetClassHistogram) {
      assertExactObjectKeys(histogramEntry, ["count", "targetClass"]);
      assert.equal(Number.isSafeInteger(histogramEntry.count), true);
      assert.ok(histogramEntry.count >= 0);
    }
    assert.equal(
      group.outboundAddTargetCount,
      group.targetClassHistogram.reduce(
        (total, histogramEntry) => total + histogramEntry.count,
        0,
      ),
    );
    const histogram = Object.fromEntries(
      group.targetClassHistogram.map(({ targetClass, count }) => [
        targetClass,
        count,
      ]),
    );
    assert.equal(group.unknownTargetCount, histogram.unknown);
    assert.equal(
      group.successorAddTargetCount,
      histogram[policy.successorTargetClass],
    );
    assert.ok(
      group.successorTargetAcknowledgedCount <= group.successorAddTargetCount,
    );
    assert.equal(
      group.successorExplicitlyAcknowledged,
      group.successorAddTargetCount === 1 &&
        group.successorTargetAcknowledgedCount === 1,
    );
    const isEligible =
      group.stage === policy.stage &&
      group.captureRole === policy.captureRole &&
      group.authenticationRole === policy.authenticationRole &&
      group.viewport === policy.viewport &&
      group.phase === policy.phase;
    assert.equal(group.eligible, isEligible);
    if (isEligible) {
      eligibleGroupCount += 1;
      assert.equal(histogram[policy.removedTargetClass], 1);
      assert.equal(histogram[policy.successorTargetClass], 1);
      assert.equal(
        group.exactConsoleErrorCount,
        policy.consoleError.expectedCount,
      );
      assert.equal(group.inboundRemoveCauseCodeCount, 1);
      assert.equal(group.removedTargetClassMatchCount, 1);
      assert.equal(group.successorAddTargetCount, 1);
      assert.equal(group.successorTargetAcknowledgedCount, 1);
      assert.equal(group.successorSequenceBound, true);
      assert.equal(group.tupleBoundRetirementCount, 1);
      assert.equal(
        group.retiredExactConsoleErrorCount,
        policy.consoleError.expectedCount,
      );
    } else {
      for (const field of [
        "exactConsoleErrorCount",
        "inboundRemoveCauseCodeCount",
        "removedTargetClassMatchCount",
        "retiredExactConsoleErrorCount",
        "tupleBoundRetirementCount",
      ]) {
        assert.equal(group[field], 0);
      }
      assert.equal(group.successorSequenceBound, false);
    }
    assert.equal(group.unknownRemovedTargetCount, 0);
    assert.equal(group.unboundRemovedTargetCount, 0);
    assert.equal(group.ambiguousRemovedTargetCount, 0);
    assert.equal(group.streamFailureCount, 0);
    assert.equal(group.parseFailureCount, 0);
    assert.equal(group.bufferExceededCount, 0);
    assert.equal(group.fatalExactConsoleErrorCount, 0);
    aggregateValues.observedExactConsoleErrorCount +=
      group.exactConsoleErrorCount;
    for (const field of aggregateFields.filter(
      (candidate) => candidate !== "observedExactConsoleErrorCount",
    )) {
      aggregateValues[field] += group[field];
    }
    removedTargetClassMatchCount += group.removedTargetClassMatchCount;
    tupleBoundRetirementCount += group.tupleBoundRetirementCount;
  }
  assert.equal(eligibleGroupCount, retirement.eligibleGroupCount);
  for (const field of aggregateFields) {
    assert.equal(retirement[field], aggregateValues[field]);
  }
  assert.equal(removedTargetClassMatchCount, 1);
  assert.equal(tupleBoundRetirementCount, 1);
  assert.equal(
    retirement.observedExactConsoleErrorCount,
    policy.consoleError.expectedCount,
  );
  assert.equal(
    retirement.retiredExactConsoleErrorCount,
    policy.consoleError.expectedCount,
  );
  assert.equal(retirement.fatalExactConsoleErrorCount, 0);
  assert.equal(
    retirement.observedExactConsoleErrorCount,
    retirement.retiredExactConsoleErrorCount +
      retirement.fatalExactConsoleErrorCount,
  );
  assert.equal(retirement.inboundRemoveCauseCodeCount, 1);
  assert.equal(retirement.unknownRemovedTargetCount, 0);
  assert.equal(retirement.unboundRemovedTargetCount, 0);
  assert.equal(retirement.ambiguousRemovedTargetCount, 0);
  assert.equal(retirement.streamFailureCount, 0);
  assert.equal(retirement.parseFailureCount, 0);
  assert.equal(retirement.bufferExceededCount, 0);
  return retirement;
};
const verifyFrozenBaselineAuthenticationAnomalyRetirementFixtures = () => {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const histogram = ({ eligible = false } = {}) =>
    FROZEN_BASELINE_AUTHENTICATION_TARGET_CLASSES.map((targetClass) => ({
      targetClass,
      count:
        targetClass === "unknown"
          ? 2
          : eligible &&
              ["attendance-default-scope", "attendance-active-scope"].includes(
                targetClass,
              )
            ? 1
            : 0,
    }));
  const group = ({ stage, captureRole, authenticationRole, width, height }) => {
    const eligible =
      stage === frozenBaselineAuthenticationAnomalyPolicy.stage &&
      captureRole === frozenBaselineAuthenticationAnomalyPolicy.captureRole &&
      authenticationRole ===
        frozenBaselineAuthenticationAnomalyPolicy.authenticationRole &&
      `${width}x${height}` ===
        frozenBaselineAuthenticationAnomalyPolicy.viewport;
    const targetClassHistogram = histogram({ eligible });
    return {
      groupKey: `${stage}:${captureRole}:${width}x${height}`,
      stage,
      captureRole,
      authenticationRole,
      viewport: `${width}x${height}`,
      phase: "authentication",
      eligible,
      exactConsoleErrorCount: Number(eligible),
      outboundAddTargetCount: targetClassHistogram.reduce(
        (total, entry) => total + entry.count,
        0,
      ),
      targetClassHistogram,
      inboundRemoveCauseCodeCount: Number(eligible),
      removedTargetClassMatchCount: Number(eligible),
      successorAddTargetCount: Number(eligible),
      successorTargetAcknowledgedCount: Number(eligible),
      unknownTargetCount: 2,
      unknownRemovedTargetCount: 0,
      unboundRemovedTargetCount: 0,
      ambiguousRemovedTargetCount: 0,
      streamFailureCount: 0,
      parseFailureCount: 0,
      bufferExceededCount: 0,
      tupleBoundRetirementCount: Number(eligible),
      retiredExactConsoleErrorCount: Number(eligible),
      fatalExactConsoleErrorCount: 0,
      dashboardStable: true,
      successorExplicitlyAcknowledged: eligible,
      successorSequenceBound: eligible,
      passed: true,
    };
  };
  const expectedGroupKeys = [
    "baseline:student:1024x768",
    "baseline:teacher:1024x768",
    "candidate:student:1024x768",
    "candidate:support-teacher:1024x768",
  ].sort();
  const baseGroups = [
    group({
      stage: "baseline",
      captureRole: "student",
      authenticationRole: "student",
      width: 1024,
      height: 768,
    }),
    group({
      stage: "baseline",
      captureRole: "teacher",
      authenticationRole: "teacher",
      width: 1024,
      height: 768,
    }),
    group({
      stage: "candidate",
      captureRole: "student",
      authenticationRole: "student",
      width: 1024,
      height: 768,
    }),
    group({
      stage: "candidate",
      captureRole: "support-teacher",
      authenticationRole: "teacher",
      width: 1024,
      height: 768,
    }),
  ].sort((left, right) =>
    frozenBaselineAuthenticationRetirementGroupKey(left).localeCompare(
      frozenBaselineAuthenticationRetirementGroupKey(right),
    ),
  );
  const finalize = (fixture) => {
    fixture.groupAttestationCount = fixture.groups.length;
    fixture.eligibleGroupCount = fixture.groups.filter(
      ({ eligible }) => eligible,
    ).length;
    for (const [topLevelField, groupField] of [
      ["observedExactConsoleErrorCount", "exactConsoleErrorCount"],
      ["retiredExactConsoleErrorCount", "retiredExactConsoleErrorCount"],
      ["fatalExactConsoleErrorCount", "fatalExactConsoleErrorCount"],
      ["outboundAddTargetCount", "outboundAddTargetCount"],
      ["inboundRemoveCauseCodeCount", "inboundRemoveCauseCodeCount"],
      ["successorAddTargetCount", "successorAddTargetCount"],
      ["unknownRemovedTargetCount", "unknownRemovedTargetCount"],
      ["unboundRemovedTargetCount", "unboundRemovedTargetCount"],
      ["ambiguousRemovedTargetCount", "ambiguousRemovedTargetCount"],
      ["unknownTargetCount", "unknownTargetCount"],
      ["streamFailureCount", "streamFailureCount"],
      ["parseFailureCount", "parseFailureCount"],
      ["bufferExceededCount", "bufferExceededCount"],
    ]) {
      fixture[topLevelField] = fixture.groups.reduce(
        (total, candidate) => total + candidate[groupField],
        0,
      );
    }
    fixture.groupAttestationSetSha256 =
      frozenBaselineAuthenticationRetirementSetSha256(fixture.groups);
    return fixture;
  };
  const validFixture = finalize({
    schemaVersion: 1,
    policyId: frozenBaselineAuthenticationAnomalyPolicy.id,
    presentationSourceCommit:
      frozenBaselineAuthenticationAnomalyPolicy.presentationSourceCommit,
    transportObserver: "cdp-network-stream-resource-content",
    targetClasses: [...FROZEN_BASELINE_AUTHENTICATION_TARGET_CLASSES],
    expectedEligibleGroupCount: 1,
    eligibleGroupCount: 0,
    observedExactConsoleErrorCount: 0,
    retiredExactConsoleErrorCount: 0,
    fatalExactConsoleErrorCount: 0,
    outboundAddTargetCount: 0,
    inboundRemoveCauseCodeCount: 0,
    successorAddTargetCount: 0,
    unknownTargetCount: 0,
    unknownRemovedTargetCount: 0,
    unboundRemovedTargetCount: 0,
    ambiguousRemovedTargetCount: 0,
    streamFailureCount: 0,
    parseFailureCount: 0,
    bufferExceededCount: 0,
    groupAttestationCount: 0,
    groupAttestationSetSha256: "",
    groups: clone(baseGroups),
    passed: true,
  });
  const verify = (fixture) =>
    assertFrozenBaselineAuthenticationAnomalyRetirement({
      retirement: fixture,
      expectedGroupKeys,
      expectedPresentationSourceCommit:
        frozenBaselineAuthenticationAnomalyPolicy.presentationSourceCommit,
    });
  assert.doesNotThrow(() => verify(validFixture));
  const mutations = [];
  const pushFinalizedMutation = (mutate) => {
    const fixture = clone(validFixture);
    mutate(fixture);
    mutations.push(finalize(fixture));
  };
  pushFinalizedMutation((fixture) => {
    const candidate = fixture.groups.find(
      ({ stage, captureRole }) =>
        stage === "candidate" && captureRole === "student",
    );
    candidate.eligible = true;
    candidate.exactConsoleErrorCount = 1;
    candidate.inboundRemoveCauseCodeCount = 1;
    candidate.removedTargetClassMatchCount = 1;
    candidate.successorAddTargetCount = 1;
    candidate.successorTargetAcknowledgedCount = 1;
    candidate.tupleBoundRetirementCount = 1;
    candidate.retiredExactConsoleErrorCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    const otherGroup = fixture.groups.find(
      ({ stage, captureRole }) =>
        stage === "baseline" && captureRole === "teacher",
    );
    otherGroup.exactConsoleErrorCount = 1;
    otherGroup.retiredExactConsoleErrorCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    const eligible = fixture.groups.find(({ eligible }) => eligible);
    eligible.exactConsoleErrorCount = 0;
    eligible.inboundRemoveCauseCodeCount = 0;
    eligible.removedTargetClassMatchCount = 0;
    eligible.tupleBoundRetirementCount = 0;
    eligible.retiredExactConsoleErrorCount = 0;
  });
  pushFinalizedMutation((fixture) => {
    const eligible = fixture.groups.find(({ eligible }) => eligible);
    eligible.exactConsoleErrorCount = 2;
    eligible.fatalExactConsoleErrorCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    const eligible = fixture.groups.find(({ eligible }) => eligible);
    const removedTargetClass = eligible.targetClassHistogram.find(
      ({ targetClass }) =>
        targetClass ===
        frozenBaselineAuthenticationAnomalyPolicy.removedTargetClass,
    );
    removedTargetClass.count = 2;
    eligible.outboundAddTargetCount += 1;
  });
  pushFinalizedMutation((fixture) => {
    const eligible = fixture.groups.find(({ eligible }) => eligible);
    const successorTargetClass = eligible.targetClassHistogram.find(
      ({ targetClass }) =>
        targetClass ===
        frozenBaselineAuthenticationAnomalyPolicy.successorTargetClass,
    );
    successorTargetClass.count = 2;
    eligible.outboundAddTargetCount += 1;
  });
  pushFinalizedMutation((fixture) => {
    fixture.groups[0].unknownRemovedTargetCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    fixture.groups[0].parseFailureCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    fixture.groups[0].streamFailureCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    fixture.groups[0].bufferExceededCount = 1;
  });
  pushFinalizedMutation((fixture) => {
    fixture.groups.push(clone(fixture.groups.at(-1)));
  });
  const missingGroupFixture = clone(validFixture);
  missingGroupFixture.groups.shift();
  mutations.push(finalize(missingGroupFixture));
  const extraFieldFixture = clone(validFixture);
  extraFieldFixture.extra = true;
  mutations.push(extraFieldFixture);
  const missingFieldFixture = clone(validFixture);
  delete missingFieldFixture.passed;
  mutations.push(missingFieldFixture);
  const wrongHashFixture = clone(validFixture);
  wrongHashFixture.groupAttestationSetSha256 = "f".repeat(64);
  mutations.push(wrongHashFixture);
  const wrongSourceFixture = clone(validFixture);
  wrongSourceFixture.presentationSourceCommit = "f".repeat(40);
  mutations.push(wrongSourceFixture);
  for (const forbiddenField of ["path", "uid", "body", "token"]) {
    const fixture = clone(validFixture);
    fixture.groups[0][forbiddenField] = "raw-value";
    mutations.push(fixture);
  }
  for (const mutation of mutations) {
    assert.throws(() => verify(mutation));
  }
  return {
    frozenBaselineAuthenticationRetirementAcceptedFixtureCount: 1,
    frozenBaselineAuthenticationRetirementRejectedFixtureCount:
      mutations.length,
    frozenBaselineAuthenticationRetirementCandidateRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementOtherGroupRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementMissingExactErrorRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementDuplicateExactErrorRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementDuplicateRemovedTargetRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementSuccessorHistogramMismatchRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementUnknownRemovedRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementMissingGroupRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementDuplicateGroupRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementParseFailureRejectedCaseCount: 1,
    frozenBaselineAuthenticationRetirementRawFieldRejectedCaseCount: 4,
    frozenBaselineAuthenticationRetirementNetworkAccess: 0,
  };
};
const assertNoHashedAppCheckDebugToken = (textValue, debugTokenSha256) => {
  assert.match(debugTokenSha256, /^[a-f0-9]{64}$/u);
  for (const candidate of String(textValue).matchAll(
    APP_CHECK_DEBUG_TOKEN_CANDIDATE_PATTERN,
  )) {
    assert.notEqual(
      secretSha256(candidate[0]),
      debugTokenSha256,
      "Raw App Check debug token material reached evidence.",
    );
  }
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
    assertNoHashedAppCheckDebugToken(
      `raw=${debugToken}`,
      secretSha256(debugToken),
    ),
  );
  assert.throws(() =>
    assertNoAppCheckSecretMaterial(`raw=${APP_CHECK_DEBUG_SENTINEL}`, {
      debugSentinel: APP_CHECK_DEBUG_SENTINEL,
    }),
  );
  const schemaFixture = { status: "VERIFIED", rawTokenOutputCount: 0 };
  assert.doesNotThrow(() =>
    assertExactObjectKeys(schemaFixture, ["status", "rawTokenOutputCount"]),
  );
  assert.throws(() =>
    assertExactObjectKeys({ ...schemaFixture, hiddenRawToken: debugToken }, [
      "status",
      "rawTokenOutputCount",
    ]),
  );
  assert.throws(() =>
    assertExactObjectKeys({ status: "NOT_EXECUTED" }, [
      "status",
      "rawTokenOutputCount",
    ]),
  );
  assert.doesNotThrow(() =>
    assertNoAppCheckSecretMaterial(
      JSON.stringify({ debugTokenSha256: secretSha256(debugToken) }),
      { debugToken },
    ),
  );
  return {
    rejectedRawSecretCaseCount: 4,
    rejectedSchemaMutationCaseCount: 2,
    acceptedSanitizedCaseCount: 2,
  };
};
const verifyPreTransmissionBoundaryNegativeFixtures = () => {
  const cases = [
    {
      method: "GET",
      inspection: {
        productionMarker: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "production",
    },
    {
      method: "POST",
      inspection: {
        productionMarker: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "production",
    },
    {
      method: "GET",
      inspection: {
        productionMarker: false,
        crossOriginDocument: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: true,
      },
      marker: "cross-origin-document",
    },
    {
      method: "POST",
      inspection: {
        productionMarker: false,
        unboundFirebaseRequest: true,
        isFirebaseRequest: true,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "unbound-firebase",
    },
    {
      method: "GET",
      inspection: {
        productionMarker: false,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: false,
      },
      marker: "non-firebase-hostname-not-allowlisted",
    },
  ];
  for (const fixture of cases) {
    assert.deepEqual(preTransmissionBoundaryDecision(fixture.inspection), {
      block: true,
      marker: fixture.marker,
    });
    assert.ok(["GET", "POST"].includes(fixture.method));
  }
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
      isFirebaseRequest: false,
      nonFirebaseHostnameAllowed: true,
    }),
    { block: false, marker: null },
  );
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
      isFirebaseRequest: true,
      nonFirebaseHostnameAllowed: false,
    }),
    { block: false, marker: null },
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: "https://stable.example.vercel.app/",
      method: "GET",
      resourceType: "Document",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    true,
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: "https://unknown.example.vercel.app/",
      method: "GET",
      resourceType: "Document",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    false,
  );
  assert.equal(canonicalNetworkHostname("WESTORY.KR."), "westory.kr");
  assert.equal(canonicalNetworkHostname("westory.kr..."), "westory.kr");
  assert.equal(canonicalNetworkHostname("[2001:DB8::1]"), "[2001:db8::1]");
  for (const method of ["GET", "POST"]) {
    const hostname = new URL(`https://westory.kr./${method.toLowerCase()}`)
      .hostname;
    assert.equal(
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(hostname),
      ),
      true,
    );
    assert.deepEqual(
      preTransmissionBoundaryDecision({
        productionMarker: true,
        unboundFirebaseRequest: false,
        isFirebaseRequest: false,
        nonFirebaseHostnameAllowed: true,
      }),
      { block: true, marker: "production" },
    );
  }
  for (const hostname of [
    "identitytoolkit.googleapis.com.",
    "securetoken.googleapis.com.",
  ]) {
    assert.equal(firebaseServiceForHostname(hostname), "auth");
    assert.deepEqual(
      preTransmissionBoundaryDecision({
        productionMarker: false,
        unboundFirebaseRequest: true,
        isFirebaseRequest: true,
        nonFirebaseHostnameAllowed: false,
      }),
      { block: true, marker: "unbound-firebase" },
    );
  }
  assert.equal(
    firebaseServiceForHostname(`${contract.firebaseProjectId}.firebaseio.com`),
    "realtime-database",
  );
  const regionalRealtimeDatabaseNegativeFixtures = [
    {
      hostname:
        "history-quiz-yongsin-default-rtdb.asia-southeast1.firebasedatabase.app",
      marker: "production",
    },
    {
      hostname:
        "unknown-project-default-rtdb.europe-west1.firebasedatabase.app",
      marker: "unbound-firebase",
    },
    {
      hostname: `${contract.firebaseProjectId}-default-rtdb.asia-southeast1.firebasedatabase.app`,
      marker: "unbound-firebase",
    },
    {
      hostname: `${contract.firebaseProjectId}-alternate.europe-west1.firebasedatabase.app.`,
      marker: "unbound-firebase",
    },
  ];
  for (const { hostname, marker } of regionalRealtimeDatabaseNegativeFixtures) {
    assert.equal(firebaseServiceForHostname(hostname), "realtime-database");
    assert.deepEqual(
      preTransmissionBoundaryDecision({
        productionMarker: marker === "production",
        unboundFirebaseRequest: marker === "unbound-firebase",
        isFirebaseRequest: true,
        nonFirebaseHostnameAllowed: false,
      }),
      { block: true, marker },
    );
  }
  assert.deepEqual(
    preTransmissionBoundaryDecision({
      productionMarker: false,
      unboundFirebaseRequest: false,
      isFirebaseRequest: false,
      nonFirebaseHostnameAllowed: true,
      malformedUrlEncoding: true,
    }),
    { block: true, marker: "malformed-url-encoding" },
  );
  for (const fixture of [
    {
      requestUrl:
        "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap",
      resourceType: "Stylesheet",
    },
    {
      requestUrl: "https://fonts.gstatic.com/s/notosanskr/v1/fixture.woff2",
      resourceType: "Font",
    },
  ]) {
    assert.equal(
      isNonFirebaseHostnameAllowed({
        ...fixture,
        method: "GET",
        isFirebaseRequest: false,
        allowedOrigins: ["https://stable.example.vercel.app"],
      }),
      true,
    );
  }
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: "https://stable.example.vercel.app./",
      method: "GET",
      resourceType: "Document",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    false,
  );
  const productionImmutableHostname =
    "westory-70z9g2tvv-bbbs-projects-44f9da30.vercel.app";
  assert.equal(
    contract.networkBoundary.forbiddenWebHosts.includes(
      productionImmutableHostname,
    ),
    true,
  );
  assert.equal(
    isNonFirebaseHostnameAllowed({
      requestUrl: `https://${productionImmutableHostname}/`,
      method: "GET",
      resourceType: "Document",
      isFirebaseRequest: false,
      allowedOrigins: ["https://stable.example.vercel.app"],
    }),
    false,
  );
  const captureRunnerSourceText = readFileSync(
    resolve(contract.captureRunner.scriptPath),
    "utf8",
  );
  assert.equal(
    assertCapturePreTransmissionBoundarySourceOrdering(captureRunnerSourceText),
    true,
  );
  assert.equal(
    assertCaptureSafeAuthenticationSignInSourceContract(
      captureRunnerSourceText,
    ),
    true,
  );
  assert.equal(
    assertCaptureProtectedReadTransportResetSourceContract(
      captureRunnerSourceText,
    ),
    true,
  );
  const safeAuthenticationSignInSourceMutationRejectedCaseCount =
    verifyCaptureSafeAuthenticationSignInSourceContractNegativeFixtures(
      captureRunnerSourceText,
    );
  return {
    preTransmissionProductionGetRejectedCaseCount: 1,
    preTransmissionProductionPostRejectedCaseCount: 1,
    preTransmissionCrossOriginDocumentRejectedCaseCount: 1,
    preTransmissionUnboundFirebaseRejectedCaseCount: 1,
    preTransmissionUnallowlistedNonFirebaseRejectedCaseCount: 1,
    preTransmissionAcceptedStagingCaseCount: 1,
    preTransmissionAcceptedBoundFirebaseCaseCount: 1,
    preTransmissionHostnameClassifierVerified: true,
    preTransmissionAllowedNonVercelExternalCaseCount: 2,
    preTransmissionRejectedUnknownVercelHostnameCaseCount: 2,
    preTransmissionRejectedProductionImmutableHostnameCaseCount: 1,
    preTransmissionCanonicalHostnameCaseCount: 3,
    preTransmissionDottedProductionHostnameRejectedCaseCount: 2,
    preTransmissionDottedFirebaseHostnameRejectedCaseCount: 2,
    preTransmissionLegacyRealtimeDatabaseClassifierCaseCount: 1,
    preTransmissionRegionalRealtimeDatabaseRejectedCaseCount: 4,
    preTransmissionMalformedEncodingRejectedCaseCount: 1,
    preTransmissionSourceOrderingVerified: true,
    frozenBaselineListenerAsyncSequenceSourceContractVerified: true,
    frozenBaselineListenerBufferedByteReplaySourceContractVerified: true,
    frozenBaselineListenerPostSettlementGuardSourceContractVerified: true,
    frozenBaselineListenerTerminalFailureSourceContractVerified: true,
    frozenBaselineListenerBoundedReadinessSettlementSourceContractVerified: true,
    frozenBaselineListenerBindingPositiveFixtureSourceCount: 3,
    frozenBaselineListenerBindingNegativeFixtureSourceCount: 8,
    safeAuthenticationSignInSourceContractVerified: true,
    safeAuthenticationSignInSourceMutationRejectedCaseCount,
  };
};
const verifyFixtureAuditFreshnessNegativeFixtures = () => {
  const freshness = {
    issuedAt: "2026-08-24T00:00:00.000Z",
    expiresAt: "2026-08-24T02:00:00.000Z",
    maxAgeSeconds: 7200,
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
        expiresAt: "2026-08-24T02:00:00.001Z",
      },
      captureBindingFreshness: {
        ...freshness,
        expiresAt: "2026-08-24T02:00:00.001Z",
      },
    },
    {
      freshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:59:59.999Z",
      },
      captureBindingFreshness: {
        ...freshness,
        expiresAt: "2026-08-24T01:59:59.999Z",
      },
    },
    {
      freshness: { ...freshness, maxAgeSeconds: 7199 },
      captureBindingFreshness: { ...freshness, maxAgeSeconds: 7199 },
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
  const issuedAt = Date.parse(freshness.issuedAt);
  const expiresAt = Date.parse(freshness.expiresAt);
  const acceptedCaptureWindows = [
    { issuedAt, expiresAt, startedAt: issuedAt, completedAt: expiresAt },
    {
      issuedAt,
      expiresAt,
      startedAt:
        issuedAt + FIXTURE_AUDIT_CAPTURE_START_MAX_DELAY_SECONDS * 1000,
      completedAt: expiresAt,
    },
  ];
  for (const captureWindow of acceptedCaptureWindows) {
    assert.doesNotThrow(() => assertFixtureAuditCaptureWindow(captureWindow));
  }
  const rejectedCaptureWindows = [
    { issuedAt, expiresAt, startedAt: issuedAt - 1 },
    {
      issuedAt,
      expiresAt,
      startedAt:
        issuedAt + FIXTURE_AUDIT_CAPTURE_START_MAX_DELAY_SECONDS * 1000 + 1,
    },
    { issuedAt, expiresAt, startedAt: expiresAt },
    {
      issuedAt,
      expiresAt,
      startedAt: issuedAt,
      completedAt: expiresAt + 1,
    },
    {
      issuedAt,
      expiresAt,
      startedAt: issuedAt + 1,
      completedAt: issuedAt,
    },
  ];
  for (const captureWindow of rejectedCaptureWindows) {
    assert.throws(() => assertFixtureAuditCaptureWindow(captureWindow));
  }
  return {
    acceptedFreshnessBindingCaseCount: 1,
    rejectedFreshnessMutationCaseCount: mutations.length,
    acceptedFreshnessCaptureWindowCaseCount: acceptedCaptureWindows.length,
    rejectedFreshnessCaptureWindowCaseCount: rejectedCaptureWindows.length,
  };
};
const appCheckSecretNegativeSelfTest = verifyAppCheckSecretNegativeFixtures();
const preTransmissionBoundaryNegativeSelfTest =
  verifyPreTransmissionBoundaryNegativeFixtures();
const fixtureAuditFreshnessNegativeSelfTest =
  verifyFixtureAuditFreshnessNegativeFixtures();
const stableOriginRewriteNegativeSelfTest =
  verifyStableOriginRewriteNegativeFixtures();
const telemetryCapabilityGuardNegativeSelfTest =
  verifyTelemetryCapabilityGuardNegativeFixtures();
const stableOriginFaviconFallbackNegativeSelfTest =
  verifyStableOriginFaviconFallbackNegativeFixtures();
const networkPolicyNegativeSelfTest = verifyNetworkPolicyNegativeFixtures();
const protectedReadTransportResetLeaseSequenceSelfTest =
  verifyProtectedReadTransportResetLeaseSequenceFixtures();
const browserConnectProxyTransportResetObservationSelfTest =
  verifyBrowserConnectProxyTransportResetObservationFixtures();
const frozenBaselineAuthenticationAnomalyRetirementSelfTest =
  verifyFrozenBaselineAuthenticationAnomalyRetirementFixtures();
if (args.includes("--self-test-app-check")) {
  console.log(
    JSON.stringify({
      suite: "w10p-app-check-verifier-secret-self-test",
      passed: true,
      ...appCheckSecretNegativeSelfTest,
      ...authenticationLandingGuardSelfTest,
      ...preTransmissionBoundaryNegativeSelfTest,
      ...fixtureAuditFreshnessNegativeSelfTest,
      ...stableOriginRewriteNegativeSelfTest,
      ...telemetryCapabilityGuardNegativeSelfTest,
      ...stableOriginFaviconFallbackNegativeSelfTest,
      ...networkPolicyNegativeSelfTest,
      ...protectedReadTransportResetLeaseSequenceSelfTest,
      ...browserConnectProxyTransportResetObservationSelfTest,
      ...frozenBaselineAuthenticationAnomalyRetirementSelfTest,
      verifierChildSecretEnvScrubbed: true,
      verifierChildSecretEnvironmentVariableCount,
      verifierChildSecretValueObservationCount,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
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
const manifestText = readFileSync(manifestPath, "utf8");
assertNoAppCheckSecretMaterial(manifestText);
assert.equal(manifestText.includes(APP_CHECK_DEBUG_SENTINEL), false);
if (verifierVercelBypassSecret) {
  assert.equal(
    manifestText.includes(verifierVercelBypassSecret),
    false,
    "The Vercel bypass secret reached the visual manifest.",
  );
}
assertNoHashedAppCheckDebugToken(
  manifestText,
  manifest.appCheckBinding?.debugTokenSha256 ?? "",
);

const run = (command, commandArgs) =>
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: verifierChildEnvironment,
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
const STAGING_VERCEL_HOST_PATTERN =
  /^westory-staging-[a-z0-9-]+-bbbs-projects-44f9da30\.vercel\.app$/u;
const exactVercelOrigin = (value) => {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  assert.ok(!parsed.port || parsed.port === "443");
  assert.match(parsed.hostname.toLowerCase(), STAGING_VERCEL_HOST_PATTERN);
  return parsed.origin;
};
const exactDeploymentRoot = (value) => {
  const parsed = new URL(value);
  const origin = exactVercelOrigin(parsed);
  assert.equal(parsed.pathname, "/");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  return origin;
};
const stableBrowserOrigin = exactDeploymentRoot(contract.stableAlias);
const upstreamOrigins = {
  baseline: exactDeploymentRoot(manifest.baselineDeployment?.url),
  candidate: exactDeploymentRoot(manifest.candidateDeployment?.url),
};
const nonFirebaseNetworkAllowedHostnames = [
  ...new Set(
    [stableBrowserOrigin, ...Object.values(upstreamOrigins)].map((origin) =>
      new URL(origin).hostname.toLowerCase(),
    ),
  ),
].sort();
assert.equal(nonFirebaseNetworkAllowedHostnames.length, 3);
const nonFirebaseNetworkAllowedHostnameSetHash = sha256(
  Buffer.from(canonicalJson(nonFirebaseNetworkAllowedHostnames)),
);
assert.equal(contract.browserTransport?.browserOrigin, stableBrowserOrigin);
assert.deepEqual(contract.browserTransport, {
  schemaVersion: 9,
  mechanism:
    "cdp-fetch-request-stage-local-fulfill-from-node-attested-immutable-bytes",
  browserOrigin: stableBrowserOrigin,
  upstreamSource: "stage-immutable-deployment-url",
  immutableFetchOwner: "node-only-exact-origin-no-redirect",
  immutableRequestHeaderPolicy:
    "node-owned-cache-control-no-cache-x-vercel-skip-toolbar-1-and-optional-exact-origin-protection-bypass",
  injectedToolbarMarkupPolicy:
    "reject-any-url-resolving-to-fixed-vercel-preview-toolbar-script-path-and-data-marker-before-browser-fulfill",
  browserWirePolicy: "zero-browser-network-to-immutable-upstream",
  responseHeaderPolicy:
    "synthetic-no-store-content-type-and-x-dns-prefetch-control-link-omitted",
  informationalResponsePolicy: "immutable-one-xx-never-exposed-to-browser",
  parserMarkupPolicy:
    "node-quote-aware-opening-tag-scan-fail-closed-before-browser-fulfill-on-speculative-link-except-exact-parser-same-origin-root-assets-js-modulepreload-without-base-query-or-fragment-speculationrules-anchor-or-area-ping-iframe-srcdoc-or-duplicate-relevant-attributes",
  domMutationPolicy:
    "locked-link-fail-closed-accessor-and-mutable-facade-membrane-plus-exact-one-shot-vite-same-origin-root-assets-js-modulepreload-state-machine-and-uncurried-native-dom-entrypoints-with-base-srcdoc-markup-nested-template-range-cross-document-selection-document-open-write-writeln-and-exec-command-blocks",
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  allowedMethods: ["GET", "HEAD"],
  documentResourceType: "Document",
  staticResourceTypes: [
    "Font",
    "Image",
    "Manifest",
    "Media",
    "Script",
    "Stylesheet",
    "TextTrack",
  ],
  staticPathPrefixes: ["/assets/"],
  staticPathExtensions: [
    ".css",
    ".gif",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".map",
    ".mjs",
    ".otf",
    ".png",
    ".svg",
    ".ttf",
    ".webmanifest",
    ".webp",
    ".woff",
    ".woff2",
  ],
  externalOriginRewriteAllowed: false,
  firebaseGoogleRewriteAllowed: false,
  redirectPolicy: "abort-before-follow",
  responseBodyHashResourceTypes: ["Document", "Script"],
  requiredPerGroupResourceTypes: ["Document", "Script"],
  stableOriginFaviconFallback: {
    schemaVersion: 1,
    id: "stable-origin-favicon-empty-204-v1",
    stages: ["baseline", "candidate"],
    browserOriginSource: "stable-alias",
    method: "GET",
    pathname: "/favicon.ico",
    queryPolicy: "none",
    hashPolicy: "none",
    resourceType: "Other",
    requestBodyPolicy: "absent",
    responseStatus: 204,
    responseHeaders: {
      "cache-control": "no-store",
    },
    responseBodyUtf8: "",
    responseBodyBytes: 0,
    responseBodySha256:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    nodeUpstreamFetchPolicy: "forbidden",
    browserWirePolicy: "local-cdp-fulfill",
    nonmatchingPolicy: "existing-stable-origin-rewrite",
  },
  deterministicLocalResponse: {
    schemaVersion: 1,
    id: "korean-holidays-empty-v1",
    browserOriginSource: "stable-alias",
    method: "GET",
    pathname: "/api/korean-holidays",
    resourceTypes: ["Fetch", "XHR"],
    queryKeys: ["year"],
    queryOccurrenceCount: 1,
    yearCanonicalDecimalMinimum: 1900,
    yearCanonicalDecimalMaximum: 2100,
    requestBodyPolicy: "absent",
    forbiddenRequestHeaderNames: [
      "authorization",
      "content-type",
      "cookie",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ],
    responseStatus: 200,
    responseHeaders: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
    responseBodyUtf8: '{"holidays":[]}',
    responseBodyBytes: 15,
    responseBodySha256:
      "b2353ccf5bff3a3f3f626773cf9824f9d0b7fc42f4f52488c49b36ebcdc64348",
    scopeMismatchAction: "block-before-transmission",
  },
  deterministicRecaptchaResponse: {
    schemaVersion: 1,
    id: "recaptcha-enterprise-bootstrap-stub-v1",
    protocol: "https:",
    hostname: "www.google.com",
    allowedPorts: ["", "443"],
    userinfoAllowed: false,
    method: "GET",
    pathname: "/recaptcha/enterprise.js",
    queryPolicy: "none",
    resourceType: "Script",
    requestBodyPolicy: "absent",
    forbiddenRequestHeaderNames: [
      "authorization",
      "content-type",
      "cookie",
      "x-firebase-appcheck",
      "x-goog-api-key",
      "x-vercel-protection-bypass",
    ],
    responseStatus: 200,
    responseHeaders: {
      "cache-control": "no-store",
      "content-type": "text/javascript; charset=utf-8",
    },
    responseBodyUtf8:
      'globalThis.grecaptcha={enterprise:{ready:(callback)=>callback(),render:()=>0,execute:()=>Promise.resolve("w10p-recaptcha-stub-token")}};',
    responseBodyBytes: 136,
    responseBodySha256:
      "9cf02df627dfd408fc5c4559b56b187450cbecc5684c72015708bcb18da5ed64",
    scopeMismatchAction: "block-before-transmission",
  },
  playwrightRouteRegistrationAllowed: false,
});
assert.equal(new Set(Object.values(upstreamOrigins)).size, 2);
assert.equal(
  Object.values(upstreamOrigins).includes(stableBrowserOrigin),
  false,
);
const stableOriginRewriteTransportContractHash = sha256(
  Buffer.from(canonicalJson(contract.browserTransport)),
);
const immutableUpstreamBinding = {
  baseline: {
    deploymentId: manifest.baselineDeployment.id,
    deploymentUrl: upstreamOrigins.baseline,
    deploymentUrlSha256: sha256(upstreamOrigins.baseline),
    sourceCommitSha: contract.productionPresentationSha,
  },
  candidate: {
    deploymentId: manifest.candidateDeployment.id,
    deploymentUrl: upstreamOrigins.candidate,
    deploymentUrlSha256: sha256(upstreamOrigins.candidate),
    sourceCommitSha: manifest.sourceCommitSha,
  },
};
const immutableUpstreamBindingHash = sha256(
  Buffer.from(canonicalJson(immutableUpstreamBinding)),
);
const TELEMETRY_CAPABILITY_GUARD_ATTESTATION_KEYS = [
  "schemaVersion",
  "guardId",
  "point",
  "stage",
  "groupKey",
  "captureId",
  "originExact",
  "ownProperty",
  "valueExact",
  "descriptorExact",
  "preservedCapabilitiesPresent",
];
const assertTelemetryCapabilityGuardAttestation = (
  attestation,
  { expectedStage, expectedGroupKey, expectedCaptureIds },
) => {
  assertExactObjectKeys(
    attestation,
    TELEMETRY_CAPABILITY_GUARD_ATTESTATION_KEYS,
  );
  assert.equal(attestation.schemaVersion, 1);
  assert.equal(
    attestation.guardId,
    contract.networkBoundary.optionalTelemetrySuppression.documentStartGuard.id,
  );
  assert.ok(
    contract.networkBoundary.optionalTelemetrySuppression.documentStartGuard.runtimeAttestationPoints.includes(
      attestation.point,
    ),
  );
  assert.equal(attestation.stage, expectedStage);
  assert.equal(attestation.groupKey, expectedGroupKey);
  if (attestation.point === "post-authentication") {
    assert.equal(attestation.captureId, null);
  } else {
    assert.equal(attestation.point, "post-screen-navigation");
    assert.equal(expectedCaptureIds.includes(attestation.captureId), true);
  }
  for (const field of [
    "originExact",
    "ownProperty",
    "valueExact",
    "descriptorExact",
    "preservedCapabilitiesPresent",
  ]) {
    assert.equal(attestation[field], true);
  }
  return attestation;
};
const STABLE_ORIGIN_REWRITE_SUMMARY_KEYS = [
  "schemaVersion",
  "transportContractHash",
  "immutableUpstreamBindingHash",
  "stage",
  "browserOrigin",
  "browserOriginSha256",
  "upstreamDeploymentId",
  "upstreamDeploymentUrl",
  "upstreamDeploymentUrlSha256",
  "upstreamSourceCommitSha",
  "requestCount",
  "responseCount",
  "httpSuccessResponseCount",
  "httpErrorResponseCount",
  "documentRequestCount",
  "scriptRequestCount",
  "bodyHashCount",
  "bodyHashMatchCount",
  "bodyHashMismatchCount",
  "redirectRequestCount",
  "redirectResponseCount",
  "responseErrorCount",
  "documentBodySha256s",
  "scriptBodySha256s",
  "resourceProvenanceSha256",
  "summarySha256",
];
const assertStableOriginRewriteSummary = (summary, expectedStage) => {
  assertExactObjectKeys(summary, STABLE_ORIGIN_REWRITE_SUMMARY_KEYS);
  assert.ok(["baseline", "candidate"].includes(expectedStage));
  const { summarySha256, ...summaryBody } = summary;
  assert.equal(summarySha256, sha256(Buffer.from(canonicalJson(summaryBody))));
  const upstreamBinding = immutableUpstreamBinding[expectedStage];
  assert.equal(summary.schemaVersion, 1);
  assert.equal(
    summary.transportContractHash,
    stableOriginRewriteTransportContractHash,
  );
  assert.equal(
    summary.immutableUpstreamBindingHash,
    immutableUpstreamBindingHash,
  );
  assert.equal(summary.stage, expectedStage);
  assert.equal(summary.browserOrigin, stableBrowserOrigin);
  assert.equal(summary.browserOriginSha256, sha256(stableBrowserOrigin));
  assert.equal(summary.upstreamDeploymentId, upstreamBinding.deploymentId);
  assert.equal(summary.upstreamDeploymentUrl, upstreamBinding.deploymentUrl);
  assert.equal(
    summary.upstreamDeploymentUrlSha256,
    upstreamBinding.deploymentUrlSha256,
  );
  assert.equal(
    summary.upstreamSourceCommitSha,
    upstreamBinding.sourceCommitSha,
  );
  for (const field of [
    "requestCount",
    "responseCount",
    "httpSuccessResponseCount",
    "httpErrorResponseCount",
    "documentRequestCount",
    "scriptRequestCount",
    "bodyHashCount",
    "bodyHashMatchCount",
    "bodyHashMismatchCount",
    "redirectRequestCount",
    "redirectResponseCount",
    "responseErrorCount",
  ]) {
    assert.ok(Number.isInteger(summary[field]) && summary[field] >= 0);
  }
  assert.ok(summary.requestCount > 0);
  assert.equal(summary.responseCount, summary.requestCount);
  assert.equal(summary.httpSuccessResponseCount, summary.requestCount);
  assert.ok(summary.documentRequestCount > 0);
  assert.ok(summary.scriptRequestCount > 0);
  assert.ok(summary.bodyHashCount >= 2);
  assert.equal(summary.bodyHashMatchCount, summary.bodyHashCount);
  for (const field of [
    "httpErrorResponseCount",
    "bodyHashMismatchCount",
    "redirectRequestCount",
    "redirectResponseCount",
    "responseErrorCount",
  ]) {
    assert.equal(summary[field], 0);
  }
  for (const hashes of [
    summary.documentBodySha256s,
    summary.scriptBodySha256s,
  ]) {
    assert.ok(Array.isArray(hashes) && hashes.length > 0);
    assert.deepEqual(hashes, [...new Set(hashes)].sort());
    for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/u);
  }
  assert.match(summary.resourceProvenanceSha256, /^[a-f0-9]{64}$/u);
  return true;
};
const vercelBypassAllowedOrigins = [
  ...new Set([stableBrowserOrigin, ...Object.values(upstreamOrigins)]),
].sort();
const VERCEL_BYPASS_TRANSPORT_CONTRACT = {
  requiredProtocol: "https:",
  allowedPorts: ["", "443"],
  userinfoAllowed: false,
  originMatch: "exact",
};
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
  schemaVersion: 3,
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
  storageBucketHash: manifest?.environment?.firebaseConfig?.storageBucket
    ? sha256(manifest.environment.firebaseConfig.storageBucket)
    : "",
  storagePathBoundaryHash: manifest?.environment?.firebaseConfig?.storageBucket
    ? sha256(`/v0/b/${manifest.environment.firebaseConfig.storageBucket}/o`)
    : "",
  functionsPathRuleHash: sha256("single-callable-path-segment-v1"),
  interceptionMechanism: "cdp-fetch-request-stage",
  headerCorrelationMechanism:
    "cdp-fetch-network-id-firestore-webchannel-transport-and-bounded-playwright-request-allHeaders",
  urlMethodFifoCorrelationAllowed: false,
  redirectHeaderOverridePropagation: false,
  redirectPolicyHash: sha256(
    "abort-before-send-every-redirect-from-bridge-injected-request-v1",
  ),
  serviceWorkerPolicy: "block",
  candidateBridgeAllowed: false,
};
const baselineAppCheckBridgeScopeHash = sha256(
  Buffer.from(canonicalJson(BASELINE_APP_CHECK_BRIDGE_SCOPE)),
);
const preTransmissionNetworkBoundaryAttestationHash = sha256(
  Buffer.from(canonicalJson(PRE_TRANSMISSION_NETWORK_BOUNDARY_ATTESTATION)),
);
const BROWSER_APP_CHECK_CDP_SECURITY_SCOPE = {
  schemaVersion: 4,
  interceptionMechanism: "cdp-fetch-request-stage",
  preTransmissionNetworkBoundaryAttestationHash,
  nonFirebaseNetworkAllowedHostnameSetHash,
  executionTargetBoundaryHash: sha256(
    canonicalJson(contract.networkBoundary.executionTargetBoundary),
  ),
  browserConnectProxyHash: sha256(
    canonicalJson(contract.networkBoundary.browserConnectProxy),
  ),
  directBrowserEarlyHintsPolicy:
    "observed-after-receipt-capture-invalid-fatal-not-pre-transmission-block",
  secretInitScope: "primary-page-only",
  browserGlobalValueKind: "non-secret-fixed-sentinel",
  debugSentinelHash: sha256(APP_CHECK_DEBUG_SENTINEL),
  exchangeEndpointHash: sha256(FIXTURE_APP_CHECK_EXCHANGE_ENDPOINT),
  exchangeApiKeyHash: manifest?.environment?.firebaseConfig?.apiKeySha256 ?? "",
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
        apiKeyHash: manifest?.environment?.firebaseConfig?.apiKeySha256 ?? "",
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
  monitoredTargetKind: "all-relevant-targets-before-runtime-resume",
  targetGuardMechanism:
    "playwright-private-crsession-runtime-resume-gate-plus-primary-fetch-handoff",
  secondaryTargetExecutionAllowed: false,
  creatorCapabilityInitScriptRequired: true,
  playwrightWebSocketRouteRequired: true,
  webSocketConnectToServerAllowed: false,
  webTransportConstructorAllowed: false,
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
      suite: "w10p-backup-access-probe-verifier-self-test",
      passed: true,
      ...backupAccessProbeNegativeSelfTest,
      productionAccess: 0,
      networkAccess: 0,
    }),
  );
  process.exit(0);
}
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
    forbiddenWebHosts: [
      "westory.kr",
      "www.westory.kr",
      "westory-70z9g2tvv-bbbs-projects-44f9da30.vercel.app",
    ],
    requiredMeasuredFirebaseProjectIds: [contract.firebaseProjectId],
    hostnameCanonicalization: {
      schemaVersion: 1,
      rawHostnameSource: "whatwg-url-hostname-lowercase",
      dnsComparison: "strip-all-terminal-dots-except-bracketed-ipv6",
      vercelAllowlistComparison: "raw-exact-terminal-dot-rejected",
      malformedPercentEncodingAction: "block-before-transmission",
    },
    firebaseRequestBinding: {
      schemaVersion: 3,
      transport: "https-default-443-no-userinfo",
      queryApiKeyName: "key",
      headerApiKeyName: "x-goog-api-key",
      auth: "exact-single-staging-api-key",
      appCheck: "exact-single-staging-api-key-plus-project-identity-and-app-id",
      firestore: "all-database-resource-project-slots-exact-staging",
      storage: "exact-staging-bucket-resource-slot",
      functions: "exact-asia-northeast3-staging-project-host",
      realtimeDatabase: "exact-staging-project-firebaseio-host",
      regionalRealtimeDatabase:
        "all-firebasedatabase-app-hosts-classified-firebase-and-unbound-without-configured-database-url",
      hosting: "exact-staging-project-host",
      firestoreWebChannel: {
        schemaVersion: 1,
        protocol: "https:",
        hostname: "firestore.googleapis.com",
        method: "POST",
        pathnames: [
          "/google.firestore.v1.Firestore/Listen/channel",
          "/google.firestore.v1.Firestore/Write/channel",
        ],
        databaseQueryName: "database",
        databaseQueryValue: `projects/${contract.firebaseProjectId}/databases/(default)`,
        exactInitialQueryNames: [
          "CVER",
          "RID",
          "VER",
          "X-HTTP-Session-Id",
          "database",
          "t",
          "zx",
        ],
        versionQueryValue: "8",
        clientVersionQueryValue: "22",
        sessionHeaderQueryName: "X-HTTP-Session-Id",
        sessionHeaderQueryValue: "gsessionid",
        encodedHeaderBodyField: "headers",
        encodedApiKeyHeaderName: "x-goog-api-key",
        encodedApiKeyOccurrencePolicy:
          "exact-single-body-header-line-and-zero-url-or-wire-header-occurrences",
        contentTypePolicy:
          "application-x-www-form-urlencoded-with-optional-utf-8-charset",
        scopeMismatchAction: "block-before-transmission",
      },
    },
    executionTargetBoundary: {
      schemaVersion: 6,
      mechanism: "playwright-1.62.1-private-crsession-runtime-resume-gate",
      primaryRequestOwnerHandoff:
        "private-fetch-before-page-init-to-public-cdp-fetch-before-navigation",
      secondaryTargetPolicy: "close-before-runtime-resume",
      coveredTargetTypes: [
        "iframe",
        "page",
        "service_worker",
        "shared_worker",
        "worker",
      ],
      creatorCapabilityPolicy:
        "locked-instance-and-prototype-init-script-block-worker-shared-worker-service-worker-send-beacon",
      crossOriginDocumentPolicy:
        "stable-browser-origin-only-in-private-and-public-fetch-owners",
      webSocketPolicy: "playwright-websocket-route-without-connect-to-server",
      webSocketStreamPolicy: "init-script-constructor-block-before-use",
      webTransportPolicy: "init-script-constructor-block-before-use",
      eventSourcePolicy: "public-cdp-fetch-pre-transmission-boundary",
      peerConnectionPolicy:
        "init-script-block-rtc-peer-connection-and-webkit-alias",
      workletPolicy: "init-script-block-all-observable-add-module-entrypoints",
      beaconPolicy:
        "locked-navigator-instance-and-navigator-prototype-send-beacon-before-use",
      speculativeTransportPolicy:
        "exact-merged-effective-chromium-argv-plus-forced-connect-proxy-plus-parser-safe-node-local-fulfill-plus-locked-dom-attr-srcdoc-range-move-before-exec-command-and-trusted-markup-guards",
      chromiumCommandLinePolicy:
        "browser-get-browser-command-line-exact-single-disable-features-union-single-proxy-server-no-loopback-bypass-disable-quic",
      informationalResponsePolicy:
        "node-owned-external-one-xx-nonterminal-browser-unexposed-direct-browser-early-hints-observed-after-receipt-capture-invalid-fatal",
      requestBodyResolutionPolicy:
        "fetch-inline-exact-else-network-get-request-post-data-fail-closed-on-missing-id-read-failure-oversize-or-representation-mismatch",
      requestBodyMaximumBytes: MAX_RESOLVED_REQUEST_POST_DATA_BYTES,
      handlerErrorAction: "capture-fatal",
      residualTargetAction: "capture-fatal",
    },
    networkResponseBoundary: {
      schemaVersion: 3,
      scope:
        "split-direct-browser-final-direct-browser-early-hints-and-node-owned-external",
      directBrowserFinalInterception:
        "fetch-intercept-response-final-sanitized",
      directBrowserInformationalObservation:
        "network-response-received-early-hints-observed-after-receipt-capture-invalid-fatal",
      directBrowserInformationalFixturePolicy:
        "server-one-zero-three-sent-positive-cdp-event-may-be-zero-event-observation-invalidates-capture",
      directBrowserInformationalTransmissionBoundary:
        "allowed-host-link-target-fetch-rejected-if-exposed-else-feature-suppressed-or-proxy-denied-tunnel-and-raw-zero",
      nodeOwnedExternalInformationalPolicy:
        "node-http-information-nonterminal-browser-unexposed",
      informationalCorrelation:
        "node-owned-nonterminal-retain-until-final-direct-observation-invalidates-capture",
      externalStaticFinalPolicy:
        "node-owned-exact-200-body-hash-cache-safe-header-synthetic-local-fulfill",
      headerPolicy:
        "explicit-base-allowlist-plus-exact-request-bound-conditional-rules-all-other-headers-omitted",
      allowedHeaderNames: BROWSER_RESPONSE_HEADER_ALLOWLIST,
      requestBoundConditionalHeaderRules: [
        {
          id: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_RULE_ID,
          headerName: FIRESTORE_WEBCHANNEL_SESSION_RESPONSE_HEADER_NAME,
          responseStage: "successful-final-only",
          requestScope: "exact-firestore-webchannel-encoded-init",
          scopeMismatchAction: "omit",
          informationalResponseAction: "omit",
          duplicateHeaderAction: "capture-fatal",
          valuePolicy: "nonempty-visible-ascii-maximum-1024-bytes",
        },
      ],
      egressCapableHeaderNames: BROWSER_EGRESS_CAPABLE_RESPONSE_HEADER_NAMES,
      egressCapableHeaderForwardAction:
        "omit-before-browser-for-final-and-node-owned-never-expose-informational",
      invalidHeaderAction: "fail-request-and-capture-fatal",
    },
    browserConnectProxy: {
      schemaVersion: 2,
      mechanism: "forced-loopback-http-connect-proxy-gate",
      proxyServerArgument: "single-http-loopback-ephemeral-port",
      proxyBypassListArgument: "<-loopback>",
      allowedHostnames: BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES,
      browserProductBackgroundDenyHostnames:
        BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
      allowedMethod: "CONNECT",
      allowedPort: 443,
      authorizedRequestMethods:
        BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS,
      allowedTunnelAuthorization:
        "cdp-fetch-request-stage-short-lived-single-use-exact-authority-lease",
      requestAuthorizationBinding:
        "request-id-stage-method-stable-browser-origin-exact-hostname-default-443",
      authorityLeaseTtlMilliseconds: 5_000,
      pooledExistingTunnelPolicy:
        "every-request-remains-cdp-inspected-issued-lease-may-complete-unused-when-no-new-connect",
      requestConnectionCardinality:
        "not-one-to-one-http-connection-pooling-explicitly-reconciled",
      uncorrelatedAllowedConnectAction:
        "deny-before-upstream-socket-capture-fatal",
      expiredOrReplayLeaseAction: "deny-before-upstream-socket-capture-fatal",
      browserProductBackgroundDenyScope:
        "connect-only-exact-authority-443-browser-launch-stage-proxy-only-browser-process-source-no-credentials-or-body",
      browserProductBackgroundDenyAction:
        "deny-before-upstream-socket-hashed-audit-nonfatal",
      otherDenyAction: "deny-before-upstream-socket-capture-fatal",
      ipLiteralAction: "deny-before-upstream-socket-capture-fatal",
      alternatePortAction: "deny-before-upstream-socket-capture-fatal",
      unallowlistedHostnameAction: "deny-before-upstream-socket-capture-fatal",
      httpAbsoluteFormAction: "deny-before-upstream-socket-capture-fatal",
      upgradeAction: "deny-before-upstream-socket-capture-fatal",
      allowedTunnelScope:
        "host-contact-only-fetch-request-stage-sensitive-and-project-scope-remain-authoritative",
      sensitiveOrderingEvidence:
        "wrong-api-key-or-credential-scope-exact-allowed-host-fetch-failed-before-connect",
      allowedHostnameNegativeEvidence:
        "early-hints-link-parser-preconnect-websocket-websocket-stream-and-worker-invalid-request-create-no-upstream-request-without-lease",
      leaseLifecycleReconciliation:
        "issued-equals-consumed-plus-completed-unused-plus-revoked-plus-expired-and-live-residual-zero",
      cleanupPolicy:
        "destroy-client-and-upstream-sockets-close-listener-revoke-unused-leases-residual-zero",
    },
    nonFirebaseHostnameAllowlist: {
      schemaVersion: 3,
      scope: "exact-vercel-or-declared-external-static-request",
      match: "exact-raw-url-lowercase-hostname-no-terminal-dot",
      allowedHostnameSources: [
        "stable-alias",
        "baseline-immutable-deployment",
        "candidate-immutable-deployment",
      ],
      unallowlistedAction: "block-before-transmission",
      nonVercelHostnameAction:
        "block-unless-exact-external-static-rule-or-deterministic-response",
      vercelWildcardAllowed: false,
    },
    externalStaticRequestAllowlist: {
      schemaVersion: 3,
      transport: "https-default-443-no-userinfo",
      methods: ["GET"],
      requestBodyPolicy: "absent",
      nodeOwnedRequestHeaders: NODE_OWNED_EXTERNAL_STATIC_REQUEST_HEADERS,
      nodeOwnedRequestHeaderPolicy:
        "fixed-no-origin-referer-cookie-auth-bypass-app-check-or-api-key",
      nodeOwnedCacheKey: "exact-canonical-url-plus-fixed-request-contract-hash",
      nodeOwnedRedirectPolicy: "manual-no-follow-exact-200",
      nodeOwnedInformationalPolicy:
        "all-one-xx-observed-nonterminal-and-browser-unexposed-101-rejected",
      nodeOwnedContentEncodingPolicy: "absent-or-identity",
      nodeOwnedDuplicateResponseHeaderAction: "fail-closed",
      nodeOwnedResponseHeaderMaximumBytes:
        NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_MAXIMUM_BYTES,
      nodeOwnedResponseBodyMaximumBytes:
        NODE_OWNED_EXTERNAL_STATIC_RESPONSE_BODY_MAXIMUM_BYTES,
      nodeOwnedTimeoutMilliseconds:
        NODE_OWNED_EXTERNAL_STATIC_TIMEOUT_MILLISECONDS,
      nodeOwnedResponseHeaderAllowlist:
        NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST,
      nodeOwnedContentLengthPolicy:
        "discard-source-and-recalculate-from-captured-final-bytes",
      forbiddenRequestHeaderNames: [
        "authorization",
        "content-type",
        "cookie",
        "range",
        "x-firebase-appcheck",
        "x-goog-api-key",
        "x-vercel-protection-bypass",
      ],
      rules: [
        {
          id: "firebase-esm-12.9.0",
          hostname: "www.gstatic.com",
          resourceTypes: ["Script"],
          exactPathnames: [
            "/firebasejs/12.9.0/firebase-app-check.js",
            "/firebasejs/12.9.0/firebase-app.js",
            "/firebasejs/12.9.0/firebase-auth.js",
            "/firebasejs/12.9.0/firebase-firestore.js",
          ],
          queryPolicy: "none",
          action: "local-node-module-fulfill",
          responseHeaders: {
            "access-control-allow-origin": "*",
            "cache-control": "no-store",
            "content-type": "text/javascript; charset=utf-8",
            "cross-origin-resource-policy": "cross-origin",
          },
          localModules: {
            "/firebasejs/12.9.0/firebase-app-check.js": {
              path: "node_modules/firebase/firebase-app-check.js",
              bytes: 24975,
              sha256:
                "c44ef6c21d1eac0f5df0dda56fe1bc0cdf49458c76a837638efa2cb48aebc99e",
            },
            "/firebasejs/12.9.0/firebase-app.js": {
              path: "node_modules/firebase/firebase-app.js",
              bytes: 103065,
              sha256:
                "9d1506ac46c736e133afa49ceba8dff794c13898388cd91bbd1b8d2463f18315",
            },
            "/firebasejs/12.9.0/firebase-auth.js": {
              path: "node_modules/firebase/firebase-auth.js",
              bytes: 158797,
              sha256:
                "a44e3c26c183eab2ab6795af3c0f2ec6dad9adfe0057340e14df5324a4417356",
            },
            "/firebasejs/12.9.0/firebase-firestore.js": {
              path: "node_modules/firebase/firebase-firestore.js",
              bytes: 455145,
              sha256:
                "d300a686d0f9298189e7462737072cf69c564ccb15f7f01a061d19a741b6c909",
            },
          },
        },
        {
          id: "tailwind-play-3.4.17",
          hostname: "cdn.tailwindcss.com",
          resourceTypes: ["Script"],
          exactPathnames: ["/"],
          queryPolicy: "none",
          action: "startup-pinned-source-fetch-then-local-fulfill",
          pinnedSources: {
            "/": {
              url: "https://cdn.tailwindcss.com/3.4.17",
              contentType: "text/javascript; charset=utf-8",
              bytes: 407279,
              sha256:
                "176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15",
            },
          },
        },
        {
          id: "noto-sans-kr-css",
          hostname: "fonts.googleapis.com",
          resourceTypes: ["Stylesheet"],
          exactPathAndSearch:
            "/css2?family=Noto+Sans+KR:wght@400;500;700;800;900&display=swap",
          action: "baseline-fetch-hash-cache-then-local-fulfill",
        },
        {
          id: "noto-sans-kr-font",
          hostname: "fonts.gstatic.com",
          resourceTypes: ["Font"],
          pathnamePrefix: "/s/notosanskr/",
          allowedExtensions: [".ttf", ".woff", ".woff2"],
          queryPolicy: "none",
          action: "baseline-fetch-hash-cache-then-local-fulfill",
        },
        {
          id: "google-login-logo",
          hostname: "fonts.gstatic.com",
          resourceTypes: ["Image"],
          exactPathnames: ["/s/i/productlogos/googleg/v6/24px.svg"],
          queryPolicy: "none",
          action: "baseline-fetch-hash-cache-then-local-fulfill",
        },
        {
          id: "font-awesome-6.4.0-css",
          hostname: "cdnjs.cloudflare.com",
          resourceTypes: ["Stylesheet"],
          exactPathnames: ["/ajax/libs/font-awesome/6.4.0/css/all.min.css"],
          queryPolicy: "none",
          action: "startup-pinned-source-fetch-then-local-fulfill",
          pinnedSources: {
            "/ajax/libs/font-awesome/6.4.0/css/all.min.css": {
              url: "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css",
              contentType: "text/css; charset=utf-8",
              bytes: 102025,
              sha256:
                "1edb1725a9ea8ca4dcf2f5508cee183218aa1685e47c1b23056717f754f58ebf",
            },
          },
        },
        {
          id: "font-awesome-6.4.0-font",
          hostname: "cdnjs.cloudflare.com",
          resourceTypes: ["Font"],
          exactPathnames: [
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.ttf",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.ttf",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.ttf",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.ttf",
            "/ajax/libs/font-awesome/6.4.0/webfonts/fa-v4compatibility.woff2",
          ],
          queryPolicy: "none",
          action: "baseline-fetch-hash-cache-then-local-fulfill",
        },
        {
          id: "quill-1.3.6",
          hostname: "cdn.quilljs.com",
          resourceTypes: ["Script", "Stylesheet"],
          exactPathnames: ["/1.3.6/quill.js", "/1.3.6/quill.snow.css"],
          queryPolicy: "none",
          action: "startup-pinned-source-fetch-then-local-fulfill",
          pinnedSources: {
            "/1.3.6/quill.js": {
              url: "https://cdn.jsdelivr.net/npm/quill@1.3.6/dist/quill.js",
              contentType: "text/javascript; charset=utf-8",
              bytes: 437299,
              sha256:
                "a4da70cd71b5a0e224e95865829a8356a93907c7d47ebb6b23cb8014c6ff9c48",
            },
            "/1.3.6/quill.snow.css": {
              url: "https://cdn.jsdelivr.net/npm/quill@1.3.6/dist/quill.snow.css",
              contentType: "text/css; charset=utf-8",
              bytes: 24743,
              sha256:
                "892e299431955e9ae388ae257f72024ee76af2d52a7a97a868f70fbe50f16144",
            },
          },
        },
        {
          id: "pdfjs-3.11.174",
          hostname: "cdnjs.cloudflare.com",
          resourceTypes: ["Script"],
          exactPathnames: [
            "/ajax/libs/pdf.js/3.11.174/pdf.min.js",
            "/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
          ],
          queryPolicy: "none",
          action: "startup-pinned-source-fetch-then-local-fulfill",
          pinnedSources: {
            "/ajax/libs/pdf.js/3.11.174/pdf.min.js": {
              url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
              contentType: "text/javascript; charset=utf-8",
              bytes: 320004,
              sha256:
                "5b5799e6f8c680663207ac5b42ee14eed2a406fa7af48f50c154f0c0b1566946",
            },
            "/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js": {
              url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
              contentType: "text/javascript; charset=utf-8",
              bytes: 1087212,
              sha256:
                "feabdf309770ed24bba31a5467836cdc8cf639c705af27d52b585b041bb8527b",
            },
          },
        },
      ],
      unmatchedAction: "block-before-transmission",
      networkResponsePolicy:
        "request-stage-node-owned-exact-get-no-redirect-no-error-hash-cache-safe-header-synthetic-final-fulfill-browser-wire-zero",
    },
    optionalTelemetrySuppression: {
      schemaVersion: 2,
      transport: "https-default-443-no-userinfo",
      methods: ["GET", "POST", "OPTIONS"],
      hostnames: [
        "analytics.google.com",
        "firebase.googleapis.com",
        "firebaseinstallations.googleapis.com",
        "google-analytics.com",
        "region1.google-analytics.com",
        "www.google-analytics.com",
        "www.googletagmanager.com",
      ],
      action: "fail-request-before-transmission-nonfatal",
      documentStartGuard: {
        schemaVersion: 1,
        id: "firebase-analytics-cookie-capability-guard-v1",
        registration: "browser-context-add-init-script-before-page-creation",
        originScope: "exact-stable-alias-document-origin",
        target: "navigator-instance",
        property: "cookieEnabled",
        value: false,
        descriptor: {
          configurable: false,
          enumerable: false,
          writable: false,
        },
        preservedCapabilities: [
          "document.cookie",
          "indexedDB",
          "localStorage",
          "sessionStorage",
        ],
        runtimeAttestationPoints: [
          "post-authentication",
          "post-screen-navigation",
        ],
        outOfScopeAction: "leave-native-property-unmodified",
      },
      requiredLiveSuppressedRequestCount: 0,
      requiredLiveObservationCount: 0,
    },
    sensitiveValueScope: {
      schemaVersion: 3,
      stagingApiKey:
        "exact-firebase-query-key-or-x-goog-api-key-slot-or-exact-firestore-webchannel-encoded-init-header-only",
      testEmailPassword:
        "exact-identitytoolkit-sign-in-with-password-json-body-only",
      refreshToken: "exact-securetoken-token-post-body-only",
      debugToken: "node-only-never-browser-egress",
      debugSentinel:
        "exact-app-check-debug-exchange-json-body-replaced-before-transmission",
      evidence: "count-and-sha256-only-no-raw-values",
      scopeMismatchAction: "block-before-transmission",
      requestBodyResolution:
        "single-resolved-body-before-sensitive-telemetry-deterministic-or-external-decisions",
    },
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
      "1817de428ec7cba5fb07902cd019ee6244786eed8b56031075d1f844d6cb4919",
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
    const expectedCalendarGlyphMinimum =
      screenId === "student-calendar" ? 0.25 : 0.2;
    assert.equal(
      signal.minimumGlyphVisibleRatio === undefined ||
        signal.minimumGlyphVisibleRatio === expectedCalendarGlyphMinimum,
      true,
      `${screenId}.${signal.id}.minimumGlyphVisibleRatio is unsupported.`,
    );
    if (Number.isFinite(signal.minimumGlyphVisibleRatio)) {
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
      "w10p-visual-admin@yongshin-ms.ms.kr",
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
    const expectedCalendarGlyphMinimum =
      screenId === "student-calendar" ? 0.25 : 0.2;
    assert.equal(
      item.minimumGlyphVisibleRatio === undefined ||
        item.minimumGlyphVisibleRatio === expectedCalendarGlyphMinimum,
      true,
    );
    if (Number.isFinite(item.minimumGlyphVisibleRatio)) {
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
const readBrowserAudit = (path) => {
  const textValue = readFileSync(path, "utf8");
  assert.ok(textValue.endsWith("\n"), `${path} must end with a newline.`);
  assert.doesNotMatch(
    textValue,
    /(?:authorization|idToken|refreshToken|password|postData|responseBody)/iu,
    `${path} contains a sensitive transport field.`,
  );
  assert.doesNotMatch(textValue, /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u);
  assertNoAppCheckSecretMaterial(textValue);
  assert.equal(textValue.includes(APP_CHECK_DEBUG_SENTINEL), false);
  assertNoHashedAppCheckDebugToken(
    textValue,
    manifest.appCheckBinding.debugTokenSha256,
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
const captureRunnerSourceText = readFileSync(
  resolve(contract.captureRunner.scriptPath),
  "utf8",
);
assert.equal(
  assertCapturePreTransmissionBoundarySourceOrdering(captureRunnerSourceText),
  true,
);
assert.equal(
  assertCaptureSafeAuthenticationSignInSourceContract(captureRunnerSourceText),
  true,
);
assert.equal(
  assertCaptureProtectedReadTransportResetSourceContract(
    captureRunnerSourceText,
  ),
  true,
);
const playwrightRouteRegistrationCount = (
  captureRunnerSourceText.match(/\.(?:route|unroute)\s*\(/gu) || []
).length;
const browserGlobalExtraHttpHeaderRegistrationCount = (
  captureRunnerSourceText.match(/\bextraHTTPHeaders\s*:/gu) || []
).length;
const stableOriginCdpUrlOverrideCount = (
  captureRunnerSourceText.match(/url:\s*rewriteDecision\.upstreamUrl/gu) || []
).length;
const stableOriginLocalFulfillCounterSourceCount = (
  captureRunnerSourceText.match(
    /stableOriginRewriteLocalFulfillCount \+= 1/gu,
  ) || []
).length;
const telemetryCapabilityGuardInitScriptRegistrationSourceCount = (
  captureRunnerSourceText.match(
    /context\.addInitScript\(telemetryCapabilityGuardInitScript,/gu,
  ) || []
).length;
const stableOriginFaviconFallbackFulfillCounterSourceCount = (
  captureRunnerSourceText.match(
    /stableOriginFaviconFallbackFulfillCount \+= 1/gu,
  ) || []
).length;
const stableOriginFaviconFallbackNodeUpstreamIncrementSourceCount = (
  captureRunnerSourceText.match(
    /stableOriginFaviconFallbackNodeUpstreamFetchCount \+=/gu,
  ) || []
).length;
const stableOriginFaviconFallbackBrowserNetworkIncrementSourceCount = (
  captureRunnerSourceText.match(
    /stableOriginFaviconFallbackBrowserNetworkRequestCount \+=/gu,
  ) || []
).length;
const targetDiscoveryRegistrationCount = (
  captureRunnerSourceText.match(/"Target\.setDiscoverTargets"/gu) || []
).length;
const pageAppCheckSecretInitRegistrationCount = (
  captureRunnerSourceText.match(
    /\bpage\.addInitScript\(\s*appCheckDebugInitScript\s*,\s*appCheckDebugInitArgument\s*,?\s*\)/gu,
  ) || []
).length;
const pageAppCheckSentinelInitArgumentSourceCount = (
  captureRunnerSourceText.match(
    /\bconst\s+appCheckDebugInitArgument\s*=\s*\{\s*allowedOrigin:\s*origin,\s*debugToken:\s*APP_CHECK_DEBUG_SENTINEL,\s*\};/gu,
  ) || []
).length;
const contextAppCheckSecretInitRegistrationCount = (
  captureRunnerSourceText.match(
    /\bcontext\.addInitScript\(appCheckDebugInitScript\s*,/gu,
  ) || []
).length;
assert.equal(
  playwrightRouteRegistrationCount,
  0,
  "The capture runner combines Playwright route interception with CDP Fetch.",
);
assert.equal(
  browserGlobalExtraHttpHeaderRegistrationCount,
  0,
  "The capture runner configures browser-global HTTP headers.",
);
assert.equal(
  stableOriginCdpUrlOverrideCount,
  0,
  "Immutable bytes must never be reached by a browser URL override.",
);
assert.equal(stableOriginLocalFulfillCounterSourceCount, 1);
assert.equal(telemetryCapabilityGuardInitScriptRegistrationSourceCount, 2);
assert.equal(stableOriginFaviconFallbackFulfillCounterSourceCount, 1);
assert.equal(stableOriginFaviconFallbackNodeUpstreamIncrementSourceCount, 0);
assert.equal(stableOriginFaviconFallbackBrowserNetworkIncrementSourceCount, 0);
assert.equal(targetDiscoveryRegistrationCount, 1);
assert.equal(pageAppCheckSecretInitRegistrationCount, 1);
assert.equal(pageAppCheckSentinelInitArgumentSourceCount, 1);
assert.equal(contextAppCheckSecretInitRegistrationCount, 0);
const browserLaunchSourceIndex = captureRunnerSourceText.indexOf(
  "browser = await chromium.launch(",
);
assert.ok(browserLaunchSourceIndex > 0);
for (const environmentVariableName of [
  "W10P_VISUAL_APPCHECK_DEBUG_TOKEN",
  "W10P_VISUAL_CREDENTIALS_JSON",
  "W10P_VISUAL_FIREBASE_CONFIG_JSON",
  "VERCEL_AUTOMATION_BYPASS_SECRET",
]) {
  const deletionSourceIndex = captureRunnerSourceText.indexOf(
    `delete process.env.${environmentVariableName};`,
  );
  assert.ok(
    deletionSourceIndex >= 0 && deletionSourceIndex < browserLaunchSourceIndex,
    `${environmentVariableName} is not scrubbed before the Edge child process launches.`,
  );
}
const trustedInputPaths = [
  contract.captureRunner.scriptPath,
  "scripts/w10p-visual-parity-contract.json",
  "scripts/w10p-route-menu-inventory.json",
  "scripts/seed-w10p-visual-fixture.mjs",
  "firestore.rules",
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
const authenticationProtectedReadRetry =
  manifest.authenticationProtectedReadRetry;
assertExactObjectKeys(authenticationProtectedReadRetry, [
  "allowedEgressResponseErrorFatalCount",
  "allowedEgressResponseErrorObservedCount",
  "allowedEgressResponseErrorRecoveredCount",
  "attestationCount",
  "attestationSetSha256",
  "attestations",
  "browserConsoleErrorFatalCount",
  "browserConsoleErrorObservedCount",
  "browserConsoleErrorRecoveredCount",
  "browserRequestFailureFatalCount",
  "browserRequestFailureObservedCount",
  "browserRequestFailureRecoveredCount",
  "expectedGroupCount",
  "fatalProtectedReadTransportFailureCount",
  "observedProtectedReadTransportFailureCount",
  "passed",
  "policyId",
  "recoveredProtectedReadTransportFailureCount",
  "retryBudgetPerGroup",
  "retryBudgetPerTarget",
  "retryDelayMs",
  "schemaVersion",
  "sensitiveAppCheckResponseErrorFatalCount",
  "sensitiveAppCheckResponseErrorObservedCount",
  "sensitiveAppCheckResponseErrorRecoveredCount",
]);
assert.equal(authenticationProtectedReadRetry.schemaVersion, 6);
assert.equal(
  authenticationProtectedReadRetry.policyId,
  "w10p-protected-read-per-target-transport-retry-v4",
);
assert.equal(authenticationProtectedReadRetry.retryBudgetPerTarget, 1);
assert.equal(authenticationProtectedReadRetry.retryBudgetPerGroup, 2);
assert.equal(authenticationProtectedReadRetry.retryDelayMs, 2_000);
assert.equal(authenticationProtectedReadRetry.passed, true);
for (const field of [
  "expectedGroupCount",
  "attestationCount",
  "observedProtectedReadTransportFailureCount",
  "recoveredProtectedReadTransportFailureCount",
  "fatalProtectedReadTransportFailureCount",
  "browserConsoleErrorObservedCount",
  "browserConsoleErrorRecoveredCount",
  "browserConsoleErrorFatalCount",
  "browserRequestFailureObservedCount",
  "browserRequestFailureRecoveredCount",
  "browserRequestFailureFatalCount",
  "allowedEgressResponseErrorObservedCount",
  "allowedEgressResponseErrorRecoveredCount",
  "allowedEgressResponseErrorFatalCount",
  "sensitiveAppCheckResponseErrorObservedCount",
  "sensitiveAppCheckResponseErrorRecoveredCount",
  "sensitiveAppCheckResponseErrorFatalCount",
]) {
  assert.equal(Number.isInteger(authenticationProtectedReadRetry[field]), true);
  assert.ok(authenticationProtectedReadRetry[field] >= 0);
}
assert.ok(authenticationProtectedReadRetry.expectedGroupCount > 0);
assert.equal(
  Array.isArray(authenticationProtectedReadRetry.attestations),
  true,
);
assert.equal(
  authenticationProtectedReadRetry.attestationCount,
  authenticationProtectedReadRetry.expectedGroupCount,
);
assert.equal(
  authenticationProtectedReadRetry.attestations.length,
  authenticationProtectedReadRetry.attestationCount,
);
assert.deepEqual(
  authenticationProtectedReadRetry.attestations.map(
    (attestation) => attestation.groupKey,
  ),
  authenticationProtectedReadRetry.attestations
    .map((attestation) => attestation.groupKey)
    .sort((left, right) => left.localeCompare(right)),
);
assert.match(
  authenticationProtectedReadRetry.attestationSetSha256,
  /^[a-f0-9]{64}$/u,
);
assert.equal(
  authenticationProtectedReadRetry.attestationSetSha256,
  sha256(canonicalJson(authenticationProtectedReadRetry.attestations)),
);
const protectedReadRetryRolePairs = {
  admin: "admin",
  student: "student",
  "support-teacher": "teacher",
  teacher: "teacher",
};
const protectedReadRetryPlaywrightFailureEchoClasses = Object.freeze([
  "http2-protocol",
  "proxy-tunnel",
  "tls",
  "connection-reset",
  "connection-closed",
  "connection",
  "network-changed",
  "incomplete-chunked",
  "content-length-mismatch",
  "timeout",
  "name-resolution",
  "aborted",
  "generic-failed",
  "blocked-by-client",
  "other",
]);
assert.equal(
  new Set(protectedReadRetryPlaywrightFailureEchoClasses).size,
  protectedReadRetryPlaywrightFailureEchoClasses.length,
);
assert.equal(
  protectedReadRetryPlaywrightFailureEchoClasses.includes("other"),
  true,
);
for (const rejectedFailureEchoClass of ["policy-blocked", "cors-blocked"]) {
  assert.equal(
    protectedReadRetryPlaywrightFailureEchoClasses.includes(
      rejectedFailureEchoClass,
    ),
    false,
  );
}
const assertProtectedReadRetryPlaywrightFailureEchoClass = ({
  retryUsed,
  playwrightFailureEchoClass,
}) => {
  assert.ok([0, 1, 2].includes(retryUsed));
  if (retryUsed === 0) {
    assert.equal(playwrightFailureEchoClass, null);
    return;
  }
  assert.equal(typeof playwrightFailureEchoClass, "string");
  assert.equal(
    protectedReadRetryPlaywrightFailureEchoClasses.includes(
      playwrightFailureEchoClass,
    ),
    true,
  );
};
assert.doesNotThrow(() =>
  assertProtectedReadRetryPlaywrightFailureEchoClass({
    retryUsed: 0,
    playwrightFailureEchoClass: null,
  }),
);
assert.doesNotThrow(() =>
  assertProtectedReadRetryPlaywrightFailureEchoClass({
    retryUsed: 1,
    playwrightFailureEchoClass: "other",
  }),
);
assert.doesNotThrow(() =>
  assertProtectedReadRetryPlaywrightFailureEchoClass({
    retryUsed: 2,
    playwrightFailureEchoClass: "other",
  }),
);
for (const invalidFixture of [
  { retryUsed: 0, playwrightFailureEchoClass: "other" },
  { retryUsed: 1, playwrightFailureEchoClass: null },
  { retryUsed: 1, playwrightFailureEchoClass: "policy-blocked" },
  { retryUsed: 1, playwrightFailureEchoClass: "cors-blocked" },
  { retryUsed: 1, playwrightFailureEchoClass: "raw-network-error-text" },
]) {
  assert.throws(() =>
    assertProtectedReadRetryPlaywrightFailureEchoClass(invalidFixture),
  );
}
const assertProtectedReadRetryCdpLoadingFailureEchoClass = (attestation) => {
  assertProtectedReadRetryPlaywrightFailureEchoClass(attestation);
  const {
    retryUsed,
    playwrightFailureEchoClass,
    cdpLoadingFailureBlockedReasonClass,
    cdpLoadingFailureCorsErrorStatusAbsent,
    cdpLoadingFailureEchoClass,
    cdpLoadingFailureFetchNetworkIdentityBound,
    cdpLoadingFailureLocalFailRequestTimingClass,
    cdpLocalFailRequestCommandCompleted,
    cdpLocalFailRequestCommandIssued,
    cdpLocalFailRequestErrorReasonClass,
    cdpLocalFailRequestExactAttemptBound,
    cdpLocalFailRequestIssuerClass,
    cdpLocalFailRequestResponseErrorBound,
    cdpLocalFailRequestResponseFetchCorrelationClass,
  } = attestation;
  if (retryUsed === 0) {
    assert.equal(cdpLoadingFailureBlockedReasonClass, null);
    assert.equal(cdpLoadingFailureCorsErrorStatusAbsent, null);
    assert.equal(cdpLoadingFailureEchoClass, null);
    assert.equal(cdpLoadingFailureFetchNetworkIdentityBound, null);
    assert.equal(cdpLoadingFailureLocalFailRequestTimingClass, null);
    assert.equal(cdpLocalFailRequestCommandCompleted, null);
    assert.equal(cdpLocalFailRequestCommandIssued, null);
    assert.equal(cdpLocalFailRequestErrorReasonClass, null);
    assert.equal(cdpLocalFailRequestExactAttemptBound, null);
    assert.equal(cdpLocalFailRequestIssuerClass, null);
    assert.equal(cdpLocalFailRequestResponseErrorBound, null);
    assert.equal(cdpLocalFailRequestResponseFetchCorrelationClass, null);
    return;
  }
  assert.ok([null, "inspector"].includes(cdpLoadingFailureBlockedReasonClass));
  assert.equal(cdpLoadingFailureCorsErrorStatusAbsent, true);
  assert.equal(typeof cdpLoadingFailureEchoClass, "string");
  assert.equal(
    protectedReadRetryPlaywrightFailureEchoClasses.includes(
      cdpLoadingFailureEchoClass,
    ),
    true,
  );
  assert.equal(cdpLoadingFailureFetchNetworkIdentityBound, true);
  assert.ok(
    ["pre-local-fail", "local-fail-in-flight", "post-local-fail"].includes(
      cdpLoadingFailureLocalFailRequestTimingClass,
    ),
  );
  assert.equal(cdpLocalFailRequestCommandCompleted, true);
  assert.equal(cdpLocalFailRequestCommandIssued, true);
  assert.equal(cdpLocalFailRequestErrorReasonClass, "blocked-by-client");
  assert.equal(cdpLocalFailRequestExactAttemptBound, true);
  assert.equal(
    cdpLocalFailRequestIssuerClass,
    "protected-read-response-error-terminalization",
  );
  assert.equal(cdpLocalFailRequestResponseErrorBound, true);
  assert.ok(
    ["same-fetch", "same-network-single-alias"].includes(
      cdpLocalFailRequestResponseFetchCorrelationClass,
    ),
  );
  if (cdpLoadingFailureBlockedReasonClass === "inspector") {
    assert.equal(playwrightFailureEchoClass, "other");
    assert.equal(cdpLoadingFailureEchoClass, "blocked-by-client");
    assert.ok(
      ["local-fail-in-flight", "post-local-fail"].includes(
        cdpLoadingFailureLocalFailRequestTimingClass,
      ),
    );
    return;
  }
  assert.equal(
    cdpLoadingFailureEchoClass === playwrightFailureEchoClass ||
      (playwrightFailureEchoClass === "other" &&
        cdpLoadingFailureEchoClass === "aborted"),
    true,
  );
};
const protectedReadRetryNoFailureEchoFixture = {
  retryUsed: 0,
  playwrightFailureEchoClass: null,
  cdpLoadingFailureBlockedReasonClass: null,
  cdpLoadingFailureCorsErrorStatusAbsent: null,
  cdpLoadingFailureEchoClass: null,
  cdpLoadingFailureFetchNetworkIdentityBound: null,
  cdpLoadingFailureLocalFailRequestTimingClass: null,
  cdpLocalFailRequestCommandCompleted: null,
  cdpLocalFailRequestCommandIssued: null,
  cdpLocalFailRequestErrorReasonClass: null,
  cdpLocalFailRequestExactAttemptBound: null,
  cdpLocalFailRequestIssuerClass: null,
  cdpLocalFailRequestResponseErrorBound: null,
  cdpLocalFailRequestResponseFetchCorrelationClass: null,
};
const protectedReadRetryOrdinaryFailureEchoFixture = {
  retryUsed: 1,
  playwrightFailureEchoClass: "other",
  cdpLoadingFailureBlockedReasonClass: null,
  cdpLoadingFailureCorsErrorStatusAbsent: true,
  cdpLoadingFailureEchoClass: "other",
  cdpLoadingFailureFetchNetworkIdentityBound: true,
  cdpLoadingFailureLocalFailRequestTimingClass: "pre-local-fail",
  cdpLocalFailRequestCommandCompleted: true,
  cdpLocalFailRequestCommandIssued: true,
  cdpLocalFailRequestErrorReasonClass: "blocked-by-client",
  cdpLocalFailRequestExactAttemptBound: true,
  cdpLocalFailRequestIssuerClass:
    "protected-read-response-error-terminalization",
  cdpLocalFailRequestResponseErrorBound: true,
  cdpLocalFailRequestResponseFetchCorrelationClass: "same-fetch",
};
const protectedReadRetryInspectorFailureEchoFixture = {
  retryUsed: 1,
  playwrightFailureEchoClass: "other",
  cdpLoadingFailureBlockedReasonClass: "inspector",
  cdpLoadingFailureCorsErrorStatusAbsent: true,
  cdpLoadingFailureEchoClass: "blocked-by-client",
  cdpLoadingFailureFetchNetworkIdentityBound: true,
  cdpLoadingFailureLocalFailRequestTimingClass: "local-fail-in-flight",
  cdpLocalFailRequestCommandCompleted: true,
  cdpLocalFailRequestCommandIssued: true,
  cdpLocalFailRequestErrorReasonClass: "blocked-by-client",
  cdpLocalFailRequestExactAttemptBound: true,
  cdpLocalFailRequestIssuerClass:
    "protected-read-response-error-terminalization",
  cdpLocalFailRequestResponseErrorBound: true,
  cdpLocalFailRequestResponseFetchCorrelationClass: "same-fetch",
};
for (const validFixture of [
  protectedReadRetryNoFailureEchoFixture,
  protectedReadRetryOrdinaryFailureEchoFixture,
  { ...protectedReadRetryOrdinaryFailureEchoFixture, retryUsed: 2 },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureEchoClass: "aborted",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "local-fail-in-flight",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "post-local-fail",
    cdpLocalFailRequestResponseFetchCorrelationClass:
      "same-network-single-alias",
  },
  protectedReadRetryInspectorFailureEchoFixture,
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "post-local-fail",
  },
]) {
  assert.doesNotThrow(() =>
    assertProtectedReadRetryCdpLoadingFailureEchoClass(validFixture),
  );
}
for (const invalidFixture of [
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLoadingFailureEchoClass: "other",
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLoadingFailureFetchNetworkIdentityBound: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLoadingFailureBlockedReasonClass: "inspector",
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLoadingFailureCorsErrorStatusAbsent: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestErrorReasonClass: "blocked-by-client",
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestExactAttemptBound: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "pre-local-fail",
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestIssuerClass:
      "protected-read-response-error-terminalization",
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestCommandIssued: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestCommandCompleted: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestResponseErrorBound: true,
  },
  {
    ...protectedReadRetryNoFailureEchoFixture,
    cdpLocalFailRequestResponseFetchCorrelationClass: "same-fetch",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureEchoClass: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureEchoClass: "generic-failed",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    playwrightFailureEchoClass: "aborted",
    cdpLoadingFailureEchoClass: "other",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureEchoClass: "policy-blocked",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureEchoClass: "cors-blocked",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureFetchNetworkIdentityBound: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureBlockedReasonClass: "policy",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureCorsErrorStatusAbsent: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureCorsErrorStatusAbsent: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestErrorReasonClass: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestErrorReasonClass: "aborted",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestExactAttemptBound: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestExactAttemptBound: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "unknown-timing",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestIssuerClass: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestIssuerClass: "unknown-issuer",
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestCommandIssued: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestCommandIssued: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestCommandCompleted: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestCommandCompleted: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestResponseErrorBound: false,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestResponseErrorBound: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestResponseFetchCorrelationClass: null,
  },
  {
    ...protectedReadRetryOrdinaryFailureEchoFixture,
    cdpLocalFailRequestResponseFetchCorrelationClass: "ambiguous",
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    cdpLoadingFailureEchoClass: "other",
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    cdpLocalFailRequestErrorReasonClass: null,
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    cdpLocalFailRequestExactAttemptBound: false,
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    playwrightFailureEchoClass: "policy-blocked",
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    playwrightFailureEchoClass: "generic-failed",
  },
  {
    ...protectedReadRetryInspectorFailureEchoFixture,
    cdpLoadingFailureLocalFailRequestTimingClass: "pre-local-fail",
  },
]) {
  assert.throws(() =>
    assertProtectedReadRetryCdpLoadingFailureEchoClass(invalidFixture),
  );
}
const assertProtectedReadRetryConsoleEvidence = ({
  retryUsed,
  recoveredProtectedReadTransportFailureCount,
  cdpNetworkErrorLogCount,
  playwrightResourceLoadErrorCount,
  playwrightFailureConsoleEchoClass,
  playwrightFailureConsoleCdpNetworkIdentityBound,
  recoveredProtectedReadConsoleErrorCount,
}) => {
  assert.ok([0, 1, 2].includes(retryUsed));
  assert.ok([0, 1, 2].includes(recoveredProtectedReadTransportFailureCount));
  for (const count of [
    cdpNetworkErrorLogCount,
    playwrightResourceLoadErrorCount,
    recoveredProtectedReadConsoleErrorCount,
  ]) {
    assert.ok([0, 1, 2].includes(count));
  }
  assert.equal(cdpNetworkErrorLogCount, playwrightResourceLoadErrorCount);
  assert.equal(
    playwrightResourceLoadErrorCount,
    recoveredProtectedReadConsoleErrorCount,
  );
  assert.ok(recoveredProtectedReadConsoleErrorCount <= retryUsed);
  assert.ok(
    recoveredProtectedReadConsoleErrorCount <=
      recoveredProtectedReadTransportFailureCount,
  );
  if (recoveredProtectedReadConsoleErrorCount === 0) {
    assert.equal(playwrightFailureConsoleEchoClass, null);
    assert.equal(playwrightFailureConsoleCdpNetworkIdentityBound, null);
    return;
  }
  assert.equal(playwrightFailureConsoleEchoClass, "resource-load-failed");
  assert.equal(playwrightFailureConsoleCdpNetworkIdentityBound, true);
};
const protectedReadRetryConsoleEvidenceWithoutRecoveryFixture = {
  retryUsed: 0,
  recoveredProtectedReadTransportFailureCount: 0,
  cdpNetworkErrorLogCount: 0,
  playwrightResourceLoadErrorCount: 0,
  playwrightFailureConsoleEchoClass: null,
  playwrightFailureConsoleCdpNetworkIdentityBound: null,
  recoveredProtectedReadConsoleErrorCount: 0,
};
const protectedReadRetryConsoleEvidenceWithRecoveryFixture = {
  retryUsed: 1,
  recoveredProtectedReadTransportFailureCount: 1,
  cdpNetworkErrorLogCount: 1,
  playwrightResourceLoadErrorCount: 1,
  playwrightFailureConsoleEchoClass: "resource-load-failed",
  playwrightFailureConsoleCdpNetworkIdentityBound: true,
  recoveredProtectedReadConsoleErrorCount: 1,
};
const protectedReadRetryConsoleEvidenceWithDualRecoveryFixture = {
  ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
  retryUsed: 2,
  recoveredProtectedReadTransportFailureCount: 2,
  cdpNetworkErrorLogCount: 2,
  playwrightResourceLoadErrorCount: 2,
  recoveredProtectedReadConsoleErrorCount: 2,
};
for (const validFixture of [
  protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
  protectedReadRetryConsoleEvidenceWithRecoveryFixture,
  protectedReadRetryConsoleEvidenceWithDualRecoveryFixture,
]) {
  assert.doesNotThrow(() =>
    assertProtectedReadRetryConsoleEvidence(validFixture),
  );
}
for (const invalidFixture of [
  {
    ...protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
    cdpNetworkErrorLogCount: 1,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
    playwrightResourceLoadErrorCount: 1,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
    recoveredProtectedReadConsoleErrorCount: 1,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
    playwrightFailureConsoleEchoClass: "resource-load-failed",
  },
  {
    ...protectedReadRetryConsoleEvidenceWithoutRecoveryFixture,
    playwrightFailureConsoleCdpNetworkIdentityBound: true,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
    retryUsed: 0,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
    recoveredProtectedReadTransportFailureCount: 0,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
    playwrightFailureConsoleEchoClass: "other",
  },
  {
    ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
    playwrightFailureConsoleCdpNetworkIdentityBound: false,
  },
  {
    ...protectedReadRetryConsoleEvidenceWithRecoveryFixture,
    cdpNetworkErrorLogCount: 2,
  },
]) {
  assert.throws(() => assertProtectedReadRetryConsoleEvidence(invalidFixture));
}
const protectedReadRetryGroupKeys = new Set();
const assertProtectedReadTransportResetEvidence = (attestation) => {
  assert.equal(
    attestation.transportResetPolicyId,
    "w10p-protected-read-exact-firestore-tunnel-reset-v2",
  );
  assert.equal(attestation.transportResetUsed, attestation.retryUsed);
  assert.deepEqual(attestation.transportResetTargets, attestation.retryTargets);
  assert.equal(
    Array.isArray(attestation.transportResetRecoveryAttestations),
    true,
  );
  assert.equal(
    attestation.transportResetRecoveryAttestations.length,
    attestation.retryUsed,
  );
  for (const [
    index,
    recovery,
  ] of attestation.transportResetRecoveryAttestations.entries()) {
    assertExactObjectKeys(recovery, [
      "freshConnectAttestation",
      "target",
      "transportResetAttestation",
    ]);
    const target = attestation.retryTargets[index];
    assert.equal(recovery.target, target);
    const reset = recovery.transportResetAttestation;
    const fresh = recovery.freshConnectAttestation;
    assertExactObjectKeys(reset, [
      "activeAuthorityTunnelCountAfter",
      "activeAuthorityTunnelCountBefore",
      "authorityDrained",
      "authorizationSingletonTunnelSequence",
      "creatorLeaseConsumeSequence",
      "creatorLeaseIssueSequence",
      "currentTunnelClassBefore",
      "failedAttemptNumber",
      "failedAuthorizationCompletionOrderSequence",
      "failedAuthorizationCompletedBeforeRetirement",
      "failedLeaseClass",
      "failedLeaseConsumedTunnelSequence",
      "failedLeaseConsumeSequence",
      "failedLeaseIssueSequence",
      "failedRequestLocalFailureCompletedBeforeRetirement",
      "hostname",
      "localFailRequestCompletionOrderSequence",
      "noSameAuthorityAuthorizationBeforeRetirement",
      "otherAuthorityTunnelTargetingExcluded",
      "otherAuthorityTunnelRetirementCount",
      "policyId",
      "releasedResponseStreamNonterminalCountAtPreparation",
      "releasedResponseStreamNonterminalCountBeforeRetirement",
      "releasedResponseStreamUnknownOrUnboundCountAtPreparation",
      "releasedResponseStreamUnknownOrUnboundCountBeforeRetirement",
      "resetPreparationOrderSequence",
      "retiredClientSocketCount",
      "retiredTunnelSequence",
      "retiredUpstreamSocketCount",
      "retirementBasis",
      "retirementCompleteSequence",
      "retirementDrainCompletionOrderSequence",
      "retirementBinding",
      "retryBarrierReleaseOrderSequence",
      "retryAttemptNumber",
      "sameAuthorityAuthorizationCountAtPreparation",
      "schemaVersion",
      "singletonAuthorityTunnelBound",
      "stage",
      "target",
    ]);
    assert.equal(reset.schemaVersion, 3);
    assert.equal(reset.policyId, attestation.transportResetPolicyId);
    assert.equal(reset.hostname, "firestore.googleapis.com");
    assert.equal(reset.stage, attestation.stage);
    assert.equal(reset.target, target);
    assert.equal(reset.failedAttemptNumber, 1);
    assert.equal(reset.retryAttemptNumber, 2);
    assert.ok(
      ["issued-active-tunnel", "consumed-active-tunnel"].includes(
        reset.failedLeaseClass,
      ),
    );
    const expectedRetirementContract =
      reset.failedLeaseClass === "issued-active-tunnel"
        ? {
            retirementBasis: "authorization-time-singleton-tunnel-snapshot",
            retirementBinding:
              "authorization-singleton-sequence-current-identity",
          }
        : {
            retirementBasis: "failed-lease-consumed-tunnel",
            retirementBinding:
              "failed-lease-consumed-sequence-current-identity",
          };
    assert.equal(
      reset.retirementBasis,
      expectedRetirementContract.retirementBasis,
    );
    assert.equal(
      reset.retirementBinding,
      expectedRetirementContract.retirementBinding,
    );
    assert.equal(reset.currentTunnelClassBefore, "current-active-tunnel");
    assert.equal(reset.singletonAuthorityTunnelBound, true);
    assert.equal(reset.sameAuthorityAuthorizationCountAtPreparation, 1);
    assert.equal(reset.failedAuthorizationCompletedBeforeRetirement, true);
    assert.equal(
      reset.failedRequestLocalFailureCompletedBeforeRetirement,
      true,
    );
    assert.equal(reset.noSameAuthorityAuthorizationBeforeRetirement, true);
    assert.equal(reset.otherAuthorityTunnelRetirementCount, 0);
    assert.equal(reset.otherAuthorityTunnelTargetingExcluded, true);
    assert.equal(reset.activeAuthorityTunnelCountBefore, 1);
    assert.equal(reset.retiredClientSocketCount, 1);
    assert.equal(reset.retiredUpstreamSocketCount, 1);
    assert.equal(reset.activeAuthorityTunnelCountAfter, 0);
    assert.equal(reset.authorityDrained, true);
    for (const field of [
      "releasedResponseStreamNonterminalCountAtPreparation",
      "releasedResponseStreamNonterminalCountBeforeRetirement",
      "releasedResponseStreamUnknownOrUnboundCountAtPreparation",
      "releasedResponseStreamUnknownOrUnboundCountBeforeRetirement",
    ]) {
      assert.equal(reset[field], 0);
    }
    for (const field of [
      "failedLeaseIssueSequence",
      "creatorLeaseIssueSequence",
      "creatorLeaseConsumeSequence",
      "retiredTunnelSequence",
      "retirementCompleteSequence",
      "resetPreparationOrderSequence",
      "failedAuthorizationCompletionOrderSequence",
      "localFailRequestCompletionOrderSequence",
      "retirementDrainCompletionOrderSequence",
      "retryBarrierReleaseOrderSequence",
    ]) {
      assert.equal(Number.isSafeInteger(reset[field]), true);
      assert.ok(reset[field] > 0);
    }
    assert.ok(
      reset.retirementCompleteSequence >
        Math.max(
          reset.failedLeaseIssueSequence,
          reset.creatorLeaseIssueSequence,
          reset.creatorLeaseConsumeSequence,
        ),
    );
    assertProtectedReadTransportResetLeaseSequenceInvariant(reset);
    assertExactObjectKeys(fresh, [
      "activeTunnelPresentAtAuthorization",
      "freshConnectConsumedLease",
      "freshLeaseIssued",
      "freshTunnelSequence",
      "hostname",
      "leaseIssueSequenceAdvanced",
      "policyId",
      "requestBound",
      "retryAttemptNumber",
      "retryLeaseClass",
      "retryLeaseConsumeSequence",
      "retryLeaseIssueSequence",
      "sameAuthorityActiveAuthorizationCount",
      "schemaVersion",
      "stage",
      "target",
      "tunnelSequenceAdvanced",
    ]);
    assert.equal(fresh.schemaVersion, 1);
    assert.equal(fresh.policyId, attestation.transportResetPolicyId);
    assert.equal(fresh.hostname, "firestore.googleapis.com");
    assert.equal(fresh.stage, attestation.stage);
    assert.equal(fresh.target, target);
    assert.equal(fresh.retryAttemptNumber, 2);
    assert.equal(fresh.requestBound, true);
    assert.equal(fresh.activeTunnelPresentAtAuthorization, false);
    assert.equal(fresh.retryLeaseClass, "consumed-no-active-tunnel");
    assert.equal(fresh.freshLeaseIssued, true);
    assert.equal(fresh.freshConnectConsumedLease, true);
    assert.equal(fresh.leaseIssueSequenceAdvanced, true);
    assert.equal(fresh.tunnelSequenceAdvanced, true);
    assert.equal(fresh.sameAuthorityActiveAuthorizationCount, 1);
    for (const field of [
      "retryLeaseIssueSequence",
      "retryLeaseConsumeSequence",
      "freshTunnelSequence",
    ]) {
      assert.equal(Number.isSafeInteger(fresh[field]), true);
      assert.ok(fresh[field] > 0);
    }
    assert.ok(fresh.retryLeaseIssueSequence > reset.retirementCompleteSequence);
    assert.ok(fresh.retryLeaseConsumeSequence > fresh.retryLeaseIssueSequence);
    assert.ok(fresh.freshTunnelSequence > reset.retiredTunnelSequence);
  }
  for (
    let index = 1;
    index < attestation.transportResetRecoveryAttestations.length;
    index += 1
  ) {
    const previous = attestation.transportResetRecoveryAttestations[index - 1];
    const current = attestation.transportResetRecoveryAttestations[index];
    assert.ok(
      previous.transportResetAttestation.retryBarrierReleaseOrderSequence <
        current.transportResetAttestation.resetPreparationOrderSequence,
    );
    assert.ok(
      previous.freshConnectAttestation.retryLeaseIssueSequence <
        current.transportResetAttestation.failedLeaseIssueSequence,
    );
    assert.ok(
      previous.freshConnectAttestation.freshTunnelSequence <=
        current.transportResetAttestation.retiredTunnelSequence,
    );
  }
};
for (const attestation of authenticationProtectedReadRetry.attestations) {
  assertExactObjectKeys(attestation, [
    "authTimeUnchanged",
    "authenticationRole",
    "cdpAppCheckHeaderJwtShapeValid",
    "cdpAuthorizationHeaderJwtShapeValid",
    "cdpConfigFinalResponseClass",
    "cdpConfigFirstResponseClass",
    "cdpExactFetchNetworkIdentityBound",
    "cdpLoadingFailureBlockedReasonClass",
    "cdpLoadingFailureCorsErrorStatusAbsent",
    "cdpLoadingFailureEchoClass",
    "cdpLoadingFailureFetchNetworkIdentityBound",
    "cdpLoadingFailureLocalFailRequestTimingClass",
    "cdpLocalFailRequestCommandCompleted",
    "cdpLocalFailRequestCommandIssued",
    "cdpLocalFailRequestErrorReasonClass",
    "cdpLocalFailRequestExactAttemptBound",
    "cdpLocalFailRequestIssuerClass",
    "cdpLocalFailRequestResponseErrorBound",
    "cdpLocalFailRequestResponseFetchCorrelationClass",
    "cdpNetworkErrorLogCount",
    "cdpProfileFinalResponseClass",
    "cdpProfileFirstResponseClass",
    "cdpSameAppCheckHeader",
    "cdpSameAuthorizationHeader",
    "configAttemptCount",
    "configFinalOutcomeClass",
    "configFirstOutcomeClass",
    "exactUrlMethodBound",
    "groupKey",
    "passed",
    "playwrightFailureConsoleCdpNetworkIdentityBound",
    "playwrightFailureConsoleEchoClass",
    "playwrightFailureEchoClass",
    "playwrightRequestFailureFetchNetworkIdentityBound",
    "playwrightResourceLoadErrorCount",
    "policyId",
    "profileAttemptCount",
    "profileFinalOutcomeClass",
    "profileFirstOutcomeClass",
    "recoveredByRetry",
    "recoveredProtectedReadConsoleErrorCount",
    "recoveredProtectedReadTransportFailureCount",
    "retryBudgetPerGroup",
    "retryBudgetPerTarget",
    "retryDelayMs",
    "retryTargets",
    "retryUsed",
    "role",
    "sameAppCheckToken",
    "sameAuthorizationToken",
    "schemaVersion",
    "sessionMutationCount",
    "sessionRevisionUnchanged",
    "stage",
    "tokenRefreshCount",
    "transportResetPolicyId",
    "transportResetRecoveryAttestations",
    "transportResetTargets",
    "transportResetUsed",
    "viewport",
  ]);
  assert.equal(attestation.schemaVersion, 6);
  assert.equal(attestation.policyId, authenticationProtectedReadRetry.policyId);
  assert.equal(attestation.retryBudgetPerTarget, 1);
  assert.equal(attestation.retryBudgetPerGroup, 2);
  assert.equal(attestation.retryDelayMs, 2_000);
  assert.ok(["baseline", "candidate"].includes(attestation.stage));
  assert.ok(Object.hasOwn(protectedReadRetryRolePairs, attestation.role));
  assert.equal(
    attestation.authenticationRole,
    protectedReadRetryRolePairs[attestation.role],
  );
  assert.match(attestation.viewport, /^\d+x\d+$/u);
  assert.equal(
    attestation.groupKey,
    `${attestation.stage}:${attestation.role}:${attestation.viewport}`,
  );
  assert.equal(protectedReadRetryGroupKeys.has(attestation.groupKey), false);
  protectedReadRetryGroupKeys.add(attestation.groupKey);
  assert.equal(Array.isArray(attestation.retryTargets), true);
  assert.deepEqual(
    attestation.retryTargets,
    ["config", "profile"].filter((target) =>
      attestation.retryTargets.includes(target),
    ),
  );
  assert.equal(
    new Set(attestation.retryTargets).size,
    attestation.retryTargets.length,
  );
  assert.ok([0, 1, 2].includes(attestation.retryUsed));
  assert.equal(attestation.retryUsed, attestation.retryTargets.length);
  assertProtectedReadRetryPlaywrightFailureEchoClass(attestation);
  assertProtectedReadRetryCdpLoadingFailureEchoClass(attestation);
  assertProtectedReadRetryConsoleEvidence(attestation);
  assertProtectedReadTransportResetEvidence(attestation);
  assert.equal(attestation.recoveredByRetry, attestation.retryUsed > 0);
  assert.equal(
    attestation.recoveredProtectedReadTransportFailureCount,
    attestation.retryUsed,
  );
  assert.equal(
    attestation.configAttemptCount,
    attestation.retryTargets.includes("config") ? 2 : 1,
  );
  assert.equal(
    attestation.profileAttemptCount,
    attestation.retryTargets.includes("profile") ? 2 : 1,
  );
  assert.equal(
    attestation.configAttemptCount + attestation.profileAttemptCount,
    2 + attestation.retryUsed,
  );
  assert.equal(
    attestation.configFirstOutcomeClass,
    attestation.retryTargets.includes("config")
      ? "transport-error"
      : "response-2xx",
  );
  assert.equal(attestation.configFinalOutcomeClass, "response-2xx");
  assert.equal(
    attestation.profileFirstOutcomeClass,
    attestation.retryTargets.includes("profile")
      ? "transport-error"
      : "response-2xx",
  );
  assert.equal(attestation.profileFinalOutcomeClass, "response-2xx");
  assert.equal(
    attestation.cdpConfigFirstResponseClass,
    attestation.retryTargets.includes("config")
      ? "response-error-failed"
      : "response-2xx",
  );
  assert.equal(attestation.cdpConfigFinalResponseClass, "response-2xx");
  assert.equal(
    attestation.cdpProfileFirstResponseClass,
    attestation.retryTargets.includes("profile")
      ? "response-error-failed"
      : "response-2xx",
  );
  assert.equal(attestation.cdpProfileFinalResponseClass, "response-2xx");
  for (const field of [
    "authTimeUnchanged",
    "cdpAppCheckHeaderJwtShapeValid",
    "cdpAuthorizationHeaderJwtShapeValid",
    "cdpExactFetchNetworkIdentityBound",
    "cdpSameAppCheckHeader",
    "cdpSameAuthorizationHeader",
    "exactUrlMethodBound",
    "passed",
    "playwrightRequestFailureFetchNetworkIdentityBound",
    "sameAppCheckToken",
    "sameAuthorizationToken",
    "sessionRevisionUnchanged",
  ]) {
    assert.equal(attestation[field], true);
  }
  assert.equal(attestation.tokenRefreshCount, 0);
  assert.equal(attestation.sessionMutationCount, 0);
}
const frozenBaselineAuthenticationAnomalyRetirement =
  assertFrozenBaselineAuthenticationAnomalyRetirement({
    retirement: manifest.frozenBaselineAuthenticationAnomalyRetirement,
    expectedGroupKeys: authenticationProtectedReadRetry.attestations.map(
      ({ groupKey }) => groupKey,
    ),
    expectedPresentationSourceCommit:
      manifest.baselineDeployment?.sourceCommitSha,
  });
assert.equal(
  authenticationProtectedReadRetry.observedProtectedReadTransportFailureCount,
  authenticationProtectedReadRetry.attestations.reduce(
    (total, attestation) => total + attestation.retryUsed,
    0,
  ),
);
assert.equal(
  authenticationProtectedReadRetry.recoveredProtectedReadTransportFailureCount,
  authenticationProtectedReadRetry.attestations.reduce(
    (total, attestation) =>
      total + attestation.recoveredProtectedReadTransportFailureCount,
    0,
  ),
);
assert.equal(
  authenticationProtectedReadRetry.browserConsoleErrorRecoveredCount,
  authenticationProtectedReadRetry.attestations.reduce(
    (total, attestation) =>
      total + attestation.recoveredProtectedReadConsoleErrorCount,
    0,
  ) +
    frozenBaselineAuthenticationAnomalyRetirement.retiredExactConsoleErrorCount,
);
assert.equal(
  authenticationProtectedReadRetry.browserConsoleErrorObservedCount,
  authenticationProtectedReadRetry.browserConsoleErrorRecoveredCount +
    authenticationProtectedReadRetry.browserConsoleErrorFatalCount,
);
assert.equal(authenticationProtectedReadRetry.browserConsoleErrorFatalCount, 0);
assert.ok(
  authenticationProtectedReadRetry.browserConsoleErrorObservedCount >=
    authenticationProtectedReadRetry.browserConsoleErrorRecoveredCount,
);
for (const [observedField, recoveredField, fatalField] of [
  [
    "observedProtectedReadTransportFailureCount",
    "recoveredProtectedReadTransportFailureCount",
    "fatalProtectedReadTransportFailureCount",
  ],
  [
    "browserRequestFailureObservedCount",
    "browserRequestFailureRecoveredCount",
    "browserRequestFailureFatalCount",
  ],
  [
    "allowedEgressResponseErrorObservedCount",
    "allowedEgressResponseErrorRecoveredCount",
    "allowedEgressResponseErrorFatalCount",
  ],
  [
    "sensitiveAppCheckResponseErrorObservedCount",
    "sensitiveAppCheckResponseErrorRecoveredCount",
    "sensitiveAppCheckResponseErrorFatalCount",
  ],
]) {
  assert.equal(
    authenticationProtectedReadRetry[observedField],
    authenticationProtectedReadRetry[recoveredField] +
      authenticationProtectedReadRetry[fatalField],
  );
  assert.equal(authenticationProtectedReadRetry[fatalField], 0);
  assert.equal(
    authenticationProtectedReadRetry[recoveredField],
    authenticationProtectedReadRetry.recoveredProtectedReadTransportFailureCount,
  );
}
const networkSummary = manifest.networkSummary;
for (const field of [
  "requestCount",
  "responseCount",
  "firebaseRequestCount",
  "nonFirebaseRequestCount",
  "nonFirebaseAllowedRequestCount",
  "nonFirebaseUnallowlistedRequestCount",
  "nonFirebaseUnallowlistedResponseCount",
  "productionVercelRequestCount",
  "productionVercelResponseCount",
  "unknownVercelRequestCount",
  "unknownVercelResponseCount",
  "stagingFirebaseRequestCount",
  "stagingFirebaseResponseCount",
  "stagingDataRequestCount",
  "stagingDataResponseCount",
  "appCheckExchangeRequestCount",
  "successfulAppCheckExchangeResponseCount",
  "appCheckProtectedDataRequestCount",
  "appCheckHeaderPresentRequestCount",
  "appCheckHeaderMissingRequestCount",
  "appCheckHeaderJwtShapeValidRequestCount",
  "appCheckHeaderJwtShapeInvalidRequestCount",
  "rawAppCheckHeaderValueOutputCount",
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
assert.equal(
  networkSummary.nonFirebaseRequestCount,
  networkSummary.nonFirebaseAllowedRequestCount,
);
for (const field of [
  "nonFirebaseUnallowlistedRequestCount",
  "nonFirebaseUnallowlistedResponseCount",
  "productionVercelRequestCount",
  "productionVercelResponseCount",
  "unknownVercelRequestCount",
  "unknownVercelResponseCount",
]) {
  assert.equal(networkSummary[field], 0);
}
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
assert.deepEqual(networkSummary.nonFirebaseUnallowlistedRequestHosts, []);
assert.deepEqual(networkSummary.productionVercelRequestHosts, []);
assert.deepEqual(networkSummary.unknownVercelRequestHosts, []);
assert.deepEqual(networkSummary.observedFirebaseApiKeySha256s, [
  manifest.environment.firebaseConfig.apiKeySha256,
]);
assert.equal(networkSummary.failedFirebaseResponseCount, 0);
assert.ok(networkSummary.appCheckExchangeRequestCount > 0);
assert.equal(
  networkSummary.successfulAppCheckExchangeResponseCount,
  networkSummary.appCheckExchangeRequestCount,
);
assert.ok(networkSummary.appCheckProtectedDataRequestCount > 0);
assert.equal(networkSummary.appCheckHeaderMissingRequestCount, 0);
assert.equal(networkSummary.appCheckHeaderJwtShapeInvalidRequestCount, 0);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeValidRequestCount,
  networkSummary.appCheckProtectedDataRequestCount,
);
assert.equal(networkSummary.rawAppCheckHeaderValueOutputCount, 0);
assert.equal(manifest.status, "CAPTURED");
const startedAt = isoTime(manifest.startedAt, "manifest.startedAt");
const completedAt = isoTime(manifest.completedAt, "manifest.completedAt");
assert.ok(completedAt >= startedAt);

assert.deepEqual(
  manifest.fixtureAudit,
  {
    fileName: "fixture-audit.json",
    sha256: manifest.fixtureAudit?.sha256,
    artifactSchemaVersion: "w10p-visual-fixture-audit-v2",
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
assertNoAppCheckSecretMaterial(fixtureAuditText);
if (verifierVercelBypassSecret) {
  assert.equal(fixtureAuditText.includes(verifierVercelBypassSecret), false);
}
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
);
assert.equal(
  fixtureAudit.captureBindingHash,
  manifest.fixtureAudit.captureBindingHash,
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
  fixtureAudit.isolation.preBackupAccessProbe.appCheckDebugTokenHash,
  fixtureAudit.isolation.liveBackupAccessProbe.appCheckDebugTokenHash,
  "Pre/post probes used different App Check debug registrations.",
);
assert.equal(
  fixtureAudit.captureBinding?.appCheckDebugTokenHash,
  fixtureAudit.isolation.preBackupAccessProbe.appCheckDebugTokenHash,
);
assert.equal(
  fixtureAudit.captureBinding?.verifiedAppIdHash,
  sha256(STAGING_APP_ID),
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
  assert.equal(fixtureAudit.captureBinding?.[field], expectedHash);
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
assert.equal(fixtureAudit.strict?.collectionCount, 64);
assert.equal(fixtureAudit.strict?.expectedRowCount, 52);
assert.equal(fixtureAudit.strict?.actualRowCount, 52);
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
const { issuedAt: fixtureIssuedAt, expiresAt: fixtureExpiresAt } =
  assertFixtureAuditFreshnessBinding({
    freshness: fixtureAudit.freshness,
    captureBindingFreshness: fixtureAudit.captureBinding?.freshness,
    expectedFixedTime: contract.fixedTime,
  });
assert.equal(manifest.fixtureAudit.issuedAt, fixtureAudit.freshness.issuedAt);
assert.equal(manifest.fixtureAudit.expiresAt, fixtureAudit.freshness.expiresAt);
assertFixtureAuditCaptureWindow({
  issuedAt: fixtureIssuedAt,
  expiresAt: fixtureExpiresAt,
  startedAt,
  completedAt,
});

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
assertExactObjectKeys(manifest.authenticationLandingGuard, [
  "id",
  "storage",
  "scope",
  "purpose",
  "roles",
  "markerCount",
  "markerSetSha256",
  "expectedGroupCount",
  "initScriptRegistrationCount",
  "storageAttestationCount",
  "browserDateAttestationCount",
]);
assert.equal(
  manifest.authenticationLandingGuard.id,
  authenticationLandingGuard.id,
);
assert.equal(
  manifest.authenticationLandingGuard.storage,
  authenticationLandingGuard.storage,
);
assert.equal(
  manifest.authenticationLandingGuard.scope,
  authenticationLandingGuard.scope,
);
assert.equal(
  manifest.authenticationLandingGuard.purpose,
  authenticationLandingGuard.purpose,
);
assert.deepEqual(
  manifest.authenticationLandingGuard.roles,
  authenticationLandingGuard.roles,
);
assert.equal(
  manifest.authenticationLandingGuard.markerCount,
  authenticationLandingGuard.markers.length,
);
assert.equal(
  manifest.authenticationLandingGuard.markerSetSha256,
  sha256(canonicalJson(authenticationLandingGuard.markers)),
);
assert.ok(manifest.authenticationLandingGuard.expectedGroupCount > 0);
assert.equal(
  manifest.authenticationLandingGuard.initScriptRegistrationCount,
  manifest.authenticationLandingGuard.expectedGroupCount,
);
assert.equal(
  manifest.authenticationLandingGuard.storageAttestationCount,
  manifest.authenticationLandingGuard.expectedGroupCount,
);
assert.equal(
  manifest.authenticationLandingGuard.browserDateAttestationCount,
  manifest.authenticationLandingGuard.expectedGroupCount,
);
assert.equal(manifest.environment?.fixtureId, contract.fixtureId);
assert.equal(manifest.environment?.fixtureRevision, contract.fixtureRevision);
assert.equal(manifest.environment?.fixturePlanHash, contract.fixturePlanHash);
assert.equal(
  manifest.environment?.fixtureCaptureBindingHash,
  manifest.fixtureAudit.captureBindingHash,
);
assertExactObjectKeys(manifest.environment?.firebaseConfig, [
  "projectId",
  "authDomain",
  "storageBucket",
  "messagingSenderId",
  "apiKeySha256",
  "appIdSha256",
]);
assert.equal(
  manifest.environment?.firebaseConfig?.projectId,
  contract.firebaseProjectId,
);
assert.equal(
  contract.firebaseConfigBinding.allowedAuthDomains.includes(
    String(manifest.environment?.firebaseConfig?.authDomain ?? ""),
  ),
  true,
);
assert.equal(
  manifest.environment?.firebaseConfig?.messagingSenderId,
  contract.firebaseConfigBinding.messagingSenderId,
);
assert.match(
  String(manifest.environment?.firebaseConfig?.storageBucket ?? ""),
  new RegExp(
    `^${contract.firebaseProjectId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    )}\\.(?:appspot\\.com|firebasestorage\\.app)$`,
    "u",
  ),
  "The capture manifest storage bucket is outside the exact staging boundary.",
);
assert.match(
  manifest.environment?.firebaseConfig?.apiKeySha256 ?? "",
  /^[a-f0-9]{64}$/u,
);
assert.match(
  manifest.environment?.firebaseConfig?.appIdSha256 ?? "",
  /^[a-f0-9]{64}$/u,
);
assert.equal(manifest.environment?.locale, "ko-KR");
assert.equal(manifest.environment?.timezone, "Asia/Seoul");
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
    "appCheckBound",
    "emailSha256",
    "profileRole",
    "role",
    "staffPermissions",
    "teacherPortalEnabled",
    "tokenRole",
    "uidSha256",
  ]);
  assert.equal(attestation.role, role);
  assert.equal(attestation.appCheckBound, true);
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
let liveDeploymentRedirectResponseCount = 0;
let verifierVercelBypassHeaderRequestCount = 0;
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
    const expectedDeployment = contract.deploymentVerification?.[stage];
    assert.deepEqual(
      Object.keys(expectedDeployment ?? {}).sort(),
      ["apiTarget", "gitCommitRef", "inspectTarget"],
      `${stage} deployment verification contract is invalid.`,
    );
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
    assert.equal(inspected.target, expectedDeployment.inspectTarget);
    assert.equal(api.id, deployment.id);
    assert.equal(api.projectId ?? api.project?.id, contract.vercelProjectId);
    assert.equal(api.readyState, "READY");
    assert.equal(api.target, expectedDeployment.apiTarget);
    assert.equal(
      api.meta?.gitCommitSha,
      deployment.sourceCommitSha,
      `${stage} Vercel source commit drifted.`,
    );
    assert.equal(api.meta?.gitCommitRef, expectedDeployment.gitCommitRef);
  }
  const htmlHeaders = {
    "cache-control": "no-cache",
    ...(verifierVercelBypassSecret
      ? { "x-vercel-protection-bypass": verifierVercelBypassSecret }
      : {}),
  };
  for (const [stage, url, expectedHtmlSha, inspectAssets] of [
    [
      "baseline",
      manifest.baselineDeployment.url,
      manifest.baselineDeployment.htmlSha256,
      true,
    ],
    [
      "candidate",
      manifest.candidateDeployment.url,
      manifest.candidateDeployment.htmlSha256,
      true,
    ],
    [
      "candidate-alias",
      contract.stableAlias,
      manifest.candidateDeployment.htmlSha256,
      false,
    ],
  ]) {
    const htmlUrl = new URL(url);
    assert.ok(vercelBypassAllowedOrigins.includes(exactVercelOrigin(htmlUrl)));
    assert.equal(htmlUrl.pathname, "/");
    assert.equal(htmlUrl.search, "");
    assert.equal(htmlUrl.hash, "");
    const response = await fetch(htmlUrl, {
      redirect: "error",
      headers: htmlHeaders,
    });
    if (verifierVercelBypassSecret) {
      verifierVercelBypassHeaderRequestCount += 1;
    }
    if (response.status >= 300 && response.status < 400) {
      liveDeploymentRedirectResponseCount += 1;
    }
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
    if (!inspectAssets) continue;
    let combinedBundleSource = "";
    for (const asset of deployment.firebaseBundle.assets) {
      const assetUrl = new URL(asset.path, htmlUrl);
      assert.equal(exactVercelOrigin(assetUrl), htmlUrl.origin);
      const assetResponse = await fetch(assetUrl, {
        redirect: "error",
        headers: htmlHeaders,
      });
      if (verifierVercelBypassSecret) {
        verifierVercelBypassHeaderRequestCount += 1;
      }
      if (assetResponse.status >= 300 && assetResponse.status < 400) {
        liveDeploymentRedirectResponseCount += 1;
      }
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
  assert.equal(liveDeploymentRedirectResponseCount, 0);
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
    "nonFirebaseRequestCount",
    "nonFirebaseAllowedRequestCount",
    "nonFirebaseUnallowlistedRequestCount",
    "nonFirebaseUnallowlistedResponseCount",
    "productionVercelRequestCount",
    "productionVercelResponseCount",
    "unknownVercelRequestCount",
    "unknownVercelResponseCount",
    "stagingFirebaseRequestCount",
    "stagingFirebaseResponseCount",
    "stagingDataRequestCount",
    "stagingDataResponseCount",
    "appCheckExchangeRequestCount",
    "successfulAppCheckExchangeResponseCount",
    "appCheckProtectedDataRequestCount",
    "appCheckHeaderPresentRequestCount",
    "appCheckHeaderMissingRequestCount",
    "appCheckHeaderJwtShapeValidRequestCount",
    "appCheckHeaderJwtShapeInvalidRequestCount",
    "rawAppCheckHeaderValueOutputCount",
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
  assert.equal(
    capture.network.nonFirebaseRequestCount,
    capture.network.nonFirebaseAllowedRequestCount,
  );
  for (const field of [
    "nonFirebaseUnallowlistedRequestCount",
    "nonFirebaseUnallowlistedResponseCount",
    "productionVercelRequestCount",
    "productionVercelResponseCount",
    "unknownVercelRequestCount",
    "unknownVercelResponseCount",
  ]) {
    assert.equal(capture.network[field], 0);
  }
  assert.equal(capture.network.failedFirebaseResponseCount, 0);
  assert.equal(capture.network.rawAppCheckHeaderValueOutputCount, 0);
  assert.equal(capture.network.appCheckHeaderJwtShapeInvalidRequestCount, 0);
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
  assert.deepEqual(capture.network.nonFirebaseUnallowlistedRequestHosts, []);
  assert.deepEqual(capture.network.productionVercelRequestHosts, []);
  assert.deepEqual(capture.network.unknownVercelRequestHosts, []);
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
  const observedOrigin = stableBrowserOrigin;
  assert.equal(capture.sourceCommitSha, sourceCommitSha);
  assert.equal(capture.observedOrigin, observedOrigin);
  assert.equal(new URL(capture.finalUrl).origin, observedOrigin);
  assert.equal(
    normalizedRouteFromUrl(capture.finalUrl),
    decodeURIComponent(capture.route),
    `${capture.id} browser URL does not match the captured route.`,
  );
  assert.equal(
    new URL(capture.performanceNavigationUrl).origin,
    observedOrigin,
    `${capture.id} navigation trace came from another origin.`,
  );
  assertStableOriginRewriteSummary(capture.upstreamProvenance, capture.stage);
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

const authenticationRoleForCapture = (capture) =>
  contract.captureAuthenticationRoles[capture.screenId] ??
  (capture.role === "support" ? null : capture.role);
const expectedAuditCaptures = new Map();
const expectedAuthenticationLandingGuardAuditIds = new Set();
for (const capture of captures.values()) {
  const authenticationRole = authenticationRoleForCapture(capture);
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
  if (authenticationLandingGuard.roles.includes(authenticationRole)) {
    expectedAuthenticationLandingGuardAuditIds.add(auditId);
  }
}
const expectedProtectedReadRetryAuditIds = new Set(
  [...captures.values()]
    .filter((capture) => Boolean(authenticationRoleForCapture(capture)))
    .map((capture) => {
      const authenticationRole = authenticationRoleForCapture(capture);
      const auditRole =
        capture.role === "support"
          ? `support-${authenticationRole}`
          : capture.role;
      return `${capture.stage}:${auditRole}:${viewportKey(capture.viewport)}`;
    }),
);
assert.equal(
  authenticationProtectedReadRetry.expectedGroupCount,
  expectedProtectedReadRetryAuditIds.size,
);
assert.deepEqual(
  [...protectedReadRetryGroupKeys].sort(),
  [...expectedProtectedReadRetryAuditIds].sort(),
);
assert.equal(
  manifest.authenticationLandingGuard.expectedGroupCount,
  expectedAuthenticationLandingGuardAuditIds.size,
);
assert.equal(Array.isArray(manifest.browserAudits), true);
assert.equal(manifest.browserAudits.length, expectedAuditCaptures.size);
const representedAuditFiles = new Set();
const capturesRepresentedByAudit = new Set();
const observedAuditIds = new Set();
let auditedStagingFirebaseRequests = 0;
let auditedProductionAccess = 0;
let auditedProductionWrites = 0;
let auditedNetworkRequests = 0;
let auditedNetworkResponses = 0;
let auditedNonFirebaseRequests = 0;
let auditedNonFirebaseAllowedRequests = 0;
let auditedNonFirebaseUnallowlistedRequests = 0;
let auditedNonFirebaseUnallowlistedResponses = 0;
let auditedProductionVercelRequests = 0;
let auditedProductionVercelResponses = 0;
let auditedUnknownVercelRequests = 0;
let auditedUnknownVercelResponses = 0;
let auditedBaselineBridgeEligibleRequests = 0;
let auditedBaselineBridgeInjectedRequests = 0;
let auditedBaselineBridgeNativeHeaderRequests = 0;
let auditedBaselineBridgeScopeMismatches = 0;
let auditedBaselineBridgeStrippedHeaders = 0;
let auditedBaselineBridgeRedirectRequests = 0;
let auditedBaselineBridgeRedirectHeaderAbsentRequests = 0;
let auditedBaselineBridgeRedirectAbortRequests = 0;
let auditedBaselineBridgeCdpPausedRequests = 0;
let auditedBaselineBridgeCdpResponsePausedRequests = 0;
let auditedBaselineBridgeCdpReconciledRequests = 0;
let auditedWebChannelCdpHeaderAttestationRegisteredRequests = 0;
let auditedWebChannelCdpHeaderAttestationCompletedRequests = 0;
let auditedWebChannelCdpHeaderAttestationBoundRequests = 0;
let auditedWebChannelCdpHeaderAttestationBindingResiduals = 0;
let auditedWebChannelCdpHeaderAttestationBindingFailures = 0;
let auditedWebChannelCdpHeaderAttestationPairingTimeouts = 0;
let auditedWebChannelCdpHeaderAttestationCompletionTimeouts = 0;
let auditedAllowedEgressContextCloseBackchannelRetirements = 0;
let auditedAllowedEgressContextCloseSessionForwardPostRetirements = 0;
let auditedAllowedEgressContextCloseTerminationRetirements = 0;
let auditedWebChannelTerminationClassifiedRequests = 0;
let auditedPlaywrightAllHeadersHeaderAttestationRequests = 0;
let auditedPlaywrightAllHeadersHeaderAttestationCompletedRequests = 0;
let auditedBaselineBridgeHandlerErrors = 0;
let auditedBaselineBridgeInjectedRedirectResponseAborts = 0;
let auditedAppCheckCdpMonitorPausedRequests = 0;
let auditedPreTransmissionBoundaryInspections = 0;
let auditedPreTransmissionBoundaryBlockAttempts = 0;
let auditedPreTransmissionBoundaryProductionBlocks = 0;
let auditedPreTransmissionBoundaryCrossOriginDocumentBlocks = 0;
let auditedPreTransmissionBoundaryUnboundFirebaseBlocks = 0;
let auditedPreTransmissionBoundaryNonFirebaseHostnameBlocks = 0;
let auditedPreTransmissionBoundaryMalformedUrlBlocks = 0;
let auditedPreTransmissionBoundaryFailRequests = 0;
let auditedOptionalTelemetrySuppressedRequests = 0;
let auditedDeterministicHolidayResponseFulfills = 0;
let auditedDeterministicRecaptchaResponseFulfills = 0;
let auditedDeterministicFirebaseModuleFulfills = 0;
let auditedDeterministicResponseScopeMismatchBlocks = 0;
let auditedExternalStaticRequestNetworkFetches = 0;
let auditedExternalStaticRequestCacheFulfills = 0;
let auditedExternalStaticRequestScopeMismatchBlocks = 0;
let auditedExternalStaticResponseNon200Aborts = 0;
let auditedNodeOwnedExternalRequests = 0;
let auditedNodeOwnedExternalInformationalResponses = 0;
let auditedNodeOwnedExternalInformationalEgressHeaderObservations = 0;
let auditedNodeOwnedExternalInformationalBrowserExposures = 0;
let auditedNodeOwnedExternalFinalResponses = 0;
let auditedNodeOwnedExternalFinalBodyHashAttestations = 0;
let auditedNodeOwnedExternalFinalHeaderSuppressions = 0;
let auditedStagingApiKeyScopeViolationBlocks = 0;
let auditedTestCredentialScopeViolationBlocks = 0;
let auditedRefreshTokenScopeViolationBlocks = 0;
let auditedRawSensitivePreTransmissionInspections = 0;
let auditedRawSensitivePreTransmissionBlocks = 0;
let auditedRawProductionPreTransmissionBlocks = 0;
let auditedRawVercelBypassPreTransmissionBlocks = 0;
let auditedRawStagingApiKeyPreTransmissionBlocks = 0;
let auditedRawTestCredentialPreTransmissionBlocks = 0;
let auditedRawRefreshTokenPreTransmissionBlocks = 0;
let auditedRawDebugTokenPreTransmissionBlocks = 0;
let auditedRawDebugSentinelPreTransmissionBlocks = 0;
let auditedAllowedEgressResponsePauses = 0;
let auditedAllowedEgressInformationalResponsePauses = 0;
let auditedAllowedEgressInformationalFinalResponses = 0;
let auditedAllowedEgressInformationalTrackingResiduals = 0;
let auditedAllowedEgressInvalidResponseStatusAborts = 0;
let auditedAllowedEgressRedirectAborts = 0;
let auditedAllowedEgressHttpErrorAborts = 0;
let auditedAllowedEgressResponseErrorAborts = 0;
let auditedAllowedEgressInformationalEgressHeaderObservations = 0;
let auditedAllowedEgressFinalEgressHeaderObservations = 0;
let auditedAllowedEgressResponseHeaderSuppressions = 0;
let auditedAllowedEgressEgressHeaderForwards = 0;
let auditedAllowedEgressTrackingResiduals = 0;
let auditedExternalStaticTrackingResiduals = 0;
let auditedDirectBrowserEarlyHintsObservations = 0;
let auditedDirectBrowserEarlyHintsEgressHeaderObservations = 0;
let auditedDirectBrowserEarlyHintsCaptureInvalidations = 0;
let auditedFullPostDataResolutions = 0;
let auditedFullPostDataNetworkFallbacks = 0;
let auditedFullPostDataResolutionFailures = 0;
let auditedFullPostDataOversizeBlocks = 0;
let auditedFullPostDataRepresentationMismatchBlocks = 0;
const auditedDeterministicResponseObservations = [];
const auditedExternalStaticResponseObservations = [];
const auditedOptionalTelemetryObservations = [];
const auditedTelemetryCapabilityGuardAttestations = [];
const auditedStableOriginFaviconFallbackObservations = [];
const auditedNetworkPolicySummaries = new Map();
let auditedDebugTokenNetworkObservations = 0;
let auditedDebugSentinelNetworkObservations = 0;
let auditedAuthorizedDebugExchangeBodyReplacements = 0;
let auditedUnauthorizedDebugTokenEgresses = 0;
let auditedUnauthorizedDebugSentinelEgresses = 0;
let auditedAppCheckHeaderNetworkObservations = 0;
let auditedAuthorizedAppCheckHeaderRequests = 0;
let auditedUnauthorizedAppCheckHeaderEgresses = 0;
let auditedSensitiveAppCheckRedirectRequests = 0;
let auditedSensitiveAppCheckRedirectAborts = 0;
let auditedSensitiveAppCheckCdpResponsePausedRequests = 0;
let auditedSensitiveAppCheckRedirectResponseAborts = 0;
let auditedSensitiveAppCheckResponseErrorAborts = 0;
let auditedSensitiveAppCheckRequestTrackingResiduals = 0;
let auditedBrowserNetworkHeaderAttestationErrors = 0;
let auditedPendingBridgeDecisionResiduals = 0;
let auditedPendingBridgeObservationResiduals = 0;
let auditedUnexpectedExtraPages = 0;
let auditedUnexpectedDedicatedWorkers = 0;
let auditedUnexpectedServiceWorkers = 0;
let auditedUnexpectedCrossOriginFrames = 0;
let auditedUnexpectedOopifTargets = 0;
let auditedUnexpectedDedicatedWorkerTargets = 0;
let auditedUnexpectedSharedWorkerTargets = 0;
let auditedUnexpectedServiceWorkerTargets = 0;
let auditedRetainedOopifTargets = 0;
let auditedRetainedDedicatedWorkerTargets = 0;
let auditedRetainedSharedWorkerTargets = 0;
let auditedRetainedServiceWorkerTargets = 0;
let auditedTargetDiscoveryActivations = 0;
let auditedTargetSnapshots = 0;
let auditedPageRawDebugTokenInjections = 0;
let auditedBrowserGlobalRawDebugTokenWrites = 0;
let auditedBrowserGlobalDebugSentinelWrites = 0;
let auditedLocalStorageSecretWrites = 0;
let auditedBrowserGlobalExtraHttpHeaderRegistrations = 0;
let auditedBrowserChildEnvironmentUnexpectedKeys = 0;
let auditedVercelBypassCdpInjectedRequests = 0;
let auditedVercelBypassPreexistingHeaderObservations = 0;
let auditedUnauthorizedVercelBypassEgresses = 0;
let auditedVercelBypassCdpResponsePausedRequests = 0;
let auditedVercelBypassHttpSuccessResponses = 0;
let auditedVercelBypassHttpErrorResponses = 0;
let auditedVercelBypassRedirectRequests = 0;
let auditedVercelBypassRedirectAborts = 0;
let auditedVercelBypassRedirectResponseAborts = 0;
let auditedVercelBypassResponseErrorAborts = 0;
let auditedVercelBypassObservedEligibleRequests = 0;
let auditedVercelBypassHeaderObservedRequests = 0;
let auditedVercelBypassHeaderMissingRequests = 0;
let auditedVercelBypassHeaderMismatches = 0;
let auditedRawVercelBypassOutputs = 0;
const auditedVercelBypassConfiguredValues = new Set();
let auditedBaselineBridgeDecisionUnmatchedProtectedRequests = 0;
let auditedBaselineBridgeScopeIneligibleProtectedRequests = 0;
let auditedCandidateBridgeInjectedRequests = 0;
let auditedBaselineProtectedDataRequests = 0;
let auditedCandidateProtectedDataRequests = 0;
let auditedBaselineScreenCaptureProtectedRequests = 0;
let auditedBaselineScreenCaptureBridgeRequests = 0;
let auditedCandidateScreenCaptureProtectedRequests = 0;
let auditedCandidateScreenCaptureNativeRequests = 0;
let auditedProtectedHeaderJwtShapeInvalidRequests = 0;
let auditedProtectedHeaderPresentRequests = 0;
let auditedProtectedHeaderMissingRequests = 0;
let auditedProtectedHeaderJwtShapeValidRequests = 0;
let auditedBaselineEffectiveHeaderMissingRequests = 0;
let auditedCandidateNativeHeaderPresentRequests = 0;
let auditedCandidateNativeHeaderMissingRequests = 0;
let auditedBrowserAppCheckExchangeRequests = 0;
let auditedBrowserAppCheckExchangeHttp200Responses = 0;
let auditedFirebaseDataRedirectResponses = 0;
let auditedFirebaseDataErrorResponses = 0;
let auditedSuccessfulFirebaseDataResponses = 0;
let auditedStableOriginRewriteRequests = 0;
let auditedStableOriginRewriteResponses = 0;
let auditedStableOriginRewriteHttpSuccessResponses = 0;
let auditedStableOriginRewriteHttpErrorResponses = 0;
let auditedStableOriginRewriteDocumentRequests = 0;
let auditedStableOriginRewriteScriptRequests = 0;
let auditedStableOriginRewriteBodyHashes = 0;
let auditedStableOriginRewriteBodyHashMismatches = 0;
let auditedStableOriginRewriteRedirectRequests = 0;
let auditedStableOriginRewriteRedirectResponses = 0;
let auditedStableOriginRewriteResponseErrors = 0;
const auditedApplicationSessionKeepaliveRequestCounts = {
  baseline: 0,
  candidate: 0,
};
const auditedApplicationSessionKeepaliveResponseCounts = {
  baseline: 0,
  candidate: 0,
};
const auditedStableOriginRewriteGroups = new Map();
const auditedBrowserWideBoundaryGroupAttestations = [];
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
  if (verifierVercelBypassSecret) {
    assert.equal(
      auditText.includes(verifierVercelBypassSecret),
      false,
      "The Vercel bypass secret reached a browser audit.",
    );
  }
  const allowedAuditEventTypes = new Set([
    "browser-session",
    "origin-rewrite-session",
    "origin-rewrite",
    "network-policy-session",
    "deterministic-local-response",
    "external-static-response",
    "optional-telemetry-suppression",
    "telemetry-capability-guard-attestation",
    "stable-origin-favicon-fallback",
    "app-check-bridge",
    "network-request",
    "network-response",
    "capture",
    "browser-session-complete",
  ]);
  assert.equal(
    events.every((event) => allowedAuditEventTypes.has(event.type)),
    true,
    `${audit.id} contains an unknown browser-audit event type.`,
  );
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
  const originRewriteSessionEvents = events.filter(
    (event) => event.type === "origin-rewrite-session",
  );
  assert.equal(originRewriteSessionEvents.length, 1);
  const {
    type: originRewriteSessionType,
    id: originRewriteSessionId,
    ...originRewriteSummary
  } = originRewriteSessionEvents[0];
  assert.equal(originRewriteSessionType, "origin-rewrite-session");
  assert.equal(originRewriteSessionId, audit.id);
  assertStableOriginRewriteSummary(originRewriteSummary, audit.stage);
  const originRewriteDeployment =
    audit.stage === "baseline"
      ? manifest.baselineDeployment
      : manifest.candidateDeployment;
  assert.deepEqual(originRewriteSummary.documentBodySha256s, [
    originRewriteDeployment.htmlSha256,
  ]);
  assert.equal(
    originRewriteDeployment.firebaseBundle.assets.every((asset) =>
      originRewriteSummary.scriptBodySha256s.includes(asset.sha256),
    ),
    true,
    `${audit.id} did not load every immutable entry script.`,
  );
  assert.equal(auditedStableOriginRewriteGroups.has(audit.id), false);
  auditedStableOriginRewriteGroups.set(audit.id, originRewriteSummary);
  const networkPolicyEvents = events.filter(
    (event) => event.type === "network-policy-session",
  );
  assert.equal(networkPolicyEvents.length, 1);
  const networkPolicyEvent = networkPolicyEvents[0];
  assertExactObjectKeys(networkPolicyEvent, [
    "type",
    "id",
    "stage",
    "schemaVersion",
    "externalStaticAllowlistHash",
    "optionalTelemetrySuppressionContractHash",
    "telemetryCapabilityGuardContractHash",
    "telemetryCapabilityGuardInitScriptRegistrationCount",
    "telemetryCapabilityGuardAuthenticationAttestationCount",
    "telemetryCapabilityGuardScreenAttestationCount",
    "telemetryCapabilityGuardRuntimeAttestationCount",
    "telemetryCapabilityGuardRuntimeAttestationSetHash",
    "sensitiveValueScopeContractHash",
    "deterministicResponseContractHash",
    "optionalTelemetrySuppressedRequestCount",
    "deterministicHolidayResponseFulfillCount",
    "deterministicRecaptchaResponseFulfillCount",
    "deterministicFirebaseModuleFulfillCount",
    "deterministicResponseScopeMismatchBlockCount",
    "externalStaticRequestNetworkFetchCount",
    "externalStaticRequestCacheFulfillCount",
    "externalStaticRequestScopeMismatchBlockCount",
    "externalStaticResponseNon200AbortCount",
    "nodeOwnedExternalRequestCount",
    "nodeOwnedExternalInformationalResponseCount",
    "nodeOwnedExternalInformationalEgressHeaderObservationCount",
    "nodeOwnedExternalInformationalBrowserExposureCount",
    "nodeOwnedExternalFinalResponseCount",
    "nodeOwnedExternalFinalBodyHashAttestationCount",
    "nodeOwnedExternalFinalHeaderSuppressionCount",
    "stagingApiKeyScopeViolationBlockCount",
    "testCredentialScopeViolationBlockCount",
    "refreshTokenScopeViolationBlockCount",
    "rawSensitivePreTransmissionInspectionCount",
    "rawSensitivePreTransmissionBlockCount",
    "rawProductionPreTransmissionBlockCount",
    "rawVercelBypassPreTransmissionBlockCount",
    "rawStagingApiKeyPreTransmissionBlockCount",
    "rawTestCredentialPreTransmissionBlockCount",
    "rawRefreshTokenPreTransmissionBlockCount",
    "rawDebugTokenPreTransmissionBlockCount",
    "rawDebugSentinelPreTransmissionBlockCount",
    "allowedEgressResponsePauseCount",
    "allowedEgressInformationalResponsePauseCount",
    "allowedEgressInformationalFinalResponseCount",
    "allowedEgressInformationalTrackingResidualCount",
    "allowedEgressInvalidResponseStatusAbortCount",
    "allowedEgressRedirectAbortCount",
    "allowedEgressHttpErrorAbortCount",
    "allowedEgressResponseErrorAbortCount",
    "allowedEgressInformationalEgressHeaderObservationCount",
    "allowedEgressFinalEgressHeaderObservationCount",
    "allowedEgressResponseHeaderSuppressionCount",
    "allowedEgressEgressHeaderForwardCount",
    "directBrowserEarlyHintsObservationCount",
    "directBrowserEarlyHintsEgressHeaderObservationCount",
    "directBrowserEarlyHintsCaptureInvalidationCount",
    "fullPostDataResolutionCount",
    "fullPostDataNetworkFallbackCount",
    "fullPostDataResolutionFailureCount",
    "fullPostDataOversizeBlockCount",
    "fullPostDataRepresentationMismatchBlockCount",
    "deterministicResponseObservationCount",
    "deterministicResponseObservationSetHash",
    "externalStaticResponseObservationCount",
    "externalStaticResponseObservationSetHash",
    "optionalTelemetryObservationCount",
    "optionalTelemetryObservationSetHash",
    "pinnedStartupSourceAttestationCount",
    "pinnedStartupSourceAttestationSetHash",
    "allowedEgressTrackingResidualCount",
    "externalStaticTrackingResidualCount",
    "summarySha256",
  ]);
  assert.equal(networkPolicyEvent.id, audit.id);
  assert.equal(networkPolicyEvent.stage, audit.stage);
  assert.equal(networkPolicyEvent.schemaVersion, 5);
  assert.equal(
    networkPolicyEvent.externalStaticAllowlistHash,
    sha256(
      canonicalJson(contract.networkBoundary.externalStaticRequestAllowlist),
    ),
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetrySuppressionContractHash,
    sha256(
      canonicalJson(contract.networkBoundary.optionalTelemetrySuppression),
    ),
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardContractHash,
    sha256(
      canonicalJson(
        contract.networkBoundary.optionalTelemetrySuppression
          .documentStartGuard,
      ),
    ),
  );
  assert.equal(
    networkPolicyEvent.sensitiveValueScopeContractHash,
    sha256(canonicalJson(contract.networkBoundary.sensitiveValueScope)),
  );
  assert.equal(
    networkPolicyEvent.deterministicResponseContractHash,
    sha256(
      canonicalJson({
        holiday: contract.browserTransport.deterministicLocalResponse,
        recaptcha: contract.browserTransport.deterministicRecaptchaResponse,
      }),
    ),
  );
  const deterministicEvents = events.filter(
    (event) => event.type === "deterministic-local-response",
  );
  const deterministicObservations = deterministicEvents.map(
    ({ type, auditEventId, ...observation }, index) => {
      assert.equal(auditEventId, `${audit.id}:deterministic-${index}`);
      assertExactObjectKeys(observation, [
        "schemaVersion",
        "stage",
        "groupKey",
        "id",
        "requestUrlSha256",
        "browserOrigin",
        "year",
        "responseStatus",
        "responseBodySha256",
        "responseBodyBytes",
      ]);
      assert.equal(observation.schemaVersion, 1);
      assert.equal(observation.stage, audit.stage);
      assert.equal(observation.groupKey, audit.id);
      assert.equal(observation.browserOrigin, stableBrowserOrigin);
      assert.equal(observation.responseStatus, 200);
      assert.match(observation.requestUrlSha256, /^[a-f0-9]{64}$/u);
      if (
        observation.id ===
        contract.browserTransport.deterministicLocalResponse.id
      ) {
        const responseContract =
          contract.browserTransport.deterministicLocalResponse;
        assert.ok(Number.isInteger(observation.year));
        assert.ok(
          observation.year >= responseContract.yearCanonicalDecimalMinimum &&
            observation.year <= responseContract.yearCanonicalDecimalMaximum,
        );
        assert.equal(
          observation.requestUrlSha256,
          sha256(
            `${stableBrowserOrigin}${responseContract.pathname}?year=${observation.year}`,
          ),
        );
        assert.equal(
          observation.responseBodySha256,
          responseContract.responseBodySha256,
        );
        assert.equal(
          observation.responseBodyBytes,
          responseContract.responseBodyBytes,
        );
      } else if (
        observation.id ===
        contract.browserTransport.deterministicRecaptchaResponse.id
      ) {
        const responseContract =
          contract.browserTransport.deterministicRecaptchaResponse;
        assert.equal(observation.year, null);
        assert.equal(
          observation.requestUrlSha256,
          sha256(
            `${responseContract.protocol}//${responseContract.hostname}${responseContract.pathname}`,
          ),
        );
        assert.equal(
          observation.responseBodySha256,
          responseContract.responseBodySha256,
        );
        assert.equal(
          observation.responseBodyBytes,
          responseContract.responseBodyBytes,
        );
      } else {
        assert.equal(observation.id, "firebase-esm-12.9.0");
        assert.equal(observation.year, null);
        const firebaseRule =
          contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
            (rule) => rule.id === observation.id,
          );
        const matchingModule = Object.entries(firebaseRule.localModules).find(
          ([pathname, moduleContract]) =>
            observation.requestUrlSha256 ===
              sha256(`https://${firebaseRule.hostname}${pathname}`) &&
            observation.responseBodySha256 === moduleContract.sha256 &&
            observation.responseBodyBytes === moduleContract.bytes,
        );
        assert.ok(matchingModule);
      }
      return observation;
    },
  );
  const externalStaticEvents = events.filter(
    (event) => event.type === "external-static-response",
  );
  const externalStaticObservations = externalStaticEvents.map(
    ({ type, auditEventId, ...observation }, index) => {
      assert.equal(auditEventId, `${audit.id}:external-static-${index}`);
      assertExactObjectKeys(observation, [
        "schemaVersion",
        "stage",
        "groupKey",
        "ruleId",
        "requestUrl",
        "requestUrlSha256",
        "method",
        "resourceType",
        "requestBodyAbsent",
        "sensitiveHeaderAbsent",
        "source",
        "sourceUrlSha256",
        "responseStatus",
        "responseBodySha256",
        "responseBodyBytes",
        "requestContractHash",
        "cacheKeySha256",
        "nodeOwnedNetworkRequest",
        "informationalResponseCount",
        "informationalEgressHeaderObservationCount",
        "informationalBrowserExposureCount",
        "finalHeaderSuppressionCount",
      ]);
      assert.equal(observation.schemaVersion, 1);
      assert.equal(observation.stage, audit.stage);
      assert.equal(observation.groupKey, audit.id);
      assert.equal(
        observation.requestUrlSha256,
        sha256(observation.requestUrl),
      );
      assert.match(observation.requestUrlSha256, /^[a-f0-9]{64}$/u);
      assert.equal(observation.requestBodyAbsent, true);
      assert.equal(observation.sensitiveHeaderAbsent, true);
      assert.match(observation.responseBodySha256, /^[a-f0-9]{64}$/u);
      assert.ok(Number.isInteger(observation.responseBodyBytes));
      assert.ok(observation.responseBodyBytes >= 0);
      assert.equal(observation.responseStatus, 200);
      assert.equal(
        observation.requestContractHash,
        secretSha256(
          JSON.stringify(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT),
        ),
      );
      assert.equal(
        observation.cacheKeySha256,
        sha256(
          JSON.stringify({
            method: "GET",
            requestUrl: new URL(observation.requestUrl).toString(),
            requestContractHash: observation.requestContractHash,
          }),
        ),
      );
      assert.ok(Number.isInteger(observation.informationalResponseCount));
      assert.ok(observation.informationalResponseCount >= 0);
      assert.ok(
        Number.isInteger(observation.informationalEgressHeaderObservationCount),
      );
      assert.ok(observation.informationalEgressHeaderObservationCount >= 0);
      assert.equal(observation.informationalBrowserExposureCount, 0);
      assert.ok(Number.isInteger(observation.finalHeaderSuppressionCount));
      assert.ok(observation.finalHeaderSuppressionCount >= 0);
      const rule =
        contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
          (candidate) => candidate.id === observation.ruleId,
        );
      assert.ok(rule);
      assert.equal(
        exactStaticExternalRuleId({
          requestUrl: observation.requestUrl,
          method: observation.method,
          resourceType: observation.resourceType,
        }),
        rule.id,
      );
      if (observation.source === "startup-pinned-source-cache") {
        assert.equal(
          rule.action,
          "startup-pinned-source-fetch-then-local-fulfill",
        );
        const requestUrl = new URL(observation.requestUrl);
        const pinnedSource = Object.entries(rule.pinnedSources || {}).find(
          ([browserPathname, source]) =>
            requestUrl.origin === `https://${rule.hostname}` &&
            requestUrl.pathname === browserPathname &&
            requestUrl.search === "" &&
            source.sha256 === observation.responseBodySha256 &&
            source.bytes === observation.responseBodyBytes &&
            sha256(source.url) === observation.sourceUrlSha256,
        );
        assert.ok(pinnedSource);
      } else {
        assert.equal(
          rule.action,
          "baseline-fetch-hash-cache-then-local-fulfill",
        );
        assert.ok(
          ["baseline-node-network", "baseline-byte-cache"].includes(
            observation.source,
          ),
        );
        if (observation.source === "baseline-node-network") {
          assert.equal(audit.stage, "baseline");
          assert.equal(observation.nodeOwnedNetworkRequest, true);
          assert.equal(
            observation.sourceUrlSha256,
            sha256(new URL(observation.requestUrl).toString()),
          );
        } else {
          assert.equal(observation.nodeOwnedNetworkRequest, false);
          assert.match(observation.sourceUrlSha256, /^[a-f0-9]{64}$/u);
        }
      }
      return observation;
    },
  );
  const telemetryEvents = events.filter(
    (event) => event.type === "optional-telemetry-suppression",
  );
  const telemetryObservations = telemetryEvents.map(
    ({ type, auditEventId, ...observation }, index) => {
      assert.equal(auditEventId, `${audit.id}:telemetry-${index}`);
      assertExactObjectKeys(observation, [
        "schemaVersion",
        "stage",
        "groupKey",
        "method",
        "hostname",
        "requestUrlSha256",
        "rawSensitiveInspectionPassed",
      ]);
      assert.equal(observation.schemaVersion, 1);
      assert.equal(observation.stage, audit.stage);
      assert.equal(observation.groupKey, audit.id);
      assert.equal(
        contract.networkBoundary.optionalTelemetrySuppression.methods.includes(
          observation.method,
        ),
        true,
      );
      assert.equal(
        contract.networkBoundary.optionalTelemetrySuppression.hostnames.includes(
          observation.hostname,
        ),
        true,
      );
      assert.match(observation.requestUrlSha256, /^[a-f0-9]{64}$/u);
      assert.equal(observation.rawSensitiveInspectionPassed, true);
      return observation;
    },
  );
  const telemetryCapabilityGuardEvents = events.filter(
    (event) => event.type === "telemetry-capability-guard-attestation",
  );
  const telemetryCapabilityGuardAttestations =
    telemetryCapabilityGuardEvents.map(
      ({ type, auditEventId, ...attestation }, index) => {
        assert.equal(
          auditEventId,
          `${audit.id}:telemetry-capability-guard-${index}`,
        );
        return assertTelemetryCapabilityGuardAttestation(attestation, {
          expectedStage: audit.stage,
          expectedGroupKey: audit.id,
          expectedCaptureIds: audit.captureIds,
        });
      },
    );
  const telemetryCapabilityGuardAuthenticationAttestations =
    telemetryCapabilityGuardAttestations.filter(
      ({ point }) => point === "post-authentication",
    );
  const telemetryCapabilityGuardScreenAttestations =
    telemetryCapabilityGuardAttestations.filter(
      ({ point }) => point === "post-screen-navigation",
    );
  const expectedAuthenticationAttestationCount = Number(
    authenticatedAuditRole !== "public",
  );
  assert.equal(
    telemetryCapabilityGuardAuthenticationAttestations.length,
    expectedAuthenticationAttestationCount,
  );
  assert.deepEqual(
    telemetryCapabilityGuardScreenAttestations
      .map(({ captureId }) => captureId)
      .sort(),
    [...audit.captureIds].sort(),
    `${audit.id} telemetry guard screen attestations are incomplete.`,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardInitScriptRegistrationCount,
    1,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardAuthenticationAttestationCount,
    expectedAuthenticationAttestationCount,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardScreenAttestationCount,
    audit.captureIds.length,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardRuntimeAttestationCount,
    telemetryCapabilityGuardAttestations.length,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardRuntimeAttestationCount,
    expectedAuthenticationAttestationCount + audit.captureIds.length,
  );
  assert.equal(
    networkPolicyEvent.telemetryCapabilityGuardRuntimeAttestationSetHash,
    sha256(canonicalJson(telemetryCapabilityGuardAttestations)),
  );
  const faviconFallbackEvents = events.filter(
    (event) => event.type === "stable-origin-favicon-fallback",
  );
  const faviconFallbackObservations = faviconFallbackEvents.map(
    ({ type, auditEventId, ...observation }, index) => {
      assert.equal(auditEventId, `${audit.id}:favicon-fallback-${index}`);
      assertExactObjectKeys(observation, [
        "schemaVersion",
        "stage",
        "groupKey",
        "phase",
        "captureId",
        "id",
        "method",
        "resourceType",
        "browserPath",
        "browserUrlSha256",
        "browserOriginExact",
        "responseStatus",
        "responseBodyBytes",
        "responseBodySha256",
        "nodeUpstreamFetchCount",
        "browserNetworkRequestCount",
      ]);
      const fallback = contract.browserTransport.stableOriginFaviconFallback;
      assert.equal(observation.schemaVersion, 1);
      assert.equal(observation.stage, audit.stage);
      assert.equal(observation.groupKey, audit.id);
      assert.ok(
        ["context-bootstrap", "authentication", "screen-capture"].includes(
          observation.phase,
        ),
      );
      assert.equal(
        observation.captureId === null ||
          audit.captureIds.includes(observation.captureId),
        true,
      );
      assert.equal(observation.id, fallback.id);
      assert.equal(observation.method, fallback.method);
      assert.equal(observation.resourceType, fallback.resourceType);
      assert.equal(observation.browserPath, fallback.pathname);
      assert.equal(
        observation.browserUrlSha256,
        sha256(`${stableBrowserOrigin}${fallback.pathname}`),
      );
      assert.equal(observation.browserOriginExact, true);
      assert.equal(observation.responseStatus, fallback.responseStatus);
      assert.equal(observation.responseBodyBytes, fallback.responseBodyBytes);
      assert.equal(observation.responseBodySha256, fallback.responseBodySha256);
      assert.equal(observation.nodeUpstreamFetchCount, 0);
      assert.equal(observation.browserNetworkRequestCount, 0);
      const decision = stableOriginFaviconFallbackDecision({
        stage: observation.stage,
        requestUrl: `${stableBrowserOrigin}${observation.browserPath}`,
        method: observation.method,
        resourceType: observation.resourceType,
        browserOrigin: stableBrowserOrigin,
      });
      assert.equal(decision.eligible, true);
      assert.equal(decision.id, observation.id);
      assert.equal(decision.responseStatus, observation.responseStatus);
      assert.equal(decision.responseBodySha256, observation.responseBodySha256);
      return observation;
    },
  );
  assert.equal(
    networkPolicyEvent.deterministicResponseObservationCount,
    deterministicObservations.length,
  );
  assert.equal(
    networkPolicyEvent.deterministicResponseObservationSetHash,
    sha256(canonicalJson(deterministicObservations)),
  );
  assert.equal(
    networkPolicyEvent.externalStaticResponseObservationCount,
    externalStaticObservations.length,
  );
  assert.equal(
    networkPolicyEvent.externalStaticResponseObservationSetHash,
    sha256(canonicalJson(externalStaticObservations)),
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetryObservationCount,
    telemetryObservations.length,
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetryObservationSetHash,
    sha256(canonicalJson(telemetryObservations)),
  );
  assert.equal(
    networkPolicyEvent.pinnedStartupSourceAttestationCount,
    expectedPinnedStartupSourceBindingsForContract().length,
  );
  assert.equal(
    networkPolicyEvent.pinnedStartupSourceAttestationSetHash,
    manifest.networkPolicy.pinnedStartupSourceAttestationSetHash,
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetrySuppressedRequestCount,
    telemetryObservations.length,
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetrySuppressedRequestCount,
    contract.networkBoundary.optionalTelemetrySuppression
      .requiredLiveSuppressedRequestCount,
  );
  assert.equal(
    networkPolicyEvent.optionalTelemetryObservationCount,
    contract.networkBoundary.optionalTelemetrySuppression
      .requiredLiveObservationCount,
  );
  assert.equal(
    networkPolicyEvent.deterministicHolidayResponseFulfillCount,
    deterministicObservations.filter(
      ({ id }) =>
        id === contract.browserTransport.deterministicLocalResponse.id,
    ).length,
  );
  assert.equal(
    networkPolicyEvent.deterministicRecaptchaResponseFulfillCount,
    deterministicObservations.filter(
      ({ id }) =>
        id === contract.browserTransport.deterministicRecaptchaResponse.id,
    ).length,
  );
  assert.equal(
    networkPolicyEvent.deterministicFirebaseModuleFulfillCount,
    deterministicObservations.filter(({ id }) => id === "firebase-esm-12.9.0")
      .length,
  );
  assert.equal(
    networkPolicyEvent.externalStaticRequestNetworkFetchCount,
    externalStaticObservations.filter(
      ({ source }) => source === "baseline-node-network",
    ).length,
  );
  assert.equal(
    networkPolicyEvent.externalStaticRequestCacheFulfillCount,
    externalStaticObservations.filter(
      ({ source }) => source !== "baseline-node-network",
    ).length,
  );
  for (const field of [
    "deterministicResponseScopeMismatchBlockCount",
    "externalStaticRequestScopeMismatchBlockCount",
    "externalStaticResponseNon200AbortCount",
    "stagingApiKeyScopeViolationBlockCount",
    "testCredentialScopeViolationBlockCount",
    "refreshTokenScopeViolationBlockCount",
    "allowedEgressRedirectAbortCount",
    "allowedEgressHttpErrorAbortCount",
    "allowedEgressResponseErrorAbortCount",
    "allowedEgressTrackingResidualCount",
    "externalStaticTrackingResidualCount",
    "rawSensitivePreTransmissionBlockCount",
    "rawProductionPreTransmissionBlockCount",
    "rawVercelBypassPreTransmissionBlockCount",
    "rawStagingApiKeyPreTransmissionBlockCount",
    "rawTestCredentialPreTransmissionBlockCount",
    "rawRefreshTokenPreTransmissionBlockCount",
    "rawDebugTokenPreTransmissionBlockCount",
    "rawDebugSentinelPreTransmissionBlockCount",
    "allowedEgressInformationalTrackingResidualCount",
    "allowedEgressInvalidResponseStatusAbortCount",
    "allowedEgressEgressHeaderForwardCount",
    "nodeOwnedExternalInformationalBrowserExposureCount",
    "directBrowserEarlyHintsObservationCount",
    "directBrowserEarlyHintsEgressHeaderObservationCount",
    "directBrowserEarlyHintsCaptureInvalidationCount",
    "fullPostDataResolutionFailureCount",
    "fullPostDataOversizeBlockCount",
    "fullPostDataRepresentationMismatchBlockCount",
  ]) {
    assert.equal(networkPolicyEvent[field], 0);
  }
  assert.ok(
    networkPolicyEvent.allowedEgressInformationalFinalResponseCount <=
      networkPolicyEvent.allowedEgressInformationalResponsePauseCount,
  );
  assert.equal(
    networkPolicyEvent.fullPostDataResolutionCount,
    networkPolicyEvent.rawSensitivePreTransmissionInspectionCount,
  );
  assert.equal(
    networkPolicyEvent.nodeOwnedExternalRequestCount,
    networkPolicyEvent.externalStaticRequestNetworkFetchCount,
  );
  assert.equal(
    networkPolicyEvent.nodeOwnedExternalFinalResponseCount,
    networkPolicyEvent.nodeOwnedExternalRequestCount,
  );
  assert.equal(
    networkPolicyEvent.nodeOwnedExternalFinalBodyHashAttestationCount,
    networkPolicyEvent.nodeOwnedExternalRequestCount,
  );
  const {
    type: _networkPolicyType,
    id: _networkPolicyId,
    stage: _networkPolicyStage,
    summarySha256,
    ...networkPolicySummaryWithoutIdentity
  } = networkPolicyEvent;
  assert.equal(
    summarySha256,
    sha256(canonicalJson(networkPolicySummaryWithoutIdentity)),
  );
  assert.equal(auditedNetworkPolicySummaries.has(audit.id), false);
  auditedNetworkPolicySummaries.set(audit.id, {
    ...networkPolicySummaryWithoutIdentity,
    summarySha256,
  });
  auditedDeterministicResponseObservations.push(...deterministicObservations);
  auditedExternalStaticResponseObservations.push(...externalStaticObservations);
  auditedOptionalTelemetryObservations.push(...telemetryObservations);
  auditedTelemetryCapabilityGuardAttestations.push(
    ...telemetryCapabilityGuardAttestations,
  );
  auditedStableOriginFaviconFallbackObservations.push(
    ...faviconFallbackObservations,
  );
  auditedOptionalTelemetrySuppressedRequests +=
    networkPolicyEvent.optionalTelemetrySuppressedRequestCount;
  auditedDeterministicHolidayResponseFulfills +=
    networkPolicyEvent.deterministicHolidayResponseFulfillCount;
  auditedDeterministicRecaptchaResponseFulfills +=
    networkPolicyEvent.deterministicRecaptchaResponseFulfillCount;
  auditedDeterministicFirebaseModuleFulfills +=
    networkPolicyEvent.deterministicFirebaseModuleFulfillCount;
  auditedDeterministicResponseScopeMismatchBlocks +=
    networkPolicyEvent.deterministicResponseScopeMismatchBlockCount;
  auditedExternalStaticRequestNetworkFetches +=
    networkPolicyEvent.externalStaticRequestNetworkFetchCount;
  auditedExternalStaticRequestCacheFulfills +=
    networkPolicyEvent.externalStaticRequestCacheFulfillCount;
  auditedExternalStaticRequestScopeMismatchBlocks +=
    networkPolicyEvent.externalStaticRequestScopeMismatchBlockCount;
  auditedExternalStaticResponseNon200Aborts +=
    networkPolicyEvent.externalStaticResponseNon200AbortCount;
  auditedNodeOwnedExternalRequests +=
    networkPolicyEvent.nodeOwnedExternalRequestCount;
  auditedNodeOwnedExternalInformationalResponses +=
    networkPolicyEvent.nodeOwnedExternalInformationalResponseCount;
  auditedNodeOwnedExternalInformationalEgressHeaderObservations +=
    networkPolicyEvent.nodeOwnedExternalInformationalEgressHeaderObservationCount;
  auditedNodeOwnedExternalInformationalBrowserExposures +=
    networkPolicyEvent.nodeOwnedExternalInformationalBrowserExposureCount;
  auditedNodeOwnedExternalFinalResponses +=
    networkPolicyEvent.nodeOwnedExternalFinalResponseCount;
  auditedNodeOwnedExternalFinalBodyHashAttestations +=
    networkPolicyEvent.nodeOwnedExternalFinalBodyHashAttestationCount;
  auditedNodeOwnedExternalFinalHeaderSuppressions +=
    networkPolicyEvent.nodeOwnedExternalFinalHeaderSuppressionCount;
  auditedStagingApiKeyScopeViolationBlocks +=
    networkPolicyEvent.stagingApiKeyScopeViolationBlockCount;
  auditedTestCredentialScopeViolationBlocks +=
    networkPolicyEvent.testCredentialScopeViolationBlockCount;
  auditedRefreshTokenScopeViolationBlocks +=
    networkPolicyEvent.refreshTokenScopeViolationBlockCount;
  auditedRawSensitivePreTransmissionInspections +=
    networkPolicyEvent.rawSensitivePreTransmissionInspectionCount;
  auditedRawSensitivePreTransmissionBlocks +=
    networkPolicyEvent.rawSensitivePreTransmissionBlockCount;
  auditedRawProductionPreTransmissionBlocks +=
    networkPolicyEvent.rawProductionPreTransmissionBlockCount;
  auditedRawVercelBypassPreTransmissionBlocks +=
    networkPolicyEvent.rawVercelBypassPreTransmissionBlockCount;
  auditedRawStagingApiKeyPreTransmissionBlocks +=
    networkPolicyEvent.rawStagingApiKeyPreTransmissionBlockCount;
  auditedRawTestCredentialPreTransmissionBlocks +=
    networkPolicyEvent.rawTestCredentialPreTransmissionBlockCount;
  auditedRawRefreshTokenPreTransmissionBlocks +=
    networkPolicyEvent.rawRefreshTokenPreTransmissionBlockCount;
  auditedRawDebugTokenPreTransmissionBlocks +=
    networkPolicyEvent.rawDebugTokenPreTransmissionBlockCount;
  auditedRawDebugSentinelPreTransmissionBlocks +=
    networkPolicyEvent.rawDebugSentinelPreTransmissionBlockCount;
  auditedAllowedEgressResponsePauses +=
    networkPolicyEvent.allowedEgressResponsePauseCount;
  auditedAllowedEgressInformationalResponsePauses +=
    networkPolicyEvent.allowedEgressInformationalResponsePauseCount;
  auditedAllowedEgressInformationalFinalResponses +=
    networkPolicyEvent.allowedEgressInformationalFinalResponseCount;
  auditedAllowedEgressInformationalTrackingResiduals +=
    networkPolicyEvent.allowedEgressInformationalTrackingResidualCount;
  auditedAllowedEgressInvalidResponseStatusAborts +=
    networkPolicyEvent.allowedEgressInvalidResponseStatusAbortCount;
  auditedAllowedEgressRedirectAborts +=
    networkPolicyEvent.allowedEgressRedirectAbortCount;
  auditedAllowedEgressHttpErrorAborts +=
    networkPolicyEvent.allowedEgressHttpErrorAbortCount;
  auditedAllowedEgressResponseErrorAborts +=
    networkPolicyEvent.allowedEgressResponseErrorAbortCount;
  auditedAllowedEgressInformationalEgressHeaderObservations +=
    networkPolicyEvent.allowedEgressInformationalEgressHeaderObservationCount;
  auditedAllowedEgressFinalEgressHeaderObservations +=
    networkPolicyEvent.allowedEgressFinalEgressHeaderObservationCount;
  auditedAllowedEgressResponseHeaderSuppressions +=
    networkPolicyEvent.allowedEgressResponseHeaderSuppressionCount;
  auditedAllowedEgressEgressHeaderForwards +=
    networkPolicyEvent.allowedEgressEgressHeaderForwardCount;
  auditedAllowedEgressTrackingResiduals +=
    networkPolicyEvent.allowedEgressTrackingResidualCount;
  auditedExternalStaticTrackingResiduals +=
    networkPolicyEvent.externalStaticTrackingResidualCount;
  auditedDirectBrowserEarlyHintsObservations +=
    networkPolicyEvent.directBrowserEarlyHintsObservationCount;
  auditedDirectBrowserEarlyHintsEgressHeaderObservations +=
    networkPolicyEvent.directBrowserEarlyHintsEgressHeaderObservationCount;
  auditedDirectBrowserEarlyHintsCaptureInvalidations +=
    networkPolicyEvent.directBrowserEarlyHintsCaptureInvalidationCount;
  auditedFullPostDataResolutions +=
    networkPolicyEvent.fullPostDataResolutionCount;
  auditedFullPostDataNetworkFallbacks +=
    networkPolicyEvent.fullPostDataNetworkFallbackCount;
  auditedFullPostDataResolutionFailures +=
    networkPolicyEvent.fullPostDataResolutionFailureCount;
  auditedFullPostDataOversizeBlocks +=
    networkPolicyEvent.fullPostDataOversizeBlockCount;
  auditedFullPostDataRepresentationMismatchBlocks +=
    networkPolicyEvent.fullPostDataRepresentationMismatchBlockCount;
  const bridgeEvents = events.filter(
    (event) => event.type === "app-check-bridge",
  );
  assert.equal(bridgeEvents.length, 1);
  const bridgeEvent = bridgeEvents[0];
  assertExactObjectKeys(bridgeEvent, [
    "type",
    "id",
    "stage",
    "scopeHash",
    "browserCdpSecurityScopeHash",
    "browserWideBoundaryAttestation",
    "browserWideBoundaryAttestationHash",
    "serviceWorkerPolicy",
    "interceptionMechanism",
    "preTransmissionBoundaryAttestationHash",
    "nonFirebaseNetworkAllowedHostnameSetHash",
    "nonFirebaseNetworkAllowedHostnameCount",
    "preTransmissionBoundaryInspectionCount",
    "preTransmissionBoundaryBlockAttemptCount",
    "preTransmissionBoundaryProductionBlockCount",
    "preTransmissionBoundaryCrossOriginDocumentBlockCount",
    "preTransmissionBoundaryUnboundFirebaseBlockCount",
    "preTransmissionBoundaryNonFirebaseHostnameBlockCount",
    "preTransmissionBoundaryMalformedUrlBlockCount",
    "preTransmissionBoundaryFailRequestCount",
    "optionalTelemetrySuppressedRequestCount",
    "rawSensitivePreTransmissionInspectionCount",
    "rawSensitivePreTransmissionBlockCount",
    "rawProductionPreTransmissionBlockCount",
    "rawVercelBypassPreTransmissionBlockCount",
    "rawStagingApiKeyPreTransmissionBlockCount",
    "rawTestCredentialPreTransmissionBlockCount",
    "rawRefreshTokenPreTransmissionBlockCount",
    "rawDebugTokenPreTransmissionBlockCount",
    "rawDebugSentinelPreTransmissionBlockCount",
    "allowedEgressResponsePauseCount",
    "allowedEgressInformationalResponsePauseCount",
    "allowedEgressInformationalFinalResponseCount",
    "allowedEgressInformationalTrackingResidualCount",
    "allowedEgressInvalidResponseStatusAbortCount",
    "allowedEgressInformationalEgressHeaderObservationCount",
    "allowedEgressFinalEgressHeaderObservationCount",
    "allowedEgressResponseHeaderSuppressionCount",
    "allowedEgressEgressHeaderForwardCount",
    "directBrowserEarlyHintsObservationCount",
    "directBrowserEarlyHintsEgressHeaderObservationCount",
    "directBrowserEarlyHintsCaptureInvalidationCount",
    "fullPostDataResolutionCount",
    "fullPostDataNetworkFallbackCount",
    "fullPostDataResolutionFailureCount",
    "fullPostDataOversizeBlockCount",
    "fullPostDataRepresentationMismatchBlockCount",
    "networkPolicySummaryHash",
    "headerCorrelationMechanism",
    "secretInitScope",
    "browserGlobalValueKind",
    "debugSentinelHash",
    "pageRawDebugTokenInjectionCount",
    "pageAppCheckSecretInitRegistrationCount",
    "browserGlobalRawDebugTokenWriteCount",
    "browserGlobalDebugSentinelWriteCount",
    "localStorageSecretWriteCount",
    "contextAppCheckSecretInitCount",
    "protocolDebugLoggingDisabled",
    "browserLaunchExplicitEnvironment",
    "childProcessSecretEnvScrubbed",
    "browserChildEnvironmentAllowlisted",
    "browserChildEnvironmentAllowlistHash",
    "browserChildEnvironmentUnexpectedKeyCount",
    "scrubbedSecretEnvironmentVariableCount",
    "browserChildSecretEnvironmentVariableCount",
    "browserChildSecretValueObservationCount",
    "browserGlobalExtraHttpHeaderRegistrationCount",
    "vercelBypassConfigured",
    "vercelBypassAllowedOriginSetHash",
    "vercelBypassTransportContractHash",
    "vercelBypassCdpInjectedRequestCount",
    "vercelBypassPreexistingHeaderObservationCount",
    "unauthorizedVercelBypassEgressCount",
    "vercelBypassCdpResponsePausedRequestCount",
    "vercelBypassHttpSuccessResponseCount",
    "vercelBypassHttpErrorResponseCount",
    "vercelBypassRedirectRequestCount",
    "vercelBypassRedirectAbortRequestCount",
    "vercelBypassRedirectResponseAbortRequestCount",
    "vercelBypassResponseErrorAbortRequestCount",
    "vercelBypassObservedEligibleRequestCount",
    "vercelBypassHeaderObservedRequestCount",
    "vercelBypassHeaderMissingRequestCount",
    "vercelBypassHeaderMismatchRequestCount",
    "rawVercelBypassOutputCount",
    "urlMethodFifoCorrelationUsed",
    "playwrightRouteRegistrationCount",
    "eligibleRequestCount",
    "injectedRequestCount",
    "nativeHeaderRequestCount",
    "scopeMismatchRequestCount",
    "strippedHeaderRequestCount",
    "redirectRequestCount",
    "redirectHeaderAbsentRequestCount",
    "redirectAbortRequestCount",
    "cdpPausedRequestCount",
    "cdpResponsePausedRequestCount",
    "cdpReconciledRequestCount",
    "webChannelCdpHeaderAttestationRegisteredRequestCount",
    "webChannelCdpHeaderAttestationCompletedRequestCount",
    "webChannelCdpHeaderAttestationBoundRequestCount",
    "webChannelCdpHeaderAttestationBindingResidualCount",
    "webChannelCdpHeaderAttestationBindingFailureCount",
    "webChannelCdpHeaderAttestationPairingTimeoutCount",
    "webChannelCdpHeaderAttestationCompletionTimeoutCount",
    "applicationSessionKeepaliveClientInitAttemptCount",
    "applicationSessionKeepaliveClientInitSuccessCount",
    "applicationSessionKeepaliveClientReuseCount",
    "applicationSessionKeepaliveClientDisposeAttemptCount",
    "applicationSessionKeepaliveClientDisposeSuccessCount",
    "applicationSessionKeepaliveClientDeleteCount",
    "applicationSessionKeepaliveClientRegistryResidualCount",
    "applicationSessionKeepaliveClientHandleDisposeCount",
    "applicationSessionKeepaliveClientLifecycleEvidence",
    "allowedEgressContextCloseBackchannelRetirementCount",
    "allowedEgressContextCloseSessionForwardPostRetirementCount",
    "allowedEgressContextCloseTerminationRetirementCount",
    "webChannelTerminationClassifiedRequestCount",
    "webChannelCdpHeaderAttestationBindingSetHash",
    "playwrightAllHeadersHeaderAttestationRequestCount",
    "playwrightAllHeadersHeaderAttestationCompletedRequestCount",
    "handlerErrorCount",
    "injectedRedirectResponseAbortRequestCount",
    "cdpMonitorPausedRequestCount",
    "debugTokenNetworkObservationCount",
    "debugSentinelNetworkObservationCount",
    "authorizedDebugExchangeBodyReplacementCount",
    "unauthorizedDebugTokenEgressCount",
    "unauthorizedDebugSentinelEgressCount",
    "appCheckHeaderNetworkObservationCount",
    "authorizedAppCheckHeaderRequestCount",
    "unauthorizedAppCheckHeaderEgressCount",
    "sensitiveRedirectRequestCount",
    "sensitiveRedirectAbortRequestCount",
    "sensitiveCdpResponsePausedRequestCount",
    "sensitiveRedirectResponseAbortRequestCount",
    "sensitiveResponseErrorAbortRequestCount",
    "sensitiveRequestTrackingResidualCount",
    "allowedEgressTrackingResidualCount",
    "externalStaticTrackingResidualCount",
    "networkHeaderAttestationErrorCount",
    "pendingBridgeDecisionResidualCount",
    "pendingBridgeObservationResidualCount",
    "unexpectedExtraPageCount",
    "unexpectedDedicatedWorkerCount",
    "unexpectedServiceWorkerCount",
    "unexpectedCrossOriginFrameCount",
    "unexpectedOopifTargetCount",
    "unexpectedDedicatedWorkerTargetCount",
    "unexpectedSharedWorkerTargetCount",
    "unexpectedServiceWorkerTargetCount",
    "retainedOopifTargetCount",
    "retainedDedicatedWorkerTargetCount",
    "retainedSharedWorkerTargetCount",
    "retainedServiceWorkerTargetCount",
    "targetDiscoveryActivationCount",
    "targetSnapshotCount",
    "unmatchedProtectedRequestCount",
    "scopeIneligibleProtectedRequestCount",
    "candidateBridgeInjectedRequestCount",
    "screenCaptureProtectedRequestCount",
    "screenCaptureBridgeHeaderRequestCount",
    "screenCaptureNativeHeaderRequestCount",
    "invalidHeaderJwtShapeRequestCount",
    "rawHeaderValueOutputCount",
    "rawTokenOutputCount",
  ]);
  assert.equal(bridgeEvent.id, audit.id);
  assert.equal(bridgeEvent.stage, audit.stage);
  assert.equal(bridgeEvent.scopeHash, baselineAppCheckBridgeScopeHash);
  assert.equal(
    bridgeEvent.browserCdpSecurityScopeHash,
    browserAppCheckCdpSecurityScopeHash,
  );
  assertExactObjectKeys(bridgeEvent.browserWideBoundaryAttestation, [
    "schemaVersion",
    "mechanism",
    "activationCount",
    "waitingTargetCount",
    "primaryTargetConfiguredCount",
    "primaryRequestBoundaryHandoffCount",
    "heldRuntimeResumeCount",
    "secondaryTargetClosedBeforeResumeCount",
    "privateRequestInspectionCount",
    "privateRequestBlockCount",
    "privateRequestContinueCount",
    "privateRawSensitiveInspectionCount",
    "privateRawSensitiveBlockCount",
    "privateRawProductionBlockCount",
    "privateRawVercelBypassBlockCount",
    "privateRawStagingApiKeyBlockCount",
    "privateRawTestCredentialBlockCount",
    "privateRawRefreshTokenBlockCount",
    "privateRawDebugTokenBlockCount",
    "privateRawDebugSentinelBlockCount",
    "privateOptionalTelemetrySuppressionCount",
    "privateDeterministicResponseFulfillCount",
    "privateDeterministicResponseScopeMismatchBlockCount",
    "privateExternalStaticBlockCount",
    "privateFullPostDataResolutionCount",
    "privateFullPostDataNetworkFallbackCount",
    "privateFullPostDataResolutionFailureCount",
    "privateFullPostDataOversizeBlockCount",
    "privateFullPostDataRepresentationMismatchBlockCount",
    "handlerErrorCount",
    "pendingSetupResidualCount",
    "pendingHandlerResidualCount",
    "heldRuntimeResumeResidualCount",
    "fatalErrorCount",
  ]);
  assert.equal(bridgeEvent.browserWideBoundaryAttestation.schemaVersion, 3);
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestation.mechanism,
    contract.networkBoundary.executionTargetBoundary.mechanism,
  );
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestation
      .privateFullPostDataResolutionCount,
    bridgeEvent.browserWideBoundaryAttestation.privateRequestInspectionCount,
  );
  assert.equal(bridgeEvent.browserWideBoundaryAttestation.activationCount, 1);
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestation.primaryTargetConfiguredCount,
    1,
  );
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestation
      .primaryRequestBoundaryHandoffCount,
    1,
  );
  assert.ok(
    bridgeEvent.browserWideBoundaryAttestation.heldRuntimeResumeCount >= 1,
  );
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestation
      .privateRawSensitiveInspectionCount,
    bridgeEvent.browserWideBoundaryAttestation.privateRequestInspectionCount,
  );
  for (const field of [
    "secondaryTargetClosedBeforeResumeCount",
    "privateOptionalTelemetrySuppressionCount",
    "privateDeterministicResponseFulfillCount",
    "privateDeterministicResponseScopeMismatchBlockCount",
    "privateExternalStaticBlockCount",
    "privateRawSensitiveBlockCount",
    "privateRawProductionBlockCount",
    "privateRawVercelBypassBlockCount",
    "privateRawStagingApiKeyBlockCount",
    "privateRawTestCredentialBlockCount",
    "privateRawRefreshTokenBlockCount",
    "privateRawDebugTokenBlockCount",
    "privateRawDebugSentinelBlockCount",
    "privateFullPostDataResolutionFailureCount",
    "privateFullPostDataOversizeBlockCount",
    "privateFullPostDataRepresentationMismatchBlockCount",
    "handlerErrorCount",
    "pendingSetupResidualCount",
    "pendingHandlerResidualCount",
    "heldRuntimeResumeResidualCount",
    "fatalErrorCount",
  ]) {
    assert.equal(bridgeEvent.browserWideBoundaryAttestation[field], 0);
  }
  assert.equal(
    bridgeEvent.browserWideBoundaryAttestationHash,
    sha256(canonicalJson(bridgeEvent.browserWideBoundaryAttestation)),
  );
  auditedBrowserWideBoundaryGroupAttestations.push({
    id: audit.id,
    ...bridgeEvent.browserWideBoundaryAttestation,
  });
  assert.equal(bridgeEvent.serviceWorkerPolicy, "block");
  assert.equal(bridgeEvent.interceptionMechanism, "cdp-fetch-request-stage");
  assert.equal(
    bridgeEvent.preTransmissionBoundaryAttestationHash,
    preTransmissionNetworkBoundaryAttestationHash,
  );
  assert.equal(
    bridgeEvent.nonFirebaseNetworkAllowedHostnameSetHash,
    nonFirebaseNetworkAllowedHostnameSetHash,
  );
  assert.equal(
    bridgeEvent.nonFirebaseNetworkAllowedHostnameCount,
    nonFirebaseNetworkAllowedHostnames.length,
  );
  assert.equal(
    bridgeEvent.optionalTelemetrySuppressedRequestCount,
    networkPolicyEvent.optionalTelemetrySuppressedRequestCount,
  );
  for (const field of [
    "rawSensitivePreTransmissionInspectionCount",
    "rawSensitivePreTransmissionBlockCount",
    "rawProductionPreTransmissionBlockCount",
    "rawVercelBypassPreTransmissionBlockCount",
    "rawStagingApiKeyPreTransmissionBlockCount",
    "rawTestCredentialPreTransmissionBlockCount",
    "rawRefreshTokenPreTransmissionBlockCount",
    "rawDebugTokenPreTransmissionBlockCount",
    "rawDebugSentinelPreTransmissionBlockCount",
    "allowedEgressResponsePauseCount",
    "allowedEgressInformationalResponsePauseCount",
    "allowedEgressInformationalFinalResponseCount",
    "allowedEgressInformationalTrackingResidualCount",
    "allowedEgressInvalidResponseStatusAbortCount",
    "allowedEgressInformationalEgressHeaderObservationCount",
    "allowedEgressFinalEgressHeaderObservationCount",
    "allowedEgressResponseHeaderSuppressionCount",
    "allowedEgressEgressHeaderForwardCount",
    "fullPostDataResolutionCount",
    "fullPostDataNetworkFallbackCount",
    "fullPostDataResolutionFailureCount",
    "fullPostDataOversizeBlockCount",
    "fullPostDataRepresentationMismatchBlockCount",
  ]) {
    assert.equal(bridgeEvent[field], networkPolicyEvent[field]);
  }
  assert.equal(
    bridgeEvent.rawSensitivePreTransmissionInspectionCount,
    bridgeEvent.cdpMonitorPausedRequestCount,
  );
  assert.equal(
    bridgeEvent.fullPostDataResolutionCount,
    bridgeEvent.cdpMonitorPausedRequestCount,
  );
  assert.equal(
    bridgeEvent.networkPolicySummaryHash,
    networkPolicyEvent.summarySha256,
  );
  assert.equal(
    bridgeEvent.headerCorrelationMechanism,
    "cdp-fetch-network-id-firestore-webchannel-transport-and-bounded-playwright-request-allHeaders",
  );
  assert.match(
    bridgeEvent.webChannelCdpHeaderAttestationBindingSetHash,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationRegisteredRequestCount,
    bridgeEvent.webChannelCdpHeaderAttestationCompletedRequestCount,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationCompletedRequestCount,
    bridgeEvent.webChannelCdpHeaderAttestationBoundRequestCount,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationBindingResidualCount,
    0,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationBindingFailureCount,
    0,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationPairingTimeoutCount,
    0,
  );
  assert.equal(
    bridgeEvent.webChannelCdpHeaderAttestationCompletionTimeoutCount,
    0,
  );
  const auditAuthenticationRoles = new Set(
    audit.captureIds
      .map((captureId) => captures.get(captureId))
      .map((capture) => authenticationRoleForCapture(capture))
      .filter(Boolean),
  );
  assert.ok(auditAuthenticationRoles.size <= 1);
  const keepaliveClientRequired = auditAuthenticationRoles.size === 1;
  const expectedKeepaliveClientLifecycleCount = Number(keepaliveClientRequired);
  for (const field of [
    "applicationSessionKeepaliveClientInitAttemptCount",
    "applicationSessionKeepaliveClientInitSuccessCount",
    "applicationSessionKeepaliveClientDisposeAttemptCount",
    "applicationSessionKeepaliveClientDisposeSuccessCount",
    "applicationSessionKeepaliveClientDeleteCount",
    "applicationSessionKeepaliveClientHandleDisposeCount",
  ]) {
    assert.equal(bridgeEvent[field], expectedKeepaliveClientLifecycleCount);
  }
  assert.equal(
    bridgeEvent.applicationSessionKeepaliveClientReuseCount,
    keepaliveClientRequired ? audit.captureIds.length : 0,
  );
  assert.equal(
    bridgeEvent.applicationSessionKeepaliveClientRegistryResidualCount,
    0,
  );
  assertExactObjectKeys(
    bridgeEvent.applicationSessionKeepaliveClientLifecycleEvidence,
    [
      "clientRequired",
      "deleteCountBound",
      "disposalAttestationBound",
      "disposalCountBound",
      "handleDisposeCountBound",
      "initializationAttestationBound",
      "initializationCountBound",
      "registryResidualAbsent",
      "reuseCountBound",
    ],
  );
  assert.equal(
    bridgeEvent.applicationSessionKeepaliveClientLifecycleEvidence
      .clientRequired,
    keepaliveClientRequired,
  );
  for (const [field, value] of Object.entries(
    bridgeEvent.applicationSessionKeepaliveClientLifecycleEvidence,
  )) {
    if (field === "clientRequired") continue;
    assert.equal(value, true);
  }
  assert.ok(
    Number.isSafeInteger(
      bridgeEvent.allowedEgressContextCloseBackchannelRetirementCount,
    ),
  );
  assert.ok(
    bridgeEvent.allowedEgressContextCloseBackchannelRetirementCount >= 0,
  );
  assert.ok(
    Number.isSafeInteger(
      bridgeEvent.allowedEgressContextCloseSessionForwardPostRetirementCount,
    ),
  );
  assert.ok(
    bridgeEvent.allowedEgressContextCloseSessionForwardPostRetirementCount >= 0,
  );
  assert.ok(
    bridgeEvent.allowedEgressContextCloseBackchannelRetirementCount +
      bridgeEvent.allowedEgressContextCloseSessionForwardPostRetirementCount <=
      bridgeEvent.webChannelCdpHeaderAttestationBoundRequestCount,
  );
  assert.ok(
    Number.isSafeInteger(
      bridgeEvent.allowedEgressContextCloseTerminationRetirementCount,
    ),
  );
  assert.ok(
    bridgeEvent.allowedEgressContextCloseTerminationRetirementCount >= 0,
  );
  assert.ok(
    Number.isSafeInteger(
      bridgeEvent.webChannelTerminationClassifiedRequestCount,
    ),
  );
  assert.ok(bridgeEvent.webChannelTerminationClassifiedRequestCount >= 0);
  assert.ok(
    bridgeEvent.allowedEgressContextCloseTerminationRetirementCount <=
      bridgeEvent.webChannelTerminationClassifiedRequestCount,
  );
  assert.equal(
    bridgeEvent.playwrightAllHeadersHeaderAttestationRequestCount,
    bridgeEvent.playwrightAllHeadersHeaderAttestationCompletedRequestCount,
  );
  assert.equal(bridgeEvent.secretInitScope, "primary-page-only");
  assert.equal(bridgeEvent.browserGlobalValueKind, "non-secret-fixed-sentinel");
  assert.equal(bridgeEvent.debugSentinelHash, sha256(APP_CHECK_DEBUG_SENTINEL));
  assert.equal(bridgeEvent.protocolDebugLoggingDisabled, true);
  assert.equal(bridgeEvent.browserLaunchExplicitEnvironment, true);
  assert.equal(bridgeEvent.childProcessSecretEnvScrubbed, true);
  assert.equal(bridgeEvent.browserChildEnvironmentAllowlisted, true);
  assert.equal(
    bridgeEvent.browserChildEnvironmentAllowlistHash,
    sha256(canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST)),
  );
  assert.equal(bridgeEvent.browserChildEnvironmentUnexpectedKeyCount, 0);
  assert.equal(typeof bridgeEvent.vercelBypassConfigured, "boolean");
  assert.equal(
    bridgeEvent.vercelBypassAllowedOriginSetHash,
    sha256(canonicalJson(vercelBypassAllowedOrigins)),
  );
  assert.equal(
    bridgeEvent.vercelBypassTransportContractHash,
    sha256(canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT)),
  );
  assert.equal(bridgeEvent.urlMethodFifoCorrelationUsed, false);
  for (const field of [
    "pageRawDebugTokenInjectionCount",
    "pageAppCheckSecretInitRegistrationCount",
    "browserGlobalRawDebugTokenWriteCount",
    "browserGlobalDebugSentinelWriteCount",
    "localStorageSecretWriteCount",
    "contextAppCheckSecretInitCount",
    "scrubbedSecretEnvironmentVariableCount",
    "browserChildSecretEnvironmentVariableCount",
    "browserChildSecretValueObservationCount",
    "browserChildEnvironmentUnexpectedKeyCount",
    "browserGlobalExtraHttpHeaderRegistrationCount",
    "vercelBypassCdpInjectedRequestCount",
    "vercelBypassPreexistingHeaderObservationCount",
    "unauthorizedVercelBypassEgressCount",
    "vercelBypassCdpResponsePausedRequestCount",
    "vercelBypassHttpSuccessResponseCount",
    "vercelBypassHttpErrorResponseCount",
    "vercelBypassRedirectRequestCount",
    "vercelBypassRedirectAbortRequestCount",
    "vercelBypassRedirectResponseAbortRequestCount",
    "vercelBypassResponseErrorAbortRequestCount",
    "vercelBypassObservedEligibleRequestCount",
    "vercelBypassHeaderObservedRequestCount",
    "vercelBypassHeaderMissingRequestCount",
    "vercelBypassHeaderMismatchRequestCount",
    "rawVercelBypassOutputCount",
    "playwrightRouteRegistrationCount",
    "eligibleRequestCount",
    "injectedRequestCount",
    "nativeHeaderRequestCount",
    "scopeMismatchRequestCount",
    "strippedHeaderRequestCount",
    "redirectRequestCount",
    "redirectHeaderAbsentRequestCount",
    "redirectAbortRequestCount",
    "cdpPausedRequestCount",
    "cdpResponsePausedRequestCount",
    "cdpReconciledRequestCount",
    "webChannelCdpHeaderAttestationRegisteredRequestCount",
    "webChannelCdpHeaderAttestationCompletedRequestCount",
    "webChannelCdpHeaderAttestationBoundRequestCount",
    "webChannelCdpHeaderAttestationBindingResidualCount",
    "webChannelCdpHeaderAttestationBindingFailureCount",
    "webChannelCdpHeaderAttestationPairingTimeoutCount",
    "webChannelCdpHeaderAttestationCompletionTimeoutCount",
    "applicationSessionKeepaliveClientInitAttemptCount",
    "applicationSessionKeepaliveClientInitSuccessCount",
    "applicationSessionKeepaliveClientReuseCount",
    "applicationSessionKeepaliveClientDisposeAttemptCount",
    "applicationSessionKeepaliveClientDisposeSuccessCount",
    "applicationSessionKeepaliveClientDeleteCount",
    "applicationSessionKeepaliveClientRegistryResidualCount",
    "applicationSessionKeepaliveClientHandleDisposeCount",
    "allowedEgressContextCloseBackchannelRetirementCount",
    "allowedEgressContextCloseSessionForwardPostRetirementCount",
    "allowedEgressContextCloseTerminationRetirementCount",
    "webChannelTerminationClassifiedRequestCount",
    "playwrightAllHeadersHeaderAttestationRequestCount",
    "playwrightAllHeadersHeaderAttestationCompletedRequestCount",
    "handlerErrorCount",
    "injectedRedirectResponseAbortRequestCount",
    "cdpMonitorPausedRequestCount",
    "preTransmissionBoundaryInspectionCount",
    "preTransmissionBoundaryBlockAttemptCount",
    "preTransmissionBoundaryProductionBlockCount",
    "preTransmissionBoundaryCrossOriginDocumentBlockCount",
    "preTransmissionBoundaryUnboundFirebaseBlockCount",
    "preTransmissionBoundaryNonFirebaseHostnameBlockCount",
    "preTransmissionBoundaryMalformedUrlBlockCount",
    "preTransmissionBoundaryFailRequestCount",
    "debugTokenNetworkObservationCount",
    "debugSentinelNetworkObservationCount",
    "authorizedDebugExchangeBodyReplacementCount",
    "unauthorizedDebugTokenEgressCount",
    "unauthorizedDebugSentinelEgressCount",
    "appCheckHeaderNetworkObservationCount",
    "authorizedAppCheckHeaderRequestCount",
    "unauthorizedAppCheckHeaderEgressCount",
    "sensitiveRedirectRequestCount",
    "sensitiveRedirectAbortRequestCount",
    "sensitiveCdpResponsePausedRequestCount",
    "sensitiveRedirectResponseAbortRequestCount",
    "sensitiveResponseErrorAbortRequestCount",
    "sensitiveRequestTrackingResidualCount",
    "networkHeaderAttestationErrorCount",
    "pendingBridgeDecisionResidualCount",
    "pendingBridgeObservationResidualCount",
    "unexpectedExtraPageCount",
    "unexpectedDedicatedWorkerCount",
    "unexpectedServiceWorkerCount",
    "unexpectedCrossOriginFrameCount",
    "unexpectedOopifTargetCount",
    "unexpectedDedicatedWorkerTargetCount",
    "unexpectedSharedWorkerTargetCount",
    "unexpectedServiceWorkerTargetCount",
    "retainedOopifTargetCount",
    "retainedDedicatedWorkerTargetCount",
    "retainedSharedWorkerTargetCount",
    "retainedServiceWorkerTargetCount",
    "targetDiscoveryActivationCount",
    "targetSnapshotCount",
    "unmatchedProtectedRequestCount",
    "scopeIneligibleProtectedRequestCount",
    "candidateBridgeInjectedRequestCount",
    "screenCaptureProtectedRequestCount",
    "screenCaptureBridgeHeaderRequestCount",
    "screenCaptureNativeHeaderRequestCount",
    "invalidHeaderJwtShapeRequestCount",
    "rawHeaderValueOutputCount",
    "rawTokenOutputCount",
  ]) {
    assert.ok(Number.isInteger(bridgeEvent[field]) && bridgeEvent[field] >= 0);
  }
  assert.equal(bridgeEvent.rawHeaderValueOutputCount, 0);
  assert.equal(bridgeEvent.rawTokenOutputCount, 0);
  assert.equal(bridgeEvent.rawVercelBypassOutputCount, 0);
  assert.equal(bridgeEvent.invalidHeaderJwtShapeRequestCount, 0);
  assert.equal(bridgeEvent.handlerErrorCount, 0);
  assert.equal(bridgeEvent.redirectAbortRequestCount, 0);
  assert.equal(bridgeEvent.injectedRedirectResponseAbortRequestCount, 0);
  assert.ok(bridgeEvent.cdpMonitorPausedRequestCount > 0);
  assert.ok(bridgeEvent.preTransmissionBoundaryInspectionCount > 0);
  assert.equal(
    bridgeEvent.cdpMonitorPausedRequestCount,
    bridgeEvent.preTransmissionBoundaryInspectionCount,
  );
  assert.equal(
    bridgeEvent.preTransmissionBoundaryBlockAttemptCount,
    bridgeEvent.preTransmissionBoundaryProductionBlockCount +
      bridgeEvent.preTransmissionBoundaryCrossOriginDocumentBlockCount +
      bridgeEvent.preTransmissionBoundaryUnboundFirebaseBlockCount +
      bridgeEvent.preTransmissionBoundaryNonFirebaseHostnameBlockCount +
      bridgeEvent.preTransmissionBoundaryMalformedUrlBlockCount,
  );
  assert.equal(
    bridgeEvent.preTransmissionBoundaryFailRequestCount,
    bridgeEvent.preTransmissionBoundaryBlockAttemptCount,
  );
  assert.equal(bridgeEvent.preTransmissionBoundaryBlockAttemptCount, 0);
  assert.equal(bridgeEvent.preTransmissionBoundaryProductionBlockCount, 0);
  assert.equal(
    bridgeEvent.preTransmissionBoundaryCrossOriginDocumentBlockCount,
    0,
  );
  assert.equal(bridgeEvent.preTransmissionBoundaryUnboundFirebaseBlockCount, 0);
  assert.equal(
    bridgeEvent.preTransmissionBoundaryNonFirebaseHostnameBlockCount,
    0,
  );
  assert.equal(bridgeEvent.preTransmissionBoundaryMalformedUrlBlockCount, 0);
  assert.equal(bridgeEvent.preTransmissionBoundaryFailRequestCount, 0);
  assert.equal(bridgeEvent.debugTokenNetworkObservationCount, 0);
  assert.equal(bridgeEvent.unauthorizedDebugTokenEgressCount, 0);
  assert.equal(bridgeEvent.unauthorizedDebugSentinelEgressCount, 0);
  assert.equal(bridgeEvent.unauthorizedAppCheckHeaderEgressCount, 0);
  assert.equal(bridgeEvent.sensitiveRedirectRequestCount, 0);
  assert.equal(bridgeEvent.sensitiveRedirectAbortRequestCount, 0);
  assert.equal(bridgeEvent.sensitiveRedirectResponseAbortRequestCount, 0);
  assert.equal(bridgeEvent.sensitiveResponseErrorAbortRequestCount, 0);
  assert.equal(bridgeEvent.sensitiveRequestTrackingResidualCount, 0);
  assert.equal(bridgeEvent.networkHeaderAttestationErrorCount, 0);
  assert.equal(bridgeEvent.pendingBridgeDecisionResidualCount, 0);
  assert.equal(bridgeEvent.pendingBridgeObservationResidualCount, 0);
  assert.equal(bridgeEvent.unexpectedExtraPageCount, 0);
  assert.equal(bridgeEvent.unexpectedDedicatedWorkerCount, 0);
  assert.equal(bridgeEvent.unexpectedServiceWorkerCount, 0);
  assert.equal(bridgeEvent.unexpectedCrossOriginFrameCount, 0);
  assert.equal(bridgeEvent.unexpectedOopifTargetCount, 0);
  assert.equal(bridgeEvent.unexpectedDedicatedWorkerTargetCount, 0);
  assert.equal(bridgeEvent.unexpectedSharedWorkerTargetCount, 0);
  assert.equal(bridgeEvent.unexpectedServiceWorkerTargetCount, 0);
  assert.equal(bridgeEvent.retainedOopifTargetCount, 0);
  assert.equal(bridgeEvent.retainedDedicatedWorkerTargetCount, 0);
  assert.equal(bridgeEvent.retainedSharedWorkerTargetCount, 0);
  assert.equal(bridgeEvent.retainedServiceWorkerTargetCount, 0);
  assert.equal(bridgeEvent.targetDiscoveryActivationCount, 1);
  assert.equal(bridgeEvent.targetSnapshotCount, 1);
  assert.equal(bridgeEvent.pageRawDebugTokenInjectionCount, 0);
  assert.equal(bridgeEvent.pageAppCheckSecretInitRegistrationCount, 1);
  assert.equal(bridgeEvent.browserGlobalRawDebugTokenWriteCount, 0);
  assert.ok(bridgeEvent.browserGlobalDebugSentinelWriteCount > 0);
  assert.equal(bridgeEvent.localStorageSecretWriteCount, 0);
  assert.equal(bridgeEvent.contextAppCheckSecretInitCount, 0);
  assert.equal(bridgeEvent.scrubbedSecretEnvironmentVariableCount, 4);
  assert.equal(bridgeEvent.browserChildSecretEnvironmentVariableCount, 0);
  assert.equal(bridgeEvent.browserChildSecretValueObservationCount, 0);
  assert.equal(bridgeEvent.playwrightRouteRegistrationCount, 0);
  assert.equal(bridgeEvent.browserGlobalExtraHttpHeaderRegistrationCount, 0);
  assert.equal(bridgeEvent.vercelBypassPreexistingHeaderObservationCount, 0);
  assert.equal(bridgeEvent.unauthorizedVercelBypassEgressCount, 0);
  assert.equal(bridgeEvent.vercelBypassRedirectRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassRedirectAbortRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassRedirectResponseAbortRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassResponseErrorAbortRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassHttpErrorResponseCount, 0);
  assert.equal(bridgeEvent.vercelBypassHeaderMissingRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassHeaderMismatchRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassCdpInjectedRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassObservedEligibleRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassHeaderObservedRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassCdpResponsePausedRequestCount, 0);
  assert.equal(bridgeEvent.vercelBypassHttpSuccessResponseCount, 0);
  assert.equal(
    bridgeEvent.debugSentinelNetworkObservationCount,
    bridgeEvent.authorizedDebugExchangeBodyReplacementCount,
  );
  assert.equal(
    bridgeEvent.appCheckHeaderNetworkObservationCount,
    bridgeEvent.authorizedAppCheckHeaderRequestCount,
  );
  assert.equal(
    bridgeEvent.sensitiveCdpResponsePausedRequestCount,
    bridgeEvent.authorizedDebugExchangeBodyReplacementCount +
      bridgeEvent.authorizedAppCheckHeaderRequestCount,
  );
  assert.equal(
    bridgeEvent.cdpResponsePausedRequestCount,
    bridgeEvent.injectedRequestCount,
  );
  assert.equal(bridgeEvent.unmatchedProtectedRequestCount, 0);
  assert.equal(bridgeEvent.scopeIneligibleProtectedRequestCount, 0);
  if (audit.stage === "candidate") {
    assert.equal(bridgeEvent.eligibleRequestCount, 0);
    assert.equal(bridgeEvent.injectedRequestCount, 0);
    assert.equal(bridgeEvent.nativeHeaderRequestCount, 0);
    assert.equal(bridgeEvent.scopeMismatchRequestCount, 0);
    assert.equal(bridgeEvent.strippedHeaderRequestCount, 0);
    assert.equal(bridgeEvent.redirectRequestCount, 0);
    assert.equal(bridgeEvent.redirectHeaderAbsentRequestCount, 0);
    assert.equal(bridgeEvent.redirectAbortRequestCount, 0);
    assert.equal(bridgeEvent.cdpPausedRequestCount, 0);
    assert.equal(bridgeEvent.cdpResponsePausedRequestCount, 0);
    assert.equal(bridgeEvent.cdpReconciledRequestCount, 0);
    assert.equal(bridgeEvent.handlerErrorCount, 0);
    assert.equal(bridgeEvent.screenCaptureBridgeHeaderRequestCount, 0);
    assert.equal(
      bridgeEvent.screenCaptureNativeHeaderRequestCount,
      bridgeEvent.screenCaptureProtectedRequestCount,
    );
  } else {
    assert.ok(bridgeEvent.cdpPausedRequestCount > 0);
    assert.ok(bridgeEvent.cdpReconciledRequestCount > 0);
    assert.equal(
      bridgeEvent.injectedRequestCount + bridgeEvent.nativeHeaderRequestCount,
      bridgeEvent.eligibleRequestCount,
    );
    assert.equal(
      bridgeEvent.screenCaptureBridgeHeaderRequestCount,
      bridgeEvent.screenCaptureProtectedRequestCount,
    );
    assert.equal(bridgeEvent.screenCaptureNativeHeaderRequestCount, 0);
  }
  assert.equal(bridgeEvent.candidateBridgeInjectedRequestCount, 0);
  auditedBaselineBridgeEligibleRequests += bridgeEvent.eligibleRequestCount;
  auditedBaselineBridgeInjectedRequests += bridgeEvent.injectedRequestCount;
  auditedBaselineBridgeNativeHeaderRequests +=
    bridgeEvent.nativeHeaderRequestCount;
  auditedBaselineBridgeScopeMismatches += bridgeEvent.scopeMismatchRequestCount;
  auditedBaselineBridgeStrippedHeaders +=
    bridgeEvent.strippedHeaderRequestCount;
  auditedBaselineBridgeRedirectRequests += bridgeEvent.redirectRequestCount;
  auditedBaselineBridgeRedirectHeaderAbsentRequests +=
    bridgeEvent.redirectHeaderAbsentRequestCount;
  auditedBaselineBridgeRedirectAbortRequests +=
    bridgeEvent.redirectAbortRequestCount;
  auditedBaselineBridgeCdpPausedRequests += bridgeEvent.cdpPausedRequestCount;
  auditedBaselineBridgeCdpResponsePausedRequests +=
    bridgeEvent.cdpResponsePausedRequestCount;
  auditedBaselineBridgeCdpReconciledRequests +=
    bridgeEvent.cdpReconciledRequestCount;
  auditedWebChannelCdpHeaderAttestationRegisteredRequests +=
    bridgeEvent.webChannelCdpHeaderAttestationRegisteredRequestCount;
  auditedWebChannelCdpHeaderAttestationCompletedRequests +=
    bridgeEvent.webChannelCdpHeaderAttestationCompletedRequestCount;
  auditedWebChannelCdpHeaderAttestationBoundRequests +=
    bridgeEvent.webChannelCdpHeaderAttestationBoundRequestCount;
  auditedWebChannelCdpHeaderAttestationBindingResiduals +=
    bridgeEvent.webChannelCdpHeaderAttestationBindingResidualCount;
  auditedWebChannelCdpHeaderAttestationBindingFailures +=
    bridgeEvent.webChannelCdpHeaderAttestationBindingFailureCount;
  auditedWebChannelCdpHeaderAttestationPairingTimeouts +=
    bridgeEvent.webChannelCdpHeaderAttestationPairingTimeoutCount;
  auditedWebChannelCdpHeaderAttestationCompletionTimeouts +=
    bridgeEvent.webChannelCdpHeaderAttestationCompletionTimeoutCount;
  auditedAllowedEgressContextCloseBackchannelRetirements +=
    bridgeEvent.allowedEgressContextCloseBackchannelRetirementCount;
  auditedAllowedEgressContextCloseSessionForwardPostRetirements +=
    bridgeEvent.allowedEgressContextCloseSessionForwardPostRetirementCount;
  auditedAllowedEgressContextCloseTerminationRetirements +=
    bridgeEvent.allowedEgressContextCloseTerminationRetirementCount;
  auditedWebChannelTerminationClassifiedRequests +=
    bridgeEvent.webChannelTerminationClassifiedRequestCount;
  auditedPlaywrightAllHeadersHeaderAttestationRequests +=
    bridgeEvent.playwrightAllHeadersHeaderAttestationRequestCount;
  auditedPlaywrightAllHeadersHeaderAttestationCompletedRequests +=
    bridgeEvent.playwrightAllHeadersHeaderAttestationCompletedRequestCount;
  auditedBaselineBridgeHandlerErrors += bridgeEvent.handlerErrorCount;
  auditedBaselineBridgeInjectedRedirectResponseAborts +=
    bridgeEvent.injectedRedirectResponseAbortRequestCount;
  auditedAppCheckCdpMonitorPausedRequests +=
    bridgeEvent.cdpMonitorPausedRequestCount;
  auditedPreTransmissionBoundaryInspections +=
    bridgeEvent.preTransmissionBoundaryInspectionCount;
  auditedPreTransmissionBoundaryBlockAttempts +=
    bridgeEvent.preTransmissionBoundaryBlockAttemptCount;
  auditedPreTransmissionBoundaryProductionBlocks +=
    bridgeEvent.preTransmissionBoundaryProductionBlockCount;
  auditedPreTransmissionBoundaryCrossOriginDocumentBlocks +=
    bridgeEvent.preTransmissionBoundaryCrossOriginDocumentBlockCount;
  auditedPreTransmissionBoundaryUnboundFirebaseBlocks +=
    bridgeEvent.preTransmissionBoundaryUnboundFirebaseBlockCount;
  auditedPreTransmissionBoundaryNonFirebaseHostnameBlocks +=
    bridgeEvent.preTransmissionBoundaryNonFirebaseHostnameBlockCount;
  auditedPreTransmissionBoundaryMalformedUrlBlocks +=
    bridgeEvent.preTransmissionBoundaryMalformedUrlBlockCount;
  auditedPreTransmissionBoundaryFailRequests +=
    bridgeEvent.preTransmissionBoundaryFailRequestCount;
  auditedDebugTokenNetworkObservations +=
    bridgeEvent.debugTokenNetworkObservationCount;
  auditedDebugSentinelNetworkObservations +=
    bridgeEvent.debugSentinelNetworkObservationCount;
  auditedAuthorizedDebugExchangeBodyReplacements +=
    bridgeEvent.authorizedDebugExchangeBodyReplacementCount;
  auditedUnauthorizedDebugTokenEgresses +=
    bridgeEvent.unauthorizedDebugTokenEgressCount;
  auditedUnauthorizedDebugSentinelEgresses +=
    bridgeEvent.unauthorizedDebugSentinelEgressCount;
  auditedAppCheckHeaderNetworkObservations +=
    bridgeEvent.appCheckHeaderNetworkObservationCount;
  auditedAuthorizedAppCheckHeaderRequests +=
    bridgeEvent.authorizedAppCheckHeaderRequestCount;
  auditedUnauthorizedAppCheckHeaderEgresses +=
    bridgeEvent.unauthorizedAppCheckHeaderEgressCount;
  auditedSensitiveAppCheckRedirectRequests +=
    bridgeEvent.sensitiveRedirectRequestCount;
  auditedSensitiveAppCheckRedirectAborts +=
    bridgeEvent.sensitiveRedirectAbortRequestCount;
  auditedSensitiveAppCheckCdpResponsePausedRequests +=
    bridgeEvent.sensitiveCdpResponsePausedRequestCount;
  auditedSensitiveAppCheckRedirectResponseAborts +=
    bridgeEvent.sensitiveRedirectResponseAbortRequestCount;
  auditedSensitiveAppCheckResponseErrorAborts +=
    bridgeEvent.sensitiveResponseErrorAbortRequestCount;
  auditedSensitiveAppCheckRequestTrackingResiduals +=
    bridgeEvent.sensitiveRequestTrackingResidualCount;
  auditedBrowserNetworkHeaderAttestationErrors +=
    bridgeEvent.networkHeaderAttestationErrorCount;
  auditedPendingBridgeDecisionResiduals +=
    bridgeEvent.pendingBridgeDecisionResidualCount;
  auditedPendingBridgeObservationResiduals +=
    bridgeEvent.pendingBridgeObservationResidualCount;
  auditedUnexpectedExtraPages += bridgeEvent.unexpectedExtraPageCount;
  auditedUnexpectedDedicatedWorkers +=
    bridgeEvent.unexpectedDedicatedWorkerCount;
  auditedUnexpectedServiceWorkers += bridgeEvent.unexpectedServiceWorkerCount;
  auditedUnexpectedCrossOriginFrames +=
    bridgeEvent.unexpectedCrossOriginFrameCount;
  auditedUnexpectedOopifTargets += bridgeEvent.unexpectedOopifTargetCount;
  auditedUnexpectedDedicatedWorkerTargets +=
    bridgeEvent.unexpectedDedicatedWorkerTargetCount;
  auditedUnexpectedSharedWorkerTargets +=
    bridgeEvent.unexpectedSharedWorkerTargetCount;
  auditedUnexpectedServiceWorkerTargets +=
    bridgeEvent.unexpectedServiceWorkerTargetCount;
  auditedRetainedOopifTargets += bridgeEvent.retainedOopifTargetCount;
  auditedRetainedDedicatedWorkerTargets +=
    bridgeEvent.retainedDedicatedWorkerTargetCount;
  auditedRetainedSharedWorkerTargets +=
    bridgeEvent.retainedSharedWorkerTargetCount;
  auditedRetainedServiceWorkerTargets +=
    bridgeEvent.retainedServiceWorkerTargetCount;
  auditedTargetDiscoveryActivations +=
    bridgeEvent.targetDiscoveryActivationCount;
  auditedTargetSnapshots += bridgeEvent.targetSnapshotCount;
  auditedPageRawDebugTokenInjections +=
    bridgeEvent.pageRawDebugTokenInjectionCount;
  auditedBrowserGlobalRawDebugTokenWrites +=
    bridgeEvent.browserGlobalRawDebugTokenWriteCount;
  auditedBrowserGlobalDebugSentinelWrites +=
    bridgeEvent.browserGlobalDebugSentinelWriteCount;
  auditedLocalStorageSecretWrites += bridgeEvent.localStorageSecretWriteCount;
  auditedBrowserGlobalExtraHttpHeaderRegistrations +=
    bridgeEvent.browserGlobalExtraHttpHeaderRegistrationCount;
  auditedBrowserChildEnvironmentUnexpectedKeys +=
    bridgeEvent.browserChildEnvironmentUnexpectedKeyCount;
  auditedVercelBypassCdpInjectedRequests +=
    bridgeEvent.vercelBypassCdpInjectedRequestCount;
  auditedVercelBypassPreexistingHeaderObservations +=
    bridgeEvent.vercelBypassPreexistingHeaderObservationCount;
  auditedUnauthorizedVercelBypassEgresses +=
    bridgeEvent.unauthorizedVercelBypassEgressCount;
  auditedVercelBypassCdpResponsePausedRequests +=
    bridgeEvent.vercelBypassCdpResponsePausedRequestCount;
  auditedVercelBypassHttpSuccessResponses +=
    bridgeEvent.vercelBypassHttpSuccessResponseCount;
  auditedVercelBypassHttpErrorResponses +=
    bridgeEvent.vercelBypassHttpErrorResponseCount;
  auditedVercelBypassRedirectRequests +=
    bridgeEvent.vercelBypassRedirectRequestCount;
  auditedVercelBypassRedirectAborts +=
    bridgeEvent.vercelBypassRedirectAbortRequestCount;
  auditedVercelBypassRedirectResponseAborts +=
    bridgeEvent.vercelBypassRedirectResponseAbortRequestCount;
  auditedVercelBypassResponseErrorAborts +=
    bridgeEvent.vercelBypassResponseErrorAbortRequestCount;
  auditedVercelBypassObservedEligibleRequests +=
    bridgeEvent.vercelBypassObservedEligibleRequestCount;
  auditedVercelBypassHeaderObservedRequests +=
    bridgeEvent.vercelBypassHeaderObservedRequestCount;
  auditedVercelBypassHeaderMissingRequests +=
    bridgeEvent.vercelBypassHeaderMissingRequestCount;
  auditedVercelBypassHeaderMismatches +=
    bridgeEvent.vercelBypassHeaderMismatchRequestCount;
  auditedRawVercelBypassOutputs += bridgeEvent.rawVercelBypassOutputCount;
  auditedVercelBypassConfiguredValues.add(bridgeEvent.vercelBypassConfigured);
  auditedBaselineBridgeDecisionUnmatchedProtectedRequests +=
    bridgeEvent.unmatchedProtectedRequestCount;
  auditedBaselineBridgeScopeIneligibleProtectedRequests +=
    bridgeEvent.scopeIneligibleProtectedRequestCount;
  auditedCandidateBridgeInjectedRequests +=
    bridgeEvent.candidateBridgeInjectedRequestCount;
  if (audit.stage === "baseline") {
    auditedBaselineScreenCaptureProtectedRequests +=
      bridgeEvent.screenCaptureProtectedRequestCount;
    auditedBaselineScreenCaptureBridgeRequests +=
      bridgeEvent.screenCaptureBridgeHeaderRequestCount;
  } else {
    auditedCandidateScreenCaptureProtectedRequests +=
      bridgeEvent.screenCaptureProtectedRequestCount;
    auditedCandidateScreenCaptureNativeRequests +=
      bridgeEvent.screenCaptureNativeHeaderRequestCount;
  }
  const captureEvents = events.filter((event) => event.type === "capture");
  assert.deepEqual(
    captureEvents.map((event) => event.id).sort(),
    [...audit.captureIds].sort(),
    `${audit.id} capture attestations are incomplete.`,
  );
  for (const event of captureEvents) {
    const capture = captures.get(event.id);
    assert.ok(capture, `${event.id} is not a manifest capture.`);
    assertTelemetryCapabilityGuardAttestation(
      capture.telemetryCapabilityGuardAttestation,
      {
        expectedStage: audit.stage,
        expectedGroupKey: audit.id,
        expectedCaptureIds: audit.captureIds,
      },
    );
    assert.equal(
      capture.telemetryCapabilityGuardAttestation.point,
      "post-screen-navigation",
    );
    assert.equal(
      capture.telemetryCapabilityGuardAttestation.captureId,
      capture.id,
    );
    const matchingTelemetryCapabilityGuardAttestations =
      telemetryCapabilityGuardScreenAttestations.filter(
        ({ captureId }) => captureId === capture.id,
      );
    assert.deepEqual(matchingTelemetryCapabilityGuardAttestations, [
      capture.telemetryCapabilityGuardAttestation,
    ]);
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
      telemetryCapabilityGuardAttestation:
        capture.telemetryCapabilityGuardAttestation,
      upstreamProvenance: capture.upstreamProvenance,
      networkPolicy: capture.networkPolicy,
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
  const originRewriteEvents = events.filter(
    (event) => event.type === "origin-rewrite",
  );
  assert.equal(
    events.length,
    5 +
      requestEvents.length +
      responseEvents.length +
      originRewriteEvents.length +
      deterministicEvents.length +
      externalStaticEvents.length +
      telemetryEvents.length +
      telemetryCapabilityGuardEvents.length +
      faviconFallbackEvents.length +
      captureEvents.length,
    `${audit.id} has an unexpected browser-audit event count.`,
  );
  assert.equal(originRewriteEvents.length, originRewriteSummary.requestCount);
  const originRewriteProvenanceRows = [];
  for (const [sequence, event] of originRewriteEvents.entries()) {
    assertExactObjectKeys(event, [
      "type",
      "sequence",
      "stage",
      "phase",
      "captureId",
      "method",
      "resourceType",
      "kind",
      "browserOrigin",
      "browserPath",
      "browserUrlSha256",
      "upstreamDeploymentId",
      "upstreamOrigin",
      "upstreamUrl",
      "upstreamUrlSha256",
      "redirectRequest",
      "redirectResponse",
      "responseStatus",
      "responseError",
      "payloadSha256",
      "payloadBytes",
      "immutableAttestationSha256",
      "immutableAttestationBytes",
      "byteMatch",
    ]);
    assert.equal(event.sequence, sequence);
    assert.equal(event.stage, audit.stage);
    assert.ok(
      ["context-bootstrap", "authentication", "screen-capture"].includes(
        event.phase,
      ),
    );
    assert.equal(
      event.captureId === null || audit.captureIds.includes(event.captureId),
      true,
    );
    assert.ok(contract.browserTransport.allowedMethods.includes(event.method));
    assert.equal(event.browserOrigin, stableBrowserOrigin);
    const browserUrl = new URL(
      event.browserPath,
      stableBrowserOrigin,
    ).toString();
    assert.equal(new URL(browserUrl).origin, stableBrowserOrigin);
    assert.equal(event.browserUrlSha256, sha256(browserUrl));
    const decision = stableOriginRewriteDecision({
      stage: audit.stage,
      requestUrl: browserUrl,
      method: event.method,
      resourceType: event.resourceType,
      browserOrigin: stableBrowserOrigin,
      upstreamOrigins,
      transportContract: contract.browserTransport,
    });
    assert.equal(decision.eligible, true);
    assert.equal(event.kind, decision.kind);
    assert.equal(
      event.upstreamDeploymentId,
      immutableUpstreamBinding[audit.stage].deploymentId,
    );
    assert.equal(event.upstreamOrigin, upstreamOrigins[audit.stage]);
    assert.equal(event.upstreamUrl, decision.upstreamUrl);
    assert.equal(event.upstreamUrlSha256, sha256(event.upstreamUrl));
    assert.equal(event.redirectRequest, false);
    assert.equal(event.redirectResponse, false);
    assert.equal(event.responseError, false);
    assert.ok(event.responseStatus >= 200 && event.responseStatus < 300);
    const bodyHashRequired =
      event.method === "GET" &&
      contract.browserTransport.responseBodyHashResourceTypes.includes(
        event.resourceType,
      );
    if (bodyHashRequired) {
      assert.match(event.payloadSha256, /^[a-f0-9]{64}$/u);
      assert.ok(Number.isInteger(event.payloadBytes) && event.payloadBytes > 0);
      assert.equal(event.immutableAttestationSha256, event.payloadSha256);
      assert.equal(event.immutableAttestationBytes, event.payloadBytes);
      assert.equal(event.byteMatch, true);
    } else {
      assert.equal(event.payloadSha256, null);
      assert.equal(event.payloadBytes, null);
      assert.equal(event.immutableAttestationSha256, null);
      assert.equal(event.immutableAttestationBytes, null);
      assert.equal(event.byteMatch, null);
    }
    originRewriteProvenanceRows.push({
      method: event.method,
      resourceType: event.resourceType,
      kind: event.kind,
      browserPath: event.browserPath,
      browserUrlSha256: event.browserUrlSha256,
      upstreamUrl: event.upstreamUrl,
      upstreamUrlSha256: event.upstreamUrlSha256,
      responseStatus: event.responseStatus,
      responseBodySha256: event.payloadSha256,
      responseBodyBytes: event.payloadBytes,
      immutableAttestationSha256: event.immutableAttestationSha256,
      immutableAttestationBytes: event.immutableAttestationBytes,
      byteMatch: event.byteMatch,
    });
  }
  assert.equal(
    originRewriteSummary.resourceProvenanceSha256,
    sha256(Buffer.from(canonicalJson(originRewriteProvenanceRows))),
  );
  const rewrittenDocumentEvents = originRewriteEvents.filter(
    (event) => event.resourceType === "Document",
  );
  const rewrittenScriptEvents = originRewriteEvents.filter(
    (event) => event.resourceType === "Script",
  );
  const hashedRewriteEvents = originRewriteEvents.filter(
    (event) => event.payloadSha256,
  );
  assert.equal(originRewriteSummary.responseCount, originRewriteEvents.length);
  assert.equal(
    originRewriteSummary.httpSuccessResponseCount,
    originRewriteEvents.length,
  );
  assert.equal(
    originRewriteSummary.documentRequestCount,
    rewrittenDocumentEvents.length,
  );
  assert.equal(
    originRewriteSummary.scriptRequestCount,
    rewrittenScriptEvents.length,
  );
  assert.equal(originRewriteSummary.bodyHashCount, hashedRewriteEvents.length);
  assert.deepEqual(
    originRewriteSummary.documentBodySha256s,
    [
      ...new Set(
        rewrittenDocumentEvents
          .map((event) => event.payloadSha256)
          .filter(Boolean),
      ),
    ].sort(),
  );
  assert.deepEqual(
    originRewriteSummary.scriptBodySha256s,
    [
      ...new Set(
        rewrittenScriptEvents
          .map((event) => event.payloadSha256)
          .filter(Boolean),
      ),
    ].sort(),
  );
  for (const captureId of audit.captureIds) {
    assert.deepEqual(
      captures.get(captureId).upstreamProvenance,
      originRewriteSummary,
    );
    assert.deepEqual(
      captures.get(captureId).networkPolicy,
      auditedNetworkPolicySummaries.get(audit.id),
    );
  }
  auditedStableOriginRewriteRequests += originRewriteEvents.length;
  auditedStableOriginRewriteResponses += originRewriteEvents.length;
  auditedStableOriginRewriteHttpSuccessResponses += originRewriteEvents.length;
  auditedStableOriginRewriteHttpErrorResponses += originRewriteEvents.filter(
    (event) => event.responseStatus >= 400,
  ).length;
  auditedStableOriginRewriteDocumentRequests += rewrittenDocumentEvents.length;
  auditedStableOriginRewriteScriptRequests += rewrittenScriptEvents.length;
  auditedStableOriginRewriteBodyHashes += hashedRewriteEvents.length;
  auditedStableOriginRewriteBodyHashMismatches += hashedRewriteEvents.filter(
    (event) => event.byteMatch !== true,
  ).length;
  auditedStableOriginRewriteRedirectRequests += originRewriteEvents.filter(
    (event) => event.redirectRequest,
  ).length;
  auditedStableOriginRewriteRedirectResponses += originRewriteEvents.filter(
    (event) => event.redirectResponse,
  ).length;
  auditedStableOriginRewriteResponseErrors += originRewriteEvents.filter(
    (event) => event.responseError,
  ).length;
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
    assertAuditedNetworkBoundaryEvent({
      event,
      expectedApiKeySha256: manifest.environment.firebaseConfig.apiKeySha256,
    });
    assert.equal(
      event.firebaseService,
      firebaseServiceForHostname(event.hostname),
      `${audit.id} contains a hostname/service classification mismatch.`,
    );
    assert.equal(
      event.firebase,
      event.firebaseService === null
        ? false
        : knownFirebaseServices.has(event.firebaseService),
      `${audit.id} contains an invalid Firebase service classification.`,
    );
    assert.equal(typeof event.nonFirebaseHostnameAllowed, "boolean");
    assert.equal(typeof event.resourceType, "string");
    if (event.firebase) {
      assert.equal(event.nonFirebaseHostnameAllowed, false);
      assert.equal(event.nonFirebasePolicyRuleId, null);
    } else if (nonFirebaseNetworkAllowedHostnames.includes(event.hostname)) {
      assert.equal(event.nonFirebaseHostnameAllowed, true);
      assert.equal(
        event.nonFirebasePolicyRuleId,
        "exact-browser-or-immutable-origin",
      );
    } else if (event.nonFirebasePolicyRuleId?.startsWith("external-static:")) {
      const ruleId = event.nonFirebasePolicyRuleId.slice(
        "external-static:".length,
      );
      const rule =
        contract.networkBoundary.externalStaticRequestAllowlist.rules.find(
          (candidate) => candidate.id === ruleId,
        );
      assert.ok(rule);
      assert.equal(event.hostname, rule.hostname);
      assert.equal(
        rule.resourceTypes.some(
          (resourceType) =>
            resourceType.toLowerCase() === event.resourceType.toLowerCase(),
        ),
        true,
      );
      assert.equal(event.nonFirebaseHostnameAllowed, true);
    } else {
      assert.equal(
        event.nonFirebasePolicyRuleId,
        `deterministic:${contract.browserTransport.deterministicRecaptchaResponse.id}`,
      );
      assert.equal(
        event.hostname,
        contract.browserTransport.deterministicRecaptchaResponse.hostname,
      );
      assert.equal(
        event.resourceType.toLowerCase(),
        contract.browserTransport.deterministicRecaptchaResponse.resourceType.toLowerCase(),
      );
      assert.equal(event.nonFirebaseHostnameAllowed, true);
    }
    if (!event.firebase) {
      assert.equal(
        event.nonFirebaseHostnameAllowed,
        true,
        `${audit.id} contains an unallowlisted non-Firebase hostname: ${event.hostname}.`,
      );
    }
    if (isVercelNetworkHostname(event.hostname)) {
      assert.equal(
        nonFirebaseNetworkAllowedHostnames.includes(event.hostname),
        true,
        `${audit.id} contains an unknown or Production Vercel hostname: ${event.hostname}.`,
      );
    }
    assert.equal(
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(event.hostname),
      ),
      false,
      `${audit.id} contains a forbidden web hostname: ${event.hostname}.`,
    );
    assert.match(
      event.correlationId ?? "",
      new RegExp(
        `^${audit.id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:request-[0-9]+$`,
        "u",
      ),
    );
    assert.equal(typeof event.appCheckHeaderPresent, "boolean");
    assert.equal(typeof event.appCheckHeaderJwtShapeValid, "boolean");
    for (const field of [
      "appCheckBridgeDecisionObserved",
      "appCheckBridgeScopeEligible",
      "appCheckBridgeHeaderStripped",
      "appCheckBridgeRedirectedRequest",
    ]) {
      assert.equal(typeof event[field], "boolean");
    }
    assert.ok(
      [
        null,
        "native-sdk",
        "capture-owned-fetch",
        "baseline-cdp-fetch-bridge",
      ].includes(event.appCheckHeaderSource),
    );
    assert.equal(
      event.appCheckHeaderPresent,
      event.appCheckHeaderSource !== null,
    );
    assert.equal(
      event.appCheckHeaderJwtShapeValid,
      event.appCheckHeaderPresent,
    );
  }
  for (const [sequence, request] of requestEvents.entries()) {
    assert.deepEqual(
      Object.keys(request).sort(),
      [
        "type",
        "sequence",
        "phase",
        "captureId",
        "correlationId",
        "method",
        "hostname",
        "canonicalHostname",
        "firebaseService",
        "firebase",
        "nonFirebaseHostnameAllowed",
        "staging",
        "production",
        "unboundFirebase",
        "malformedUrlEncoding",
        "productionWrite",
        "apiKeySha256",
        "apiKeyValueCount",
        "apiKeyBindingValid",
        "firebaseTransportValid",
        "serviceResourceBound",
        "appCheckHeaderPresent",
        "appCheckHeaderSource",
        "appCheckHeaderJwtShapeValid",
        "appCheckBridgeDecisionObserved",
        "appCheckBridgeScopeEligible",
        "appCheckBridgeHeaderStripped",
        "appCheckBridgeRedirectedRequest",
        "observedProjectIds",
      ].sort(),
    );
    assert.equal(request.sequence, sequence);
  }
  for (const [sequence, response] of responseEvents.entries()) {
    assert.deepEqual(
      Object.keys(response).sort(),
      [
        "type",
        "sequence",
        "phase",
        "captureId",
        "correlationId",
        "method",
        "hostname",
        "canonicalHostname",
        "firebaseService",
        "status",
        "firebase",
        "nonFirebaseHostnameAllowed",
        "staging",
        "production",
        "unboundFirebase",
        "malformedUrlEncoding",
        "apiKeySha256",
        "apiKeyValueCount",
        "apiKeyBindingValid",
        "firebaseTransportValid",
        "serviceResourceBound",
        "appCheckHeaderPresent",
        "appCheckHeaderSource",
        "appCheckHeaderJwtShapeValid",
        "appCheckBridgeDecisionObserved",
        "appCheckBridgeScopeEligible",
        "appCheckBridgeHeaderStripped",
        "appCheckBridgeRedirectedRequest",
        "observedProjectIds",
      ].sort(),
    );
    assert.equal(response.sequence, sequence);
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
      "canonicalHostname",
      "firebaseService",
      "firebase",
      "nonFirebaseHostnameAllowed",
      "staging",
      "production",
      "unboundFirebase",
      "malformedUrlEncoding",
      "apiKeySha256",
      "apiKeyValueCount",
      "apiKeyBindingValid",
      "firebaseTransportValid",
      "serviceResourceBound",
      "appCheckHeaderPresent",
      "appCheckHeaderSource",
      "appCheckHeaderJwtShapeValid",
      "appCheckBridgeDecisionObserved",
      "appCheckBridgeScopeEligible",
      "appCheckBridgeHeaderStripped",
      "appCheckBridgeRedirectedRequest",
    ]) {
      assert.deepEqual(
        response[field],
        request[field],
        `${audit.id} response correlation changed ${field}.`,
      );
    }
    assert.deepEqual(response.observedProjectIds, request.observedProjectIds);
  }
  const expectedAuditApplicationSessionKeepaliveCount = audit.captureIds.filter(
    (captureId) =>
      Boolean(authenticationRoleForCapture(captures.get(captureId))),
  ).length;
  const expectedAuditApplicationSessionPreNavigationFenceCount = Number(
    expectedAuditApplicationSessionKeepaliveCount > 0,
  );
  const expectedFunctionsHostname = `asia-northeast3-${contract.firebaseProjectId}.cloudfunctions.net`;
  const applicationSessionKeepaliveRequests = requestEvents.filter(
    (request) =>
      request.phase === "session-keepalive" &&
      request.method === "POST" &&
      request.firebaseService === "functions",
  );
  const applicationSessionKeepaliveResponses = responseEvents.filter(
    (response) =>
      response.phase === "session-keepalive" &&
      response.method === "POST" &&
      response.firebaseService === "functions",
  );
  for (const event of [
    ...applicationSessionKeepaliveRequests,
    ...applicationSessionKeepaliveResponses,
  ]) {
    assert.equal(event.captureId, null);
    assert.equal(event.hostname, expectedFunctionsHostname);
    assert.equal(event.canonicalHostname, expectedFunctionsHostname);
    assert.equal(event.firebase, true);
    assert.equal(event.staging, true);
    assert.equal(event.production, false);
    assert.equal(event.unboundFirebase, false);
    assert.equal(event.firebaseTransportValid, true);
    assert.equal(event.serviceResourceBound, true);
    assert.equal(event.appCheckHeaderPresent, true);
    assert.equal(event.appCheckHeaderJwtShapeValid, true);
    assert.equal(event.appCheckHeaderSource, "capture-owned-fetch");
    assert.equal(
      event.appCheckBridgeDecisionObserved,
      audit.stage === "baseline",
    );
    assert.equal(event.appCheckBridgeScopeEligible, audit.stage === "baseline");
    assert.equal(event.appCheckBridgeHeaderStripped, false);
    assert.equal(event.appCheckBridgeRedirectedRequest, false);
  }
  for (const response of applicationSessionKeepaliveResponses) {
    assert.ok(response.status >= 200 && response.status < 300);
  }
  assert.equal(
    applicationSessionKeepaliveRequests.length,
    expectedAuditApplicationSessionKeepaliveCount +
      expectedAuditApplicationSessionPreNavigationFenceCount,
    `${audit.id} has an invalid application-session keepalive request count.`,
  );
  assert.equal(
    applicationSessionKeepaliveResponses.length,
    expectedAuditApplicationSessionKeepaliveCount +
      expectedAuditApplicationSessionPreNavigationFenceCount,
    `${audit.id} has an invalid application-session keepalive response count.`,
  );
  assert.deepEqual(
    applicationSessionKeepaliveResponses
      .map((response) => response.correlationId)
      .sort(),
    applicationSessionKeepaliveRequests
      .map((request) => request.correlationId)
      .sort(),
    `${audit.id} has an unpaired application-session keepalive exchange.`,
  );
  auditedApplicationSessionKeepaliveRequestCounts[audit.stage] +=
    applicationSessionKeepaliveRequests.length;
  auditedApplicationSessionKeepaliveResponseCounts[audit.stage] +=
    applicationSessionKeepaliveResponses.length;
  for (const event of captureEvents) {
    const capture = captures.get(event.id);
    if (!capture.fixtureMarker) continue;
    const successfulCaptureDataRequestIds = new Set(
      responseEvents
        .filter(
          (response) =>
            response.captureId === event.id &&
            response.staging &&
            fixtureDataServices.has(response.firebaseService) &&
            response.status >= 200 &&
            response.status < 300,
        )
        .map((response) => response.correlationId),
    );
    const successfulCaptureDataRequests = requestEvents.filter(
      (request) =>
        request.captureId === event.id &&
        request.method !== "OPTIONS" &&
        request.staging &&
        fixtureDataServices.has(request.firebaseService) &&
        successfulCaptureDataRequestIds.has(request.correlationId),
    );
    assert.ok(
      successfulCaptureDataRequests.length > 0,
      `${event.id} has no capture-bound staging data request.`,
    );
    const requiredHeaderSource =
      capture.stage === "baseline" ? "baseline-cdp-fetch-bridge" : "native-sdk";
    assert.equal(
      successfulCaptureDataRequests.every(
        (request) =>
          request.appCheckHeaderPresent &&
          request.appCheckHeaderJwtShapeValid &&
          request.appCheckHeaderSource === requiredHeaderSource,
      ),
      true,
      `${event.id} is not bound to the required ${requiredHeaderSource} App Check JWT.`,
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
  const nonFirebaseRequests = requestEvents.filter(
    (request) => !request.firebase,
  );
  const nonFirebaseResponses = responseEvents.filter(
    (response) => !response.firebase,
  );
  const unallowlistedNonFirebaseRequests = nonFirebaseRequests.filter(
    (request) => !request.nonFirebaseHostnameAllowed,
  );
  const unallowlistedNonFirebaseResponses = nonFirebaseResponses.filter(
    (response) => !response.nonFirebaseHostnameAllowed,
  );
  const productionVercelRequests = unallowlistedNonFirebaseRequests.filter(
    (request) =>
      isVercelNetworkHostname(request.hostname) &&
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(request.hostname),
      ),
  );
  const productionVercelResponses = unallowlistedNonFirebaseResponses.filter(
    (response) =>
      isVercelNetworkHostname(response.hostname) &&
      contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(response.hostname),
      ),
  );
  const unknownVercelRequests = unallowlistedNonFirebaseRequests.filter(
    (request) =>
      isVercelNetworkHostname(request.hostname) &&
      !contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(request.hostname),
      ),
  );
  const unknownVercelResponses = unallowlistedNonFirebaseResponses.filter(
    (response) =>
      isVercelNetworkHostname(response.hostname) &&
      !contract.networkBoundary.forbiddenWebHosts.includes(
        canonicalNetworkHostname(response.hostname),
      ),
  );
  const stagingResponses = responseEvents.filter(
    (response) =>
      response.firebase && response.staging && response.status < 400,
  );
  const stagingDataRequests = stagingRequests.filter((request) =>
    fixtureDataServices.has(request.firebaseService),
  );
  const appCheckProtectedDataRequests = stagingDataRequests.filter(
    (request) => request.method !== "OPTIONS",
  );
  const screenCaptureProtectedDataRequests =
    appCheckProtectedDataRequests.filter(
      (request) => request.phase === "screen-capture",
    );
  assert.equal(
    bridgeEvent.screenCaptureProtectedRequestCount,
    screenCaptureProtectedDataRequests.length,
  );
  assert.equal(
    bridgeEvent.screenCaptureBridgeHeaderRequestCount,
    screenCaptureProtectedDataRequests.filter(
      (request) => request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
    ).length,
  );
  assert.equal(
    bridgeEvent.screenCaptureNativeHeaderRequestCount,
    screenCaptureProtectedDataRequests.filter(
      (request) => request.appCheckHeaderSource === "native-sdk",
    ).length,
  );
  assert.equal(
    bridgeEvent.invalidHeaderJwtShapeRequestCount,
    screenCaptureProtectedDataRequests.filter(
      (request) => !request.appCheckHeaderJwtShapeValid,
    ).length,
  );
  if (audit.stage === "baseline") {
    assert.equal(
      appCheckProtectedDataRequests.every(
        (request) => request.appCheckBridgeDecisionObserved,
      ),
      true,
    );
    assert.equal(
      appCheckProtectedDataRequests.every(
        (request) => request.appCheckBridgeScopeEligible,
      ),
      true,
    );
    assert.equal(
      bridgeEvent.eligibleRequestCount,
      appCheckProtectedDataRequests.length,
    );
    assert.equal(
      bridgeEvent.injectedRequestCount,
      appCheckProtectedDataRequests.filter(
        (request) =>
          request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
      ).length,
    );
    assert.equal(
      bridgeEvent.nativeHeaderRequestCount,
      appCheckProtectedDataRequests.filter(
        (request) =>
          request.appCheckHeaderSource === "native-sdk" ||
          request.appCheckHeaderSource === "capture-owned-fetch",
      ).length,
    );
  } else {
    assert.equal(
      requestEvents.every(
        (request) =>
          !request.appCheckBridgeDecisionObserved &&
          !request.appCheckBridgeScopeEligible &&
          !request.appCheckBridgeHeaderStripped &&
          !request.appCheckBridgeRedirectedRequest,
      ),
      true,
    );
  }
  auditedProtectedHeaderJwtShapeInvalidRequests +=
    appCheckProtectedDataRequests.filter(
      (request) =>
        !request.appCheckHeaderPresent || !request.appCheckHeaderJwtShapeValid,
    ).length;
  auditedProtectedHeaderPresentRequests += appCheckProtectedDataRequests.filter(
    (request) => request.appCheckHeaderPresent,
  ).length;
  auditedProtectedHeaderMissingRequests += appCheckProtectedDataRequests.filter(
    (request) => !request.appCheckHeaderPresent,
  ).length;
  auditedProtectedHeaderJwtShapeValidRequests +=
    appCheckProtectedDataRequests.filter(
      (request) => request.appCheckHeaderJwtShapeValid,
    ).length;
  if (audit.stage === "baseline") {
    auditedBaselineEffectiveHeaderMissingRequests +=
      appCheckProtectedDataRequests.filter(
        (request) => !request.appCheckHeaderPresent,
      ).length;
  }
  const appCheckExchangeRequests = stagingRequests.filter(
    (request) =>
      request.firebaseService === "app-check" && request.method === "POST",
  );
  const stagingDataResponses = stagingResponses.filter((response) =>
    fixtureDataServices.has(response.firebaseService),
  );
  const successfulAppCheckExchangeResponses = stagingResponses.filter(
    (response) =>
      response.firebaseService === "app-check" &&
      response.method === "POST" &&
      response.status === 200,
  );
  const groupNetwork = {
    requestCount: requestEvents.length,
    responseCount: responseEvents.length,
    firebaseRequestCount: firebaseRequests.length,
    nonFirebaseRequestCount: nonFirebaseRequests.length,
    nonFirebaseAllowedRequestCount: nonFirebaseRequests.filter(
      (request) => request.nonFirebaseHostnameAllowed,
    ).length,
    nonFirebaseUnallowlistedRequestCount:
      unallowlistedNonFirebaseRequests.length,
    nonFirebaseUnallowlistedResponseCount:
      unallowlistedNonFirebaseResponses.length,
    productionVercelRequestCount: productionVercelRequests.length,
    productionVercelResponseCount: productionVercelResponses.length,
    unknownVercelRequestCount: unknownVercelRequests.length,
    unknownVercelResponseCount: unknownVercelResponses.length,
    stagingFirebaseRequestCount: stagingRequests.length,
    stagingFirebaseResponseCount: stagingResponses.length,
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
    nonFirebaseUnallowlistedRequestHosts: [
      ...new Set(
        unallowlistedNonFirebaseRequests.map((request) => request.hostname),
      ),
    ].sort(),
    productionVercelRequestHosts: [
      ...new Set(productionVercelRequests.map((request) => request.hostname)),
    ].sort(),
    unknownVercelRequestHosts: [
      ...new Set(unknownVercelRequests.map((request) => request.hostname)),
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
  if (audit.stage === "baseline") {
    auditedBaselineProtectedDataRequests +=
      appCheckProtectedDataRequests.length;
  } else {
    auditedCandidateProtectedDataRequests +=
      appCheckProtectedDataRequests.length;
    auditedCandidateNativeHeaderPresentRequests +=
      appCheckProtectedDataRequests.filter(
        (request) =>
          request.appCheckHeaderPresent &&
          (request.appCheckHeaderSource === "native-sdk" ||
            request.appCheckHeaderSource === "capture-owned-fetch"),
      ).length;
    auditedCandidateNativeHeaderMissingRequests +=
      appCheckProtectedDataRequests.filter(
        (request) => !request.appCheckHeaderPresent,
      ).length;
    assert.equal(
      appCheckProtectedDataRequests.some(
        (request) =>
          request.appCheckHeaderSource === "baseline-cdp-fetch-bridge",
      ),
      false,
    );
  }
  auditedBrowserAppCheckExchangeRequests += appCheckExchangeRequests.length;
  auditedBrowserAppCheckExchangeHttp200Responses +=
    successfulAppCheckExchangeResponses.length;
  auditedFirebaseDataRedirectResponses += responseEvents.filter(
    (response) =>
      response.staging &&
      fixtureDataServices.has(response.firebaseService) &&
      response.status >= 300 &&
      response.status < 400,
  ).length;
  auditedFirebaseDataErrorResponses += responseEvents.filter(
    (response) =>
      response.staging &&
      fixtureDataServices.has(response.firebaseService) &&
      response.status >= 400,
  ).length;
  auditedSuccessfulFirebaseDataResponses += responseEvents.filter(
    (response) =>
      response.staging &&
      fixtureDataServices.has(response.firebaseService) &&
      response.status >= 200 &&
      response.status < 300,
  ).length;
  auditedStagingFirebaseRequests += stagingRequests.length;
  auditedProductionAccess += productionRequests.length;
  auditedProductionWrites += productionRequests.filter(
    (request) => request.productionWrite,
  ).length;
  auditedNetworkRequests += requestEvents.length;
  auditedNetworkResponses += responseEvents.length;
  auditedNonFirebaseRequests += nonFirebaseRequests.length;
  auditedNonFirebaseAllowedRequests += nonFirebaseRequests.filter(
    (request) => request.nonFirebaseHostnameAllowed,
  ).length;
  auditedNonFirebaseUnallowlistedRequests +=
    unallowlistedNonFirebaseRequests.length;
  auditedNonFirebaseUnallowlistedResponses +=
    unallowlistedNonFirebaseResponses.length;
  auditedProductionVercelRequests += productionVercelRequests.length;
  auditedProductionVercelResponses += productionVercelResponses.length;
  auditedUnknownVercelRequests += unknownVercelRequests.length;
  auditedUnknownVercelResponses += unknownVercelResponses.length;
}
const browserTransport = manifest.browserTransport;
assertExactObjectKeys(browserTransport, [
  "schemaVersion",
  "contract",
  "contractHash",
  "browserOrigin",
  "browserOriginSha256",
  "immutableUpstreamBinding",
  "immutableUpstreamBindingHash",
  "requestCount",
  "responseCount",
  "httpSuccessResponseCount",
  "httpErrorResponseCount",
  "documentRequestCount",
  "scriptRequestCount",
  "bodyHashCount",
  "bodyHashMismatchCount",
  "redirectRequestCount",
  "redirectResponseCount",
  "responseErrorCount",
  "trackingResidualCount",
  "externalRewriteRequestCount",
  "firebaseGoogleRewriteRequestCount",
  "scopeMismatchRequestCount",
  "directImmutableOriginBrowserRequestCount",
  "immutableResourceAttestationRequestCount",
  "immutableResourceAttestationCacheHitCount",
  "immutableResourceAttestationHttp200Count",
  "immutableResourceAttestationRedirectResponseCount",
  "immutableResourceAttestationBypassHeaderRequestCount",
  "immutableResourceAttestationSkipToolbarHeaderRequestCount",
  "immutableResourceAttestationLinkHeaderObservationCount",
  "immutableResourceAttestationParserMarkupRejectCount",
  "immutableResourceAttestationVercelToolbarMarkupObservationCount",
  "stableOriginFaviconFallbackFulfillCount",
  "stableOriginFaviconFallbackNodeUpstreamFetchCount",
  "stableOriginFaviconFallbackBrowserNetworkRequestCount",
  "stableOriginFaviconFallbackObservationCount",
  "stableOriginFaviconFallbackObservationSetHash",
  "localFulfillCount",
  "browserNetworkRequestCount",
  "browserSkipToolbarHeaderObservationCount",
  "browserSkipToolbarHeaderPreTransmissionBlockCount",
  "responseLinkHeaderForwardCount",
  "playwrightRouteRegistrationCount",
  "groups",
]);
assert.equal(
  sha256(Buffer.from(canonicalJson(browserTransport))),
  manifest.browserTransportHash,
);
assert.equal(browserTransport.schemaVersion, 4);
assert.deepEqual(browserTransport.contract, contract.browserTransport);
assert.equal(
  browserTransport.contractHash,
  stableOriginRewriteTransportContractHash,
);
assert.equal(browserTransport.browserOrigin, stableBrowserOrigin);
assert.equal(browserTransport.browserOriginSha256, sha256(stableBrowserOrigin));
assert.deepEqual(
  browserTransport.immutableUpstreamBinding,
  immutableUpstreamBinding,
);
assert.equal(
  browserTransport.immutableUpstreamBindingHash,
  immutableUpstreamBindingHash,
);
assert.equal(browserTransport.requestCount, auditedStableOriginRewriteRequests);
assert.equal(
  browserTransport.responseCount,
  auditedStableOriginRewriteResponses,
);
assert.equal(
  browserTransport.httpSuccessResponseCount,
  auditedStableOriginRewriteHttpSuccessResponses,
);
assert.equal(
  browserTransport.httpErrorResponseCount,
  auditedStableOriginRewriteHttpErrorResponses,
);
assert.equal(
  browserTransport.documentRequestCount,
  auditedStableOriginRewriteDocumentRequests,
);
assert.equal(
  browserTransport.scriptRequestCount,
  auditedStableOriginRewriteScriptRequests,
);
assert.equal(
  browserTransport.bodyHashCount,
  auditedStableOriginRewriteBodyHashes,
);
assert.equal(
  browserTransport.bodyHashMismatchCount,
  auditedStableOriginRewriteBodyHashMismatches,
);
assert.equal(
  browserTransport.redirectRequestCount,
  auditedStableOriginRewriteRedirectRequests,
);
assert.equal(
  browserTransport.redirectResponseCount,
  auditedStableOriginRewriteRedirectResponses,
);
assert.equal(
  browserTransport.responseErrorCount,
  auditedStableOriginRewriteResponseErrors,
);
assert.equal(browserTransport.responseCount, browserTransport.requestCount);
assert.equal(
  browserTransport.httpSuccessResponseCount,
  browserTransport.requestCount,
);
assert.ok(
  browserTransport.documentRequestCount >= manifest.browserAudits.length,
);
assert.ok(browserTransport.scriptRequestCount >= manifest.browserAudits.length);
assert.ok(browserTransport.bodyHashCount >= manifest.browserAudits.length * 2);
for (const field of [
  "httpErrorResponseCount",
  "bodyHashMismatchCount",
  "redirectRequestCount",
  "redirectResponseCount",
  "responseErrorCount",
  "trackingResidualCount",
  "externalRewriteRequestCount",
  "firebaseGoogleRewriteRequestCount",
  "scopeMismatchRequestCount",
  "directImmutableOriginBrowserRequestCount",
  "playwrightRouteRegistrationCount",
]) {
  assert.equal(
    browserTransport[field],
    0,
    `browserTransport.${field} must be 0.`,
  );
}
assert.ok(browserTransport.immutableResourceAttestationRequestCount >= 4);
assert.equal(
  browserTransport.immutableResourceAttestationHttp200Count,
  browserTransport.immutableResourceAttestationRequestCount,
);
assert.equal(
  browserTransport.immutableResourceAttestationRedirectResponseCount,
  0,
);
assert.equal(
  browserTransport.immutableResourceAttestationBypassHeaderRequestCount,
  manifest.appCheckBinding.vercelBypassConfigured
    ? browserTransport.immutableResourceAttestationRequestCount
    : 0,
);
assert.equal(
  browserTransport.immutableResourceAttestationSkipToolbarHeaderRequestCount,
  browserTransport.immutableResourceAttestationRequestCount,
);
assert.ok(
  Number.isSafeInteger(
    browserTransport.immutableResourceAttestationSkipToolbarHeaderRequestCount,
  ) &&
    browserTransport.immutableResourceAttestationSkipToolbarHeaderRequestCount >=
      0,
);
assert.equal(
  browserTransport.immutableResourceAttestationVercelToolbarMarkupObservationCount,
  0,
);
assert.equal(
  browserTransport.stableOriginFaviconFallbackObservationCount,
  auditedStableOriginFaviconFallbackObservations.length,
);
assert.equal(
  browserTransport.stableOriginFaviconFallbackObservationSetHash,
  sha256(canonicalJson(auditedStableOriginFaviconFallbackObservations)),
);
assert.equal(
  browserTransport.stableOriginFaviconFallbackFulfillCount,
  browserTransport.stableOriginFaviconFallbackObservationCount,
);
assert.ok(browserTransport.stableOriginFaviconFallbackFulfillCount > 0);
assert.deepEqual(
  [
    ...new Set(
      auditedStableOriginFaviconFallbackObservations.map(({ stage }) => stage),
    ),
  ].sort(),
  contract.browserTransport.stableOriginFaviconFallback.stages,
);
assert.equal(
  browserTransport.stableOriginFaviconFallbackNodeUpstreamFetchCount,
  0,
);
assert.equal(
  browserTransport.stableOriginFaviconFallbackBrowserNetworkRequestCount,
  0,
);
assert.equal(browserTransport.localFulfillCount, browserTransport.requestCount);
assert.equal(browserTransport.browserNetworkRequestCount, 0);
assert.equal(browserTransport.browserSkipToolbarHeaderObservationCount, 0);
assert.equal(
  browserTransport.browserSkipToolbarHeaderPreTransmissionBlockCount,
  0,
);
assert.equal(browserTransport.responseLinkHeaderForwardCount, 0);
assert.equal(
  browserTransport.immutableResourceAttestationParserMarkupRejectCount,
  0,
);
assert.ok(
  Number.isInteger(
    browserTransport.immutableResourceAttestationLinkHeaderObservationCount,
  ) &&
    browserTransport.immutableResourceAttestationLinkHeaderObservationCount >=
      0,
);
assert.ok(
  Number.isInteger(
    browserTransport.immutableResourceAttestationCacheHitCount,
  ) && browserTransport.immutableResourceAttestationCacheHitCount >= 0,
);
const auditedOriginRewriteGroupRows = [
  ...auditedStableOriginRewriteGroups.entries(),
]
  .map(([id, summary]) => ({ id, ...summary }))
  .sort((left, right) => left.id.localeCompare(right.id));
assert.deepEqual(browserTransport.groups, auditedOriginRewriteGroupRows);
assert.equal(browserTransport.groups.length, manifest.browserAudits.length);
const baselineExternalStaticBytesByRequestUrl = new Map();
for (const observation of auditedExternalStaticResponseObservations) {
  if (observation.source !== "baseline-node-network") continue;
  assert.equal(
    baselineExternalStaticBytesByRequestUrl.has(observation.requestUrl),
    false,
    `External static bytes were fetched from the network more than once: ${observation.requestUrl}`,
  );
  baselineExternalStaticBytesByRequestUrl.set(observation.requestUrl, {
    ruleId: observation.ruleId,
    responseStatus: observation.responseStatus,
    responseBodySha256: observation.responseBodySha256,
    responseBodyBytes: observation.responseBodyBytes,
  });
}
for (const observation of auditedExternalStaticResponseObservations) {
  if (observation.source !== "baseline-byte-cache") continue;
  assert.deepEqual(
    {
      ruleId: observation.ruleId,
      responseStatus: observation.responseStatus,
      responseBodySha256: observation.responseBodySha256,
      responseBodyBytes: observation.responseBodyBytes,
    },
    baselineExternalStaticBytesByRequestUrl.get(observation.requestUrl),
    `A cached external static response does not match its baseline bytes: ${observation.requestUrl}`,
  );
}
const networkPolicy = manifest.networkPolicy;
assertExactObjectKeys(networkPolicy, [
  "schemaVersion",
  "externalStaticAllowlistHash",
  "optionalTelemetrySuppressionContractHash",
  "telemetryCapabilityGuardContractHash",
  "telemetryCapabilityGuardInitScriptRegistrationCount",
  "telemetryCapabilityGuardAuthenticationAttestationCount",
  "telemetryCapabilityGuardScreenAttestationCount",
  "telemetryCapabilityGuardRuntimeAttestationCount",
  "telemetryCapabilityGuardRuntimeAttestationSetHash",
  "sensitiveValueScopeContractHash",
  "deterministicResponseContractHash",
  "optionalTelemetrySuppressedRequestCount",
  "deterministicHolidayResponseFulfillCount",
  "deterministicRecaptchaResponseFulfillCount",
  "deterministicFirebaseModuleFulfillCount",
  "deterministicResponseScopeMismatchBlockCount",
  "externalStaticRequestNetworkFetchCount",
  "externalStaticRequestCacheFulfillCount",
  "externalStaticRequestScopeMismatchBlockCount",
  "externalStaticResponseNon200AbortCount",
  "nodeOwnedExternalRequestContract",
  "nodeOwnedExternalRequestContractHash",
  "nodeOwnedExternalResponseHeaderAllowlist",
  "nodeOwnedExternalResponseHeaderAllowlistHash",
  "nodeOwnedExternalRequestCount",
  "nodeOwnedExternalInformationalResponseCount",
  "nodeOwnedExternalInformationalEgressHeaderObservationCount",
  "nodeOwnedExternalInformationalBrowserExposureCount",
  "nodeOwnedExternalFinalResponseCount",
  "nodeOwnedExternalFinalBodyHashAttestationCount",
  "nodeOwnedExternalFinalHeaderSuppressionCount",
  "stagingApiKeyScopeViolationBlockCount",
  "testCredentialScopeViolationBlockCount",
  "refreshTokenScopeViolationBlockCount",
  "rawSensitivePreTransmissionInspectionCount",
  "rawSensitivePreTransmissionBlockCount",
  "rawProductionPreTransmissionBlockCount",
  "rawVercelBypassPreTransmissionBlockCount",
  "rawStagingApiKeyPreTransmissionBlockCount",
  "rawTestCredentialPreTransmissionBlockCount",
  "rawRefreshTokenPreTransmissionBlockCount",
  "rawDebugTokenPreTransmissionBlockCount",
  "rawDebugSentinelPreTransmissionBlockCount",
  "allowedEgressResponsePauseCount",
  "allowedEgressInformationalResponsePauseCount",
  "allowedEgressInformationalFinalResponseCount",
  "allowedEgressInformationalTrackingResidualCount",
  "allowedEgressInvalidResponseStatusAbortCount",
  "allowedEgressRedirectAbortCount",
  "allowedEgressHttpErrorAbortCount",
  "allowedEgressResponseErrorAbortCount",
  "allowedEgressInformationalEgressHeaderObservationCount",
  "allowedEgressFinalEgressHeaderObservationCount",
  "allowedEgressResponseHeaderSuppressionCount",
  "allowedEgressEgressHeaderForwardCount",
  "allowedEgressTrackingResidualCount",
  "externalStaticTrackingResidualCount",
  "directBrowserEarlyHintsObservationCount",
  "directBrowserEarlyHintsEgressHeaderObservationCount",
  "directBrowserEarlyHintsCaptureInvalidationCount",
  "directBrowserEarlyHintsObservationSetHash",
  "fullPostDataResolutionCount",
  "fullPostDataNetworkFallbackCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
  "deterministicResponseObservationCount",
  "deterministicResponseObservationSetHash",
  "externalStaticResponseObservationCount",
  "externalStaticResponseObservationSetHash",
  "optionalTelemetryObservationCount",
  "optionalTelemetryObservationSetHash",
  "pinnedStartupSourceAttestations",
  "pinnedStartupSourceAttestationCount",
  "pinnedStartupSourceAttestationSetHash",
]);
assert.equal(networkPolicy.schemaVersion, 5);
assert.equal(sha256(canonicalJson(networkPolicy)), manifest.networkPolicyHash);
assert.equal(
  networkPolicy.externalStaticAllowlistHash,
  sha256(
    canonicalJson(contract.networkBoundary.externalStaticRequestAllowlist),
  ),
);
assert.equal(
  networkPolicy.optionalTelemetrySuppressionContractHash,
  sha256(canonicalJson(contract.networkBoundary.optionalTelemetrySuppression)),
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardContractHash,
  sha256(
    canonicalJson(
      contract.networkBoundary.optionalTelemetrySuppression.documentStartGuard,
    ),
  ),
);
assert.equal(
  networkPolicy.sensitiveValueScopeContractHash,
  sha256(canonicalJson(contract.networkBoundary.sensitiveValueScope)),
);
assert.equal(
  networkPolicy.deterministicResponseContractHash,
  sha256(
    canonicalJson({
      holiday: contract.browserTransport.deterministicLocalResponse,
      recaptcha: contract.browserTransport.deterministicRecaptchaResponse,
    }),
  ),
);
assert.deepEqual(
  networkPolicy.nodeOwnedExternalRequestContract,
  NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT,
);
assert.equal(
  networkPolicy.nodeOwnedExternalRequestContractHash,
  sha256(canonicalJson(NODE_OWNED_EXTERNAL_STATIC_REQUEST_CONTRACT)),
);
assert.deepEqual(
  networkPolicy.nodeOwnedExternalResponseHeaderAllowlist,
  NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST,
);
assert.equal(
  networkPolicy.nodeOwnedExternalResponseHeaderAllowlistHash,
  sha256(canonicalJson(NODE_OWNED_EXTERNAL_STATIC_RESPONSE_HEADER_ALLOWLIST)),
);
assert.equal(
  assertPinnedStartupSourceAttestationsForContract(
    networkPolicy.pinnedStartupSourceAttestations,
  ),
  true,
);
assert.equal(
  networkPolicy.pinnedStartupSourceAttestationCount,
  expectedPinnedStartupSourceBindingsForContract().length,
);
assert.equal(
  networkPolicy.pinnedStartupSourceAttestationSetHash,
  sha256(canonicalJson(networkPolicy.pinnedStartupSourceAttestations)),
);
const pinnedStartupInformationalResponseCount =
  networkPolicy.pinnedStartupSourceAttestations.reduce(
    (total, attestation) => total + attestation.informationalResponseCount,
    0,
  );
const pinnedStartupInformationalEgressHeaderObservationCount =
  networkPolicy.pinnedStartupSourceAttestations.reduce(
    (total, attestation) =>
      total + attestation.informationalEgressHeaderObservationCount,
    0,
  );
const pinnedStartupFinalHeaderSuppressionCount =
  networkPolicy.pinnedStartupSourceAttestations.reduce(
    (total, attestation) => total + attestation.finalHeaderSuppressionCount,
    0,
  );
assert.equal(
  networkPolicy.nodeOwnedExternalRequestCount,
  networkPolicy.pinnedStartupSourceAttestationCount +
    auditedNodeOwnedExternalRequests,
);
assert.equal(
  networkPolicy.nodeOwnedExternalInformationalResponseCount,
  pinnedStartupInformationalResponseCount +
    auditedNodeOwnedExternalInformationalResponses,
);
assert.equal(
  networkPolicy.nodeOwnedExternalInformationalEgressHeaderObservationCount,
  pinnedStartupInformationalEgressHeaderObservationCount +
    auditedNodeOwnedExternalInformationalEgressHeaderObservations,
);
assert.equal(
  networkPolicy.nodeOwnedExternalInformationalBrowserExposureCount,
  auditedNodeOwnedExternalInformationalBrowserExposures,
);
assert.equal(
  networkPolicy.nodeOwnedExternalInformationalBrowserExposureCount,
  0,
);
assert.equal(
  networkPolicy.nodeOwnedExternalFinalResponseCount,
  networkPolicy.pinnedStartupSourceAttestationCount +
    auditedNodeOwnedExternalFinalResponses,
);
assert.equal(
  networkPolicy.nodeOwnedExternalFinalBodyHashAttestationCount,
  networkPolicy.pinnedStartupSourceAttestationCount +
    auditedNodeOwnedExternalFinalBodyHashAttestations,
);
assert.equal(
  networkPolicy.nodeOwnedExternalFinalHeaderSuppressionCount,
  pinnedStartupFinalHeaderSuppressionCount +
    auditedNodeOwnedExternalFinalHeaderSuppressions,
);
assert.equal(
  networkPolicy.nodeOwnedExternalFinalResponseCount,
  networkPolicy.nodeOwnedExternalRequestCount,
);
assert.equal(
  networkPolicy.nodeOwnedExternalFinalBodyHashAttestationCount,
  networkPolicy.nodeOwnedExternalRequestCount,
);
assert.equal(
  networkPolicy.directBrowserEarlyHintsObservationCount,
  auditedDirectBrowserEarlyHintsObservations,
);
assert.equal(
  networkPolicy.directBrowserEarlyHintsEgressHeaderObservationCount,
  auditedDirectBrowserEarlyHintsEgressHeaderObservations,
);
assert.equal(
  networkPolicy.directBrowserEarlyHintsCaptureInvalidationCount,
  auditedDirectBrowserEarlyHintsCaptureInvalidations,
);
assert.equal(networkPolicy.directBrowserEarlyHintsObservationCount, 0);
assert.equal(
  networkPolicy.directBrowserEarlyHintsEgressHeaderObservationCount,
  0,
);
assert.equal(networkPolicy.directBrowserEarlyHintsCaptureInvalidationCount, 0);
assert.equal(
  networkPolicy.directBrowserEarlyHintsObservationSetHash,
  sha256(canonicalJson([])),
);
assert.equal(
  networkPolicy.optionalTelemetrySuppressedRequestCount,
  auditedOptionalTelemetrySuppressedRequests,
);
assert.equal(
  networkPolicy.optionalTelemetrySuppressedRequestCount,
  contract.networkBoundary.optionalTelemetrySuppression
    .requiredLiveSuppressedRequestCount,
);
const expectedTelemetryCapabilityGuardAuthenticationAttestationCount =
  manifest.browserAudits.filter(({ role }) => role !== "support-public").length;
assert.equal(
  networkPolicy.telemetryCapabilityGuardInitScriptRegistrationCount,
  manifest.browserAudits.length,
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardAuthenticationAttestationCount,
  expectedTelemetryCapabilityGuardAuthenticationAttestationCount,
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardScreenAttestationCount,
  manifest.captures.length,
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardRuntimeAttestationCount,
  auditedTelemetryCapabilityGuardAttestations.length,
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardRuntimeAttestationCount,
  networkPolicy.telemetryCapabilityGuardAuthenticationAttestationCount +
    networkPolicy.telemetryCapabilityGuardScreenAttestationCount,
);
assert.equal(
  networkPolicy.telemetryCapabilityGuardRuntimeAttestationSetHash,
  sha256(canonicalJson(auditedTelemetryCapabilityGuardAttestations)),
);
assert.equal(
  networkPolicy.deterministicHolidayResponseFulfillCount,
  auditedDeterministicHolidayResponseFulfills,
);
assert.equal(
  networkPolicy.deterministicRecaptchaResponseFulfillCount,
  auditedDeterministicRecaptchaResponseFulfills,
);
assert.equal(
  networkPolicy.deterministicFirebaseModuleFulfillCount,
  auditedDeterministicFirebaseModuleFulfills,
);
assert.equal(
  networkPolicy.externalStaticRequestNetworkFetchCount,
  auditedExternalStaticRequestNetworkFetches,
);
assert.equal(
  networkPolicy.externalStaticRequestCacheFulfillCount,
  auditedExternalStaticRequestCacheFulfills,
);
assert.equal(
  networkPolicy.allowedEgressResponsePauseCount,
  auditedAllowedEgressResponsePauses,
);
assert.equal(
  networkPolicy.rawSensitivePreTransmissionInspectionCount,
  auditedRawSensitivePreTransmissionInspections,
);
assert.equal(
  networkPolicy.allowedEgressInformationalResponsePauseCount,
  auditedAllowedEgressInformationalResponsePauses,
);
assert.equal(
  networkPolicy.allowedEgressInformationalFinalResponseCount,
  auditedAllowedEgressInformationalFinalResponses,
);
assert.equal(
  networkPolicy.allowedEgressInformationalEgressHeaderObservationCount,
  auditedAllowedEgressInformationalEgressHeaderObservations,
);
assert.equal(
  networkPolicy.allowedEgressFinalEgressHeaderObservationCount,
  auditedAllowedEgressFinalEgressHeaderObservations,
);
assert.equal(
  networkPolicy.allowedEgressResponseHeaderSuppressionCount,
  auditedAllowedEgressResponseHeaderSuppressions,
);
assert.equal(
  networkPolicy.allowedEgressEgressHeaderForwardCount,
  auditedAllowedEgressEgressHeaderForwards,
);
assert.equal(
  networkPolicy.fullPostDataResolutionCount,
  auditedFullPostDataResolutions,
);
assert.equal(
  networkPolicy.fullPostDataNetworkFallbackCount,
  auditedFullPostDataNetworkFallbacks,
);
assert.equal(
  networkPolicy.fullPostDataResolutionFailureCount,
  auditedFullPostDataResolutionFailures,
);
assert.equal(
  networkPolicy.fullPostDataOversizeBlockCount,
  auditedFullPostDataOversizeBlocks,
);
assert.equal(
  networkPolicy.fullPostDataRepresentationMismatchBlockCount,
  auditedFullPostDataRepresentationMismatchBlocks,
);
assert.ok(
  networkPolicy.allowedEgressInformationalFinalResponseCount <=
    networkPolicy.allowedEgressInformationalResponsePauseCount,
);
assert.equal(
  networkPolicy.deterministicResponseObservationCount,
  auditedDeterministicResponseObservations.length,
);
assert.equal(
  networkPolicy.deterministicResponseObservationSetHash,
  sha256(canonicalJson(auditedDeterministicResponseObservations)),
);
assert.equal(
  networkPolicy.externalStaticResponseObservationCount,
  auditedExternalStaticResponseObservations.length,
);
assert.equal(
  networkPolicy.externalStaticResponseObservationSetHash,
  sha256(canonicalJson(auditedExternalStaticResponseObservations)),
);
assert.equal(
  networkPolicy.optionalTelemetryObservationCount,
  auditedOptionalTelemetryObservations.length,
);
assert.equal(
  networkPolicy.optionalTelemetryObservationCount,
  contract.networkBoundary.optionalTelemetrySuppression
    .requiredLiveObservationCount,
);
assert.equal(
  networkPolicy.optionalTelemetryObservationSetHash,
  sha256(canonicalJson(auditedOptionalTelemetryObservations)),
);
for (const [field, auditedValue] of Object.entries({
  deterministicResponseScopeMismatchBlockCount:
    auditedDeterministicResponseScopeMismatchBlocks,
  externalStaticRequestScopeMismatchBlockCount:
    auditedExternalStaticRequestScopeMismatchBlocks,
  externalStaticResponseNon200AbortCount:
    auditedExternalStaticResponseNon200Aborts,
  stagingApiKeyScopeViolationBlockCount:
    auditedStagingApiKeyScopeViolationBlocks,
  testCredentialScopeViolationBlockCount:
    auditedTestCredentialScopeViolationBlocks,
  refreshTokenScopeViolationBlockCount: auditedRefreshTokenScopeViolationBlocks,
  allowedEgressRedirectAbortCount: auditedAllowedEgressRedirectAborts,
  allowedEgressHttpErrorAbortCount: auditedAllowedEgressHttpErrorAborts,
  allowedEgressResponseErrorAbortCount: auditedAllowedEgressResponseErrorAborts,
  allowedEgressTrackingResidualCount: auditedAllowedEgressTrackingResiduals,
  externalStaticTrackingResidualCount: auditedExternalStaticTrackingResiduals,
  rawSensitivePreTransmissionBlockCount:
    auditedRawSensitivePreTransmissionBlocks,
  rawProductionPreTransmissionBlockCount:
    auditedRawProductionPreTransmissionBlocks,
  rawVercelBypassPreTransmissionBlockCount:
    auditedRawVercelBypassPreTransmissionBlocks,
  rawStagingApiKeyPreTransmissionBlockCount:
    auditedRawStagingApiKeyPreTransmissionBlocks,
  rawTestCredentialPreTransmissionBlockCount:
    auditedRawTestCredentialPreTransmissionBlocks,
  rawRefreshTokenPreTransmissionBlockCount:
    auditedRawRefreshTokenPreTransmissionBlocks,
  rawDebugTokenPreTransmissionBlockCount:
    auditedRawDebugTokenPreTransmissionBlocks,
  rawDebugSentinelPreTransmissionBlockCount:
    auditedRawDebugSentinelPreTransmissionBlocks,
  allowedEgressInformationalTrackingResidualCount:
    auditedAllowedEgressInformationalTrackingResiduals,
  allowedEgressInvalidResponseStatusAbortCount:
    auditedAllowedEgressInvalidResponseStatusAborts,
  allowedEgressEgressHeaderForwardCount:
    auditedAllowedEgressEgressHeaderForwards,
  fullPostDataResolutionFailureCount: auditedFullPostDataResolutionFailures,
  fullPostDataOversizeBlockCount: auditedFullPostDataOversizeBlocks,
  fullPostDataRepresentationMismatchBlockCount:
    auditedFullPostDataRepresentationMismatchBlocks,
})) {
  assert.equal(networkPolicy[field], auditedValue);
  assert.equal(networkPolicy[field], 0);
}
assert.ok(networkPolicy.deterministicHolidayResponseFulfillCount > 0);
assert.ok(networkPolicy.deterministicRecaptchaResponseFulfillCount > 0);
assert.ok(networkPolicy.deterministicFirebaseModuleFulfillCount > 0);
assert.ok(networkPolicy.externalStaticRequestNetworkFetchCount > 0);
assert.ok(networkPolicy.externalStaticRequestCacheFulfillCount > 0);
assert.equal(
  networkPolicy.fullPostDataResolutionCount,
  networkPolicy.rawSensitivePreTransmissionInspectionCount,
);
const appCheckBinding = manifest.appCheckBinding;
assert.ok(appCheckBinding && typeof appCheckBinding === "object");
assert.equal(
  sha256(Buffer.from(canonicalJson(appCheckBinding))),
  manifest.appCheckBindingHash,
  "The App Check capture binding hash is invalid.",
);
assert.match(manifest.appCheckBindingHash, /^[a-f0-9]{64}$/u);
assertExactObjectKeys(appCheckBinding, [
  "adminVerificationCount",
  "allExchangesAdminVerified",
  "allExchangesHttp200",
  "appCheckBound",
  "applicationSessionKeepaliveExpectedCount",
  "applicationSessionKeepaliveAttemptCount",
  "applicationSessionKeepaliveSuccessCount",
  "baselineApplicationSessionKeepaliveSuccessCount",
  "candidateApplicationSessionKeepaliveSuccessCount",
  "applicationSessionPreNavigationFenceExpectedGroupCount",
  "applicationSessionPreNavigationFenceAttemptCount",
  "applicationSessionPreNavigationFenceSuccessCount",
  "applicationSessionKeepaliveClientExpectedGroupCount",
  "applicationSessionKeepaliveClientInitAttemptCount",
  "applicationSessionKeepaliveClientInitSuccessCount",
  "applicationSessionKeepaliveClientReuseCount",
  "applicationSessionKeepaliveClientDisposeAttemptCount",
  "applicationSessionKeepaliveClientDisposeSuccessCount",
  "applicationSessionKeepaliveClientDeleteCount",
  "applicationSessionKeepaliveClientRegistryResidualCount",
  "applicationSessionKeepaliveClientHandleDisposeCount",
  "applicationSessionProofRetentionResidualCount",
  "appCheckCdpHandlerErrorCount",
  "appCheckCdpMonitorPausedRequestCount",
  "appCheckHeaderNetworkObservationCount",
  "argvSecretCount",
  "authorizedAppCheckHeaderRequestCount",
  "authorizedDebugExchangeBodyReplacementCount",
  "baselineBridgeCdpResponsePausedRequestCount",
  "baselineBridgeEligibleRequestCount",
  "baselineBridgeInjectedRequestCount",
  "baselineBridgeNativeHeaderRequestCount",
  "baselineBridgeScope",
  "baselineBridgeScopeHash",
  "baselineBridgeScopeMismatchRequestCount",
  "baselineBridgeStrippedHeaderRequestCount",
  "baselineBridgeRedirectRequestCount",
  "baselineBridgeRedirectHeaderAbsentRequestCount",
  "baselineBridgeRedirectAbortRequestCount",
  "baselineBridgeCdpPausedRequestCount",
  "baselineBridgeCdpReconciledRequestCount",
  "webChannelCdpHeaderAttestationRegisteredRequestCount",
  "webChannelCdpHeaderAttestationCompletedRequestCount",
  "webChannelCdpHeaderAttestationBoundRequestCount",
  "webChannelCdpHeaderAttestationBindingResidualCount",
  "webChannelCdpHeaderAttestationBindingFailureCount",
  "webChannelCdpHeaderAttestationPairingTimeoutCount",
  "webChannelCdpHeaderAttestationCompletionTimeoutCount",
  "allowedEgressContextCloseBackchannelRetirementCount",
  "allowedEgressContextCloseSessionForwardPostRetirementCount",
  "allowedEgressContextCloseTerminationRetirementCount",
  "webChannelTerminationClassifiedRequestCount",
  "playwrightAllHeadersHeaderAttestationRequestCount",
  "playwrightAllHeadersHeaderAttestationCompletedRequestCount",
  "baselineBridgeInjectedRedirectResponseAbortCount",
  "baselineBridgeDecisionUnmatchedProtectedRequestCount",
  "baselineBridgeScopeIneligibleProtectedRequestCount",
  "baselineEffectiveHeaderMissingRequestCount",
  "baselineProtectedDataRequestCount",
  "baselineScreenCaptureBridgeRequestCount",
  "baselineScreenCaptureProtectedRequestCount",
  "browserAppCheckExchangeHttp200Count",
  "browserAppCheckExchangeRequestCount",
  "browserCdpSecurityScope",
  "browserCdpSecurityScopeHash",
  "browserWideBoundaryAttestation",
  "browserConnectProxyHash",
  "browserConnectProxyAllowedConnectCount",
  "browserConnectProxyDeniedConnectCount",
  "browserConnectProxyCleanupResidualCount",
  "preTransmissionBoundaryAttestationHash",
  "nonFirebaseNetworkAllowedHostnameSetHash",
  "nonFirebaseNetworkAllowedHostnameCount",
  "preTransmissionBoundaryInspectionCount",
  "preTransmissionBoundaryBlockAttemptCount",
  "preTransmissionBoundaryProductionBlockCount",
  "preTransmissionBoundaryCrossOriginDocumentBlockCount",
  "preTransmissionBoundaryUnboundFirebaseBlockCount",
  "preTransmissionBoundaryNonFirebaseHostnameBlockCount",
  "preTransmissionBoundaryMalformedUrlBlockCount",
  "preTransmissionBoundaryFailRequestCount",
  "networkPolicyBindingHash",
  "optionalTelemetrySuppressedRequestCount",
  "deterministicHolidayResponseFulfillCount",
  "deterministicRecaptchaResponseFulfillCount",
  "deterministicFirebaseModuleFulfillCount",
  "deterministicResponseScopeMismatchBlockCount",
  "externalStaticRequestNetworkFetchCount",
  "externalStaticRequestCacheFulfillCount",
  "externalStaticRequestScopeMismatchBlockCount",
  "externalStaticResponseNon200AbortCount",
  "nodeOwnedExternalInformationalResponseCount",
  "nodeOwnedExternalInformationalBrowserExposureCount",
  "stagingApiKeyScopeViolationBlockCount",
  "testCredentialScopeViolationBlockCount",
  "refreshTokenScopeViolationBlockCount",
  "rawSensitivePreTransmissionInspectionCount",
  "rawSensitivePreTransmissionBlockCount",
  "rawProductionPreTransmissionBlockCount",
  "rawVercelBypassPreTransmissionBlockCount",
  "rawStagingApiKeyPreTransmissionBlockCount",
  "rawTestCredentialPreTransmissionBlockCount",
  "rawRefreshTokenPreTransmissionBlockCount",
  "rawDebugTokenPreTransmissionBlockCount",
  "rawDebugSentinelPreTransmissionBlockCount",
  "allowedEgressResponsePauseCount",
  "allowedEgressInformationalResponsePauseCount",
  "allowedEgressInformationalFinalResponseCount",
  "allowedEgressInformationalTrackingResidualCount",
  "allowedEgressInvalidResponseStatusAbortCount",
  "allowedEgressRedirectAbortCount",
  "allowedEgressHttpErrorAbortCount",
  "allowedEgressResponseErrorAbortCount",
  "allowedEgressInformationalEgressHeaderObservationCount",
  "allowedEgressFinalEgressHeaderObservationCount",
  "allowedEgressResponseHeaderSuppressionCount",
  "allowedEgressEgressHeaderForwardCount",
  "allowedEgressTrackingResidualCount",
  "externalStaticTrackingResidualCount",
  "directBrowserEarlyHintsObservationCount",
  "directBrowserEarlyHintsEgressHeaderObservationCount",
  "directBrowserEarlyHintsCaptureInvalidationCount",
  "fullPostDataResolutionCount",
  "fullPostDataNetworkFallbackCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
  "browserChildEnvironmentAllowlisted",
  "browserChildEnvironmentAllowlistHash",
  "browserChildEnvironmentUnexpectedKeyCount",
  "browserChildSecretEnvironmentVariableCount",
  "browserChildSecretValueObservationCount",
  "browserGlobalExtraHttpHeaderRegistrationCount",
  "browserGlobalDebugSentinelWriteCount",
  "browserGlobalRawDebugTokenWriteCount",
  "browserGlobalValueKind",
  "browserLaunchExplicitEnvironment",
  "browserNetworkHeaderAttestationErrorCount",
  "candidateBridgeInjectedRequestCount",
  "candidateNativeHeaderMissingRequestCount",
  "candidateNativeHeaderPresentRequestCount",
  "candidateProtectedDataRequestCount",
  "candidateScreenCaptureNativeRequestCount",
  "candidateScreenCaptureProtectedRequestCount",
  "consoleMessageCount",
  "consoleSecretObservationCount",
  "contextCloseCount",
  "contextAppCheckSecretInitCount",
  "corsConsoleErrorCount",
  "childProcessSecretEnvScrubbed",
  "debugSentinelHash",
  "debugSentinelNetworkObservationCount",
  "debugTokenSha256",
  "debugTokenNetworkObservationCount",
  "domSecretObservationCount",
  "exchangeHttp200Count",
  "exchangeEndpointHash",
  "exchangeOriginHash",
  "exchangeRequestCount",
  "exchangeTransportContractHash",
  "firebaseDataErrorResponseCount",
  "firebaseDataRedirectResponseCount",
  "fixturePostBackupAttestationHash",
  "fixturePreBackupAttestationHash",
  "harWriteCount",
  "headerCorrelationMechanism",
  "initScriptInjectionCount",
  "localStorageSecretWriteCount",
  "minimumRemainingLifetimeSeconds",
  "nodeDeploymentFetchRequestCount",
  "nodeDeploymentFetchHttp200Count",
  "nodeDeploymentRedirectResponseCount",
  "nodeVercelBypassHeaderRequestCount",
  "nodeDeploymentSkipToolbarHeaderRequestCount",
  "nodeDeploymentVercelToolbarMarkupObservationCount",
  "allowedEgressPostFinalResponseErrorPauseCount",
  "allowedEgressPostFinalContinueResponseSuccessCount",
  "allowedEgressPostFinalAlreadyRetiredInterceptionCount",
  "cdpContinueRequestInvalidInterceptionErrorCount",
  "cdpContinueResponseInvalidInterceptionErrorCount",
  "cdpPrimaryFinalContinueResponseInvalidInterceptionErrorCount",
  "cdpOtherContinueResponseInvalidInterceptionErrorCount",
  "cdpOtherProtocolErrorCount",
  "pageRawDebugTokenInjectionCount",
  "pageAppCheckSecretInitRegistrationCount",
  "pendingBridgeDecisionResidualCount",
  "pendingBridgeObservationResidualCount",
  "playwrightRouteRegistrationCount",
  "protocolDebugLoggingDisabled",
  "protectedHeaderJwtShapeInvalidRequestCount",
  "rawDebugTokenOutputCount",
  "rawExchangedTokenOutputCount",
  "rawHeaderValueOutputCount",
  "rawResponseBodyOutputCount",
  "rawTokenOutputCount",
  "rawVercelBypassOutputCount",
  "refreshCount",
  "requestFailureCount",
  "scrubbedSecretEnvironmentVariableCount",
  "secretInitScope",
  "sensitiveAppCheckCdpResponsePausedRequestCount",
  "sensitiveAppCheckRedirectAbortRequestCount",
  "sensitiveAppCheckRedirectRequestCount",
  "sensitiveAppCheckRedirectResponseAbortRequestCount",
  "sensitiveAppCheckRequestTrackingResidualCount",
  "sensitiveAppCheckResponseErrorAbortRequestCount",
  "serviceWorkerPolicy",
  "status",
  "storageStateWriteCount",
  "tokenLifetimeMatchedTtl",
  "tokenJwtShapeValid",
  "tokenValidAtExchange",
  "traceWriteCount",
  "unauthorizedAppCheckHeaderEgressCount",
  "unauthorizedDebugSentinelEgressCount",
  "unauthorizedDebugTokenEgressCount",
  "unauthorizedVercelBypassEgressCount",
  "unexpectedDedicatedWorkerCount",
  "unexpectedExtraPageCount",
  "unexpectedServiceWorkerCount",
  "unexpectedCrossOriginFrameCount",
  "unexpectedOopifTargetCount",
  "unexpectedDedicatedWorkerTargetCount",
  "unexpectedSharedWorkerTargetCount",
  "unexpectedServiceWorkerTargetCount",
  "retainedOopifTargetCount",
  "retainedDedicatedWorkerTargetCount",
  "retainedSharedWorkerTargetCount",
  "retainedServiceWorkerTargetCount",
  "targetDiscoveryActivationCount",
  "targetSnapshotCount",
  "urlMethodFifoCorrelationUsed",
  "verifiedAppIdHash",
  "verifiedAudienceSetHash",
  "verifiedIssuerHash",
  "verifiedProjectIdHash",
  "verifiedProjectNumberHash",
  "vercelBypassConfigured",
  "vercelBypassAllowedOriginSetHash",
  "vercelBypassTransportContractHash",
  "vercelBypassCdpInjectedRequestCount",
  "vercelBypassPreexistingHeaderObservationCount",
  "vercelBypassCdpResponsePausedRequestCount",
  "vercelBypassHttpSuccessResponseCount",
  "vercelBypassHttpErrorResponseCount",
  "vercelBypassRedirectRequestCount",
  "vercelBypassRedirectAbortRequestCount",
  "vercelBypassRedirectResponseAbortRequestCount",
  "vercelBypassResponseErrorAbortRequestCount",
  "vercelBypassObservedEligibleRequestCount",
  "vercelBypassHeaderObservedRequestCount",
  "vercelBypassHeaderMissingRequestCount",
  "vercelBypassHeaderMismatchRequestCount",
  "successfulFirebaseDataResponseCount",
]);
assert.equal(
  appCheckBinding.networkPolicyBindingHash,
  manifest.networkPolicyHash,
);
for (const field of [
  "optionalTelemetrySuppressedRequestCount",
  "deterministicHolidayResponseFulfillCount",
  "deterministicRecaptchaResponseFulfillCount",
  "deterministicFirebaseModuleFulfillCount",
  "deterministicResponseScopeMismatchBlockCount",
  "externalStaticRequestNetworkFetchCount",
  "externalStaticRequestCacheFulfillCount",
  "externalStaticRequestScopeMismatchBlockCount",
  "externalStaticResponseNon200AbortCount",
  "nodeOwnedExternalInformationalResponseCount",
  "nodeOwnedExternalInformationalBrowserExposureCount",
  "stagingApiKeyScopeViolationBlockCount",
  "testCredentialScopeViolationBlockCount",
  "refreshTokenScopeViolationBlockCount",
  "rawSensitivePreTransmissionInspectionCount",
  "rawSensitivePreTransmissionBlockCount",
  "rawProductionPreTransmissionBlockCount",
  "rawVercelBypassPreTransmissionBlockCount",
  "rawStagingApiKeyPreTransmissionBlockCount",
  "rawTestCredentialPreTransmissionBlockCount",
  "rawRefreshTokenPreTransmissionBlockCount",
  "rawDebugTokenPreTransmissionBlockCount",
  "rawDebugSentinelPreTransmissionBlockCount",
  "allowedEgressResponsePauseCount",
  "allowedEgressInformationalResponsePauseCount",
  "allowedEgressInformationalFinalResponseCount",
  "allowedEgressInformationalTrackingResidualCount",
  "allowedEgressInvalidResponseStatusAbortCount",
  "allowedEgressRedirectAbortCount",
  "allowedEgressHttpErrorAbortCount",
  "allowedEgressResponseErrorAbortCount",
  "allowedEgressInformationalEgressHeaderObservationCount",
  "allowedEgressFinalEgressHeaderObservationCount",
  "allowedEgressResponseHeaderSuppressionCount",
  "allowedEgressEgressHeaderForwardCount",
  "allowedEgressTrackingResidualCount",
  "externalStaticTrackingResidualCount",
  "directBrowserEarlyHintsObservationCount",
  "directBrowserEarlyHintsEgressHeaderObservationCount",
  "directBrowserEarlyHintsCaptureInvalidationCount",
  "fullPostDataResolutionCount",
  "fullPostDataNetworkFallbackCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
]) {
  assert.equal(appCheckBinding[field], networkPolicy[field]);
}
assert.equal(
  appCheckBinding.rawSensitivePreTransmissionBlockCount,
  appCheckBinding.rawProductionPreTransmissionBlockCount +
    appCheckBinding.rawVercelBypassPreTransmissionBlockCount +
    appCheckBinding.rawStagingApiKeyPreTransmissionBlockCount +
    appCheckBinding.rawTestCredentialPreTransmissionBlockCount +
    appCheckBinding.rawRefreshTokenPreTransmissionBlockCount +
    appCheckBinding.rawDebugTokenPreTransmissionBlockCount +
    appCheckBinding.rawDebugSentinelPreTransmissionBlockCount,
);
assert.ok(
  appCheckBinding.allowedEgressInformationalFinalResponseCount <=
    appCheckBinding.allowedEgressInformationalResponsePauseCount,
);
assert.equal(
  appCheckBinding.fullPostDataResolutionCount,
  appCheckBinding.appCheckCdpMonitorPausedRequestCount,
);
assert.equal(appCheckBinding.status, "VERIFIED_EXCHANGED");
assert.equal(appCheckBinding.appCheckBound, true);
const expectedApplicationSessionKeepaliveCounts = {
  baseline: manifest.captures.filter(
    (capture) =>
      capture.stage === "baseline" &&
      Boolean(authenticationRoleForCapture(capture)),
  ).length,
  candidate: manifest.captures.filter(
    (capture) =>
      capture.stage === "candidate" &&
      Boolean(authenticationRoleForCapture(capture)),
  ).length,
};
const expectedApplicationSessionKeepaliveCount =
  expectedApplicationSessionKeepaliveCounts.baseline +
  expectedApplicationSessionKeepaliveCounts.candidate;
const expectedApplicationSessionPreNavigationFenceCounts = {
  baseline: [...expectedProtectedReadRetryAuditIds].filter((auditId) =>
    auditId.startsWith("baseline:"),
  ).length,
  candidate: [...expectedProtectedReadRetryAuditIds].filter((auditId) =>
    auditId.startsWith("candidate:"),
  ).length,
};
const expectedApplicationSessionPreNavigationFenceCount =
  expectedApplicationSessionPreNavigationFenceCounts.baseline +
  expectedApplicationSessionPreNavigationFenceCounts.candidate;
for (const field of [
  "applicationSessionKeepaliveExpectedCount",
  "applicationSessionKeepaliveAttemptCount",
  "applicationSessionKeepaliveSuccessCount",
  "baselineApplicationSessionKeepaliveSuccessCount",
  "candidateApplicationSessionKeepaliveSuccessCount",
  "applicationSessionPreNavigationFenceExpectedGroupCount",
  "applicationSessionPreNavigationFenceAttemptCount",
  "applicationSessionPreNavigationFenceSuccessCount",
  "applicationSessionKeepaliveClientExpectedGroupCount",
  "applicationSessionKeepaliveClientInitAttemptCount",
  "applicationSessionKeepaliveClientInitSuccessCount",
  "applicationSessionKeepaliveClientReuseCount",
  "applicationSessionKeepaliveClientDisposeAttemptCount",
  "applicationSessionKeepaliveClientDisposeSuccessCount",
  "applicationSessionKeepaliveClientDeleteCount",
  "applicationSessionKeepaliveClientRegistryResidualCount",
  "applicationSessionKeepaliveClientHandleDisposeCount",
  "applicationSessionProofRetentionResidualCount",
]) {
  assert.ok(Number.isInteger(appCheckBinding[field]));
  assert.ok(appCheckBinding[field] >= 0);
}
assert.ok(expectedApplicationSessionKeepaliveCount > 0);
assert.equal(
  appCheckBinding.applicationSessionKeepaliveExpectedCount,
  expectedApplicationSessionKeepaliveCount,
);
assert.equal(
  appCheckBinding.applicationSessionKeepaliveAttemptCount,
  expectedApplicationSessionKeepaliveCount,
);
assert.equal(
  appCheckBinding.applicationSessionKeepaliveSuccessCount,
  expectedApplicationSessionKeepaliveCount,
);
assert.equal(
  appCheckBinding.baselineApplicationSessionKeepaliveSuccessCount,
  expectedApplicationSessionKeepaliveCounts.baseline,
);
assert.equal(
  appCheckBinding.candidateApplicationSessionKeepaliveSuccessCount,
  expectedApplicationSessionKeepaliveCounts.candidate,
);
for (const field of [
  "applicationSessionPreNavigationFenceExpectedGroupCount",
  "applicationSessionPreNavigationFenceAttemptCount",
  "applicationSessionPreNavigationFenceSuccessCount",
]) {
  assert.equal(
    appCheckBinding[field],
    expectedApplicationSessionPreNavigationFenceCount,
  );
}
assert.equal(
  appCheckBinding.applicationSessionKeepaliveClientExpectedGroupCount,
  expectedProtectedReadRetryAuditIds.size,
);
for (const field of [
  "applicationSessionKeepaliveClientInitAttemptCount",
  "applicationSessionKeepaliveClientInitSuccessCount",
  "applicationSessionKeepaliveClientDisposeAttemptCount",
  "applicationSessionKeepaliveClientDisposeSuccessCount",
  "applicationSessionKeepaliveClientDeleteCount",
  "applicationSessionKeepaliveClientHandleDisposeCount",
]) {
  assert.equal(appCheckBinding[field], expectedProtectedReadRetryAuditIds.size);
}
assert.equal(
  appCheckBinding.applicationSessionKeepaliveClientReuseCount,
  expectedApplicationSessionKeepaliveCount,
);
assert.equal(
  appCheckBinding.applicationSessionKeepaliveClientRegistryResidualCount,
  0,
);
assert.deepEqual(auditedApplicationSessionKeepaliveRequestCounts, {
  baseline:
    expectedApplicationSessionKeepaliveCounts.baseline +
    expectedApplicationSessionPreNavigationFenceCounts.baseline,
  candidate:
    expectedApplicationSessionKeepaliveCounts.candidate +
    expectedApplicationSessionPreNavigationFenceCounts.candidate,
});
assert.deepEqual(auditedApplicationSessionKeepaliveResponseCounts, {
  baseline:
    expectedApplicationSessionKeepaliveCounts.baseline +
    expectedApplicationSessionPreNavigationFenceCounts.baseline,
  candidate:
    expectedApplicationSessionKeepaliveCounts.candidate +
    expectedApplicationSessionPreNavigationFenceCounts.candidate,
});
assert.equal(appCheckBinding.applicationSessionProofRetentionResidualCount, 0);
assert.equal(
  appCheckBinding.debugTokenSha256,
  fixtureAudit.isolation.preBackupAccessProbe.appCheckDebugTokenHash,
);
assert.equal(appCheckBinding.verifiedAppIdHash, sha256(STAGING_APP_ID));
assert.equal(
  appCheckBinding.verifiedProjectIdHash,
  sha256(contract.firebaseProjectId),
);
assert.equal(
  appCheckBinding.verifiedProjectNumberHash,
  sha256(STAGING_PROJECT_NUMBER),
);
assert.equal(
  appCheckBinding.verifiedAudienceSetHash,
  sha256(
    canonicalJson(
      [
        `projects/${contract.firebaseProjectId}`,
        `projects/${STAGING_PROJECT_NUMBER}`,
      ].sort(),
    ),
  ),
);
assert.equal(
  appCheckBinding.verifiedIssuerHash,
  sha256(`https://firebaseappcheck.googleapis.com/${STAGING_PROJECT_NUMBER}`),
);
assert.equal(
  appCheckBinding.exchangeOriginHash,
  sha256(new URL(contract.stableAlias).origin),
);
assert.equal(
  appCheckBinding.exchangeEndpointHash,
  sha256(
    `https://content-firebaseappcheck.googleapis.com/v1/projects/${contract.firebaseProjectId}/apps/${STAGING_APP_ID}:exchangeDebugToken`,
  ),
);
assert.equal(
  appCheckBinding.exchangeTransportContractHash,
  sha256(canonicalJson(FIXTURE_APP_CHECK_EXCHANGE_TRANSPORT_CONTRACT)),
);
assert.ok(appCheckBinding.exchangeRequestCount >= 1);
assert.equal(
  appCheckBinding.exchangeHttp200Count,
  appCheckBinding.exchangeRequestCount,
);
assert.equal(
  appCheckBinding.adminVerificationCount,
  appCheckBinding.exchangeRequestCount,
);
assert.equal(
  appCheckBinding.refreshCount,
  appCheckBinding.exchangeRequestCount - 1,
);
assert.equal(appCheckBinding.minimumRemainingLifetimeSeconds, 300);
assert.equal(appCheckBinding.allExchangesHttp200, true);
assert.equal(appCheckBinding.allExchangesAdminVerified, true);
assert.equal(appCheckBinding.tokenValidAtExchange, true);
assert.equal(appCheckBinding.tokenJwtShapeValid, true);
assert.equal(appCheckBinding.tokenLifetimeMatchedTtl, true);
assert.equal(
  appCheckBinding.fixturePreBackupAttestationHash,
  preBackupNamespaceAccessAttestationHash,
);
assert.equal(
  appCheckBinding.fixturePostBackupAttestationHash,
  backupNamespaceAccessAttestationHash,
);
assert.deepEqual(
  appCheckBinding.baselineBridgeScope,
  BASELINE_APP_CHECK_BRIDGE_SCOPE,
);
assert.equal(
  appCheckBinding.baselineBridgeScopeHash,
  baselineAppCheckBridgeScopeHash,
);
assert.deepEqual(
  appCheckBinding.browserCdpSecurityScope,
  BROWSER_APP_CHECK_CDP_SECURITY_SCOPE,
);
assert.equal(
  appCheckBinding.browserCdpSecurityScopeHash,
  browserAppCheckCdpSecurityScopeHash,
);
const browserWideBoundaryAttestation =
  appCheckBinding.browserWideBoundaryAttestation;
assertExactObjectKeys(browserWideBoundaryAttestation, [
  "schemaVersion",
  "executionTargetBoundaryHash",
  "activationCount",
  "waitingTargetCount",
  "primaryTargetConfiguredCount",
  "primaryRequestBoundaryHandoffCount",
  "heldRuntimeResumeCount",
  "secondaryTargetClosedBeforeResumeCount",
  "requestInspectionCount",
  "requestBlockCount",
  "requestContinueCount",
  "rawSensitiveInspectionCount",
  "rawSensitiveBlockCount",
  "rawProductionBlockCount",
  "rawVercelBypassBlockCount",
  "rawStagingApiKeyBlockCount",
  "rawTestCredentialBlockCount",
  "rawRefreshTokenBlockCount",
  "rawDebugTokenBlockCount",
  "rawDebugSentinelBlockCount",
  "optionalTelemetrySuppressionCount",
  "deterministicResponseFulfillCount",
  "deterministicResponseScopeMismatchBlockCount",
  "externalStaticPrivateOwnerBlockCount",
  "fullPostDataResolutionCount",
  "fullPostDataNetworkFallbackCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
  "handlerErrorCount",
  "pendingSetupCount",
  "pendingHandlerCount",
  "heldRuntimeResumeResidualCount",
  "fatalErrorCount",
  "groupAttestationCount",
  "groupAttestationSetHash",
  "secondaryExecutionGuardInitScriptRegistrationCount",
  "playwrightWebSocketRouteRegistrationCount",
  "playwrightWebSocketRouteInterceptCount",
  "webSocketConnectToServerCount",
  "webSocketHandshakeRequestCount",
  "webTransportCreatedCount",
  "launchArguments",
  "launchArgumentsHash",
  "ignoredDefaultArguments",
  "ignoredDefaultArgumentsHash",
  "effectiveDisabledFeatures",
  "effectiveDisabledFeaturesHash",
  "browserCommandLineAttestation",
  "browserCommandLineAttestationHash",
  "browserConnectProxyContractHash",
  "browserConnectProxy",
  "browserConnectProxyHash",
  "browserObservedDirectFirebaseHostnames",
  "browserObservedDirectFirebaseHostnameSetHash",
  "browserConnectProxyAllowedConnectHostnames",
  "browserConnectProxyAllowedConnectHostnameSetHash",
  "stableImmutableDeterministicExternalProxyConnectCount",
  "browserConnectProxyCleanupResidualCount",
]);
assert.equal(browserWideBoundaryAttestation.schemaVersion, 5);
assert.equal(
  browserWideBoundaryAttestation.executionTargetBoundaryHash,
  sha256(canonicalJson(contract.networkBoundary.executionTargetBoundary)),
);
assert.equal(
  browserWideBoundaryAttestation.groupAttestationCount,
  manifest.browserAudits.length,
);
assert.equal(
  browserWideBoundaryAttestation.groupAttestationSetHash,
  sha256(
    canonicalJson(
      [...auditedBrowserWideBoundaryGroupAttestations].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    ),
  ),
);
for (const field of [
  "activationCount",
  "waitingTargetCount",
  "primaryTargetConfiguredCount",
  "primaryRequestBoundaryHandoffCount",
  "secondaryExecutionGuardInitScriptRegistrationCount",
  "playwrightWebSocketRouteRegistrationCount",
]) {
  assert.equal(
    browserWideBoundaryAttestation[field],
    manifest.browserAudits.length,
  );
}
assert.ok(
  browserWideBoundaryAttestation.heldRuntimeResumeCount >=
    manifest.browserAudits.length,
);
for (const field of [
  "secondaryTargetClosedBeforeResumeCount",
  "requestInspectionCount",
  "requestBlockCount",
  "requestContinueCount",
  "rawSensitiveInspectionCount",
  "rawSensitiveBlockCount",
  "rawProductionBlockCount",
  "rawVercelBypassBlockCount",
  "rawStagingApiKeyBlockCount",
  "rawTestCredentialBlockCount",
  "rawRefreshTokenBlockCount",
  "rawDebugTokenBlockCount",
  "rawDebugSentinelBlockCount",
  "optionalTelemetrySuppressionCount",
  "deterministicResponseFulfillCount",
  "deterministicResponseScopeMismatchBlockCount",
  "externalStaticPrivateOwnerBlockCount",
  "fullPostDataResolutionCount",
  "fullPostDataNetworkFallbackCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
  "handlerErrorCount",
  "pendingSetupCount",
  "pendingHandlerCount",
  "heldRuntimeResumeResidualCount",
  "fatalErrorCount",
  "playwrightWebSocketRouteInterceptCount",
  "webSocketConnectToServerCount",
  "webSocketHandshakeRequestCount",
  "webTransportCreatedCount",
]) {
  assert.equal(browserWideBoundaryAttestation[field], 0);
}
assert.equal(
  browserWideBoundaryAttestation.fullPostDataResolutionCount,
  browserWideBoundaryAttestation.requestInspectionCount,
);
const browserProxyServerArguments =
  browserWideBoundaryAttestation.launchArguments.filter((argument) =>
    argument.startsWith("--proxy-server="),
  );
assert.equal(browserProxyServerArguments.length, 1);
const browserProxyServerArgument = browserProxyServerArguments[0];
assert.match(
  browserProxyServerArgument,
  /^--proxy-server=http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u,
);
const expectedBrowserLaunchArguments = [
  ...BROWSER_PRETRANSMISSION_LAUNCH_ARGS,
  BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
  browserProxyServerArgument,
];
assert.deepEqual(
  browserWideBoundaryAttestation.launchArguments,
  expectedBrowserLaunchArguments,
);
assert.equal(
  browserWideBoundaryAttestation.launchArgumentsHash,
  sha256(canonicalJson(expectedBrowserLaunchArguments)),
);
assert.deepEqual(
  browserWideBoundaryAttestation.ignoredDefaultArguments,
  BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS,
);
assert.equal(
  browserWideBoundaryAttestation.ignoredDefaultArgumentsHash,
  sha256(canonicalJson(BROWSER_PRETRANSMISSION_IGNORE_DEFAULT_ARGS)),
);
assert.deepEqual(
  browserWideBoundaryAttestation.effectiveDisabledFeatures,
  BROWSER_EFFECTIVE_DISABLED_FEATURES,
);
assert.equal(
  browserWideBoundaryAttestation.effectiveDisabledFeaturesHash,
  sha256(canonicalJson(BROWSER_EFFECTIVE_DISABLED_FEATURES)),
);
const browserCommandLineAttestation =
  browserWideBoundaryAttestation.browserCommandLineAttestation;
assertExactObjectKeys(browserCommandLineAttestation, [
  "schemaVersion",
  "browserCommandLineQueryCount",
  "browserCommandLineArgumentCount",
  "disableFeaturesSwitchCount",
  "effectiveDisabledFeatures",
  "effectiveDisabledFeaturesHash",
  "requiredEffectiveArguments",
  "requiredEffectiveArgumentsHash",
  "requiredEffectiveArgumentDuplicateCount",
  "proxyServerSwitchCount",
  "proxyBypassListSwitchCount",
  "proxyServerArgumentSha256",
  "proxyBypassListArgument",
]);
assert.equal(browserCommandLineAttestation.schemaVersion, 2);
assert.equal(browserCommandLineAttestation.browserCommandLineQueryCount, 1);
assert.ok(browserCommandLineAttestation.browserCommandLineArgumentCount > 0);
assert.equal(browserCommandLineAttestation.disableFeaturesSwitchCount, 1);
assert.deepEqual(
  browserCommandLineAttestation.effectiveDisabledFeatures,
  BROWSER_EFFECTIVE_DISABLED_FEATURES,
);
assert.equal(
  browserCommandLineAttestation.effectiveDisabledFeaturesHash,
  sha256(canonicalJson(BROWSER_EFFECTIVE_DISABLED_FEATURES)),
);
assert.deepEqual(
  browserCommandLineAttestation.requiredEffectiveArguments,
  [
    ...BROWSER_PRETRANSMISSION_REQUIRED_EFFECTIVE_ARGUMENTS,
    BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
    browserProxyServerArgument,
  ].sort(),
);
assert.equal(
  browserCommandLineAttestation.requiredEffectiveArgumentsHash,
  sha256(
    canonicalJson(
      [
        ...BROWSER_PRETRANSMISSION_REQUIRED_EFFECTIVE_ARGUMENTS,
        BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
        browserProxyServerArgument,
      ].sort(),
    ),
  ),
);
assert.equal(
  browserCommandLineAttestation.requiredEffectiveArgumentDuplicateCount,
  0,
);
assert.equal(browserCommandLineAttestation.proxyServerSwitchCount, 1);
assert.equal(browserCommandLineAttestation.proxyBypassListSwitchCount, 1);
assert.equal(
  browserCommandLineAttestation.proxyServerArgumentSha256,
  secretSha256(browserProxyServerArgument),
);
assert.equal(
  browserCommandLineAttestation.proxyBypassListArgument,
  BROWSER_PROXY_BYPASS_LIST_ARGUMENT,
);
assert.equal(
  browserWideBoundaryAttestation.browserCommandLineAttestationHash,
  sha256(canonicalJson(browserCommandLineAttestation)),
);
assert.equal(
  browserWideBoundaryAttestation.browserConnectProxyContractHash,
  sha256(canonicalJson(contract.networkBoundary.browserConnectProxy)),
);
const browserConnectProxyAttestation =
  browserWideBoundaryAttestation.browserConnectProxy;
assertExactObjectKeys(browserConnectProxyAttestation, [
  "schemaVersion",
  "allowedHostnames",
  "allowedHostnameSetHash",
  "allowedRequestOrigins",
  "allowedRequestOriginSetHash",
  "authorizedRequestMethods",
  "browserProductBackgroundDenyHostnames",
  "browserProductBackgroundDenyHostnameSetHash",
  "listenerStartCount",
  "listenerCloseCount",
  "connectRequestCount",
  "allowedConnectCount",
  "deniedConnectCount",
  "browserProductBackgroundDenyCount",
  "browserProductBackgroundCredentialOrBodyObservationCount",
  "fatalPolicyDenyCount",
  "requestStageAuthorizationCount",
  "requestStageAuthorizationCompleteCount",
  "requestStageAuthorizationRevocationCount",
  "activeTunnelPresentAtAuthorizationCount",
  "authorityLeaseIssueCount",
  "authorityLeaseConsumeCount",
  "authorityLeaseUnusedCompletionCount",
  "authorityLeaseRevocationCount",
  "authorityLeaseExpiredBeforeConnectCount",
  "targetedTunnelRetirementAttemptCount",
  "targetedTunnelRetirementSuccessCount",
  "targetedTunnelRetiredClientSocketCount",
  "targetedTunnelRetiredUpstreamSocketCount",
  "targetedTunnelAuthorityDrainSuccessCount",
  "releasedResponseStreamRegisterCount",
  "releasedResponseStreamLoadingFinishedSettlementCount",
  "releasedResponseStreamLoadingFailedSettlementCount",
  "releasedResponseStreamAuthorityTransportDrainSettlementCount",
  "releasedResponseStreamResidualAtCloseCount",
  "uncorrelatedAllowedConnectDenyCount",
  "upstreamSocketCreateCount",
  "httpAbsoluteFormDenyCount",
  "upgradeDenyCount",
  "invalidAuthorityDenyCount",
  "ipLiteralDenyCount",
  "alternatePortDenyCount",
  "unallowlistedHostnameDenyCount",
  "connectHeaderDenyCount",
  "clientSocketErrorCount",
  "tunnelErrorCount",
  "allowedConnectHosts",
  "allowedConnectHostSetHash",
  "deniedConnectAuthorities",
  "deniedConnectAuthoritySetHash",
  "browserProductBackgroundDenyObservations",
  "browserProductBackgroundDenyObservationSetHash",
  "authorityLeaseTtlMilliseconds",
  "requestStageAuthorizationObservations",
  "requestStageAuthorizationObservationSetHash",
  "authorityLeaseConsumeObservations",
  "authorityLeaseConsumeObservationSetHash",
  "targetedTunnelRetirementObservations",
  "targetedTunnelRetirementObservationSetHash",
  "requestStageAuthorizationResidualCount",
  "authorityLeaseResidualCount",
  "authorityLeaseQueueResidualCount",
  "activeAllowedTunnelResidualCount",
  "activeAllowedTunnelRequestBindingResidualCount",
  "preparedExactTunnelResetResidualCount",
  "releasedResponseStreamResidualCount",
  "activeClientSocketCount",
  "activeUpstreamSocketCount",
  "fatalErrorCount",
]);
assert.equal(browserConnectProxyAttestation.schemaVersion, 5);
assert.deepEqual(
  browserConnectProxyAttestation.allowedHostnames,
  BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES,
);
assert.equal(
  browserConnectProxyAttestation.allowedHostnameSetHash,
  secretSha256(
    JSON.stringify(BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES),
  ),
);
assert.equal(browserConnectProxyAttestation.listenerStartCount, 1);
assert.equal(browserConnectProxyAttestation.listenerCloseCount, 1);
assert.ok(browserConnectProxyAttestation.allowedConnectCount > 0);
assert.equal(
  browserConnectProxyAttestation.connectRequestCount,
  browserConnectProxyAttestation.allowedConnectCount +
    browserConnectProxyAttestation.deniedConnectCount,
);
assert.equal(
  browserConnectProxyAttestation.upstreamSocketCreateCount,
  browserConnectProxyAttestation.allowedConnectCount,
);
assert.deepEqual(browserConnectProxyAttestation.allowedRequestOrigins, [
  stableBrowserOrigin,
]);
assert.equal(
  browserConnectProxyAttestation.allowedRequestOriginSetHash,
  secretSha256(JSON.stringify([stableBrowserOrigin])),
);
assert.deepEqual(
  browserConnectProxyAttestation.authorizedRequestMethods,
  BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS,
);
assert.deepEqual(
  browserConnectProxyAttestation.browserProductBackgroundDenyHostnames,
  BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES,
);
assert.equal(
  browserConnectProxyAttestation.browserProductBackgroundDenyHostnameSetHash,
  secretSha256(JSON.stringify(BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES)),
);
assert.equal(
  browserConnectProxyAttestation.deniedConnectCount,
  browserConnectProxyAttestation.browserProductBackgroundDenyCount,
);
assert.equal(
  browserConnectProxyAttestation.unallowlistedHostnameDenyCount,
  browserConnectProxyAttestation.browserProductBackgroundDenyCount,
);
assert.equal(browserConnectProxyAttestation.fatalPolicyDenyCount, 0);
assert.equal(
  browserConnectProxyAttestation.browserProductBackgroundCredentialOrBodyObservationCount,
  0,
);
assert.equal(
  browserConnectProxyAttestation.uncorrelatedAllowedConnectDenyCount,
  0,
);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseTtlMilliseconds,
  5000,
);
assert.equal(
  browserConnectProxyAttestation.requestStageAuthorizationCount,
  browserConnectProxyAttestation.requestStageAuthorizationCompleteCount,
);
assert.equal(
  browserConnectProxyAttestation.requestStageAuthorizationCount,
  appCheckBinding.allowedEgressResponsePauseCount +
    appCheckBinding.allowedEgressContextCloseBackchannelRetirementCount +
    appCheckBinding.allowedEgressContextCloseSessionForwardPostRetirementCount +
    appCheckBinding.allowedEgressContextCloseTerminationRetirementCount,
  "Every request-stage proxy authorization must have a terminal response pause or an exact context-close WebChannel retirement.",
);
assert.equal(
  browserConnectProxyAttestation.requestStageAuthorizationRevocationCount,
  0,
);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseIssueCount,
  browserConnectProxyAttestation.requestStageAuthorizationCount,
);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseConsumeCount,
  browserConnectProxyAttestation.allowedConnectCount,
);
assert.equal(browserConnectProxyAttestation.authorityLeaseRevocationCount, 0);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseExpiredBeforeConnectCount,
  0,
);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseIssueCount,
  browserConnectProxyAttestation.authorityLeaseConsumeCount +
    browserConnectProxyAttestation.authorityLeaseUnusedCompletionCount +
    browserConnectProxyAttestation.authorityLeaseRevocationCount +
    browserConnectProxyAttestation.authorityLeaseExpiredBeforeConnectCount,
);
for (const field of [
  "releasedResponseStreamRegisterCount",
  "releasedResponseStreamLoadingFinishedSettlementCount",
  "releasedResponseStreamLoadingFailedSettlementCount",
  "releasedResponseStreamAuthorityTransportDrainSettlementCount",
  "releasedResponseStreamResidualCount",
  "releasedResponseStreamResidualAtCloseCount",
]) {
  assert.equal(
    Number.isSafeInteger(browserConnectProxyAttestation[field]),
    true,
  );
  assert.ok(browserConnectProxyAttestation[field] >= 0);
}
assert.equal(
  browserConnectProxyAttestation.releasedResponseStreamRegisterCount,
  browserConnectProxyAttestation.releasedResponseStreamLoadingFinishedSettlementCount +
    browserConnectProxyAttestation.releasedResponseStreamLoadingFailedSettlementCount +
    browserConnectProxyAttestation.releasedResponseStreamAuthorityTransportDrainSettlementCount +
    browserConnectProxyAttestation.releasedResponseStreamResidualCount +
    browserConnectProxyAttestation.releasedResponseStreamResidualAtCloseCount,
  "Released response streams were not exactly reconciled to one terminal source or a final residual.",
);
for (const field of [
  "targetedTunnelRetirementAttemptCount",
  "targetedTunnelRetirementSuccessCount",
  "targetedTunnelRetiredClientSocketCount",
  "targetedTunnelRetiredUpstreamSocketCount",
  "targetedTunnelAuthorityDrainSuccessCount",
]) {
  assert.equal(
    browserConnectProxyAttestation[field],
    authenticationProtectedReadRetry.recoveredProtectedReadTransportFailureCount,
  );
}
for (const observation of browserConnectProxyAttestation.targetedTunnelRetirementObservations) {
  assertExactObjectKeys(observation, ["stage", "hostname", "kind", "count"]);
  assert.ok(["baseline", "candidate"].includes(observation.stage));
  assert.equal(observation.hostname, "firestore.googleapis.com");
  assert.equal(
    observation.kind,
    "exact-request-authority-tunnel-retired-and-drained",
  );
  assert.equal(Number.isSafeInteger(observation.count), true);
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.targetedTunnelRetirementObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  authenticationProtectedReadRetry.recoveredProtectedReadTransportFailureCount,
);
assert.equal(
  browserConnectProxyAttestation.targetedTunnelRetirementObservationSetHash,
  secretSha256(
    JSON.stringify(
      browserConnectProxyAttestation.targetedTunnelRetirementObservations,
    ),
  ),
);
for (const field of [
  "httpAbsoluteFormDenyCount",
  "upgradeDenyCount",
  "invalidAuthorityDenyCount",
  "ipLiteralDenyCount",
  "alternatePortDenyCount",
  "connectHeaderDenyCount",
  "clientSocketErrorCount",
  "tunnelErrorCount",
  "requestStageAuthorizationResidualCount",
  "authorityLeaseResidualCount",
  "authorityLeaseQueueResidualCount",
  "activeAllowedTunnelResidualCount",
  "activeAllowedTunnelRequestBindingResidualCount",
  "preparedExactTunnelResetResidualCount",
  "releasedResponseStreamResidualCount",
  "releasedResponseStreamResidualAtCloseCount",
  "activeClientSocketCount",
  "activeUpstreamSocketCount",
  "fatalErrorCount",
]) {
  assert.equal(browserConnectProxyAttestation[field], 0);
}
for (const hostObservation of browserConnectProxyAttestation.allowedConnectHosts) {
  assertExactObjectKeys(hostObservation, ["hostname", "count"]);
  assert.equal(
    BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES.includes(
      hostObservation.hostname,
    ),
    true,
  );
  assert.ok(Number.isInteger(hostObservation.count));
  assert.ok(hostObservation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.allowedConnectHosts.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyAttestation.allowedConnectCount,
);
assert.equal(
  browserConnectProxyAttestation.allowedConnectHostSetHash,
  secretSha256(
    JSON.stringify(browserConnectProxyAttestation.allowedConnectHosts),
  ),
);
for (const observation of browserConnectProxyAttestation.browserProductBackgroundDenyObservations) {
  assertExactObjectKeys(observation, [
    "stage",
    "source",
    "hostname",
    "port",
    "count",
  ]);
  assert.equal(observation.stage, "browser-launch");
  assert.equal(observation.source, "browser-process-proxy-only-connect");
  assert.equal(observation.port, "443");
  assert.equal(
    BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES.includes(observation.hostname),
    true,
  );
  assert.ok(Number.isInteger(observation.count));
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.browserProductBackgroundDenyObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyAttestation.browserProductBackgroundDenyCount,
);
assert.equal(
  browserConnectProxyAttestation.browserProductBackgroundDenyObservationSetHash,
  secretSha256(
    JSON.stringify(
      browserConnectProxyAttestation.browserProductBackgroundDenyObservations,
    ),
  ),
);
for (const observation of browserConnectProxyAttestation.requestStageAuthorizationObservations) {
  assertExactObjectKeys(observation, [
    "stage",
    "hostname",
    "method",
    "origin",
    "kind",
    "count",
  ]);
  assert.equal(["baseline", "candidate"].includes(observation.stage), true);
  assert.equal(
    BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES.includes(
      observation.hostname,
    ),
    true,
  );
  assert.equal(
    BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS.includes(
      observation.method,
    ),
    true,
  );
  assert.equal(observation.origin, stableBrowserOrigin);
  assert.equal(
    [
      "authority-lease-active-tunnel-present",
      "authority-lease-no-active-tunnel",
    ].includes(observation.kind),
    true,
  );
  assert.ok(Number.isInteger(observation.count));
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.requestStageAuthorizationObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyAttestation.requestStageAuthorizationCount,
);
assert.equal(
  browserConnectProxyAttestation.requestStageAuthorizationObservationSetHash,
  secretSha256(
    JSON.stringify(
      browserConnectProxyAttestation.requestStageAuthorizationObservations,
    ),
  ),
);
assertBrowserConnectProxyTransportResetObservationConsistency({
  activeTunnelPresentAtAuthorizationCount:
    browserConnectProxyAttestation.activeTunnelPresentAtAuthorizationCount,
  targetedTunnelRetirementSuccessCount:
    browserConnectProxyAttestation.targetedTunnelRetirementSuccessCount,
  requestStageAuthorizationObservations:
    browserConnectProxyAttestation.requestStageAuthorizationObservations,
  targetedTunnelRetirementObservations:
    browserConnectProxyAttestation.targetedTunnelRetirementObservations,
  authenticationProtectedReadRetryAttestations:
    authenticationProtectedReadRetry.attestations,
});
for (const observation of browserConnectProxyAttestation.authorityLeaseConsumeObservations) {
  assertExactObjectKeys(observation, [
    "stage",
    "hostname",
    "method",
    "origin",
    "count",
  ]);
  assert.equal(["baseline", "candidate"].includes(observation.stage), true);
  assert.equal(
    BROWSER_CONNECT_PROXY_ALLOWED_FIREBASE_HOSTNAMES.includes(
      observation.hostname,
    ),
    true,
  );
  assert.equal(
    BROWSER_CONNECT_PROXY_AUTHORIZED_REQUEST_METHODS.includes(
      observation.method,
    ),
    true,
  );
  assert.equal(observation.origin, stableBrowserOrigin);
  assert.ok(Number.isInteger(observation.count));
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.authorityLeaseConsumeObservations.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyAttestation.authorityLeaseConsumeCount,
);
assert.equal(
  browserConnectProxyAttestation.authorityLeaseConsumeObservationSetHash,
  secretSha256(
    JSON.stringify(
      browserConnectProxyAttestation.authorityLeaseConsumeObservations,
    ),
  ),
);
for (const observation of browserConnectProxyAttestation.deniedConnectAuthorities) {
  assertExactObjectKeys(observation, ["authority", "count"]);
  assert.equal(
    BROWSER_PRODUCT_BACKGROUND_DENY_HOSTNAMES.map(
      (hostname) => `${hostname}:443`,
    ).includes(observation.authority),
    true,
  );
  assert.ok(Number.isInteger(observation.count));
  assert.ok(observation.count > 0);
}
assert.equal(
  browserConnectProxyAttestation.deniedConnectAuthorities.reduce(
    (total, observation) => total + observation.count,
    0,
  ),
  browserConnectProxyAttestation.deniedConnectCount,
);
assert.equal(
  browserConnectProxyAttestation.deniedConnectAuthoritySetHash,
  secretSha256(
    JSON.stringify(browserConnectProxyAttestation.deniedConnectAuthorities),
  ),
);
assert.equal(
  browserWideBoundaryAttestation.browserConnectProxyHash,
  sha256(canonicalJson(browserConnectProxyAttestation)),
);
assert.deepEqual(
  browserWideBoundaryAttestation.browserObservedDirectFirebaseHostnames,
  browserWideBoundaryAttestation.browserConnectProxyAllowedConnectHostnames,
);
assert.deepEqual(
  [
    ...new Set(
      browserConnectProxyAttestation.requestStageAuthorizationObservations.map(
        ({ hostname }) => hostname,
      ),
    ),
  ].sort(),
  browserWideBoundaryAttestation.browserObservedDirectFirebaseHostnames,
);
assert.deepEqual(
  browserWideBoundaryAttestation.browserConnectProxyAllowedConnectHostnames,
  browserConnectProxyAttestation.allowedConnectHosts.map(
    ({ hostname }) => hostname,
  ),
);
assert.equal(
  browserWideBoundaryAttestation.browserObservedDirectFirebaseHostnameSetHash,
  sha256(
    canonicalJson(
      browserWideBoundaryAttestation.browserObservedDirectFirebaseHostnames,
    ),
  ),
);
assert.equal(
  browserWideBoundaryAttestation.browserConnectProxyAllowedConnectHostnameSetHash,
  sha256(
    canonicalJson(
      browserWideBoundaryAttestation.browserConnectProxyAllowedConnectHostnames,
    ),
  ),
);
assert.equal(
  browserWideBoundaryAttestation.stableImmutableDeterministicExternalProxyConnectCount,
  0,
);
assert.equal(
  browserWideBoundaryAttestation.browserConnectProxyCleanupResidualCount,
  0,
);
assert.equal(
  browserWideBoundaryAttestation.browserConnectProxyCleanupResidualCount,
  browserConnectProxyAttestation.activeClientSocketCount +
    browserConnectProxyAttestation.activeUpstreamSocketCount +
    browserConnectProxyAttestation.activeAllowedTunnelResidualCount +
    browserConnectProxyAttestation.activeAllowedTunnelRequestBindingResidualCount +
    browserConnectProxyAttestation.preparedExactTunnelResetResidualCount +
    browserConnectProxyAttestation.releasedResponseStreamResidualCount +
    browserConnectProxyAttestation.releasedResponseStreamResidualAtCloseCount +
    browserConnectProxyAttestation.requestStageAuthorizationResidualCount +
    browserConnectProxyAttestation.authorityLeaseResidualCount +
    browserConnectProxyAttestation.authorityLeaseQueueResidualCount,
);
assert.equal(
  appCheckBinding.browserConnectProxyHash,
  browserWideBoundaryAttestation.browserConnectProxyHash,
);
assert.equal(
  appCheckBinding.browserConnectProxyAllowedConnectCount,
  browserConnectProxyAttestation.allowedConnectCount,
);
assert.equal(
  appCheckBinding.browserConnectProxyDeniedConnectCount,
  browserConnectProxyAttestation.deniedConnectCount,
);
assert.equal(appCheckBinding.browserConnectProxyCleanupResidualCount, 0);
assert.equal(
  appCheckBinding.browserConnectProxyCleanupResidualCount,
  browserWideBoundaryAttestation.browserConnectProxyCleanupResidualCount,
);
assert.equal(
  appCheckBinding.preTransmissionBoundaryAttestationHash,
  preTransmissionNetworkBoundaryAttestationHash,
);
assert.equal(
  appCheckBinding.nonFirebaseNetworkAllowedHostnameSetHash,
  nonFirebaseNetworkAllowedHostnameSetHash,
);
assert.equal(
  appCheckBinding.nonFirebaseNetworkAllowedHostnameCount,
  nonFirebaseNetworkAllowedHostnames.length,
);
assert.equal(
  appCheckBinding.debugSentinelHash,
  sha256(APP_CHECK_DEBUG_SENTINEL),
);
assert.equal(
  appCheckBinding.browserGlobalValueKind,
  "non-secret-fixed-sentinel",
);
assert.equal(appCheckBinding.secretInitScope, "primary-page-only");
assert.equal(appCheckBinding.pageAppCheckSecretInitRegistrationCount, 1);
assert.equal(
  appCheckBinding.headerCorrelationMechanism,
  "cdp-fetch-network-id-firestore-webchannel-transport-and-bounded-playwright-request-allHeaders",
);
assert.equal(appCheckBinding.urlMethodFifoCorrelationUsed, false);
assert.equal(appCheckBinding.protocolDebugLoggingDisabled, true);
assert.equal(appCheckBinding.browserLaunchExplicitEnvironment, true);
assert.equal(appCheckBinding.childProcessSecretEnvScrubbed, true);
assert.equal(appCheckBinding.browserChildEnvironmentAllowlisted, true);
assert.equal(
  appCheckBinding.browserChildEnvironmentAllowlistHash,
  sha256(canonicalJson(BROWSER_CHILD_ENVIRONMENT_ALLOWLIST)),
);
assert.equal(appCheckBinding.scrubbedSecretEnvironmentVariableCount, 4);
assert.equal(appCheckBinding.playwrightRouteRegistrationCount, 0);
assert.equal(appCheckBinding.browserGlobalExtraHttpHeaderRegistrationCount, 0);
assert.equal(typeof appCheckBinding.vercelBypassConfigured, "boolean");
assert.equal(auditedVercelBypassConfiguredValues.size, 1);
assert.equal(
  [...auditedVercelBypassConfiguredValues][0],
  appCheckBinding.vercelBypassConfigured,
);
assert.equal(
  appCheckBinding.vercelBypassAllowedOriginSetHash,
  sha256(canonicalJson(vercelBypassAllowedOrigins)),
);
assert.equal(
  appCheckBinding.vercelBypassTransportContractHash,
  sha256(canonicalJson(VERCEL_BYPASS_TRANSPORT_CONTRACT)),
);
assert.equal(appCheckBinding.serviceWorkerPolicy, "block");
assert.ok(appCheckBinding.nodeDeploymentFetchRequestCount > 0);
assert.equal(
  appCheckBinding.nodeDeploymentFetchRequestCount,
  appCheckBinding.nodeDeploymentFetchHttp200Count,
);
assert.equal(appCheckBinding.nodeDeploymentRedirectResponseCount, 0);
assert.equal(
  appCheckBinding.nodeVercelBypassHeaderRequestCount,
  appCheckBinding.vercelBypassConfigured
    ? appCheckBinding.nodeDeploymentFetchRequestCount
    : 0,
);
assert.equal(
  appCheckBinding.nodeDeploymentSkipToolbarHeaderRequestCount,
  appCheckBinding.nodeDeploymentFetchRequestCount,
);
assert.ok(
  Number.isSafeInteger(
    appCheckBinding.nodeDeploymentSkipToolbarHeaderRequestCount,
  ) && appCheckBinding.nodeDeploymentSkipToolbarHeaderRequestCount >= 0,
);
assert.equal(
  appCheckBinding.nodeDeploymentVercelToolbarMarkupObservationCount,
  0,
);
assert.equal(
  appCheckBinding.allowedEgressPostFinalResponseErrorPauseCount,
  appCheckBinding.allowedEgressPostFinalContinueResponseSuccessCount +
    appCheckBinding.allowedEgressPostFinalAlreadyRetiredInterceptionCount,
);
for (const field of [
  "allowedEgressPostFinalResponseErrorPauseCount",
  "allowedEgressPostFinalContinueResponseSuccessCount",
  "allowedEgressPostFinalAlreadyRetiredInterceptionCount",
]) {
  assert.ok(Number.isSafeInteger(appCheckBinding[field]));
  assert.ok(appCheckBinding[field] >= 0);
}
for (const field of [
  "cdpContinueRequestInvalidInterceptionErrorCount",
  "cdpContinueResponseInvalidInterceptionErrorCount",
  "cdpPrimaryFinalContinueResponseInvalidInterceptionErrorCount",
  "cdpOtherContinueResponseInvalidInterceptionErrorCount",
  "cdpOtherProtocolErrorCount",
]) {
  assert.equal(appCheckBinding[field], 0);
}
assert.equal(
  appCheckBinding.cdpContinueResponseInvalidInterceptionErrorCount,
  appCheckBinding.cdpPrimaryFinalContinueResponseInvalidInterceptionErrorCount +
    appCheckBinding.cdpOtherContinueResponseInvalidInterceptionErrorCount,
);
assert.ok(
  appCheckBinding.cdpContinueRequestInvalidInterceptionErrorCount +
    appCheckBinding.cdpContinueResponseInvalidInterceptionErrorCount +
    appCheckBinding.cdpOtherProtocolErrorCount <=
    appCheckBinding.appCheckCdpHandlerErrorCount,
);
assert.equal(
  appCheckBinding.baselineProtectedDataRequestCount,
  auditedBaselineProtectedDataRequests,
);
assert.equal(
  appCheckBinding.baselineBridgeEligibleRequestCount,
  auditedBaselineBridgeEligibleRequests,
);
assert.equal(
  appCheckBinding.baselineBridgeInjectedRequestCount,
  auditedBaselineBridgeInjectedRequests,
);
assert.ok(appCheckBinding.baselineBridgeInjectedRequestCount > 0);
assert.equal(
  appCheckBinding.baselineBridgeNativeHeaderRequestCount,
  auditedBaselineBridgeNativeHeaderRequests,
);
for (const [field, auditedValue] of Object.entries({
  baselineBridgeRedirectRequestCount: auditedBaselineBridgeRedirectRequests,
  baselineBridgeRedirectHeaderAbsentRequestCount:
    auditedBaselineBridgeRedirectHeaderAbsentRequests,
  baselineBridgeRedirectAbortRequestCount:
    auditedBaselineBridgeRedirectAbortRequests,
  baselineBridgeCdpPausedRequestCount: auditedBaselineBridgeCdpPausedRequests,
  baselineBridgeCdpResponsePausedRequestCount:
    auditedBaselineBridgeCdpResponsePausedRequests,
  baselineBridgeCdpReconciledRequestCount:
    auditedBaselineBridgeCdpReconciledRequests,
  webChannelCdpHeaderAttestationRegisteredRequestCount:
    auditedWebChannelCdpHeaderAttestationRegisteredRequests,
  webChannelCdpHeaderAttestationCompletedRequestCount:
    auditedWebChannelCdpHeaderAttestationCompletedRequests,
  webChannelCdpHeaderAttestationBoundRequestCount:
    auditedWebChannelCdpHeaderAttestationBoundRequests,
  webChannelCdpHeaderAttestationBindingResidualCount:
    auditedWebChannelCdpHeaderAttestationBindingResiduals,
  webChannelCdpHeaderAttestationBindingFailureCount:
    auditedWebChannelCdpHeaderAttestationBindingFailures,
  webChannelCdpHeaderAttestationPairingTimeoutCount:
    auditedWebChannelCdpHeaderAttestationPairingTimeouts,
  webChannelCdpHeaderAttestationCompletionTimeoutCount:
    auditedWebChannelCdpHeaderAttestationCompletionTimeouts,
  allowedEgressContextCloseBackchannelRetirementCount:
    auditedAllowedEgressContextCloseBackchannelRetirements,
  allowedEgressContextCloseSessionForwardPostRetirementCount:
    auditedAllowedEgressContextCloseSessionForwardPostRetirements,
  allowedEgressContextCloseTerminationRetirementCount:
    auditedAllowedEgressContextCloseTerminationRetirements,
  webChannelTerminationClassifiedRequestCount:
    auditedWebChannelTerminationClassifiedRequests,
  playwrightAllHeadersHeaderAttestationRequestCount:
    auditedPlaywrightAllHeadersHeaderAttestationRequests,
  playwrightAllHeadersHeaderAttestationCompletedRequestCount:
    auditedPlaywrightAllHeadersHeaderAttestationCompletedRequests,
  appCheckCdpHandlerErrorCount: auditedBaselineBridgeHandlerErrors,
  baselineBridgeInjectedRedirectResponseAbortCount:
    auditedBaselineBridgeInjectedRedirectResponseAborts,
  baselineBridgeDecisionUnmatchedProtectedRequestCount:
    auditedBaselineBridgeDecisionUnmatchedProtectedRequests,
  baselineBridgeScopeIneligibleProtectedRequestCount:
    auditedBaselineBridgeScopeIneligibleProtectedRequests,
  appCheckCdpMonitorPausedRequestCount: auditedAppCheckCdpMonitorPausedRequests,
  preTransmissionBoundaryInspectionCount:
    auditedPreTransmissionBoundaryInspections,
  preTransmissionBoundaryBlockAttemptCount:
    auditedPreTransmissionBoundaryBlockAttempts,
  preTransmissionBoundaryProductionBlockCount:
    auditedPreTransmissionBoundaryProductionBlocks,
  preTransmissionBoundaryCrossOriginDocumentBlockCount:
    auditedPreTransmissionBoundaryCrossOriginDocumentBlocks,
  preTransmissionBoundaryUnboundFirebaseBlockCount:
    auditedPreTransmissionBoundaryUnboundFirebaseBlocks,
  preTransmissionBoundaryNonFirebaseHostnameBlockCount:
    auditedPreTransmissionBoundaryNonFirebaseHostnameBlocks,
  preTransmissionBoundaryMalformedUrlBlockCount:
    auditedPreTransmissionBoundaryMalformedUrlBlocks,
  preTransmissionBoundaryFailRequestCount:
    auditedPreTransmissionBoundaryFailRequests,
  optionalTelemetrySuppressedRequestCount:
    auditedOptionalTelemetrySuppressedRequests,
  deterministicHolidayResponseFulfillCount:
    auditedDeterministicHolidayResponseFulfills,
  deterministicRecaptchaResponseFulfillCount:
    auditedDeterministicRecaptchaResponseFulfills,
  deterministicFirebaseModuleFulfillCount:
    auditedDeterministicFirebaseModuleFulfills,
  deterministicResponseScopeMismatchBlockCount:
    auditedDeterministicResponseScopeMismatchBlocks,
  externalStaticRequestNetworkFetchCount:
    auditedExternalStaticRequestNetworkFetches,
  externalStaticRequestCacheFulfillCount:
    auditedExternalStaticRequestCacheFulfills,
  externalStaticRequestScopeMismatchBlockCount:
    auditedExternalStaticRequestScopeMismatchBlocks,
  externalStaticResponseNon200AbortCount:
    auditedExternalStaticResponseNon200Aborts,
  stagingApiKeyScopeViolationBlockCount:
    auditedStagingApiKeyScopeViolationBlocks,
  testCredentialScopeViolationBlockCount:
    auditedTestCredentialScopeViolationBlocks,
  refreshTokenScopeViolationBlockCount: auditedRefreshTokenScopeViolationBlocks,
  rawSensitivePreTransmissionInspectionCount:
    auditedRawSensitivePreTransmissionInspections,
  rawSensitivePreTransmissionBlockCount:
    auditedRawSensitivePreTransmissionBlocks,
  rawProductionPreTransmissionBlockCount:
    auditedRawProductionPreTransmissionBlocks,
  rawVercelBypassPreTransmissionBlockCount:
    auditedRawVercelBypassPreTransmissionBlocks,
  rawStagingApiKeyPreTransmissionBlockCount:
    auditedRawStagingApiKeyPreTransmissionBlocks,
  rawTestCredentialPreTransmissionBlockCount:
    auditedRawTestCredentialPreTransmissionBlocks,
  rawRefreshTokenPreTransmissionBlockCount:
    auditedRawRefreshTokenPreTransmissionBlocks,
  rawDebugTokenPreTransmissionBlockCount:
    auditedRawDebugTokenPreTransmissionBlocks,
  rawDebugSentinelPreTransmissionBlockCount:
    auditedRawDebugSentinelPreTransmissionBlocks,
  allowedEgressResponsePauseCount: auditedAllowedEgressResponsePauses,
  allowedEgressInformationalResponsePauseCount:
    auditedAllowedEgressInformationalResponsePauses,
  allowedEgressInformationalFinalResponseCount:
    auditedAllowedEgressInformationalFinalResponses,
  allowedEgressInformationalTrackingResidualCount:
    auditedAllowedEgressInformationalTrackingResiduals,
  allowedEgressInvalidResponseStatusAbortCount:
    auditedAllowedEgressInvalidResponseStatusAborts,
  allowedEgressRedirectAbortCount: auditedAllowedEgressRedirectAborts,
  allowedEgressHttpErrorAbortCount: auditedAllowedEgressHttpErrorAborts,
  allowedEgressResponseErrorAbortCount: auditedAllowedEgressResponseErrorAborts,
  allowedEgressTrackingResidualCount: auditedAllowedEgressTrackingResiduals,
  externalStaticTrackingResidualCount: auditedExternalStaticTrackingResiduals,
  allowedEgressInformationalEgressHeaderObservationCount:
    auditedAllowedEgressInformationalEgressHeaderObservations,
  allowedEgressFinalEgressHeaderObservationCount:
    auditedAllowedEgressFinalEgressHeaderObservations,
  allowedEgressResponseHeaderSuppressionCount:
    auditedAllowedEgressResponseHeaderSuppressions,
  allowedEgressEgressHeaderForwardCount:
    auditedAllowedEgressEgressHeaderForwards,
  fullPostDataResolutionCount: auditedFullPostDataResolutions,
  fullPostDataNetworkFallbackCount: auditedFullPostDataNetworkFallbacks,
  fullPostDataResolutionFailureCount: auditedFullPostDataResolutionFailures,
  fullPostDataOversizeBlockCount: auditedFullPostDataOversizeBlocks,
  fullPostDataRepresentationMismatchBlockCount:
    auditedFullPostDataRepresentationMismatchBlocks,
  debugTokenNetworkObservationCount: auditedDebugTokenNetworkObservations,
  debugSentinelNetworkObservationCount: auditedDebugSentinelNetworkObservations,
  authorizedDebugExchangeBodyReplacementCount:
    auditedAuthorizedDebugExchangeBodyReplacements,
  unauthorizedDebugTokenEgressCount: auditedUnauthorizedDebugTokenEgresses,
  unauthorizedDebugSentinelEgressCount:
    auditedUnauthorizedDebugSentinelEgresses,
  appCheckHeaderNetworkObservationCount:
    auditedAppCheckHeaderNetworkObservations,
  authorizedAppCheckHeaderRequestCount: auditedAuthorizedAppCheckHeaderRequests,
  unauthorizedAppCheckHeaderEgressCount:
    auditedUnauthorizedAppCheckHeaderEgresses,
  sensitiveAppCheckRedirectRequestCount:
    auditedSensitiveAppCheckRedirectRequests,
  sensitiveAppCheckRedirectAbortRequestCount:
    auditedSensitiveAppCheckRedirectAborts,
  sensitiveAppCheckCdpResponsePausedRequestCount:
    auditedSensitiveAppCheckCdpResponsePausedRequests,
  sensitiveAppCheckRedirectResponseAbortRequestCount:
    auditedSensitiveAppCheckRedirectResponseAborts,
  sensitiveAppCheckResponseErrorAbortRequestCount:
    auditedSensitiveAppCheckResponseErrorAborts,
  sensitiveAppCheckRequestTrackingResidualCount:
    auditedSensitiveAppCheckRequestTrackingResiduals,
  browserNetworkHeaderAttestationErrorCount:
    auditedBrowserNetworkHeaderAttestationErrors,
  pendingBridgeDecisionResidualCount: auditedPendingBridgeDecisionResiduals,
  pendingBridgeObservationResidualCount:
    auditedPendingBridgeObservationResiduals,
  unexpectedExtraPageCount: auditedUnexpectedExtraPages,
  unexpectedDedicatedWorkerCount: auditedUnexpectedDedicatedWorkers,
  unexpectedServiceWorkerCount: auditedUnexpectedServiceWorkers,
  unexpectedCrossOriginFrameCount: auditedUnexpectedCrossOriginFrames,
  unexpectedOopifTargetCount: auditedUnexpectedOopifTargets,
  unexpectedDedicatedWorkerTargetCount: auditedUnexpectedDedicatedWorkerTargets,
  unexpectedSharedWorkerTargetCount: auditedUnexpectedSharedWorkerTargets,
  unexpectedServiceWorkerTargetCount: auditedUnexpectedServiceWorkerTargets,
  retainedOopifTargetCount: auditedRetainedOopifTargets,
  retainedDedicatedWorkerTargetCount: auditedRetainedDedicatedWorkerTargets,
  retainedSharedWorkerTargetCount: auditedRetainedSharedWorkerTargets,
  retainedServiceWorkerTargetCount: auditedRetainedServiceWorkerTargets,
  targetDiscoveryActivationCount: auditedTargetDiscoveryActivations,
  targetSnapshotCount: auditedTargetSnapshots,
  pageRawDebugTokenInjectionCount: auditedPageRawDebugTokenInjections,
  browserGlobalRawDebugTokenWriteCount: auditedBrowserGlobalRawDebugTokenWrites,
  browserGlobalDebugSentinelWriteCount: auditedBrowserGlobalDebugSentinelWrites,
  localStorageSecretWriteCount: auditedLocalStorageSecretWrites,
  browserGlobalExtraHttpHeaderRegistrationCount:
    auditedBrowserGlobalExtraHttpHeaderRegistrations,
  browserChildEnvironmentUnexpectedKeyCount:
    auditedBrowserChildEnvironmentUnexpectedKeys,
  vercelBypassCdpInjectedRequestCount: auditedVercelBypassCdpInjectedRequests,
  vercelBypassPreexistingHeaderObservationCount:
    auditedVercelBypassPreexistingHeaderObservations,
  unauthorizedVercelBypassEgressCount: auditedUnauthorizedVercelBypassEgresses,
  vercelBypassCdpResponsePausedRequestCount:
    auditedVercelBypassCdpResponsePausedRequests,
  vercelBypassHttpSuccessResponseCount: auditedVercelBypassHttpSuccessResponses,
  vercelBypassHttpErrorResponseCount: auditedVercelBypassHttpErrorResponses,
  vercelBypassRedirectRequestCount: auditedVercelBypassRedirectRequests,
  vercelBypassRedirectAbortRequestCount: auditedVercelBypassRedirectAborts,
  vercelBypassRedirectResponseAbortRequestCount:
    auditedVercelBypassRedirectResponseAborts,
  vercelBypassResponseErrorAbortRequestCount:
    auditedVercelBypassResponseErrorAborts,
  vercelBypassObservedEligibleRequestCount:
    auditedVercelBypassObservedEligibleRequests,
  vercelBypassHeaderObservedRequestCount:
    auditedVercelBypassHeaderObservedRequests,
  vercelBypassHeaderMissingRequestCount:
    auditedVercelBypassHeaderMissingRequests,
  vercelBypassHeaderMismatchRequestCount: auditedVercelBypassHeaderMismatches,
  rawVercelBypassOutputCount: auditedRawVercelBypassOutputs,
})) {
  assert.equal(
    appCheckBinding[field],
    auditedValue,
    `appCheckBinding.${field} does not reconcile to browser audit.`,
  );
}
assert.equal(
  appCheckBinding.baselineBridgeScopeMismatchRequestCount,
  auditedBaselineBridgeScopeMismatches,
);
assert.equal(
  appCheckBinding.baselineBridgeStrippedHeaderRequestCount,
  auditedBaselineBridgeStrippedHeaders,
);
assert.equal(
  appCheckBinding.baselineBridgeEligibleRequestCount,
  appCheckBinding.baselineProtectedDataRequestCount,
);
assert.equal(
  appCheckBinding.baselineBridgeInjectedRequestCount +
    appCheckBinding.baselineBridgeNativeHeaderRequestCount,
  appCheckBinding.baselineBridgeEligibleRequestCount,
);
assert.equal(appCheckBinding.baselineBridgeScopeMismatchRequestCount, 0);
assert.equal(
  appCheckBinding.baselineEffectiveHeaderMissingRequestCount,
  auditedBaselineEffectiveHeaderMissingRequests,
);
assert.equal(appCheckBinding.baselineEffectiveHeaderMissingRequestCount, 0);
assert.ok(appCheckBinding.baselineBridgeCdpPausedRequestCount > 0);
assert.ok(appCheckBinding.baselineBridgeCdpReconciledRequestCount > 0);
assert.ok(
  appCheckBinding.webChannelCdpHeaderAttestationRegisteredRequestCount > 0,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationRegisteredRequestCount,
  appCheckBinding.webChannelCdpHeaderAttestationCompletedRequestCount,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationCompletedRequestCount,
  appCheckBinding.webChannelCdpHeaderAttestationBoundRequestCount,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationBindingResidualCount,
  0,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationBindingFailureCount,
  0,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationPairingTimeoutCount,
  0,
);
assert.equal(
  appCheckBinding.webChannelCdpHeaderAttestationCompletionTimeoutCount,
  0,
);
assert.ok(
  Number.isSafeInteger(
    appCheckBinding.allowedEgressContextCloseBackchannelRetirementCount,
  ),
);
assert.ok(
  appCheckBinding.allowedEgressContextCloseBackchannelRetirementCount >= 0,
);
assert.ok(
  Number.isSafeInteger(
    appCheckBinding.allowedEgressContextCloseSessionForwardPostRetirementCount,
  ),
);
assert.ok(
  appCheckBinding.allowedEgressContextCloseSessionForwardPostRetirementCount >=
    0,
);
assert.ok(
  appCheckBinding.allowedEgressContextCloseBackchannelRetirementCount +
    appCheckBinding.allowedEgressContextCloseSessionForwardPostRetirementCount <=
    appCheckBinding.webChannelCdpHeaderAttestationBoundRequestCount,
);
assert.ok(
  Number.isSafeInteger(
    appCheckBinding.allowedEgressContextCloseTerminationRetirementCount,
  ),
);
assert.ok(
  appCheckBinding.allowedEgressContextCloseTerminationRetirementCount >= 0,
);
assert.ok(
  Number.isSafeInteger(
    appCheckBinding.webChannelTerminationClassifiedRequestCount,
  ),
);
assert.ok(appCheckBinding.webChannelTerminationClassifiedRequestCount >= 0);
assert.ok(
  appCheckBinding.allowedEgressContextCloseTerminationRetirementCount <=
    appCheckBinding.webChannelTerminationClassifiedRequestCount,
);
assert.ok(
  appCheckBinding.playwrightAllHeadersHeaderAttestationRequestCount > 0,
);
assert.equal(
  appCheckBinding.playwrightAllHeadersHeaderAttestationRequestCount,
  appCheckBinding.playwrightAllHeadersHeaderAttestationCompletedRequestCount,
);
assert.ok(appCheckBinding.appCheckCdpMonitorPausedRequestCount > 0);
assert.ok(appCheckBinding.preTransmissionBoundaryInspectionCount > 0);
assert.equal(
  appCheckBinding.appCheckCdpMonitorPausedRequestCount,
  appCheckBinding.preTransmissionBoundaryInspectionCount,
);
assert.equal(
  appCheckBinding.rawSensitivePreTransmissionInspectionCount,
  appCheckBinding.appCheckCdpMonitorPausedRequestCount,
);
assert.equal(
  appCheckBinding.preTransmissionBoundaryBlockAttemptCount,
  appCheckBinding.preTransmissionBoundaryProductionBlockCount +
    appCheckBinding.preTransmissionBoundaryCrossOriginDocumentBlockCount +
    appCheckBinding.preTransmissionBoundaryUnboundFirebaseBlockCount +
    appCheckBinding.preTransmissionBoundaryNonFirebaseHostnameBlockCount +
    appCheckBinding.preTransmissionBoundaryMalformedUrlBlockCount,
);
assert.equal(
  appCheckBinding.preTransmissionBoundaryFailRequestCount,
  appCheckBinding.preTransmissionBoundaryBlockAttemptCount,
);
assert.equal(
  appCheckBinding.baselineBridgeCdpResponsePausedRequestCount,
  appCheckBinding.baselineBridgeInjectedRequestCount,
);
assert.equal(
  appCheckBinding.debugSentinelNetworkObservationCount,
  appCheckBinding.authorizedDebugExchangeBodyReplacementCount,
);
assert.equal(
  appCheckBinding.authorizedDebugExchangeBodyReplacementCount,
  appCheckBinding.browserAppCheckExchangeRequestCount,
);
assert.equal(
  appCheckBinding.appCheckHeaderNetworkObservationCount,
  appCheckBinding.authorizedAppCheckHeaderRequestCount,
);
assert.equal(
  appCheckBinding.sensitiveAppCheckCdpResponsePausedRequestCount,
  appCheckBinding.authorizedDebugExchangeBodyReplacementCount +
    appCheckBinding.authorizedAppCheckHeaderRequestCount,
);
assert.equal(appCheckBinding.vercelBypassCdpInjectedRequestCount, 0);
assert.equal(appCheckBinding.vercelBypassObservedEligibleRequestCount, 0);
assert.equal(appCheckBinding.vercelBypassHeaderObservedRequestCount, 0);
assert.equal(appCheckBinding.vercelBypassCdpResponsePausedRequestCount, 0);
assert.equal(appCheckBinding.vercelBypassHttpSuccessResponseCount, 0);
assert.equal(
  appCheckBinding.baselineScreenCaptureProtectedRequestCount,
  auditedBaselineScreenCaptureProtectedRequests,
);
assert.equal(
  appCheckBinding.baselineScreenCaptureBridgeRequestCount,
  auditedBaselineScreenCaptureBridgeRequests,
);
assert.ok(appCheckBinding.baselineScreenCaptureProtectedRequestCount > 0);
assert.equal(
  appCheckBinding.baselineScreenCaptureBridgeRequestCount,
  appCheckBinding.baselineScreenCaptureProtectedRequestCount,
);
assert.equal(
  appCheckBinding.candidateProtectedDataRequestCount,
  auditedCandidateProtectedDataRequests,
);
assert.equal(
  appCheckBinding.candidateNativeHeaderPresentRequestCount,
  auditedCandidateNativeHeaderPresentRequests,
);
assert.equal(
  appCheckBinding.candidateNativeHeaderMissingRequestCount,
  auditedCandidateNativeHeaderMissingRequests,
);
assert.equal(appCheckBinding.candidateNativeHeaderMissingRequestCount, 0);
assert.equal(
  appCheckBinding.candidateNativeHeaderPresentRequestCount,
  appCheckBinding.candidateProtectedDataRequestCount,
);
assert.equal(
  appCheckBinding.candidateScreenCaptureProtectedRequestCount,
  auditedCandidateScreenCaptureProtectedRequests,
);
assert.equal(
  appCheckBinding.candidateScreenCaptureNativeRequestCount,
  auditedCandidateScreenCaptureNativeRequests,
);
assert.ok(appCheckBinding.candidateScreenCaptureProtectedRequestCount > 0);
assert.equal(
  appCheckBinding.candidateScreenCaptureNativeRequestCount,
  appCheckBinding.candidateScreenCaptureProtectedRequestCount,
);
assert.equal(
  appCheckBinding.candidateBridgeInjectedRequestCount,
  auditedCandidateBridgeInjectedRequests,
);
assert.equal(appCheckBinding.candidateBridgeInjectedRequestCount, 0);
assert.equal(
  appCheckBinding.protectedHeaderJwtShapeInvalidRequestCount,
  auditedProtectedHeaderJwtShapeInvalidRequests,
);
assert.equal(appCheckBinding.protectedHeaderJwtShapeInvalidRequestCount, 0);
assert.equal(
  appCheckBinding.browserAppCheckExchangeRequestCount,
  auditedBrowserAppCheckExchangeRequests,
);
assert.equal(
  appCheckBinding.browserAppCheckExchangeHttp200Count,
  auditedBrowserAppCheckExchangeHttp200Responses,
);
const auditedProtectedDataRequestCount =
  auditedBaselineProtectedDataRequests + auditedCandidateProtectedDataRequests;
assert.equal(
  networkSummary.appCheckProtectedDataRequestCount,
  auditedProtectedDataRequestCount,
);
assert.equal(
  networkSummary.appCheckHeaderPresentRequestCount,
  auditedProtectedHeaderPresentRequests,
);
assert.equal(
  networkSummary.appCheckHeaderMissingRequestCount,
  auditedProtectedHeaderMissingRequests,
);
assert.equal(networkSummary.appCheckHeaderMissingRequestCount, 0);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeValidRequestCount,
  auditedProtectedHeaderJwtShapeValidRequests,
);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeInvalidRequestCount,
  auditedProtectedHeaderJwtShapeInvalidRequests,
);
assert.equal(networkSummary.appCheckHeaderJwtShapeInvalidRequestCount, 0);
assert.equal(
  networkSummary.appCheckHeaderPresentRequestCount,
  networkSummary.appCheckProtectedDataRequestCount,
);
assert.equal(
  networkSummary.appCheckHeaderJwtShapeValidRequestCount,
  networkSummary.appCheckProtectedDataRequestCount,
);
assert.equal(
  networkSummary.appCheckExchangeRequestCount,
  appCheckBinding.browserAppCheckExchangeRequestCount,
);
assert.equal(
  networkSummary.successfulAppCheckExchangeResponseCount,
  appCheckBinding.browserAppCheckExchangeHttp200Count,
);
assert.equal(appCheckBinding.firebaseDataRedirectResponseCount, 0);
assert.equal(auditedFirebaseDataRedirectResponses, 0);
assert.equal(appCheckBinding.firebaseDataErrorResponseCount, 0);
assert.equal(auditedFirebaseDataErrorResponses, 0);
assert.equal(
  appCheckBinding.successfulFirebaseDataResponseCount,
  auditedSuccessfulFirebaseDataResponses,
);
assert.ok(appCheckBinding.successfulFirebaseDataResponseCount > 0);
assert.equal(appCheckBinding.serviceWorkerPolicy, "block");
assert.equal(
  appCheckBinding.initScriptInjectionCount,
  manifest.browserAudits.length,
);
assert.equal(
  appCheckBinding.targetDiscoveryActivationCount,
  manifest.browserAudits.length,
);
assert.equal(
  appCheckBinding.targetSnapshotCount,
  manifest.browserAudits.length,
);
assert.ok(
  appCheckBinding.browserGlobalDebugSentinelWriteCount >=
    manifest.browserAudits.length,
);
assert.equal(appCheckBinding.contextCloseCount, manifest.browserAudits.length);
assert.ok(Number.isInteger(appCheckBinding.consoleMessageCount));
for (const field of [
  "consoleSecretObservationCount",
  "corsConsoleErrorCount",
  "domSecretObservationCount",
  "requestFailureCount",
  "rawDebugTokenOutputCount",
  "rawExchangedTokenOutputCount",
  "rawResponseBodyOutputCount",
  "argvSecretCount",
  "localStorageSecretWriteCount",
  "traceWriteCount",
  "harWriteCount",
  "storageStateWriteCount",
  "rawHeaderValueOutputCount",
  "rawTokenOutputCount",
  "rawVercelBypassOutputCount",
  "pageRawDebugTokenInjectionCount",
  "browserGlobalRawDebugTokenWriteCount",
  "contextAppCheckSecretInitCount",
  "browserChildSecretEnvironmentVariableCount",
  "browserChildSecretValueObservationCount",
  "browserChildEnvironmentUnexpectedKeyCount",
  "playwrightRouteRegistrationCount",
  "browserGlobalExtraHttpHeaderRegistrationCount",
  "pendingBridgeDecisionResidualCount",
  "pendingBridgeObservationResidualCount",
  "baselineBridgeScopeMismatchRequestCount",
  "baselineBridgeStrippedHeaderRequestCount",
  "baselineBridgeRedirectRequestCount",
  "baselineBridgeRedirectHeaderAbsentRequestCount",
  "baselineBridgeRedirectAbortRequestCount",
  "appCheckCdpHandlerErrorCount",
  "baselineBridgeInjectedRedirectResponseAbortCount",
  "preTransmissionBoundaryBlockAttemptCount",
  "preTransmissionBoundaryProductionBlockCount",
  "preTransmissionBoundaryCrossOriginDocumentBlockCount",
  "preTransmissionBoundaryUnboundFirebaseBlockCount",
  "preTransmissionBoundaryNonFirebaseHostnameBlockCount",
  "preTransmissionBoundaryMalformedUrlBlockCount",
  "preTransmissionBoundaryFailRequestCount",
  "allowedEgressEgressHeaderForwardCount",
  "fullPostDataResolutionFailureCount",
  "fullPostDataOversizeBlockCount",
  "fullPostDataRepresentationMismatchBlockCount",
  "baselineBridgeDecisionUnmatchedProtectedRequestCount",
  "baselineBridgeScopeIneligibleProtectedRequestCount",
  "debugTokenNetworkObservationCount",
  "unauthorizedDebugTokenEgressCount",
  "unauthorizedDebugSentinelEgressCount",
  "unauthorizedAppCheckHeaderEgressCount",
  "vercelBypassPreexistingHeaderObservationCount",
  "unauthorizedVercelBypassEgressCount",
  "vercelBypassRedirectRequestCount",
  "vercelBypassRedirectAbortRequestCount",
  "vercelBypassRedirectResponseAbortRequestCount",
  "vercelBypassResponseErrorAbortRequestCount",
  "vercelBypassHttpErrorResponseCount",
  "vercelBypassHeaderMissingRequestCount",
  "vercelBypassHeaderMismatchRequestCount",
  "sensitiveAppCheckRedirectRequestCount",
  "sensitiveAppCheckRedirectAbortRequestCount",
  "sensitiveAppCheckRedirectResponseAbortRequestCount",
  "sensitiveAppCheckResponseErrorAbortRequestCount",
  "sensitiveAppCheckRequestTrackingResidualCount",
  "browserNetworkHeaderAttestationErrorCount",
  "unexpectedExtraPageCount",
  "unexpectedDedicatedWorkerCount",
  "unexpectedServiceWorkerCount",
  "unexpectedCrossOriginFrameCount",
  "unexpectedOopifTargetCount",
  "unexpectedDedicatedWorkerTargetCount",
  "unexpectedSharedWorkerTargetCount",
  "unexpectedServiceWorkerTargetCount",
  "retainedOopifTargetCount",
  "retainedDedicatedWorkerTargetCount",
  "retainedSharedWorkerTargetCount",
  "retainedServiceWorkerTargetCount",
]) {
  assert.equal(
    appCheckBinding[field],
    0,
    `appCheckBinding.${field} must be 0.`,
  );
}
assert.ok(auditedStagingFirebaseRequests > 0);
assert.equal(auditedNetworkRequests, networkSummary.requestCount);
assert.equal(auditedNetworkResponses, networkSummary.responseCount);
assert.equal(
  auditedNonFirebaseRequests,
  networkSummary.nonFirebaseRequestCount,
);
assert.equal(
  auditedNonFirebaseAllowedRequests,
  networkSummary.nonFirebaseAllowedRequestCount,
);
assert.equal(
  auditedNonFirebaseUnallowlistedRequests,
  networkSummary.nonFirebaseUnallowlistedRequestCount,
);
assert.equal(
  auditedNonFirebaseUnallowlistedResponses,
  networkSummary.nonFirebaseUnallowlistedResponseCount,
);
assert.equal(
  auditedProductionVercelRequests,
  networkSummary.productionVercelRequestCount,
);
assert.equal(
  auditedProductionVercelResponses,
  networkSummary.productionVercelResponseCount,
);
assert.equal(
  auditedUnknownVercelRequests,
  networkSummary.unknownVercelRequestCount,
);
assert.equal(
  auditedUnknownVercelResponses,
  networkSummary.unknownVercelResponseCount,
);
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
const representedEvidenceFiles = [
  relative(evidenceRoot, manifestPath).replaceAll("\\", "/"),
  manifest.fixtureAudit.fileName,
  ...[...captures.values()].map((capture) => capture.fileName),
  ...manifest.browserAudits.map((audit) => audit.fileName),
].sort();
assert.deepEqual(
  listEvidenceFiles(evidenceRoot).sort(),
  representedEvidenceFiles,
  "The evidence root contains an unrepresented artifact.",
);
assert.equal(
  representedEvidenceFiles.some((fileName) =>
    /(?:\.har|\.zip|\.trace|storage[-_.]?state|\.txt)$/iu.test(fileName),
  ),
  false,
  "The evidence root contains a trace, HAR, storage-state, or text sidecar.",
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
      stableBrowserOrigin: browserTransport.browserOrigin,
      immutableOriginRewriteRequests: browserTransport.requestCount,
      immutableOriginRewriteBodyHashes: browserTransport.bodyHashCount,
      immutableOriginRewriteMismatches: browserTransport.bodyHashMismatchCount,
      fullPageViewportKeys: contract.fullPageViewportKeys,
      sourceCommitSha: manifest.sourceCommitSha,
      sourceTreeSha: manifest.sourceTreeSha,
      liveDeploymentVerified,
      liveDeploymentRedirectResponseCount,
      verifierVercelBypassHeaderRequestCount,
      verifierChildSecretEnvScrubbed: true,
      verifierChildSecretEnvironmentVariableCount,
      verifierChildSecretValueObservationCount,
      productionAccess: manifest.productionAccess,
      productionWrites: manifest.productionWrites,
    },
    null,
    2,
  ),
);
