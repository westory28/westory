import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const loadTypeScriptModule = async (relativePath) => {
  const sourceUrl = new URL(`../${relativePath}`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourceUrl.pathname,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
  return { module: await import(moduleUrl), source };
};

const { module: stepUp, source: stepUpSource } = await loadTypeScriptModule(
  "src/lib/stepUpReauth.ts",
);
const [
  providerSource,
  authContextSource,
  firebaseSource,
  sessionSource,
  protectedGateSource,
  headerSource,
] = await Promise.all([
  readFile(
    new URL("../src/components/auth/StepUpReauthProvider.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/contexts/AuthContext.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/firebase.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/lib/applicationSession.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/auth/ProtectedAccessGate.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/components/common/Header.tsx", import.meta.url),
    "utf8",
  ),
]);

const {
  StepUpReauthError,
  createHighRiskCommandFlightKey,
  createHighRiskCommandLockName,
  createHighRiskCommandSingleFlightCoordinator,
  getStepUpReauthFailureMessage,
  registerStepUpReauthHandler,
  requestStepUpReauthentication,
  runHighRiskCommandSingleFlight,
} = stepUp;

assert.equal(
  createHighRiskCommandFlightKey("deleteStudentData", { b: 2, a: 1 }),
  createHighRiskCommandFlightKey("deleteStudentData", { a: 1, b: 2 }),
  "equivalent object payloads must share a flight key",
);
assert.notEqual(
  createHighRiskCommandFlightKey("deleteStudentData", { a: 1 }),
  createHighRiskCommandFlightKey("deleteStudentData", { a: 2 }),
  "different payloads must not share a flight key",
);
assert.notEqual(
  createHighRiskCommandFlightKey("deleteStudentData", { a: 1 }, "teacher-a"),
  createHighRiskCommandFlightKey("deleteStudentData", { a: 1 }, "teacher-b"),
  "different authenticated users must not share a flight key",
);
assert.match(
  createHighRiskCommandLockName(
    createHighRiskCommandFlightKey(
      "deleteStudentData",
      { uid: "sensitive-student-id" },
      "teacher-a",
    ),
  ),
  /^westory:high-risk:[0-9a-f]{16}$/,
  "the cross-tab lock name must not expose command payloads",
);

const heldLocks = new Set();
const mockLockManager = {
  request: async (name, options, callback) => {
    assert.deepEqual(options, { ifAvailable: true, mode: "exclusive" });
    if (heldLocks.has(name)) return callback(null);
    heldLocks.add(name);
    try {
      return await callback({ name });
    } finally {
      heldLocks.delete(name);
    }
  },
};
const tabA = createHighRiskCommandSingleFlightCoordinator(
  () => mockLockManager,
);
const tabB = createHighRiskCommandSingleFlightCoordinator(
  () => mockLockManager,
);
let releaseTabA;
const tabAGate = new Promise((resolve) => {
  releaseTabA = resolve;
});
let tabACommandCount = 0;
let tabBCommandCount = 0;
const tabARequest = tabA(
  "deleteStudentData",
  { uid: "two-tab-student" },
  async () => {
    tabACommandCount += 1;
    await tabAGate;
    return "tab-a-complete";
  },
  "teacher-a",
);
await Promise.resolve();
await assert.rejects(
  tabB(
    "deleteStudentData",
    { uid: "two-tab-student" },
    async () => {
      tabBCommandCount += 1;
      return "must-not-run";
    },
    "teacher-a",
  ),
  (error) => error.code === "IN_PROGRESS",
);
assert.equal(tabACommandCount, 1, "the lock-owning tab executes once");
assert.equal(tabBCommandCount, 0, "the competing tab executes no command");
releaseTabA();
assert.equal(await tabARequest, "tab-a-complete");

const unsupportedLocksCoordinator =
  createHighRiskCommandSingleFlightCoordinator(() => null);
let unsupportedLockCommandCount = 0;
const unsupportedRequests = Array.from({ length: 3 }, () =>
  unsupportedLocksCoordinator(
    "updateStudentData",
    { uid: "fallback-student" },
    async () => {
      unsupportedLockCommandCount += 1;
      return "fallback-complete";
    },
    "teacher-a",
  ),
);
await Promise.all(unsupportedRequests);
assert.equal(
  unsupportedLockCommandCount,
  1,
  "Web Locks unsupported environments retain tab-local single-flight",
);

let releaseSuccessfulCommand;
const successfulCommandGate = new Promise((resolve) => {
  releaseSuccessfulCommand = resolve;
});
let successfulCommandCount = 0;
const successfulRequests = Array.from({ length: 8 }, () =>
  runHighRiskCommandSingleFlight(
    "deleteStudentData",
    { uid: "student-1", reason: "duplicate-click" },
    async () => {
      successfulCommandCount += 1;
      await successfulCommandGate;
      return { deleted: true };
    },
  ),
);
assert.equal(
  successfulCommandCount,
  0,
  "execution starts after the flight is stored",
);
await Promise.resolve();
assert.equal(successfulCommandCount, 1, "rapid duplicate clicks execute once");
releaseSuccessfulCommand();
const successfulResults = await Promise.all(successfulRequests);
assert.ok(successfulResults.every((result) => result.deleted === true));

await runHighRiskCommandSingleFlight(
  "deleteStudentData",
  { uid: "student-1", reason: "duplicate-click" },
  async () => {
    successfulCommandCount += 1;
    return { deleted: true };
  },
);
assert.equal(
  successfulCommandCount,
  2,
  "a later explicit command is not permanently deduplicated",
);

let distinctCommandCount = 0;
await Promise.all([
  runHighRiskCommandSingleFlight(
    "updateStudentData",
    { uid: "a" },
    async () => {
      distinctCommandCount += 1;
    },
  ),
  runHighRiskCommandSingleFlight(
    "updateStudentData",
    { uid: "b" },
    async () => {
      distinctCommandCount += 1;
    },
  ),
]);
assert.equal(
  distinctCommandCount,
  2,
  "different payloads execute independently",
);

const networkError = Object.assign(new Error("offline"), {
  code: "auth/network-request-failed",
});
let failedFlightCount = 0;
let commandAfterReauthCount = 0;
const failSessionRefresh = async () => {
  throw new StepUpReauthError(
    "SESSION_REFRESH_FAILED",
    "로그인 세션을 갱신하지 못했습니다.",
  );
};
const failedRequests = Array.from({ length: 4 }, () =>
  runHighRiskCommandSingleFlight(
    "resetAssessmentAttemptsByClass",
    { grade: "2", className: "3" },
    async () => {
      failedFlightCount += 1;
      throw networkError;
    },
  ),
);
const failedResults = await Promise.allSettled(failedRequests);
assert.equal(
  failedFlightCount,
  1,
  "a shared failure must not duplicate execution",
);
assert.ok(failedResults.every((result) => result.status === "rejected"));

await assert.rejects(
  runHighRiskCommandSingleFlight(
    "resetQuizAttemptsForClass",
    { grade: "2", className: "3" },
    async () => {
      await failSessionRefresh();
      commandAfterReauthCount += 1;
    },
  ),
  (error) => error.code === "SESSION_REFRESH_FAILED",
);
assert.equal(
  commandAfterReauthCount,
  0,
  "session refresh failure executes no command",
);

for (const failure of [
  new StepUpReauthError("CANCELLED", "본인 확인을 취소했습니다."),
  Object.assign(new Error("wrong password"), {
    code: "auth/invalid-credential",
  }),
  networkError,
  new StepUpReauthError(
    "TOKEN_REFRESH_FAILED",
    "인증 정보를 갱신하지 못했습니다.",
  ),
]) {
  let protectedCommandCount = 0;
  const failReauthentication = async () => {
    throw failure;
  };
  await assert.rejects(
    runHighRiskCommandSingleFlight(
      "updateStudentData",
      { uid: `failure-${failure.code || "unknown"}` },
      async () => {
        await failReauthentication();
        protectedCommandCount += 1;
      },
    ),
  );
  assert.equal(
    protectedCommandCount,
    0,
    `${failure.code || failure.message} must execute no protected command`,
  );
}

assert.equal(
  getStepUpReauthFailureMessage(
    { code: "auth/invalid-credential" },
    "password",
  ),
  "비밀번호가 올바르지 않습니다.",
);
assert.match(
  getStepUpReauthFailureMessage(networkError, "password"),
  /네트워크 문제/,
);
assert.match(
  getStepUpReauthFailureMessage(
    { code: "auth/popup-closed-by-user" },
    "google",
  ),
  /취소되었습니다/,
);
assert.match(
  getStepUpReauthFailureMessage(
    new StepUpReauthError(
      "TOKEN_REFRESH_FAILED",
      "인증 정보를 갱신하지 못했습니다.",
    ),
    "password",
  ),
  /작업은 실행되지 않았습니다/,
);

await assert.rejects(
  requestStepUpReauthentication("deleteStudentData"),
  (error) => error.code === "UNAVAILABLE",
);
let handlerCallCount = 0;
let receivedOptions;
const unregister = registerStepUpReauthHandler(async (_command, options) => {
  handlerCallCount += 1;
  receivedOptions = options;
});
await requestStepUpReauthentication("deleteStudentData", { force: true });
assert.equal(handlerCallCount, 1);
assert.equal(receivedOptions.force, true);
unregister();

const continuityStart = authContextSource.indexOf(
  "resolvedUserRef.current?.uid === user.uid",
);
const destructiveAuthReset = authContextSource.indexOf(
  "const authRevision = authRevisionRef.current + 1",
);
assert.ok(continuityStart >= 0 && continuityStart < destructiveAuthReset);
const continuityBlock = authContextSource.slice(
  continuityStart,
  destructiveAuthReset,
);
assert.match(continuityBlock, /synchronizeApplicationSession/);
assert.match(continuityBlock, /subscribeUserDocument\(user, refreshRevision\)/);
const continuitySuccessBlock = continuityBlock.slice(
  0,
  continuityBlock.indexOf("} catch (error)"),
);
assert.doesNotMatch(continuitySuccessBlock, /clearAuthenticatedState\(\)/);
assert.doesNotMatch(
  continuityBlock,
  /setAuthenticationStatus\("AUTHENTICATING"\)/,
);

assert.ok(
  providerSource.indexOf("pendingRef.current = request") <
    providerSource.indexOf("setPending(request)"),
  "the pending request ref must close the same-tick race before rendering",
);
assert.match(providerSource, /submittingRef\.current/);
assert.match(providerSource, /expectedUid: current\.ownerUid/);
assert.match(providerSource, /setAttribute\("inert", ""\)/);
assert.match(providerSource, /aria-hidden=\{pending \? "true" : undefined\}/);
assert.match(providerSource, /bg-stone-950/);
assert.ok(
  providerSource.indexOf("beginApplicationSessionReauthentication()") <
    providerSource.indexOf("reauthenticateWithCredential(user, credential)"),
  "the server transition must be established before password reauthentication",
);
const passwordHandlerStart = providerSource.indexOf(
  "const handlePasswordReauth",
);
const googleHandlerStart = providerSource.indexOf("const handleGoogleReauth");
const passwordHandlerBlock = providerSource.slice(
  passwordHandlerStart,
  googleHandlerStart,
);
assert.doesNotMatch(passwordHandlerBlock, /disableNetwork\(db\)/);
assert.ok(
  providerSource.indexOf("prepareForReauthentication()") <
    providerSource.indexOf("reauthenticateWithCredential(user, credential)"),
  "protected reads must unmount before password reauthentication publishes a new auth epoch",
);
assert.match(
  providerSource,
  /prepareForReauthentication\(\);[\s\S]*?requestAnimationFrame[\s\S]*?reauthenticateWithCredential\(user, credential\)/,
  "protected reads must finish unmounting before password reauthentication publishes a new auth epoch",
);
assert.match(
  providerSource,
  /prepareForReauthentication\(\);[\s\S]*?reauthenticateWithPopup\(user, provider\)/,
  "protected reads must unmount before Google reauthentication publishes a new auth epoch",
);
assert.match(
  providerSource,
  /recoverAuthenticationAfterFailedReauthentication[\s\S]*?getIdToken\(user, true\)/,
  "failed or cancelled reauthentication must restore the current AuthContext resolution",
);
assert.ok(
  providerSource.indexOf("synchronizeApplicationSession(user") <
    providerSource.indexOf("current.resolve()"),
  "the new application session must be synchronized before the command resumes",
);
const synchronizeIndex = providerSource.indexOf(
  "session = await synchronizeApplicationSession(user",
);
const postSessionTokenRefreshIndex = providerSource.indexOf(
  "await getIdToken(user, true)",
  synchronizeIndex + 1,
);
const authenticatedUserWaitIndex = providerSource.indexOf(
  "await waitForAuthenticatedUser(current.ownerUid)",
  postSessionTokenRefreshIndex + 1,
);
assert.ok(
  synchronizeIndex >= 0 &&
    postSessionTokenRefreshIndex > synchronizeIndex &&
    authenticatedUserWaitIndex > postSessionTokenRefreshIndex,
  "protected reads must wait until the new session exists and its token is refreshed",
);
assert.ok(
  authenticatedUserWaitIndex > postSessionTokenRefreshIndex,
  "the business command must wait for AuthContext and the user document to recover",
);
assert.match(authContextSource, /getDocFromServer\(userRef\)/);
assert.ok(
  authContextSource.indexOf("await getDocFromServer(userRef)") <
    authContextSource.indexOf("unsubscribeUserDoc = onSnapshot"),
  "AuthContext must confirm the refreshed session with a server user read before reopening subscriptions",
);
assert.match(authContextSource, /stopUserDocSubscriptionRef\.current\(\)/);
assert.match(authContextSource, /window\.requestAnimationFrame/);
assert.match(
  providerSource,
  /pendingRef\.current = null;[\s\S]*current\.resolve\(\)/,
);

assert.match(firebaseSource, /runHighRiskCommandSingleFlight/);
assert.match(firebaseSource, /const invocationUid = auth\.currentUser\?\.uid/);
const guardedCallableStart = firebaseSource.indexOf("const guardedCallable");
const guardedStreamStart = firebaseSource.indexOf(
  "guardedCallable.stream",
  guardedCallableStart,
);
const guardedCallableBlock = firebaseSource.slice(
  guardedCallableStart,
  guardedStreamStart,
);
assert.ok(
  guardedCallableStart >= 0 && guardedStreamStart > guardedCallableStart,
);
assert.equal(
  [...guardedCallableBlock.matchAll(/invokeWithSession\(data\)/g)].length,
  1,
  "a high-risk callable must dispatch the business command exactly once",
);
assert.doesNotMatch(guardedCallableBlock, /force:\s*true/);
assert.doesNotMatch(guardedCallableBlock, /RECENT_AUTH_REQUIRED/);
assert.doesNotMatch(guardedCallableBlock, /SESSION_EXPIRED/);
assert.doesNotMatch(
  firebaseSource,
  /auth\/network-request-failed[\s\S]*invokeWithSession/,
);
assert.match(firebaseSource, /prepareCallableDataWithApplicationSession/);
assert.match(
  firebaseSource,
  /new ReCaptchaEnterpriseProvider\(appCheckSiteKey\)/,
);
assert.match(firebaseSource, /isTokenAutoRefreshEnabled: true/);
assert.match(firebaseSource, /isProtectedCloudRuntime && !appCheckSiteKey/);

assert.match(sessionSource, /openSessionFlights/);
assert.match(sessionSource, /expectedUid/);
assert.match(sessionSource, /activeSessionProof/);
assert.match(sessionSource, /APPLICATION_SESSION_PROTOCOL_VERSION = 2/);
assert.match(sessionSource, /ApplicationSessionAuthorityMode/);
assert.match(sessionSource, /subscribeApplicationSessionAuthorityMode/);
assert.match(authContextSource, /applicationSessionAuthorityMode === null/);
assert.match(
  protectedGateSource,
  /shouldEnforceClientIdleSession\(applicationSessionAuthorityMode\)/,
);
assert.match(protectedGateSource, /\? "AUTHENTICATING"/);
assert.match(
  headerSource,
  /if \(!sessionExpiry \|\| !currentUser \|\| !isSessionEnforced\)/,
);
assert.match(
  headerSource,
  /runtimeEnvironment === "staging" && isSessionEnforced/,
);
assert.match(headerSource, /serverSession\.authorityMode !== "ENFORCE"/);
assert.match(stepUpSource, /across devices and after ambiguous responses/);

console.log(
  "Step-up reauthentication checks: PASS (two-tab Web Lock executes once; competing/cancel/auth/token/session failures execute zero; high-risk business dispatch has no automatic retry; fallback and continuity guards present).",
);
