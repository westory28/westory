import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  plugins: [react()],
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  logLevel: "silent",
});

try {
  const [policy, storage, headerSource, gateSource, loginSource] =
    await Promise.all([
      server.ssrLoadModule("/src/lib/sessionPolicy.ts"),
      server.ssrLoadModule("/src/lib/safeStorage.ts"),
      readFile("src/components/common/Header.tsx", "utf8"),
      readFile("src/components/auth/ProtectedAccessGate.tsx", "utf8"),
      readFile("src/pages/Login.tsx", "utf8"),
    ]);

  const normal = policy.resolveSessionPolicy("/student/dashboard", false);
  const teacher = policy.resolveSessionPolicy("/teacher/dashboard", false);
  const adminNormal = policy.resolveSessionPolicy("/teacher/dashboard", true);
  const adminSettings = policy.resolveSessionPolicy("/teacher/settings", true);
  const nonAdminSettings = policy.resolveSessionPolicy(
    "/teacher/settings",
    false,
  );

  assert.equal(normal.durationMs, 60 * 60 * 1000);
  assert.equal(teacher.durationMs, 60 * 60 * 1000);
  assert.equal(adminNormal.durationMs, 60 * 60 * 1000);
  assert.equal(adminSettings.durationMs, 60 * 60 * 1000);
  assert.equal(nonAdminSettings.durationMs, 60 * 60 * 1000);
  assert.equal(normal.warningLeadMs, 5 * 60 * 1000);
  assert.equal(adminSettings.warningLeadMs, 5 * 60 * 1000);
  assert.equal(policy.shouldEnforceClientIdleSession("ENFORCE"), true);
  assert.equal(policy.shouldEnforceClientIdleSession("OBSERVE_ONLY"), true);
  assert.equal(policy.shouldEnforceClientIdleSession("DISABLED"), true);
  assert.equal(policy.shouldEnforceClientIdleSession(null), false);
  for (const mode of [undefined, "", "enforce", "UNKNOWN"]) {
    assert.equal(policy.shouldEnforceClientIdleSession(mode), false);
  }
  assert.equal(
    policy.resolveSessionPolicy("/teacher/settings/access", true).durationMs,
    60 * 60 * 1000,
  );
  assert.equal(
    policy.resolveSessionPolicy("/teacher/settings-old", true).durationMs,
    60 * 60 * 1000,
  );

  const now = 1_800_000_000_000;
  const lastActivityAt = now - 10 * 60 * 1000;
  assert.equal(
    policy.getSessionExpiryAt(lastActivityAt, normal),
    lastActivityAt + 60 * 60 * 1000,
  );
  assert.equal(
    policy.getSessionExpiryAt(lastActivityAt, adminSettings),
    lastActivityAt + 60 * 60 * 1000,
  );
  assert.equal(
    policy.shouldShowSessionWarning(now + 5 * 60 * 1000 + 1, normal, now),
    false,
  );
  assert.equal(
    policy.shouldShowSessionWarning(now + 5 * 60 * 1000, normal, now),
    true,
  );
  assert.equal(policy.shouldShowSessionWarning(now, normal, now), false);

  policy.clearSessionTiming();
  policy.writeSessionActivity(lastActivityAt, normal);
  assert.equal(policy.isStoredSessionExpired(normal, now), false);
  assert.equal(
    policy.isStoredSessionExpired(normal, lastActivityAt + normal.durationMs),
    true,
  );
  assert.equal(policy.isStoredSessionExpired(adminSettings, now), false);
  assert.equal(
    policy.isStoredSessionExpired(
      adminSettings,
      lastActivityAt + adminSettings.durationMs,
    ),
    true,
  );

  policy.clearSessionTiming();
  storage.writeLocalOnly(
    policy.SESSION_EXPIRY_KEY,
    String(now + 10 * 60 * 1000),
  );
  assert.equal(
    policy.readSessionLastActivity(),
    now - 50 * 60 * 1000,
    "legacy 60-minute expiry must be converted conservatively",
  );
  assert.equal(
    policy.isStoredSessionExpired(normal, now),
    false,
    "a legacy 60-minute session keeps its remaining ten minutes",
  );

  // Migration preserves the time of the last activity; opening a new route
  // must not turn the old 60-minute deadline into a fresh lease.
  policy.clearSessionTiming();
  storage.writeLocalOnly(
    policy.SESSION_EXPIRY_KEY,
    String(now + 50 * 60 * 1000),
  );
  const legacyActivity = policy.readSessionLastActivity();
  assert.equal(legacyActivity, lastActivityAt);
  assert.equal(
    policy.writeSessionActivity(legacyActivity, normal),
    now + 50 * 60 * 1000,
  );
  assert.equal(
    policy.writeSessionActivity(legacyActivity, adminSettings),
    now + 50 * 60 * 1000,
  );
  assert.equal(
    policy.writeSessionActivity(legacyActivity, normal),
    now + 50 * 60 * 1000,
  );
  assert.equal(policy.readSessionLastActivity(), legacyActivity);

  const serverDeadline = now + 12 * 60 * 1000;
  assert.equal(
    policy.writeSessionDeadline(serverDeadline, adminSettings),
    serverDeadline,
  );
  assert.equal(policy.readSessionExpiry(), serverDeadline);
  for (const invalid of [NaN, Infinity, 0, -1]) {
    assert.equal(policy.writeSessionDeadline(invalid, normal), null);
    assert.equal(policy.readSessionExpiry(), serverDeadline);
  }
  policy.clearSessionTiming();
  assert.equal(policy.readSessionExpiry(), null);
  assert.equal(policy.readSessionLastActivity(), null);

  for (const mode of ["OBSERVE_ONLY", "DISABLED"]) {
    policy.clearSessionTiming();
    assert.equal(
      policy.initializeClientSessionTiming(mode, now - 1, now),
      now + normal.durationMs,
      `${mode}: fresh client session starts at 60 minutes`,
    );
    assert.equal(
      policy.initializeClientSessionTiming(
        mode,
        now + normal.durationMs,
        now + 60000,
      ),
      now + normal.durationMs,
      `${mode}: auth refresh does not restart the idle timer`,
    );
    policy.writeSessionActivity(now - normal.durationMs, normal);
    assert.equal(
      policy.initializeClientSessionTiming(mode, now + normal.durationMs, now),
      now,
      `${mode}: expired local deadline cannot be revived by auth refresh`,
    );
    assert.equal(policy.isStoredSessionExpired(normal, now), true);
  }
  assert.equal(
    policy.initializeClientSessionTiming("ENFORCE", serverDeadline, now),
    serverDeadline,
    "ENFORCE retains the authoritative server deadline",
  );
  assert.equal(policy.initializeClientSessionTiming("ENFORCE", NaN, now), null);
  assert.equal(
    policy.initializeClientSessionTiming(null, serverDeadline, now),
    null,
  );

  assert.equal(
    policy.normalizeSessionReturnPath(
      "/student/quiz/run",
      "?unit=3&category=review",
    ),
    "/student/quiz/run?unit=3&category=review",
  );
  assert.equal(policy.normalizeSessionReturnPath("https://evil.example"), null);
  assert.equal(policy.normalizeSessionReturnPath("//evil.example"), null);
  assert.equal(policy.normalizeSessionReturnPath("/developer-log"), null);

  policy.clearSessionReturnPath();
  policy.writeSessionReturnPath(
    "student-a",
    "/student/quiz/run",
    "?unit=3",
    now,
  );
  assert.equal(policy.consumeSessionReturnPath("student-b", now), null);
  assert.equal(policy.consumeSessionReturnPath("student-a", now), null);
  policy.writeSessionReturnPath(
    "student-a",
    "/student/quiz/run",
    "?unit=3",
    now,
  );
  assert.equal(
    policy.consumeSessionReturnPath("student-a", now),
    "/student/quiz/run?unit=3",
  );
  assert.equal(policy.consumeSessionReturnPath("student-a", now), null);

  assert.match(headerSource, /document\.addEventListener\("input"/);
  assert.match(headerSource, /shouldShowSessionWarning/);
  assert.match(headerSource, /세션이 5분 뒤 만료됩니다/);
  assert.doesNotMatch(
    headerSource,
    /const SESSION_DURATION_SECONDS = 60 \* 60/,
  );
  assert.match(gateSource, /resolveSessionPolicy/);
  assert.match(gateSource, /writeSessionReturnPath/);
  assert.match(loginSource, /resolvePostLoginTarget/);
  assert.match(loginSource, /canAccessTeacherPath/);

  policy.clearSessionTiming();
  policy.clearSessionReturnPath();
  console.log(
    "Session policy checks passed (60m all roles / 5m warning / all authority modes). ",
  );
} finally {
  await server.close();
}
