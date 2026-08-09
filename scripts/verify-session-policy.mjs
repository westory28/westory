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
  const adminSettings = policy.resolveSessionPolicy(
    "/teacher/settings",
    true,
  );
  const nonAdminSettings = policy.resolveSessionPolicy(
    "/teacher/settings",
    false,
  );

  assert.equal(normal.durationMs, 30 * 60 * 1000);
  assert.equal(teacher.durationMs, 30 * 60 * 1000);
  assert.equal(adminNormal.durationMs, 30 * 60 * 1000);
  assert.equal(adminSettings.durationMs, 15 * 60 * 1000);
  assert.equal(nonAdminSettings.durationMs, 30 * 60 * 1000);
  assert.equal(normal.warningLeadMs, 5 * 60 * 1000);
  assert.equal(adminSettings.warningLeadMs, 5 * 60 * 1000);
  assert.equal(policy.shouldEnforceClientIdleSession("ENFORCE"), true);
  assert.equal(policy.shouldEnforceClientIdleSession("OBSERVE_ONLY"), false);
  assert.equal(policy.shouldEnforceClientIdleSession("DISABLED"), false);
  assert.equal(policy.shouldEnforceClientIdleSession(null), false);
  assert.equal(
    policy.resolveSessionPolicy("/teacher/settings-old", true).durationMs,
    30 * 60 * 1000,
  );

  const now = 1_800_000_000_000;
  const lastActivityAt = now - 10 * 60 * 1000;
  assert.equal(
    policy.getSessionExpiryAt(lastActivityAt, normal),
    lastActivityAt + 30 * 60 * 1000,
  );
  assert.equal(
    policy.getSessionExpiryAt(lastActivityAt, adminSettings),
    lastActivityAt + 15 * 60 * 1000,
  );
  assert.equal(
    policy.shouldShowSessionWarning(now + 5 * 60 * 1000 + 1, normal, now),
    false,
  );
  assert.equal(
    policy.shouldShowSessionWarning(now + 5 * 60 * 1000, normal, now),
    true,
  );
  assert.equal(
    policy.shouldShowSessionWarning(now, normal, now),
    false,
  );

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
    true,
    "a legacy session older than 30 minutes must not be revived",
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
  assert.doesNotMatch(headerSource, /const SESSION_DURATION_SECONDS = 60 \* 60/);
  assert.match(gateSource, /resolveSessionPolicy/);
  assert.match(gateSource, /writeSessionReturnPath/);
  assert.match(loginSource, /resolvePostLoginTarget/);
  assert.match(loginSource, /canAccessTeacherPath/);

  policy.clearSessionTiming();
  policy.clearSessionReturnPath();
  console.log("Session policy checks passed (30m / 15m / 5m). ");
} finally {
  await server.close();
}
