/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  throw new Error(
    "Playwright를 찾지 못했습니다. 일회성 검증 런타임의 node_modules를 NODE_PATH에 지정해 주세요.",
    { cause: error },
  );
}

const baseUrl = String(process.env.WESTORY_STAGING_URL || "").replace(
  /\/$/,
  "",
);
const admin = {
  email: process.env.WESTORY_ADMIN_EMAIL || "",
  password: process.env.WESTORY_ADMIN_PASSWORD || "",
};
const negative = {
  email: process.env.WESTORY_NEGATIVE_EMAIL || "",
  password: process.env.WESTORY_NEGATIVE_PASSWORD || "",
};
const outputDir = path.resolve(
  process.env.WESTORY_W1R3_EVIDENCE_DIR ||
    "docs/evidence/w1r3-access-viewports",
);
const browserExecutable = process.env.WESTORY_PLAYWRIGHT_EXECUTABLE || "";
const interactiveVercelAuth =
  process.env.WESTORY_VERCEL_INTERACTIVE_AUTH === "true";
let vercelProtectionState;

if (
  !baseUrl ||
  !admin.email ||
  !admin.password ||
  !negative.email ||
  !negative.password
) {
  throw new Error(
    "WESTORY_STAGING_URL과 합성 admin/permission-negative 자격 증명 환경변수가 필요합니다.",
  );
}

const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];

fs.mkdirSync(outputDir, { recursive: true });

const deferred = () => {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const viewportKey = ({ width, height }) => `${width}x${height}`;
const screenshotPath = (name, viewport) =>
  path.join(outputDir, `${name}-${viewportKey(viewport)}.png`);

const attachDiagnostics = (page) => {
  const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on("console", (message) => {
    if (message.type() === "error")
      diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "request failed";
    diagnostics.failedRequests.push({ url: request.url(), failure });
  });
  return diagnostics;
};

const createContext = async (browser, viewport, options = {}) => {
  const context = await browser.newContext({
    viewport,
    screen: viewport,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    colorScheme: "light",
    reducedMotion: "reduce",
    ...(vercelProtectionState ? { storageState: vercelProtectionState } : {}),
  });
  if (options.clockOffsetMs) {
    await context.addInitScript((offsetMs) => {
      const actualNow = Date.now.bind(Date);
      Date.now = () => actualNow() + offsetMs;
    }, options.clockOffsetMs);
  }
  return context;
};

const establishVercelProtectionSession = async (browser) => {
  if (!interactiveVercelAuth) return;
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    screen: { width: 1280, height: 800 },
    locale: "ko-KR",
  });
  const page = await context.newPage();
  console.log(
    "Vercel 보호 로그인 창을 열었습니다. Westory Owner 계정으로 로그인해 주세요.",
  );
  try {
    await page.goto(`${baseUrl}/#/`, { waitUntil: "domcontentloaded" });
    await page
      .locator('form[aria-label="스테이징 합성 계정 로그인"]')
      .waitFor({ state: "visible", timeout: 10 * 60 * 1000 });
    vercelProtectionState = await context.storageState();
    console.log("Vercel 보호 로그인 확인: PASS");
  } finally {
    await context.close();
  }
};

const login = async (page, account) => {
  await page.goto(`${baseUrl}/#/`, { waitUntil: "domcontentloaded" });
  const form = page.locator('form[aria-label="스테이징 합성 계정 로그인"]');
  await form.waitFor({ state: "visible", timeout: 30_000 });
  await form.locator('input[type="email"]').fill(account.email);
  await form.locator('input[type="password"]').fill(account.password);
  await form.getByRole("button", { name: "합성 계정으로 로그인" }).click();
  await page.waitForFunction(
    () =>
      window.location.hash.startsWith("#/teacher/") ||
      window.location.hash.startsWith("#/student/"),
    undefined,
    { timeout: 30_000 },
  );
  await page
    .waitForLoadState("networkidle", { timeout: 30_000 })
    .catch(() => undefined);
};

