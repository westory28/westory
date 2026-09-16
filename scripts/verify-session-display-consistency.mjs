// Real React Header, viewport hook, session policy and step-up dialog. Only
// identity / server I/O and unrelated rank / notification data are synthetic.
// No credentials or production data are read. --serve-only exposes the same
// fixture for manual review without opening or changing an existing browser.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";

const root = process.cwd();
const require = createRequire(import.meta.url);
const mock = `
import React from 'react';
const params = new URLSearchParams(location.search);
const listeners = new Set();
export const events = { toasts: [], logouts: [], touches: [], reauth: [] };
export const auth = { currentUser: { uid: 'synthetic-session-owner', email: 'session@example.invalid', providerData: [{ providerId: 'password' }] } };
export const db = {};
export const runtimeEnvironment = 'production';
let snapshot = {
  currentUser: auth.currentUser,
  userData: { uid: auth.currentUser.uid, name: '합성 사용자', role: params.get('role') === 'student' ? 'student' : 'teacher', fixtureAdmin: params.get('role') !== 'student' },
  authenticationStatus: 'AUTHENTICATED',
  applicationSessionAuthorityMode: params.get('mode') || 'OBSERVE_ONLY',
  config: { year: '2026', semester: '2' }, configReady: true,
  menuConfig: { teacher: [], student: [] }, menuConfigReady: true,
  logout: async reason => { events.logouts.push(reason); },
  prepareForReauthentication: () => { throw new Error('Authentication submission is outside this display fixture'); },
};
export const useAuth = () => React.useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => snapshot);
export const setAuthority = mode => { snapshot = { ...snapshot, applicationSessionAuthorityMode: mode }; listeners.forEach(callback => callback()); };
const toast = { showToast: value => events.toasts.push(value) };
export const useAppToast = () => toast;
export const touchApplicationSession = async scope => { events.touches.push(scope); return { authorityMode: snapshot.applicationSessionAuthorityMode, generalExpiresAt: Date.now() + 30 * 60000, highRiskExpiresAt: Date.now() + 15 * 60000 }; };
const forbidden = () => { throw new Error('Server I/O is forbidden in this fixture'); };
export const beginApplicationSessionReauthentication = forbidden;
export const synchronizeApplicationSession = forbidden;
export const getIdTokenResult = async () => ({ authTime: new Date(Date.now() - 6 * 60000).toISOString() });
export const getIdToken = forbidden;
export const EmailAuthProvider = { credential: forbidden };
export const GoogleAuthProvider = class {};
export const reauthenticateWithCredential = forbidden;
export const reauthenticateWithPopup = forbidden;
export const disableNetwork = forbidden;
export const enableNetwork = async () => {};
export const canManageSettings = data => Boolean(data?.fixtureAdmin);
export const canAccessTeacherPortal = data => data?.role === 'teacher';
export const canAccessTeacherPath = () => true;
export const getDefaultTeacherRoute = () => '/teacher/dashboard';
export const preloadTeacherRouteCode = () => {};
export const loadStudentRankPromotionSnapshot = async () => ({ rank: null, policy: {} });
export const invalidateStudentRankPromotionSnapshotCache = () => {};
export const getPointRankDefaultEmojiValue = () => '🙂';
export default function NotificationBell() { return null; }
`;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import Header from './src/components/common/Header';
import { StepUpReauthProvider } from './src/components/auth/StepUpReauthProvider';
import { requestStepUpReauthentication } from './src/lib/stepUpReauth';
import { SESSION_EXPIRY_KEY, SESSION_LAST_ACTIVITY_KEY } from './src/lib/sessionPolicy';
import { events, setAuthority } from 'session-display-fixture';
const params = new URLSearchParams(location.search);
localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + 60 * 60000));
function Harness() {
  const route = useLocation(); const navigate = useNavigate();
  React.useEffect(() => {
    window.sessionDisplayFixture = {
      ready: true, path: route.pathname, events, navigate, setAuthority,
      seedLegacy(minutes = 60) {
        localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
        localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + minutes * 60000));
        window.dispatchEvent(new StorageEvent('storage', { key: SESSION_EXPIRY_KEY, newValue: localStorage.getItem(SESSION_EXPIRY_KEY) }));
      },
      request(command = 'unknownProtectedOperation') {
        void requestStepUpReauthentication(command).then(() => events.reauth.push('confirmed'), error => events.reauth.push(error.code));
      },
    };
  }, [route.pathname, navigate]);
  return <StepUpReauthProvider><Header /><main className="p-4"><h1>세션 표시 합성 검증</h1><p>운영 계정과 연결하지 않은 화면입니다.</p></main></StepUpReauthProvider>;
}
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[params.get('path') || '/teacher/lesson']}><Harness /></MemoryRouter>);
`;

const bundled = await build({
  stdin: { contents: entry, resolveDir: root, loader: "tsx" },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  metafile: true,
  define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" },
  plugins: [
    {
      name: "isolated-session-display",
      setup(api) {
        api.onResolve(
          {
            filter:
              /session-display-fixture$|AuthContext$|AppToastProvider$|\/firebase$|firebase\/(?:auth|firestore)$|\/applicationSession$|\/permissions$|\/pointRankPromotion$|\/pointRanks$|\/teacherRoutePreload$|\/NotificationBell$/,
          },
          () => ({ path: "synthetic-session-data", namespace: "fixture" }),
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: mock,
          loader: "tsx",
          resolveDir: root,
        }));
      },
    },
  ],
});
const inputs = Object.keys(bundled.metafile.inputs).map((path) =>
  path.replaceAll("\\", "/"),
);
for (const actual of [
  "Header.tsx",
  "useShellViewport.ts",
  "sessionPolicy.ts",
  "safeStorage.ts",
  "sessionActivity.ts",
  "StepUpReauthProvider.tsx",
  "stepUpReauth.ts",
]) {
  assert.ok(
    inputs.some((path) => path.endsWith(`/${actual}`)),
    `Actual source missing: ${actual}`,
  );
}
assert.ok(
  !inputs.some((path) => /node_modules\/(?:@firebase|firebase)\//u.test(path)),
  "Firebase SDK must not enter the fixture",
);

const styles = await postcss([
  tailwindcss(require(resolve(root, "tailwind.config.cjs"))),
]).process(
  readFileSync(resolve(root, "src/assets/tailwind.css"), "utf8").replace(
    /^@import[^\r\n]+/gmu,
    "",
  ),
  { from: resolve(root, "src/assets/tailwind.css") },
);
const css = [styles.css, "assets/css/style.css", "src/assets/index.css"]
  .map((value, index) =>
    index === 0 ? value : readFileSync(resolve(root, value), "utf8"),
  )
  .join("\n")
  .replace(/^@import[^\r\n]+/gmu, "");
const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'none';img-src 'self' data:;script-src 'self'",
  );
  response.setHeader(
    "Content-Type",
    pathname === "/app.js"
      ? "text/javascript"
      : pathname === "/app.css"
        ? "text/css"
        : "text/html; charset=utf-8",
  );
  response.end(
    pathname === "/app.js"
      ? bundled.outputFiles[0].contents
      : pathname === "/app.css"
        ? css
        : '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Westory 세션 표시 합성 검증</title><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>',
  );
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

if (process.argv.includes("--serve-only")) {
  console.log(
    JSON.stringify({
      url: baseUrl,
      syntheticOnly: true,
      firebaseIncluded: false,
      parameters: {
        mode: ["OBSERVE_ONLY", "DISABLED", "ENFORCE"],
        role: ["teacher", "student"],
        path: ["/teacher/lesson", "/student/dashboard", "/teacher/settings"],
      },
      dialog: "sessionDisplayFixture.request('publishOfficialGrade')",
    }),
  );
} else {
  let browser;
  try {
    const { chromium } = await import("playwright-core");
    const executablePath = [
      process.env.WESTORY_PLAYWRIGHT_EXECUTABLE,
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    ].find((path) => path && existsSync(path));
    browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });
    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      reducedMotion: "reduce",
    });
    const unexpectedRequests = [];
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith(baseUrl)) return route.continue();
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const settle = () =>
      page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    const load = async (mode, role = "teacher", path = "/teacher/lesson") => {
      await page.goto(
        `${baseUrl}?${new URLSearchParams({ mode, role, path })}`,
      );
      await page.waitForFunction(() => window.sessionDisplayFixture?.ready);
      await settle();
    };
    const noTimer = async (label) => {
      assert.equal(
        await page
          .locator(
            '[title="시간 연장"], .mobile-menu-time-card, [title$="세션 남은 시간"]',
          )
          .count(),
        0,
        `${label}: neither desktop nor mobile timer may mount`,
      );
      const events = await page.evaluate(
        () => window.sessionDisplayFixture.events,
      );
      assert.equal(events.logouts.length, 0, `${label}: no idle logout`);
      assert.equal(events.toasts.length, 0, `${label}: no idle warning`);
    };
    let checks = 0;
    for (const width of [390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ["OBSERVE_ONLY", "DISABLED"]) {
        await load(mode);
        for (const path of [
          "/teacher/lesson",
          "/student/dashboard",
          "/teacher/settings",
          "/teacher/lesson",
        ]) {
          await page.evaluate(
            (path) => window.sessionDisplayFixture.navigate(path),
            path,
          );
          await page.waitForFunction(
            (path) => window.sessionDisplayFixture.path === path,
            path,
          );
          await settle();
          assert.deepEqual(
            await page.evaluate(() => [
              localStorage.getItem("sessionExpiry"),
              localStorage.getItem("westorySessionLastActivity"),
            ]),
            [null, null],
            `${mode}/${path}: legacy timing cleared on mount/route change`,
          );
          if (width < 1024)
            await page
              .getByRole("button", { name: "모바일 메뉴 열기" })
              .click();
          await noTimer(`${width}/${mode}/${path}`);
          // Even another old tab writing a 60-minute value (or an already
          // expired deadline) cannot revive the timer in these authority modes.
          for (const minutes of [60, -1]) {
            await page.evaluate(
              (minutes) => window.sessionDisplayFixture.seedLegacy(minutes),
              minutes,
            );
            await settle();
            await noTimer(`${width}/${mode}/${path}/legacy-${minutes}`);
          }
          if (width < 1024)
            await page
              .getByRole("button", { name: "모바일 메뉴 닫기" })
              .click();
          checks++;
        }
        await load(mode, "student", "/student/dashboard");
        if (width < 1024)
          await page.getByRole("button", { name: "모바일 메뉴 열기" }).click();
        await noTimer(`${width}/${mode}/student`);
        checks++;
      }

      // Positive controls: an ENFORCE deployment still renders the real
      // 30-minute/general and 15-minute/admin policy, proving absence above
      // was caused by authority policy rather than a broken fixture.
      await load("ENFORCE");
      for (const [path, minutes] of [
        ["/teacher/lesson", 30],
        ["/teacher/settings", 15],
      ]) {
        await page.evaluate(
          (path) => window.sessionDisplayFixture.navigate(path),
          path,
        );
        await page.waitForFunction(
          (path) => window.sessionDisplayFixture.path === path,
          path,
        );
        await settle();
        if (width < 1024)
          await page.getByRole("button", { name: "모바일 메뉴 열기" }).click();
        const timer =
          width < 1024
            ? page.locator(".mobile-menu-time-card strong")
            : page.locator('[title$="세션 남은 시간"]');
        assert.equal(
          await timer.count(),
          1,
          `${width}/${path}: enforced timer mounted`,
        );
        // Legacy style.css has a later .hidden rule overriding lg:flex. The
        // desktop positive control checks mounting/value, not that unrelated
        // pre-existing style issue. The opened mobile timer must be visible.
        if (width < 1024)
          assert.ok(
            await timer.isVisible(),
            `${width}/${path}: enforced mobile timer visible`,
          );
        const value = await timer.textContent();
        const [mm, ss] = value.split(":").map(Number);
        assert.ok(
          mm * 60 + ss <= minutes * 60 && mm * 60 + ss >= minutes * 60 - 10,
          `${width}/${path}: ${value} must reflect ${minutes}m policy`,
        );
        if (width < 1024)
          await page.getByRole("button", { name: "모바일 메뉴 닫기" }).click();
        checks++;
      }
      await page.evaluate(() =>
        window.sessionDisplayFixture.setAuthority("OBSERVE_ONLY"),
      );
      await settle();
      await noTimer(`${width}/ENFORCE-to-OBSERVE_ONLY`);
      assert.deepEqual(
        await page.evaluate(() => [
          localStorage.getItem("sessionExpiry"),
          localStorage.getItem("westorySessionLastActivity"),
        ]),
        [null, null],
      );
      checks++;

      for (const [command, label] of [
        ["unknownProtectedOperation", "보호된 운영 작업"],
        ["publishOfficialGrade", "공식 성적 공개"],
        ["importEnrollmentRoster", "학생 명단 일괄 등록"],
        ["adjustWis", "위스 잔액 조정"],
        ["updateAccessSettings", "사용자 접근 권한 변경"],
      ]) {
        await page.evaluate(
          (command) => window.sessionDisplayFixture.request(command),
          command,
        );
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ state: "visible" });
        const text = await dialog.textContent();
        assert.ok(text.includes("현재 로그인되어 있습니다."));
        assert.ok(text.includes(`확인할 작업: ${label}.`));
        assert.match(
          text.replace(/\s+/gu, " "),
          /중요한 작업에 한해 5분 동안 유효하며, 로그인 유지 시간과는 별개입니다/,
        );
        assert.doesNotMatch(text, /작업 작업|다시 로그인해 주세요/);
        assert.equal(
          await dialog.evaluate((node) => node.scrollWidth > node.clientWidth),
          false,
          `${width}: no dialog horizontal overflow`,
        );
        const bounds = await dialog.locator("section").boundingBox();
        assert.ok(
          bounds.x >= 0 && bounds.x + bounds.width <= width + 1,
          `${width}: dialog content stays in viewport`,
        );
        if (
          process.env.WESTORY_SESSION_DISPLAY_SCREENSHOTS &&
          command === "unknownProtectedOperation"
        ) {
          const output = resolve(
            process.env.WESTORY_SESSION_DISPLAY_SCREENSHOTS,
          );
          mkdirSync(output, { recursive: true });
          await page.screenshot({
            path: resolve(output, `session-reauth-${width}.png`),
          });
        }
        await dialog.getByRole("button", { name: "취소", exact: true }).click();
        await dialog.waitFor({ state: "hidden" });
        assert.equal(
          await page.evaluate(() =>
            window.sessionDisplayFixture.events.reauth.at(-1),
          ),
          "CANCELLED",
        );
        checks++;
      }
    }
    assert.deepEqual(
      unexpectedRequests,
      [],
      "Fixture must not request any external origin",
    );
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log(
      `Session display consistency: ${checks} real-browser checks passed (390/768/1280; real Header/hooks/dialog; synthetic identity/I/O only).`,
    );
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}
