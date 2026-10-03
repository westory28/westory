import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Exercise the shipped browser policy and OAuth acquisition closure. Firebase,
// credentials, browser windows, production storage, and the network are stubbed.
const source = fs.readFileSync(
  new URL("../src/pages/Login.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "Login.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const topLevel = new Map();
for (const statement of parsed.statements) {
  if (!ts.isVariableStatement(statement)) continue;
  for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name))
      topLevel.set(declaration.name.text, declaration);
  }
}
let acquisition;
const findAcquisition = (node) => {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "startGoogleLogin"
  )
    acquisition = node;
  ts.forEachChild(node, findAcquisition);
};
findAcquisition(parsed);
assert.ok(acquisition?.initializer, "Actual OAuth acquisition must exist");

const exportedNames = [
  "shouldPreferRedirectLogin",
  "shouldFallbackToRedirectLogin",
  "isPopupFallbackError",
  "getLoginFailureMessage",
  "buildGoogleProvider",
  "startGoogleLogin",
];
const selected = new Map();
const include = (declaration) => {
  const name = declaration.name.getText(parsed);
  if (selected.has(name)) return;
  selected.set(name, declaration);
  const visit = (node) => {
    if (ts.isIdentifier(node)) {
      const dependency = topLevel.get(node.text);
      // Network deadline behavior has its own startup regression coverage.
      if (
        ![
          "awaitLoginNetwork",
          "markRedirectAttempt",
          "clearRedirectAttempt",
        ].includes(node.text) &&
        dependency?.initializer &&
        (ts.isArrowFunction(dependency.initializer) ||
          ts.isFunctionExpression(dependency.initializer))
      )
        include(dependency);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration.initializer);
};
for (const name of exportedNames) {
  const declaration =
    name === "startGoogleLogin" ? acquisition : topLevel.get(name);
  assert.ok(declaration, `Actual helper ${name} must exist`);
  include(declaration);
}
const code = ts.transpileModule(
  `${[...selected.values()]
    .map((declaration) => `const ${declaration.getText(parsed)};`)
    .join("\n")}\nexport { ${exportedNames.join(", ")} };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let index = 0; index < 20; index++) await Promise.resolve();
};
const authError = (code) =>
  Object.assign(new Error("Synthetic failure"), { code });
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
// Chrome's documented Android tablet desktop UA omits Android/Mobile and its
// platform client hint becomes Linux: https://developer.chrome.com/blog/desktop-mode
const ANDROID_DESKTOP_CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36";
const CHROME_OS =
  "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MAC_CHROME = CHROME.replace(
  "Windows NT 10.0; Win64; x64",
  "Macintosh; Intel Mac OS X 10_15_7",
);

function harness({
  ua = CHROME,
  hostname = "www.westory.kr",
  protocol = "https:",
  maxTouchPoints = 0,
  touchInfoAvailable = true,
  pointer = "fine",
  hover = "hover",
  anyCoarse = false,
  matchMediaMode = "available",
  uaPlatform = "Windows",
  embedded = false,
  webview = false,
  popup,
  redirect,
  finish,
} = {}) {
  const state = {
    busy: false,
    pendingMode: null,
    redirectMode: null,
    notice: "",
    flow: 0,
    calls: [],
    providers: [],
    failures: [],
    discarded: [],
    completed: [],
  };
  const persistence = deferred();
  const refs = {
    mountedRef: { current: true },
    resumeFlowRef: { current: null },
    activeActionFlowRef: { current: null },
    actionVersionRef: { current: 0 },
    authActionLockRef: { current: true },
  };
  const browserWindow = { location: { hostname, protocol } };
  browserWindow.self = browserWindow;
  browserWindow.top = embedded ? {} : browserWindow;
  if (webview) browserWindow.chrome = { webview: {} };
  if (matchMediaMode !== "missing") {
    browserWindow.matchMedia = (query) => {
      if (matchMediaMode === "throw")
        throw new Error("Synthetic media capability failure");
      const capabilities = {
        "(any-pointer: coarse)": anyCoarse,
        "(pointer: fine)": pointer === "fine",
        "(hover: hover)": hover === "hover",
      };
      assert.ok(query in capabilities, `Unexpected media query: ${query}`);
      return { matches: capabilities[query] };
    };
  }
  const account = { uid: "synthetic-acquisition-user" };
  const sdkAuth = { currentUser: null };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    navigator: {
      userAgent: ua,
      ...(touchInfoAvailable ? { maxTouchPoints } : {}),
      platform: /Macintosh/.test(ua) ? "MacIntel" : "Win32",
      userAgentData: { platform: uaPlatform, mobile: false },
    },
    window: browserWindow,
    console: { info() {}, error() {}, warn() {} },
    ALLOWED_SCHOOL_EMAIL_DOMAIN: "school.example",
    configuredAuthDomain: "www.westory.kr",
    ...refs,
    auth: sdkAuth,
    authPersistenceReady: persistence.promise,
    awaitLoginNetwork: (promise) => promise,
    beginLoginFlow: () => ++state.flow,
    isLoginFlowCurrent: (flow) => state.flow === flow,
    setPendingLoginMode: (mode) => {
      state.pendingMode = mode;
    },
    clearPendingLoginMode: () => {
      state.pendingMode = null;
    },
    markRedirectAttempt: (mode) => {
      state.redirectMode = mode;
      state.calls.push("mark-redirect");
    },
    clearRedirectAttempt: () => {
      state.redirectMode = null;
    },
    setLoginNotice: (notice) => {
      state.notice = notice;
    },
    setAuthBusy: (busy) => {
      state.busy = busy;
    },
    failLoginFlow: (flow, error) => {
      state.failures.push({ flow, error });
    },
    discardStaleLoginUser: async (user, flow) => {
      state.discarded.push({ user, flow });
    },
    finishLoginForRole: async (user, mode, flow) => {
      state.calls.push("finish");
      if (finish) await finish({ user, mode, flow });
      state.completed.push({ user, mode, flow });
    },
    markLoginPerf() {},
    measureLoginPerf() {},
    GoogleAuthProvider: class {
      setCustomParameters(parameters) {
        this.parameters = parameters;
      }
    },
    signInWithPopup: (auth, provider) => {
      assert.equal(auth, sdkAuth);
      state.calls.push("popup");
      state.providers.push(provider);
      return popup ? popup() : Promise.resolve({ user: account });
    },
    signInWithRedirect: (auth, provider) => {
      assert.equal(auth, sdkAuth);
      state.calls.push("redirect");
      state.providers.push(provider);
      return redirect ? redirect() : Promise.resolve();
    },
  });
  return { ...exports, state, persistence, refs, account };
}

let cases = 0;
const check = async (name, test) => {
  try {
    await test();
    cases++;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
};

const policyCases = [
  ["desktop Chrome HTTPS", {}, false],
  ["desktop Edge", { ua: `${CHROME} Edg/140.0.0.0` }, false],
  ["desktop Chromium", { ua: CHROME.replace("Chrome/", "Chromium/") }, false],
  [
    "desktop Firefox",
    {
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
    },
    false,
  ],
  ["desktop Chromium derivative", { ua: `${CHROME} Whale/4.34.333.13` }, false],
  ["non-touch macOS Chrome", { ua: MAC_CHROME }, false],
  ["non-touch macOS Edge", { ua: `${MAC_CHROME} Edg/140.0.0.0` }, false],
  [
    "non-touch macOS Firefox",
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0",
    },
    false,
  ],
  ["desktop touch laptop with fine pointer", { maxTouchPoints: 10 }, true],
  ["single-touch display", { maxTouchPoints: 1 }, true],
  ["missing touch capability", { touchInfoAvailable: false }, true],
  ["null touch capability", { maxTouchPoints: null }, true],
  ["string touch capability", { maxTouchPoints: "0" }, true],
  ["missing media capabilities", { matchMediaMode: "missing" }, true],
  ["throwing media capabilities", { matchMediaMode: "throw" }, true],
  [
    "secondary coarse pointer despite primary fine pointer",
    { anyCoarse: true },
    true,
  ],
  ["primary coarse pointer", { pointer: "coarse" }, true],
  ["primary pointer unavailable", { pointer: "none" }, true],
  ["hover unavailable", { hover: "none" }, true],
  [
    "Galaxy Tab Chrome desktop site with touch",
    {
      ua: ANDROID_DESKTOP_CHROME,
      maxTouchPoints: 5,
      pointer: "coarse",
      anyCoarse: true,
      uaPlatform: "Linux",
    },
    true,
  ],
  [
    "Galaxy Tab Chrome desktop site with external mouse and Linux client hint",
    {
      ua: ANDROID_DESKTOP_CHROME,
      maxTouchPoints: 5,
      pointer: "fine",
      uaPlatform: "Linux",
    },
    true,
  ],
  [
    "Android desktop-shaped UA with zero touch information",
    { ua: ANDROID_DESKTOP_CHROME, maxTouchPoints: 0, uaPlatform: "Linux" },
    true,
  ],
  [
    "Android desktop-shaped UA with missing touch information",
    {
      ua: ANDROID_DESKTOP_CHROME,
      touchInfoAvailable: false,
      uaPlatform: "Linux",
    },
    true,
  ],
  [
    "Samsung Internet DeX desktop UA",
    {
      ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/13.0 Chrome/83.0.4103.106 Safari/537.36",
      maxTouchPoints: 5,
      uaPlatform: "Linux",
    },
    true,
  ],
  [
    "touch Chromebook tablet",
    { ua: CHROME_OS, maxTouchPoints: 10, uaPlatform: "Chrome OS" },
    true,
  ],
  ["non-touch Chromebook", { ua: CHROME_OS, uaPlatform: "Chrome OS" }, true],
  [
    "Linux Firefox desktop remains conservative",
    {
      ua: "Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0",
      uaPlatform: "Linux",
    },
    true,
  ],
  [
    "Windows tablet Edge",
    {
      ua: `${CHROME} Edg/140.0.0.0`,
      maxTouchPoints: 10,
      pointer: "coarse",
      anyCoarse: true,
    },
    true,
  ],
  ["desktop Safari", { ua: SAFARI }, true],
  ["iPad desktop mode", { ua: SAFARI, maxTouchPoints: 5 }, true],
  [
    "iPad Chrome requests desktop site with mouse",
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/85 Version/11.1.1 Safari/605.1.15",
      maxTouchPoints: 5,
    },
    true,
  ],
  [
    "touch iPad presenting a desktop Chrome UA",
    {
      ua: CHROME.replace(
        "Windows NT 10.0; Win64; x64",
        "Macintosh; Intel Mac OS X 10_15_7",
      ),
      maxTouchPoints: 5,
    },
    true,
  ],
  [
    "iPhone Chrome",
    {
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
    },
    true,
  ],
  [
    "Android Chrome",
    { ua: CHROME.replace("Windows NT 10.0; Win64; x64", "Linux; Android 15") },
    true,
  ],
  ["other mobile browser", { ua: `${CHROME} Mobile` }, true],
  ["embedded desktop frame", { embedded: true }, true],
  ["WebView2 bridge with ordinary Chrome UA", { webview: true }, true],
  ["unknown desktop UA", { ua: "WestoryBrowser/1.0" }, true],
  ["missing UA", { ua: "" }, true],
  ["localhost desktop", { hostname: "localhost", protocol: "http:" }, false],
  [
    "localhost Safari QA",
    { hostname: "localhost", protocol: "http:", ua: SAFARI },
    false,
  ],
  [
    "loopback mobile QA",
    { hostname: "127.0.0.1", protocol: "http:", ua: "Android Mobile" },
    false,
  ],
  ...[
    "KAKAOTALK",
    "FBAN",
    "FBAV",
    "Instagram",
    "Line",
    "NAVER",
    "DaumApps",
    "; wv)",
    "WebView",
    "Electron",
    "Codex",
    "ChatGPT",
    "CEF",
    "HeadlessChrome",
  ].map((container) => [
    `${container} embedded UA`,
    { ua: `${CHROME} ${container}/1.0` },
    true,
  ]),
];
for (const [name, options, expected] of policyCases)
  await check(`Acquisition policy: ${name}`, () => {
    assert.equal(harness(options).shouldPreferRedirectLogin(), expected);
  });

for (const mode of ["student", "teacher"])
  await check(
    `Desktop ${mode} popup opens before persistence resolves`,
    async () => {
      const h = harness();
      const pending = h.startGoogleLogin(mode);
      assert.deepEqual(h.state.calls, ["popup"]);
      assert.equal(h.state.busy, true);
      assert.equal(h.state.pendingMode, mode);
      assert.equal(h.state.providers[0].parameters.prompt, "select_account");
      await flush();
      assert.equal(h.state.completed.length, 0);
      h.persistence.resolve();
      await pending;
      assert.equal(h.state.completed.length, 1);
      assert.equal(h.state.completed[0].mode, mode);
      assert.equal(h.state.completed[0].user, h.account);
      assert.equal(h.state.calls.includes("redirect"), false);
      assert.equal(h.state.busy, false);
      assert.equal(h.refs.authActionLockRef.current, false);
    },
  );

for (const code of [
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
])
  await check(`${code} restores login without redirect`, async () => {
    const h = harness({
      popup: async () => {
        throw authError(code);
      },
    });
    assert.equal(h.isPopupFallbackError(authError(code)), false);
    assert.equal(h.shouldFallbackToRedirectLogin(authError(code)), false);
    await h.startGoogleLogin("student");
    assert.deepEqual(h.state.calls, ["popup"]);
    assert.equal(h.state.failures.length, 1);
    assert.equal(h.state.pendingMode, null);
    assert.equal(h.state.redirectMode, null);
    assert.equal(h.state.busy, false);
    assert.equal(h.refs.authActionLockRef.current, false);
    assert.equal(h.refs.activeActionFlowRef.current, null);
    assert.match(h.state.notice, /취소/);
    assert.equal(h.state.completed.length, 0);
  });

for (const code of [
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/internal-error",
  "auth/network-request-failed",
])
  await check(`${code} redirects only after persistence is ready`, async () => {
    const h = harness({
      popup: async () => {
        throw authError(code);
      },
    });
    const pending = h.startGoogleLogin("teacher");
    await flush();
    assert.deepEqual(h.state.calls, ["popup"]);
    assert.equal(h.state.redirectMode, null);
    assert.equal(h.state.busy, true);
    h.persistence.resolve();
    await pending;
    assert.deepEqual(h.state.calls, ["popup", "mark-redirect", "redirect"]);
    assert.equal(h.state.redirectMode, "teacher");
    assert.equal(h.state.providers[1].parameters.prompt, "select_account");
    assert.equal(h.state.completed.length, 0);
  });

for (const [device, options] of [
  ["Android mobile", { ua: `${CHROME} Android Mobile` }],
  [
    "Galaxy Tab desktop site with mouse",
    {
      ua: ANDROID_DESKTOP_CHROME,
      maxTouchPoints: 5,
      pointer: "fine",
      uaPlatform: "Linux",
    },
  ],
  [
    "Galaxy Tab desktop-shaped UA without touch report",
    { ua: ANDROID_DESKTOP_CHROME, maxTouchPoints: 0, uaPlatform: "Linux" },
  ],
  ["iPad desktop site", { ua: SAFARI, maxTouchPoints: 5 }],
])
  for (const mode of ["student", "teacher"])
    await check(
      `${device} ${mode} redirect waits for persistence`,
      async () => {
        const h = harness(options);
        const pending = h.startGoogleLogin(mode);
        await flush();
        assert.deepEqual(h.state.calls, []);
        assert.equal(h.state.pendingMode, mode);
        assert.equal(h.state.redirectMode, null);
        assert.equal(h.state.completed.length, 0);
        h.persistence.resolve();
        await pending;
        assert.deepEqual(h.state.calls, ["mark-redirect", "redirect"]);
        assert.equal(h.state.redirectMode, mode);
        assert.equal(h.state.providers[0].parameters.prompt, "select_account");
        assert.equal(h.state.completed.length, 0);
        assert.equal(h.state.failures.length, 0);
      },
    );

for (const code of ["functions/unauthenticated", "auth/network-request-failed"])
  await check(
    `Acquired credential ${code} failure never restarts OAuth`,
    async () => {
      const h = harness({
        finish: async () => {
          throw authError(code);
        },
      });
      h.persistence.resolve();
      await h.startGoogleLogin("student");
      assert.deepEqual(h.state.calls, ["popup", "finish"]);
      assert.equal(h.state.failures.length, 1);
      assert.equal(h.state.completed.length, 0);
      assert.equal(h.state.pendingMode, null);
      assert.equal(h.state.busy, false);
    },
  );

for (const boundary of ["unmounted", "superseded"])
  await check(`Late popup result after ${boundary} is discarded`, async () => {
    const popup = deferred();
    const h = harness({ popup: () => popup.promise });
    const pending = h.startGoogleLogin("student");
    if (boundary === "unmounted") h.refs.mountedRef.current = false;
    else h.state.flow++;
    popup.resolve({ user: h.account });
    await pending;
    assert.equal(h.state.discarded.length, 1);
    assert.equal(h.state.discarded[0].user, h.account);
    assert.equal(h.state.discarded[0].flow, 1);
    assert.equal(h.state.calls.includes("finish"), false);
    assert.equal(h.state.calls.includes("redirect"), false);
    assert.equal(h.state.completed.length, 0);
  });

await check(
  "An older acquisition cannot unlock a newer flow or route",
  async () => {
    const first = deferred();
    const second = deferred();
    let popupCalls = 0;
    const h = harness({
      popup: () => (++popupCalls === 1 ? first.promise : second.promise),
    });
    const oldAttempt = h.startGoogleLogin("student");
    const newAttempt = h.startGoogleLogin("teacher");
    first.resolve({ user: h.account });
    await oldAttempt;
    assert.equal(h.state.discarded.length, 1);
    assert.equal(h.state.busy, true);
    assert.equal(h.refs.authActionLockRef.current, true);
    assert.equal(h.refs.activeActionFlowRef.current, 2);
    assert.equal(h.state.completed.length, 0);
    h.persistence.resolve();
    second.resolve({ user: h.account });
    await newAttempt;
    assert.equal(h.state.completed.length, 1);
    assert.equal(h.state.completed[0].flow, 2);
    assert.equal(h.state.completed[0].mode, "teacher");
  },
);

for (const boundary of ["unmounted", "superseded"])
  await check(
    `Acquired popup awaiting persistence cannot route after ${boundary}`,
    async () => {
      const h = harness();
      const pending = h.startGoogleLogin("student");
      await flush();
      if (boundary === "unmounted") h.refs.mountedRef.current = false;
      else h.state.flow++;
      h.persistence.resolve();
      await pending;
      assert.equal(h.state.calls.includes("finish"), false);
      assert.equal(h.state.calls.includes("redirect"), false);
      assert.equal(h.state.completed.length, 0);
    },
  );

await check(
  "Stale blocked popup does not redirect a newer acquisition",
  async () => {
    const h = harness({
      popup: async () => {
        throw authError("auth/popup-blocked");
      },
    });
    const pending = h.startGoogleLogin("student");
    await flush();
    h.state.flow++;
    h.refs.actionVersionRef.current++;
    h.persistence.resolve();
    await pending;
    assert.deepEqual(h.state.calls, ["popup"]);
    assert.equal(h.state.failures.length, 0);
    assert.equal(h.state.busy, true);
    assert.equal(h.refs.authActionLockRef.current, true);
  },
);

console.log(
  `Login acquisition: ${cases} deterministic policy/flow regressions passed. Actual Login.tsx helpers and acquisition closure; no live OAuth, Firebase SDK, browser window, or network requests.`,
);