const measure = async (page, state) =>
  page.evaluate((currentState) => {
    const root = document.documentElement;
    const settingsContent = document.querySelector(
      "main > aside + div.min-w-0.flex-1",
    );
    const settingsMain = settingsContent?.parentElement || null;
    const aside = settingsMain?.querySelector(":scope > aside") || null;
    const localScrollRegion =
      settingsContent?.querySelector(".overflow-x-auto") || null;
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    const overlay = dialog?.parentElement || null;
    const protectedContent = document.querySelector(
      '[aria-hidden="true"][inert]',
    );
    const primaryAction =
      dialog?.querySelector('button[type="submit"], button:not([type])') ||
      document.querySelector("main a[href], main button:not([disabled])");
    const activeElement = document.activeElement;
    const heading = document.querySelector("h1, h2");
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const withinViewport = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return (
        value.left >= -0.5 &&
        value.top >= -0.5 &&
        value.right <= window.innerWidth + 0.5 &&
        value.bottom <= window.innerHeight + 0.5
      );
    };
    const asideRect = aside?.getBoundingClientRect();
    const contentRect = settingsContent?.getBoundingClientRect();
    const overlayStyle = overlay ? getComputedStyle(overlay) : null;
    const overlayOpaque = overlayStyle
      ? overlayStyle.backgroundColor.startsWith("rgb(") &&
        !overlayStyle.backgroundColor.startsWith("rgba(")
      : null;

    return {
      state: currentState,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentClientWidth: root.clientWidth,
      documentScrollWidth: root.scrollWidth,
      pageOverflowPass: root.scrollWidth <= root.clientWidth,
      settingsContentClientWidth: settingsContent?.clientWidth ?? null,
      settingsContentScrollWidth: settingsContent?.scrollWidth ?? null,
      settingsContentOverflowPass: settingsContent
        ? settingsContent.scrollWidth <= settingsContent.clientWidth
        : null,
      localScrollClientWidth: localScrollRegion?.clientWidth ?? null,
      localScrollWidth: localScrollRegion?.scrollWidth ?? null,
      sidebarContentOverlap:
        asideRect && contentRect
          ? asideRect.right > contentRect.left + 0.5
          : null,
      headingText: heading?.textContent?.trim() || "",
      headingRect: rect(heading),
      headingWithinViewport: withinViewport(heading),
      dialogRect: rect(dialog),
      dialogWithinViewport: withinViewport(dialog),
      primaryActionText: primaryAction?.textContent?.trim() || "",
      primaryActionRect: rect(primaryAction),
      primaryActionWithinViewport: withinViewport(primaryAction),
      focusTag: activeElement?.tagName || "",
      focusText:
        activeElement?.getAttribute?.("aria-label") ||
        activeElement?.textContent?.trim() ||
        "",
      focusInsideDialog: dialog ? dialog.contains(activeElement) : null,
      protectedContentHiddenAndInert: dialog
        ? Boolean(protectedContent && overlayOpaque)
        : null,
    };
  }, state);

const capture = async (page, state, viewport, filename) => {
  await page.screenshot({
    path: screenshotPath(filename, viewport),
    fullPage: false,
  });
  return measure(page, state);
};

const openMobileMenuIfNeeded = async (page) => {
  const expiryButton = page.getByRole("button", {
    name: "세션 만료 테스트",
    exact: true,
  });
  if (
    await expiryButton
      .first()
      .isVisible()
      .catch(() => false)
  )
    return;
  await page.getByRole("button", { name: "모바일 메뉴 열기" }).click();
  await expiryButton.filter({ visible: true }).waitFor({ state: "visible" });
};

const verifyAdminSettings = async (browser, viewport) => {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await login(page, admin);
    await page.goto(`${baseUrl}/#/teacher/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "관리자 설정" }).waitFor();
    await page.getByRole("button", { name: /세부 권한 관리/ }).click();
    await page.locator("main > aside + div.min-w-0.flex-1").waitFor();
    await page.waitForTimeout(500);
    const result = await capture(
      page,
      "ADMIN_SETTINGS",
      viewport,
      "admin-settings",
    );
    const saveOrAction = page
      .locator("main > aside + div.min-w-0.flex-1 button")
      .last();
    await saveOrAction.scrollIntoViewIfNeeded().catch(() => undefined);
    result.lastActionReachable = await saveOrAction
      .isVisible()
      .catch(() => false);
    return { ...result, diagnostics };
  } finally {
    await context.close();
  }
};

const verifyAuthenticating = async (browser, viewport) => {
  const context = await createContext(browser, viewport);
  const setup = await context.newPage();
  await login(setup, admin);
  await setup.close();
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  const gate = deferred();
  await page.route(/openApplicationSession/i, async (route) => {
    await gate.promise;
    await route.continue();
  });
  try {
    void page.goto(`${baseUrl}/#/teacher/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { name: "인증 상태를 확인하는 중입니다." })
      .waitFor({ timeout: 30_000 });
    const result = await capture(
      page,
      "AUTHENTICATING",
      viewport,
      "access-authenticating",
    );
    result.protectedHeadingVisible = await page
      .getByRole("heading", { name: "관리자 설정" })
      .isVisible()
      .catch(() => false);
    return { ...result, diagnostics };
  } finally {
    gate.resolve();
    await context.close();
  }
};

