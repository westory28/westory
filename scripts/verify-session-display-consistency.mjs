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
import { MENUS } from './src/constants/menus';
const params = new URLSearchParams(location.search);
const listeners = new Set();
export const events = { toasts: [], logouts: [], touches: [], reauth: [], notificationLoads: 0, acknowledged: [] };
export const auth = { currentUser: { uid: 'synthetic-session-owner', email: 'session@example.invalid', providerData: [{ providerId: 'password' }] } };
export const db = {};
export const runtimeEnvironment = 'production';
let snapshot = {
  currentUser: auth.currentUser,
  userData: { uid: auth.currentUser.uid, name: '합성 사용자', role: params.get('role') === 'student' ? 'student' : 'teacher', fixtureAdmin: params.get('role') !== 'student' },
  authenticationStatus: 'AUTHENTICATED',
  applicationSessionAuthorityMode: params.get('mode') || 'OBSERVE_ONLY',
  config: { year: '2026', semester: '2' }, configReady: true,
  menuConfig: { teacher: MENUS.teacher, student: MENUS.student }, menuConfigReady: true,
  logout: async reason => { events.logouts.push(reason); },
  prepareForReauthentication: () => { throw new Error('Authentication submission is outside this display fixture'); },
};
export const useAuth = () => React.useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, () => snapshot);
export const setAuthority = mode => { snapshot = { ...snapshot, applicationSessionAuthorityMode: mode }; listeners.forEach(callback => callback()); };
const toast = { showToast: value => events.toasts.push(value) };
export const useAppToast = () => toast;
export const touchApplicationSession = async scope => { events.touches.push(scope); return { authorityMode: snapshot.applicationSessionAuthorityMode, generalExpiresAt: Date.now() + 60 * 60000, highRiskExpiresAt: Date.now() + 60 * 60000 }; };
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
export class W8DomainError extends Error {}
export const formatW8DateTime = value => value;
export const getW8DomainState = async () => {
  events.notificationLoads++;
  return { semesterId: 'synthetic-semester', manifestRevision: 1, readOnly: false,
    notices: [{ noticeId: 'fixture-notice', title: '합성 알림', content: '알림 표시 검증', publishAt: new Date().toISOString(), priority: 'NORMAL', revision: 1, acknowledged: events.acknowledged.includes('fixture-notice') }],
    deliveries: [{ noticeId: 'fixture-notice', targetUrl: '/teacher/lesson' }] };
};
export const acknowledgeNotice = async ({ noticeId }) => { events.acknowledged.push(noticeId); };
export const acknowledgeAllNotices = async ({ notices }) => { events.acknowledged.push(...notices.map(n => n.noticeId)); };
`;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import Header from './src/components/common/Header';
import { StepUpReauthProvider } from './src/components/auth/StepUpReauthProvider';
import { requestStepUpReauthentication } from './src/lib/stepUpReauth';
import { SESSION_EXPIRY_KEY, SESSION_LAST_ACTIVITY_KEY } from './src/lib/sessionPolicy';
import { removeStorage, writeLocalOnly } from './src/lib/safeStorage';
import { events, setAuthority } from 'session-display-fixture';
const params = new URLSearchParams(location.search);
removeStorage(SESSION_LAST_ACTIVITY_KEY);
writeLocalOnly(SESSION_EXPIRY_KEY, String(Date.now() + 60 * 60000));
function Harness() {
  const route = useLocation(); const navigate = useNavigate();
  const [, rerender] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => rerender(n => n + 1), 500); return () => clearInterval(id); }, []);
  React.useEffect(() => {
    window.sessionDisplayFixture = {
      ready: true, path: route.pathname, events, navigate, setAuthority,
      seedLegacy(minutes = 60) {
        removeStorage(SESSION_LAST_ACTIVITY_KEY);
        writeLocalOnly(SESSION_EXPIRY_KEY, String(Date.now() + minutes * 60000));
        window.dispatchEvent(new StorageEvent('storage', { key: SESSION_EXPIRY_KEY, newValue: localStorage.getItem(SESSION_EXPIRY_KEY) }));
      },
      request(command = 'unknownProtectedOperation') {
        void requestStepUpReauthentication(command).then(() => events.reauth.push('confirmed'), error => events.reauth.push(error.code));
      },
    };
  }, [route.pathname, navigate]);
  return <StepUpReauthProvider><Header /><main className="p-4" data-session-ignore="true"><h1>세션 표시 합성 검증</h1><p>운영 계정과 연결하지 않은 화면입니다.</p>
    <div className="flex flex-wrap gap-2 my-4">
      {['OBSERVE_ONLY', 'DISABLED', 'ENFORCE'].map(mode => <button className="border rounded px-3 py-2" key={mode} onClick={() => setAuthority(mode)}>{mode}</button>)}
      <button className="border rounded px-3 py-2" onClick={() => window.sessionDisplayFixture.seedLegacy(60)}>60분으로 초기화</button>
      <button className="border rounded px-3 py-2" onClick={() => window.sessionDisplayFixture.seedLegacy(4)}>4분 경고</button>
      <button className="border rounded px-3 py-2" onClick={() => window.sessionDisplayFixture.seedLegacy(-1)}>만료 검증</button>
      <button className="border rounded px-3 py-2" onClick={() => navigate('/teacher/settings')}>관리자 설정</button>
      <button className="border rounded px-3 py-2" onClick={() => navigate('/teacher/lesson')}>수업자료</button>
      <button className="border rounded px-3 py-2" onClick={() => window.sessionDisplayFixture.request('publishOfficialGrade')}>민감 작업 재인증</button>
    </div><output className="block break-all" aria-label="합성 검증 결과">{JSON.stringify(events)}</output>
    </main></StepUpReauthProvider>;
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
        api.onResolve({ filter: /\.css$/ }, () => ({
          path: "empty-css",
          namespace: "fixture-css",
        }));
        api.onLoad({ filter: /.*/, namespace: "fixture-css" }, () => ({
          contents: "",
          loader: "js",
        }));
        api.onResolve(
          {
            filter:
              /session-display-fixture$|AuthContext$|AppToastProvider$|\/firebase$|firebase\/(?:auth|firestore)$|\/applicationSession$|\/permissions$|\/pointRankPromotion$|\/pointRanks$|\/teacherRoutePreload$|\/w8Domains$/,
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
  "NotificationBell.tsx",
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
const css = [
  styles.css,
  "assets/css/style.css",
  "src/assets/index.css",
  "src/components/common/Header.css",
  "node_modules/@fortawesome/fontawesome-free/css/all.min.css",
]
  .map((value, index) =>
    index === 0 ? value : readFileSync(resolve(root, value), "utf8"),
  )
  .join("\n")
  .replaceAll("../webfonts/", "/fonts/")
  .replace(/^@import[^\r\n]+/gmu, "");
const server = createServer((request, response) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self';connect-src 'none';style-src 'self' 'unsafe-inline';font-src 'self';img-src 'self' data:;script-src 'self'",
  );
  if (/^\/fonts\/[a-z0-9-]+\.(?:woff2|ttf)$/i.test(pathname)) {
    response.setHeader(
      "Content-Type",
      pathname.endsWith("woff2") ? "font/woff2" : "font/ttf",
    );
    response.end(
      readFileSync(
        resolve(
          root,
          "node_modules/@fortawesome/fontawesome-free/webfonts",
          pathname.split("/").at(-1),
        ),
      ),
    );
    return;
  }
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
    const assertTimer = async (label, expectedMinutes = 60) => {
      const timer = page.locator('[title="세션 남은 시간"]');
      assert.equal(await timer.count(), 1, `${label}: exactly one timer`);
      assert.ok(
        await timer.isVisible(),
        `${label}: timer visible without opening a menu`,
      );
      assert.ok(
        await page
          .getByRole("button", { name: "접속 시간 60분으로 연장" })
          .isVisible(),
      );
      const [minutes, seconds] = (await timer.textContent())
        .split(":")
        .map(Number);
      assert.ok(
        minutes * 60 + seconds <= expectedMinutes * 60 &&
          minutes * 60 + seconds >= expectedMinutes * 60 - 10,
        `${label}: correct countdown`,
      );
      assert.equal(
        await page.locator(".ws-header-notification").count(),
        1,
        `${label}: one notification instance`,
      );
      assert.ok(
        await page.locator(".ws-header-notification > button").isVisible(),
        `${label}: bell visible`,
      );
      const layout = await page
        .locator(".header-container")
        .evaluate((node) => ({
          viewport: document.documentElement.clientWidth,
          overflow:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
          bounds: [
            ...node.querySelectorAll(
              ".ws-header-session, .ws-header-notification, .logo-text, .btn-logout, .desktop-nav, .header-user-link, .ws-header-settings, .mobile-menu-btn",
            ),
          ]
            .filter((element) => element.getBoundingClientRect().width > 0)
            .map((element) => {
              const box = element.getBoundingClientRect();
              return {
                name: element.className,
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
              };
            }),
        }));
      assert.equal(layout.overflow, false, `${label}: no horizontal overflow`);
      layout.bounds.forEach((box) =>
        assert.ok(
          box.left >= 0 && box.right <= layout.viewport + 1,
          `${label}: header control inside viewport`,
        ),
      );
      for (let index = 0; index < layout.bounds.length; index++) {
        for (const other of layout.bounds.slice(index + 1)) {
          const box = layout.bounds[index];
          assert.ok(
            Math.min(box.right, other.right) - Math.max(box.left, other.left) <=
              1 ||
              Math.min(box.bottom, other.bottom) -
                Math.max(box.top, other.top) <=
                1,
            `${label}: header controls overlap (${box.name}, ${other.name})`,
          );
        }
      }
    };
    let checks = 0;
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ["OBSERVE_ONLY", "DISABLED", "ENFORCE"]) {
        for (const [role, path] of [
          ["teacher", "/teacher/lesson"],
          ["teacher", "/teacher/settings"],
          ["student", "/student/dashboard"],
        ]) {
          await load(mode, role, path);
          await assertTimer(`${width}/${mode}/${role}/${path}`);
          await page.evaluate(() => window.sessionDisplayFixture.seedLegacy(4));
          await page.waitForFunction(
            () => window.sessionDisplayFixture.events.toasts.length > 0,
          );
          await assertTimer(`${width}/${mode}/${role}/warning`, 4);
          await page
            .getByRole("button", { name: "접속 시간 60분으로 연장" })
            .click();
          await settle();
          await assertTimer(`${width}/${mode}/${role}/extended`);
          assert.equal(
            await page.evaluate(
              () => window.sessionDisplayFixture.events.logouts.length,
            ),
            0,
          );
          const initialLoads = await page.evaluate(
            () => window.sessionDisplayFixture.events.notificationLoads,
          );
          if (width < 1024) {
            await page
              .getByRole("button", { name: "모바일 메뉴 열기" })
              .click();
            assert.ok(await page.locator(".ws-mobile-account").isVisible());
            await page
              .getByRole("button", { name: "모바일 메뉴 닫기" })
              .click();
          }
          assert.equal(
            await page.evaluate(
              () => window.sessionDisplayFixture.events.notificationLoads,
            ),
            initialLoads,
            "mobile navigation must not remount the bell",
          );
          await page.locator(".ws-header-notification > button").click();
          await page
            .getByRole("button", { name: "알림 닫기" })
            .waitFor({ state: "visible" });
          assert.ok(
            await page.getByText("합성 알림", { exact: true }).isVisible(),
          );
          assert.equal(
            await page.evaluate(
              () => window.sessionDisplayFixture.events.notificationLoads,
            ),
            initialLoads + 1,
            "opening the bell fetches current notifications exactly once",
          );
          if (role === "student") {
            await page
              .getByRole("button", { name: "모두 확인", exact: true })
              .click();
            await page.waitForFunction(() =>
              window.sessionDisplayFixture.events.acknowledged.includes(
                "fixture-notice",
              ),
            );
          } else {
            assert.equal(
              await page
                .getByRole("button", { name: "모두 확인", exact: true })
                .count(),
              0,
            );
            assert.equal(
              await page
                .locator(".ws-header-notification > button")
                .getAttribute("aria-label"),
              "알림",
            );
          }
          await page.getByRole("button", { name: "알림 닫기" }).click();
          await page.evaluate(() =>
            window.sessionDisplayFixture.seedLegacy(-1),
          );
          await page.waitForFunction(
            () => window.sessionDisplayFixture.events.logouts.length > 0,
          );
          assert.equal(
            await page.evaluate(
              () => window.sessionDisplayFixture.events.logouts[0],
            ),
            "expired",
          );
          const touchesBefore = await page.evaluate(
            () => window.sessionDisplayFixture.events.touches.length,
          );
          await page
            .getByRole("button", { name: "접속 시간 60분으로 연장" })
            .click();
          await settle();
          assert.equal(
            await page.evaluate(
              () => window.sessionDisplayFixture.events.touches.length,
            ),
            touchesBefore,
            "expired timer cannot be revived",
          );
          checks++;
        }
      }
      await load("OBSERVE_ONLY", "student", "/student/score");
      const studentSubmenu = page.locator(".ws-student-desktop-submenu");
      assert.equal(
        await studentSubmenu.locator("a").count(),
        4,
        "score submenu retains all four destinations",
      );
      assert.equal(
        await studentSubmenu.isVisible(),
        width >= 1024,
        `${width}: student desktop submenu visibility follows the original breakpoint`,
      );
      for (const link of await studentSubmenu.locator("a").all()) {
        assert.equal(
          await link.isVisible(),
          width >= 1024,
          `${width}: student score submenu links have correct visibility`,
        );
      }
      checks++;
      await load("ENFORCE");
      await page.evaluate(() => window.sessionDisplayFixture.seedLegacy(4));
      await page.evaluate(() =>
        window.sessionDisplayFixture.setAuthority("OBSERVE_ONLY"),
      );
      await settle();
      await assertTimer(`${width}/ENFORCE-to-OBSERVE_ONLY`, 4);
      await load("OBSERVE_ONLY");

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
      `Session display consistency: ${checks} real-browser checks passed (320/390/768/1024/1280/1440; real Header/bell/hooks/dialog; synthetic identity/I/O only).`,
    );
  } finally {
    await browser?.close();
    await new Promise((done) => server.close(done));
  }
}
