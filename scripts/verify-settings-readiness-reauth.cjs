const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = "src/pages/teacher/components/SettingsGeneral.tsx";
const source = fs.readFileSync(path, "utf8");
const tree = ts.createSourceFile(
  path,
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function initializer(name) {
  let result;
  function walk(n) {
    if (ts.isVariableDeclaration(n) && n.name.getText(tree) === name)
      result = n.initializer;
    else ts.forEachChild(n, walk);
  }
  walk(tree);
  assert(result, name);
  return result.getText(tree);
}
function evaluate(name, context) {
  const compiled = ts.transpileModule(
    "const result = " + initializer(name) + "; result;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return vm.runInNewContext(
    "(function(){" + compiled + "return result;})()",
    context,
  );
}
class StepUpReauthError extends Error {}
function harness(shared = { draft: null }) {
  const writes = [],
    calls = [],
    context = {
      readinessContext: {
        current: { ownerUid: "admin-a", selection: "2026-2", mounted: true },
      },
      readinessReauthFlight: { current: false },
      configLoadFlight: { current: false },
      auth: { currentUser: { uid: "admin-a" } },
      StepUpReauthError,
      settingsReadinessRecovery: shared,
      config: {
        year: "2026",
        semester: "2",
        showQuiz: false,
        showScore: true,
        showLesson: false,
      },
      activeSemester: { year: "2026", semester: "2" },
      newSemester: { year: "2027", semester: "1" },
      coreSnapshot: { activePointer: { semesterId: "2026-2" } },
      setReadinessReauthBusy: (value) => writes.push(["busy", value]),
      setReadinessNeedsReauth: (value) => writes.push(["reauth", value]),
      setReadinessError: (value) => writes.push(["error", value]),
      setCoreSnapshot: (value) => writes.push(["snapshot", value]),
      requestStepUpReauthentication: async (name, options) => {
        calls.push(["stepUp", name, options]);
      },
      loadSemesterCoreSnapshot: async () => {
        calls.push(["read"]);
        return {
          manifests: [
            {
              schoolYear: "2026",
              term: "2",
              semesterId: "2026-2",
              status: "ACTIVE",
            },
          ],
          activePointer: { semesterId: "2026-2" },
        };
      },
      db: {},
      doc: (...args) => args,
      getDoc: async () => ({
        exists: () => true,
        data: () => ({
          year: "2026",
          semester: "2",
          showQuiz: true,
          showScore: true,
          showLesson: true,
        }),
      }),
      normalizeYear: (value) => String(value),
      normalizeSemester: (value) => String(value),
      setLoading: (value) => writes.push(["loading", value]),
      setLoadError: (value) => writes.push(["loadError", value]),
      setConfig: (value) => writes.push(["config", value]),
      setNewSemester: (value) => writes.push(["newSemester", value]),
      syncSemesterPresentation: (...args) =>
        writes.push(["presentation", args]),
      setFeedback: (value) => writes.push(["feedback", value]),
      showToast: () => {},
      console,
    };
  context.getSettingsReadinessDraft = evaluate(
    "getSettingsReadinessDraft",
    context,
  );
  return {
    context,
    writes,
    calls,
    run: evaluate("handleReadinessReauthentication", context),
    load: evaluate("loadConfig", context),
  };
}
let count = 0;
async function test(name, run) {
  await run();
  count++;
  console.log("PASS " + name);
}
// Run the whole TSX component with effect cleanup and fresh hook slots on remount.
// Firebase/auth are fakes; the real shared security boundary is exercised by Staging QA.
function componentHarness() {
  let instance,
    cursor = 0,
    freshAuth = false,
    release,
    reject;
  const calls = [],
    auth = { currentUser: { uid: "admin-a" } };
  const manifest = {
    semesterId: "2026-2",
    schoolYear: "2026",
    term: "2",
    status: "ACTIVE",
    displayName: "2026학년도 2학기",
  };
  const snapshot = () => ({
    manifests: [manifest],
    activePointer: { semesterId: manifest.semesterId },
    readinessReports: {},
  });
  let serverError = null;
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children: children.flat(Infinity),
    }),
    useState: (initial) => {
      const owner = instance,
        i = cursor++;
      if (!(i in owner.slots))
        owner.slots[i] = typeof initial === "function" ? initial() : initial;
      return [
        owner.slots[i],
        (value) => {
          if (!owner.mounted) return;
          owner.slots[i] =
            typeof value === "function" ? value(owner.slots[i]) : value;
          owner.dirty = true;
        },
      ];
    },
    useRef: (initial) => {
      const i = cursor++;
      return instance.slots[i] || (instance.slots[i] = { current: initial });
    },
    useMemo: (fn) => {
      cursor++;
      return fn();
    },
    useEffect: (fn, deps) => {
      const owner = instance,
        i = cursor++,
        previous = owner.slots[i];
      if (!previous || deps.some((value, index) => value !== previous[index])) {
        owner.slots[i] = deps;
        owner.effects.push(() => {
          owner.cleanups[i]?.();
          owner.cleanups[i] = fn();
        });
      }
    },
  };
  const exports = {};
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    console: { error() {} },
    require: (name) => {
      if (name === "react") return { ...react, default: react };
      if (name === "firebase/firestore")
        return {
          doc: (...args) => args,
          getDoc: async () => {
            calls.push("config");
            return {
              exists: () => true,
              data: () => ({ year: "2026", semester: "2", showQuiz: true }),
            };
          },
        };
      if (name.endsWith("/firebase")) return { auth, db: {} };
      if (name.includes("AuthContext"))
        return {
          useAuth: () => ({
            currentUser: auth.currentUser,
            refreshConfig: async () => {},
          }),
        };
      if (name.includes("AppToastProvider"))
        return { useAppToast: () => ({ showToast() {} }) };
      if (name.endsWith("/stepUpReauth"))
        return {
          StepUpReauthError,
          requestStepUpReauthentication: () => {
            calls.push("reauth");
            return new Promise((resolve, no) => {
              release = () => {
                freshAuth = true;
                resolve();
              };
              reject = () => no(new StepUpReauthError("취소"));
            });
          },
        };
      if (name.endsWith("/semesterCore"))
        return {
          loadSemesterCoreSnapshot: async () => {
            calls.push("snapshot");
            return snapshot();
          },
          resolveSemester: () => ({ ok: true, manifest }),
          isReadinessCurrent: () => false,
          getServerSemesterCoreState: async () => {
            calls.push(freshAuth ? "query-fresh" : "query-old");
            if (!freshAuth)
              throw { details: { reason: "RECENT_AUTH_REQUIRED" } };
            return {
              error: serverError,
              requested: { semesterId: manifest.semesterId },
              readiness: { current: false },
            };
          },
        };
      if (name.endsWith("/commandGateway"))
        return {
          executeWestoryCommand: async () => {
            calls.push("SAVE");
            throw Error("unexpected save");
          },
        };
      return {};
    },
  });
  const render = () => {
    if (!instance?.mounted) return;
    for (let i = 0; i < 12; i++) {
      cursor = 0;
      instance.dirty = false;
      instance.tree = exports.default();
      while (instance.effects.length) instance.effects.shift()();
      if (!instance.dirty) return;
    }
    throw Error("render did not settle");
  };
  const settle = async () => {
    for (let i = 0; i < 20; i++) {
      await Promise.resolve();
      if (instance.dirty) render();
    }
    return instance.tree;
  };
  const mount = () => {
    instance = {
      slots: [],
      cleanups: [],
      effects: [],
      dirty: true,
      mounted: true,
    };
    render();
  };
  const unmount = () => {
    for (const cleanup of instance.cleanups) cleanup?.();
    instance.mounted = false;
  };
  const nodes = (node) =>
    node && typeof node === "object"
      ? [node, ...(node.children || []).flatMap(nodes)]
      : [];
  const label = (node) =>
    typeof node === "string"
      ? node
      : node && typeof node === "object"
        ? (node.children || []).map(label).join("")
        : "";
  return {
    mount,
    unmount,
    settle,
    render,
    calls,
    release: () => release(),
    cancel: () => reject(),
    setServerError: (value) => {
      serverError = value;
    },
    quiz: () =>
      nodes(instance.tree).find(
        (n) => n.type === "input" && n.props.name === "showQuiz",
      ),
    retry: () =>
      nodes(instance.tree).find(
        (n) => n.type === "button" && label(n).includes("다시 인증 후 조회"),
      ),
    text: () => label(instance.tree),
  };
}
(async () => {
  await test("only exact server recent-auth reason triggers the recovery mode", () => {
    const classify = evaluate("isReadinessReauthRequired", {});
    assert(classify({ details: { reason: "RECENT_AUTH_REQUIRED" } }));
    for (const e of [
      null,
      {},
      { code: "permission-denied" },
      { message: "Recent authentication is required for this command." },
      { details: { reason: "OTHER" } },
    ])
      assert.equal(classify(e), false);
  });
  await test("forced shared step-up precedes snapshot read and leaves settings form untouched", async () => {
    const h = harness();
    await h.run();
    assert.equal(h.calls[0][0], "stepUp");
    assert.equal(h.calls[0][1], "getSemesterCoreState");
    assert.equal(h.calls[0][2].force, true);
    assert.equal(h.calls[1][0], "read");
    assert.equal(h.writes.filter((w) => w[0] === "snapshot").length, 1);
    assert(
      !initializer("handleReadinessReauthentication").includes("loadConfig"),
    );
    assert(
      !initializer("handleReadinessReauthentication").includes("setConfig"),
    );
  });
  await test("cancelled step-up keeps actionable error and performs no read", async () => {
    const h = harness();
    h.context.requestStepUpReauthentication = async () => {
      throw new StepUpReauthError("본인 확인을 취소했습니다.");
    };
    await h.run();
    assert.equal(h.calls.length, 0);
    assert(h.writes.some((w) => w[0] === "reauth" && w[1] === true));
    assert(h.writes.some((w) => w[0] === "error" && w[1].includes("취소")));
    assert.equal(h.context.readinessReauthFlight.current, false);
  });
  await test("snapshot network failure keeps retry available", async () => {
    const h = harness();
    h.context.loadSemesterCoreSnapshot = async () => {
      throw Error("network");
    };
    await h.run();
    assert(h.writes.some((w) => w[0] === "reauth" && w[1]));
    assert(!h.writes.some((w) => w[0] === "snapshot"));
  });
  for (const edge of ["auth-owner", "context-owner", "semester", "unmount"])
    await test("discard after step-up: " + edge, async () => {
      const h = harness();
      h.context.requestStepUpReauthentication = async () => {
        if (edge === "auth-owner") h.context.auth.currentUser.uid = "admin-b";
        if (edge === "context-owner")
          h.context.readinessContext.current.ownerUid = "admin-b";
        if (edge === "semester")
          h.context.readinessContext.current.selection = "2026-1";
        if (edge === "unmount")
          h.context.readinessContext.current.mounted = false;
      };
      await h.run();
      assert(!h.calls.some((c) => c[0] === "read"));
      assert(!h.writes.some((w) => w[0] === "snapshot"));
    });
  await test("discard snapshot response after selection changes", async () => {
    const h = harness();
    h.context.loadSemesterCoreSnapshot = async () => {
      h.context.readinessContext.current.selection = "2026-1";
      return {};
    };
    await h.run();
    assert(!h.writes.some((w) => w[0] === "snapshot"));
  });
  await test("double click shares one active recovery; stale owner cannot start", async () => {
    const h = harness();
    let release;
    h.context.requestStepUpReauthentication = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const first = h.run();
    await h.run();
    release();
    await first;
    assert.equal(h.calls.filter((c) => c[0] === "read").length, 1);
    const other = harness();
    other.context.auth.currentUser.uid = "admin-b";
    await other.run();
    assert.equal(other.calls.length, 0);
  });
  await test("actual handler unmount then new instance load waits for authentication and restores checkboxes", async () => {
    const shared = { draft: null },
      old = harness(shared);
    let release;
    old.context.requestStepUpReauthentication = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const flight = old.run();
    old.context.readinessContext.current.mounted = false;
    const remount = harness(shared),
      loading = remount.load();
    await remount.load(); // A duplicate loading effect must not consume/revert the draft.
    await Promise.resolve();
    assert.equal(remount.calls.length, 0);
    release();
    await flight;
    await loading;
    const restored = remount.writes.find((w) => w[0] === "config")[1];
    assert.equal(restored.showQuiz, false);
    assert.equal(restored.showLesson, false);
    assert.equal(
      remount.writes.find((w) => w[0] === "newSemester")[1].year,
      "2027",
    );
    assert.equal(remount.calls.filter((c) => c[0] === "read").length, 1);
    assert.equal(shared.draft, null);
    assert.equal(old.writes.filter((w) => w[0] === "snapshot").length, 0);
  });
  await test("cancel after unmount restores owner draft on new instance without forcing a save", async () => {
    const shared = { draft: null },
      old = harness(shared);
    let reject;
    old.context.requestStepUpReauthentication = () =>
      new Promise((_, r) => {
        reject = r;
      });
    const flight = old.run();
    old.context.readinessContext.current.mounted = false;
    reject(new StepUpReauthError("취소"));
    await flight;
    const remount = harness(shared);
    await remount.load();
    assert.equal(
      remount.writes.find((w) => w[0] === "config")[1].showQuiz,
      false,
    );
    assert.equal(shared.draft, null);
  });
  for (const edge of ["owner", "active-semester", "closed-semester", "expired"])
    await test(
      "new instance never restores unsafe retained draft: " + edge,
      async () => {
        const shared = { draft: null },
          old = harness(shared);
        let release;
        old.context.requestStepUpReauthentication = () =>
          new Promise((r) => {
            release = r;
          });
        const flight = old.run();
        old.context.readinessContext.current.mounted = false;
        release();
        await flight;
        const remount = harness(shared);
        if (edge === "owner") {
          remount.context.auth.currentUser.uid = "admin-b";
          remount.context.readinessContext.current.ownerUid = "admin-b";
        }
        if (edge === "active-semester")
          remount.context.loadSemesterCoreSnapshot = async () => ({
            manifests: [{ schoolYear: "2026", term: "2", status: "ACTIVE" }],
            activePointer: { semesterId: "2027-1" },
          });
        if (edge === "closed-semester")
          remount.context.loadSemesterCoreSnapshot = async () => ({
            manifests: [{ schoolYear: "2026", term: "2", status: "CLOSED" }],
            activePointer: { semesterId: "2026-2" },
          });
        if (edge === "expired") shared.draft.expiresAt = 0;
        await remount.load();
        assert.equal(
          remount.writes.find((w) => w[0] === "config")[1].showQuiz,
          true,
        );
        assert.equal(shared.draft, null);
      },
    );
  await test("successful query with no readiness report differs from rejected query", () => {
    const readinessEffect = [];
    function walk(n) {
      if (
        ts.isCallExpression(n) &&
        n.expression.getText(tree) === "useEffect" &&
        n.arguments[0]?.getText(tree).includes("queryOwnerUid")
      )
        readinessEffect.push(n.arguments[0]);
      ts.forEachChild(n, walk);
    }
    walk(tree);
    assert.equal(readinessEffect.length, 1);
    const text = readinessEffect[0].getText(tree);
    assert(text.includes("serverState.readiness?.current === true"));
    assert(text.includes("if (!report)"));
    assert(
      text.indexOf("if (serverState.error)") < text.indexOf("if (!report)"),
    );
    assert(text.includes("isReadinessReauthRequired(error)"));
    assert(text.includes("setReadinessNeedsReauth(needsReauth)"));
  });
  for (const outcome of ["success", "cancel", "query-error"])
    await test(
      "whole component cleanup/new-instance remount preserves draft and resolves readiness: " +
        outcome,
      async () => {
        const h = componentHarness();
        h.mount();
        await h.settle();
        assert(h.retry());
        assert.equal(h.quiz().props.checked, true);
        h.quiz().props.onChange({
          target: { name: "showQuiz", type: "checkbox", checked: false },
        });
        h.render();
        const retry = h.retry();
        retry.props.onClick();
        retry.props.onClick();
        assert.equal(h.calls.filter((c) => c === "reauth").length, 1);
        h.unmount();
        const before = h.calls.length;
        h.mount();
        await h.settle();
        assert.equal(
          h.calls.length,
          before,
          "new instance must wait for pending auth",
        );
        if (outcome === "cancel") h.cancel();
        else {
          if (outcome === "query-error") h.setServerError("UNAVAILABLE");
          h.release();
        }
        await h.settle();
        assert.equal(h.quiz().props.checked, false);
        assert(!h.calls.includes("SAVE"));
        if (outcome === "success") {
          assert(h.calls.includes("query-fresh"));
          assert(h.text().includes("아직 준비 상태를 확인하지 않았습니다"));
          assert(!h.retry());
        }
        if (outcome === "query-error") {
          assert(
            h.text().includes("서버의 최신 학기 상태를 확인하지 못했습니다"),
          );
          assert(!h.text().includes("아직 준비 상태를 확인하지 않았습니다"));
        }
        if (outcome === "cancel") {
          assert(h.retry());
          h.retry().props.onClick();
          h.unmount();
          h.mount();
          h.release();
          await h.settle();
          assert.equal(h.quiz().props.checked, false);
          assert(h.calls.includes("query-fresh"));
        }
        h.unmount();
      },
    );
  const compiled = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(
    (compiled.diagnostics || []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
  );
  console.log(
    `PASS Settings readiness recovery ${count} scenarios + TSX transpile`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