const verifyUnauthorized = async (browser, viewport) => {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await login(page, negative);
    await page.goto(`${baseUrl}/#/teacher/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("heading", { name: "접근 권한이 없습니다." })
      .waitFor({ timeout: 30_000 });
    const action = page.getByRole("link", { name: "허용된 화면으로 이동" });
    await action.focus();
    const result = await capture(
      page,
      "UNAUTHORIZED",
      viewport,
      "access-unauthorized",
    );
    result.protectedHeadingVisible = await page
      .getByRole("heading", { name: "관리자 설정" })
      .isVisible()
      .catch(() => false);
    return { ...result, diagnostics };
  } finally {
    await context.close();
  }
};

const verifySessionExpired = async (browser, viewport) => {
  const context = await createContext(browser, viewport);
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  try {
    await login(page, admin);
    await page.goto(`${baseUrl}/#/teacher/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "관리자 설정" }).waitFor();
    await openMobileMenuIfNeeded(page);
    await page
      .getByRole("button", { name: "세션 만료 테스트", exact: true })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("heading", { name: "세션이 만료되었습니다." })
      .waitFor({ timeout: 30_000 });
    const action = page.getByRole("link", { name: "다시 로그인" });
    await action.focus();
    const result = await capture(
      page,
      "SESSION_EXPIRED",
      viewport,
      "access-session-expired",
    );
    result.protectedHeadingVisible = await page
      .getByRole("heading", { name: "관리자 설정" })
      .isVisible()
      .catch(() => false);
    return { ...result, diagnostics };
  } finally {
    await context.close();
  }
};

const verifyReauthFlow = async (browser, viewport) => {
  const context = await createContext(browser, viewport, {
    clockOffsetMs: 6 * 60 * 1000,
  });
  const page = await context.newPage();
  const diagnostics = attachDiagnostics(page);
  const identityGate = deferred();
  const sessionGate = deferred();
  const identitySeen = deferred();
  const sessionSeen = deferred();
  let holdIdentity = false;
  let holdSessionRefresh = false;

  await page.route(/accounts:signInWithPassword/i, async (route) => {
    if (!holdIdentity) return route.continue();
    identitySeen.resolve();
    await identityGate.promise;
    await route.continue();
  });
  await page.route(/openApplicationSession/i, async (route) => {
    if (!holdSessionRefresh) return route.continue();
    sessionSeen.resolve();
    await sessionGate.promise;
    await route.continue();
  });

  try {
    await login(page, admin);
    await page.goto(`${baseUrl}/#/teacher/settings`, {
      waitUntil: "domcontentloaded",
    });
    await page.getByRole("heading", { name: "관리자 설정" }).waitFor();
    const saveButton = page.getByRole("button", {
      name: "설정 저장",
      exact: true,
    });
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    const dialog = page.getByRole("dialog", { name: "본인 확인이 필요합니다" });
    await dialog.waitFor({ timeout: 15_000 });
    await dialog.getByLabel("현재 비밀번호").fill(admin.password);

    holdIdentity = true;
    holdSessionRefresh = true;
    await dialog.getByRole("button", { name: "비밀번호로 확인" }).click();
    await identitySeen.promise;
    await dialog.getByRole("button", { name: "확인 중…" }).waitFor();
    const reauthenticating = await capture(
      page,
      "REAUTHENTICATING",
      viewport,
      "access-reauthenticating",
    );

    identityGate.resolve();
    await sessionSeen.promise;
    const sessionRefreshing = await capture(
      page,
      "SESSION_REFRESHING",
      viewport,
      "access-session-refreshing",
    );

    sessionGate.resolve();
    await dialog.waitFor({ state: "detached", timeout: 30_000 });
    await page.getByRole("heading", { name: "관리자 설정" }).waitFor();
    await page.waitForTimeout(500);
    const authorized = await capture(
      page,
      "AUTHORIZED_RECOVERY",
      viewport,
      "access-authorized-recovery",
    );
    authorized.protectedHeadingVisible = true;

    return {
      reauthenticating,
      sessionRefreshing,
      authorized,
      diagnostics,
    };
  } finally {
    identityGate.resolve();
    sessionGate.resolve();
    await context.close();
  }
};

const assertEvidence = (evidence) => {
  const failures = [];
  for (const [key, item] of Object.entries(evidence.adminSettings)) {
    if (item.innerWidth !== Number(key.split("x")[0]))
      failures.push(`${key}: innerWidth`);
    if (item.innerHeight !== Number(key.split("x")[1]))
      failures.push(`${key}: innerHeight`);
    if (!item.pageOverflowPass) failures.push(`${key}: page overflow`);
    if (!item.settingsContentOverflowPass)
      failures.push(`${key}: settings content overflow`);
    if (item.sidebarContentOverlap) failures.push(`${key}: sidebar overlap`);
    if (!item.lastActionReachable) failures.push(`${key}: action unreachable`);
    if (
      item.diagnostics.consoleErrors.length ||
      item.diagnostics.pageErrors.length
    ) {
      failures.push(`${key}: browser error`);
    }
  }
  for (const [state, byViewport] of Object.entries(evidence.accessStates)) {
    for (const [key, item] of Object.entries(byViewport)) {
      const items =
        state === "REAUTH_FLOW"
          ? [item.reauthenticating, item.sessionRefreshing, item.authorized]
          : [item];
      for (const value of items) {
        if (!value.pageOverflowPass)
          failures.push(`${state}/${key}: page overflow`);
        if (value.dialogWithinViewport === false)
          failures.push(`${state}/${key}: dialog clipped`);
        if (value.headingWithinViewport === false)
          failures.push(`${state}/${key}: heading clipped`);
        if (value.primaryActionWithinViewport === false)
          failures.push(`${state}/${key}: action clipped`);
        if (value.focusInsideDialog === false)
          failures.push(`${state}/${key}: dialog focus escaped`);
        if (value.protectedContentHiddenAndInert === false)
          failures.push(`${state}/${key}: background exposed`);
      }
      if (state !== "REAUTH_FLOW" && item.protectedHeadingVisible) {
        failures.push(`${state}/${key}: protected heading visible`);
      }
      if (
        item.diagnostics.consoleErrors.length ||
        item.diagnostics.pageErrors.length
      ) {
        failures.push(`${state}/${key}: browser error`);
      }
    }
  }
  if (failures.length) {
    throw new Error(`W1-R3 viewport evidence failed:\n${failures.join("\n")}`);
  }
};

(async () => {
  const browser = await chromium.launch({
    headless: !interactiveVercelAuth,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  });
  const evidence = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    runner: "Playwright Chromium independent BrowserContext",
    browserVersion: browser.version(),
    adminSettings: {},
    accessStates: {
      AUTHENTICATING: {},
      UNAUTHORIZED: {},
      SESSION_EXPIRED: {},
      REAUTH_FLOW: {},
    },
  };
  try {
    await establishVercelProtectionSession(browser);
    for (const viewport of viewports) {
      const key = viewportKey(viewport);
      console.log(`W1-R3 viewport ${key}: admin settings`);
      evidence.adminSettings[key] = await verifyAdminSettings(
        browser,
        viewport,
      );
      console.log(`W1-R3 viewport ${key}: authenticating`);
      evidence.accessStates.AUTHENTICATING[key] = await verifyAuthenticating(
        browser,
        viewport,
      );
      console.log(`W1-R3 viewport ${key}: unauthorized`);
      evidence.accessStates.UNAUTHORIZED[key] = await verifyUnauthorized(
        browser,
        viewport,
      );
      console.log(`W1-R3 viewport ${key}: session expired`);
      evidence.accessStates.SESSION_EXPIRED[key] = await verifySessionExpired(
        browser,
        viewport,
      );
      console.log(`W1-R3 viewport ${key}: reauthentication flow`);
      evidence.accessStates.REAUTH_FLOW[key] = await verifyReauthFlow(
        browser,
        viewport,
      );
    }
    assertEvidence(evidence);
    fs.writeFileSync(
      path.join(outputDir, "viewport-evidence.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    console.log(`W1-R3 viewport evidence: PASS (${outputDir})`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
